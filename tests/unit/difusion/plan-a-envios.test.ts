import { describe, expect, test } from "vitest";
import { planificarDifusion, type CandidatoDifusion } from "@/lib/difusion/planificador";
import {
  InMemoryDifusionEnviosRepository,
  filasDesdePlan,
} from "@/server/repositories/difusion-envios.repo";

const AHORA = new Date("2026-09-13T12:00:00.000Z");

function lead(n: number, over: Partial<CandidatoDifusion> = {}): CandidatoDifusion {
  return {
    leadId: `lead-${n}`,
    telefono: `593990${String(n).padStart(6, "0")}`,
    etapa: null,
    ultimoEntranteAt: null,
    salientesAutomaticos24h: 0,
    ...over,
  };
}

function plan() {
  return planificarDifusion({
    ahora: AHORA,
    audiencia: [
      lead(1),
      lead(2, { ultimoEntranteAt: new Date(AHORA.getTime() - 3_600_000) }),
      lead(3, { telefono: "593990000001" }),
      lead(4, { telefono: "ig:17841400000000" }),
      lead(5, { etapa: "requiere_humano" }),
      lead(6),
    ],
    supresiones: [],
    saturaciones: [],
    cupo: { restante: 2, reserva: 0 },
    maxSalientesAutomaticos24h: 3,
    plantilla: { categoria: "marketing" },
  });
}

describe("filasDesdePlan: el plan como filas de difusion_envios", () => {
  test("una fila por lead de la audiencia inicial", () => {
    const p = plan();
    const filas = filasDesdePlan("difusion-1", p);

    expect(filas).toHaveLength(p.audienciaInicial);
    expect(new Set(filas.map((f) => f.lead_id)).size).toBe(p.audienciaInicial);
    expect(filas.every((f) => f.difusion_id === "difusion-1")).toBe(true);
  });

  test("los destinatarios entran en cola con su ruta, su tanda y su fecha", () => {
    const p = plan();
    const filas = filasDesdePlan("difusion-1", p);

    for (const d of p.destinatarios) {
      const f = filas.find((x) => x.lead_id === d.leadId);
      expect(f).toEqual({
        difusion_id: "difusion-1",
        lead_id: d.leadId,
        telefono: d.telefono,
        estado: "en_cola",
        motivo_exclusion: null,
        ruta: d.ruta,
        tanda: d.tanda,
        programado_para: d.programadoPara,
      });
    }
  });

  test("los excluidos entran con su motivo y sin plan", () => {
    const p = plan();
    const filas = filasDesdePlan("difusion-1", p);

    for (const e of p.exclusiones) {
      const f = filas.find((x) => x.lead_id === e.leadId);
      expect(f?.estado).toBe("excluido");
      expect(f?.motivo_exclusion).toBe(e.motivo);
      expect(f?.telefono).toBe(e.telefono);
      expect([f?.ruta, f?.tanda, f?.programado_para]).toEqual([null, null, null]);
    }
  });

  // El lazo completo sin base: lo que decide el planificador lo acepta el
  // repositorio (que replica los CHECK de la tabla), y el conteo coincide.
  test("el repositorio acepta el plan y el conteo coincide con el del planificador", async () => {
    const p = plan();
    const repo = new InMemoryDifusionEnviosRepository();

    await repo.registrarPlan(filasDesdePlan("difusion-1", p));
    const conteo = await repo.contarPorDifusion("difusion-1");

    expect(conteo.total).toBe(p.audienciaInicial);
    expect(conteo.porEstado.en_cola).toBe(p.destinatarios.length);
    expect(conteo.porMotivo).toEqual(p.exclusionesPorMotivo);
  });
});
