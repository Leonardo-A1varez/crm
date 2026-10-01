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
