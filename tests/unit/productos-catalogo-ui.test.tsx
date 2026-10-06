import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Casilla } from "@/components/shared/Casilla";
import { SIN_MARCA } from "@/lib/validation/productos-filtros.schema";
import { instalarNavegacion, ponerUrl, urlActual } from "../helpers/navegacion-falsa";
import type { CargadoresProductos } from "@/components/productos/cliente-productos";
import type { Faceta, LoteProductos, ProductoFila } from "@/types/productos";
import type { ReactElement } from "react";

vi.mock("next/navigation", async () => await import("../helpers/navegacion-falsa"));

const { FiltrosProductosProvider } =
  await import("@/components/productos/filtros/FiltrosProductosProvider");
const { CatalogoProductos } = await import("@/components/productos/CatalogoProductos");
const { FiltrosActivos } = await import("@/components/productos/filtros/FiltrosActivos");
const { BuscadorProductos, ESPERA_BUSCADOR_MS } =
  await import("@/components/productos/filtros/BuscadorProductos");
const { Segmentado } = await import("@/components/productos/filtros/Segmentado");
const { ESPERA_BUSQUEDA_MS } = await import("@/components/productos/filtros/use-lista-filtro");
const { ALTO_FILA } = await import("@/lib/ui/ventana-virtual");

