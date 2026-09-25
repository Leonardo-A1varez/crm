import { ETIQUETA_NODO } from "@/lib/workflows/catalogo";
import { MOTIVO_SALTO } from "@/lib/workflows/motivos-salto";
import { motivoSaltoDeSalida } from "@/types/workflows";
import { pasosDelGrafo } from "@/lib/workflows/pasos";
import { esperaLegible } from "@/lib/triage";
import { campoHoraEnZona } from "@/lib/zona-horaria";
import type {
  CorridaEnLista,
  DetalleDeCorrida,
  FinDeCorrida,
  PasoDeCorrida,
} from "@/components/workflows/lista/tipos";
import type {
  WorkflowRunConLead,
  WorkflowRunDetalle,
  WorkflowRunEstado,
  WorkflowRunPaso,
} from "@/types/entities";
import type { Grafo } from "@/types/workflows";

/**
 * Traducción de una corrida de la base a lo que dibuja el historial.
 *
 * Vive en `app/**` por lo mismo que `_lib/listado.ts`: los tipos de destino son
 * de `components/**` y `lib/**` no puede importarlos.
 *
 * Todo lo que depende del reloj —"hace 3 m", "09:14"— se resuelve acá, en el
 * servidor, y viaja como texto. Es lo que pide `CorridaEnLista`, y el motivo
 * está escrito en su propio archivo: formatear en el cliente da un render en el
 * servidor y otro al hidratar.
 */

/**
 * Cinco estados de la base, cinco de la pantalla. La sexta, `saltada`, no es
 * un estado de la base: es una corrida `terminado` que un tope de seguridad
 * cortó (`motivo_salto`), y se resuelve en `finDe`.
 */
const FIN_POR_ESTADO: Record<WorkflowRunEstado, FinDeCorrida> = {
  terminado: "terminada",
  fallado: "fallada",
  corriendo: "corriendo",
  esperando: "esperando",
  cancelado: "cancelada",
};

/** `#a3d1`: los primeros cuatro del UUID. Alcanza para nombrar una corrida en voz alta. */
function codigoDeCorrida(id: string): string {
  return `#${id.slice(0, 4)}`;
}

