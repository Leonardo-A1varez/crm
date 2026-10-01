import { describe, expect, test } from "vitest";
import { estaAbierto } from "@/lib/agente/horario";
import { decidirModo, equipoAbiertoAhora } from "@/lib/copiloto/modo";
import type { ModoDecidido, ModoOverride } from "@/types/copiloto";
import { DIAS_SEMANA, type Horario } from "@/types/agente";

/** Las 12 filas de la tabla de §3.2, en el mismo orden de la spec. */
const TABLA: ReadonlyArray<[ModoOverride | null, boolean, boolean, ModoDecidido]> = [
  [null, true, true, "copiloto"],
  [null, true, false, "copiloto"],
  [null, false, true, "automatico"],
  [null, false, false, "fuera_de_horario"],
  ["copiloto", true, true, "copiloto"],
  ["copiloto", true, false, "copiloto"],
  ["copiloto", false, true, "copiloto"],
  ["copiloto", false, false, "copiloto"],
  ["automatico", true, true, "automatico"],
  ["automatico", true, false, "fuera_de_horario"],
  ["automatico", false, true, "automatico"],
  ["automatico", false, false, "fuera_de_horario"],
];

describe("decidirModo", () => {
  test("la tabla cubre las 12 combinaciones: 3 overrides x equipo x agente", () => {
    expect(TABLA).toHaveLength(12);
    expect(new Set(TABLA.map(([o, e, a]) => `${o}|${e}|${a}`)).size).toBe(12);
  });

  test.each(TABLA)(
    "override=%s equipoAbierto=%s agenteAbierto=%s -> %s",
    (override, equipoAbierto, agenteAbierto, esperado) => {
      expect(decidirModo({ override, equipoAbierto, agenteAbierto })).toBe(esperado);
    },
  );
});

function horarioVacio(): Horario {
  const h = {} as Horario;
  for (const dia of DIAS_SEMANA) h[dia] = [];
  return h;
}

const ZONA = "America/Guayaquil"; // UTC-5, sin horario de verano.
// 2026-09-28 es lunes. 15:00Z = 10:00 en Guayaquil.
const LUNES_10 = new Date("2026-09-28T15:00:00Z");
const LUNES_18_30 = new Date("2026-09-28T23:30:00Z");

describe("equipoAbiertoAhora", () => {
  const conLunes = { ...horarioVacio(), lun: [{ desde: "09:00", hasta: "18:00" }] };

  test("abierto dentro de un rango, en la zona del negocio", () => {
    expect(equipoAbiertoAhora({ horario_equipo: conLunes, horario_timezone: ZONA }, LUNES_10)).toBe(
      true,
    );
  });

  test("cerrado fuera del rango", () => {
    expect(
      equipoAbiertoAhora({ horario_equipo: conLunes, horario_timezone: ZONA }, LUNES_18_30),
    ).toBe(false);
  });

  test("sin un solo rango nunca hay equipo, a ninguna hora de ningun dia", () => {
    const base = Date.parse("2026-09-28T00:00:00Z");
    for (let hora = 0; hora < 24 * 7; hora++) {
      const ahora = new Date(base + hora * 3_600_000);
      expect(
        equipoAbiertoAhora({ horario_equipo: horarioVacio(), horario_timezone: ZONA }, ahora),
      ).toBe(false);
    }
  });

  test("zona invalida cuenta como equipo cerrado, aunque haya rangos", () => {
    expect(
      equipoAbiertoAhora({ horario_equipo: conLunes, horario_timezone: "Marte/Colonia" }, LUNES_10),
    ).toBe(false);
  });

  test("el agente NO cambia: con zona invalida `estaAbierto` sigue devolviendo true", () => {
    // Documenta la asimetria de §3.2: para el agente, zona invalida = abierto
    // (no callar al cliente); para el equipo seria el lado inseguro.
    expect(estaAbierto(conLunes, "Marte/Colonia", LUNES_10)).toBe(true);
  });
});
