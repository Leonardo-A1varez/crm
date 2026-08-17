import { describe, expect, test } from "vitest";
import { InMemoryMetricsRepository } from "@/server/repositories/metrics.repo";
import { DefaultMetricsService } from "@/server/services/metricas/default-metricas.service";
import { WORKFLOW_LLM } from "@/types/domain";
import type {
  FilaIntentMetrica,
  FilaLlmUsageMetrica,
  FilaMensajeMetrica,
  FilaSesionMetrica,
  FilaUsuarioMetrica,
  MetricsFixture,
} from "@/server/repositories/metrics.repo";

const AHORA = new Date("2026-08-10T12:00:00.000Z");

function haceDias(d: number): Date {
  return new Date(AHORA.getTime() - d * 24 * 60 * 60 * 1000);
}

function svc(fixture: MetricsFixture = {}) {
  return new DefaultMetricsService({ metrics: new InMemoryMetricsRepository(fixture) });
}

function intent(over: Partial<FilaIntentMetrica> = {}): FilaIntentMetrica {
  return {
    id: "i1",
    nombre: "consulta_precio",
    descripcion: "Pregunta cuánto sale un repuesto",
    auto_detectado: false,
    created_at: haceDias(3),
    ...over,
  };
}

let seq = 0;
function sesion(over: Partial<FilaSesionMetrica> = {}): FilaSesionMetrica {
  seq++;
  return {
    id: `s${seq}`,
    current_stage: "identificando",
    resultado: null,
    motivo_perdida: null,
    started_at: haceDias(1),
    precio_cotizado: null,
    codigo_interno: null,
    closed_at: null,
    cantidad: null,
    ...over,
  };
}

function mensaje(over: Partial<FilaMensajeMetrica> = {}): FilaMensajeMetrica {
  const createdAt = over.created_at ?? haceDias(1);
  return {
    sender: "lead",
    created_at: createdAt,
    platform_created_at: "platform_created_at" in over ? over.platform_created_at : createdAt,
    canal: "wa",
    lead_session_id: "s1",
    sender_user_id: null,
    ...over,
  };
}

function usuario(over: Partial<FilaUsuarioMetrica> = {}): FilaUsuarioMetrica {
  return { id: "u1", nombre: "Ana", ...over };
}

