import { describe, expect, test } from "vitest";
import {
  alternarMaestro,
  alternarValor,
  estadoMaestro,
  estaMarcado,
  listaCompleta,
  NADA,
  ponerMarca,
  resolverSeleccion,
  seleccionDesdeUrl,
  TODO,
} from "@/lib/ui/seleccion-faceta";
import { LISTA_MAX } from "@/lib/validation/productos-filtros.schema";

/** Valores de lista inventados: "v1", "v2"… */
const valores = (n: number) => Array.from({ length: n }, (_, i) => `v${i + 1}`);

describe("seleccionDesdeUrl y marcado", () => {
  test("sin nada en la URL está todo marcado", () => {
    const s = seleccionDesdeUrl([], []);
    expect(s).toEqual(TODO);
    expect(estaMarcado(s, "v1")).toBe(true);
  });

  test("con incluir solo están marcados esos", () => {
    const s = seleccionDesdeUrl(["v1"], []);
    expect(estaMarcado(s, "v1")).toBe(true);
    expect(estaMarcado(s, "v2")).toBe(false);
  });

  test("con excluir está marcado todo menos esos", () => {
    const s = seleccionDesdeUrl([], ["v1"]);
    expect(estaMarcado(s, "v1")).toBe(false);
    expect(estaMarcado(s, "v2")).toBe(true);
  });
});

describe("alternarValor y ponerMarca", () => {
  test("desmarcar un valor de 'todo' lo agrega a la lista de excluidos", () => {
    const s = alternarValor(TODO, "v2");
    expect(s.modo).toBe("excluir");
    expect([...s.valores]).toEqual(["v2"]);
    expect(estaMarcado(s, "v2")).toBe(false);
  });

  test("volver a marcarlo lo saca", () => {
    const s = alternarValor(alternarValor(TODO, "v2"), "v2");
    expect(s.valores.size).toBe(0);
  });

  test("en modo incluir marcar agrega y desmarcar saca", () => {
    const s = alternarValor(NADA, "v1");
    expect(s.modo).toBe("incluir");
    expect([...s.valores]).toEqual(["v1"]);
    expect(alternarValor(s, "v1").valores.size).toBe(0);
  });

  test("no muta la selección anterior", () => {
    const antes = seleccionDesdeUrl(["v1"], []);
    alternarValor(antes, "v2");
    expect([...antes.valores]).toEqual(["v1"]);
  });

  test("ponerMarca marca o desmarca varios a la vez en cualquier modo", () => {
    expect(estaMarcado(ponerMarca(NADA, ["v1", "v2"], true), "v2")).toBe(true);
    expect(estaMarcado(ponerMarca(TODO, ["v1", "v2"], false), "v1")).toBe(false);
  });
});

