import { esperaLegible } from "@/lib/triage";
import { iconoDeTipo, nombreDeTipo } from "../[id]/_lib/presentacion-nodos";
import { ESTADOS_WORKFLOW } from "@/lib/ui/workflow-estado";
import type { FiltroEstado, FlujoEnLista } from "@/components/workflows/lista/tipos";
import type { UUID, WorkflowResumen } from "@/types/entities";

/**
 * Traducción `WorkflowResumen` (dominio) → `FlujoEnLista` (lo que la pantalla
 * dibuja).
 *
 * Vive en `app/**` y no en `lib/**` porque el tipo de destino es de
 * `components/**`, y los boundaries de ESLint no dejan que `lib` importe
 * componentes. La página es la capa que puede ver las dos orillas.
 *
 * Todo lo que depende del reloj se resuelve acá, en el servidor, y viaja como
 * texto. Es una exigencia del componente, no un gusto: `WorkflowCard` —la
 * tarjeta vieja— llama a `Date.now()` dentro del render, así que el servidor
 * pinta "hace 3m", el cliente hidrata un segundo después y puede pintar
 * "hace 4m". `FlujoEnLista` cierra esa puerta pidiendo el texto ya hecho.
 */
export function aFlujoEnLista(
  resumen: WorkflowResumen,
  ahoraMs: number,
  corridasEnCurso: number,
): FlujoEnLista {
  const { workflow, estado, resumenPasos, metricas, disparadorTipo } = resumen;

  return {
    id: workflow.id,
    nombre: workflow.nombre,
    estado,
    resumen: resumenPasos.length > 0 ? resumenPasos.join(" → ") : "Todavía no tiene pasos.",
    corridas30d: metricas.totalRuns,
    exitosas30d: metricas.runsExitosos,
    ultimaEjecucion:
      metricas.ultimoRun !== null ? esperaLegible(ahoraMs - metricas.ultimoRun.at.getTime()) : null,
    corridasEnCurso,
    disparador: disparadorTipo
      ? { nombre: nombreDeTipo(disparadorTipo), icono: iconoDeTipo(disparadorTipo) }
      : null,
    disparaAMano: resumen.disparoManualPublicado,
  };
}

/**
 * Cuántos flujos hay en cada estado, **sobre la lista sin filtrar**.
 *
 * Es lo que le da número a los chips, y por eso no puede calcularse sobre los
 * flujos ya filtrados: el chip "Con errores 2" tiene que seguir diciendo 2
 * mientras se está mirando el filtro "Activo".
 *
 * Las claves salen de `ESTADOS_WORKFLOW` en vez de escribirse a mano. Cuando el
 * estado pasó de cuatro valores a cinco, la lista escrita a mano de
 * `filtros-workflows` quedó desfasada en silencio; derivarla es lo que hace
 * imposible que vuelva a pasar.
 */
export function conteosPorEstado(items: readonly WorkflowResumen[]): Record<FiltroEstado, number> {
  const conteos = { todos: items.length } as Record<FiltroEstado, number>;
  for (const estado of ESTADOS_WORKFLOW) conteos[estado] = 0;
  for (const item of items) conteos[item.estado] += 1;
  return conteos;
}

/** Corridas de los últimos 30 días sumadas sobre toda la instalación. */
export function totalCorridas30d(items: readonly WorkflowResumen[]): number {
  return items.reduce((total, item) => total + item.metricas.totalRuns, 0);
}

/**
 * De qué flujos hace falta contar las corridas vivas.
 *
 * Sólo de los pausados, y no por ahorrar: la tarjeta usa ese número en un solo
 * lugar —la nota de pausa, que promete que lo que ya está corriendo termina— y
 * contar los otros serían dos consultas por flujo para un dato que nadie
 * muestra. En un flujo no pausado el número se pasa en 0 y jamás se lee.
 */
export function flujosQueNecesitanConteoVivo(items: readonly WorkflowResumen[]): UUID[] {
  return items.filter((i) => i.estado === "pausado").map((i) => i.workflow.id);
}

/**
 * El segmento de `/workflows/nuevo/[plantilla]` que significa "sin plantilla".
 *
 * Es una constante y no un string suelto porque lo comparan dos archivos —la
 * galería, que arma el link, y el formulario, que decide si hay plantilla que
 * mostrar— y dos copias de un string mágico divergen. No colisiona con ninguno
 * de los seis ids de `PLANTILLAS`.
 */
export const EN_BLANCO = "en-blanco";