describe("DefaultMetricsService.obtener", () => {
  test("sin datos devuelve las 6 etapas del embudo en cero", async () => {
    const m = await svc().obtener(haceDias(30), AHORA);

    expect(m.totalSesiones).toBe(0);
    expect(m.embudo).toHaveLength(6);
    expect(m.embudo.every((e) => e.cantidad === 0)).toBe(true);
    expect(m.resultado).toEqual({ abiertas: 0, exito: 0, perdido: 0, porMotivo: [] });
  });

  test("la ventana recorta: lo anterior a `desde` no se cuenta", async () => {
    const m = await svc({
      sesiones: [sesion({ started_at: haceDias(5) }), sesion({ started_at: haceDias(40) })],
    }).obtener(haceDias(30), AHORA);

    expect(m.totalSesiones).toBe(1);
    expect(m.desde).toEqual(haceDias(30));
  });

  test("los desvíos se cuentan aparte del embudo", async () => {
    const m = await svc({
      sesiones: [
        sesion({ current_stage: "cotizado" }),
        sesion({ current_stage: "requiere_humano" }),
        sesion({ current_stage: "perdido" }),
      ],
    }).obtener(haceDias(30), AHORA);

    expect(m.embudo.find((e) => e.stage === "cotizado")?.cantidad).toBe(1);
    expect(m.embudo.map((e) => e.stage)).not.toContain("perdido");
    expect(m.desvios.find((d) => d.stage === "requiere_humano")?.cantidad).toBe(1);
    expect(m.desvios.find((d) => d.stage === "perdido")?.cantidad).toBe(1);
  });

  test("abiertas es el resto: ni éxito ni perdido", async () => {
    const m = await svc({
      sesiones: [
        sesion({ resultado: "exito" }),
        sesion({ resultado: "perdido", motivo_perdida: "precio" }),
        sesion(),
        sesion(),
      ],
    }).obtener(haceDias(30), AHORA);

    expect(m.resultado).toMatchObject({ exito: 1, perdido: 1, abiertas: 2 });
  });

  test("una perdida sin motivo no se inventa como 'otro'", async () => {
    const m = await svc({
      sesiones: [sesion({ resultado: "perdido", motivo_perdida: null })],
    }).obtener(haceDias(30), AHORA);

    expect(m.resultado.porMotivo).toEqual([{ motivo: "Sin motivo registrado", cantidad: 1 }]);
  });

  test("los motivos salen ordenados por cantidad", async () => {
    const m = await svc({
      sesiones: [
        sesion({ resultado: "perdido", motivo_perdida: "stock" }),
        sesion({ resultado: "perdido", motivo_perdida: "precio" }),
        sesion({ resultado: "perdido", motivo_perdida: "precio" }),
      ],
    }).obtener(haceDias(30), AHORA);

    expect(m.resultado.porMotivo).toEqual([
      { motivo: "Precio", cantidad: 2 },
      { motivo: "Sin stock", cantidad: 1 },
    ]);
  });

  test("la autoría cuenta los 4 remitentes y arranca en cero", async () => {
    const m = await svc({
      mensajes: [
        mensaje({ sender: "lead" }),
        mensaje({ sender: "ia" }),
        mensaje({ sender: "ia", created_at: haceDias(2) }),
        mensaje({ sender: "humano", created_at: haceDias(3) }),
        mensaje({ sender: "ia", created_at: haceDias(45) }),
      ],
    }).obtener(haceDias(30), AHORA);

    expect(m.autoria).toEqual({ lead: 1, ia: 2, humano: 1, sistema: 0 });
  });

  describe("leads nuevos", () => {
    test("cuenta los de la ventana y compara contra la anterior de igual largo", async () => {
      const m = await svc({
        leads: [
          { created_at: haceDias(2) },
          { created_at: haceDias(29) },
          { created_at: haceDias(35) },
          { created_at: haceDias(70) },
        ],
      }).obtener(haceDias(30), AHORA);

      // Ventana: [-30, 0] → 2 leads. Anterior: [-60, -30] → 1 (el de 70 días queda afuera).
      expect(m.leadsNuevos).toEqual({ valor: 2, anterior: 1 });
    });

    test("sin leads devuelve cero y no NaN", async () => {
      const m = await svc().obtener(haceDias(30), AHORA);
      expect(m.leadsNuevos).toEqual({ valor: 0, anterior: 0 });
    });
  });

  describe("tasa de cierre", () => {
    test("es éxito sobre lo resuelto: las abiertas no cuentan en el denominador", async () => {
      const m = await svc({
        sesiones: [
          sesion({ resultado: "exito" }),
          sesion({ resultado: "perdido" }),
          sesion({ resultado: "perdido" }),
          sesion(),
          sesion(),
        ],
      }).obtener(haceDias(30), AHORA);

      expect(m.tasaCierre.valor).toBe(33.3);
    });

    test("sin sesiones resueltas es 0, no NaN", async () => {
      const m = await svc({ sesiones: [sesion(), sesion()] }).obtener(haceDias(30), AHORA);
      expect(m.tasaCierre.valor).toBe(0);
    });

    test("compara contra la ventana anterior", async () => {
      const m = await svc({
        sesiones: [
          sesion({ resultado: "exito", started_at: haceDias(5) }),
          sesion({ resultado: "perdido", started_at: haceDias(5) }),
          sesion({ resultado: "exito", started_at: haceDias(40) }),
          sesion({ resultado: "exito", started_at: haceDias(45) }),
          sesion({ resultado: "perdido", started_at: haceDias(45) }),
          sesion({ resultado: "perdido", started_at: haceDias(50) }),
        ],
      }).obtener(haceDias(30), AHORA);

      expect(m.tasaCierre).toEqual({ valor: 50, anterior: 50 });
    });
  });

  describe("volumen por canal", () => {
    test("cuenta mensajes por canal en orden canónico, sin los canales en cero", async () => {
      const m = await svc({
        mensajes: [
          mensaje({ canal: "fb" }),
          mensaje({ canal: "wa" }),
          mensaje({ canal: "wa" }),
          mensaje({ canal: "wa" }),
        ],
      }).obtener(haceDias(30), AHORA);

      // Orden wa/ig/fb aunque fb haya llegado primero; ig no aparece por estar en cero.
      expect(m.porCanal).toEqual([
        { canal: "wa", cantidad: 3 },
        { canal: "fb", cantidad: 1 },
      ]);
    });

    test("los mensajes fuera de la ventana no suman al canal", async () => {
      const m = await svc({
        mensajes: [mensaje({ canal: "ig" }), mensaje({ canal: "ig", created_at: haceDias(60) })],
      }).obtener(haceDias(30), AHORA);

      expect(m.porCanal).toEqual([{ canal: "ig", cantidad: 1 }]);
    });
  });

  describe("intervención humana", () => {
    test("una sesión donde escribió un humano cuenta como escalada", async () => {
      const m = await svc({
        sesiones: [sesion({ id: "a" }), sesion({ id: "b" })],
        mensajes: [
          mensaje({ sender: "humano", lead_session_id: "a" }),
          mensaje({ lead_session_id: "b" }),
        ],
      }).obtener(haceDias(30), AHORA);

      expect(m.agente).toEqual({ sinIntervencionHumana: 1, resueltasPorIa: 0, escaladas: 1 });
    });

    test("pedir humano ya cuenta como escalada aunque nadie haya contestado", async () => {
      const m = await svc({
        sesiones: [sesion({ id: "a", current_stage: "requiere_humano" })],
      }).obtener(haceDias(30), AHORA);

      expect(m.agente).toEqual({ sinIntervencionHumana: 1, resueltasPorIa: 0, escaladas: 1 });
    });

    test("no se cuenta dos veces la sesión que pidió humano y además fue atendida", async () => {
      const m = await svc({
        sesiones: [sesion({ id: "a", current_stage: "requiere_humano" })],
        mensajes: [mensaje({ sender: "humano", lead_session_id: "a" })],
      }).obtener(haceDias(30), AHORA);

      expect(m.agente).toEqual({ sinIntervencionHumana: 0, resueltasPorIa: 0, escaladas: 1 });
    });

    test("sin intervención y escaladas son cortes distintos y no fingen resoluciones", async () => {
      const m = await svc({
        sesiones: [
          sesion({ id: "a" }),
          sesion({ id: "b", current_stage: "requiere_humano" }),
          sesion({ id: "c" }),
          sesion({ id: "d" }),
        ],
        mensajes: [mensaje({ sender: "humano", lead_session_id: "c" })],
      }).obtener(haceDias(30), AHORA);

      expect(m.agente).toEqual({ sinIntervencionHumana: 3, resueltasPorIa: 0, escaladas: 2 });
    });

    test("una perdida y una abierta no pueden aparecer como 2/2 resueltas por IA", async () => {
      const m = await svc({
        sesiones: [sesion({ id: "cerrada", resultado: "perdido" }), sesion({ id: "abierta" })],
      }).obtener(haceDias(30), AHORA);
      expect(m.agente.sinIntervencionHumana).toBe(2);
      expect(m.agente.resueltasPorIa).toBe(1);
    });
  });

  describe("tiempos medibles y motivos de revisión", () => {
    test("agrupa entrantes consecutivos y mide desde el primero con hora de Meta", async () => {
      const base = new Date("2026-08-10T10:00:00.000Z");
      const m = await svc({
        sesiones: [sesion({ id: "a" })],
        mensajes: [
          mensaje({ lead_session_id: "a", created_at: base, platform_created_at: base }),
          mensaje({
            lead_session_id: "a",
            created_at: new Date(base.getTime() + 30_000),
            platform_created_at: new Date(base.getTime() + 30_000),
          }),
          mensaje({
            lead_session_id: "a",
            sender: "ia",
            created_at: new Date(base.getTime() + 90_000),
            platform_created_at: null,
          }),
        ],
      }).obtener(haceDias(30), AHORA);

      expect(m.tiempoPrimeraRespuesta.ia).toEqual({ medianaSegundos: 90, muestras: 1 });
    });

    test("excluye horas ausentes y deltas negativos", async () => {
      const base = new Date("2026-08-10T10:00:00.000Z");
      const m = await svc({
        sesiones: [sesion({ id: "a" }), sesion({ id: "b" })],
        mensajes: [
          mensaje({ lead_session_id: "a", created_at: base, platform_created_at: null }),
          mensaje({
            lead_session_id: "a",
            sender: "ia",
            created_at: new Date(base.getTime() + 1_000),
          }),
          mensaje({
            lead_session_id: "b",
            created_at: base,
            platform_created_at: new Date(base.getTime() + 5_000),
          }),
          mensaje({ lead_session_id: "b", sender: "humano", created_at: base }),
        ],
      }).obtener(haceDias(30), AHORA);
      expect(m.tiempoPrimeraRespuesta.ia.muestras).toBe(0);
      expect(m.tiempoPrimeraRespuesta.personas.muestras).toBe(0);
    });

    test("razones salen de eventos reales y lo desconocido no se inventa", async () => {
      const m = await svc({
        handoffs: [
          {
            lead_session_id: "a",
            action: "pause",
            reason_code: "discount_limit",
            created_at: haceDias(1),
          },
          {
            lead_session_id: "b",
            action: "pause",
            reason_code: "legacy_code",
            created_at: haceDias(1),
          },
        ],
      }).obtener(haceDias(30), AHORA);
      expect(m.razonesEscalado).toEqual([
        { motivo: "Límite de descuento", cantidad: 1 },
        { motivo: "Sin motivo registrado", cantidad: 1 },
      ]);
    });
  });

  describe("quién cerró la venta", () => {
    test("atribuye al vendedor solo si un humano llegó a escribir", async () => {
      const m = await svc({
        sesiones: [
          sesion({ id: "a", resultado: "exito" }),
          sesion({ id: "b", resultado: "exito" }),
          sesion({ id: "c", resultado: "perdido" }),
        ],
        mensajes: [
          mensaje({ sender: "humano", lead_session_id: "b" }),
          mensaje({ sender: "humano", lead_session_id: "c" }),
        ],
      }).obtener(haceDias(30), AHORA);

      // `c` se perdió: no es un cierre y no entra en la atribución.
      expect(m.cierres).toEqual({ ia: 1, vendedor: 1 });
    });

    test("una sesión parada en requiere_humano que nadie atendió la cerró la IA", async () => {
      const m = await svc({
        sesiones: [sesion({ id: "a", resultado: "exito", current_stage: "requiere_humano" })],
      }).obtener(haceDias(30), AHORA);

      expect(m.cierres).toEqual({ ia: 1, vendedor: 0 });
    });

    test("los cierres suman las sesiones con resultado de éxito", async () => {
      const m = await svc({
        sesiones: [
          sesion({ resultado: "exito" }),
          sesion({ resultado: "exito" }),
          sesion({ resultado: "perdido" }),
          sesion(),
        ],
      }).obtener(haceDias(30), AHORA);

      expect(m.cierres.ia + m.cierres.vendedor).toBe(m.resultado.exito);
    });
  });

  describe("conversaciones tomadas por humano", () => {
    test("cuenta sesiones de la ventana, no mensajes", async () => {
      const m = await svc({
        sesiones: [sesion({ id: "a" }), sesion({ id: "b" }), sesion({ id: "c" })],
        mensajes: [
          mensaje({ sender: "humano", lead_session_id: "a" }),
          mensaje({ sender: "humano", lead_session_id: "a" }),
          mensaje({ sender: "humano", lead_session_id: "b" }),
        ],
      }).obtener(haceDias(30), AHORA);

      expect(m.tomadasPorHumano).toBe(2);
    });

    test("un humano escribiendo en una sesión vieja no infla el conteo de la ventana", async () => {
      const m = await svc({
        sesiones: [sesion({ id: "nueva" }), sesion({ id: "vieja", started_at: haceDias(40) })],
        mensajes: [mensaje({ sender: "humano", lead_session_id: "vieja" })],
      }).obtener(haceDias(30), AHORA);

      expect(m.tomadasPorHumano).toBe(0);
    });

    test("pedir humano sin que nadie escriba no cuenta como tomada", async () => {
      const m = await svc({
        sesiones: [sesion({ id: "a", current_stage: "requiere_humano" })],
      }).obtener(haceDias(30), AHORA);

      expect(m.tomadasPorHumano).toBe(0);
      expect(m.agente.escaladas).toBe(1);
    });
  });

  describe("rendimiento por vendedor", () => {
    /** Minutos después de `haceDias(1)`, para escribir hilos legibles. */
    function min(m: number): Date {
      return new Date(haceDias(1).getTime() + m * 60 * 1000);
    }

    test("la sesión es de quien escribió primero, aunque después entre otro", async () => {
      const m = await svc({
        sesiones: [sesion({ id: "a" })],
        mensajes: [
          mensaje({ lead_session_id: "a", created_at: min(0) }),
          mensaje({
            lead_session_id: "a",
            sender: "humano",
            sender_user_id: "u1",
            created_at: min(2),
          }),
          mensaje({
            lead_session_id: "a",
            sender: "humano",
            sender_user_id: "u2",
            created_at: min(5),
          }),
        ],
        usuarios: [usuario({ id: "u1", nombre: "Ana" }), usuario({ id: "u2", nombre: "Beto" })],
      }).obtener(haceDias(30), AHORA);

      expect(m.vendedores.filas).toHaveLength(1);
      expect(m.vendedores.filas[0]?.nombre).toBe("Ana");
      expect(m.vendedores.filas[0]?.tomadas).toBe(1);
    });

    test("la toma se mide contra el último mensaje del cliente sin contestar", async () => {
      const m = await svc({
        sesiones: [sesion({ id: "a" })],
        mensajes: [
          mensaje({ lead_session_id: "a", created_at: min(0) }),
          mensaje({ lead_session_id: "a", created_at: min(1) }),
          mensaje({
            lead_session_id: "a",
            sender: "humano",
            sender_user_id: "u1",
            created_at: min(4),
          }),
        ],
        usuarios: [usuario()],
      }).obtener(haceDias(30), AHORA);

      expect(m.vendedores.filas[0]?.tomaEnSegundos).toBe(180);
      expect(m.vendedores.tomaEnSegundos).toBe(180);
    });

    test("sin mensaje del cliente antes, la toma no se mide en vez de valer cero", async () => {
      const m = await svc({
        sesiones: [sesion({ id: "a" })],
        mensajes: [
          mensaje({
            lead_session_id: "a",
            sender: "humano",
            sender_user_id: "u1",
            created_at: min(0),
          }),
        ],
        usuarios: [usuario()],
      }).obtener(haceDias(30), AHORA);

      expect(m.vendedores.filas[0]?.tomadas).toBe(1);
      expect(m.vendedores.filas[0]?.tomaEnSegundos).toBeNull();
      expect(m.vendedores.tomaEnSegundos).toBeNull();
    });

    test("cierre es lo cerrado con éxito sobre lo tomado", async () => {
      const m = await svc({
        sesiones: [
          sesion({ id: "a", resultado: "exito" }),
          sesion({ id: "b", resultado: "perdido" }),
          sesion({ id: "c" }),
        ],
        mensajes: ["a", "b", "c"].map((id) =>
          mensaje({ lead_session_id: id, sender: "humano", sender_user_id: "u1" }),
        ),
        usuarios: [usuario()],
      }).obtener(haceDias(30), AHORA);

      expect(m.vendedores.filas[0]?.tomadas).toBe(3);
      expect(m.vendedores.filas[0]?.cerradas).toBe(1);
      expect(m.vendedores.filas[0]?.cierre).toBeCloseTo(33.3, 1);
    });

    test("lo anterior a sender_user_id queda sin atribuir, no repartido", async () => {
      const m = await svc({
        sesiones: [sesion({ id: "a" }), sesion({ id: "b" })],
        mensajes: [
          mensaje({ lead_session_id: "a", sender: "humano", sender_user_id: null }),
          mensaje({ lead_session_id: "b", sender: "humano", sender_user_id: "u1" }),
        ],
        usuarios: [usuario()],
      }).obtener(haceDias(30), AHORA);

      expect(m.vendedores.sinAtribuir).toBe(1);
      expect(m.vendedores.filas).toHaveLength(1);
      expect(m.vendedores.filas[0]?.tomadas).toBe(1);
    });

    test("las filas y sin atribuir suman las sesiones tomadas", async () => {
      const m = await svc({
        sesiones: [sesion({ id: "a" }), sesion({ id: "b" }), sesion({ id: "c" })],
        mensajes: [
          mensaje({ lead_session_id: "a", sender: "humano", sender_user_id: "u1" }),
          mensaje({ lead_session_id: "b", sender: "humano", sender_user_id: "u2" }),
          mensaje({ lead_session_id: "c", sender: "humano", sender_user_id: null }),
        ],
        usuarios: [usuario({ id: "u1" }), usuario({ id: "u2", nombre: "Beto" })],
      }).obtener(haceDias(30), AHORA);

      const enFilas = m.vendedores.filas.reduce((acc, f) => acc + f.tomadas, 0);
      expect(enFilas + m.vendedores.sinAtribuir).toBe(m.tomadasPorHumano);
    });

    test("sin ninguna sesión tomada no hay filas ni mediana", async () => {
      const m = await svc({
        sesiones: [sesion({ id: "a" })],
        mensajes: [mensaje({ lead_session_id: "a", sender: "ia" })],
        usuarios: [usuario()],
      }).obtener(haceDias(30), AHORA);

      expect(m.vendedores).toEqual({
        filas: [],
        sinAtribuir: 0,
        tomaEnSegundos: null,
        muestras: 0,
      });
    });

    test("la mediana no la corre una espera larga suelta", async () => {
      const ids = ["a", "b", "c"];
      const m = await svc({
        sesiones: ids.map((id) => sesion({ id })),
        mensajes: [
          mensaje({ lead_session_id: "a", created_at: min(0) }),
          mensaje({
            lead_session_id: "a",
            sender: "humano",
            sender_user_id: "u1",
            created_at: min(1),
          }),
          mensaje({ lead_session_id: "b", created_at: min(0) }),
          mensaje({
            lead_session_id: "b",
            sender: "humano",
            sender_user_id: "u1",
            created_at: min(2),
          }),
          mensaje({ lead_session_id: "c", created_at: min(0) }),
          mensaje({
            lead_session_id: "c",
            sender: "humano",
            sender_user_id: "u1",
            created_at: min(600),
          }),
        ],
        usuarios: [usuario()],
      }).obtener(haceDias(30), AHORA);

      // Mediana de 60 / 120 / 36000 = 120. Un promedio daría 12060.
      expect(m.vendedores.filas[0]?.tomaEnSegundos).toBe(120);
    });
  });

  describe("cómo se resolvió cada turno", () => {
    test("las reglas se descuentan de lo que mandó la IA y el resto es LLM", async () => {
      const m = await svc({
        mensajes: [
          mensaje({ sender: "ia" }),
          mensaje({ sender: "ia" }),
          mensaje({ sender: "ia" }),
          mensaje({ sender: "humano" }),
          mensaje({ sender: "lead" }),
        ],
        reglas: [{ created_at: haceDias(1) }],
      }).obtener(haceDias(30), AHORA);

      expect(m.turnos).toEqual({ regla: 1, llm: 2, escalado: 1 });
    });

    test("sin reglas ejecutadas todo lo de la IA es LLM", async () => {
      const m = await svc({
        mensajes: [mensaje({ sender: "ia" }), mensaje({ sender: "ia" })],
      }).obtener(haceDias(30), AHORA);

      expect(m.turnos).toEqual({ regla: 0, llm: 2, escalado: 0 });
    });

    test("más reglas que mensajes de IA no produce un LLM negativo", async () => {
      // Desfase de borde: la regla se audita contra el entrante y su saliente
      // puede haber quedado fuera de la ventana.
      const m = await svc({
        mensajes: [mensaje({ sender: "ia" })],
        reglas: [
          { created_at: haceDias(1) },
          { created_at: haceDias(2) },
          { created_at: haceDias(3) },
        ],
      }).obtener(haceDias(30), AHORA);

      expect(m.turnos).toEqual({ regla: 1, llm: 0, escalado: 0 });
    });

    test("las reglas fuera de la ventana no cuentan", async () => {
      const m = await svc({
        mensajes: [mensaje({ sender: "ia" }), mensaje({ sender: "ia" })],
        reglas: [{ created_at: haceDias(1) }, { created_at: haceDias(60) }],
      }).obtener(haceDias(30), AHORA);

      expect(m.turnos).toEqual({ regla: 1, llm: 1, escalado: 0 });
    });
  });

  describe("gasto de IA", () => {
    /** Una llamada al modelo anotada en `llm_usage`. */
    function uso(over: Partial<FilaLlmUsageMetrica> = {}): FilaLlmUsageMetrica {
      return {
        lead_session_id: "s1",
        modelo: "gpt-4o-mini",
        input_tokens: 1000,
        output_tokens: 200,
        costo_usd: 0.01,
        workflow: WORKFLOW_LLM.agente,
        created_at: haceDias(1),
        ...over,
      };
    }

    test("sin llamadas registradas todo queda en cero y lo que se divide, en null", async () => {
      const m = await svc().obtener(haceDias(30), AHORA);

      expect(m.gasto).toEqual({
        totalUsd: 0,
        hoyUsd: 0,
        porLeadUsd: null,
        tokensEntrada: 0,
        tokensSalida: 0,
        llamadas: 0,
        porWorkflow: [],
        promedioTurnoUsd: null,
        ahorroReglasUsd: null,
      });
    });

    test("suma costo y tokens de la ventana", async () => {
      const m = await svc({
        gastos: [
          uso({ costo_usd: 0.01, input_tokens: 1000, output_tokens: 200 }),
          uso({ costo_usd: 0.02, input_tokens: 500, output_tokens: 100 }),
        ],
      }).obtener(haceDias(30), AHORA);

      expect(m.gasto.totalUsd).toBeCloseTo(0.03, 10);
      expect(m.gasto.tokensEntrada).toBe(1500);
      expect(m.gasto.tokensSalida).toBe(300);
      expect(m.gasto.llamadas).toBe(2);
    });

    test("«hoy» corta por día UTC, el mismo día que usa el contador diario", async () => {
      // `hoyUsd` sale de la consulta dedicada [inicio de hoy UTC, ahora), no
      // de la ventana navegada [desde, hasta) — por eso `hastaVentana` puede
      // quedar corto sin afectar el corte de "hoy".
      const hastaVentana = new Date("2026-08-10T12:00:00.000Z");
      const m = await svc({
        gastos: [
          // Mismo día UTC que AHORA (12:00Z), a las dos puntas.
          uso({ costo_usd: 0.05, created_at: new Date("2026-08-10T00:00:00.000Z") }),
          uso({ costo_usd: 0.07, created_at: new Date("2026-08-10T10:00:00.000Z") }),
          // Ayer: entra en el total de la ventana, no en el de hoy.
          uso({ costo_usd: 1, created_at: new Date("2026-08-09T23:59:59.000Z") }),
        ],
      }).obtener(haceDias(30), hastaVentana, AHORA);

      expect(m.gasto.hoyUsd).toBeCloseTo(0.12, 10);
      expect(m.gasto.totalUsd).toBeCloseTo(1.12, 10);
    });

    test("hoyUsd sigue reflejando el gasto de hoy aunque `hasta` sea un rango histórico", async () => {
      // Regresión: acotar `gastos` a [desde, hasta) no puede vaciar `hoyUsd`
      // cuando el caller navega a un período pasado (rango histórico, campaña)
      // — `hoyUsd` es un indicador en tiempo real, no parte de ese período.
      const desdeHistorico = new Date("2026-07-01T00:00:00.000Z");
      const hastaHistorico = new Date("2026-07-31T00:00:00.000Z");
      const m = await svc({
        gastos: [uso({ costo_usd: 0.09, created_at: new Date("2026-08-10T10:00:00.000Z") })],
      }).obtener(desdeHistorico, hastaHistorico, AHORA);

      expect(m.gasto.hoyUsd).toBeCloseTo(0.09, 10);
      expect(m.gasto.totalUsd).toBe(0);
    });

    test("lo anterior a la ventana no entra", async () => {
      const m = await svc({
        gastos: [uso({ created_at: haceDias(5) }), uso({ created_at: haceDias(40) })],
      }).obtener(haceDias(30), AHORA);

      expect(m.gasto.llamadas).toBe(1);
    });

    test("agrupa por workflow, del más caro al menos", async () => {
      const m = await svc({
        gastos: [
          uso({ workflow: WORKFLOW_LLM.clasificador, costo_usd: 0.001 }),
          uso({ workflow: WORKFLOW_LLM.agente, costo_usd: 0.02 }),
          uso({ workflow: WORKFLOW_LLM.agente, costo_usd: 0.03 }),
          uso({ workflow: WORKFLOW_LLM.extractorTwin, costo_usd: 0.004 }),
        ],
      }).obtener(haceDias(30), AHORA);

      expect(m.gasto.porWorkflow.map((w) => w.workflow)).toEqual([
        WORKFLOW_LLM.agente,
        WORKFLOW_LLM.extractorTwin,
        WORKFLOW_LLM.clasificador,
      ]);
      expect(m.gasto.porWorkflow[0]).toEqual({
        workflow: WORKFLOW_LLM.agente,
        usd: 0.05,
        llamadas: 2,
      });
    });

    test("el costo por lead reparte sobre los leads de la ventana", async () => {
      const m = await svc({
        leads: [{ created_at: haceDias(2) }, { created_at: haceDias(3) }],
        gastos: [uso({ costo_usd: 0.05 }), uso({ costo_usd: 0.05 })],
      }).obtener(haceDias(30), AHORA);

      expect(m.gasto.porLeadUsd).toBeCloseTo(0.05, 10);
    });

    test("sin leads en la ventana el costo por lead es null y no un infinito", async () => {
      const m = await svc({ gastos: [uso({ costo_usd: 0.05 })] }).obtener(haceDias(30), AHORA);

      expect(m.gasto.porLeadUsd).toBeNull();
    });

    test("el promedio del turno sale solo de las llamadas del agente", async () => {
      const m = await svc({
        gastos: [
          uso({ workflow: WORKFLOW_LLM.agente, costo_usd: 0.02 }),
          uso({ workflow: WORKFLOW_LLM.agente, costo_usd: 0.04 }),
          // Ni el clasificador ni el preview de la consola son turnos del agente.
          uso({ workflow: WORKFLOW_LLM.clasificador, costo_usd: 9 }),
          uso({ workflow: WORKFLOW_LLM.agentePreview, costo_usd: 9 }),
        ],
      }).obtener(haceDias(30), AHORA);

      expect(m.gasto.promedioTurnoUsd).toBeCloseTo(0.03, 10);
    });

    test("el ahorro por reglas es el promedio del turno por los turnos que contestó una regla", async () => {
      const m = await svc({
        mensajes: [mensaje({ sender: "ia" }), mensaje({ sender: "ia" })],
        reglas: [{ created_at: haceDias(1) }, { created_at: haceDias(2) }],
        gastos: [uso({ costo_usd: 0.02 }), uso({ costo_usd: 0.04 })],
      }).obtener(haceDias(30), AHORA);

      // 2 turnos de regla × $0,03 de promedio.
      expect(m.gasto.ahorroReglasUsd).toBeCloseTo(0.06, 10);
    });

    test("sin turnos del agente no hay con qué estimar el ahorro: null y no cero", async () => {
      const m = await svc({
        mensajes: [mensaje({ sender: "ia" })],
        reglas: [{ created_at: haceDias(1) }],
        gastos: [uso({ workflow: WORKFLOW_LLM.clasificador, costo_usd: 0.001 })],
      }).obtener(haceDias(30), AHORA);

      expect(m.gasto.promedioTurnoUsd).toBeNull();
      expect(m.gasto.ahorroReglasUsd).toBeNull();
    });
  });

  describe("uso de herramientas", () => {
    test("agrupa por nombre, separa las fallidas y ordena por llamadas", async () => {
      const m = await svc({
        tools: [
          { tool_name: "buscar_repuesto", created_at: haceDias(1), error: null, args: null },
          { tool_name: "buscar_repuesto", created_at: haceDias(1), error: null, args: null },
          { tool_name: "buscar_repuesto", created_at: haceDias(2), error: "timeout", args: null },
          { tool_name: "cotizar", created_at: haceDias(1), error: null, args: null },
        ],
      }).obtener(haceDias(30), AHORA);

      expect(m.herramientas).toEqual([
        { nombre: "buscar_repuesto", llamadas: 3, fallidas: 1 },
        { nombre: "cotizar", llamadas: 1, fallidas: 0 },
      ]);
    });

    test("las llamadas fuera de la ventana no cuentan", async () => {
      const m = await svc({
        tools: [
          { tool_name: "buscar_repuesto", created_at: haceDias(1), error: null, args: null },
          { tool_name: "buscar_repuesto", created_at: haceDias(90), error: null, args: null },
        ],
      }).obtener(haceDias(30), AHORA);

      expect(m.herramientas).toEqual([{ nombre: "buscar_repuesto", llamadas: 1, fallidas: 0 }]);
    });

    test("sin llamadas la lista viene vacía, no con ceros inventados", async () => {
      const m = await svc().obtener(haceDias(30), AHORA);
      expect(m.herramientas).toEqual([]);
    });
  });

  describe("intents sin regla", () => {
    test("deja fuera los intents que ya tiene cubiertos una regla activa", async () => {
      const m = await svc({
        intents: [
          intent({ id: "cubierto", nombre: "saludo" }),
          intent({ id: "suelto", nombre: "consulta_garantia" }),
        ],
        reglasActivas: [{ intent_id: "cubierto" }],
      }).obtener(haceDias(30), AHORA);

      expect(m.intentsSinRegla.map((i) => i.nombre)).toEqual(["consulta_garantia"]);
    });

    test("una regla inactiva no cuenta como cobertura", async () => {
      // El repo solo devuelve reglas activas, así que un intent cuya única
      // regla está apagada llega sin cobertura y tiene que aparecer en la lista.
      const m = await svc({ intents: [intent({ id: "suelto" })] }).obtener(haceDias(30), AHORA);

      expect(m.intentsSinRegla).toHaveLength(1);
    });

    test("ordena del más nuevo al más viejo", async () => {
      const m = await svc({
        intents: [
          intent({ id: "a", nombre: "viejo", created_at: haceDias(40) }),
          intent({ id: "b", nombre: "nuevo", created_at: haceDias(1) }),
          intent({ id: "c", nombre: "medio", created_at: haceDias(10) }),
        ],
      }).obtener(haceDias(30), AHORA);

      expect(m.intentsSinRegla.map((i) => i.nombre)).toEqual(["nuevo", "medio", "viejo"]);
    });

    test("un intent detectado fuera de la ventana igual aparece: es configuración, no un evento", async () => {
      const m = await svc({
        intents: [intent({ id: "a", created_at: haceDias(400) })],
      }).obtener(haceDias(30), AHORA);

      expect(m.intentsSinRegla).toHaveLength(1);
    });

    test("expone el origen del intent para poder distinguir los auto-detectados", async () => {
      const m = await svc({
        intents: [intent({ id: "a", auto_detectado: true, created_at: haceDias(2) })],
      }).obtener(haceDias(30), AHORA);

      expect(m.intentsSinRegla[0]).toMatchObject({
        nombre: "consulta_precio",
        autoDetectado: true,
        detectadoEl: haceDias(2),
      });
    });

    test("con todo cubierto la lista viene vacía", async () => {
      const m = await svc({
        intents: [intent({ id: "a" })],
        reglasActivas: [{ intent_id: "a" }],
      }).obtener(haceDias(30), AHORA);

      expect(m.intentsSinRegla).toEqual([]);
    });
  });

  describe("ventas", () => {
    test("cuenta exito con y sin precio, y promedia solo sobre las que tienen precio", async () => {
      const ahora = new Date("2026-08-17T12:00:00Z");
      const desde = new Date("2026-07-18T12:00:00Z");
      const repo = new InMemoryMetricsRepository({
        sesiones: [
          {
            id: "s1",
            current_stage: "cerrado",
            resultado: "exito",
            motivo_perdida: null,
            started_at: desde,
            precio_cotizado: 100,
            codigo_interno: "COD1",
            closed_at: ahora,
            cantidad: null,
          },
          {
            id: "s2",
            current_stage: "cerrado",
            resultado: "exito",
            motivo_perdida: null,
            started_at: desde,
            precio_cotizado: null,
            codigo_interno: null,
            closed_at: ahora,
            cantidad: null,
          },
          {
            id: "s3",
            current_stage: "cerrado",
            resultado: "perdido",
            motivo_perdida: "precio",
            started_at: desde,
            precio_cotizado: 50,
            codigo_interno: "COD2",
            closed_at: ahora,
            cantidad: null,
          },
        ],
      });
      const service = new DefaultMetricsService({ metrics: repo });
      const m = await service.obtener(desde, ahora);
      expect(m.ventas).toEqual({
        conteo: 2,
        conPrecio: 1,
        montoTotalUsd: 100,
        ticketPromedioUsd: 100,
      });
    });

    test("con cero ventas, montoTotalUsd y ticketPromedioUsd son null", async () => {
      const ahora = new Date("2026-08-17T12:00:00Z");
      const desde = new Date("2026-07-18T12:00:00Z");
      const service = new DefaultMetricsService({ metrics: new InMemoryMetricsRepository() });
      const m = await service.obtener(desde, ahora);
      expect(m.ventas).toEqual({
        conteo: 0,
        conPrecio: 0,
        montoTotalUsd: null,
        ticketPromedioUsd: null,
      });
    });
  });

  describe("codigosMasVendidos", () => {
    test("agrupa por codigo_interno entre las ventas, ordenado por apariciones", async () => {
      const ahora = new Date("2026-08-17T12:00:00Z");
      const desde = new Date("2026-07-18T12:00:00Z");
      const repo = new InMemoryMetricsRepository({
        sesiones: [
          {
            id: "s1",
            current_stage: "cerrado",
            resultado: "exito",
            motivo_perdida: null,
            started_at: desde,
            precio_cotizado: 100,
            codigo_interno: "COD1",
            closed_at: ahora,
            cantidad: null,
          },
          {
            id: "s2",
            current_stage: "cerrado",
            resultado: "exito",
            motivo_perdida: null,
            started_at: desde,
            precio_cotizado: 80,
            codigo_interno: "COD1",
            closed_at: ahora,
            cantidad: 3,
          },
          {
            id: "s3",
            current_stage: "cerrado",
            resultado: "exito",
            motivo_perdida: null,
            started_at: desde,
            precio_cotizado: 20,
            codigo_interno: "COD2",
            closed_at: ahora,
            cantidad: null,
          },
        ],
      });
      const service = new DefaultMetricsService({ metrics: repo });
      const m = await service.obtener(desde, ahora);
      expect(m.codigosMasVendidos[0]).toEqual({
        codigoInterno: "COD1",
        apariciones: 2,
        unidades: 3,
        unidadesConDato: 1,
      });
      expect(m.codigosMasVendidos[1]?.codigoInterno).toBe("COD2");
      // montoTotalUsd es sum(precio_cotizado) = 100 + 80 + 20 = 200. Si se
      // multiplicara por `cantidad` (3 en s2), daría 360.
      expect(m.ventas.montoTotalUsd).toBe(200);
    });
  });

  describe("repuestosMasPreguntados", () => {
    test("agrupa por marca sin distinguir mayúsculas ni espacios, ignora otras tools y args nulos", async () => {
      const m = await svc({
        tools: [
          {
            tool_name: "buscar_repuesto",
            created_at: haceDias(1),
            error: null,
            args: { marca: "Toyota" },
          },
          {
            tool_name: "buscar_repuesto",
            created_at: haceDias(1),
            error: null,
            args: { marca: " toyota " },
          },
          // Otra tool: no aporta a la demanda de catálogo.
          { tool_name: "cotizar", created_at: haceDias(1), error: null, args: null },
          // buscar_repuesto sin args: no debe romper ni contar.
          { tool_name: "buscar_repuesto", created_at: haceDias(1), error: null, args: null },
        ],
      }).obtener(haceDias(30), AHORA);

      expect(m.repuestosMasPreguntados.porMarca).toEqual([{ motivo: "toyota", cantidad: 2 }]);
    });
  });

  describe("tiempoCierre", () => {
    test("mediana sobre sesiones resueltas con closed_at, exito y perdido", async () => {
      const ahora = new Date("2026-08-17T12:00:00Z");
      const desde = new Date("2026-07-18T12:00:00Z");
      const inicio = desde;
      const repo = new InMemoryMetricsRepository({
        sesiones: [
          {
            id: "s1",
            current_stage: "cerrado",
            resultado: "exito",
            motivo_perdida: null,
            started_at: inicio,
            precio_cotizado: null,
            codigo_interno: null,
            closed_at: new Date(inicio.getTime() + 60_000),
            cantidad: null,
          },
          {
            id: "s2",
            current_stage: "cerrado",
            resultado: "perdido",
            motivo_perdida: "precio",
            started_at: inicio,
            precio_cotizado: null,
            codigo_interno: null,
            closed_at: new Date(inicio.getTime() + 120_000),
            cantidad: null,
          },
        ],
      });
      const service = new DefaultMetricsService({ metrics: repo });
      const m = await service.obtener(desde, ahora);
      expect(m.tiempoCierre.muestras).toBe(2);
      expect(m.tiempoCierre.medianaSegundos).toBe(90);
    });
  });
});
