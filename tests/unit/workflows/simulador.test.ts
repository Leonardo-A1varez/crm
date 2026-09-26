import { describe, expect, it } from "vitest";
import { crearRegistro } from "@/server/services/workflows/acciones/registro";
import {
  correrPrueba,
  sesionSimulada,
  simular,
} from "@/server/services/workflows/simulador.service";
import type { Lead } from "@/types/entities";
import type { Grafo, Nodo, NodoTipo } from "@/types/workflows";

function nodo(id: string, tipo: NodoTipo, config: Record<string, unknown> = {}): Nodo {
  return { id, tipo, config, posicion: { x: 0, y: 0 } };
}

/** Ciclo legítimo según el validador —tiene una espera adentro— y aun así no termina nunca. */
const cicloInfinito: Grafo = {
  nodos: [
    nodo("t", "trigger_mensaje"),
    nodo("tag", "crm_etiqueta_add", { tagIds: ["t1"] }),
    nodo("w", "logica_esperar", { duracion: 2, unidad: "dias" }),
  ],
  aristas: [
    { desde: "t", hasta: "tag", puerto: "salida" },
    { desde: "tag", hasta: "w", puerto: "salida" },
    { desde: "w", hasta: "tag", puerto: "salida" },
  ],
};

describe("simular", () => {
  it("detecta el flujo que pasa el validador y no termina nunca", async () => {
    const r = await simular(cicloInfinito, {
      maxPasos: 50,
      desde: new Date("2026-01-01T00:00:00Z"),
    });
    expect(r.desenlace).toBe("tope");
    expect(r.pasos).toHaveLength(50);
  });

  it("el reloj virtual avanza con cada espera", async () => {
    const r = await simular(cicloInfinito, {
      maxPasos: 6,
      desde: new Date("2026-01-01T00:00:00Z"),
    });
    const relojes = r.pasos.map((p) => p.reloj.toISOString());
    expect(relojes[0]).toBe("2026-01-01T00:00:00.000Z");
    // Tras la primera espera de 2 días.
    expect(relojes.at(-1)).not.toBe(relojes[0]);
  });

  // La acción de envío corre con su código de producción: el tope de 3
  // salientes automáticos en 24 h corta el ciclo mucho antes que max_pasos.
  // Es lo que el dueño necesita ver antes de prenderlo.
  it("un ciclo que manda un mensaje por hora choca contra el tope de salientes, igual que en producción", async () => {
    const insistidor: Grafo = {
      nodos: [
        nodo("t", "trigger_mensaje"),
        nodo("m", "msg_texto", { mensaje: "¿Seguís ahí?" }),
        nodo("w", "logica_esperar", { duracion: 1, unidad: "horas" }),
      ],
      aristas: [
        { desde: "t", hasta: "m", puerto: "salida" },
        { desde: "m", hasta: "w", puerto: "salida" },
        { desde: "w", hasta: "m", puerto: "salida" },
      ],
    };
    const r = await simular(insistidor, { maxPasos: 50, desde: new Date("2026-01-01T00:00:00Z") });
    // El cuarto no sale: el tope lo salta, el lead sale del flujo y la
    // prueba termina con ese motivo. No es un fallo (PRD 6.6).
    expect(r.desenlace).toBe("saltado");
    expect(r.salto).toMatchObject({ nodoId: "m", motivo: "tope_frecuencia" });
    expect(r.salientes).toBe(3);
    expect(r.error).toBeUndefined();
  });

  it("un mensaje de texto libre después de 2 días falla por la ventana de 24 h de Meta", async () => {
    const seguimiento: Grafo = {
      nodos: [
        nodo("t", "trigger_mensaje"),
        nodo("m1", "msg_texto", { mensaje: "Gracias por escribir" }),
        nodo("w", "logica_esperar", { duracion: 2, unidad: "dias" }),
        nodo("m2", "msg_texto", { mensaje: "¿Pudiste ver la cotización?" }),
        nodo("fin", "logica_detener"),
      ],
      aristas: [
        { desde: "t", hasta: "m1", puerto: "salida" },
        { desde: "m1", hasta: "w", puerto: "salida" },
        { desde: "w", hasta: "m2", puerto: "salida" },
        { desde: "m2", hasta: "fin", puerto: "salida" },
      ],
    };
    const r = await simular(seguimiento, { maxPasos: 50, desde: new Date("2026-01-01T00:00:00Z") });
    expect(r.desenlace).toBe("saltado");
    expect(r.salto).toMatchObject({ nodoId: "m2", motivo: "sin_ventana" });
    expect(r.salientes).toBe(1);
    // El paso saltado es el ultimo: el detener de despues no corre.
    expect(r.pasos.at(-1)?.nodoId).toBe("m2");
  });

  it("un flujo sano termina en fin", async () => {
    const sano: Grafo = {
      nodos: [nodo("t", "trigger_mensaje"), nodo("f", "logica_detener")],
      aristas: [{ desde: "t", hasta: "f", puerto: "salida" }],
    };
    const r = await simular(sano, { maxPasos: 10, desde: new Date() });
    expect(r.desenlace).toBe("fin");
  });

  it("corre con el registro de producción: un nodo que producción no sabe ejecutar falla igual", async () => {
    const conDocumento: Grafo = {
      nodos: [nodo("t", "trigger_mensaje"), nodo("b", "msg_documento"), nodo("f", "fin")],
      aristas: [
        { desde: "t", hasta: "b", puerto: "salida" },
        { desde: "b", hasta: "f", puerto: "salida" },
      ],
    };
    const r = await simular(conDocumento, { maxPasos: 10, desde: new Date() });
    expect(r.desenlace).toBe("fallado");
    expect(r.error).toContain("msg_documento");
  });

  it("los efectos no salen: quedan interceptados y se informan con el paso que los produjo", async () => {
    const g: Grafo = {
      nodos: [
        nodo("t", "trigger_mensaje"),
        nodo("m", "msg_texto", { mensaje: "Hola" }),
        nodo("tag", "crm_etiqueta_add", { tagIds: ["t1"] }),
        nodo("f", "logica_detener"),
      ],
      aristas: [
        { desde: "t", hasta: "m", puerto: "salida" },
        { desde: "m", hasta: "tag", puerto: "salida" },
        { desde: "tag", hasta: "f", puerto: "salida" },
      ],
    };
    const r = await simular(g, { maxPasos: 10, desde: new Date("2026-01-01T00:00:00Z") });
    expect(r.desenlace).toBe("fin");
    const paso = (id: string) => r.pasos.find((p) => p.nodoId === id);
    expect(paso("m")?.efectos).toEqual([
      expect.objectContaining({
        accion: "enviar_mensaje",
        detalle: expect.objectContaining({ texto: "Hola" }),
      }),
    ]);
    expect(paso("tag")?.efectos).toEqual([
      expect.objectContaining({ accion: "poner_etiqueta", detalle: { tag_id: "t1" } }),
    ]);
    expect(paso("t")?.efectos).toEqual([]);
  });

  // MUST-FIX 2 (review de rama completa): una acción antes de la espera
  // escribe `sesion.tiene_cotizacion` en el contexto; la condición DESPUÉS
  // de la espera lo lee. Si el simulador re-pasa `opciones.contexto` original
  // en vez de `resultado.contexto` en cada vuelta del while, la condición ve
  // el contexto de ANTES de la acción -- distinto de lo que vería producción,
  // que sí persiste `resultado.contexto` en `runs.esperar()`. Ninguna acción
  // real escribe contexto todavía, así que la que lo escribe se inyecta.
  it("una condición después de una espera ve el contexto que escribió la acción de antes", async () => {
    const conCotizacion: Grafo = {
      nodos: [
        nodo("d", "disparador"),
        nodo("cotizar", "accion", { accion: "cotizar" }),
        nodo("w", "espera", { minutos: 60 }),
        nodo("cond", "condicion", {
          campo: "sesion.tiene_cotizacion",
          operador: "es_verdadero",
          valor: null,
        }),
        nodo("con", "fin"),
        nodo("sin", "fin"),
      ],
      aristas: [
        { desde: "d", hasta: "cotizar", puerto: "salida" },
        { desde: "cotizar", hasta: "w", puerto: "salida" },
        { desde: "w", hasta: "cond", puerto: "salida" },
        { desde: "cond", hasta: "con", puerto: "verdadero" },
        { desde: "cond", hasta: "sin", puerto: "falso" },
      ],
    };
    const registro = crearRegistro({
      cotizar: async () => ({
        puerto: "salida" as const,
        contexto: { sesion: { tiene_cotizacion: true } },
      }),
    });
    const r = await simular(conCotizacion, {
      maxPasos: 20,
      desde: new Date("2026-01-01T00:00:00Z"),
      registro,
    });
    expect(r.desenlace).toBe("fin");
    const paso = r.pasos.find((p) => p.nodoId === "cond");
    expect(paso?.salida).toEqual({ cumple: true });
  });

  // Promoted from deferred minor (review de rama completa): un grafo de
  // borrador -- el estado más común mientras se arma en el canvas -- todavía
  // no tiene disparador. Sin este chequeo, `desenlace: "fin"` con 0 pasos es
  // indistinguible de un flujo sano que corrió y terminó bien.
  it("un grafo sin disparador no reporta 'fin' -- desenlace distinto y honesto", async () => {
    const sinDisparador: Grafo = {
      nodos: [nodo("f", "fin")],
      aristas: [],
    };
    const r = await simular(sinDisparador, { maxPasos: 10, desde: new Date() });
    expect(r.desenlace).not.toBe("fin");
    expect(r.desenlace).toBe("sin_disparador");
    expect(r.pasos).toHaveLength(0);
    expect(r.error).toBeTruthy();
  });
});

