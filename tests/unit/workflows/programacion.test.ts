import { describe, expect, test } from "vitest";
import { franjasProgramadas } from "@/lib/workflows/programacion";

/**
 * Qué horarios de un trigger "Programado" cayeron en una ventana del reloj. La
 * ventana es (desde, hasta]: un minuto exacto cuenta en la ventana que termina
 * en él y no en la siguiente. Las franjas salen en hora local del flujo.
 */

type Config = Parameters<typeof franjasProgramadas>[0];

function config(parcial: Partial<Config> = {}): Config {
  return {
    frecuencia: "diario",
    hora: "09:00",
    dias: [],
    cron: "0 9 * * *",
    timezone: "America/Mexico_City",
    ...parcial,
  };
}

// 2026-09-14 es lunes. Ciudad de México es UTC-6 todo el año (sin horario de verano).
const utc = (iso: string) => new Date(iso);

describe("franjasProgramadas — diario", () => {
  test("la hora local cae en la ventana", () => {
    expect(
      franjasProgramadas(config(), utc("2026-09-14T14:55:00Z"), utc("2026-09-14T15:05:00Z")),
    ).toEqual({ franjas: ["2026-09-14T09:00"] });
  });

  test("fuera de la ventana no hay franja", () => {
    expect(
      franjasProgramadas(config(), utc("2026-09-14T15:00:00Z"), utc("2026-09-14T15:10:00Z")),
    ).toEqual({ franjas: [] });
  });

  test("el borde: `hasta` incluido, `desde` excluido", () => {
    const franja = franjasProgramadas(
      config(),
      utc("2026-09-14T14:55:00Z"),
      utc("2026-09-14T15:00:00Z"),
    );
    expect(franja).toEqual({ franjas: ["2026-09-14T09:00"] });
    expect(
      franjasProgramadas(config(), utc("2026-09-14T15:00:00Z"), utc("2026-09-14T15:05:00Z")),
    ).toEqual({ franjas: [] });
  });

  test("la timezone decide: la misma hora UTC es otra hora local", () => {
    const buenosAires = config({ timezone: "America/Argentina/Buenos_Aires" }); // UTC-3
    expect(
      franjasProgramadas(buenosAires, utc("2026-09-14T11:55:00Z"), utc("2026-09-14T12:05:00Z")),
    ).toEqual({ franjas: ["2026-09-14T09:00"] });
  });
});

describe("franjasProgramadas — cada hora", () => {
  test("usa los minutos de `hora`, todas las horas", () => {
    const c = config({ frecuencia: "cada_hora", hora: "09:30" });
    expect(franjasProgramadas(c, utc("2026-09-14T15:00:00Z"), utc("2026-09-14T17:00:00Z"))).toEqual(
      { franjas: ["2026-09-14T09:30", "2026-09-14T10:30"] },
    );
  });
});

describe("franjasProgramadas — semanal", () => {
  test("sólo los días elegidos (el índice del panel arranca en lunes)", () => {
    const lunes = config({ frecuencia: "semanal", dias: [0] });
    const martes = config({ frecuencia: "semanal", dias: [1] });
    const ventana = [utc("2026-09-14T14:55:00Z"), utc("2026-09-14T15:05:00Z")] as const;
    expect(franjasProgramadas(lunes, ...ventana)).toEqual({ franjas: ["2026-09-14T09:00"] });
    expect(franjasProgramadas(martes, ...ventana)).toEqual({ franjas: [] });
  });

  test("sin días elegidos no hay horario: lo dice en vez de no correr nunca en silencio", () => {
    const r = franjasProgramadas(
      config({ frecuencia: "semanal", dias: [] }),
      utc("2026-09-14T14:55:00Z"),
      utc("2026-09-14T15:05:00Z"),
    );
    expect(r).toEqual({ error: expect.stringContaining("día") });
  });
});

describe("franjasProgramadas — mensual", () => {
  test("el panel no deja elegir el día del mes: es un error, no un día inventado", () => {
    const r = franjasProgramadas(
      config({ frecuencia: "mensual" }),
      utc("2026-09-01T14:55:00Z"),
      utc("2026-09-01T15:05:00Z"),
    );
    expect(r).toEqual({ error: expect.stringContaining("personalizada") });
  });
});

describe("franjasProgramadas — personalizado (cron de 5 campos)", () => {
  const ventana = (desde: string, hasta: string) => [utc(desde), utc(hasta)] as const;

  test("minuto y hora", () => {
    const c = config({ frecuencia: "personalizado", cron: "15 9 * * *" });
    expect(
      franjasProgramadas(c, ...ventana("2026-09-14T15:10:00Z", "2026-09-14T15:20:00Z")),
    ).toEqual({ franjas: ["2026-09-14T09:15"] });
  });

  test("pasos, rangos y listas", () => {
    const c = config({ frecuencia: "personalizado", cron: "*/20 9-10 * * 1,3" });
    expect(
      franjasProgramadas(c, ...ventana("2026-09-14T15:00:00Z", "2026-09-14T16:00:00Z")),
    ).toEqual({ franjas: ["2026-09-14T09:20", "2026-09-14T09:40", "2026-09-14T10:00"] });
  });

  test("día de la semana en cron: 0 y 7 son domingo", () => {
    const domingo = ventana("2026-09-13T14:55:00Z", "2026-09-13T15:05:00Z");
    for (const dow of ["0", "7"]) {
      const c = config({ frecuencia: "personalizado", cron: `0 9 * * ${dow}` });
      expect(franjasProgramadas(c, ...domingo)).toEqual({ franjas: ["2026-09-13T09:00"] });
    }
  });

  test("día del mes y de la semana restringidos: alcanza con uno (regla de cron)", () => {
    // Día 14 o viernes: el lunes 14 cuenta por el día del mes.
    const c = config({ frecuencia: "personalizado", cron: "0 9 14 * 5" });
    expect(
      franjasProgramadas(c, ...ventana("2026-09-14T14:55:00Z", "2026-09-14T15:05:00Z")),
    ).toEqual({ franjas: ["2026-09-14T09:00"] });
  });

  test.each(["", "0 9 * *", "61 9 * * *", "0 9 * * lun", "a b c d e"])(
    "una expresión inválida es un error: %j",
    (cron) => {
      const r = franjasProgramadas(
        config({ frecuencia: "personalizado", cron }),
        utc("2026-09-14T14:55:00Z"),
        utc("2026-09-14T15:05:00Z"),
      );
      expect(r).toEqual({ error: expect.any(String) });
    },
  );
});

describe("franjasProgramadas — errores de configuración", () => {
  test("una timezone que no existe es un error", () => {
    const r = franjasProgramadas(
      config({ timezone: "Marte/Olympus" }),
      utc("2026-09-14T14:55:00Z"),
      utc("2026-09-14T15:05:00Z"),
    );
    expect(r).toEqual({ error: expect.stringContaining("Marte/Olympus") });
  });

  test("una hora mal escrita es un error", () => {
    const r = franjasProgramadas(
      config({ hora: "9am" }),
      utc("2026-09-14T14:55:00Z"),
      utc("2026-09-14T15:05:00Z"),
    );
    expect(r).toEqual({ error: expect.stringContaining("9am") });
  });
});
