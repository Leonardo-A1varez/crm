import { describe, expect, it } from "vitest";
import { formatearEntero } from "@/lib/ui/metricas";
import { evaluarEnvio, rielDeCupo } from "./cupo";
import type { Cupo, SaludNumero, TandaReparto } from "./tipos";

type CupoOk = Extract<Cupo, { estado: "ok" }>;

/** Tope de 2.000 con 100 usados: 1.900 restantes, 300 de reserva y 1.600 por tanda. */
function cupo(parcial: Partial<CupoOk> = {}): CupoOk {
  return {
    estado: "ok",
    tope: 2000,
    usado24h: 100,
    reserva: 300,
    restante: 1900,
    porTanda: 1600,
    solicitado: 500,
    alcanza: true,
    ...parcial,
  };
}

function tanda(numero: number, porPlantilla: number, porVentanaAbierta = 0): TandaReparto {
  return { tanda: numero, desde: `día ${numero + 1}`, porPlantilla, porVentanaAbierta };
}

const SALUD: SaludNumero = {
  calidad: { estado: "ok", valor: { calidad: "alta", cruda: "GREEN" } },
  escalon: { estado: "ok", valor: 2000 },
  envio: { estado: "disponible" },
  plantillasPausadas: { estado: "ok", valor: [] },
  fuente: "Leído de Meta.",
};

const LISTO = {
  destinatarios: 540,
  cupo: cupo(),
  tandas: [tanda(0, 500, 40)],
  salud: SALUD,
  plantilla: { nombre: "promo_frenos_v3", elegible: true },
};

describe("rielDeCupo", () => {
  it("cuando entra todo, dibuja lo usado, la reserva y la primera tanda sobre la escala del tope", () => {
    const r = rielDeCupo(cupo(), [tanda(0, 500, 40)]);
    expect(r).not.toBeNull();
    expect(r?.tramos).toEqual([
      { clave: "usado", cantidad: 100 },
      { clave: "reserva", cantidad: 300 },
      { clave: "difusion", cantidad: 500 },
    ]);
    expect(r?.escala).toBe(2000);
    expect(r?.posicionTope).toBe(100);
    // 1.600 por tanda menos los 500 de la primera.
    expect(r?.margen).toBe(1100);
  });

  it("lo que va a las tandas siguientes se dibuja afuera del tope: la escala crece", () => {
    const c = cupo({ usado24h: 1150, restante: 850, porTanda: 550, solicitado: 1650 });
    const r = rielDeCupo(c, [tanda(0, 550), tanda(1, 550), tanda(2, 550)]);
    expect(r?.tramos).toEqual([
      { clave: "usado", cantidad: 1150 },
      { clave: "reserva", cantidad: 300 },
      { clave: "difusion", cantidad: 550 },
      { clave: "excedente", cantidad: 1100 },
    ]);
    expect(r?.escala).toBe(3100);
    expect(r?.posicionTope).toBeCloseTo((2000 / 3100) * 100, 6);
    expect(r?.margen).toBe(0);
  });

  it("sin cupo para plantillas todo lo pedido queda afuera, y la reserva no pasa de lo que queda", () => {
    const c = cupo({ usado24h: 1950, restante: 50, porTanda: 0, solicitado: 120, alcanza: false });
    const r = rielDeCupo(c, []);
    expect(r?.tramos).toEqual([
      { clave: "usado", cantidad: 1950 },
      { clave: "reserva", cantidad: 50 },
      { clave: "excedente", cantidad: 120 },
    ]);
    expect(r?.escala).toBe(2120);
    expect(r?.margen).toBe(0);
  });

  it("si todos van por ventana abierta, no se dibuja difusión y el margen es la tanda entera", () => {
    const r = rielDeCupo(cupo({ solicitado: 0 }), [tanda(0, 0, 40)]);
    expect(r?.tramos).toEqual([
      { clave: "usado", cantidad: 100 },
      { clave: "reserva", cantidad: 300 },
    ]);
    expect(r?.margen).toBe(1600);
  });

  it("sin dato de Meta o con escalón ilimitado no hay riel que dibujar", () => {
    expect(
      rielDeCupo({ estado: "sin-dato", motivo: "Meta no respondió", solicitado: 10 }, []),
    ).toBeNull();
    expect(rielDeCupo(cupo({ tope: "ilimitado" }), [tanda(0, 10)])).toBeNull();
  });

  it("un tope en cero no divide por cero", () => {
    const r = rielDeCupo(
      cupo({ tope: 0, usado24h: 0, reserva: 0, restante: 0, porTanda: 0, solicitado: 0 }),
      [],
    );
    expect(r?.escala).toBe(1);
    expect(r?.tramos).toEqual([]);
  });
});

