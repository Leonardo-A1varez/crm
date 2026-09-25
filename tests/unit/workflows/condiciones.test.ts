import { describe, expect, it } from "vitest";
import type { Comparador, Grupo, NodoCondicion, Regla, ValorCondicion } from "@/lib/ui/condiciones";
import {
  CAMPOS_CONDICION,
  OPERADORES,
  arbolDeCondicionPlana,
  evaluarCondicion,
  type CondicionPlana,
} from "@/lib/workflows/condiciones";

const contexto = { lead: { etapa: "cotizado", nombre: "Ana" }, sesion: { respondio: false } };

describe("evaluarCondicion — trío plano", () => {
  it("compara igualdad por campo de la lista blanca", () => {
    expect(
      evaluarCondicion({ campo: "lead.etapa", operador: "es", valor: "cotizado" }, contexto),
    ).toBe(true);
    expect(
      evaluarCondicion({ campo: "lead.etapa", operador: "es", valor: "perdido" }, contexto),
    ).toBe(false);
  });

  it("no_es es la negacion exacta de es", () => {
    expect(
      evaluarCondicion({ campo: "lead.etapa", operador: "no_es", valor: "perdido" }, contexto),
    ).toBe(true);
  });

  it("contiene compara texto sin distinguir mayusculas", () => {
    expect(
      evaluarCondicion({ campo: "lead.nombre", operador: "contiene", valor: "AN" }, contexto),
    ).toBe(true);
  });

  it("un campo ausente del contexto es false, no una excepcion", () => {
    // Un flujo no se cae porque un dato todavia no exista: la rama falso es
    // una respuesta valida y el canvas siempre la tiene conectada.
    expect(evaluarCondicion({ campo: "lead.etapa", operador: "es", valor: "x" }, {})).toBe(false);
  });

  it("es_verdadero lee booleanos", () => {
    expect(
      evaluarCondicion(
        { campo: "sesion.respondio", operador: "es_verdadero", valor: null },
        contexto,
      ),
    ).toBe(false);
  });

  it("es_falso se cumple sólo con un false de verdad, no con un campo ausente", () => {
    expect(
      evaluarCondicion({ campo: "sesion.respondio", operador: "es_falso", valor: null }, contexto),
    ).toBe(true);
    expect(
      evaluarCondicion({ campo: "sesion.respondio", operador: "es_falso", valor: null }, {}),
    ).toBe(false);
  });
});

// Fixtures armados a mano para estos tests: no salen de ningún dato real.
function fila(
  campoId: string | null,
  comparador: Comparador | null,
  valor: ValorCondicion,
  id = "r1",
): Regla {
  return { id, clase: "regla", campoId, comparador, valor };
}

function grupo(operador: "y" | "o", hijos: NodoCondicion[], id = "g"): Grupo {
  return { id, clase: "grupo", operador, hijos };
}

const ETAPA_COTIZADO = fila("lead.etapa", "es", { tipo: "opcion", valor: "cotizado" }, "r-etapa");
const RESPONDIO = fila("sesion.respondio", "es", { tipo: "booleano", valor: true }, "r-resp");
const NOMBRE_AN = fila("lead.nombre", "contiene", { tipo: "texto", valor: "an" }, "r-nombre");

