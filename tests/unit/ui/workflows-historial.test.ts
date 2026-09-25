import { describe, expect, it } from "vitest";
import {
  aCorridaEnLista,
  aDetalleDeCorrida,
  duracionLegible,
} from "@/app/(panel)/workflows/_lib/historial";
import type { WorkflowRunConLead, WorkflowRunDetalle, WorkflowRunPaso } from "@/types/entities";
import type { Grafo } from "@/types/workflows";

/**
 * La traducción de una corrida de `workflow_runs` a lo que dibuja el historial.
 *
 * El test que importa es el de la sangría. La primera versión ponía `nivel` =
 * saltos desde el disparador, y se vio en pantalla: en un flujo lineal de tres
 * nodos las cajas del "camino recorrido" salían a x=782, 807 y 834 — una
 * escalera que en un flujo largo se va del panel. `PasoDeCorrida.nivel`
 * significa otra cosa, y está escrito en su propio tipo: la sangría cuando el
 * paso cuelga de una condición.
 */

const ARRANQUE = new Date("2026-09-04T12:00:00Z");
const AHORA = new Date("2026-09-04T12:05:00Z").getTime();
const ZONA = "UTC";

function paso(
  nodoId: string,
  orden: number,
  segundos: number,
  error: string | null = null,
): WorkflowRunPaso {
  return {
    id: `paso-${orden}`,
    run_id: "run-1",
    nodo_id: nodoId,
    orden,
    entrada: null,
    salida: null,
    error,
    created_at: new Date(ARRANQUE.getTime() + segundos * 1000),
  };
}

function run(over: Partial<WorkflowRunDetalle> = {}): WorkflowRunDetalle {
  return {
    id: "e259e4d7-f8ff-4781-bcff-352384357cac",
    workflow_version_id: "v-1",
    lead_id: "lead-1",
    lead_session_id: null,
    estado: "terminado",
    nodo_actual: null,
    contexto: {},
    pasos_ejecutados: 3,
    error: null,
    started_at: ARRANQUE,
    ended_at: new Date(ARRANQUE.getTime() + 18_000),
    motivo_salto: null,
    lead_nombre: "Leonardo Alvarez",
    trigger_tipo: "manual",
    trigger_datos: {},
    duracion_ms: 18_000,
    pasos: [],
    version_numero: 1,
    version_actual: true,
    ...over,
  };
}

/** Disparador → acción → fin. Todo tronco: ninguna bifurcación. */
const GRAFO_LINEAL: Grafo = {
  nodos: [
    { id: "n1", tipo: "disparador", config: {}, posicion: { x: 0, y: 0 } },
    { id: "n2", tipo: "accion", config: {}, posicion: { x: 0, y: 100 } },
    { id: "n3", tipo: "fin", config: {}, posicion: { x: 0, y: 200 } },
  ],
  aristas: [
    { desde: "n1", hasta: "n2", puerto: "salida" },
    { desde: "n2", hasta: "n3", puerto: "salida" },
  ],
};

/** Disparador → condición, y de la condición cuelgan las dos ramas. */
const GRAFO_CON_RAMA: Grafo = {
  nodos: [
    { id: "n1", tipo: "disparador", config: {}, posicion: { x: 0, y: 0 } },
    { id: "n2", tipo: "condicion", config: {}, posicion: { x: 0, y: 100 } },
    { id: "n3", tipo: "accion", config: {}, posicion: { x: -100, y: 200 } },
    { id: "n4", tipo: "fin", config: {}, posicion: { x: 100, y: 200 } },
  ],
  aristas: [
    { desde: "n1", hasta: "n2", puerto: "salida" },
    { desde: "n2", hasta: "n3", puerto: "verdadero" },
    { desde: "n2", hasta: "n4", puerto: "falso" },
  ],
};

describe("aDetalleDeCorrida — sangría de los pasos", () => {
  it("deja todo en el tronco cuando el flujo es lineal", () => {
    const detalle = aDetalleDeCorrida(
      run({ pasos: [paso("n1", 1, 2), paso("n2", 2, 10), paso("n3", 3, 11)] }),
      GRAFO_LINEAL,
      AHORA,
      ZONA,
    );

    expect(detalle.pasos.map((p) => p.nivel)).toEqual([0, 0, 0]);
    expect(detalle.pasos.map((p) => p.nombre)).toEqual(["Disparador", "Acción", "Fin"]);
  });

  it("sangra un nivel a lo que cuelga de una condición", () => {
    const detalle = aDetalleDeCorrida(
      run({ pasos: [paso("n1", 1, 1), paso("n2", 2, 2), paso("n3", 3, 3)] }),
      GRAFO_CON_RAMA,
      AHORA,
      ZONA,
    );

    // disparador y condición son tronco; la rama `verdadero` va sangrada.
    expect(detalle.pasos.map((p) => ({ nombre: p.nombre, nivel: p.nivel }))).toEqual([
      { nombre: "Disparador", nivel: 0 },
      { nombre: "Condición", nivel: 0 },
      { nombre: "Acción", nivel: 1 },
    ]);
  });

  /**
   * Sin el grafo de la versión, `workflow_run_pasos` sólo tiene `nodo_id`: la
   * línea de tiempo mostraría identificadores crudos. Que degrade a eso en vez
   * de romperse es intencional — una versión borrada no puede tumbar la
   * pantalla del historial.
   */
  it("cae al id del nodo cuando no hay grafo de esa versión", () => {
    const detalle = aDetalleDeCorrida(run({ pasos: [paso("n1", 1, 1)] }), undefined, AHORA, ZONA);
    expect(detalle.pasos[0]?.nombre).toBe("n1");
  });
});

