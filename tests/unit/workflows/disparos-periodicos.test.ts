import { describe, expect, test } from "vitest";
import {
  disparosProgramados,
  programadosVencidos,
  type WorkflowProgramadosDeps,
} from "@/inngest/functions/workflow-programados";
import {
  disparosPorInactividad,
  type WorkflowInactividadDeps,
} from "@/inngest/functions/workflow-inactividad";
import type { Conversacion, Lead, LeadSession, Mensaje, WorkflowVersion } from "@/types/entities";
import type { Grafo, NodoTipo } from "@/types/workflows";

// Lunes 2026-09-14, 09:02 en Ciudad de México (UTC-6).
const AHORA = new Date("2026-09-14T15:02:00Z");

function grafo(tipo: NodoTipo, config: Record<string, unknown>): Grafo {
  return {
    nodos: [
      { id: "t", tipo, config, posicion: { x: 0, y: 0 } },
      { id: "fin", tipo: "logica_detener", config: {}, posicion: { x: 0, y: 0 } },
    ],
    aristas: [{ desde: "t", hasta: "fin", puerto: "salida" }],
  };
}

function version(workflowId: string, g: Grafo, creada = new Date("2026-09-01T00:00:00Z")) {
  return {
    id: `v-${workflowId}`,
    workflow_id: workflowId,
    version: 1,
    grafo: g,
    max_pasos: 500,
    publicada: true,
    created_at: creada,
    created_by: null,
    politica_concurrencia: "ignorar",
  } as WorkflowVersion;
}

function lead(id: string, nombre = "Ana"): Lead {
  return { id, nombre, canal_origen: "wa" } as Lead;
}

function sesion(id: string, leadId: string, extra: Partial<LeadSession> = {}): LeadSession {
  return {
    id,
    lead_id: leadId,
    current_stage: "cotizado",
    producto_cotizado_id: null,
    precio_cotizado: null,
    resultado: null,
    closed_at: null,
    ...extra,
  } as LeadSession;
}

describe("workflow-programados", () => {
  function deps(versiones: WorkflowVersion[]): WorkflowProgramadosDeps {
    return {
      workflows: { listarPublicadasPorDisparador: async () => versiones },
      sessions: {
        listActive: async () => [sesion("s-activa", "l-1")],
        listClosedBefore: async () => [
          sesion("s-vieja", "l-1", {
            resultado: "perdido",
            current_stage: "perdido",
            closed_at: new Date("2026-09-01T00:00:00Z"),
          }),
          sesion("s-perdida-1", "l-2", {
            resultado: "perdido",
            current_stage: "perdido",
            closed_at: new Date("2026-09-02T00:00:00Z"),
          }),
          sesion("s-perdida-2", "l-2", {
            resultado: "exito",
            current_stage: "cerrado",
            closed_at: new Date("2026-09-10T00:00:00Z"),
          }),
        ],
      },
      leads: { listByIds: async (ids) => ids.map((id) => lead(id)) },
    };
  }

  test("sólo vence el flujo cuya hora local cayó en la ventana", async () => {
    const r = await programadosVencidos(
      AHORA,
      deps([
        version("w-9", grafo("trigger_cron", { hora: "09:00" })),
        version("w-10", grafo("trigger_cron", { hora: "10:00" })),
      ]),
    );
    expect(r).toEqual({
      vencidos: [{ workflowId: "w-9", franja: "2026-09-14T09:00" }],
      errores: [],
    });
  });

  test("una franja anterior a la versión publicada no dispara", async () => {
    const r = await programadosVencidos(
      AHORA,
      deps([
        version("w-9", grafo("trigger_cron", { hora: "09:00" }), new Date("2026-09-14T15:01:00Z")),
      ]),
    );
    expect(r.vencidos).toEqual([]);
  });

  test("un horario imposible no dispara y queda en los errores, con el flujo", async () => {
    const r = await programadosVencidos(
      AHORA,
      deps([version("w-mal", grafo("trigger_cron", { frecuencia: "semanal", dias: [] }))]),
    );
    expect(r.vencidos).toEqual([]);
    expect(r.errores).toEqual([{ workflowId: "w-mal", error: expect.stringContaining("día") }]);
  });

  test("un disparo por lead, con su sesión más reciente y la clave de la franja", async () => {
    const disparos = await disparosProgramados(
      { workflowId: "w-9", franja: "2026-09-14T09:00" },
      AHORA,
      deps([]),
    );
    expect(disparos).toEqual([
      {
        id: "workflow-disparo:programado:w-9:2026-09-14T09:00:l-1",
        data: {
          disparador: "programado",
          workflowId: "w-9",
          leadId: "l-1",
          // La activa gana sobre cualquier cerrada.
          leadSessionId: "s-activa",
          contexto: {
            lead: { etapa: "cotizado", nombre: "Ana", canal: "wa" },
            sesion: { tiene_cotizacion: false },
          },
        },
      },
      {
        id: "workflow-disparo:programado:w-9:2026-09-14T09:00:l-2",
        data: {
          disparador: "programado",
          workflowId: "w-9",
          leadId: "l-2",
          // Sin sesión activa: la corrida no toma una cerrada, pero el contexto
          // dice cómo terminó la última (así "Reactivar perdidos" puede filtrar).
          contexto: {
            lead: { etapa: "cerrado", nombre: "Ana", canal: "wa" },
            sesion: { tiene_cotizacion: false },
          },
        },
      },
    ]);
  });
});

