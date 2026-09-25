import { describe, expect, test } from "vitest";
import { BudgetExceededError, IllegalStateError, ValidationError } from "@/lib/errors";
import type { OrigenSupresion } from "@/lib/difusion/modelo";
import {
  POLITICA_POR_DEFECTO,
  planificarDifusion,
  verificarInvariantesPlan,
  type CandidatoDifusion,
  type EntradaPlanificador,
  type PlanDifusion,
} from "@/lib/difusion/planificador";
import { normalizarTelefonoWhatsApp } from "@/lib/difusion/telefono";
import { CURRENT_STAGE, type CurrentStage } from "@/types/domain";

const AHORA = new Date("2026-09-13T12:00:00.000Z");
const HORA = 3_600_000;
const haceMinutos = (m: number) => new Date(AHORA.getTime() - m * 60_000);
const haceHoras = (h: number) => new Date(AHORA.getTime() - h * HORA);

/** Un E.164 válido y distinto por número de lead. */
function tel(n: number): string {
  return `593990${String(n).padStart(6, "0")}`;
}

function id(n: number): string {
  return `lead-${String(n).padStart(5, "0")}`;
}

function lead(n: number, over: Partial<CandidatoDifusion> = {}): CandidatoDifusion {
  return {
    leadId: id(n),
    telefono: tel(n),
    etapa: null,
    ultimoEntranteAt: null,
    salientesAutomaticos24h: 0,
    ...over,
  };
}

function entrada(
  audiencia: CandidatoDifusion[],
  over: Partial<EntradaPlanificador> = {},
): EntradaPlanificador {
  return {
    ahora: AHORA,
    audiencia,
    supresiones: [],
    saturaciones: [],
    cupo: { restante: 10_000, reserva: 0 },
    maxSalientesAutomaticos24h: 3,
    plantilla: { categoria: "marketing" },
    ...over,
  };
}

function motivo(plan: PlanDifusion, n: number) {
  return plan.exclusiones.find((e) => e.leadId === id(n))?.motivo;
}

function recibe(plan: PlanDifusion, n: number): boolean {
  return plan.destinatarios.some((d) => d.leadId === id(n));
}

function destinatario(plan: PlanDifusion, n: number) {
  const d = plan.destinatarios.find((x) => x.leadId === id(n));
  if (!d) throw new Error(`${id(n)} no recibe`);
  return d;
}

describe("planificarDifusion — cada lead termina en un solo lugar", () => {
  test("sin audiencia no hay destinatarios ni tandas", () => {
    const plan = planificarDifusion(entrada([]));
    expect(plan.audienciaInicial).toBe(0);
    expect(plan.destinatarios).toEqual([]);
    expect(plan.exclusiones).toEqual([]);
    expect(plan.tandas).toEqual([]);
  });

  test("tres leads limpios salen los tres, por plantilla, en la tanda de hoy", () => {
    const plan = planificarDifusion(entrada([lead(1), lead(2), lead(3)]));

    expect(plan.destinatarios.map((d) => d.leadId).sort()).toEqual([id(1), id(2), id(3)]);
    expect(plan.destinatarios.every((d) => d.ruta === "plantilla" && d.tanda === 0)).toBe(true);
    expect(plan.tandas).toEqual([
      { tanda: 0, desde: AHORA, porPlantilla: 3, porVentanaAbierta: 0 },
    ]);
    expect(plan.cupo.solicitado).toBe(3);
  });

  test("audiencia = destinatarios + excluidos, y el desglose por motivo suma lo excluido", () => {
    const audiencia = [
      lead(1),
      lead(2, { etapa: "requiere_humano" }),
      lead(3, { telefono: tel(1) }),
      lead(4, { telefono: "ig:17841400000000" }),
      lead(5, { salientesAutomaticos24h: 9 }),
    ];
    const plan = planificarDifusion(entrada(audiencia));

    expect(plan.audienciaInicial).toBe(5);
    expect(plan.destinatarios.length + plan.exclusiones.length).toBe(5);
    const todos = [
      ...plan.destinatarios.map((d) => d.leadId),
      ...plan.exclusiones.map((e) => e.leadId),
    ];
    expect(todos.sort()).toEqual(audiencia.map((l) => l.leadId).sort());
    const sumaMotivos = Object.values(plan.exclusionesPorMotivo).reduce((a, b) => a + b, 0);
    expect(sumaMotivos).toBe(plan.exclusiones.length);
    expect(plan.exclusionesPorMotivo.requiere_humano).toBe(1);
    expect(plan.exclusionesPorMotivo.duplicado_telefono).toBe(1);
    expect(plan.exclusionesPorMotivo.sin_telefono).toBe(1);
    expect(plan.exclusionesPorMotivo.cap_frecuencia).toBe(1);
  });
});

