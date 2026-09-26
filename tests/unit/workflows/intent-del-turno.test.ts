import { describe, expect, it } from "vitest";
import type { Grupo } from "@/lib/ui/condiciones";
import { crearRegistro } from "@/server/services/workflows/acciones/registro";
import {
  ejecutarSegmento,
  type EjecutorDeps,
  type PasoEjecutado,
} from "@/server/services/workflows/ejecutor.service";
import type { ContextoRun, Grafo } from "@/types/workflows";

/**
 * La carrera del intent: el disparo de "Mensaje recibido" sale mientras el
 * turno todavía no quedó escrito en `turn_classifications`/`rule_executions`
 * (eso pasa después de que contesta el agente). Leída de la base, la condición
 * "Intent detectado" ve el turno ANTERIOR. El disparo trae el intent de su
 * propio turno con la hora del mensaje, y gana el más nuevo de los dos.
 *
 * Ids y fechas armados a mano para el test: no salen de ningún dato real.
 */

const PRECIO = "intent-precio";
const SALUDO = "intent-saludo";

function grafo(arbol: Grupo): Grafo {
  return {
    nodos: [
      { id: "t", tipo: "trigger_manual", config: {}, posicion: { x: 0, y: 0 } },
      { id: "c", tipo: "logica_condicion", config: { arbol }, posicion: { x: 0, y: 1 } },
      { id: "si", tipo: "fin", config: {}, posicion: { x: 0, y: 2 } },
      { id: "no", tipo: "fin", config: {}, posicion: { x: 1, y: 2 } },
    ],
    aristas: [
      { desde: "t", hasta: "c", puerto: "salida" },
      { desde: "c", hasta: "si", puerto: "verdadero" },
      { desde: "c", hasta: "no", puerto: "falso" },
    ],
  };
}

const INTENT_ES_PRECIO: Grupo = {
  id: "g",
  clase: "grupo",
  operador: "y",
  hijos: [
    {
      id: "r",
      clase: "regla",
      campoId: "sesion.intent",
      comparador: "es",
      valor: { tipo: "opcion", valor: PRECIO },
    },
  ],
};

async function rama(contexto: ContextoRun, vivos: ContextoRun): Promise<string | undefined> {
  const pasos: PasoEjecutado[] = [];
  const deps: EjecutorDeps = {
    registro: crearRegistro({}),
    ahora: () => new Date("2026-09-25T15:00:00Z"),
    onPaso: async (p) => {
      pasos.push(p);
    },
    camposVivos: { cargar: async () => structuredClone(vivos), zona: async () => "UTC" },
  };
  await ejecutarSegmento(
    {
      grafo: grafo(INTENT_ES_PRECIO),
      desdeNodo: "t",
      contexto,
      leadId: "lead-1",
      leadSessionId: "sesion-1",
      runId: "run-1",
      pasosPrevios: 0,
      maxPasos: 50,
    },
    deps,
  );
  return pasos.at(-1)?.nodoId;
}

describe("intent del turno contra el leído de la base", () => {
  it("el del disparo gana si la base todavía tiene el turno anterior", async () => {
    const desdeElDisparo = {
      sesion: { intent: PRECIO, intent_mensaje_at: "2026-09-25T14:59:50.000Z" },
    };
    const turnoAnterior = {
      sesion: { intent: SALUDO, intent_mensaje_at: "2026-09-25T14:50:00.000Z" },
    };
    expect(await rama(desdeElDisparo, turnoAnterior)).toBe("si");
  });

  it("el del disparo gana si la base no tiene ningún turno clasificado", async () => {
    const desdeElDisparo = {
      sesion: { intent: PRECIO, intent_mensaje_at: "2026-09-25T14:59:50.000Z" },
    };
    expect(await rama(desdeElDisparo, { sesion: { intent: null } })).toBe("si");
  });

  it("un turno sin intent en el disparo no cae al intent del turno anterior", async () => {
    const sinIntent = { sesion: { intent: null, intent_mensaje_at: "2026-09-25T14:59:50.000Z" } };
    const turnoAnterior = {
      sesion: { intent: PRECIO, intent_mensaje_at: "2026-09-25T14:50:00.000Z" },
    };
    expect(await rama(sinIntent, turnoAnterior)).toBe("no");
  });

  it("después de una espera, un turno más nuevo en la base gana al del disparo", async () => {
    const delDisparo = {
      sesion: { intent: SALUDO, intent_mensaje_at: "2026-09-23T10:00:00.000Z" },
    };
    const turnoNuevo = {
      sesion: { intent: PRECIO, intent_mensaje_at: "2026-09-25T14:00:00.000Z" },
    };
    expect(await rama(delDisparo, turnoNuevo)).toBe("si");
  });

  it("sin intent en el disparo (Probar, otros disparadores) manda la base, como antes", async () => {
    const turno = { sesion: { intent: PRECIO, intent_mensaje_at: "2026-09-25T14:00:00.000Z" } };
    expect(await rama({ sesion: { respondio: true } }, turno)).toBe("si");
  });
});