describe("evaluarCondicion — árbol Y/O", () => {
  it("Y: se cumple sólo si se cumplen todas las filas", () => {
    expect(evaluarCondicion({ arbol: grupo("y", [ETAPA_COTIZADO, NOMBRE_AN]) }, contexto)).toBe(
      true,
    );
    expect(evaluarCondicion({ arbol: grupo("y", [ETAPA_COTIZADO, RESPONDIO]) }, contexto)).toBe(
      false,
    );
  });

  it("O: se cumple si se cumple al menos una fila", () => {
    expect(evaluarCondicion({ arbol: grupo("o", [RESPONDIO, NOMBRE_AN]) }, contexto)).toBe(true);
    expect(
      evaluarCondicion(
        {
          arbol: grupo("o", [
            RESPONDIO,
            fila("lead.etapa", "es", { tipo: "opcion", valor: "perdido" }, "r2"),
          ]),
        },
        contexto,
      ),
    ).toBe(false);
  });

  it("evalúa el árbol completo, con grupos anidados hasta tres niveles", () => {
    // etapa = cotizado Y (respondió O (nombre contiene "an" Y canal es wa))
    const arbol = grupo("y", [
      ETAPA_COTIZADO,
      grupo(
        "o",
        [
          RESPONDIO,
          grupo(
            "y",
            [NOMBRE_AN, fila("lead.canal", "es", { tipo: "opcion", valor: "wa" }, "r-canal")],
            "g3",
          ),
        ],
        "g2",
      ),
    ]);
    expect(
      evaluarCondicion({ arbol }, { ...contexto, lead: { ...contexto.lead, canal: "wa" } }),
    ).toBe(true);
    expect(
      evaluarCondicion({ arbol }, { ...contexto, lead: { ...contexto.lead, canal: "ig" } }),
    ).toBe(false);
  });

  it("un grupo vacío no se cumple nunca, ni con Y ni con O: una condición sin filas no acierta de más", () => {
    expect(evaluarCondicion({ arbol: grupo("y", []) }, contexto)).toBe(false);
    expect(evaluarCondicion({ arbol: grupo("o", []) }, contexto)).toBe(false);
    expect(
      evaluarCondicion({ arbol: grupo("y", [ETAPA_COTIZADO, grupo("o", [], "g2")]) }, contexto),
    ).toBe(false);
  });

  it("una fila sin campo o sin comparador no se cumple", () => {
    expect(
      evaluarCondicion(
        { arbol: grupo("y", [fila(null, "es", { tipo: "opcion", valor: "x" })]) },
        contexto,
      ),
    ).toBe(false);
    expect(
      evaluarCondicion(
        { arbol: grupo("y", [fila("lead.etapa", null, { tipo: "ninguno" })]) },
        contexto,
      ),
    ).toBe(false);
  });

  it("texto: contiene, no contiene y empieza con no distinguen mayúsculas; es compara exacto", () => {
    const ctx = { lead: { nombre: "Juan Pérez" } };
    const texto = (c: Comparador, valor: string) =>
      evaluarCondicion(
        { arbol: grupo("y", [fila("lead.nombre", c, { tipo: "texto", valor })]) },
        ctx,
      );
    expect(texto("contiene", "PÉREZ")).toBe(true);
    expect(texto("no_contiene", "pérez")).toBe(false);
    expect(texto("no_contiene", "gómez")).toBe(true);
    expect(texto("empieza_con", "juan")).toBe(true);
    expect(texto("empieza_con", "pérez")).toBe(false);
    expect(texto("es", "Juan Pérez")).toBe(true);
    expect(texto("es", "juan pérez")).toBe(false);
    expect(texto("no_es", "Pedro")).toBe(true);
  });

  it("está vacío: campo ausente, null o texto en blanco; no está vacío es su negación", () => {
    const vacio = (
      ctx: Record<string, unknown>,
      c: "esta_vacio" | "no_esta_vacio" = "esta_vacio",
    ) =>
      evaluarCondicion({ arbol: grupo("y", [fila("lead.nombre", c, { tipo: "ninguno" })]) }, ctx);
    expect(vacio({})).toBe(true);
    expect(vacio({ lead: { nombre: null } })).toBe(true);
    expect(vacio({ lead: { nombre: "   " } })).toBe(true);
    expect(vacio({ lead: { nombre: "Ana" } })).toBe(false);
    expect(vacio({ lead: { nombre: "Ana" } }, "no_esta_vacio")).toBe(true);
    expect(vacio({}, "no_esta_vacio")).toBe(false);
  });

  it("booleano: 'es sí' y 'es no' comparan contra el booleano, no contra su texto", () => {
    const es = (valor: boolean, ctx: Record<string, unknown>) =>
      evaluarCondicion(
        { arbol: grupo("y", [fila("sesion.respondio", "es", { tipo: "booleano", valor })]) },
        ctx,
      );
    expect(es(true, { sesion: { respondio: true } })).toBe(true);
    expect(es(false, { sesion: { respondio: false } })).toBe(true);
    expect(es(false, { sesion: { respondio: true } })).toBe(false);
    // Ausente no es "no": que el dato no exista no es lo mismo que un false.
    expect(es(false, {})).toBe(false);
  });

  it("un campo ausente no cumple ningún comparador salvo 'está vacío'", () => {
    const ausente = (c: Comparador, valor: ValorCondicion) =>
      evaluarCondicion({ arbol: grupo("y", [fila("lead.etapa", c, valor)]) }, {});
    expect(ausente("es", { tipo: "opcion", valor: "cotizado" })).toBe(false);
    expect(ausente("no_es", { tipo: "opcion", valor: "cotizado" })).toBe(false);
    expect(ausente("esta_vacio", { tipo: "ninguno" })).toBe(true);
  });
});

