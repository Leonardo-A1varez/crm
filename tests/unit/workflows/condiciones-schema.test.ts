import { describe, expect, it } from "vitest";
import type { Grupo, NodoCondicion, Regla, ValorCondicion, Comparador } from "@/lib/ui/condiciones";
import { CondicionSchema as CondicionSchemaDelMotor } from "@/lib/validation/workflows.schema";
import {
  CondicionSchema,
  ConfigCondicionSchema,
  arbolDeConfig,
  problemasDeArbol,
} from "@/lib/workflows/condiciones.schema";
import { crearRegistro } from "@/server/services/workflows/acciones/registro";
import { ejecutarSegmento, type PasoEjecutado } from "@/server/services/workflows/ejecutor.service";
import type { Grafo } from "@/types/workflows";

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

const COMPLETO: Grupo = grupo("y", [
  fila("lead.etapa", "es", { tipo: "opcion", valor: "cotizado" }, "r1"),
  grupo(
    "o",
    [
      fila("sesion.respondio", "es", { tipo: "booleano", valor: true }, "r2"),
      fila("lead.nombre", "contiene", { tipo: "texto", valor: "an" }, "r3"),
    ],
    "g2",
  ),
]);

/** El primer mensaje de error, que es lo que el ejecutor escribe en la corrida. */
function primerError(valor: unknown): string {
  const r = CondicionSchema.safeParse(valor);
  if (r.success) throw new Error("se esperaba que el schema rechazara la condición");
  return r.error.issues[0]?.message ?? "";
}

describe("CondicionSchema — lo que valida el motor antes de evaluar", () => {
  it("es el mismo schema que importa el ejecutor desde lib/validation", () => {
    expect(CondicionSchemaDelMotor).toBe(CondicionSchema);
  });

  it("acepta el trío plano y completa los defaults que el panel muestra y no guarda", () => {
    expect(CondicionSchema.parse({ campo: "lead.etapa" })).toEqual({
      campo: "lead.etapa",
      operador: "es",
      valor: null,
    });
  });

  it("un operador o un valor null valen su default, igual que configDeCondicion del ejecutor", () => {
    expect(CondicionSchema.parse({ campo: "lead.etapa", operador: null, valor: null })).toEqual({
      campo: "lead.etapa",
      operador: "es",
      valor: null,
    });
  });

  it("un trío sin campo no se evalúa", () => {
    expect(CondicionSchema.safeParse({ operador: "es", valor: "x" }).success).toBe(false);
  });

  it("acepta un árbol completo y descarta las claves del trío que inyecta el ejecutor", () => {
    // `configDeCondicion` le agrega `operador` y `valor` a toda config antes de
    // validarla, también a la de un árbol.
    expect(CondicionSchema.parse({ arbol: COMPLETO, operador: "es", valor: null })).toEqual({
      arbol: COMPLETO,
    });
  });

  it("con 'arbol' presente manda el árbol, aunque quede un trío viejo al lado", () => {
    const r = CondicionSchema.parse({
      arbol: COMPLETO,
      campo: "lead.nombre",
      operador: "contiene",
      valor: "zzz",
    });
    expect(r).toEqual({ arbol: COMPLETO });
  });

  it("un 'arbol' roto no cae al trío que tenga al lado: falla", () => {
    const r = CondicionSchema.safeParse({
      arbol: { clase: "grupo" },
      campo: "lead.etapa",
      operador: "es",
      valor: "cotizado",
    });
    expect(r.success).toBe(false);
  });

  it("rechaza una fila sin campo, nombrando la fila", () => {
    const arbol = grupo("y", [
      fila("lead.etapa", "es", { tipo: "opcion", valor: "cotizado" }, "r1"),
      fila(null, null, { tipo: "ninguno" }, "r2"),
    ]);
    expect(primerError({ arbol })).toBe("la fila 2 no tiene campo");
  });

  it("rechaza un campo que el motor no conoce", () => {
    const arbol = grupo("y", [fila("lead.email", "es", { tipo: "texto", valor: "a" })]);
    expect(primerError({ arbol })).toBe(
      'la fila 1 usa un campo que el motor no conoce: "lead.email"',
    );
  });

  it("rechaza una fila sin comparador", () => {
    const arbol = grupo("y", [fila("lead.etapa", null, { tipo: "ninguno" })]);
    expect(primerError({ arbol })).toBe("la fila 1 (lead.etapa) no tiene comparador");
  });

  it("rechaza un comparador que el tipo del campo no admite", () => {
    const arbol = grupo("y", [fila("lead.etapa", "contiene", { tipo: "texto", valor: "cot" })]);
    expect(primerError({ arbol })).toBe('la fila 1: lead.etapa no admite "contiene"');
  });

  it("rechaza un valor que no corresponde al comparador", () => {
    const arbol = grupo("y", [fila("lead.etapa", "es", { tipo: "texto", valor: "cotizado" })]);
    expect(primerError({ arbol })).toBe(
      "la fila 1 (lead.etapa): el valor no corresponde al comparador",
    );
  });

  it("rechaza una fila a la que le falta el valor", () => {
    const arbol = grupo("y", [fila("lead.nombre", "contiene", { tipo: "texto", valor: "  " })]);
    expect(primerError({ arbol })).toBe("a la fila 1 (lead.nombre) le falta el valor");
  });

  it("rechaza una opción que el campo cerrado no tiene", () => {
    const arbol = grupo("y", [fila("lead.etapa", "es", { tipo: "opcion", valor: "cotizad" })]);
    expect(primerError({ arbol })).toBe(
      'la fila 1: "cotizad" no es un valor posible de lead.etapa',
    );
  });

  it("rechaza una condición sin filas y un grupo vacío", () => {
    expect(primerError({ arbol: grupo("y", []) })).toBe("la condición no tiene ninguna fila");
    expect(
      primerError({
        arbol: grupo("y", [
          fila("lead.etapa", "es", { tipo: "opcion", valor: "cotizado" }),
          grupo("o", [], "g2"),
        ]),
      }),
    ).toBe("hay un grupo sin filas");
  });

  it("rechaza un cuarto nivel de anidado", () => {
    const hondo = grupo("y", [
      grupo(
        "o",
        [
          grupo(
            "y",
            [grupo("o", [fila("lead.etapa", "esta_vacio", { tipo: "ninguno" })], "g4")],
            "g3",
          ),
        ],
        "g2",
      ),
    ]);
    expect(CondicionSchema.safeParse({ arbol: hondo }).success).toBe(false);
  });

  it("acepta exactamente tres niveles", () => {
    const tres = grupo("y", [
      grupo("o", [grupo("y", [fila("lead.etapa", "esta_vacio", { tipo: "ninguno" })], "g3")], "g2"),
    ]);
    expect(CondicionSchema.safeParse({ arbol: tres }).success).toBe(true);
  });

  it("rechaza más de 50 filas", () => {
    const filas = Array.from({ length: 51 }, (_, i) =>
      fila("lead.etapa", "esta_vacio", { tipo: "ninguno" }, `r${i}`),
    );
    expect(CondicionSchema.safeParse({ arbol: grupo("o", filas) }).success).toBe(false);
  });

  it("rechaza una propiedad que el árbol no tiene, en vez de descartarla callada", () => {
    expect(CondicionSchema.safeParse({ arbol: { ...COMPLETO, negado: true } }).success).toBe(false);
  });
});