describe("bajas: irrenunciables", () => {
  const TODAS_LAS_EXENCIONES = { incluirEnNegociacion: true, exentaTopeFrecuencia: true } as const;

  test("una baja propia excluye aunque la campaña se exima de todo lo eximible", () => {
    const plan = planificarDifusion(
      entrada([lead(1)], {
        ...TODAS_LAS_EXENCIONES,
        supresiones: [{ telefono: tel(1), origen: "palabra_clave" }],
      }),
    );
    expect(motivo(plan, 1)).toBe("baja_propia");
    expect(plan.destinatarios).toEqual([]);
  });

  test.each([
    ["palabra_clave", "baja_propia"],
    ["boton_baja", "baja_propia"],
    ["manual", "baja_propia"],
    ["meta_131050", "baja_meta"],
    ["meta_preferencias", "baja_meta"],
  ] as const)("origen %s → %s", (origen, esperado) => {
    const plan = planificarDifusion(
      entrada([lead(1)], { supresiones: [{ telefono: tel(1), origen }] }),
    );
    expect(motivo(plan, 1)).toBe(esperado);
  });

  // "Un lead dado de baja no vuelve a entrar a ninguna audiencia, ni por import
  // de CSV ni por API" (PRD §13): el import crea otro lead, con otro id, y
  // muchas veces con el número escrito de otra forma.
  test("la baja es de la persona: un lead nuevo con el mismo número en otro formato tampoco recibe", () => {
    const reimportado = lead(900, { telefono: "+593 990-000 001" });
    const plan = planificarDifusion(
      entrada([reimportado], { supresiones: [{ telefono: tel(1), origen: "palabra_clave" }] }),
    );
    expect(motivo(plan, 900)).toBe("baja_propia");
  });

  test("con baja propia y de Meta a la vez se informa la propia", () => {
    const plan = planificarDifusion(
      entrada([lead(1)], {
        supresiones: [
          { telefono: tel(1), origen: "meta_131050" },
          { telefono: tel(1), origen: "palabra_clave" },
        ],
      }),
    );
    expect(motivo(plan, 1)).toBe("baja_propia");
  });
});

describe("estado de la conversación (§6.1)", () => {
  test("requiere_humano no recibe nunca, ni con todas las exenciones", () => {
    const plan = planificarDifusion(
      entrada([lead(1, { etapa: "requiere_humano" })], {
        incluirEnNegociacion: true,
        exentaTopeFrecuencia: true,
      }),
    );
    expect(motivo(plan, 1)).toBe("requiere_humano");
  });

  test.each(["negociando", "esperando_pago"] as const)("%s se excluye por defecto", (etapa) => {
    const plan = planificarDifusion(entrada([lead(1, { etapa })]));
    expect(motivo(plan, 1)).toBe("en_negociacion");
  });

  test.each(["negociando", "esperando_pago"] as const)(
    "%s recibe si la campaña lo fuerza explícitamente",
    (etapa) => {
      const plan = planificarDifusion(
        entrada([lead(1, { etapa })], { incluirEnNegociacion: true }),
      );
      expect(recibe(plan, 1)).toBe(true);
    },
  );

  test.each(["nuevo", "identificando", "cotizado", "cerrado", "perdido"] as const)(
    "%s no excluye por sí sola",
    (etapa) => {
      const plan = planificarDifusion(entrada([lead(1, { etapa })]));
      expect(recibe(plan, 1)).toBe(true);
    },
  );

  test("sesión activa con un entrante reciente es conversación activa", () => {
    const plan = planificarDifusion(
      entrada([lead(1, { etapa: "cotizado", ultimoEntranteAt: haceMinutos(10) })]),
    );
    expect(motivo(plan, 1)).toBe("conversacion_activa");
  });

  test("sesión activa pero callada hace horas: recibe, y gratis por la ventana abierta", () => {
    const plan = planificarDifusion(
      entrada([lead(1, { etapa: "cotizado", ultimoEntranteAt: haceHoras(3) })]),
    );
    expect(destinatario(plan, 1).ruta).toBe("ventana_abierta");
  });

  test("sin sesión activa, un entrante reciente no es conversación activa", () => {
    const plan = planificarDifusion(
      entrada([lead(1, { etapa: null, ultimoEntranteAt: haceMinutos(5) })]),
    );
    expect(destinatario(plan, 1).ruta).toBe("ventana_abierta");
  });

  test("la ventana de conversación activa se ajusta por política", () => {
    const plan = planificarDifusion(
      entrada([lead(1, { etapa: "cotizado", ultimoEntranteAt: haceHoras(3) })], {
        politica: { conversacionActivaMinutos: 240 },
      }),
    );
    expect(motivo(plan, 1)).toBe("conversacion_activa");
  });
});