describe("estadoMaestro y alternarMaestro", () => {
  const visibles = valores(3);
  const global = { global: true, completo: true };

  test("todo marcado, nada marcado y mixto", () => {
    expect(estadoMaestro(TODO, visibles, global)).toBe("todos");
    expect(estadoMaestro(NADA, visibles, global)).toBe("ninguno");
    expect(estadoMaestro(alternarValor(TODO, "v1"), visibles, global)).toBe("algunos");
  });

  test("con la lista recortada, marcar todo lo visible en 'incluir' no es 'todos'", () => {
    const s = seleccionDesdeUrl(visibles, []);
    expect(estadoMaestro(s, visibles, { global: true, completo: false })).toBe("algunos");
    expect(estadoMaestro(s, visibles, { global: true, completo: true })).toBe("todos");
  });

  test("con la lista recortada, desmarcar todo lo visible en 'excluir' tampoco es 'ninguno'", () => {
    const s = seleccionDesdeUrl([], visibles);
    expect(estadoMaestro(s, visibles, { global: true, completo: false })).toBe("algunos");
    expect(estadoMaestro(s, visibles, { global: true, completo: true })).toBe("ninguno");
  });

  test("con búsqueda habla solo de los resultados", () => {
    const busqueda = { global: false, completo: false };
    expect(estadoMaestro(TODO, ["v1"], busqueda)).toBe("todos");
    expect(estadoMaestro(alternarValor(TODO, "v1"), ["v1"], busqueda)).toBe("ninguno");
    expect(estadoMaestro(TODO, [], busqueda)).toBe("ninguno");
  });

  test("global: tocar 'todos' deja nada, tocar cualquier otro deja todo", () => {
    expect(alternarMaestro(TODO, "todos", visibles, true)).toEqual(NADA);
    expect(alternarMaestro(NADA, "ninguno", visibles, true)).toEqual(TODO);
    expect(alternarMaestro(alternarValor(TODO, "v1"), "algunos", visibles, true)).toEqual(TODO);
  });

  test("con búsqueda solo toca los resultados y conserva el resto de la selección", () => {
    const antes = alternarValor(TODO, "v9"); // v9 desmarcado fuera de la búsqueda
    const sinResultados = alternarMaestro(antes, "todos", ["v1", "v2"], false);
    expect(estaMarcado(sinResultados, "v1")).toBe(false);
    expect(estaMarcado(sinResultados, "v9")).toBe(false);
    const conResultados = alternarMaestro(sinResultados, "ninguno", ["v1", "v2"], false);
    expect(estaMarcado(conResultados, "v1")).toBe(true);
    expect(estaMarcado(conResultados, "v9")).toBe(false);
  });
});

describe("listaCompleta", () => {
  const faceta = (cantidades: number[], distintos: number) => ({
    valores: cantidades.map((cantidad, i) => ({ valor: `v${i}`, cantidad })),
    distintos,
  });

  test("completa cuando se ven tantos valores con filas como hay distintos", () => {
    expect(listaCompleta(faceta([5, 3], 2), false)).toBe(true);
  });

  test("recortada cuando hay más distintos que valores", () => {
    expect(listaCompleta(faceta([5, 3], 9), false)).toBe(false);
  });

  test("un valor seleccionado con cantidad 0 no cuenta como 'distinto'", () => {
    expect(listaCompleta(faceta([5, 3, 0], 2), false)).toBe(true);
  });

  test("con búsqueda nunca es la columna entera", () => {
    expect(listaCompleta(faceta([5, 3], 2), true)).toBe(false);
  });
});

describe("resolverSeleccion con la lista completa", () => {
  test("todo marcado es sin filtro", () => {
    expect(resolverSeleccion(TODO, valores(4))).toEqual({ tipo: "sin-filtro" });
  });

  test("nada marcado no se puede aplicar", () => {
    expect(resolverSeleccion(NADA, valores(4))).toEqual({ tipo: "ninguno" });
  });

  test("elige la representación más corta: pocos marcados → incluir", () => {
    const s = seleccionDesdeUrl(["v1", "v2"], []);
    expect(resolverSeleccion(s, valores(10))).toEqual({ tipo: "incluir", valores: ["v1", "v2"] });
  });

  test("elige la más corta: pocos desmarcados → excluir", () => {
    const s = seleccionDesdeUrl([], ["v9"]);
    expect(resolverSeleccion(s, valores(10))).toEqual({ tipo: "excluir", valores: ["v9"] });
  });

  test("una selección en modo incluir con casi todo marcado se convierte en excluir", () => {
    const todosMenosUno = valores(10).filter((v) => v !== "v3");
    const s = seleccionDesdeUrl(todosMenosUno, []);
    expect(resolverSeleccion(s, valores(10))).toEqual({ tipo: "excluir", valores: ["v3"] });
  });

  test("en un empate gana incluir", () => {
    const s = seleccionDesdeUrl(["v1", "v2"], []);
    expect(resolverSeleccion(s, valores(4))).toEqual({ tipo: "incluir", valores: ["v1", "v2"] });
  });

  test("ignora valores de la selección que ya no existen en la lista", () => {
    const s = seleccionDesdeUrl([], ["viejo", "v2"]);
    expect(resolverSeleccion(s, valores(5))).toEqual({ tipo: "excluir", valores: ["v2"] });
  });

  test("nunca pasa del tope: con 700 valores y 350 marcados no hay forma de aplicar", () => {
    const universo = valores(700);
    const s = seleccionDesdeUrl(universo.slice(0, 350), []);
    expect(resolverSeleccion(s, universo)).toEqual({ tipo: "demasiados", cantidad: 350 });
  });

  test("con 700 valores y 320 marcados usa excluir, que sí entra en el tope", () => {
    const universo = valores(700);
    const s = seleccionDesdeUrl([], universo.slice(0, LISTA_MAX));
    const r = resolverSeleccion(s, universo);
    expect(r.tipo).toBe("excluir");
    if (r.tipo === "excluir") expect(r.valores).toHaveLength(LISTA_MAX);
  });

  test("con 700 valores y 650 marcados usa excluir (50), no incluir (650)", () => {
    const universo = valores(700);
    const s = seleccionDesdeUrl([], universo.slice(0, 50));
    const r = resolverSeleccion(s, universo);
    expect(r.tipo).toBe("excluir");
    if (r.tipo === "excluir") expect(r.valores).toHaveLength(50);
  });

  test("los valores salen ordenados de forma estable", () => {
    const s = seleccionDesdeUrl(["v3", "v1", "v2"], []);
    const r = resolverSeleccion(s, valores(20));
    expect(r).toEqual({ tipo: "incluir", valores: ["v1", "v2", "v3"] });
  });
});

