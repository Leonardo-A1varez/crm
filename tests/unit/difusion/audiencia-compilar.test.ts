import { beforeEach, describe, expect, test } from "vitest";
import { ValidationError } from "@/lib/errors";
import {
  CAMPOS_AUDIENCIA,
  DEFINICION_CAMPO_AUDIENCIA,
  compilarAudiencia,
} from "@/lib/difusion/audiencia";
import {
  COMPARADORES_POR_TIPO,
  type Comparador,
  type Grupo,
  type NodoCondicion,
  type Regla,
  type ValorCondicion,
} from "@/lib/ui/condiciones";

// Ids armados a mano para este archivo: tienen forma de UUID v4 y nada más.
const ETIQUETA_A = "7c1a9a52-3f7e-4b0e-9d7b-2d4f8a1c0e11";
const ETIQUETA_B = "0b6f1d3e-8a2c-4e5f-9b7a-6c5d4e3f2a10";

let n = 0;
beforeEach(() => {
  n = 0;
});

function r(campoId: string | null, comparador: Comparador | null, valor: ValorCondicion): Regla {
  n += 1;
  return { id: `r${n}`, clase: "regla", campoId, comparador, valor };
}

function y(...hijos: NodoCondicion[]): Grupo {
  n += 1;
  return { id: `g${n}`, clase: "grupo", operador: "y", hijos };
}

function o(...hijos: NodoCondicion[]): Grupo {
  n += 1;
  return { id: `g${n}`, clase: "grupo", operador: "o", hijos };
}

const SIN_TODA = { todaLaBase: false } as const;

describe("compilarAudiencia — toda la base es una elección, nunca un default", () => {
  test("un árbol sin filas se rechaza si nadie eligió toda la base", () => {
    expect(() => compilarAudiencia(y(), SIN_TODA)).toThrow(ValidationError);
    expect(() => compilarAudiencia(y(), SIN_TODA)).toThrow(/toda la base/);
  });

  test("un árbol con solo grupos vacíos tampoco es una audiencia", () => {
    expect(() => compilarAudiencia(y(o()), SIN_TODA)).toThrow(ValidationError);
  });

  test("toda la base elegida, con el árbol vacío, compila a toda_la_base", () => {
    expect(compilarAudiencia(y(), { todaLaBase: true })).toEqual({ tipo: "toda_la_base" });
  });

  test("toda la base con condiciones es una contradicción y se rechaza", () => {
    const arbol = y(r("canal", "tiene", { tipo: "opciones", valores: ["wa"] }));
    expect(() => compilarAudiencia(arbol, { todaLaBase: true })).toThrow(ValidationError);
  });
});