describe("un teléfono, un mensaje (§7.4)", () => {
  test("dos leads con el mismo teléfono reciben uno", () => {
    const plan = planificarDifusion(entrada([lead(1), lead(2, { telefono: tel(1) })]));
    expect(plan.destinatarios).toHaveLength(1);
    expect(plan.exclusiones.map((e) => e.motivo)).toEqual(["duplicado_telefono"]);
  });

  test("recibe el lead con el entrante más reciente, que es donde vive la conversación", () => {
    const plan = planificarDifusion(
      entrada([
        lead(1, { ultimoEntranteAt: haceHoras(40) }),
        lead(2, { telefono: tel(1), ultimoEntranteAt: haceHoras(30) }),
      ]),
    );
    expect(recibe(plan, 2)).toBe(true);
    expect(motivo(plan, 1)).toBe("duplicado_telefono");
  });

  test("el mismo número escrito de tres formas es la misma persona", () => {
    const plan = planificarDifusion(
      entrada([
        lead(1, { telefono: "593990000001" }),
        lead(2, { telefono: "+593 990 000 001" }),
        lead(3, { telefono: "(593) 990-000-001" }),
      ]),
    );
    expect(plan.destinatarios).toHaveLength(1);
    expect(plan.exclusionesPorMotivo.duplicado_telefono).toBe(2);
  });

  // El chat de WhatsApp es del número, no del registro: mandarle al segundo
  // lead es mandarle a la misma persona que está con un vendedor.
  test("si un lead del teléfono requiere humano, no recibe ninguno", () => {
    const plan = planificarDifusion(
      entrada([lead(1, { etapa: "requiere_humano" }), lead(2, { telefono: tel(1) })]),
    );
    expect(plan.destinatarios).toEqual([]);
    expect(motivo(plan, 1)).toBe("requiere_humano");
    expect(motivo(plan, 2)).toBe("duplicado_telefono");
  });

  test("si un lead del teléfono está en conversación activa, el otro tampoco recibe", () => {
    const plan = planificarDifusion(
      entrada([
        lead(1, { etapa: "cotizado", ultimoEntranteAt: haceMinutos(2) }),
        lead(2, { telefono: tel(1) }),
      ]),
    );
    expect(plan.destinatarios).toEqual([]);
    expect(motivo(plan, 1)).toBe("conversacion_activa");
    expect(motivo(plan, 2)).toBe("duplicado_telefono");
  });
});

