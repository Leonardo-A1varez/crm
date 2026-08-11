import { describe, expect, test } from "vitest";
import { esperaLegible, pesoMotivo, triage } from "@/lib/triage";
import type { EntradaTriage } from "@/lib/triage";

function entrada(over: Partial<EntradaTriage> = {}): EntradaTriage {
  return {
    stage: "identificando",
    iaPausada: false,
    bloqueador: null,
    comprobantePagoUrl: null,
    ...over,
  };
}

describe("esperaLegible", () => {
  test("por debajo del minuto dice 'recién'", () => {
    expect(esperaLegible(30_000)).toBe("recién");
  });

  test("redondea hacia abajo y no hacia arriba", () => {
    // 119 segundos son 1m y monedas: decir 2m exagera la espera.
    expect(esperaLegible(119_000)).toBe("hace 1m");
    expect(esperaLegible(59 * 60_000 + 59_000)).toBe("hace 59m");
  });

  test("escala a horas y días", () => {
    expect(esperaLegible(60 * 60_000)).toBe("hace 1h");
    expect(esperaLegible(23 * 60 * 60_000)).toBe("hace 23h");
    expect(esperaLegible(25 * 60 * 60_000)).toBe("hace 1d");
  });
});

describe("triage", () => {
  test("sin nada que atender no hay motivo", () => {
    expect(triage(entrada())).toEqual({ motivo: null });
  });

  test("requiere_humano gana sobre todo lo demás", () => {
    const r = triage(
      entrada({ stage: "requiere_humano", iaPausada: true, bloqueador: "sin factura" }),
    );
    expect(r.motivo).toEqual({ tipo: "humano", texto: "Pidió hablar con una persona" });
  });

  test("la IA pausada también es un motivo de tipo humano", () => {
    const r = triage(entrada({ iaPausada: true, bloqueador: "sin factura" }));
    expect(r.motivo).toEqual({ tipo: "humano", texto: "La atiende un vendedor" });
  });

  test("el bloqueador entra en el chip con su texto", () => {
    const r = triage(entrada({ bloqueador: "no tiene la factura" }));
    expect(r.motivo).toEqual({ tipo: "bloqueo", texto: "Bloqueador: no tiene la factura" });
  });

  test("un bloqueador en blanco no cuenta como bloqueador", () => {
    expect(triage(entrada({ bloqueador: "   " })).motivo).toBeNull();
  });

  test("esperando_pago sin comprobante requiere atención", () => {
    const r = triage(entrada({ stage: "esperando_pago" }));
    expect(r.motivo).toEqual({ tipo: "pago", texto: "Pago sin comprobante" });
  });

  test("esperando_pago CON comprobante ya no requiere atención", () => {
    // El comprobante es justo lo que se estaba esperando: con él cargado la
    // conversación deja de ser un pendiente del vendedor.
    const r = triage(
      entrada({ stage: "esperando_pago", comprobantePagoUrl: "https://x.test/c.jpg" }),
    );
    expect(r.motivo).toBeNull();
  });

  test("el bloqueador gana sobre el pago sin comprobante", () => {
    const r = triage(entrada({ stage: "esperando_pago", bloqueador: "no llega la transferencia" }));
    expect(r.motivo?.tipo).toBe("bloqueo");
  });

  test("un recordatorio vencido pone la conversación en seguimiento", () => {
    const r = triage(entrada({ recordatorio: { nota: "dijo que lo pensaba" } }));
    expect(r.motivo).toEqual({ tipo: "seguimiento", texto: "Seguimiento: dijo que lo pensaba" });
  });

  test("sin nota el seguimiento igual dice qué hay que hacer", () => {
    // La nota es opcional: la fecha sola ya es un recordatorio útil, y el chip
    // no puede quedar en "Seguimiento: " colgando.
    const r = triage(entrada({ recordatorio: { nota: "   " } }));
    expect(r.motivo).toEqual({ tipo: "seguimiento", texto: "Toca volver a contactarlo" });
  });

  test("sin recordatorio vencido no hay motivo de seguimiento", () => {
    expect(triage(entrada({ recordatorio: null })).motivo).toBeNull();
  });

  test("lo que espera el cliente gana sobre la cita que nos pusimos nosotros", () => {
    // Los tres motivos de arriba son alguien esperando del otro lado; el
    // seguimiento es una nota nuestra y puede esperar un rato más.
    for (const over of [
      { stage: "requiere_humano" } as const,
      { bloqueador: "sin factura" },
      { stage: "esperando_pago" } as const,
    ]) {
      const r = triage(entrada({ ...over, recordatorio: { nota: "volver" } }));
      expect(r.motivo?.tipo).not.toBe("seguimiento");
    }
  });
});

describe("pesoMotivo", () => {
  test("respeta el orden: humano, bloqueo, pago, seguimiento y al final sin motivo", () => {
    const pesos = [
      pesoMotivo({ tipo: "humano", texto: "" }),
      pesoMotivo({ tipo: "bloqueo", texto: "" }),
      pesoMotivo({ tipo: "pago", texto: "" }),
      pesoMotivo({ tipo: "seguimiento", texto: "" }),
      pesoMotivo(null),
    ];
    expect(pesos).toEqual([...pesos].sort((a, b) => a - b));
    expect(new Set(pesos).size).toBe(5);
  });
});
