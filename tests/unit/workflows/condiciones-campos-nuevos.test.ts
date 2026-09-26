import { describe, expect, it } from "vitest";
import {
  COMPARADORES_POR_TIPO,
  valorPorDefecto,
  type Comparador,
  type Grupo,
  type NodoCondicion,
  type Regla,
  type ValorCondicion,
} from "@/lib/ui/condiciones";
import {
  CAMPOS_VIVOS,
  TIPO_DE_CAMPO_CONDICION,
  camposVivosDe,
  evaluarCondicion,
} from "@/lib/workflows/condiciones";
import { CondicionSchema, problemasDeArbol } from "@/lib/workflows/condiciones.schema";

// Fixtures armados a mano para estos tests: no salen de ningún dato real.
function fila(campoId: string, comparador: Comparador, valor: ValorCondicion, id = "r1"): Regla {
  return { id, clase: "regla", campoId, comparador, valor };
}
function grupo(operador: "y" | "o", hijos: NodoCondicion[], id = "g"): Grupo {
  return { id, clase: "grupo", operador, hijos };
}
function cumple(regla: Regla, contexto: Record<string, unknown>, ahora?: Date, zona?: string) {
  return evaluarCondicion({ arbol: grupo("y", [regla]) }, contexto, {
    ahora: ahora ?? new Date("2026-09-25T15:00:00Z"),
    zona: zona ?? "America/Argentina/Buenos_Aires",
  });
}

describe("los campos nuevos de la condición", () => {
  it("tienen el tipo del diseño: intent es lista, etiquetas varias, marca texto", () => {
    expect(TIPO_DE_CAMPO_CONDICION["sesion.intent"]).toBe("lista");
    expect(TIPO_DE_CAMPO_CONDICION["lead.etiquetas"]).toBe("multilista");
    expect(TIPO_DE_CAMPO_CONDICION["vehiculo.marca"]).toBe("texto");
    expect(TIPO_DE_CAMPO_CONDICION["sesion.precio_cotizado"]).toBe("numero");
    expect(TIPO_DE_CAMPO_CONDICION["lead.alta"]).toBe("fecha");
    expect(TIPO_DE_CAMPO_CONDICION["lead.ultimo_mensaje"]).toBe("fecha");
  });

  it("los vivos son los que se leen al evaluar, no los que siembra el disparo", () => {
    expect([...CAMPOS_VIVOS].sort()).toEqual(
      [
        "lead.alta",
        "lead.etiquetas",
        "lead.ultimo_mensaje",
        "sesion.intent",
        "sesion.precio_cotizado",
        "vehiculo.marca",
      ].sort(),
    );
  });

  it("camposVivosDe devuelve sólo los vivos que el árbol usa, sin repetir", () => {
    const arbol = grupo("y", [
      fila("lead.etapa", "es", { tipo: "opcion", valor: "cotizado" }, "a"),
      fila("sesion.intent", "es", { tipo: "opcion", valor: "i1" }, "b"),
      grupo(
        "o",
        [
          fila("vehiculo.marca", "es", { tipo: "texto", valor: "Toyota" }, "c"),
          fila("vehiculo.marca", "es", { tipo: "texto", valor: "Ford" }, "d"),
        ],
        "g2",
      ),
    ]);
    expect([...camposVivosDe(arbol)].sort()).toEqual(["sesion.intent", "vehiculo.marca"]);
  });
});

describe("Intent detectado", () => {
  const regla = fila("sesion.intent", "es", { tipo: "opcion", valor: "intent-consulta" });

  it("compara el id del intent del último turno clasificado", () => {
    expect(cumple(regla, { sesion: { intent: "intent-consulta" } })).toBe(true);
    expect(cumple(regla, { sesion: { intent: "intent-otro" } })).toBe(false);
  });

  it("sin turno clasificado es ausente: false, y 'está vacío' se cumple", () => {
    expect(cumple(regla, { sesion: { intent: null } })).toBe(false);
    expect(cumple(fila("sesion.intent", "esta_vacio", { tipo: "ninguno" }), { sesion: {} })).toBe(
      true,
    );
  });
});

