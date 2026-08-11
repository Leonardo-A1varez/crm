import { describe, expect, test } from "vitest";
import {
  campoFechaEnZona,
  campoHoraEnZona,
  ciudadDeZona,
  diaSemanaDePared,
  fechaLegibleEnZona,
  horaDePared,
  instanteDesdeCampos,
  instanteDesdeHoraDePared,
  zonaValida,
} from "@/lib/zona-horaria";

const BUENOS_AIRES = "America/Argentina/Buenos_Aires"; // UTC-3 todo el año
const MADRID = "Europe/Madrid"; // UTC+1 en invierno, UTC+2 en verano
const MEXICO = "America/Mexico_City"; // UTC-6 todo el año desde 2022

describe("horaDePared", () => {
  test("lee el reloj de la zona, no el del proceso", () => {
    // 18:00 UTC del 13 de agosto son las 15:00 en Buenos Aires.
    expect(horaDePared(BUENOS_AIRES, new Date("2026-08-13T18:00:00.000Z"))).toEqual({
      anio: 2026,
      mes: 8,
      dia: 13,
      horas: 15,
      minutos: 0,
    });
  });

  test("cruza el día para atrás cuando corresponde", () => {
    // 02:00 UTC del 14 todavía son las 23:00 del 13 en Buenos Aires.
    const p = horaDePared(BUENOS_AIRES, new Date("2026-08-14T02:00:00.000Z"));
    expect(p).toEqual({ anio: 2026, mes: 8, dia: 13, horas: 23, minutos: 0 });
  });

  test("la medianoche es 0 y no 24", () => {
    // Con `hour12: false` algunos runtimes devuelven "24" acá, y una hora 24
    // rompe cualquier cuenta que se haga después.
    expect(horaDePared("UTC", new Date("2026-08-13T00:00:00.000Z"))?.horas).toBe(0);
  });

  test("zona inexistente o fecha inválida devuelven null", () => {
    expect(horaDePared("No/Existe", new Date("2026-08-13T18:00:00.000Z"))).toBeNull();
    expect(horaDePared("", new Date("2026-08-13T18:00:00.000Z"))).toBeNull();
    expect(horaDePared(BUENOS_AIRES, new Date("no es una fecha"))).toBeNull();
  });
});

describe("zonaValida", () => {
  test("acepta las zonas IANA de los mercados del producto", () => {
    expect(zonaValida(BUENOS_AIRES)).toBe(true);
    expect(zonaValida(MEXICO)).toBe(true);
    expect(zonaValida("UTC")).toBe(true);
  });

  test("rechaza la vacía y la inventada", () => {
    expect(zonaValida("")).toBe(false);
    expect(zonaValida("No/Existe")).toBe(false);
  });
});

describe("diaSemanaDePared", () => {
  test("el 13 de agosto de 2026 es jueves", () => {
    const p = horaDePared(BUENOS_AIRES, new Date("2026-08-13T18:00:00.000Z"));
    expect(p && diaSemanaDePared(p)).toBe(4);
  });

  test("el día lo decide la fecha de la zona, no la UTC", () => {
    // 02:00 UTC del sábado 15 son todavía el viernes 14 en Buenos Aires.
    const p = horaDePared(BUENOS_AIRES, new Date("2026-08-15T02:00:00.000Z"));
    expect(p && diaSemanaDePared(p)).toBe(5);
  });
});

/**
 * El corazón del selector: si esto se equivoca, el recordatorio salta a una
 * hora distinta de la que el vendedor pidió y la función no sirve.
 */