describe("evaluarEnvio", () => {
  it("entra en una sola tanda: listo, con el margen que queda", () => {
    const v = evaluarEnvio(LISTO);
    expect(v.nivel).toBe("listo");
    expect(v.detalle).toContain(formatearEntero(1100));
  });

  it("con escalón ilimitado no inventa un margen", () => {
    const v = evaluarEnvio({
      ...LISTO,
      cupo: cupo({ tope: "ilimitado", reserva: 0, restante: Number.MAX_SAFE_INTEGER }),
    });
    expect(v.nivel).toBe("listo");
    expect(v.detalle).not.toContain(formatearEntero(Number.MAX_SAFE_INTEGER));
  });

  it("en varias tandas: reparto, con cuántas son y cuándo arranca la última", () => {
    const v = evaluarEnvio({ ...LISTO, tandas: [tanda(0, 550), tanda(1, 550), tanda(2, 100)] });
    expect(v.nivel).toBe("reparto");
    expect(v.titulo).toContain("3 tandas");
    expect(v.detalle).toContain("día 3");
  });

  it("todos por ventana abierta: listo aunque no quede cupo para plantillas", () => {
    const v = evaluarEnvio({
      ...LISTO,
      destinatarios: 40,
      cupo: cupo({ solicitado: 0, porTanda: 0, usado24h: 1900, restante: 100 }),
      tandas: [tanda(0, 0, 40)],
    });
    expect(v.nivel).toBe("listo");
  });

  it("sin cupo para plantillas: bloqueado, con lo que queda y la reserva", () => {
    const v = evaluarEnvio({
      ...LISTO,
      cupo: cupo({ usado24h: 1950, restante: 50, porTanda: 0, alcanza: false }),
      tandas: [],
    });
    expect(v.nivel).toBe("bloqueado");
    expect(v.detalle).toContain(formatearEntero(50));
    expect(v.detalle).toContain(formatearEntero(300));
  });

  it("sin el escalón de Meta: bloqueado, con el motivo de la lectura", () => {
    const v = evaluarEnvio({
      ...LISTO,
      cupo: { estado: "sin-dato", motivo: "Meta no respondió", solicitado: 500 },
      tandas: [],
    });
    expect(v.nivel).toBe("bloqueado");
    expect(v.detalle).toContain("Meta no respondió");
  });

  it("sin destinatarios: bloqueado", () => {
    expect(evaluarEnvio({ ...LISTO, destinatarios: 0 }).nivel).toBe("bloqueado");
  });

  it("sin plantilla, o con una que dejó de estar aprobada: bloqueado", () => {
    expect(evaluarEnvio({ ...LISTO, plantilla: null }).nivel).toBe("bloqueado");
    expect(
      evaluarEnvio({ ...LISTO, plantilla: { nombre: "promo_frenos_v3", elegible: false } }).nivel,
    ).toBe("bloqueado");
  });

  it("con el envío bloqueado por Meta: bloqueado, con el detalle de Meta", () => {
    const v = evaluarEnvio({
      ...LISTO,
      salud: { ...SALUD, envio: { estado: "bloqueado", detalle: "Cuenta restringida" } },
    });
    expect(v.nivel).toBe("bloqueado");
    expect(v.detalle).toContain("Cuenta restringida");
  });

  it("calidad baja bloquea aunque el cupo sobre", () => {
    const v = evaluarEnvio({
      ...LISTO,
      salud: { ...SALUD, calidad: { estado: "ok", valor: { calidad: "baja", cruda: "RED" } } },
    });
    expect(v.nivel).toBe("bloqueado");
  });

  it("una calidad que no se pudo leer no bloquea: no se sabe, y no es lo mismo que baja", () => {
    const v = evaluarEnvio({
      ...LISTO,
      salud: { ...SALUD, calidad: { estado: "sin-dato", motivo: "timeout" } },
    });
    expect(v.nivel).toBe("listo");
  });
});