describe("Etiquetas del lead", () => {
  const ctx = { lead: { etiquetas: ["t-cotizar", "t-urgente"] } };

  it("tiene alguna de / tiene todas / no tiene", () => {
    expect(
      cumple(fila("lead.etiquetas", "tiene", { tipo: "opciones", valores: ["t-urgente"] }), ctx),
    ).toBe(true);
    expect(
      cumple(
        fila("lead.etiquetas", "tiene_todas", {
          tipo: "opciones",
          valores: ["t-urgente", "t-mayorista"],
        }),
        ctx,
      ),
    ).toBe(false);
    expect(
      cumple(
        fila("lead.etiquetas", "no_tiene", { tipo: "opciones", valores: ["t-mayorista"] }),
        ctx,
      ),
    ).toBe(true);
    expect(
      cumple(fila("lead.etiquetas", "no_tiene", { tipo: "opciones", valores: ["t-cotizar"] }), ctx),
    ).toBe(false);
  });

  it("un lead sin etiquetas no tiene ninguna, y está vacío", () => {
    const vacio = { lead: { etiquetas: [] } };
    expect(
      cumple(fila("lead.etiquetas", "no_tiene", { tipo: "opciones", valores: ["t-x"] }), vacio),
    ).toBe(true);
    expect(cumple(fila("lead.etiquetas", "esta_vacio", { tipo: "ninguno" }), vacio)).toBe(true);
  });

  it("si el dato no se cargó (ausente) no afirma nada, ni siquiera 'no tiene'", () => {
    expect(
      cumple(fila("lead.etiquetas", "no_tiene", { tipo: "opciones", valores: ["t-x"] }), {}),
    ).toBe(false);
  });
});

describe("Marca del vehículo: texto, con la semántica de texto de siempre", () => {
  it("'es' compara exacto y 'contiene' sin mayúsculas", () => {
    const ctx = { vehiculo: { marca: "Toyota" } };
    expect(cumple(fila("vehiculo.marca", "es", { tipo: "texto", valor: "Toyota" }), ctx)).toBe(
      true,
    );
    expect(cumple(fila("vehiculo.marca", "es", { tipo: "texto", valor: "toyota" }), ctx)).toBe(
      false,
    );
    expect(cumple(fila("vehiculo.marca", "contiene", { tipo: "texto", valor: "toy" }), ctx)).toBe(
      true,
    );
  });

  it("sin vehículo es ausente", () => {
    expect(cumple(fila("vehiculo.marca", "no_es", { tipo: "texto", valor: "Ford" }), {})).toBe(
      false,
    );
  });
});

describe("operadores de número", () => {
  const ctx = { sesion: { precio_cotizado: 150 } };
  const precio = (c: Comparador, v: ValorCondicion) =>
    cumple(fila("sesion.precio_cotizado", c, v), ctx);

  it("mayor, menor, es y no es", () => {
    expect(precio("mayor_que", { tipo: "numero", valor: 100 })).toBe(true);
    expect(precio("mayor_que", { tipo: "numero", valor: 150 })).toBe(false);
    expect(precio("menor_que", { tipo: "numero", valor: 200 })).toBe(true);
    expect(precio("es", { tipo: "numero", valor: 150 })).toBe(true);
    expect(precio("no_es", { tipo: "numero", valor: 150 })).toBe(false);
  });

  it("entre incluye los dos extremos", () => {
    expect(precio("entre", { tipo: "rango", desde: 150, hasta: 200 })).toBe(true);
    expect(precio("entre", { tipo: "rango", desde: 100, hasta: 150 })).toBe(true);
    expect(precio("entre", { tipo: "rango", desde: 151, hasta: 200 })).toBe(false);
  });

  it("un número ausente o que no es número no se cumple con ningún comparador de valor", () => {
    const r = fila("sesion.precio_cotizado", "menor_que", { tipo: "numero", valor: 1000 });
    expect(cumple(r, { sesion: {} })).toBe(false);
    expect(cumple(r, { sesion: { precio_cotizado: "150" } })).toBe(false);
  });
});