describe("tope de frecuencia (max_salientes_automaticos_24h)", () => {
  test("con los salientes automáticos del día en el tope, no recibe", () => {
    const plan = planificarDifusion(entrada([lead(1, { salientesAutomaticos24h: 3 })]));
    expect(motivo(plan, 1)).toBe("cap_frecuencia");
  });

  test("uno por debajo del tope, recibe", () => {
    const plan = planificarDifusion(entrada([lead(1, { salientesAutomaticos24h: 2 })]));
    expect(recibe(plan, 1)).toBe(true);
  });

  test("el tope es por persona: se suman los salientes de todos sus leads", () => {
    const plan = planificarDifusion(
      entrada([
        lead(1, { salientesAutomaticos24h: 2 }),
        lead(2, { telefono: tel(1), salientesAutomaticos24h: 1 }),
      ]),
    );
    expect(plan.destinatarios).toEqual([]);
    expect(motivo(plan, 1)).toBe("cap_frecuencia");
    expect(motivo(plan, 2)).toBe("cap_frecuencia");
  });

  test("la exención explícita de la campaña lo deja pasar", () => {
    const plan = planificarDifusion(
      entrada([lead(1, { salientesAutomaticos24h: 7 })], { exentaTopeFrecuencia: true }),
    );
    expect(recibe(plan, 1)).toBe(true);
  });
});

describe("ruta: gratis por ventana abierta antes que plantilla paga (§7.3.5)", () => {
  test("con un entrante de hace 2 h va por ventana abierta y no consume cupo", () => {
    const plan = planificarDifusion(
      entrada([lead(1, { ultimoEntranteAt: haceHoras(2) })], { cupo: { restante: 0, reserva: 0 } }),
    );
    expect(destinatario(plan, 1).ruta).toBe("ventana_abierta");
    expect(plan.cupo.solicitado).toBe(0);
    expect(plan.porRuta).toEqual({ ventana_abierta: 1, plantilla: 0 });
  });

  test("una ventana que se cierra dentro del margen se trata como cerrada", () => {
    // Se cierra en 30 min; el margen por defecto es mayor.
    expect(POLITICA_POR_DEFECTO.margenVentanaMinutos).toBeGreaterThan(30);
    const plan = planificarDifusion(
      entrada([lead(1, { ultimoEntranteAt: haceMinutos(24 * 60 - 30) })]),
    );
    expect(destinatario(plan, 1).ruta).toBe("plantilla");
  });

  test("sin plantilla, a quien no tiene la ventana abierta no se le puede escribir", () => {
    const plan = planificarDifusion(
      entrada([lead(1), lead(2, { ultimoEntranteAt: haceHoras(1) })], { plantilla: null }),
    );
    expect(motivo(plan, 1)).toBe("sin_ventana");
    expect(destinatario(plan, 2).ruta).toBe("ventana_abierta");
  });

  test("soloVentanaAbierta excluye a los que irían por plantilla paga", () => {
    const plan = planificarDifusion(
      entrada([lead(1), lead(2, { ultimoEntranteAt: haceHoras(1) })], { soloVentanaAbierta: true }),
    );
    expect(motivo(plan, 1)).toBe("sin_ventana");
    expect(recibe(plan, 2)).toBe(true);
  });
});

describe("saturación del cap de marketing de Meta (131049)", () => {
  const saturado = (horas: number) => [{ telefono: tel(1), ultimoAt: haceHoras(horas) }];

  test("un 131049 de hace 5 h excluye si iría por plantilla de marketing", () => {
    const plan = planificarDifusion(entrada([lead(1)], { saturaciones: saturado(5) }));
    expect(motivo(plan, 1)).toBe("saturado_meta");
  });

  test("con plantilla utility no aplica: ese cap es sólo de marketing", () => {
    const plan = planificarDifusion(
      entrada([lead(1)], { saturaciones: saturado(5), plantilla: { categoria: "utility" } }),
    );
    expect(recibe(plan, 1)).toBe(true);
  });

  test("con la ventana abierta sale gratis aunque esté saturado: el mensaje libre no cuenta", () => {
    const plan = planificarDifusion(
      entrada([lead(1, { ultimoEntranteAt: haceHoras(2) })], { saturaciones: saturado(1) }),
    );
    expect(destinatario(plan, 1).ruta).toBe("ventana_abierta");
  });

  test("un 131049 de hace más de 24 h ya no excluye", () => {
    const plan = planificarDifusion(entrada([lead(1)], { saturaciones: saturado(25) }));
    expect(recibe(plan, 1)).toBe(true);
  });
});

