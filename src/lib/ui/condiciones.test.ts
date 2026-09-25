import { describe, expect, it } from "vitest";
import {
  COMPARADORES_POR_TIPO,
  PROFUNDIDAD_MAX,
  comparadorSinValor,
  comparadoresDe,
  condicionCompleta,
  condicionVacia,
  contarIncompletas,
  contarReglas,
  desagrupar,
  etiquetaComparador,
  grupoVacio,
  nuevoId,
  operadorOpuesto,
  profundidad,
  quitar,
  reemplazar,
  reglaIncompleta,
  reglaVacia,
  valorPorDefecto,
  type CampoCondicion,
  type Grupo,
  type Regla,
} from "./condiciones";

function regla(over: Partial<Regla> = {}): Regla {
  return { ...reglaVacia(), ...over };
}

function grupo(hijos: Grupo["hijos"], operador: Grupo["operador"] = "y"): Grupo {
  return { id: nuevoId(), clase: "grupo", operador, hijos };
}

/**
 * El invariante que da sentido al modelo entero: `A Y B O C` no se puede
 * escribir. No es un test de una función, es un test de la *forma* del tipo —
 * si alguien agrega un operador por fila, esto deja de compilar o deja de
 * pasar, que es exactamente lo que se quiere.
 */
describe("el operador vive en el grupo", () => {
  it("un grupo tiene un solo operador para todos sus hijos", () => {
    const g = grupo([regla(), regla(), regla()], "o");
    expect(g.operador).toBe("o");
    // No hay ningún lugar donde una regla lleve su propio operador.
    for (const h of g.hijos) expect(h).not.toHaveProperty("operador");
  });

  it("mezclar Y con O obliga a un grupo anidado, que es visible", () => {
    const interno = grupo([regla(), regla()], "o");
    const raiz = grupo([regla(), interno], "y");
    expect(profundidad(raiz)).toBe(2);
    expect(raiz.hijos.filter((h) => h.clase === "grupo")).toHaveLength(1);
  });

  it("operadorOpuesto alterna, para que un grupo nuevo aporte algo", () => {
    expect(operadorOpuesto("y")).toBe("o");
    expect(operadorOpuesto("o")).toBe("y");
  });
});

describe("tope de anidado", () => {
  it("son tres niveles", () => {
    expect(PROFUNDIDAD_MAX).toBe(3);
  });

  it("profundidad cuenta grupos, no reglas", () => {
    expect(profundidad(regla())).toBe(0);
    expect(profundidad(grupo([regla()]))).toBe(1);
    expect(profundidad(grupo([grupo([grupo([regla()])])]))).toBe(3);
  });
});