describe("operadores de fecha", () => {
  // 2026-09-25 01:30 en Buenos Aires es 2026-09-25T04:30Z; en UTC ya es 25.
  // 2026-09-24T23:30 en Buenos Aires es 2026-09-25T02:30Z: en UTC sería el 25.
  const tarde24 = { lead: { alta: "2026-09-25T02:30:00.000Z" } };

  it("antes/después comparan el día calendario en la zona del negocio, no en UTC", () => {
    expect(
      cumple(fila("lead.alta", "antes_de", { tipo: "fecha", valor: "2026-09-25" }), tarde24),
    ).toBe(true);
    expect(
      cumple(
        fila("lead.alta", "antes_de", { tipo: "fecha", valor: "2026-09-25" }),
        tarde24,
        undefined,
        "UTC",
      ),
    ).toBe(false);
    expect(
      cumple(fila("lead.alta", "despues_de", { tipo: "fecha", valor: "2026-09-23" }), tarde24),
    ).toBe(true);
    expect(
      cumple(fila("lead.alta", "despues_de", { tipo: "fecha", valor: "2026-09-24" }), tarde24),
    ).toBe(false);
  });

  it("entre incluye los dos días", () => {
    expect(
      cumple(
        fila("lead.alta", "entre", {
          tipo: "rangoFecha",
          desde: "2026-09-24",
          hasta: "2026-09-24",
        }),
        tarde24,
      ),
    ).toBe(true);
  });

  it("hace más de N días mide desde ahora, en días de 24 h", () => {
    const ahora = new Date("2026-09-25T15:00:00Z");
    const ultimo = (iso: string) => ({ lead: { ultimo_mensaje: iso } });
    const regla = fila("lead.ultimo_mensaje", "hace_mas_de", { tipo: "numero", valor: 3 });
    expect(cumple(regla, ultimo("2026-09-22T14:59:00Z"), ahora)).toBe(true);
    expect(cumple(regla, ultimo("2026-09-22T15:01:00Z"), ahora)).toBe(false);
  });

  it("acepta un Date además del ISO, y una fecha inválida no se cumple", () => {
    const regla = fila("lead.alta", "antes_de", { tipo: "fecha", valor: "2026-10-01" });
    expect(cumple(regla, { lead: { alta: new Date("2026-09-01T12:00:00Z") } })).toBe(true);
    expect(cumple(regla, { lead: { alta: "no es fecha" } })).toBe(false);
  });
});

describe("el modelo compartido ofrece 'hace más de' en las fechas", () => {
  it("con un número de días como valor", () => {
    expect(COMPARADORES_POR_TIPO.fecha).toContain("hace_mas_de");
    expect(valorPorDefecto("fecha", "hace_mas_de")).toEqual({ tipo: "numero", valor: null });
  });
});

describe("el schema del motor valida los campos y operadores nuevos", () => {
  const ok = (r: Regla) => CondicionSchema.safeParse({ arbol: grupo("y", [r]) }).success;

  it("acepta cada operador nuevo con su valor", () => {
    expect(ok(fila("sesion.precio_cotizado", "entre", { tipo: "rango", desde: 1, hasta: 2 }))).toBe(
      true,
    );
    expect(
      ok(
        fila("lead.alta", "entre", {
          tipo: "rangoFecha",
          desde: "2026-01-01",
          hasta: "2026-02-01",
        }),
      ),
    ).toBe(true);
    expect(ok(fila("lead.ultimo_mensaje", "hace_mas_de", { tipo: "numero", valor: 7 }))).toBe(true);
    expect(ok(fila("lead.etiquetas", "tiene", { tipo: "opciones", valores: ["t1"] }))).toBe(true);
    expect(ok(fila("sesion.intent", "es", { tipo: "opcion", valor: "i1" }))).toBe(true);
  });

  it("rechaza un rango al revés, días negativos y una fecha que no es un día", () => {
    expect(
      problemasDeArbol(
        grupo("y", [
          fila("sesion.precio_cotizado", "entre", { tipo: "rango", desde: 5, hasta: 1 }),
        ]),
      ),
    ).toEqual(["la fila 1 (sesion.precio_cotizado): el rango empieza después de terminar"]);
    expect(
      problemasDeArbol(
        grupo("y", [fila("lead.ultimo_mensaje", "hace_mas_de", { tipo: "numero", valor: -1 })]),
      ),
    ).toEqual(["la fila 1 (lead.ultimo_mensaje): los días no pueden ser negativos"]);
    expect(
      problemasDeArbol(
        grupo("y", [fila("lead.alta", "antes_de", { tipo: "fecha", valor: "ayer" })]),
      ),
    ).toEqual(['la fila 1 (lead.alta): "ayer" no es una fecha (AAAA-MM-DD)']);
  });

  it("rechaza 'hace más de' sobre un campo que no es fecha", () => {
    expect(ok(fila("sesion.precio_cotizado", "hace_mas_de", { tipo: "numero", valor: 3 }))).toBe(
      false,
    );
  });
});
