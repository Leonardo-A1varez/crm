import { describe, expect, test } from "vitest";
import { InMemoryMetricsRepository } from "@/server/repositories/metrics.repo";
import { DefaultMetricsService } from "@/server/services/metricas/default-metricas.service";
import type {
  FilaIntentMetrica,
  FilaLeadMetrica,
  FilaMensajeMetrica,
  FilaReglaActivaMetrica,
  FilaRuleExecutionMetrica,
  FilaSesionMetrica,
  FilaToolExecutionMetrica,
} from "@/server/repositories/metrics.repo";

const AHORA = new Date("2026-08-10T12:00:00.000Z");

function haceDias(d: number): Date {
  return new Date(AHORA.getTime() - d * 24 * 60 * 60 * 1000);
}

function svc(
  sesiones: FilaSesionMetrica[] = [],
  mensajes: FilaMensajeMetrica[] = [],
  leads: FilaLeadMetrica[] = [],
  reglas: FilaRuleExecutionMetrica[] = [],
  tools: FilaToolExecutionMetrica[] = [],
  intents: FilaIntentMetrica[] = [],
  reglasActivas: FilaReglaActivaMetrica[] = [],
) {
  return new DefaultMetricsService({
    metrics: new InMemoryMetricsRepository(
      sesiones,
      mensajes,
      leads,
      reglas,
      tools,
      intents,
      reglasActivas,
    ),
  });
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
    ...over,
  };
}

function mensaje(over: Partial<FilaMensajeMetrica> = {}): FilaMensajeMetrica {
  return {
    sender: "lead",
    created_at: haceDias(1),
    canal: "wa",
    lead_session_id: "s1",
    ...over,
  };
}