describe("problemasDeArbol", () => {
  it("un árbol completo no tiene problemas", () => {
    expect(problemasDeArbol(COMPLETO)).toEqual([]);
  });

  it("enumera todos los problemas, no sólo el primero", () => {
    const arbol = grupo("y", [
      fila(null, null, { tipo: "ninguno" }, "r1"),
      fila("lead.nombre", "contiene", { tipo: "texto", valor: "" }, "r2"),
    ]);
    expect(problemasDeArbol(arbol)).toEqual([
      "la fila 1 no tiene campo",
      "a la fila 2 (lead.nombre) le falta el valor",
    ]);
  });
});

describe("ConfigCondicionSchema — la config de logica_condicion tal como se guarda", () => {
  it("acepta una config vacía: la de un nodo recién soltado en el lienzo", () => {
    expect(ConfigCondicionSchema.parse({})).toEqual({});
  });

  it("acepta un trío a medio elegir", () => {
    expect(ConfigCondicionSchema.parse({ campo: "lead.etapa" })).toEqual({ campo: "lead.etapa" });
  });

  it("acepta un árbol con filas a medio terminar: un borrador se guarda a medias", () => {
    const borrador = grupo("y", [fila(null, null, { tipo: "ninguno" })]);
    expect(ConfigCondicionSchema.parse({ arbol: borrador })).toEqual({ arbol: borrador });
  });

  it("rechaza un árbol con la forma rota", () => {
    expect(ConfigCondicionSchema.safeParse({ arbol: { clase: "grupo" } }).success).toBe(false);
  });
});