/** "1,2 s", "3 m 20 s", "—" si la corrida sigue viva y todavía no hay duración. */
export function duracionLegible(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms} ms`;
  const segundos = Math.round(ms / 1000);
  if (segundos < 60) return `${segundos} s`;
  const minutos = Math.floor(segundos / 60);
  const resto = segundos % 60;
  return resto === 0 ? `${minutos} m` : `${minutos} m ${resto} s`;
}

/**
 * Cómo terminó. Una corrida saltada está `terminado` en la base —terminó, no
 * falló— pero se muestra aparte: "terminada" diría que el lead recibió todo el
 * flujo, y no lo recibió.
 */
function finDe(run: WorkflowRunConLead): FinDeCorrida {
  return run.motivo_salto !== null && run.estado === "terminado"
    ? "saltada"
    : FIN_POR_ESTADO[run.estado];
}

export function aCorridaEnLista(run: WorkflowRunConLead, ahoraMs: number): CorridaEnLista {
  return {
    id: run.id,
    codigo: codigoDeCorrida(run.id),
    leadNombre: run.lead_nombre ?? "Lead sin nombre",
    // El vehículo distinguiría dos leads homónimos, pero `WorkflowRunConLead`
    // sólo trae el nombre: el join de `listarHistorial` no pasa por
    // `lead_vehiculos`. Antes que inventar un dato que el usuario va a leer
    // como cierto, se deja vacío y la fila muestra sólo el nombre.
    leadVehiculo: null,
    cuando: esperaLegible(ahoraMs - run.started_at.getTime()),
    duracion: duracionLegible(run.duracion_ms),
    fin: finDe(run),
    // `workflow_runs.error` guarda una frase para una persona ("Se alcanzó el
    // tope de 50 pasos"), no un código. Recortarla a cuatro caracteres para que
    // parezca un código de Meta sería inventar un código. El texto entero se
    // muestra donde entra: en el detalle.
    codigoError: null,
  };
}

/**
 * Cómo se llama cada nodo y a qué profundidad cuelga, sacado del grafo de la
 * versión con la que corrió.
 *
 * `workflow_run_pasos` guarda `nodo_id` y nada más: sin el grafo, la línea de
 * tiempo mostraría ids crudos. La versión importa —una corrida vieja está
 * pinneada a la versión con la que arrancó, no a la publicada hoy—, así que el
 * grafo tiene que ser el de ESA versión.
 */
function leerGrafo(grafo: Grafo): Map<string, { nombre: string; nivel: number }> {
  const lectura = pasosDelGrafo(grafo);
  const mapa = new Map<string, { nombre: string; nivel: number }>();

  /**
   * `nivel` es profundidad de RAMA, no de salto.
   *
   * La primera versión usaba `paso.profundidad` —cuántos saltos hay desde el
   * disparador— y quedó medido en pantalla: en un flujo lineal de tres nodos
   * las cajas salían a x=782, 807 y 834, una escalerita que en un flujo de
   * diez pasos se va del panel. `PasoDeCorrida.nivel` significa otra cosa: "la
   * sangría cuando el paso cuelga de una condición, 0 es el tronco". Un tramo
   * recto es todo tronco por más largo que sea.
   *
   * Se cuenta cuántas bifurcaciones hay que tomar para llegar. Como
   * `pasosDelGrafo` devuelve el recorrido en profundidad, el padre de un paso
   * es el último visto un nivel más arriba, y alcanza con recordar la rama de
   * cada profundidad a medida que se avanza.
   */
  const ramaPorProfundidad: number[] = [];

  for (const paso of lectura.pasos) {
    const ramaPadre = paso.profundidad === 0 ? 0 : (ramaPorProfundidad[paso.profundidad - 1] ?? 0);
    // Sólo `verdadero` y `falso` abren rama; `salida` sigue el tronco.
    const rama = paso.puerto !== null && paso.puerto !== "salida" ? ramaPadre + 1 : ramaPadre;
    ramaPorProfundidad[paso.profundidad] = rama;

    if (mapa.has(paso.nodo.id)) continue;
    mapa.set(paso.nodo.id, { nombre: ETIQUETA_NODO[paso.nodo.tipo], nivel: rama });
  }
  // Los inalcanzables no aparecen en el recorrido y aun así pueden tener pasos
  // registrados si el grafo cambió: entran al tronco antes que quedar sin nombre.
  for (const nodo of lectura.inalcanzables) {
    if (!mapa.has(nodo.id)) mapa.set(nodo.id, { nombre: ETIQUETA_NODO[nodo.tipo], nivel: 0 });
  }

  return mapa;
}

/**
 * Los pasos ejecutados, en orden.
 *
 * Sólo salen los que la corrida **ejecutó**: `workflow_run_pasos` registra lo
 * que pasó, no lo que podría haber pasado. Por eso ningún paso sale como
 * `no-tomado` —la rama que no se tomó no dejó fila—. `motivo` sólo lo lleva un
 * paso `saltado`: el tope que lo saltó, en palabras. El único `pendiente` que se puede afirmar es el nodo en el que quedó
 * frenada una corrida viva, que sí está en `workflow_runs.nodo_actual`.
 */
function aPasos(
  pasos: readonly WorkflowRunPaso[],
  nodos: Map<string, { nombre: string; nivel: number }>,
  run: WorkflowRunDetalle,
  zona: string,
): PasoDeCorrida[] {
  const ordenados = [...pasos].sort((a, b) => a.orden - b.orden);

  const salida: PasoDeCorrida[] = ordenados.map((paso, i) => {
    const info = nodos.get(paso.nodo_id);
    const anterior = i > 0 ? ordenados[i - 1] : undefined;
    const salto = motivoSaltoDeSalida(paso.salida);
    return {
      id: paso.id,
      nombre: info?.nombre ?? paso.nodo_id,
      paso: paso.error !== null ? "fallado" : salto !== null ? "saltado" : "recorrido",
      hora: campoHoraEnZona(zona, paso.created_at),
      // Cuánto tardó ESTE paso: desde que terminó el anterior hasta que terminó
      // él. El primero se mide contra el arranque de la corrida.
      duracion: duracionLegible(
        paso.created_at.getTime() - (anterior?.created_at ?? run.started_at).getTime(),
      ),
      nivel: info?.nivel ?? 0,
      motivo: salto !== null ? MOTIVO_SALTO[salto].label : null,
    };
  });

  const viva = run.estado === "corriendo" || run.estado === "esperando";
  if (viva && run.nodo_actual !== null && !ordenados.some((p) => p.nodo_id === run.nodo_actual)) {
    const info = nodos.get(run.nodo_actual);
    salida.push({
      id: `pendiente-${run.nodo_actual}`,
      nombre: info?.nombre ?? run.nodo_actual,
      paso: "pendiente",
      hora: null,
      duracion: null,
      nivel: info?.nivel ?? 0,
      motivo: null,
    });
  }

  return salida;
}

/** Un objeto JSON como líneas legibles. `null` y `{}` dan lista vacía. */
function aLineas(valor: Record<string, unknown> | null): string[] {
  if (valor === null) return [];
  return Object.entries(valor).map(([clave, v]) => `${clave}: ${JSON.stringify(v)}`);
}

/**
 * `zona` es la del negocio (`agente_config.horario_timezone`): la hora de cada
 * paso tiene que coincidir con la que muestra la corrida abierta en el lienzo,
 * que ya usa esa zona. Formatear con la del servidor mostraba el mismo paso con
 * una hora distinta en cada pantalla.
 */
export function aDetalleDeCorrida(
  run: WorkflowRunDetalle,
  grafo: Grafo | undefined,
  ahoraMs: number,
  zona: string,
): DetalleDeCorrida {
  const nodos = grafo ? leerGrafo(grafo) : new Map<string, { nombre: string; nivel: number }>();
  const ordenados = [...run.pasos].sort((a, b) => a.orden - b.orden);
  const fallado = ordenados.find((p) => p.error !== null);
  // Sin paso fallado se muestra el último ejecutado: es lo que estaba pasando
  // cuando la corrida terminó, y es lo que alguien viene a mirar.
  const foco = fallado ?? ordenados.at(-1);
  const salto = saltoDe(run, ordenados, nodos);

  return {
    corrida: aCorridaEnLista(run, ahoraMs),
    version: `v${run.version_numero}${run.version_actual ? "" : " (vieja)"}`,
    cronologia: cronologia(run, ahoraMs),
    pasos: aPasos(run.pasos, nodos, run, zona),
    entrada: aLineas(foco?.entrada ?? null),
    salida:
      run.error !== null && foco?.salida == null
        ? [run.error]
        : [...aLineas(foco?.salida ?? null), ...(run.error !== null ? [run.error] : [])],
    // Reanudar reusa los pasos que salieron bien y sólo repite el que falló:
    // es la diferencia entre reanudar y re-ejecutar, y en un flujo que manda
    // WhatsApp es la diferencia entre uno y dos mensajes al mismo lead.
    pasosMemoizados: ordenados.filter((p) => p.error === null).length,
    ...(salto ? { salto } : {}),
  };
}

/** El paso saltado de una corrida saltada, con su motivo en palabras. */
function saltoDe(
  run: WorkflowRunDetalle,
  ordenados: readonly WorkflowRunPaso[],
  nodos: Map<string, { nombre: string; nivel: number }>,
): DetalleDeCorrida["salto"] {
  if (run.motivo_salto === null) return undefined;
  const paso = [...ordenados].reverse().find((p) => motivoSaltoDeSalida(p.salida) !== null);
  const descriptor = MOTIVO_SALTO[run.motivo_salto];
  return {
    paso: paso ? (nodos.get(paso.nodo_id)?.nombre ?? paso.nodo_id) : "—",
    motivo: descriptor.label,
    explicacion: descriptor.explicacion,
  };
}

function cronologia(run: WorkflowRunDetalle, ahoraMs: number): string {
  const arranque = `arrancó ${esperaLegible(ahoraMs - run.started_at.getTime())}`;
  if (run.ended_at === null) {
    return `${arranque} · sigue abierta en el paso ${run.pasos_ejecutados}`;
  }
  if (finDe(run) === "saltada" && run.motivo_salto !== null) {
    return `${arranque} · el lead salió del flujo tras ${duracionLegible(
      run.ended_at.getTime() - run.started_at.getTime(),
    )}: ${MOTIVO_SALTO[run.motivo_salto].label.toLowerCase()}`;
  }
  const cierre = FIN_POR_ESTADO[run.estado] === "fallada" ? "falló" : "cerró";
  return `${arranque} · ${cierre} tras ${duracionLegible(
    run.ended_at.getTime() - run.started_at.getTime(),
  )} y ${run.pasos_ejecutados} paso${run.pasos_ejecutados === 1 ? "" : "s"}`;
}