describe("DefaultMetricsService.obtener", () => {
  test("sin datos devuelve las 6 etapas del embudo en cero", async () => {
    const m = await svc().obtener(30, AHORA);

    expect(m.totalSesiones).toBe(0);
    expect(m.embudo).toHaveLength(6);
    expect(m.embudo.every((e) => e.cantidad === 0)).toBe(true);
    expect(m.resultado).toEqual({ abiertas: 0, exito: 0, perdido: 0, porMotivo: [] });
  });

  test("la ventana recorta: lo anterior a `desde` no se cuenta", async () => {
    const m = await svc([
      sesion({ started_at: haceDias(5) }),
      sesion({ started_at: haceDias(40) }),
    ]).obtener(30, AHORA);

    expect(m.totalSesiones).toBe(1);
    expect(m.desde).toEqual(haceDias(30));
  });

  test("los desvíos se cuentan aparte del embudo", async () => {
    const m = await svc([
      sesion({ current_stage: "cotizado" }),
      sesion({ current_stage: "requiere_humano" }),
      sesion({ current_stage: "perdido" }),
    ]).obtener(30, AHORA);

    expect(m.embudo.find((e) => e.stage === "cotizado")?.cantidad).toBe(1);
    expect(m.embudo.map((e) => e.stage)).not.toContain("perdido");
    expect(m.desvios.find((d) => d.stage === "requiere_humano")?.cantidad).toBe(1);
    expect(m.desvios.find((d) => d.stage === "perdido")?.cantidad).toBe(1);
  });

  test("abiertas es el resto: ni éxito ni perdido", async () => {
    const m = await svc([
      sesion({ resultado: "exito" }),
      sesion({ resultado: "perdido", motivo_perdida: "precio" }),
      sesion(),
      sesion(),
    ]).obtener(30, AHORA);

    expect(m.resultado).toMatchObject({ exito: 1, perdido: 1, abiertas: 2 });
  });

  test("una perdida sin motivo no se inventa como 'otro'", async () => {
    const m = await svc([sesion({ resultado: "perdido", motivo_perdida: null })]).obtener(
      30,
      AHORA,
    );

    expect(m.resultado.porMotivo).toEqual([{ motivo: "Sin motivo registrado", cantidad: 1 }]);
  });

  test("los motivos salen ordenados por cantidad", async () => {
    const m = await svc([
      sesion({ resultado: "perdido", motivo_perdida: "stock" }),
      sesion({ resultado: "perdido", motivo_perdida: "precio" }),
      sesion({ resultado: "perdido", motivo_perdida: "precio" }),
    ]).obtener(30, AHORA);

    expect(m.resultado.porMotivo).toEqual([
      { motivo: "Precio", cantidad: 2 },
      { motivo: "Sin stock", cantidad: 1 },
    ]);
  });

  test("la autoría cuenta los 4 remitentes y arranca en cero", async () => {
    const m = await svc(
      [],
      [
        mensaje({ sender: "lead" }),
        mensaje({ sender: "ia" }),
        mensaje({ sender: "ia", created_at: haceDias(2) }),
        mensaje({ sender: "humano", created_at: haceDias(3) }),
        mensaje({ sender: "ia", created_at: haceDias(45) }),
      ],
    ).obtener(30, AHORA);

    expect(m.autoria).toEqual({ lead: 1, ia: 2, humano: 1, sistema: 0 });
  });

  describe("leads nuevos", () => {
    test("cuenta los de la ventana y compara contra la anterior de igual largo", async () => {
      const m = await svc(
        [],
        [],
        [
          { created_at: haceDias(2) },
          { created_at: haceDias(29) },
          { created_at: haceDias(35) },
          { created_at: haceDias(70) },
        ],
      ).obtener(30, AHORA);

      // Ventana: [-30, 0] → 2 leads. Anterior: [-60, -30] → 1 (el de 70 días queda afuera).
      expect(m.leadsNuevos).toEqual({ valor: 2, anterior: 1 });
    });

    test("sin leads devuelve cero y no NaN", async () => {
      const m = await svc().obtener(30, AHORA);
      expect(m.leadsNuevos).toEqual({ valor: 0, anterior: 0 });
    });
  });

  describe("tasa de cierre", () => {
    test("es éxito sobre lo resuelto: las abiertas no cuentan en el denominador", async () => {
      const m = await svc([
        sesion({ resultado: "exito" }),
        sesion({ resultado: "perdido" }),
        sesion({ resultado: "perdido" }),
        sesion(),
        sesion(),
      ]).obtener(30, AHORA);

      expect(m.tasaCierre.valor).toBe(33.3);
    });

    test("sin sesiones resueltas es 0, no NaN", async () => {
      const m = await svc([sesion(), sesion()]).obtener(30, AHORA);
      expect(m.tasaCierre.valor).toBe(0);
    });

    test("compara contra la ventana anterior", async () => {
      const m = await svc([
        sesion({ resultado: "exito", started_at: haceDias(5) }),
        sesion({ resultado: "perdido", started_at: haceDias(5) }),
        sesion({ resultado: "exito", started_at: haceDias(40) }),
        sesion({ resultado: "exito", started_at: haceDias(45) }),
        sesion({ resultado: "perdido", started_at: haceDias(45) }),
        sesion({ resultado: "perdido", started_at: haceDias(50) }),
      ]).obtener(30, AHORA);

      expect(m.tasaCierre).toEqual({ valor: 50, anterior: 50 });
    });
  });

  describe("volumen por canal", () => {
    test("cuenta mensajes por canal en orden canónico, sin los canales en cero", async () => {
      const m = await svc(
        [],
        [
          mensaje({ canal: "fb" }),
          mensaje({ canal: "wa" }),
          mensaje({ canal: "wa" }),
          mensaje({ canal: "wa" }),
        ],
      ).obtener(30, AHORA);

      // Orden wa/ig/fb aunque fb haya llegado primero; ig no aparece por estar en cero.
      expect(m.porCanal).toEqual([
        { canal: "wa", cantidad: 3 },
        { canal: "fb", cantidad: 1 },
      ]);
    });

    test("los mensajes fuera de la ventana no suman al canal", async () => {
      const m = await svc(
        [],
        [mensaje({ canal: "ig" }), mensaje({ canal: "ig", created_at: haceDias(60) })],
      ).obtener(30, AHORA);

      expect(m.porCanal).toEqual([{ canal: "ig", cantidad: 1 }]);
    });
  });

  describe("intervención humana", () => {
    test("una sesión donde escribió un humano cuenta como escalada", async () => {
      const m = await svc(
        [sesion({ id: "a" }), sesion({ id: "b" })],
        [mensaje({ sender: "humano", lead_session_id: "a" }), mensaje({ lead_session_id: "b" })],
      ).obtener(30, AHORA);

      expect(m.agente).toEqual({ sinHumano: 1, escaladas: 1 });
    });

    test("pedir humano ya cuenta como escalada aunque nadie haya contestado", async () => {
      const m = await svc([sesion({ id: "a", current_stage: "requiere_humano" })]).obtener(
        30,
        AHORA,
      );

      expect(m.agente).toEqual({ sinHumano: 0, escaladas: 1 });
    });

    test("no se cuenta dos veces la sesión que pidió humano y además fue atendida", async () => {
      const m = await svc(
        [sesion({ id: "a", current_stage: "requiere_humano" })],
        [mensaje({ sender: "humano", lead_session_id: "a" })],
      ).obtener(30, AHORA);

      expect(m.agente).toEqual({ sinHumano: 0, escaladas: 1 });
    });

    test("sinHumano y escaladas siempre suman el total de sesiones", async () => {
      const m = await svc(
        [
          sesion({ id: "a" }),
          sesion({ id: "b", current_stage: "requiere_humano" }),
          sesion({ id: "c" }),
          sesion({ id: "d" }),
        ],
        [mensaje({ sender: "humano", lead_session_id: "c" })],
      ).obtener(30, AHORA);

      expect(m.agente.sinHumano + m.agente.escaladas).toBe(m.totalSesiones);
      expect(m.agente).toEqual({ sinHumano: 2, escaladas: 2 });
    });
  });

  describe("quién cerró la venta", () => {
    test("atribuye al vendedor solo si un humano llegó a escribir", async () => {
      const m = await svc(
        [
          sesion({ id: "a", resultado: "exito" }),
          sesion({ id: "b", resultado: "exito" }),
          sesion({ id: "c", resultado: "perdido" }),
        ],
        [
          mensaje({ sender: "humano", lead_session_id: "b" }),
          mensaje({ sender: "humano", lead_session_id: "c" }),
        ],
      ).obtener(30, AHORA);

      // `c` se perdió: no es un cierre y no entra en la atribución.
      expect(m.cierres).toEqual({ ia: 1, vendedor: 1 });
    });

    test("una sesión parada en requiere_humano que nadie atendió la cerró la IA", async () => {
      const m = await svc([
        sesion({ id: "a", resultado: "exito", current_stage: "requiere_humano" }),
      ]).obtener(30, AHORA);

      expect(m.cierres).toEqual({ ia: 1, vendedor: 0 });
    });

    test("los cierres suman las sesiones con resultado de éxito", async () => {
      const m = await svc([
        sesion({ resultado: "exito" }),
        sesion({ resultado: "exito" }),
        sesion({ resultado: "perdido" }),
        sesion(),
      ]).obtener(30, AHORA);

      expect(m.cierres.ia + m.cierres.vendedor).toBe(m.resultado.exito);
    });
  });

  describe("conversaciones tomadas por humano", () => {
    test("cuenta sesiones de la ventana, no mensajes", async () => {
      const m = await svc(
        [sesion({ id: "a" }), sesion({ id: "b" }), sesion({ id: "c" })],
        [
          mensaje({ sender: "humano", lead_session_id: "a" }),
          mensaje({ sender: "humano", lead_session_id: "a" }),
          mensaje({ sender: "humano", lead_session_id: "b" }),
        ],
      ).obtener(30, AHORA);

      expect(m.tomadasPorHumano).toBe(2);
    });

    test("un humano escribiendo en una sesión vieja no infla el conteo de la ventana", async () => {
      const m = await svc(
        [sesion({ id: "nueva" }), sesion({ id: "vieja", started_at: haceDias(40) })],
        [mensaje({ sender: "humano", lead_session_id: "vieja" })],
      ).obtener(30, AHORA);

      expect(m.tomadasPorHumano).toBe(0);
    });

    test("pedir humano sin que nadie escriba no cuenta como tomada", async () => {
      const m = await svc([sesion({ id: "a", current_stage: "requiere_humano" })]).obtener(
        30,
        AHORA,
      );

      expect(m.tomadasPorHumano).toBe(0);
      expect(m.agente.escaladas).toBe(1);
    });
  });

  describe("cómo se resolvió cada turno", () => {
    test("las reglas se descuentan de lo que mandó la IA y el resto es LLM", async () => {
      const m = await svc(
        [],
        [
          mensaje({ sender: "ia" }),
          mensaje({ sender: "ia" }),
          mensaje({ sender: "ia" }),
          mensaje({ sender: "humano" }),
          mensaje({ sender: "lead" }),
        ],
        [],
        [{ created_at: haceDias(1) }],
      ).obtener(30, AHORA);

      expect(m.turnos).toEqual({ regla: 1, llm: 2, escalado: 1 });
    });

    test("sin reglas ejecutadas todo lo de la IA es LLM", async () => {
      const m = await svc([], [mensaje({ sender: "ia" }), mensaje({ sender: "ia" })]).obtener(
        30,
        AHORA,
      );

      expect(m.turnos).toEqual({ regla: 0, llm: 2, escalado: 0 });
    });

    test("más reglas que mensajes de IA no produce un LLM negativo", async () => {
      // Desfase de borde: la regla se audita contra el entrante y su saliente
      // puede haber quedado fuera de la ventana.
      const m = await svc(
        [],
        [mensaje({ sender: "ia" })],
        [],
        [{ created_at: haceDias(1) }, { created_at: haceDias(2) }, { created_at: haceDias(3) }],
      ).obtener(30, AHORA);

      expect(m.turnos).toEqual({ regla: 1, llm: 0, escalado: 0 });
    });

    test("las reglas fuera de la ventana no cuentan", async () => {
      const m = await svc(
        [],
        [mensaje({ sender: "ia" }), mensaje({ sender: "ia" })],
        [],
        [{ created_at: haceDias(1) }, { created_at: haceDias(60) }],
      ).obtener(30, AHORA);

      expect(m.turnos).toEqual({ regla: 1, llm: 1, escalado: 0 });
    });
  });

  describe("uso de herramientas", () => {
    test("agrupa por nombre, separa las fallidas y ordena por llamadas", async () => {
      const m = await svc(
        [],
        [],
        [],
        [],
        [
          { tool_name: "buscar_repuesto", created_at: haceDias(1), error: null },
          { tool_name: "buscar_repuesto", created_at: haceDias(1), error: null },
          { tool_name: "buscar_repuesto", created_at: haceDias(2), error: "timeout" },
          { tool_name: "cotizar", created_at: haceDias(1), error: null },
        ],
      ).obtener(30, AHORA);

      expect(m.herramientas).toEqual([
        { nombre: "buscar_repuesto", llamadas: 3, fallidas: 1 },
        { nombre: "cotizar", llamadas: 1, fallidas: 0 },
      ]);
    });

    test("las llamadas fuera de la ventana no cuentan", async () => {
      const m = await svc(
        [],
        [],
        [],
        [],
        [
          { tool_name: "buscar_repuesto", created_at: haceDias(1), error: null },
          { tool_name: "buscar_repuesto", created_at: haceDias(90), error: null },
        ],
      ).obtener(30, AHORA);

      expect(m.herramientas).toEqual([{ nombre: "buscar_repuesto", llamadas: 1, fallidas: 0 }]);
    });

    test("sin llamadas la lista viene vacía, no con ceros inventados", async () => {
      const m = await svc().obtener(30, AHORA);
      expect(m.herramientas).toEqual([]);
    });
  });

  describe("intents sin regla", () => {
    test("deja fuera los intents que ya tiene cubiertos una regla activa", async () => {
      const m = await svc(
        [],
        [],
        [],
        [],
        [],
        [
          intent({ id: "cubierto", nombre: "saludo" }),
          intent({ id: "suelto", nombre: "consulta_garantia" }),
        ],
        [{ intent_id: "cubierto" }],
      ).obtener(30, AHORA);

      expect(m.intentsSinRegla.map((i) => i.nombre)).toEqual(["consulta_garantia"]);
    });

    test("una regla inactiva no cuenta como cobertura", async () => {
      // El repo solo devuelve reglas activas, así que un intent cuya única
      // regla está apagada llega sin cobertura y tiene que aparecer en la lista.
      const m = await svc([], [], [], [], [], [intent({ id: "suelto" })], []).obtener(30, AHORA);

      expect(m.intentsSinRegla).toHaveLength(1);
    });

    test("ordena del más nuevo al más viejo", async () => {
      const m = await svc(
        [],
        [],
        [],
        [],
        [],
        [
          intent({ id: "a", nombre: "viejo", created_at: haceDias(40) }),
          intent({ id: "b", nombre: "nuevo", created_at: haceDias(1) }),
          intent({ id: "c", nombre: "medio", created_at: haceDias(10) }),
        ],
        [],
      ).obtener(30, AHORA);

      expect(m.intentsSinRegla.map((i) => i.nombre)).toEqual(["nuevo", "medio", "viejo"]);
    });

    test("un intent detectado fuera de la ventana igual aparece: es configuración, no un evento", async () => {
      const m = await svc(
        [],
        [],
        [],
        [],
        [],
        [intent({ id: "a", created_at: haceDias(400) })],
        [],
      ).obtener(30, AHORA);

      expect(m.intentsSinRegla).toHaveLength(1);
    });

    test("expone el origen del intent para poder distinguir los auto-detectados", async () => {
      const m = await svc(
        [],
        [],
        [],
        [],
        [],
        [intent({ id: "a", auto_detectado: true, created_at: haceDias(2) })],
        [],
      ).obtener(30, AHORA);

      expect(m.intentsSinRegla[0]).toMatchObject({
        nombre: "consulta_precio",
        autoDetectado: true,
        detectadoEl: haceDias(2),
      });
    });

    test("con todo cubierto la lista viene vacía", async () => {
      const m = await svc([], [], [], [], [], [intent({ id: "a" })], [{ intent_id: "a" }]).obtener(
        30,
        AHORA,
      );

      expect(m.intentsSinRegla).toEqual([]);
    });
  });
});
