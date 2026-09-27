import { describe, expect, it, vi } from "vitest";
import { crearPuertosDelegacion } from "@/server/services/workflows/puertos-delegacion";
import type { HandoffEvent, LlmUsage } from "@/types/entities";

/**
 * Los puertos de lectura de "Delegar al agente" en producción: el motivo de la
 * última pausa, el gasto de la sesión, el del día y el tope diario del agente.
 */

function evento(over: Partial<HandoffEvent>): HandoffEvent {
  return {
    id: "e",
    lead_session_id: "s1",
    action: "pause",
    reason_code: "other",
    source: "admin",
    previous_stage: null,
    actor_user_id: null,
    source_event_key: "k",
    created_at: new Date("2026-09-26T10:00:00Z"),
    ...over,
  };
}

function uso(costo_usd: number): LlmUsage {
  return { costo_usd } as LlmUsage;
}

function armar(eventos: HandoffEvent[] = [], filasDelDia: LlmUsage[] = []) {
  const listDesde = vi.fn(async () => filasDelDia);
  const puertos = crearPuertosDelegacion({
    handoffEvents: { listBySessionIds: vi.fn(async () => eventos) },
    llmUsage: {
      resumenPorLeadSession: vi.fn(async () => ({ usd: 0.42, llamadas: 3 })),
      listDesde,
    },
    config: { get: vi.fn(async () => ({ tope_gasto_diario_usd: 7 })) },
  });
  return { puertos, listDesde };
}

describe("puertos de Delegar al agente", () => {
  it("el motivo es el de la pausa más reciente, no el de una reanudación", async () => {
    const { puertos } = armar([
      evento({ reason_code: "sensitive_keyword", created_at: new Date("2026-09-26T09:00:00Z") }),
      evento({ reason_code: "unknown_intents", created_at: new Date("2026-09-26T11:00:00Z") }),
      evento({
        action: "resume",
        reason_code: "manual_resume",
        created_at: new Date("2026-09-26T12:00:00Z"),
      }),
    ]);
    expect(await puertos.pausas.ultimoMotivo("s1")).toBe("unknown_intents");
  });

  it("sin pausas registradas, null", async () => {
    expect(await armar().puertos.pausas.ultimoMotivo("s1")).toBeNull();
  });

  it("el gasto de la sesión es el resumen de llm_usage", async () => {
    expect(await armar().puertos.gastoLlm.deSesion("s1")).toBe(0.42);
  });

  it("el gasto del día suma desde las 00:00 UTC del día de ahora", async () => {
    const { puertos, listDesde } = armar([], [uso(0.5), uso(1.25)]);
    expect(await puertos.gastoLlm.delDia(new Date("2026-09-26T18:30:00Z"))).toBe(1.75);
    expect(listDesde).toHaveBeenCalledWith(new Date("2026-09-26T00:00:00Z"));
  });

  it("el tope diario es el del agente", async () => {
    expect(await armar().puertos.gastoLlm.topeDiario()).toBe(7);
  });
});