describe("sin teléfono de WhatsApp", () => {
  test.each([["ig:17841400000000"], ["fb:1234567890"], [null], ["0991234567"]])(
    "%s → sin_telefono",
    (telefono) => {
      const plan = planificarDifusion(entrada([lead(1, { telefono })]));
      expect(motivo(plan, 1)).toBe("sin_telefono");
      expect(plan.exclusiones[0]?.telefono).toBeNull();
    },
  );
});

describe("cupo y reparto por tandas", () => {
  function muchos(n: number): CandidatoDifusion[] {
    return Array.from({ length: n }, (_, i) => lead(i + 1));
  }

  // Criterio de aceptación de §13: "5.000 destinatarios con cupo de 2.000 se
  // reparte en el tiempo, no falla".
  test("5.000 destinatarios con 2.000 de cupo se reparten en tres días", () => {
    const plan = planificarDifusion(
      entrada(muchos(5000), { cupo: { restante: 2000, reserva: 0 } }),
    );

    expect(plan.destinatarios).toHaveLength(5000);
    expect(plan.tandas.map((t) => t.porPlantilla)).toEqual([2000, 2000, 1000]);
    expect(plan.tandas.map((t) => t.desde)).toEqual([
      AHORA,
      new Date(AHORA.getTime() + 24 * HORA),
      new Date(AHORA.getTime() + 48 * HORA),
    ]);
  });

  // El ejemplo de docs/prd-workflows.md §7.4, número por número.
  test("1.850 restantes y 300 de reserva dan 1.550 · 1.550 · 473", () => {
    const plan = planificarDifusion(
      entrada(muchos(3573), { cupo: { restante: 1850, reserva: 300 } }),
    );
    expect(plan.cupo.porTanda).toBe(1550);
    expect(plan.tandas.map((t) => t.porPlantilla)).toEqual([1550, 1550, 473]);
  });

  test("los de ventana abierta salen en la primera tanda aunque la plantilla se reparta", () => {
    const audiencia = [
      lead(1),
      lead(2),
      lead(3),
      lead(4, { ultimoEntranteAt: haceHoras(1) }),
      lead(5, { ultimoEntranteAt: haceHoras(2) }),
    ];
    const plan = planificarDifusion(entrada(audiencia, { cupo: { restante: 2, reserva: 0 } }));

    expect(plan.tandas).toEqual([
      { tanda: 0, desde: AHORA, porPlantilla: 2, porVentanaAbierta: 2 },
      {
        tanda: 1,
        desde: new Date(AHORA.getTime() + 24 * HORA),
        porPlantilla: 1,
        porVentanaAbierta: 0,
      },
    ]);
  });

  test("cuando no entra todo, sale primero quien escribió más recientemente", () => {
    const plan = planificarDifusion(
      entrada(
        [
          lead(1, { ultimoEntranteAt: haceHoras(40) }),
          lead(2, { ultimoEntranteAt: haceHoras(30) }),
        ],
        {
          cupo: { restante: 1, reserva: 0 },
        },
      ),
    );
    expect(destinatario(plan, 2).tanda).toBe(0);
    expect(destinatario(plan, 1).tanda).toBe(1);
  });

  test("el plan no depende del orden en que llega la audiencia", () => {
    const audiencia = [
      lead(1, { ultimoEntranteAt: haceHoras(30) }),
      lead(2),
      lead(3, { telefono: tel(2) }),
      lead(4, { ultimoEntranteAt: haceHoras(2) }),
      lead(5, { etapa: "negociando" }),
      lead(6, { ultimoEntranteAt: haceHoras(50) }),
    ];
    const cupo = { restante: 2, reserva: 0 };
    const a = planificarDifusion(entrada(audiencia, { cupo }));
    const b = planificarDifusion(entrada([...audiencia].reverse(), { cupo }));
    expect(b).toEqual(a);
  });

  test("cada destinatario lleva la fecha de inicio de su tanda", () => {
    const plan = planificarDifusion(entrada(muchos(7), { cupo: { restante: 3, reserva: 0 } }));
    for (const d of plan.destinatarios) {
      expect(d.programadoPara).toEqual(plan.tandas[d.tanda]?.desde);
    }
  });

  test("si la reserva se come el cupo y hay a quién mandarle plantilla, frena", () => {
    expect(() =>
      planificarDifusion(entrada([lead(1)], { cupo: { restante: 300, reserva: 300 } })),
    ).toThrow(BudgetExceededError);
  });

  test("sin cupo igual se planifica a los que tienen la ventana abierta", () => {
    const plan = planificarDifusion(
      entrada([lead(1, { ultimoEntranteAt: haceHoras(1) })], {
        cupo: { restante: 0, reserva: 50 },
      }),
    );
    expect(plan.destinatarios).toHaveLength(1);
  });
});