describe("instanteDesdeHoraDePared", () => {
  test("'13 de agosto a las 15:00 en Buenos Aires' es 18:00 UTC", () => {
    const d = instanteDesdeHoraDePared(BUENOS_AIRES, {
      anio: 2026,
      mes: 8,
      dia: 13,
      horas: 15,
      minutos: 0,
    });
    expect(d?.toISOString()).toBe("2026-08-13T18:00:00.000Z");
  });

  test("la misma hora de pared en otra zona da otro instante", () => {
    const ba = instanteDesdeHoraDePared(BUENOS_AIRES, {
      anio: 2026,
      mes: 8,
      dia: 13,
      horas: 10,
      minutos: 0,
    });
    const mx = instanteDesdeHoraDePared(MEXICO, {
      anio: 2026,
      mes: 8,
      dia: 13,
      horas: 10,
      minutos: 0,
    });
    // Tres horas de diferencia: es exactamente el error que se cometería
    // guardando la hora del navegador como si fuera la del negocio.
    expect((mx as Date).getTime() - (ba as Date).getTime()).toBe(3 * 60 * 60 * 1000);
  });

  test("horario de verano: la misma hora de pared da offsets distintos según el mes", () => {
    const invierno = instanteDesdeHoraDePared(MADRID, {
      anio: 2026,
      mes: 1,
      dia: 15,
      horas: 10,
      minutos: 0,
    });
    const verano = instanteDesdeHoraDePared(MADRID, {
      anio: 2026,
      mes: 7,
      dia: 15,
      horas: 10,
      minutos: 0,
    });
    expect(invierno?.toISOString()).toBe("2026-01-15T09:00:00.000Z"); // UTC+1
    expect(verano?.toISOString()).toBe("2026-07-15T08:00:00.000Z"); // UTC+2
  });

  test("ida y vuelta: convertir y volver a leer devuelve la misma hora de pared", () => {
    // La propiedad que importa de verdad. Se prueba también sobre el día del
    // cambio de hora de Madrid (29 de marzo de 2026), que es donde una
    // implementación de una sola pasada se corre una hora.
    const casos = [
      { tz: BUENOS_AIRES, mes: 8, dia: 13, horas: 15 },
      { tz: MADRID, mes: 3, dia: 29, horas: 14 },
      { tz: MADRID, mes: 10, dia: 25, horas: 14 },
      { tz: MEXICO, mes: 12, dia: 31, horas: 23 },
    ];
    for (const c of casos) {
      const pared = { anio: 2026, mes: c.mes, dia: c.dia, horas: c.horas, minutos: 30 };
      const instante = instanteDesdeHoraDePared(c.tz, pared);
      expect(instante).not.toBeNull();
      expect(horaDePared(c.tz, instante as Date)).toEqual(pared);
    }
  });

  test("zona inexistente devuelve null en vez de inventar un offset", () => {
    expect(
      instanteDesdeHoraDePared("No/Existe", {
        anio: 2026,
        mes: 8,
        dia: 13,
        horas: 15,
        minutos: 0,
      }),
    ).toBeNull();
  });
});

describe("instanteDesdeCampos", () => {
  test("toma lo que devuelven los dos inputs nativos y lo ancla a la zona del negocio", () => {
    expect(instanteDesdeCampos(BUENOS_AIRES, "2026-08-13", "15:00")?.toISOString()).toBe(
      "2026-08-13T18:00:00.000Z",
    );
  });

  test("rechaza un día que no existe en vez de correrlo al mes siguiente", () => {
    // `Date.UTC` convertiría el 31 de febrero en el 3 de marzo sin decir nada,
    // y el recordatorio quedaría tres semanas después de lo que se eligió.
    expect(instanteDesdeCampos(BUENOS_AIRES, "2026-02-31", "10:00")).toBeNull();
  });

  test("rechaza formatos que no son los del input", () => {
    expect(instanteDesdeCampos(BUENOS_AIRES, "", "10:00")).toBeNull();
    expect(instanteDesdeCampos(BUENOS_AIRES, "2026-08-13", "")).toBeNull();
    expect(instanteDesdeCampos(BUENOS_AIRES, "13/08/2026", "10:00")).toBeNull();
    expect(instanteDesdeCampos(BUENOS_AIRES, "2026-08-13", "25:00")).toBeNull();
    expect(instanteDesdeCampos(BUENOS_AIRES, "2026-13-01", "10:00")).toBeNull();
  });

  test("acepta el 29 de febrero de un año bisiesto", () => {
    expect(instanteDesdeCampos(BUENOS_AIRES, "2028-02-29", "10:00")).not.toBeNull();
    expect(instanteDesdeCampos(BUENOS_AIRES, "2026-02-29", "10:00")).toBeNull();
  });
});

describe("lo que el vendedor lee", () => {
  const INSTANTE = new Date("2026-08-13T18:40:00.000Z");

  test("fecha legible en la hora del negocio", () => {
    expect(fechaLegibleEnZona(BUENOS_AIRES, INSTANTE)).toBe("jue 13 ago, 15:40");
  });

  test("el mismo instante se lee distinto en otra zona", () => {
    expect(fechaLegibleEnZona(MEXICO, INSTANTE)).toBe("jue 13 ago, 12:40");
  });

  test("los campos del formulario salen en la hora del negocio", () => {
    expect(campoFechaEnZona(BUENOS_AIRES, INSTANTE)).toBe("2026-08-13");
    expect(campoHoraEnZona(BUENOS_AIRES, INSTANTE)).toBe("15:40");
  });

  test("una zona rota muestra UTC antes que una hora inventada", () => {
    expect(fechaLegibleEnZona("No/Existe", INSTANTE)).toBe("jue 13 ago, 18:40");
  });

  test("el rótulo dice la ciudad y no el identificador IANA", () => {
    expect(ciudadDeZona(BUENOS_AIRES)).toBe("Buenos Aires");
    expect(ciudadDeZona(MEXICO)).toBe("Mexico City");
    expect(ciudadDeZona("UTC")).toBe("UTC");
  });
});