/**
 * "Probar" con un lead real: la sandbox lee la sesión y la lista de bajas que
 * se le pasan, y el registro de producción salta el mensaje igual que en
 * producción (PRD 6.6).
 */
describe("correrPrueba — topes del lead", () => {
  const DESDE = new Date("2026-01-01T12:00:00Z");
  const LEAD: Lead = {
    id: "lead-real",
    nombre: "Ana",
    nombre_perfil: null,
    telefono: "+593 99 123 4567",
    email: null,
    direccion: null,
    datos_extra: {},
    vehiculo_marca: null,
    vehiculo_modelo: null,
    vehiculo_anio: null,
    vehiculo_motor: null,
    empresa_id: null,
    canal_origen: "wa",
    meta_user_ids: {},
    created_at: DESDE,
    updated_at: DESDE,
  };
  const unMensaje: Grafo = {
    nodos: [
      nodo("t", "trigger_manual"),
      nodo("m", "msg_texto", { mensaje: "hola" }),
      nodo("f", "logica_detener"),
    ],
    aristas: [
      { desde: "t", hasta: "m", puerto: "salida" },
      { desde: "m", hasta: "f", puerto: "salida" },
    ],
  };

  it("requiere_humano: la sesión real del lead en requiere_humano salta el mensaje", async () => {
    const r = await correrPrueba({
      grafo: unMensaje,
      maxPasos: 10,
      desde: DESDE,
      contexto: {},
      lead: LEAD,
      sesion: { ...sesionSimulada(LEAD.id, DESDE), current_stage: "requiere_humano" },
      runId: "prueba",
    });
    expect(r.desenlace).toBe("saltado");
    expect(r.salto).toMatchObject({ nodoId: "m", motivo: "requiere_humano" });
    expect(r.salientes).toBe(0);
    expect(r.pasos.map((p) => p.nodoId)).toEqual(["t", "m"]);
    expect(r.pasos[1]?.salida).toMatchObject({ motivo_salto: "requiere_humano" });
  });

  it("dado_de_baja: un teléfono en la lista de bajas salta el mensaje", async () => {
    const r = await correrPrueba({
      grafo: unMensaje,
      maxPasos: 10,
      desde: DESDE,
      contexto: {},
      lead: LEAD,
      sesion: sesionSimulada(LEAD.id, DESDE),
      runId: "prueba",
      supresiones: {
        activasPorTelefonos: async (tels) =>
          tels.includes("593991234567")
            ? [
                {
                  id: "b1",
                  telefono: "593991234567",
                  clave_version: 1,
                  origen: "manual" as const,
                  detalle: null,
                  lead_id: null,
                  difusion_id: null,
                  registrada_por: null,
                  created_at: DESDE,
                  reactivada_at: null,
                  reactivada_por: null,
                  reactivacion_motivo: null,
                },
              ]
            : [],
      },
    });
    expect(r.desenlace).toBe("saltado");
    expect(r.salto?.motivo).toBe("dado_de_baja");
    expect(r.salientes).toBe(0);
  });

  it("sin lista de bajas, la prueba asume que nadie se dio de baja y manda", async () => {
    const r = await correrPrueba({
      grafo: unMensaje,
      maxPasos: 10,
      desde: DESDE,
      contexto: {},
      lead: LEAD,
      sesion: sesionSimulada(LEAD.id, DESDE),
      runId: "prueba",
    });
    expect(r.desenlace).toBe("fin");
    expect(r.salientes).toBe(1);
  });
});
