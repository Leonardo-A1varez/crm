import { describe, expect, test } from "vitest";
import { seguimientoLegible } from "@/lib/ui/seguimiento";

// Un jueves a las 10:00, para que "mañana" y "pasado" no crucen fin de mes.
const AHORA = new Date(2026, 7, 20, 10, 0);

describe("seguimientoLegible", () => {
  test("hoy más tarde dice hoy con la hora", () => {
    const r = seguimientoLegible(new Date(2026, 7, 20, 15, 30), AHORA);

    expect(r.texto).toBe("hoy 15:30");
    expect(r.vencido).toBe(false);
  });

  test("mañana dice mañana", () => {
    expect(seguimientoLegible(new Date(2026, 7, 21, 9, 0), AHORA).texto).toBe("mañana 09:00");
  });

  // Es el caso que más importa: un seguimiento atrasado no puede leerse igual
  // que uno futuro, porque es trabajo que ya se pasó de fecha.
  test("una fecha pasada queda marcada como vencida", () => {
    const r = seguimientoLegible(new Date(2026, 7, 19, 18, 0), AHORA);

    expect(r.texto).toBe("ayer 18:00");
    expect(r.vencido).toBe(true);
  });

  test("hoy pero hace un rato también está vencido", () => {
    const r = seguimientoLegible(new Date(2026, 7, 20, 8, 0), AHORA);

    expect(r.texto).toBe("hoy 08:00");
    expect(r.vencido).toBe(true);
  });

  test("más de dos días adelante muestra la fecha", () => {
    expect(seguimientoLegible(new Date(2026, 7, 25, 15, 30), AHORA).texto).toBe("mar 25 ago 15:30");
  });

  // El día se compara por calendario y no por horas transcurridas: si contara
  // las 24 horas, algo a las 09:00 de mañana diría "hoy" porque faltan 23.
  test("mañana temprano sigue siendo mañana aunque falten menos de 24 horas", () => {
    const r = seguimientoLegible(new Date(2026, 7, 21, 0, 30), AHORA);

    expect(r.texto).toBe("mañana 00:30");
    expect(r.vencido).toBe(false);
  });

  test("la hora va con dos dígitos siempre", () => {
    expect(seguimientoLegible(new Date(2026, 7, 20, 9, 5), AHORA).texto).toBe("hoy 09:05");
  });
});