describe("arbolDeCondicionPlana — el trío guardado antes del árbol, convertido al leer", () => {
  it("es una sola fila dentro de un grupo Y", () => {
    const arbol = arbolDeCondicionPlana({ campo: "lead.etapa", operador: "es", valor: "cotizado" });
    expect(arbol.clase).toBe("grupo");
    expect(arbol.operador).toBe("y");
    expect(arbol.hijos).toEqual([
      expect.objectContaining({
        clase: "regla",
        campoId: "lead.etapa",
        comparador: "es",
        valor: { tipo: "opcion", valor: "cotizado" },
      }),
    ]);
  });

  it("es_falso se convierte en 'es' con el booleano falso; es_verdadero, con el verdadero", () => {
    expect(
      arbolDeCondicionPlana({ campo: "sesion.respondio", operador: "es_falso", valor: null })
        .hijos[0],
    ).toMatchObject({ comparador: "es", valor: { tipo: "booleano", valor: false } });
    expect(
      arbolDeCondicionPlana({ campo: "sesion.respondio", operador: "es_verdadero", valor: null })
        .hijos[0],
    ).toMatchObject({ comparador: "es", valor: { tipo: "booleano", valor: true } });
  });

  it("un campo de texto con valor queda como texto, para que el constructor lo muestre en su input", () => {
    expect(
      arbolDeCondicionPlana({ campo: "lead.nombre", operador: "contiene", valor: "an" }).hijos[0],
    ).toMatchObject({ comparador: "contiene", valor: { tipo: "texto", valor: "an" } });
    expect(
      arbolDeCondicionPlana({ campo: "lead.nombre", operador: "es", valor: "Ana" }).hijos[0],
    ).toMatchObject({ comparador: "es", valor: { tipo: "texto", valor: "Ana" } });
  });
});

/**
 * El evaluador del trío tal como estaba antes de este cambio, copiado al pie
 * de la letra. Es el oráculo: todo trío tiene que dar lo mismo que daba, se
 * evalúe directo o convertido al árbol.
 */
function evaluarTrioComoAntes(cond: CondicionPlana, ctx: Record<string, unknown>): boolean {
  const actual = cond.campo.split(".").reduce<unknown>((a, parte) => {
    if (a === null || typeof a !== "object") return undefined;
    return (a as Record<string, unknown>)[parte];
  }, ctx);
  if (cond.operador === "es_verdadero") return actual === true;
  if (cond.operador === "es_falso") return actual === false;
  if (actual === undefined || actual === null) return false;
  const texto = String(actual);
  if (cond.operador === "es") return texto === cond.valor;
  if (cond.operador === "no_es") return texto !== cond.valor;
  return texto.toLowerCase().includes(String(cond.valor ?? "").toLowerCase());
}

describe("paridad con el trío: un flujo guardado antes del árbol toma la misma rama que antes", () => {
  // Valores y contextos elegidos para pisar los bordes: null, texto vacío,
  // mayúsculas, el texto de un booleano, un campo que no es objeto.
  const VALORES = [null, "", "cotizado", "COT", "Ana", "an", "true", "false", "wa"];
  const CONTEXTOS: Record<string, unknown>[] = [
    {},
    {
      lead: { etapa: "cotizado", nombre: "Ana", canal: "wa" },
      sesion: { respondio: true, tiene_cotizacion: false },
    },
    { lead: { etapa: null, nombre: "" }, sesion: { respondio: false, tiene_cotizacion: true } },
    { lead: { nombre: "   ", etapa: "perdido" }, sesion: { respondio: "true" } },
    { lead: "no es un objeto", sesion: null },
  ];

  it("para cada campo × operador × valor × contexto, directo y convertido dan lo que daba el trío", () => {
    const distintos: string[] = [];
    let casos = 0;
    for (const campo of CAMPOS_CONDICION) {
      for (const operador of OPERADORES) {
        for (const valor of VALORES) {
          const trio: CondicionPlana = { campo, operador, valor };
          for (const ctx of CONTEXTOS) {
            casos += 1;
            const antes = evaluarTrioComoAntes(trio, ctx);
            const directo = evaluarCondicion(trio, ctx);
            const convertido = evaluarCondicion({ arbol: arbolDeCondicionPlana(trio) }, ctx);
            if (directo !== antes || convertido !== antes) {
              distintos.push(
                `${JSON.stringify(trio)} en ${JSON.stringify(ctx)}: antes ${antes}, directo ${directo}, convertido ${convertido}`,
              );
            }
          }
        }
      }
    }
    expect(casos).toBe(
      CAMPOS_CONDICION.length * OPERADORES.length * VALORES.length * CONTEXTOS.length,
    );
    expect(distintos).toEqual([]);
  });
});
