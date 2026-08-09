import { describe, expect, test } from "vitest";
import { esTimezoneValida, estaAbierto, normalizarRangos } from "@/lib/agente/horario";
import { DIAS_SEMANA, type Horario } from "@/types/agente";

const TZ = "America/Argentina/Buenos_Aires";

function horario(patch: Partial<Horario> = {}): Horario {
  const base = {} as Horario;
  for (const dia of DIAS_SEMANA) base[dia] = [];
  return { ...base, ...patch };
}

describe("estaAbierto", () => {
  test("dentro del rango de un dia laboral", () => {
    // 2026-08-10 es lunes. 14:00 en Buenos Aires = 17:00 UTC.
    const h = horario({ lun: [{ desde: "08:00", hasta: "18:00" }] });
    expect(estaAbierto(h, TZ, new Date("2026-08-10T17:00:00Z"))).toBe(true);
  });

  test("fuera del rango del mismo dia", () => {
    const h = horario({ lun: [{ desde: "08:00", hasta: "18:00" }] });
    // 22:00 en Buenos Aires = 01:00 UTC del martes.
    expect(estaAbierto(h, TZ, new Date("2026-08-11T01:00:00Z"))).toBe(false);
  });

  test("dia con lista vacia esta cerrado todo el dia", () => {
    const h = horario({ dom: [] });
    // 2026-08-09 es domingo, mediodia local.
    expect(estaAbierto(h, TZ, new Date("2026-08-09T15:00:00Z"))).toBe(false);
  });

  test("multiples rangos: abierto en ambos, cerrado en el hueco", () => {
    const h = horario({
      mar: [
        { desde: "08:00", hasta: "12:00" },
        { desde: "15:00", hasta: "19:00" },
      ],
    });
    // 2026-08-11 es martes. 10:00 local = 13:00 UTC, 13:00 local = 16:00 UTC.
    expect(estaAbierto(h, TZ, new Date("2026-08-11T13:00:00Z"))).toBe(true);
    expect(estaAbierto(h, TZ, new Date("2026-08-11T16:00:00Z"))).toBe(false);
    expect(estaAbierto(h, TZ, new Date("2026-08-11T20:00:00Z"))).toBe(true);
  });

  test("los bordes del rango cuentan como abierto", () => {
    const h = horario({ lun: [{ desde: "08:00", hasta: "18:00" }] });
    expect(estaAbierto(h, TZ, new Date("2026-08-10T11:00:00Z"))).toBe(true); // 08:00 local
    expect(estaAbierto(h, TZ, new Date("2026-08-10T21:00:00Z"))).toBe(true); // 18:00 local
  });

  test("la timezone decide el dia, no el UTC del server", () => {
    // 2026-08-11T02:00Z es martes en UTC pero lunes 23:00 en Buenos Aires.
    const abiertoLunes = horario({ lun: [{ desde: "22:00", hasta: "23:59" }] });
    expect(estaAbierto(abiertoLunes, TZ, new Date("2026-08-11T02:00:00Z"))).toBe(true);

    const abiertoMartes = horario({ mar: [{ desde: "00:00", hasta: "06:00" }] });
    expect(estaAbierto(abiertoMartes, TZ, new Date("2026-08-11T02:00:00Z"))).toBe(false);
  });

  test("24/7 esta siempre abierto", () => {
    const h = {} as Horario;
    for (const dia of DIAS_SEMANA) h[dia] = [{ desde: "00:00", hasta: "23:59" }];
    expect(estaAbierto(h, TZ, new Date("2026-08-09T04:00:00Z"))).toBe(true);
    expect(estaAbierto(h, TZ, new Date("2026-08-12T18:30:00Z"))).toBe(true);
  });

  test("timezone invalida no explota: degrada a abierto", () => {
    // Cerrar el agente por una timezone mal escrita seria peor que responder.
    const h = horario({ lun: [{ desde: "08:00", hasta: "18:00" }] });
    expect(estaAbierto(h, "No/Existe", new Date("2026-08-10T17:00:00Z"))).toBe(true);
  });
});

describe("normalizarRangos", () => {
  test("ordena por hora de inicio", () => {
    expect(
      normalizarRangos([
        { desde: "15:00", hasta: "19:00" },
        { desde: "08:00", hasta: "12:00" },
      ]),
    ).toEqual([
      { desde: "08:00", hasta: "12:00" },
      { desde: "15:00", hasta: "19:00" },
    ]);
  });

  test("fusiona rangos solapados", () => {
    expect(
      normalizarRangos([
        { desde: "08:00", hasta: "13:00" },
        { desde: "12:00", hasta: "18:00" },
      ]),
    ).toEqual([{ desde: "08:00", hasta: "18:00" }]);
  });

  test("fusiona rangos adyacentes", () => {
    expect(
      normalizarRangos([
        { desde: "08:00", hasta: "12:00" },
        { desde: "12:00", hasta: "18:00" },
      ]),
    ).toEqual([{ desde: "08:00", hasta: "18:00" }]);
  });

  test("deja intactos los rangos disjuntos", () => {
    const rangos = [
      { desde: "08:00", hasta: "12:00" },
      { desde: "15:00", hasta: "19:00" },
    ];
    expect(normalizarRangos(rangos)).toEqual(rangos);
  });

  test("descarta rangos invertidos o de duracion cero", () => {
    expect(normalizarRangos([{ desde: "18:00", hasta: "08:00" }])).toEqual([]);
    expect(normalizarRangos([{ desde: "10:00", hasta: "10:00" }])).toEqual([]);
  });

  test("descarta horas mal formadas", () => {
    expect(normalizarRangos([{ desde: "25:00", hasta: "26:00" }])).toEqual([]);
    expect(normalizarRangos([{ desde: "ocho", hasta: "diez" }])).toEqual([]);
  });

  test("lista vacia devuelve lista vacia", () => {
    expect(normalizarRangos([])).toEqual([]);
  });
});

describe("esTimezoneValida", () => {
  test("acepta zonas IANA reales", () => {
    expect(esTimezoneValida("America/Argentina/Buenos_Aires")).toBe(true);
    expect(esTimezoneValida("America/Mexico_City")).toBe(true);
    expect(esTimezoneValida("UTC")).toBe(true);
  });

  test("rechaza basura", () => {
    expect(esTimezoneValida("No/Existe")).toBe(false);
    expect(esTimezoneValida("")).toBe(false);
  });
});