describe("aDetalleDeCorrida — reanudar", () => {
  /**
   * Reanudar reusa los pasos que salieron bien y repite sólo el que falló. En
   * un flujo que manda WhatsApp es la diferencia entre uno y dos mensajes al
   * mismo lead, así que el número que se muestra tiene que ser exacto.
   */
  it("cuenta como memoizados sólo los pasos sin error", () => {
    const detalle = aDetalleDeCorrida(
      run({
        estado: "fallado",
        error: "La plantilla está pausada",
        pasos: [paso("n1", 1, 1), paso("n2", 2, 2), paso("n3", 3, 3, "La plantilla está pausada")],
      }),
      GRAFO_LINEAL,
      AHORA,
      ZONA,
    );

    expect(detalle.pasosMemoizados).toBe(2);
    expect(detalle.pasos.map((p) => p.paso)).toEqual(["recorrido", "recorrido", "fallado"]);
    expect(detalle.salida).toContain("La plantilla está pausada");
  });

  it("agrega el nodo donde quedó frenada una corrida viva, como pendiente", () => {
    const detalle = aDetalleDeCorrida(
      run({
        estado: "esperando",
        ended_at: null,
        duracion_ms: null,
        nodo_actual: "n3",
        pasos: [paso("n1", 1, 1), paso("n2", 2, 2)],
      }),
      GRAFO_LINEAL,
      AHORA,
      ZONA,
    );

    expect(detalle.pasos.at(-1)).toMatchObject({ nombre: "Fin", paso: "pendiente", hora: null });
    expect(detalle.cronologia).toContain("sigue abierta");
  });
});

describe("aCorridaEnLista", () => {
  it("no inventa un código de error a partir del mensaje", () => {
    const base = run({ estado: "fallado", error: "Se alcanzó el tope de 50 pasos" });
    const { pasos: _pasos, version_numero: _v, version_actual: _va, ...conLead } = base;
    const fila = aCorridaEnLista(conLead as WorkflowRunConLead, AHORA);

    expect(fila.fin).toBe("fallada");
    expect(fila.codigoError).toBeNull();
    expect(fila.codigo).toBe("#e259");
  });
});

describe("duracionLegible", () => {
  it("usa la unidad que el número necesita", () => {
    expect(duracionLegible(null)).toBe("—");
    expect(duracionLegible(216)).toBe("216 ms");
    expect(duracionLegible(18_000)).toBe("18 s");
    expect(duracionLegible(120_000)).toBe("2 m");
    expect(duracionLegible(200_000)).toBe("3 m 20 s");
  });
});

/**
 * PRD 6.6: una corrida que un tope cortó terminó bien -- el flujo protegió al
 * lead -- y el historial no puede pintarla como un fallo.
 */
describe("corrida saltada por un tope de seguridad", () => {
  const saltada = () =>
    run({
      motivo_salto: "tope_frecuencia",
      pasos_ejecutados: 2,
      pasos: [
        paso("n1", 1, 1),
        {
          ...paso("n2", 2, 2),
          salida: { saltado: true, motivo_salto: "tope_frecuencia", detalle_salto: "tope de 3" },
        },
      ],
    });

  it("en la lista es 'saltada', no 'terminada' ni 'fallada'", () => {
    expect(aCorridaEnLista(saltada(), AHORA).fin).toBe("saltada");
  });

  it("el paso saltado sale como 'saltado' con el motivo en palabras", () => {
    const d = aDetalleDeCorrida(saltada(), GRAFO_LINEAL, AHORA, ZONA);
    const ultimo = d.pasos.at(-1);
    expect(ultimo?.paso).toBe("saltado");
    expect(ultimo?.motivo).toMatch(/tope de mensajes/i);
    expect(d.pasos.some((p) => p.paso === "fallado")).toBe(false);
  });

  it("la cronología dice que el lead salió del flujo", () => {
    const d = aDetalleDeCorrida(saltada(), GRAFO_LINEAL, AHORA, ZONA);
    expect(d.cronologia).toMatch(/sali[oó] del flujo/i);
  });
});

describe("aDetalleDeCorrida — la hora de cada paso", () => {
  /**
   * El historial formateaba en la zona del servidor y la corrida abierta en el
   * lienzo en la del negocio: el mismo paso salía con una hora distinta en cada
   * pantalla. Dos zonas que no pueden ser a la vez la del
   * servidor prueban que la hora sale de la zona pedida y no del proceso.
   */
  it("formatea en la zona del negocio, no en la del servidor", () => {
    // 12:00:10Z. Buenos Aires es UTC-3 todo el año; Tokio, UTC+9.
    const corrida = run({ pasos: [paso("n1", 1, 10)] });

    const enBuenosAires = aDetalleDeCorrida(
      corrida,
      GRAFO_LINEAL,
      AHORA,
      "America/Argentina/Buenos_Aires",
    );
    const enTokio = aDetalleDeCorrida(corrida, GRAFO_LINEAL, AHORA, "Asia/Tokyo");

    expect(enBuenosAires.pasos[0]?.hora).toBe("09:00");
    expect(enTokio.pasos[0]?.hora).toBe("21:00");
  });

  it("con una zona que no existe muestra UTC antes que inventar una hora", () => {
    const d = aDetalleDeCorrida(
      run({ pasos: [paso("n1", 1, 10)] }),
      GRAFO_LINEAL,
      AHORA,
      "No/Existe",
    );
    expect(d.pasos[0]?.hora).toBe("12:00");
  });
});