describe("workflow-inactividad", () => {
  const HORA = 60 * 60_000;

  function mensaje(direction: "in" | "out"): Mensaje {
    return { id: `m-${direction}`, direction } as Mensaje;
  }

  function deps(opciones: {
    versiones: WorkflowVersion[];
    ultimoEntrante: Date | null;
    ultimo: "in" | "out";
  }): WorkflowInactividadDeps {
    return {
      workflows: { listarPublicadasPorDisparador: async () => opciones.versiones },
      sessions: { listActive: async () => [sesion("s-1", "l-1")] },
      conversations: {
        listByLeadIds: async () => [
          {
            id: "c-1",
            lead_id: "l-1",
            canal: "wa",
            canal_thread_id: "x",
            ultima_actividad_at: AHORA,
          } as Conversacion,
        ],
      },
      messages: {
        listByConversacion: async () => [mensaje(opciones.ultimo)],
        findUltimoEntranteAt: async () => opciones.ultimoEntrante,
      },
      leads: { listByIds: async (ids) => ids.map((id) => lead(id)) },
    };
  }

  const inactividad24h = version("w-i", grafo("trigger_inactividad", {}));

  test("el lead calla 24 h y la última palabra fue nuestra: dispara una vez por silencio", async () => {
    const ultimoEntrante = new Date(AHORA.getTime() - 25 * HORA);
    const r = await disparosPorInactividad(
      AHORA,
      deps({ versiones: [inactividad24h], ultimoEntrante, ultimo: "out" }),
    );
    expect(r.disparos).toEqual([
      {
        // El silencio se identifica por el último mensaje del lead: los
        // mensajes que mande el propio flujo no abren un silencio nuevo.
        id: `workflow-disparo:inactividad:w-i:s-1:${ultimoEntrante.toISOString()}`,
        data: {
          disparador: "inactividad",
          workflowId: "w-i",
          leadId: "l-1",
          leadSessionId: "s-1",
          contexto: {
            lead: { etapa: "cotizado", nombre: "Ana", canal: "wa" },
            sesion: { tiene_cotizacion: false, respondio: false },
          },
        },
      },
    ]);
  });

  test("todavía no pasó el tiempo: no dispara", async () => {
    const r = await disparosPorInactividad(
      AHORA,
      deps({
        versiones: [inactividad24h],
        ultimoEntrante: new Date(AHORA.getTime() - 23 * HORA),
        ultimo: "out",
      }),
    );
    expect(r.disparos).toEqual([]);
  });

  test("un silencio viejo, fuera de la ventana, no se dispara al publicar el flujo", async () => {
    const r = await disparosPorInactividad(
      AHORA,
      deps({
        versiones: [inactividad24h],
        ultimoEntrante: new Date(AHORA.getTime() - 30 * HORA),
        ultimo: "out",
      }),
    );
    expect(r.disparos).toEqual([]);
  });

  test("si el último mensaje es del lead, el que debe la respuesta somos nosotros: no dispara", async () => {
    const r = await disparosPorInactividad(
      AHORA,
      deps({
        versiones: [inactividad24h],
        ultimoEntrante: new Date(AHORA.getTime() - 25 * HORA),
        ultimo: "in",
      }),
    );
    expect(r.disparos).toEqual([]);
  });

  test("la unidad y la duración del trigger mandan", async () => {
    const treintaMin = version(
      "w-30",
      grafo("trigger_inactividad", { duracion: 30, unidad: "minutos" }),
    );
    const r = await disparosPorInactividad(
      AHORA,
      deps({
        versiones: [treintaMin],
        ultimoEntrante: new Date(AHORA.getTime() - 40 * 60_000),
        ultimo: "out",
      }),
    );
    expect(r.disparos.map((d) => d.data.workflowId)).toEqual(["w-30"]);
  });

  test("sin flujos de inactividad publicados no lee ninguna conversación", async () => {
    let leyo = false;
    const d = deps({ versiones: [], ultimoEntrante: null, ultimo: "out" });
    d.sessions.listActive = async () => {
      leyo = true;
      return [];
    };
    const r = await disparosPorInactividad(AHORA, d);
    expect(r.disparos).toEqual([]);
    expect(leyo).toBe(false);
  });

  test("una config inválida no dispara y queda en los errores", async () => {
    const mal = version("w-mal", grafo("trigger_inactividad", { duracion: -1 }));
    const r = await disparosPorInactividad(
      AHORA,
      deps({ versiones: [mal], ultimoEntrante: new Date(0), ultimo: "out" }),
    );
    expect(r.disparos).toEqual([]);
    expect(r.errores).toEqual([{ workflowId: "w-mal", error: expect.any(String) }]);
  });
});