describe("arbolDeConfig — abrir en el constructor una condición guardada", () => {
  it("un trío plano se abre como un árbol de una fila", () => {
    const arbol = arbolDeConfig({ campo: "lead.etapa", operador: "no_es", valor: "perdido" });
    expect(arbol?.hijos).toEqual([
      expect.objectContaining({
        campoId: "lead.etapa",
        comparador: "no_es",
        valor: { tipo: "opcion", valor: "perdido" },
      }),
    ]);
  });

  it("un trío sin operador se abre con el 'es' que el panel mostraba", () => {
    expect(arbolDeConfig({ campo: "lead.etapa" })?.hijos[0]).toMatchObject({ comparador: "es" });
  });

  it("una config vacía se abre con una fila vacía", () => {
    const arbol = arbolDeConfig({});
    expect(arbol?.operador).toBe("y");
    expect(arbol?.hijos).toEqual([
      expect.objectContaining({ clase: "regla", campoId: null, comparador: null }),
    ]);
  });

  it("un árbol se abre tal cual", () => {
    expect(arbolDeConfig({ arbol: COMPLETO })).toEqual(COMPLETO);
  });

  it("un árbol con la forma rota no se abre: null, en vez de reemplazarlo por uno vacío", () => {
    expect(arbolDeConfig({ arbol: { clase: "grupo" } })).toBeNull();
  });
});

// El motor real, sin tocarlo: trigger -> condición -> (si | no).
function grafoConCondicion(config: Record<string, unknown>): Grafo {
  return {
    nodos: [
      { id: "t", tipo: "trigger_manual", config: {}, posicion: { x: 0, y: 0 } },
      { id: "c", tipo: "logica_condicion", config, posicion: { x: 1, y: 0 } },
      { id: "si", tipo: "logica_detener", config: {}, posicion: { x: 2, y: 0 } },
      { id: "no", tipo: "fin", config: {}, posicion: { x: 2, y: 1 } },
    ],
    aristas: [
      { desde: "t", hasta: "c", puerto: "salida" },
      { desde: "c", hasta: "si", puerto: "verdadero" },
      { desde: "c", hasta: "no", puerto: "falso" },
    ],
  };
}

async function correr(config: Record<string, unknown>, contexto: Record<string, unknown>) {
  const pasos: PasoEjecutado[] = [];
  const resultado = await ejecutarSegmento(
    {
      grafo: grafoConCondicion(config),
      desdeNodo: "t",
      contexto,
      leadId: "lead-1",
      runId: "run-1",
      pasosPrevios: 0,
      maxPasos: 50,
    },
    {
      registro: crearRegistro({}),
      ahora: () => new Date("2026-09-13T12:00:00Z"),
      onPaso: async (p) => {
        pasos.push(p);
      },
    },
  );
  return { resultado, recorrido: pasos.map((p) => p.nodoId) };
}

describe("el ejecutor de producción evalúa el árbol completo", () => {
  const CONTEXTO = { lead: { etapa: "cotizado", nombre: "Ana" }, sesion: { respondio: false } };

  it("sigue por 'verdadero' cuando el árbol se cumple", async () => {
    const { resultado, recorrido } = await correr({ arbol: COMPLETO }, CONTEXTO);
    expect(resultado).toEqual({ tipo: "fin" });
    expect(recorrido).toEqual(["t", "c", "si"]);
  });

  it("sigue por 'falso' cuando no se cumple", async () => {
    const { recorrido } = await correr(
      { arbol: COMPLETO },
      {
        ...CONTEXTO,
        lead: { etapa: "perdido", nombre: "Ana" },
      },
    );
    expect(recorrido).toEqual(["t", "c", "no"]);
  });

  it("un árbol incompleto falla en voz alta, con un motivo que se puede leer", async () => {
    const { resultado } = await correr(
      { arbol: grupo("y", [fila("lead.etapa", "es", { tipo: "opcion", valor: null })]) },
      CONTEXTO,
    );
    expect(resultado).toMatchObject({
      tipo: "fallado",
      nodoId: "c",
      motivo: "condicion_invalida",
      retriable: false,
    });
    expect(resultado.tipo === "fallado" ? resultado.error : "").toContain(
      "a la fila 1 (lead.etapa) le falta el valor",
    );
  });

  it("un trío guardado antes del árbol sigue tomando la misma rama", async () => {
    expect(
      (await correr({ campo: "lead.etapa", operador: "es", valor: "cotizado" }, CONTEXTO))
        .recorrido,
    ).toEqual(["t", "c", "si"]);
    expect(
      (await correr({ campo: "sesion.respondio", operador: "es_falso" }, CONTEXTO)).recorrido,
    ).toEqual(["t", "c", "si"]);
  });
});