describe("compilarAudiencia — filas", () => {
  test("etapa compila sus valores sin repetir", () => {
    const arbol = y(
      r("etapa", "tiene", { tipo: "opciones", valores: ["cotizado", "negociando", "cotizado"] }),
    );
    expect(compilarAudiencia(arbol, SIN_TODA)).toEqual({
      tipo: "grupo",
      operador: "y",
      hijos: [
        { tipo: "regla", campo: "etapa", comparador: "tiene", valores: ["cotizado", "negociando"] },
      ],
    });
  });

  test("una fila sin terminar no compila", () => {
    const arbol = y(r("etapa", "tiene", { tipo: "opciones", valores: [] }));
    expect(() => compilarAudiencia(arbol, SIN_TODA)).toThrow(/sin terminar/);
  });

  test("una fila sin campo elegido no compila", () => {
    const arbol = y(r(null, null, { tipo: "ninguno" }));
    expect(() => compilarAudiencia(arbol, SIN_TODA)).toThrow(ValidationError);
  });

  test.each(["respondio_campania", "campo_twin", "cualquiera"])(
    "el campo %s no se puede resolver: falla en voz alta y lo nombra",
    (campo) => {
      const arbol = y(r(campo, "tiene", { tipo: "opciones", valores: [ETIQUETA_A] }));
      expect(() => compilarAudiencia(arbol, SIN_TODA)).toThrow(ValidationError);
      expect(() => compilarAudiencia(arbol, SIN_TODA)).toThrow(new RegExp(campo));
    },
  );

  test("un comparador que el campo no admite se rechaza y se nombra", () => {
    const arbol = y(r("etapa", "mayor_que", { tipo: "numero", valor: 3 }));
    expect(() => compilarAudiencia(arbol, SIN_TODA)).toThrow(/mayor_que/);
  });

  test("un valor del tipo equivocado para el campo se rechaza", () => {
    const arbol = y(r("etapa", "tiene", { tipo: "texto", valor: "cotizado" }));
    expect(() => compilarAudiencia(arbol, SIN_TODA)).toThrow(ValidationError);
  });

  test("una etapa que no existe se rechaza y se nombra", () => {
    const arbol = y(r("etapa", "tiene", { tipo: "opciones", valores: ["volando"] }));
    expect(() => compilarAudiencia(arbol, SIN_TODA)).toThrow(/volando/);
  });

  test("canal y motivo de pérdida se validan contra sus enums", () => {
    expect(() =>
      compilarAudiencia(y(r("canal", "tiene", { tipo: "opciones", valores: ["wa"] })), SIN_TODA),
    ).not.toThrow();
    expect(() =>
      compilarAudiencia(
        y(r("canal", "tiene", { tipo: "opciones", valores: ["telegram"] })),
        SIN_TODA,
      ),
    ).toThrow(/telegram/);
    expect(() =>
      compilarAudiencia(
        y(r("motivo_perdida", "no_tiene", { tipo: "opciones", valores: ["precio"] })),
        SIN_TODA,
      ),
    ).not.toThrow();
    expect(() =>
      compilarAudiencia(
        y(r("motivo_perdida", "tiene", { tipo: "opciones", valores: ["capricho"] })),
        SIN_TODA,
      ),
    ).toThrow(/capricho/);
  });

  test.each(["etiqueta", "vendedor", "campania_previa"])(
    "%s exige ids: un nombre en lugar de un id se rechaza",
    (campo) => {
      const conNombre = y(r(campo, "tiene", { tipo: "opciones", valores: ["pide-factura"] }));
      expect(() => compilarAudiencia(conNombre, SIN_TODA)).toThrow(ValidationError);

      const conId = y(r(campo, "tiene", { tipo: "opciones", valores: [ETIQUETA_A] }));
      expect(compilarAudiencia(conId, SIN_TODA)).toMatchObject({
        hijos: [{ campo, comparador: "tiene", valores: [ETIQUETA_A] }],
      });
    },
  );

  test("tiene todas deduplica, porque la cuenta en la base compara cantidades", () => {
    const arbol = y(
      r("etiqueta", "tiene_todas", {
        tipo: "opciones",
        valores: [ETIQUETA_A, ETIQUETA_B, ETIQUETA_A],
      }),
    );
    expect(compilarAudiencia(arbol, SIN_TODA)).toMatchObject({
      hijos: [{ campo: "etiqueta", comparador: "tiene_todas", valores: [ETIQUETA_A, ETIQUETA_B] }],
    });
  });

  test("el texto se recorta y viaja literal", () => {
    const arbol = y(r("consulta", "contiene", { tipo: "texto", valor: "  pastilla  " }));
    expect(compilarAudiencia(arbol, SIN_TODA)).toMatchObject({
      hijos: [{ campo: "consulta", comparador: "contiene", texto: "pastilla" }],
    });
  });

  test("está vacío no lleva valor", () => {
    const arbol = y(r("consulta", "esta_vacio", { tipo: "ninguno" }));
    expect(compilarAudiencia(arbol, SIN_TODA)).toEqual({
      tipo: "grupo",
      operador: "y",
      hijos: [{ tipo: "regla", campo: "consulta", comparador: "esta_vacio" }],
    });
  });

  test("última actividad lleva días no negativos", () => {
    const bien = y(r("ultima_actividad", "mayor_que", { tipo: "numero", valor: 21 }));
    expect(compilarAudiencia(bien, SIN_TODA)).toMatchObject({
      hijos: [{ campo: "ultima_actividad", comparador: "mayor_que", numero: 21 }],
    });

    const negativo = y(r("ultima_actividad", "menor_que", { tipo: "numero", valor: -1 }));
    expect(() => compilarAudiencia(negativo, SIN_TODA)).toThrow(ValidationError);
  });
});

describe("compilarAudiencia — grupos", () => {
  test("conserva el anidado y el operador de cada grupo", () => {
    const arbol = y(
      r("etapa", "tiene", { tipo: "opciones", valores: ["cotizado"] }),
      o(
        r("consulta", "contiene", { tipo: "texto", valor: "pastilla" }),
        r("consulta", "contiene", { tipo: "texto", valor: "disco de freno" }),
      ),
    );
    expect(compilarAudiencia(arbol, SIN_TODA)).toEqual({
      tipo: "grupo",
      operador: "y",
      hijos: [
        { tipo: "regla", campo: "etapa", comparador: "tiene", valores: ["cotizado"] },
        {
          tipo: "grupo",
          operador: "o",
          hijos: [
            { tipo: "regla", campo: "consulta", comparador: "contiene", texto: "pastilla" },
            { tipo: "regla", campo: "consulta", comparador: "contiene", texto: "disco de freno" },
          ],
        },
      ],
    });
  });

  test("un grupo anidado vacío se rechaza: un Y de nada es todo y un O de nada es nadie", () => {
    const arbol = y(r("etapa", "tiene", { tipo: "opciones", valores: ["cotizado"] }), o());
    expect(() => compilarAudiencia(arbol, SIN_TODA)).toThrow(ValidationError);
  });

  test("valida la forma del árbol antes de compilar", () => {
    expect(() => compilarAudiencia({ clase: "regla" } as unknown as Grupo, SIN_TODA)).toThrow(
      ValidationError,
    );
  });
});

describe("DEFINICION_CAMPO_AUDIENCIA", () => {
  test("cada campo ofrece solo comparadores que su tipo sabe editar", () => {
    for (const campo of CAMPOS_AUDIENCIA) {
      const def = DEFINICION_CAMPO_AUDIENCIA[campo];
      for (const c of def.comparadores) {
        expect(COMPARADORES_POR_TIPO[def.tipo]).toContain(c);
      }
    }
  });

  test("no ofrece campos que la base no sabe resolver", () => {
    expect(CAMPOS_AUDIENCIA).not.toContain("respondio_campania");
    expect(CAMPOS_AUDIENCIA).not.toContain("campo_twin");
  });
});