describe("una fila incompleta se detecta por su valor, no por su tipo", () => {
  it("sin campo o sin comparador está incompleta", () => {
    expect(reglaIncompleta(regla())).toBe(true);
    expect(reglaIncompleta(regla({ campoId: "etapa", comparador: null }))).toBe(true);
  });

  it("una multilista sin ningún valor está incompleta", () => {
    const r = regla({
      campoId: "etiqueta",
      comparador: "tiene",
      valor: { tipo: "opciones", valores: [] },
    });
    expect(reglaIncompleta(r)).toBe(true);
    expect(reglaIncompleta({ ...r, valor: { tipo: "opciones", valores: ["vip"] } })).toBe(false);
  });

  it("un texto en blanco o de puros espacios está incompleto", () => {
    const base = { campoId: "vehiculo", comparador: "contiene" } as const;
    expect(reglaIncompleta(regla({ ...base, valor: { tipo: "texto", valor: "   " } }))).toBe(true);
    expect(reglaIncompleta(regla({ ...base, valor: { tipo: "texto", valor: "Aveo" } }))).toBe(
      false,
    );
  });

  it("un rango con una sola punta está incompleto", () => {
    const base = { campoId: "monto", comparador: "entre" } as const;
    expect(
      reglaIncompleta(regla({ ...base, valor: { tipo: "rango", desde: 10, hasta: null } })),
    ).toBe(true);
    expect(
      reglaIncompleta(regla({ ...base, valor: { tipo: "rango", desde: 10, hasta: 20 } })),
    ).toBe(false);
  });

  it("un rango de fechas con una sola punta está incompleto", () => {
    const base = { campoId: "creado", comparador: "entre" } as const;
    expect(
      reglaIncompleta(
        regla({ ...base, valor: { tipo: "rangoFecha", desde: "2026-01-01", hasta: null } }),
      ),
    ).toBe(true);
  });

  it("los comparadores sin valor están completos apenas se eligen", () => {
    const r = regla({ campoId: "email", comparador: "esta_vacio", valor: { tipo: "ninguno" } });
    expect(reglaIncompleta(r)).toBe(false);
  });

  it("un booleano en false NO está incompleto", () => {
    // El bug clásico: `!valor` trata al `false` legítimo como ausencia.
    const r = regla({
      campoId: "tiene_vehiculo",
      comparador: "es",
      valor: { tipo: "booleano", valor: false },
    });
    expect(reglaIncompleta(r)).toBe(false);
  });

  it("un número 0 NO está incompleto", () => {
    const r = regla({
      campoId: "dias",
      comparador: "mayor_que",
      valor: { tipo: "numero", valor: 0 },
    });
    expect(reglaIncompleta(r)).toBe(false);
  });
});

/**
 * La regla que impide que un contador mienta: mientras haya una fila a medias,
 * ninguna pantalla muestra una cifra. Las dos —el editor de workflows y el
 * constructor de audiencia— preguntan lo mismo con esta función.
 */
describe("contarIncompletas recorre el árbol entero", () => {
  it("suma las de los grupos anidados", () => {
    const completa = regla({
      campoId: "etapa",
      comparador: "es",
      valor: { tipo: "opcion", valor: "nuevo" },
    });
    const raiz = grupo([completa, grupo([regla(), grupo([regla(), completa])])]);
    expect(contarReglas(raiz)).toBe(4);
    expect(contarIncompletas(raiz)).toBe(2);
    expect(condicionCompleta(raiz)).toBe(false);
  });

  it("un árbol entero da cero y habilita la cifra", () => {
    const completa = regla({
      campoId: "etapa",
      comparador: "es",
      valor: { tipo: "opcion", valor: "nuevo" },
    });
    expect(condicionCompleta(grupo([completa, grupo([completa])]))).toBe(true);
  });

  it("el árbol recién abierto está incompleto: una fila vacía todavía no dice nada", () => {
    const raiz = condicionVacia();
    expect(contarReglas(raiz)).toBe(1);
    expect(condicionCompleta(raiz)).toBe(false);
  });

  it("un grupo nuevo nace con dos filas, porque una sola no agrupa nada", () => {
    expect(grupoVacio("o").hijos).toHaveLength(2);
  });
});