describe("resolverSeleccion con otros filtros activos: respeta lo que el usuario hizo", () => {
  const otros = { otrosFiltros: true };

  test("el escenario del bug: con una búsqueda activa aparecen A, B y C; marcar A y B guarda 'solo A y B'", () => {
    // Partir de "deseleccionar todo" y marcar A y B es modo incluir.
    const s = alternarValor(alternarValor(NADA, "A"), "B");
    expect(resolverSeleccion(s, ["A", "B", "C"], otros)).toEqual({
      tipo: "incluir",
      valores: ["A", "B"],
    });
    // Sin otros filtros la representación más corta era 'todas menos C', que al borrar
    // la búsqueda cambia lo pedido: acá no se usa.
    expect(resolverSeleccion(s, ["A", "B", "C"])).toEqual({ tipo: "excluir", valores: ["C"] });
  });

  test("desmarcar desde 'todo' sigue siendo excluir, aunque quede una sola casilla marcada", () => {
    const s = alternarValor(alternarValor(TODO, "B"), "C");
    expect(resolverSeleccion(s, ["A", "B", "C"], otros)).toEqual({
      tipo: "excluir",
      valores: ["B", "C"],
    });
  });

  test("todo marcado es sin filtro y nada marcado no se aplica, en cualquier modo", () => {
    expect(resolverSeleccion(TODO, ["A", "B"], otros)).toEqual({ tipo: "sin-filtro" });
    expect(resolverSeleccion(seleccionDesdeUrl(["A", "B"], []), ["A", "B"], otros)).toEqual({
      tipo: "sin-filtro",
    });
    expect(resolverSeleccion(NADA, ["A", "B"], otros)).toEqual({ tipo: "ninguno" });
  });

  test("cambia de representación solo si la pedida no entra en el tope", () => {
    const universo = valores(700);
    // Modo incluir con 350 marcados no entra; excluir (350) tampoco.
    expect(
      resolverSeleccion(seleccionDesdeUrl(universo.slice(0, 350), []), universo, otros),
    ).toEqual({ tipo: "demasiados", cantidad: 350 });
    // Modo incluir con 650 marcados no entra, pero excluir (50) sí: se cambia.
    const casiTodo = seleccionDesdeUrl(universo.slice(50), []);
    const r = resolverSeleccion(casiTodo, universo, otros);
    expect(r.tipo).toBe("excluir");
    if (r.tipo === "excluir") expect(r.valores).toHaveLength(50);
    // Modo excluir con 400 desmarcados no entra, pero incluir (300) sí.
    const pocos = seleccionDesdeUrl([], universo.slice(0, 400));
    const r2 = resolverSeleccion(pocos, universo, otros);
    expect(r2.tipo).toBe("incluir");
    if (r2.tipo === "incluir") expect(r2.valores).toHaveLength(300);
  });

  test("el modo pedido que entra en el tope se mantiene aunque el otro sea más corto", () => {
    const universo = valores(10);
    const s = seleccionDesdeUrl(universo.slice(0, 9), []); // incluir 9 de 10
    expect(resolverSeleccion(s, universo, otros)).toEqual({
      tipo: "incluir",
      valores: universo.slice(0, 9).sort(),
    });
  });
});