beforeAll(() => {
  instalarNavegacion();
  // jsdom no trae ResizeObserver: la tabla lo usa para medir su alto.
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

/** Filas inventadas para ilustrar la tabla. */
function fila(i: number, parcial: Partial<ProductoFila> = {}): ProductoFila {
  return {
    id: `id-${i}`,
    codigo_interno: String(i + 1),
    codigo_fabrica: `F-${i}`,
    otros_codigos: [],
    sku_proveedor: null,
    nombre: `Producto ${i}`,
    descripcion: "Alfa",
    categoria: "Frenos",
    precio: 1234.5,
    precio_matriz: null,
    precio_magdalena: null,
    precio_koreanos: null,
    precio_sas_repuestos: null,
    codigo_difiere: false,
    erp_actualizado_at: null,
    stock: 12,
    activo: true,
    ...parcial,
  };
}
const filas = (n: number) => Array.from({ length: n }, (_, i) => fila(i));

const FACETA: Faceta = {
  valores: [
    { valor: "Alfa", cantidad: 12 },
    { valor: "Beta", cantidad: 8 },
    { valor: SIN_MARCA, cantidad: 3 },
  ],
  distintos: 3,
};

interface Opciones {
  filas?: ProductoFila[];
  lote?: CargadoresProductos["lote"];
  faceta?: CargadoresProductos["faceta"];
  search?: string;
  isAdmin?: boolean;
  empresaErp?: number | null;
}

function montar(extra: ReactElement | null = null, o: Opciones = {}) {
  ponerUrl(o.search ?? "");
  const todas = o.filas ?? filas(5);
  const cargadores = {
    lote: vi.fn<CargadoresProductos["lote"]>(
      o.lote ??
        (async (_c, n): Promise<LoteProductos> => ({
          filas: todas.slice((n - 1) * 1000, n * 1000),
          total: todas.length,
          lote: n,
          desde: (n - 1) * 1000,
        })),
    ),
    faceta: vi.fn<CargadoresProductos["faceta"]>(o.faceta ?? (async () => FACETA)),
  };
  const onUpdate = vi.fn(async () => ({ ok: true as const }));
  const onToggleActivo = vi.fn(async () => ({ ok: true as const }));
  render(
    <FiltrosProductosProvider cargadores={cargadores}>
      <FiltrosActivos />
      {extra}
      <CatalogoProductos
        isAdmin={o.isAdmin ?? true}
        empresaErp={o.empresaErp ?? null}
        onUpdate={onUpdate}
        onToggleActivo={onToggleActivo}
      />
    </FiltrosProductosProvider>,
  );
  return { cargadores, onUpdate, onToggleActivo };
}

const region = () => screen.getByRole("region", { name: "Catálogo de productos" });
const filasDelDom = () => document.querySelectorAll("tr[data-fila=producto]");
const encabezado = (nombre: RegExp | string) =>
  screen.getByRole("button", {
    name: nombre instanceof RegExp ? nombre : new RegExp(`^${nombre}`),
  });

beforeEach(() => ponerUrl(""));
afterEach(cleanup);

describe("Segmentado", () => {
  it("es un grupo de radios con leyenda y cambia de opción", () => {
    const alCambiar = vi.fn();
    render(
      <Segmentado
        leyenda="Estado del producto"
        opciones={[
          { valor: "a", texto: "Uno" },
          { valor: "b", texto: "Dos" },
        ]}
        valor="a"
        onCambiar={alCambiar}
      />,
    );
    const grupo = screen.getByRole("group", { name: "Estado del producto" });
    expect(within(grupo).getAllByRole("radio")).toHaveLength(2);
    fireEvent.click(screen.getByLabelText("Dos"));
    expect(alCambiar).toHaveBeenCalledWith("b");
  });
});

describe("Casilla", () => {
  it("indeterminate pone la propiedad DOM y se saca cuando deja de serlo", () => {
    const { rerender } = render(<Casilla indeterminate onChange={() => {}} aria-label="x" />);
    const input = screen.getByLabelText("x") as HTMLInputElement;
    expect(input.indeterminate).toBe(true);
    rerender(<Casilla indeterminate={false} onChange={() => {}} aria-label="x" />);
    expect(input.indeterminate).toBe(false);
  });
});

describe("CatalogoProductos: la tabla", () => {
  it("muestra el esqueleto y 'Cargando el catálogo…' hasta que llega el primer lote", async () => {
    let soltar: (l: LoteProductos) => void = () => {};
    montar(null, { lote: () => new Promise((r) => (soltar = r)) });
    expect(document.querySelectorAll("tr[data-esqueleto]").length).toBeGreaterThan(0);
    expect(screen.getByText("Cargando el catálogo…")).toBeTruthy();
    expect(region().getAttribute("aria-busy")).toBe("true");
    soltar({ filas: filas(2), total: 2, lote: 1, desde: 0 });
    await waitFor(() => expect(filasDelDom()).toHaveLength(2));
    expect(region().getAttribute("aria-busy")).toBe("false");
  });

  it("las trece columnas, en orden, con su encabezado", async () => {
    montar();
    await waitFor(() => expect(filasDelDom()).toHaveLength(5));
    const th = [...document.querySelectorAll("thead th")].map(
      (t) => t.querySelector("span")?.textContent ?? t.textContent,
    );
    expect(th).toEqual([
      "Código",
      "Cód. fábrica",
      "Otros códigos",
      "Categoría",
      "Descripción",
      "Marca",
      "Precio",
      "Matriz",
      "Magdalena",
      "Koreanos",
      "SAS",
      "Stock",
      "Estado",
      "Acciones",
    ]);
  });

  it("las columnas de precio por empresa no abren panel: no se ordenan ni se filtran", async () => {
    montar();
    await waitFor(() => expect(filasDelDom()).toHaveLength(5));
    for (const nombre of ["Matriz", "Magdalena", "Koreanos", "SAS"]) {
      const th = [...document.querySelectorAll("thead th")].find((t) => t.textContent === nombre);
      expect(th).toBeTruthy();
      expect(th?.querySelector("button")).toBeNull();
    }
    expect(screen.queryByRole("button", { name: /^Matriz/ })).toBeNull();
  });

  it("formatea cada celda: precio con 2 decimales y coma, '—' en lo vacío, chip de estado", async () => {
    montar(null, {
      filas: [
        fila(0, { otros_codigos: ["ALT-1", "ZZ.9"], descripcion: null, codigo_fabrica: null }),
        fila(1, { activo: false, precio: 5, stock: 1500, categoria: null }),
      ],
    });
    await waitFor(() => expect(filasDelDom()).toHaveLength(2));
    const [a, b] = [...filasDelDom()] as HTMLTableRowElement[];
    const celdas = (tr: HTMLTableRowElement) => [...tr.cells].map((c) => c.textContent);
    // Sin precios por empresa, esas cuatro celdas quedan en "—".
    expect(celdas(a!).slice(0, 13)).toEqual([
      "1",
      "—",
      "ALT-1, ZZ.9",
      "Frenos",
      "Producto 0",
      "—",
      "1.234,50",
      "—",
      "—",
      "—",
      "—",
      "12",
      "Activo",
    ]);
    expect(celdas(b!).slice(0, 13)).toEqual([
      "2",
      "F-1",
      "—",
      "—",
      "Producto 1",
      "Alfa",
      "5,00",
      "—",
      "—",
      "—",
      "—",
      "1.500",
      "Inactivo",
    ]);
    // Una línea por fila y el texto completo en el title.
    expect(a!.cells[2]?.getAttribute("title")).toBe("ALT-1, ZZ.9");
    expect(a!.style.height).toBe(`${ALTO_FILA}px`);
    expect(a!.cells[0]?.className).toContain("font-mono");
    expect(a!.cells[6]?.className).toContain("text-right");
  });

  it("muestra el precio de cada empresa con coma decimal y deja en blanco la que no lo vende", async () => {
    montar(null, {
      filas: [
        fila(0, {
          precio: 8.5,
          precio_matriz: 10,
          precio_magdalena: 8.5,
          precio_koreanos: 0,
          precio_sas_repuestos: null,
        }),
      ],
    });
    await waitFor(() => expect(filasDelDom()).toHaveLength(1));
    const tr = filasDelDom()[0] as HTMLTableRowElement;
    expect([...tr.cells].slice(6, 11).map((c) => c.textContent)).toEqual([
      "8,50",
      "10,00",
      "8,50",
      "—",
      "—",
    ]);
  });

  it("un producto sin precio dice 'A consultar' y no 'NaN' ni '0,00'", async () => {
    montar(null, { filas: [fila(0, { precio: null })] });
    await waitFor(() => expect(filasDelDom()).toHaveLength(1));
    const tr = filasDelDom()[0] as HTMLTableRowElement;
    expect(tr.cells[6]?.textContent).toBe("A consultar");
    expect(tr.cells[6]?.getAttribute("title")).toBe("A consultar");
  });

  it("resalta la columna de la empresa del usuario, en el encabezado y en las filas", async () => {
    montar(null, {
      empresaErp: 3,
      filas: [fila(0, { precio_matriz: 10, precio_magdalena: 8.5 })],
    });
    await waitFor(() => expect(filasDelDom()).toHaveLength(1));
    const ths = [...document.querySelectorAll("thead th")];
    const th = (n: string) => ths.find((t) => t.textContent === n) as HTMLElement;
    expect(th("Magdalena").className).toContain("text-brand");
    expect(th("Matriz").className).not.toContain("text-brand");
    const tr = filasDelDom()[0] as HTMLTableRowElement;
    // Columnas 7 a 10: Matriz, Magdalena, Koreanos, SAS.
    expect(tr.cells[8]?.className).toContain("bg-brand");
    expect(tr.cells[7]?.className).not.toContain("bg-brand");
    expect(tr.cells[9]?.className).not.toContain("bg-brand");
    expect(tr.cells[10]?.className).not.toContain("bg-brand");
  });

  it("sin empresa asignada no resalta ninguna columna", async () => {
    montar(null, { empresaErp: null, filas: [fila(0, { precio_matriz: 10 })] });
    await waitFor(() => expect(filasDelDom()).toHaveLength(1));
    expect(document.querySelectorAll("thead th.text-brand")).toHaveLength(0);
    expect(document.querySelectorAll("tr[data-fila=producto] td[class*='bg-brand']")).toHaveLength(
      0,
    );
  });

  it("marca con 'Código difiere' el producto cuyo código del ERP no coincide", async () => {
    montar(null, { filas: [fila(0, { codigo_difiere: true }), fila(1)] });
    await waitFor(() => expect(filasDelDom()).toHaveLength(2));
    const [a, b] = [...filasDelDom()] as HTMLTableRowElement[];
    expect(a!.cells[0]?.textContent).toContain("Difiere");
    expect(a!.cells[0]?.textContent).toContain("el código del ERP no coincide");
    expect(b!.cells[0]?.textContent).not.toContain("Difiere");
  });

  it("sin rol admin no hay columna de acciones", async () => {
    montar(null, { isAdmin: false });
    await waitFor(() => expect(filasDelDom()).toHaveLength(5));
    expect(screen.queryByText("Acciones")).toBeNull();
    expect(screen.queryByRole("button", { name: "Editar" })).toBeNull();
  });

  it("con admin cada fila trae Editar y Desactivar", async () => {
    montar();
    await waitFor(() => expect(filasDelDom()).toHaveLength(5));
    expect(screen.getAllByRole("button", { name: "Editar" })).toHaveLength(5);
    expect(screen.getAllByRole("button", { name: "Desactivar" })).toHaveLength(5);
  });

  it("virtualiza: con 1.000 filas dibuja solo las cercanas, con espaciador y aria-rowcount", async () => {
    montar(null, { filas: filas(1000) });
    await waitFor(() => expect(filasDelDom().length).toBeGreaterThan(0));
    const n = filasDelDom().length;
    expect(n).toBeLessThan(60);
    expect(document.querySelector("table")?.getAttribute("aria-rowcount")).toBe("1001");
    const espaciador = document.querySelector("tbody tr[aria-hidden=true] td") as HTMLElement;
    expect(espaciador.style.height).toBe(`${(1000 - n) * ALTO_FILA}px`);
    // El primer dato es la fila 2 (la 1 es el encabezado).
    expect(filasDelDom()[0]?.getAttribute("aria-rowindex")).toBe("2");
  });

  it("al desplazarse dibuja las filas que corresponden y mantiene el alto total", async () => {
    montar(null, { filas: filas(1000) });
    await waitFor(() => expect(filasDelDom().length).toBeGreaterThan(0));
    const r = region();
    Object.defineProperty(r, "clientHeight", { value: 380, configurable: true });
    r.scrollTop = ALTO_FILA * 500;
    fireEvent.scroll(r);
    await waitFor(() => expect(screen.getByText("Producto 500")).toBeTruthy());
    expect(screen.queryByText("Producto 3")).toBeNull();
    const indice = Number(filasDelDom()[0]?.getAttribute("aria-rowindex"));
    expect(indice).toBeGreaterThan(490);
    const antes = (document.querySelectorAll("tbody tr[aria-hidden=true] td")[0] as HTMLElement)
      .style.height;
    expect(parseInt(antes, 10)).toBeGreaterThan(0);
    const despues = filasDelDom().length;
    const alto = [...document.querySelectorAll("tbody tr[aria-hidden=true] td")]
      .map((td) => parseInt((td as HTMLElement).style.height, 10))
      .reduce((a, b) => a + b, 0);
    expect(alto + despues * ALTO_FILA).toBe(1000 * ALTO_FILA);
  });

  it("el pie cuenta los productos y dice 'carga completa'; con filtros lo aclara", async () => {
    montar(null, { filas: filas(1) });
    await waitFor(() => expect(screen.getByText(/1 producto · carga completa/)).toBeTruthy());
    cleanup();
    montar(null, { filas: filas(3), search: "marcas=Alfa" });
    await waitFor(() =>
      expect(
        screen.getByText(/3 productos con los filtros aplicados · carga completa/),
      ).toBeTruthy(),
    );
  });

  it("el pie dice cuánto lleva cargado mientras llegan los demás lotes", async () => {
    let soltar: (l: LoteProductos) => void = () => {};
    montar(null, {
      filas: filas(2300),
      lote: async (_c, n) => {
        if (n === 1) return { filas: filas(2300).slice(0, 1000), total: 2300, lote: 1, desde: 0 };
        return new Promise<LoteProductos>((r) => (soltar = r));
      },
    });
    await waitFor(() => expect(screen.getByText(/1\.000 de 2\.300 cargados…/)).toBeTruthy());
    expect(region().getAttribute("aria-busy")).toBe("true");
    soltar({ filas: [], total: 2300, lote: 2, desde: 1000 });
  });

  it("sin productos y sin filtros es el estado vacío con la salida a Importar", async () => {
    montar(null, { filas: [] });
    await waitFor(() => expect(screen.getByText("Sin productos")).toBeTruthy());
    expect(document.querySelector("table")).toBeNull();
  });

  it("con filtros y sin resultados lo dice y 'Limpiar todos los filtros' saca los filtros pero no el orden", async () => {
    montar(null, { filas: [], search: "marcas=Nada&orden=precio&dir=desc" });
    await waitFor(() =>
      expect(screen.getByText("Ningún producto coincide con los filtros")).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Limpiar todos los filtros" }));
    expect(urlActual()).toBe("orden=precio&dir=desc");
  });

  it("un 400 del servidor se explica en la tabla, con el encabezado a la vista", async () => {
    const { ErrorLectura } = await import("@/components/productos/cliente-productos");
    montar(null, {
      lote: async () => {
        throw new ErrorLectura("Filtros no válidos.", 400, [
          "Precio: ingresá un número válido, desde 0.",
        ]);
      },
      search: "precioMin=abc",
    });
    await waitFor(() =>
      expect(screen.getByText("No se pudieron aplicar los filtros")).toBeTruthy(),
    );
    expect(screen.getByText("Precio: ingresá un número válido, desde 0.")).toBeTruthy();
    expect(encabezado("Precio")).toBeTruthy();
  });

  it("si falla un lote con filas ya dibujadas, aria-rowcount sigue definido", async () => {
    montar(null, {
      lote: async (_c, n) => {
        if (n === 1) return { filas: filas(1000), total: 2300, lote: 1, desde: 0 };
        throw new Error("corte");
      },
    });
    await screen.findByRole("alert");
    expect(document.querySelector("table")?.getAttribute("aria-rowcount")).toBe("2301");
  });

  it("una falla se avisa en el pie y 'Reintentar' vuelve a pedir", async () => {
    const { ErrorLectura } = await import("@/components/productos/cliente-productos");
    let romper = true;
    const { cargadores } = montar(null, {
      lote: async (_c, n) => {
        if (romper) throw new ErrorLectura("No se pudo leer el catálogo.", 500);
        return { filas: filas(2), total: 2, lote: n, desde: 0 };
      },
    });
    const alerta = await screen.findByRole("alert");
    expect(alerta.textContent).toContain("No se pudo leer el catálogo.");
    romper = false;
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(filasDelDom()).toHaveLength(2));
    expect(cargadores.lote.mock.calls.length).toBeGreaterThan(1);
  });

  it("la consulta que viaja es la URL en forma canónica: filtros y orden, sin ruido", async () => {
    const { cargadores } = montar(null, {
      search: "marcas=B&marcas=A&zzz=1&pagina=3&orden=precio&dir=desc",
    });
    await waitFor(() => expect(cargadores.lote).toHaveBeenCalled());
    expect(cargadores.lote.mock.calls[0]?.[0]).toBe("marcas=A&marcas=B&orden=precio&dir=desc");
    expect(cargadores.lote.mock.calls[0]?.[1]).toBe(1);
  });

  it("cambiar un filtro pide de nuevo el catálogo con la consulta nueva", async () => {
    const { cargadores } = montar(<BuscadorProductos />);
    await waitFor(() => expect(filasDelDom()).toHaveLength(5));
    fireEvent.change(screen.getByLabelText("Buscar productos"), { target: { value: "bomba" } });
    await waitFor(() => expect(cargadores.lote.mock.calls.at(-1)?.[0]).toBe("q=bomba"), {
      timeout: ESPERA_BUSCADOR_MS + 1500,
    });
  });
});

describe("encabezados: indicadores de filtro y de orden", () => {
  it("cada columna tiene su botón; el filtro puesto se dice en el nombre accesible", async () => {
    montar(null, { search: "marcas=Alfa&estado=activo" });
    await waitFor(() => expect(filasDelDom()).toHaveLength(5));
    expect(encabezado("Marca").getAttribute("aria-label")).toContain("filtro activo");
    expect(encabezado("Estado").getAttribute("aria-label")).toContain("filtro activo");
    expect(encabezado("Precio").getAttribute("aria-label")).not.toContain("filtro activo");
  });

  it("sin orden elegido ninguna columna figura ordenada: ni flecha ni aria-sort", async () => {
    montar();
    await waitFor(() => expect(filasDelDom()).toHaveLength(5));
    expect(document.querySelectorAll("thead th[aria-sort]")).toHaveLength(0);
    expect(document.querySelector("thead")?.textContent).not.toMatch(/[↑↓]/);
  });

  it("con un nivel, flecha sin número; con dos o más, el número de nivel; aria-sort solo en la del primer nivel", async () => {
    montar(null, { search: "orden=precio&dir=desc" });
    await waitFor(() => expect(filasDelDom()).toHaveLength(5));
    expect(encabezado("Precio").textContent).toContain("↓");
    expect(encabezado("Precio").textContent).not.toMatch(/\d/);
    cleanup();
    montar(null, { search: "orden=marca&dir=asc&orden=precio&dir=desc&orden=stock&dir=asc" });
    await waitFor(() => expect(filasDelDom()).toHaveLength(5));
    expect(encabezado("Marca").textContent).toContain("1");
    expect(encabezado("Precio").textContent).toContain("2");
    expect(encabezado("Stock").textContent).toContain("3");
    const sorts = [...document.querySelectorAll("thead th")].map((t) =>
      t.getAttribute("aria-sort"),
    );
    expect(sorts.filter(Boolean)).toEqual(["ascending"]);
  });
});

describe("panel de orden: clics acumulativos", () => {
  async function abrir(nombre: string) {
    fireEvent.click(encabezado(nombre));
    return screen.findByRole("dialog");
  }

  it("ordenar una columna escribe orden/dir, cierra el panel y el botón queda marcado", async () => {
    montar();
    await waitFor(() => expect(filasDelDom()).toHaveLength(5));
    const panel = await abrir("Marca");
    expect(
      within(panel)
        .getByRole("button", { name: /Ordenar A → Z/ })
        .getAttribute("aria-pressed"),
    ).toBe("false");
    fireEvent.click(within(panel).getByRole("button", { name: /Ordenar A → Z/ }));
    expect(urlActual()).toBe("orden=marca&dir=asc");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const otra = await abrir("Marca");
    expect(
      within(otra)
        .getByRole("button", { name: /Ordenar A → Z/ })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("el sentido opuesto invierte; el mismo la saca; una columna nueva se agrega como siguiente nivel", async () => {
    montar(null, { search: "orden=marca&dir=asc" });
    await waitFor(() => expect(filasDelDom()).toHaveLength(5));

    let panel = await abrir("Marca");
    fireEvent.click(within(panel).getByRole("button", { name: /Ordenar Z → A/ }));
    expect(urlActual()).toBe("orden=marca&dir=desc");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    panel = await abrir("Precio");
    fireEvent.click(within(panel).getByRole("button", { name: /Ordenar Menor a mayor/ }));
    expect(urlActual()).toBe("orden=marca&dir=desc&orden=precio&dir=asc");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    panel = await abrir("Marca");
    fireEvent.click(within(panel).getByRole("button", { name: /Ordenar Z → A/ }));
    expect(urlActual()).toBe("orden=precio&dir=asc");
  });

  it("una cuarta columna distinta reinicia el orden y queda como nivel 1", async () => {
    montar(null, {
      search: "orden=codigo&dir=asc&orden=marca&dir=asc&orden=precio&dir=asc",
    });
    await waitFor(() => expect(filasDelDom()).toHaveLength(5));
    const panel = await abrir("Stock");
    fireEvent.click(within(panel).getByRole("button", { name: /Ordenar Mayor a menor/ }));
    expect(urlActual()).toBe("orden=stock&dir=desc");
  });

  it("'Quitar orden de esta columna' solo si la columna ordena; 'Quitar todo el orden' solo con 2 o más niveles", async () => {
    montar(null, { search: "orden=marca&dir=asc" });
    await waitFor(() => expect(filasDelDom()).toHaveLength(5));
    let panel = await abrir("Marca");
    expect(
      within(panel).getByRole("button", { name: "Quitar orden de esta columna" }),
    ).toBeTruthy();
    expect(within(panel).queryByRole("button", { name: "Quitar todo el orden" })).toBeNull();
    fireEvent.keyDown(panel, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    panel = await abrir("Stock");
    expect(
      within(panel).queryByRole("button", { name: "Quitar orden de esta columna" }),
    ).toBeNull();
  });

  it("'Quitar todo el orden' y 'Quitar orden de esta columna' escriben la URL que corresponde", async () => {
    montar(null, { search: "q=x&orden=marca&dir=asc&orden=precio&dir=desc" });
    await waitFor(() => expect(filasDelDom()).toHaveLength(5));
    let panel = await abrir("Precio");
    fireEvent.click(within(panel).getByRole("button", { name: "Quitar orden de esta columna" }));
    expect(urlActual()).toBe("q=x&orden=marca&dir=asc");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    cleanup();
    montar(null, { search: "q=x&orden=marca&dir=asc&orden=precio&dir=desc" });
    await waitFor(() => expect(filasDelDom()).toHaveLength(5));
    panel = await abrir("Marca");
    fireEvent.click(within(panel).getByRole("button", { name: "Quitar todo el orden" }));
    expect(urlActual()).toBe("q=x");
  });

  it("con el orden por defecto ningún botón figura marcado", async () => {
    montar();
    await waitFor(() => expect(filasDelDom()).toHaveLength(5));
    const panel = await abrir("Descripción");
    for (const b of within(panel).getAllByRole("button", { name: /Ordenar/ })) {
      expect(b.getAttribute("aria-pressed")).toBe("false");
    }
  });
});

describe("panel de lista de valores: se aplica al instante", () => {
  async function abrirMarca(o: Opciones = {}) {
    const m = montar(null, o);
    await waitFor(() => expect(filasDelDom().length).toBeGreaterThan(0));
    fireEvent.click(encabezado("Marca"));
    await screen.findByLabelText(/^Alfa/);
    return m;
  }

  it("pide la lista de esa columna con los filtros de la URL, sin el orden", async () => {
    const { cargadores } = await abrirMarca({ search: "estado=activo&orden=precio&dir=desc" });
    expect(cargadores.faceta).toHaveBeenCalledWith(
      "estado=activo",
      "marca",
      "",
      expect.any(AbortSignal),
    );
  });

  it("parte con todo marcado y 'Seleccionar todo' tildado, con las cantidades", async () => {
    await abrirMarca();
    expect((screen.getByLabelText("Seleccionar todo") as HTMLInputElement).checked).toBe(true);
    for (const v of ["Alfa", "Beta", SIN_MARCA]) {
      expect(
        (screen.getByLabelText(new RegExp(`^${v.replace(/[()]/g, "\\$&")}`)) as HTMLInputElement)
          .checked,
      ).toBe(true);
    }
    expect(within(screen.getByRole("dialog")).getByText("12")).toBeTruthy();
  });

  it("desmarcar un valor escribe 'todas menos' en la URL y se ve el chip, sin botón Aplicar", async () => {
    await abrirMarca();
    expect(screen.queryByRole("button", { name: "Aplicar" })).toBeNull();
    fireEvent.click(screen.getByLabelText(/^Alfa/));
    expect(urlActual()).toBe("sinMarcas=Alfa");
    expect((await screen.findAllByText("Marca: todas menos Alfa")).length).toBeGreaterThan(0);
    // El panel sigue abierto: se puede seguir eligiendo.
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect((screen.getByLabelText("Seleccionar todo") as HTMLInputElement).indeterminate).toBe(
      true,
    );
  });

  it("aplicar no vuelve a pedir la lista de esa misma columna", async () => {
    const { cargadores } = await abrirMarca();
    const antes = cargadores.faceta.mock.calls.length;
    fireEvent.click(screen.getByLabelText(/^Alfa/));
    fireEvent.click(screen.getByLabelText(/^Beta/));
    await new Promise((r) => setTimeout(r, ESPERA_BUSQUEDA_MS + 100));
    expect(cargadores.faceta.mock.calls.length).toBe(antes);
    // Con todo el universo a la vista elige la representación más corta: solo (sin marca).
    expect(urlActual()).toBe("marcas=(sin marca)");
  });

  it("'Seleccionar todo' lo desmarca todo: no se puede escribir en la URL, avisa y no cambia nada", async () => {
    await abrirMarca({ search: "sinMarcas=Beta" });
    // Estado mixto → todo marcado: sale el filtro de la URL.
    fireEvent.click(screen.getByLabelText("Seleccionar todo"));
    expect(urlActual()).toBe("");
    // Todo marcado → nada marcado: ninguna fila podría coincidir, no se aplica.
    fireEvent.click(screen.getByLabelText("Seleccionar todo"));
    expect(screen.getByText(/Marcá al menos un valor de marcas/)).toBeTruthy();
    expect(urlActual()).toBe("");
  });

  it("marcar uno solo tras 'nada' es 'solo ese'", async () => {
    await abrirMarca();
    fireEvent.click(screen.getByLabelText("Seleccionar todo"));
    fireEvent.click(screen.getByLabelText(/^Beta/));
    expect(urlActual()).toBe("marcas=Beta");
  });

  it("'Quitar filtro' saca el filtro de la columna y deja los otros", async () => {
    await abrirMarca({ search: "sinMarcas=Alfa&estado=activo" });
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: /Quitar filtro/ }),
    );
    expect(urlActual()).toBe("estado=activo");
  });

  it("buscar espera 250 ms, manda la búsqueda al servidor y cambia el rótulo del maestro", async () => {
    const faceta = vi.fn(
      async (_c: string, _col: string, q: string): Promise<Faceta> =>
        q === "" ? FACETA : { valores: [{ valor: "Beta", cantidad: 8 }], distintos: 1 },
    );
    const { cargadores } = await abrirMarca({ faceta });
    fireEvent.change(screen.getByLabelText("Buscar en Marca"), { target: { value: "be" } });
    expect(cargadores.faceta.mock.calls.at(-1)?.[2]).toBe("");
    await waitFor(() => expect(cargadores.faceta.mock.calls.at(-1)?.[2]).toBe("be"), {
      timeout: ESPERA_BUSQUEDA_MS + 1000,
    });
    await screen.findByText("Seleccionar resultados");
    expect(screen.queryByLabelText(/^Alfa/)).toBeNull();
  });

  it("mientras la búsqueda viaja, 'Seleccionar todo' no actúa sobre la columna entera", async () => {
    let soltar: (f: Faceta) => void = () => {};
    const faceta = vi
      .fn<CargadoresProductos["faceta"]>()
      .mockResolvedValueOnce(FACETA)
      .mockImplementation(() => new Promise((r) => (soltar = r)));
    const { cargadores } = await abrirMarca({ faceta });
    fireEvent.change(screen.getByLabelText("Buscar en Marca"), { target: { value: "be" } });
    const maestro = screen.getByLabelText("Seleccionar resultados") as HTMLInputElement;
    expect(maestro.disabled).toBe(true);
    fireEvent.click(maestro);
    expect(urlActual()).toBe("");
    await waitFor(() => expect(cargadores.faceta).toHaveBeenCalledTimes(2));
    soltar({ valores: [{ valor: "Beta", cantidad: 8 }], distintos: 1 });
    await waitFor(() =>
      expect((screen.getByLabelText("Seleccionar resultados") as HTMLInputElement).disabled).toBe(
        false,
      ),
    );
  });

  it("un error de la lista se muestra con 'Reintentar'", async () => {
    const faceta = vi
      .fn<CargadoresProductos["faceta"]>()
      .mockRejectedValueOnce(new Error("x"))
      .mockResolvedValue(FACETA);
    montar(null, { faceta });
    await waitFor(() => expect(filasDelDom().length).toBeGreaterThan(0));
    fireEvent.click(encabezado("Marca"));
    const alerta = await screen.findByRole("alert");
    expect(alerta.textContent).toContain("No se pudo cargar la lista");
    fireEvent.click(within(alerta).getByRole("button", { name: "Reintentar" }));
    await screen.findByLabelText(/^Alfa/);
  });

  it("la lista del código busca por igualdad y lo dice en el campo", async () => {
    montar();
    await waitFor(() => expect(filasDelDom().length).toBeGreaterThan(0));
    fireEvent.click(encabezado("Código"));
    const campo = await screen.findByLabelText("Buscar en Código");
    expect(campo.getAttribute("placeholder")).toBe("Código exacto…");
  });

  it("una lista recortada lo avisa: 'Mostrando X de Y'", async () => {
    await abrirMarca({
      faceta: async () => ({ valores: [{ valor: "Alfa", cantidad: 3 }], distintos: 900 }),
    });
    expect(screen.getByText(/Mostrando 1 de 900 marcas/)).toBeTruthy();
  });

  it("Escape cierra el panel y devuelve el foco al encabezado", async () => {
    await abrirMarca();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

describe("panel de precio, stock y estado", () => {
  async function abrir(nombre: string, o: Opciones = {}) {
    montar(null, o);
    await waitFor(() => expect(filasDelDom().length).toBeGreaterThan(0));
    fireEvent.click(encabezado(nombre));
    return screen.findByRole("dialog");
  }

  it("Precio: Enter aplica el rango; acepta coma decimal y punto de miles y escribe el número del backend", async () => {
    await abrir("Precio");
    fireEvent.change(screen.getByLabelText("Mínimo"), { target: { value: "1.500,50" } });
    fireEvent.keyDown(screen.getByLabelText("Mínimo"), { key: "Enter" });
    expect(urlActual()).toBe("precioMin=1500.5");
    fireEvent.change(screen.getByLabelText("Máximo"), { target: { value: "2000" } });
    fireEvent.blur(screen.getByLabelText("Máximo"));
    expect(urlActual()).toBe("precioMin=1500.5&precioMax=2000");
  });

  it("Precio: un texto que no es número se marca en el campo y no cambia la URL", async () => {
    await abrir("Precio");
    fireEvent.change(screen.getByLabelText("Mínimo"), { target: { value: "mil" } });
    expect(screen.getByRole("alert").textContent).toMatch(/número/);
    fireEvent.keyDown(screen.getByLabelText("Mínimo"), { key: "Enter" });
    fireEvent.blur(screen.getByLabelText("Mínimo"));
    expect(urlActual()).toBe("");
  });

  it("Precio: un mínimo mayor que el máximo se frena en el campo", async () => {
    await abrir("Precio");
    fireEvent.change(screen.getByLabelText("Mínimo"), { target: { value: "9" } });
    fireEvent.change(screen.getByLabelText("Máximo"), { target: { value: "1" } });
    expect(screen.getByRole("alert").textContent).toMatch(/mínimo.*mayor/i);
    fireEvent.keyDown(screen.getByLabelText("Máximo"), { key: "Enter" });
    expect(urlActual()).toBe("");
  });

  it("Precio: un precio de la URL con decimales se muestra con coma y 'Quitar filtro' lo saca", async () => {
    await abrir("Precio", { search: "precioMin=1500.5&estado=activo" });
    expect((screen.getByLabelText("Mínimo") as HTMLInputElement).value).toBe("1500,5");
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: /Quitar filtro/ }),
    );
    expect(urlActual()).toBe("estado=activo");
  });

  it("Stock: Con stock se aplica al instante; el rango no admite decimales y acepta punto de miles", async () => {
    await abrir("Stock");
    fireEvent.click(screen.getByLabelText("Con stock"));
    expect(urlActual()).toBe("conStock=1");
    fireEvent.change(screen.getByLabelText("Mínimo"), { target: { value: "1.500" } });
    fireEvent.keyDown(screen.getByLabelText("Mínimo"), { key: "Enter" });
    expect(urlActual()).toBe("stockMin=1500&conStock=1");
    fireEvent.change(screen.getByLabelText("Máximo"), { target: { value: "2,5" } });
    expect(screen.getByRole("alert").textContent).toMatch(/entero/);
  });

  it("Stock: 'Sin stock' apaga el rango y escribe conStock=0", async () => {
    await abrir("Stock", { search: "stockMin=3" });
    fireEvent.click(screen.getByLabelText("Sin stock"));
    expect(urlActual()).toBe("conStock=0");
    expect((screen.getByLabelText("Mínimo") as HTMLInputElement).disabled).toBe(true);
  });

  it("Estado: elegir Inactivo lo aplica al instante y cierra; Todos lo saca", async () => {
    await abrir("Estado");
    fireEvent.click(screen.getByLabelText("Inactivo"));
    expect(urlActual()).toBe("estado=inactivo");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(encabezado("Estado"));
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByLabelText("Todos"));
    expect(urlActual()).toBe("");
  });
});

describe("chips y buscador general", () => {
  it("un chip por filtro, cada uno se saca solo, y 'Limpiar todo' saca todos menos el orden", async () => {
    montar(null, { search: "marcas=Alfa&estado=activo&q=bomba&orden=precio&dir=asc" });
    await waitFor(() => expect(filasDelDom().length).toBeGreaterThan(0));
    const zona = screen.getByRole("region", { name: "Filtros aplicados" });
    expect(
      within(zona)
        .getAllByRole("listitem")
        .map((l) => l.textContent),
    ).toEqual(["Búsqueda: “bomba”", "Marca: Alfa", "Estado: Activo"]);
    fireEvent.click(within(zona).getByRole("button", { name: "Quitar filtro: Marca: Alfa" }));
    expect(urlActual()).toBe("estado=activo&q=bomba&orden=precio&dir=asc");
    fireEvent.click(screen.getByRole("button", { name: "Limpiar todo" }));
    expect(urlActual()).toBe("orden=precio&dir=asc");
  });

  it("el buscador espera a que termines de escribir y escribe q en la URL; Enter no espera", async () => {
    montar(<BuscadorProductos />);
    await waitFor(() => expect(filasDelDom().length).toBeGreaterThan(0));
    const campo = screen.getByLabelText("Buscar productos");
    fireEvent.change(campo, { target: { value: "bomba" } });
    expect(urlActual()).toBe("");
    await waitFor(() => expect(urlActual()).toBe("q=bomba"), {
      timeout: ESPERA_BUSCADOR_MS + 1000,
    });
    fireEvent.change(campo, { target: { value: "radiador" } });
    fireEvent.submit(campo.closest("form") as HTMLFormElement);
    expect(urlActual()).toBe("q=radiador");
  });

  it("si la URL cambia desde afuera (un chip) el campo la sigue", async () => {
    montar(<BuscadorProductos />, { search: "q=bomba" });
    await waitFor(() => expect(filasDelDom().length).toBeGreaterThan(0));
    expect((screen.getByLabelText("Buscar productos") as HTMLInputElement).value).toBe("bomba");
    act(() => {
      window.history.replaceState(null, "", "/productos");
    });
    await waitFor(() =>
      expect((screen.getByLabelText("Buscar productos") as HTMLInputElement).value).toBe(""),
    );
  });
});