describe("cirugía del árbol, siempre inmutable", () => {
  it("reemplazar no muta la raíz vieja", () => {
    const objetivo = regla();
    const raiz = grupo([regla(), grupo([objetivo])]);
    const antes = JSON.stringify(raiz);
    const nueva = reemplazar(raiz, objetivo.id, { ...objetivo, campoId: "etapa" });
    expect(JSON.stringify(raiz)).toBe(antes);
    expect(nueva).not.toBe(raiz);
    expect(contarReglas(nueva)).toBe(2);
  });

  it("reemplazar alcanza cualquier nivel", () => {
    const hondo = regla();
    const raiz = grupo([grupo([grupo([hondo])])]);
    const nueva = reemplazar(raiz, hondo.id, { ...hondo, campoId: "canal" });
    const g1 = nueva.hijos[0];
    const g2 = g1?.clase === "grupo" ? g1.hijos[0] : undefined;
    const r = g2?.clase === "grupo" ? g2.hijos[0] : undefined;
    expect(r?.clase === "regla" ? r.campoId : null).toBe("canal");
  });

  it("quitar la última fila de un grupo se lleva el grupo", () => {
    const sola = regla();
    const raiz = grupo([regla(), grupo([sola])]);
    const nueva = quitar(raiz, sola.id);
    expect(nueva.hijos).toHaveLength(1);
    expect(nueva.hijos[0]?.clase).toBe("regla");
  });

  it("desagrupar sube los hijos cuando el operador coincide", () => {
    const a = regla();
    const b = regla();
    const interno = grupo([a, b], "y");
    const raiz = grupo([regla(), interno], "y");
    const nueva = desagrupar(raiz, interno.id);
    expect(nueva.hijos).toHaveLength(3);
    expect(nueva.hijos.every((h) => h.clase === "regla")).toBe(true);
  });

  it("desagrupar NO hace nada si el operador difiere: cambiaría el significado", () => {
    const interno = grupo([regla(), regla()], "o");
    const raiz = grupo([regla(), interno], "y");
    const nueva = desagrupar(raiz, interno.id);
    expect(nueva.hijos).toHaveLength(2);
    expect(nueva.hijos[1]?.clase).toBe("grupo");
  });
});

describe("comparadores por tipo", () => {
  it("un campo de lista no ofrece 'es mayor que'", () => {
    expect(COMPARADORES_POR_TIPO.lista).not.toContain("mayor_que");
    expect(COMPARADORES_POR_TIPO.multilista).not.toContain("mayor_que");
  });

  it("esta_vacio y no_esta_vacio son los que no llevan valor", () => {
    expect(comparadorSinValor("esta_vacio")).toBe(true);
    expect(comparadorSinValor("no_esta_vacio")).toBe(true);
    expect(comparadorSinValor("es")).toBe(false);
  });

  it("valorPorDefecto respeta el tipo, y 'entre' sobre fechas da dos fechas", () => {
    expect(valorPorDefecto("multilista", "tiene")).toEqual({ tipo: "opciones", valores: [] });
    expect(valorPorDefecto("numero", "entre")).toEqual({
      tipo: "rango",
      desde: null,
      hasta: null,
    });
    expect(valorPorDefecto("fecha", "entre")).toEqual({
      tipo: "rangoFecha",
      desde: null,
      hasta: null,
    });
    expect(valorPorDefecto("texto", "esta_vacio")).toEqual({ tipo: "ninguno" });
  });
});

/**
 * Lo que hace que un solo modelo sirva a las dos pantallas: la operación es la
 * misma, el idioma lo pone cada dominio. Un workflow pregunta si el lead
 * "tiene alguna de" estas etiquetas; una difusión pregunta si la etapa "es
 * alguna de" estas. Es el mismo `tiene`.
 */
describe("cada dominio pone su vocabulario sin duplicar el modelo", () => {
  const etapaAudiencia: CampoCondicion = {
    id: "etapa",
    etiqueta: "Etapa del lead",
    tipo: "multilista",
    comparadores: ["tiene", "no_tiene"],
    etiquetas: { tiene: "es alguna de", no_tiene: "no es ninguna de" },
  };

  const etiquetasWorkflow: CampoCondicion = {
    id: "lead_tags",
    etiqueta: "Etiquetas del lead",
    tipo: "multilista",
  };

  it("un campo recorta los comparadores de su tipo", () => {
    expect(comparadoresDe(etapaAudiencia)).toEqual(["tiene", "no_tiene"]);
    expect(comparadoresDe(etiquetasWorkflow)).toBe(COMPARADORES_POR_TIPO.multilista);
  });

  it("el mismo comparador se lee distinto en cada pantalla", () => {
    expect(etiquetaComparador(etapaAudiencia, "tiene")).toBe("es alguna de");
    expect(etiquetaComparador(etiquetasWorkflow, "tiene")).toBe("tiene alguna de");
  });

  it("sin override cae al rótulo por defecto", () => {
    expect(etiquetaComparador(etapaAudiencia, "esta_vacio")).toBe("está vacío");
  });
});