describe("resolverSeleccion con la lista recortada (universo desconocido)", () => {
  test("excluir sin nada excluido es sin filtro", () => {
    expect(resolverSeleccion(TODO, null)).toEqual({ tipo: "sin-filtro" });
  });

  test("incluir sin nada marcado no se puede aplicar", () => {
    expect(resolverSeleccion(NADA, null)).toEqual({ tipo: "ninguno" });
  });

  test("respeta el modo: no convierte, porque lo que no se ve solo se describe así", () => {
    expect(resolverSeleccion(seleccionDesdeUrl(["v1"], []), null)).toEqual({
      tipo: "incluir",
      valores: ["v1"],
    });
    expect(resolverSeleccion(seleccionDesdeUrl([], ["v1"]), null)).toEqual({
      tipo: "excluir",
      valores: ["v1"],
    });
  });

  test("más de 300 en cualquiera de los dos modos es demasiado", () => {
    const muchos = valores(LISTA_MAX + 1);
    expect(resolverSeleccion(seleccionDesdeUrl(muchos, []), null)).toEqual({
      tipo: "demasiados",
      cantidad: LISTA_MAX + 1,
    });
    expect(resolverSeleccion(seleccionDesdeUrl([], muchos), null)).toEqual({
      tipo: "demasiados",
      cantidad: LISTA_MAX + 1,
    });
  });

  test("exactamente 300 entra", () => {
    const r = resolverSeleccion(seleccionDesdeUrl(valores(LISTA_MAX), []), null);
    expect(r.tipo).toBe("incluir");
  });
});

describe("presupuesto de caracteres de la URL", () => {
  /** Valores de 60 caracteres: 200 de ellos son menos de LISTA_MAX y aun así no entran en la URL. */
  const largos = (n: number) =>
    Array.from({ length: n }, (_, i) => `descripcion-larga-${i}`.padEnd(60, "x"));

  test("sin presupuesto solo cuenta la cantidad", () => {
    const universo = largos(200);
    const r = resolverSeleccion({ modo: "incluir", valores: new Set(universo) }, null);
    expect(r.tipo).toBe("incluir");
  });

  test("con presupuesto, una lista que entra por cantidad pero no por tamaño es 'demasiados'", () => {
    const universo = largos(200);
    const r = resolverSeleccion({ modo: "incluir", valores: new Set(universo) }, null, {
      presupuestoChars: 6000,
    });
    expect(r.tipo).toBe("demasiados");
  });

  test("con la lista completa elige la representación que sí entra", () => {
    const universo = largos(100);
    // Todo marcado menos 3: excluir son 3 valores, incluir serían 97.
    const s = { modo: "excluir" as const, valores: new Set(universo.slice(0, 3)) };
    const r = resolverSeleccion(s, universo, { presupuestoChars: 1000 });
    expect(r).toEqual({ tipo: "excluir", valores: [...universo.slice(0, 3)].sort() });
  });

  test("cuenta el valor codificado: una tilde o un espacio pesan más que un carácter", () => {
    const s = { modo: "incluir" as const, valores: new Set(["á b", "é c"]) };
    expect(resolverSeleccion(s, null, { presupuestoChars: 30, sobrecargaPorValor: 10 }).tipo).toBe(
      "demasiados",
    );
    expect(resolverSeleccion(s, null, { presupuestoChars: 200, sobrecargaPorValor: 10 }).tipo).toBe(
      "incluir",
    );
  });
});