describe("invariante del postmortem de Buttondown (§7.4): los destinatarios nunca superan la audiencia", () => {
  // Una resolución de audiencia con un JOIN a etiquetas devuelve al lead una
  // vez por etiqueta. Es la clase de bug que multiplicó los envíos de Buttondown.
  test("una audiencia con el mismo lead repetido aborta antes de planificar", () => {
    expect(() => planificarDifusion(entrada([lead(1), lead(1)]))).toThrow(IllegalStateError);
  });

  const audiencia = [lead(1), lead(2), lead(3)];
  const base = () =>
    planificarDifusion(
      entrada(audiencia, { supresiones: [{ telefono: tel(3), origen: "palabra_clave" }] }),
    );

  test("el plan que devuelve el planificador pasa la verificación", () => {
    expect(() => verificarInvariantesPlan(audiencia, base())).not.toThrow();
  });

  test("más destinatarios que audiencia aborta", () => {
    // La base tiene 2 destinatarios sobre 3 leads: hacen falta dos intrusos
    // para que M supere a N (con uno solo, M = N y la regla no se dispara).
    const plan = base();
    plan.destinatarios.push(
      { ...plan.destinatarios[0]!, leadId: "intruso-1", telefono: "593990999998" },
      { ...plan.destinatarios[0]!, leadId: "intruso-2", telefono: "593990999999" },
    );
    expect(() => verificarInvariantesPlan(audiencia, plan)).toThrow(/destinatarios/);
    expect(() => verificarInvariantesPlan(audiencia, plan)).toThrow(IllegalStateError);
  });

  test("un destinatario que no estaba en la audiencia aborta", () => {
    const plan = base();
    plan.destinatarios[0] = { ...plan.destinatarios[0]!, leadId: "de-otra-audiencia" };
    expect(() => verificarInvariantesPlan(audiencia, plan)).toThrow(IllegalStateError);
  });

  test("el mismo lead como destinatario y como excluido aborta", () => {
    const plan = base();
    plan.exclusiones[0] = { ...plan.exclusiones[0]!, leadId: plan.destinatarios[0]!.leadId };
    expect(() => verificarInvariantesPlan(audiencia, plan)).toThrow(IllegalStateError);
  });

  test("dos destinatarios con el mismo teléfono abortan", () => {
    const plan = base();
    plan.destinatarios[1] = {
      ...plan.destinatarios[1]!,
      telefono: plan.destinatarios[0]!.telefono,
    };
    expect(() => verificarInvariantesPlan(audiencia, plan)).toThrow(IllegalStateError);
  });

  test("tandas que no suman los destinatarios abortan", () => {
    const plan = base();
    plan.tandas[0] = { ...plan.tandas[0]!, porPlantilla: plan.tandas[0]!.porPlantilla + 1 };
    expect(() => verificarInvariantesPlan(audiencia, plan)).toThrow(IllegalStateError);
  });

  test("una tanda con más plantillas que el cupo aborta", () => {
    const plan = base();
    plan.cupo.porTanda = 1;
    expect(() => verificarInvariantesPlan(audiencia, plan)).toThrow(IllegalStateError);
  });

  test("un lead que se pierde en el camino aborta", () => {
    const plan = base();
    plan.exclusiones.pop();
    expect(() => verificarInvariantesPlan(audiencia, plan)).toThrow(IllegalStateError);
  });

  // No reemplaza a los casos de arriba: los complementa con combinaciones que
  // nadie escribiría a mano (teléfonos compartidos entre leads en negociación,
  // placeholders, bajas cruzadas, cupo justo).
  test("sobre 300 audiencias al azar el plan cumple todas las reglas duras", () => {
    const ORIGENES: OrigenSupresion[] = [
      "palabra_clave",
      "boton_baja",
      "manual",
      "meta_131050",
      "meta_preferencias",
    ];
    const ETAPAS: (CurrentStage | null)[] = [null, ...CURRENT_STAGE];

    for (let semilla = 1; semilla <= 300; semilla++) {
      const r = mulberry32(semilla);
      const pozo = Array.from({ length: 1 + Math.floor(r() * 25) }, (_, i) => tel(i + 1));
      const escoger = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;

      const audiencia: CandidatoDifusion[] = Array.from(
        { length: Math.floor(r() * 60) },
        (_, i) => {
          const dado = r();
          const telefono =
            dado < 0.05
              ? null
              : dado < 0.1
                ? `ig:${1000 + i}`
                : dado < 0.2
                  ? `+${escoger(pozo)}`
                  : escoger(pozo);
          return lead(i + 1, {
            telefono,
            etapa: escoger(ETAPAS),
            ultimoEntranteAt: r() < 0.3 ? null : haceMinutos(Math.floor(r() * 72 * 60)),
            salientesAutomaticos24h: Math.floor(r() * 5),
          });
        },
      );
      const supresiones = pozo
        .filter(() => r() < 0.15)
        .map((telefono) => ({ telefono, origen: escoger(ORIGENES) }));
      const saturaciones = pozo
        .filter(() => r() < 0.15)
        .map((telefono) => ({ telefono, ultimoAt: haceHoras(r() * 48) }));
      const e = entrada(audiencia, {
        supresiones,
        saturaciones,
        cupo: { restante: 5 + Math.floor(r() * 40), reserva: Math.floor(r() * 5) },
        incluirEnNegociacion: r() < 0.5,
        exentaTopeFrecuencia: r() < 0.5,
        soloVentanaAbierta: r() < 0.2,
        plantilla: escoger([null, { categoria: "marketing" }, { categoria: "utility" }] as const),
      });

      const plan = planificarDifusion(e);

      expect(() => verificarInvariantesPlan(e.audiencia, plan)).not.toThrow();
      expect(plan.destinatarios.length).toBeLessThanOrEqual(e.audiencia.length);

      const suprimidos = new Set(supresiones.map((s) => s.telefono));
      const bloqueados = new Set(
        audiencia
          .filter(
            (l) =>
              l.etapa === "requiere_humano" ||
              (l.etapa !== null &&
                l.ultimoEntranteAt !== null &&
                AHORA.getTime() - l.ultimoEntranteAt.getTime() <=
                  POLITICA_POR_DEFECTO.conversacionActivaMinutos * 60_000),
          )
          .map((l) => normalizarTelefonoWhatsApp(l.telefono))
          .filter((t): t is string => t !== null),
      );
      for (const d of plan.destinatarios) {
        expect(suprimidos.has(d.telefono), `semilla ${semilla}: ${d.telefono} tiene baja`).toBe(
          false,
        );
        expect(
          bloqueados.has(d.telefono),
          `semilla ${semilla}: ${d.telefono} está con una persona o en conversación`,
        ).toBe(false);
      }
    }
  });
});

describe("entrada inválida", () => {
  test.each([
    ["restante negativo", { cupo: { restante: -1, reserva: 0 } }],
    ["reserva no entera", { cupo: { restante: 10, reserva: 1.5 } }],
    ["tope de salientes en cero", { maxSalientesAutomaticos24h: 0 }],
    ["fecha inválida", { ahora: new Date("no es una fecha") }],
    ["política negativa", { politica: { margenVentanaMinutos: -5 } }],
  ] as const)("%s → ValidationError", (_, over) => {
    expect(() =>
      planificarDifusion(entrada([lead(1)], over as Partial<EntradaPlanificador>)),
    ).toThrow(ValidationError);
  });

  test("salientes negativos → ValidationError", () => {
    expect(() => planificarDifusion(entrada([lead(1, { salientesAutomaticos24h: -1 })]))).toThrow(
      ValidationError,
    );
  });
});

/** PRNG determinístico: la misma semilla da la misma audiencia en cada corrida. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
