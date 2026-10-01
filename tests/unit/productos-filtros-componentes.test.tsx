import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { Casilla } from "@/components/shared/Casilla";
import { SIN_MARCA } from "@/lib/validation/productos-filtros.schema";
import type {
  FacetasActionInput,
  FacetasActionResult,
} from "@/lib/validation/productos-facetas-action.schema";
import type { ProductosFacetas } from "@/types/productos";

const nav = vi.hoisted(() => ({ replace: vi.fn(), search: "" }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace }),
  usePathname: () => "/productos",
  useSearchParams: () => new URLSearchParams(nav.search),
}));

// `next/form` necesita el router de la app montado; acá basta con el <form>.
vi.mock("next/form", () => ({
  default: ({ action, children, ...props }: { action: string; children: ReactNode }) => (
    <form action={action} {...props}>
      {children}
    </form>
  ),
}));

const { FiltrosProductosProvider } =
  await import("@/components/productos/filtros/FiltrosProductosProvider");
const {
  CuerpoCategoria,
  CuerpoCodigo,
  CuerpoDescripcion,
  CuerpoEstado,
  CuerpoPrecio,
  CuerpoStock,
} = await import("@/components/productos/filtros/Cuerpos");
const { FiltrosActivos, LimpiarFiltrosBoton } =
  await import("@/components/productos/filtros/FiltrosActivos");
const { EncabezadoProductos } = await import("@/components/productos/filtros/EncabezadoProductos");
const { BuscadorProductos, ESPERA_BUSCADOR_MS } =
  await import("@/components/productos/filtros/BuscadorProductos");
const { FiltroColumna, PanelFiltro, Segmentado } =
  await import("@/components/productos/filtros/FiltroColumna");
const { PaginacionProductos } = await import("@/components/productos/PaginacionProductos");

/** Valores de catálogo inventados para ilustrar la lista. */
function facetas(parcial: Partial<ProductosFacetas> = {}): ProductosFacetas {
  return {
    categorias: {
      valores: [
        { valor: "Frenos", cantidad: 12 },
        { valor: "Motor", cantidad: 8 },
        { valor: "Escape", cantidad: 3 },
      ],
      distintos: 3,
    },
    marcas: {
      valores: [
        { valor: SIN_MARCA, cantidad: 5 },
        { valor: "Alfa", cantidad: 4 },
      ],
      distintos: 2,
    },
    ...parcial,
  };
}

function conProvider(
  ui: ReactElement,
  opciones: {
    search?: string;
    cargar?: (i: FacetasActionInput) => Promise<FacetasActionResult>;
  } = {},
) {
  nav.search = opciones.search ?? "";
  const cargar =
    opciones.cargar ??
    vi.fn(async (): Promise<FacetasActionResult> => ({ ok: true, facetas: facetas() }));
  render(<FiltrosProductosProvider cargarFacetas={cargar}>{ui}</FiltrosProductosProvider>);
  return cargar;
}

/** Lo último que se navegó, ya decodificado: `?a=1&b=2`. */
function ultimaUrl(): string {
  const llamada = nav.replace.mock.calls.at(-1);
  return decodeURIComponent(String(llamada?.[0] ?? "")).replace(/\+/g, " ");
}

beforeEach(() => {
  nav.replace.mockClear();
});
afterEach(cleanup);

describe("Casilla", () => {
  it("indeterminate pone la propiedad DOM y se saca cuando deja de serlo", () => {
    const { rerender } = render(<Casilla indeterminate onChange={() => {}} aria-label="x" />);
    const input = screen.getByLabelText("x") as HTMLInputElement;
    expect(input.indeterminate).toBe(true);
    rerender(<Casilla indeterminate={false} onChange={() => {}} aria-label="x" />);
    expect(input.indeterminate).toBe(false);
  });
});

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
    expect((screen.getByLabelText("Uno") as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByLabelText("Dos"));
    expect(alCambiar).toHaveBeenCalledWith("b");
  });
});

describe("PanelFiltro", () => {
  function panel(props: { aviso: string | null; hayFiltro?: boolean }) {
    const onAplicar = vi.fn();
    const onLimpiar = vi.fn();
    render(
      <PanelFiltro
        titulo="Filtrar por algo"
        hayFiltro={props.hayFiltro ?? true}
        aviso={props.aviso}
        onAplicar={onAplicar}
        onLimpiar={onLimpiar}
      >
        <input aria-label="campo" />
      </PanelFiltro>,
    );
    return { onAplicar, onLimpiar };
  }

  it("Enter en un campo aplica", () => {
    const { onAplicar } = panel({ aviso: null });
    fireEvent.submit(screen.getByLabelText("campo"));
    expect(onAplicar).toHaveBeenCalledTimes(1);
  });

  it("con un aviso no aplica, queda enfocable y apunta al motivo", () => {
    const { onAplicar } = panel({ aviso: "Marcá al menos un valor." });
    const aplicar = screen.getByRole("button", { name: "Aplicar" });
    expect(aplicar.getAttribute("aria-disabled")).toBe("true");
    expect((aplicar as HTMLButtonElement).disabled).toBe(false);
    expect(
      document.getElementById(aplicar.getAttribute("aria-describedby") ?? "")?.textContent,
    ).toBe("Marcá al menos un valor.");
    fireEvent.submit(screen.getByLabelText("campo"));
    expect(onAplicar).not.toHaveBeenCalled();
  });

  it("Limpiar filtro está apagado si no hay filtro puesto", () => {
    panel({ aviso: null, hayFiltro: false });
    expect(
      (screen.getByRole("button", { name: "Limpiar filtro" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

describe("FiltroColumna", () => {
  it("el botón dice si la columna tiene filtro, no solo lo pinta", () => {
    render(
      <FiltroColumna etiqueta="Categoría" activo>
        {() => <p>cuerpo</p>}
      </FiltroColumna>,
    );
    expect(screen.getByRole("button", { name: "Filtrar Categoría (filtro activo)" })).toBeTruthy();
  });

  it("abre un diálogo con nombre y cierra cuando el cuerpo lo pide", async () => {
    render(
      <FiltroColumna etiqueta="Precio" activo={false}>
        {(cerrar) => (
          <button type="button" onClick={cerrar}>
            hecho
          </button>
        )}
      </FiltroColumna>,
    );
    const disparador = screen.getByRole("button", { name: "Filtrar Precio" });
    expect(disparador.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(disparador);
    const dialogo = await screen.findByRole("dialog", { name: "Filtro de Precio" });
    expect(dialogo).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "hecho" }));
    await waitFor(() => expect(disparador.getAttribute("aria-expanded")).toBe("false"));
  });
});

describe("CuerpoPrecio", () => {
  it("un rango invertido se frena en el campo y no navega", () => {
    conProvider(<CuerpoPrecio cerrar={() => {}} />);
    fireEvent.change(screen.getByLabelText("Mínimo"), { target: { value: "500" } });
    fireEvent.change(screen.getByLabelText("Máximo"), { target: { value: "100" } });
    expect(screen.getByRole("alert").textContent).toMatch(/no puede ser mayor/);
    expect(screen.getByLabelText("Mínimo").getAttribute("aria-invalid")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Aplicar" }));
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("aplica el rango, vuelve a la página 1 y conserva los otros filtros", () => {
    const cerrar = vi.fn();
    conProvider(<CuerpoPrecio cerrar={cerrar} />, { search: "estado=activo&pagina=4" });
    fireEvent.change(screen.getByLabelText("Mínimo"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("Máximo"), { target: { value: "50" } });
    fireEvent.click(screen.getByRole("button", { name: "Aplicar" }));
    expect(ultimaUrl()).toBe("/productos?estado=activo&precioMin=10&precioMax=50");
    expect(cerrar).toHaveBeenCalled();
  });

  it("arranca con lo que dice la URL", () => {
    conProvider(<CuerpoPrecio cerrar={() => {}} />, { search: "precioMin=7" });
    expect((screen.getByLabelText("Mínimo") as HTMLInputElement).value).toBe("7");
  });

  it("Limpiar filtro saca solo el precio", () => {
    conProvider(<CuerpoPrecio cerrar={() => {}} />, { search: "precioMin=7&estado=activo" });
    fireEvent.click(screen.getByRole("button", { name: "Limpiar filtro" }));
    expect(ultimaUrl()).toBe("/productos?estado=activo");
  });
});

describe("CuerpoStock", () => {
  it("con stock más un mínimo", () => {
    conProvider(<CuerpoStock cerrar={() => {}} />);
    fireEvent.click(screen.getByLabelText("Con stock"));
    fireEvent.change(screen.getByLabelText("Mínimo"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Aplicar" }));
    expect(ultimaUrl()).toBe("/productos?stockMin=5&conStock=1");
  });

  it("sin stock apaga el rango y no lo manda", () => {
    conProvider(<CuerpoStock cerrar={() => {}} />, { search: "stockMin=5" });
    fireEvent.click(screen.getByLabelText("Sin stock"));
    expect((screen.getByLabelText("Mínimo") as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Aplicar" }));
    expect(ultimaUrl()).toBe("/productos?conStock=0");
  });

  it("el stock no admite decimales", () => {
    conProvider(<CuerpoStock cerrar={() => {}} />);
    fireEvent.change(screen.getByLabelText("Máximo"), { target: { value: "2.5" } });
    expect(screen.getByRole("alert").textContent).toMatch(/entero/);
  });
});

describe("CuerpoCodigo y CuerpoEstado", () => {
  it("código 'empieza con' viaja con su modo; 'contiene' no escribe el modo", () => {
    conProvider(<CuerpoCodigo cerrar={() => {}} />);
    fireEvent.change(screen.getByLabelText("Código"), { target: { value: " ab12 " } });
    fireEvent.click(screen.getByLabelText("Empieza con"));
    fireEvent.click(screen.getByRole("button", { name: "Aplicar" }));
    expect(ultimaUrl()).toBe("/productos?codigo=ab12&codigoModo=empieza");

    cleanup();
    nav.replace.mockClear();
    conProvider(<CuerpoCodigo cerrar={() => {}} />);
    fireEvent.change(screen.getByLabelText("Código"), { target: { value: "ab12" } });
    fireEvent.click(screen.getByRole("button", { name: "Aplicar" }));
    expect(ultimaUrl()).toBe("/productos?codigo=ab12");
  });

  it("texto vacío al aplicar limpia el filtro", () => {
    conProvider(<CuerpoCodigo cerrar={() => {}} />, { search: "codigo=ab&codigoModo=empieza" });
    fireEvent.change(screen.getByLabelText("Código"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Aplicar" }));
    expect(ultimaUrl()).toBe("/productos");
  });

  it("estado Inactivo, y Todos lo saca", () => {
    conProvider(<CuerpoEstado cerrar={() => {}} />);
    fireEvent.click(screen.getByLabelText("Inactivo"));
    fireEvent.click(screen.getByRole("button", { name: "Aplicar" }));
    expect(ultimaUrl()).toBe("/productos?estado=inactivo");

    cleanup();
    nav.replace.mockClear();
    conProvider(<CuerpoEstado cerrar={() => {}} />, { search: "estado=inactivo" });
    fireEvent.click(screen.getByLabelText("Todos"));
    fireEvent.click(screen.getByRole("button", { name: "Aplicar" }));
    expect(ultimaUrl()).toBe("/productos");
  });
});

describe("CuerpoCategoria (lista estilo Excel)", () => {
  async function abrir(search = "") {
    const cargar = conProvider(<CuerpoCategoria cerrar={() => {}} />, { search });
    await screen.findByLabelText(/Frenos/);
    return cargar;
  }

  it("pide la lista con los filtros de la URL, sin la página", async () => {
    const cargar = await abrir("estado=activo&pagina=3&sinMarcas=Alfa");
    expect(cargar).toHaveBeenCalledWith({
      filtros: { estado: "activo", sinMarcas: "Alfa" },
      columna: "categoria",
    });
  });

  it("parte con todo marcado y 'Seleccionar todo' tildado", async () => {
    await abrir();
    const todos = screen.getByLabelText("Seleccionar todo") as HTMLInputElement;
    expect(todos.checked).toBe(true);
    for (const v of ["Frenos", "Motor", "Escape"]) {
      expect((screen.getByLabelText(new RegExp(v)) as HTMLInputElement).checked).toBe(true);
    }
  });

  it("muestra la cantidad de cada valor y la lee en voz alta", async () => {
    await abrir();
    expect(screen.getByLabelText("Frenos, 12 productos")).toBeTruthy();
  });

  it("desmarcar uno deja 'Seleccionar todo' en estado mixto y aplica con 'sinCategorias'", async () => {
    await abrir();
    fireEvent.click(screen.getByLabelText(/Motor/));
    expect((screen.getByLabelText("Seleccionar todo") as HTMLInputElement).indeterminate).toBe(
      true,
    );
    fireEvent.click(screen.getByRole("button", { name: "Aplicar" }));
    expect(ultimaUrl()).toBe("/productos?sinCategorias=Motor");
  });

  it("dejar pocos marcados escribe la lista más corta: 'categorias'", async () => {
    await abrir();
    fireEvent.click(screen.getByLabelText("Seleccionar todo")); // todo → nada
    fireEvent.click(screen.getByLabelText(/Frenos/));
    fireEvent.click(screen.getByRole("button", { name: "Aplicar" }));
    expect(ultimaUrl()).toBe("/productos?categorias=Frenos");
  });

  it("nada marcado no se puede aplicar y dice por qué", async () => {
    await abrir();
    fireEvent.click(screen.getByLabelText("Seleccionar todo"));
    const aplicar = screen.getByRole("button", { name: "Aplicar" });
    expect(aplicar.getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByText(/al menos un valor/)).toBeTruthy();
    fireEvent.click(aplicar);
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("volver a marcar todo aplica sin filtro y limpia la columna", async () => {
    await abrir("sinCategorias=Motor");
    expect((screen.getByLabelText(/Motor/) as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByLabelText(/Motor/));
    fireEvent.click(screen.getByRole("button", { name: "Aplicar" }));
    expect(ultimaUrl()).toBe("/productos");
  });

  it("arranca desde 'categorias' de la URL en modo incluir", async () => {
    await abrir("categorias=Motor");
    expect((screen.getByLabelText(/Motor/) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText(/Frenos/) as HTMLInputElement).checked).toBe(false);
  });

  it("avisa cuando la lista está recortada", async () => {
    conProvider(<CuerpoCategoria cerrar={() => {}} />, {
      cargar: async () => ({
        ok: true,
        facetas: facetas({
          categorias: {
            valores: [{ valor: "Frenos", cantidad: 4 }],
            distintos: 1234,
          },
        }),
      }),
    });
    await screen.findByLabelText(/Frenos/);
    expect(screen.getByText(/Mostrando 1 de 1\.234 categorías/)).toBeTruthy();
  });

  it("con la lista recortada respeta el modo: desmarcar uno escribe 'sin', no convierte", async () => {
    conProvider(<CuerpoCategoria cerrar={() => {}} />, {
      cargar: async () => ({
        ok: true,
        facetas: facetas({
          categorias: {
            valores: [
              { valor: "Frenos", cantidad: 4 },
              { valor: "Motor", cantidad: 2 },
            ],
            distintos: 900,
          },
        }),
      }),
    });
    await screen.findByLabelText(/Frenos/);
    fireEvent.click(screen.getByLabelText(/Frenos/));
    fireEvent.click(screen.getByRole("button", { name: "Aplicar" }));
    expect(ultimaUrl()).toBe("/productos?sinCategorias=Frenos");
  });

  it("buscar pide al servidor con 'qCategoria' y cambia el rótulo del maestro", async () => {
    const cargar = vi.fn(async (i: FacetasActionInput): Promise<FacetasActionResult> => {
      const q = i.qCategoria;
      return {
        ok: true,
        facetas: facetas({
          categorias: {
            valores:
              q === undefined ? facetas().categorias.valores : [{ valor: "Motor", cantidad: 8 }],
            distintos: q === undefined ? 3 : 1,
          },
        }),
      };
    });
    await abrirCon(cargar);
    fireEvent.change(screen.getByLabelText("Buscar en Categoría"), { target: { value: "mot" } });
    await waitFor(() =>
      expect(cargar).toHaveBeenLastCalledWith({
        filtros: {},
        columna: "categoria",
        qCategoria: "mot",
      }),
    );
    await screen.findByText("Seleccionar resultados");
    expect(screen.queryByLabelText(/Frenos/)).toBeNull();
  });

  async function abrirCon(cargar: (i: FacetasActionInput) => Promise<FacetasActionResult>) {
    conProvider(<CuerpoCategoria cerrar={() => {}} />, { cargar });
    await screen.findByLabelText(/Frenos/);
  }

  it("un error del servidor se muestra y se puede reintentar", async () => {
    const cargar = vi
      .fn<(i: FacetasActionInput) => Promise<FacetasActionResult>>()
      .mockResolvedValueOnce({ ok: false, error: "No se pudo cargar." })
      .mockResolvedValue({ ok: true, facetas: facetas() });
    conProvider(<CuerpoCategoria cerrar={() => {}} />, { cargar });
    expect((await screen.findByRole("alert")).textContent).toContain("No se pudo cargar.");
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await screen.findByLabelText(/Frenos/);
  });

  it("las flechas recorren la lista: un solo punto de tabulación (roving tabindex)", async () => {
    await abrir();
    const valores = [/Frenos/, /Motor/, /Escape/].map(
      (r) => screen.getByLabelText(r) as HTMLInputElement,
    );
    expect(valores.map((v) => v.tabIndex)).toEqual([0, -1, -1]);
    valores[0]?.focus();
    fireEvent.keyDown(valores[0] as HTMLElement, { key: "ArrowDown" });
    expect(document.activeElement).toBe(valores[1]);
    fireEvent.keyDown(valores[1] as HTMLElement, { key: "End" });
    expect(document.activeElement).toBe(valores[2]);
    expect(valores.map((v) => v.tabIndex)).toEqual([-1, -1, 0]);
    fireEvent.keyDown(valores[2] as HTMLElement, { key: "Home" });
    expect(document.activeElement).toBe(valores[0]);
  });
});

describe("CuerpoDescripcion (texto + marca en un solo desplegable)", () => {
  it("aplica el texto y las marcas juntos y respeta los comodines", async () => {
    conProvider(<CuerpoDescripcion cerrar={() => {}} />);
    await screen.findByLabelText(/Alfa/);
    fireEvent.change(screen.getByLabelText("Descripción"), { target: { value: "bomba" } });
    fireEvent.click(screen.getByLabelText(/Alfa/)); // queda solo "(sin marca)": empate, gana incluir
    fireEvent.click(screen.getByRole("button", { name: "Aplicar" }));
    expect(ultimaUrl()).toBe(`/productos?descripcion=bomba&marcas=${SIN_MARCA}`);
  });

  it("Limpiar filtro saca el texto y la marca, no lo demás", async () => {
    conProvider(<CuerpoDescripcion cerrar={() => {}} />, {
      search: "descripcion=x&marcas=Alfa&estado=activo",
    });
    await screen.findByLabelText(/Alfa/);
    fireEvent.click(screen.getByRole("button", { name: "Limpiar filtro" }));
    expect(ultimaUrl()).toBe("/productos?estado=activo");
  });
});

describe("FiltrosActivos", () => {
  it("sin filtros no dibuja nada", () => {
    conProvider(<FiltrosActivos />);
    expect(screen.queryByRole("region", { name: "Filtros aplicados" })).toBeNull();
  });

  it("un chip por filtro y la forma de quitar cada uno", () => {
    conProvider(<FiltrosActivos />, {
      search: "sinCategorias=Motor&precioMin=10&estado=activo&pagina=2",
    });
    const region = screen.getByRole("region", { name: "Filtros aplicados" });
    expect(within(region).getByText("Categoría: todas menos Motor")).toBeTruthy();
    expect(within(region).getByText("Precio: desde 10")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Quitar filtro: Precio: desde 10" }));
    expect(ultimaUrl()).toBe("/productos?sinCategorias=Motor&estado=activo");
  });

  it("Limpiar todo saca todos los filtros y la página", () => {
    conProvider(<FiltrosActivos />, { search: "sinCategorias=Motor&estado=activo&pagina=2" });
    fireEvent.click(screen.getByRole("button", { name: "Limpiar todo" }));
    expect(ultimaUrl()).toBe("/productos");
  });

  it("el botón de los estados vacíos hace lo mismo", () => {
    conProvider(<LimpiarFiltrosBoton />, { search: "estado=activo" });
    fireEvent.click(screen.getByRole("button", { name: "Limpiar todos los filtros" }));
    expect(ultimaUrl()).toBe("/productos");
  });
});

describe("EncabezadoProductos", () => {
  function encabezado(isAdmin: boolean, search = "") {
    conProvider(
      <table>
        <EncabezadoProductos isAdmin={isAdmin} />
      </table>,
      { search },
    );
  }

  it("cada columna filtrable tiene su botón; Acciones solo para admin y sin filtro", () => {
    encabezado(true);
    for (const c of ["Código", "Descripción", "Categoría", "Precio", "Stock", "Estado"]) {
      expect(screen.getByRole("button", { name: `Filtrar ${c}` })).toBeTruthy();
    }
    expect(screen.getByRole("columnheader", { name: "Acciones" })).toBeTruthy();
    cleanup();
    encabezado(false);
    expect(screen.queryByRole("columnheader", { name: "Acciones" })).toBeNull();
  });

  it("la columna 'Nombre' ahora es 'Descripción'", () => {
    encabezado(true);
    expect(screen.queryByRole("columnheader", { name: /Nombre/ })).toBeNull();
    expect(screen.getByRole("columnheader", { name: /Descripción/ })).toBeTruthy();
  });

  it("marca como activas solo las columnas con filtro; Descripción cuenta el texto y la marca", () => {
    encabezado(true, "sinMarcas=Alfa&precioMax=9");
    expect(
      screen.getByRole("button", { name: "Filtrar Descripción (filtro activo)" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Filtrar Precio (filtro activo)" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Filtrar Código" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Filtrar Stock" })).toBeTruthy();
  });
});

describe("PaginacionProductos", () => {
  function pie(total: number, pagina: number, search = "") {
    render(
      <PaginacionProductos
        pathname="/productos"
        query={new URLSearchParams(search)}
        total={total}
        pagina={pagina}
        porPagina={50}
      />,
    );
  }

  it("dice qué filas se ven y el total real del filtro", () => {
    pie(1300, 1);
    expect(screen.getByRole("status").textContent).toBe("Mostrando 1–50 de 1.300 productos");
  });

  it("en la primera página no hay anterior ni primera, pero sí siguiente y última", () => {
    pie(1300, 1, "estado=activo");
    expect(
      (screen.getByRole("button", { name: "Primera página" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Página anterior" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByRole("link", { name: "Página siguiente" }).getAttribute("href")).toBe(
      "/productos?estado=activo&pagina=2",
    );
    expect(screen.getByRole("link", { name: "Última página" }).getAttribute("href")).toBe(
      "/productos?estado=activo&pagina=26",
    );
  });

  it("en la última, al revés; y 'anterior' de la página 2 es la URL sin parámetro", () => {
    pie(1300, 26);
    expect(screen.getByRole("link", { name: "Página anterior" }).getAttribute("href")).toBe(
      "/productos?pagina=25",
    );
    expect(
      (screen.getByRole("button", { name: "Página siguiente" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    cleanup();
    pie(1300, 2);
    expect(screen.getByRole("link", { name: "Primera página" }).getAttribute("href")).toBe(
      "/productos",
    );
  });

  it("ir a la página arrastra los filtros (cada valor repetido) y deja el número como campo", () => {
    pie(1300, 3, "sinMarcas=A&sinMarcas=B&pagina=3");
    const input = screen.getByLabelText("Página") as HTMLInputElement;
    expect(input.value).toBe("3");
    expect(input.max).toBe("26");
    const ocultos = [...document.querySelectorAll<HTMLInputElement>("input[type=hidden]")].map(
      (i) => `${i.name}=${i.value}`,
    );
    expect(ocultos).toEqual(["sinMarcas=A", "sinMarcas=B"]);
  });

  it("un solo producto va en singular y sin resultados lo dice", () => {
    pie(1, 1);
    expect(screen.getByRole("status").textContent).toBe("Mostrando 1–1 de 1 producto");
    cleanup();
    pie(0, 1);
    expect(screen.getByRole("status").textContent).toBe("Sin resultados");
  });
});

describe("BuscadorProductos (buscador general)", () => {
  const campo = () =>
    screen.getByRole("searchbox", { name: "Buscar productos" }) as HTMLInputElement;

  afterEach(() => {
    vi.useRealTimers();
  });

  it("tiene un placeholder que dice dónde busca y arranca con el q de la URL", () => {
    conProvider(<BuscadorProductos />, { search: "q=bomba&estado=activo" });
    expect(campo().value).toBe("bomba");
    expect(campo().placeholder).toBe("Buscar por código, descripción o marca…");
    expect(campo().maxLength).toBe(100);
  });

  it("escribir no navega al instante: espera a que termine de escribir y navega una sola vez", () => {
    vi.useFakeTimers();
    conProvider(<BuscadorProductos />, { search: "estado=activo&pagina=3" });
    fireEvent.change(campo(), { target: { value: "bo" } });
    act(() => vi.advanceTimersByTime(ESPERA_BUSCADOR_MS - 50));
    fireEvent.change(campo(), { target: { value: "bomba" } });
    act(() => vi.advanceTimersByTime(ESPERA_BUSCADOR_MS - 50));
    expect(nav.replace).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(60));
    expect(nav.replace).toHaveBeenCalledTimes(1);
    expect(ultimaUrl()).toBe("/productos?estado=activo&q=bomba");
  });

  it("Enter navega sin esperar", () => {
    vi.useFakeTimers();
    conProvider(<BuscadorProductos />);
    fireEvent.change(campo(), { target: { value: "alt-555" } });
    fireEvent.submit(screen.getByRole("search"));
    expect(ultimaUrl()).toBe("/productos?q=alt-555");
    act(() => vi.advanceTimersByTime(ESPERA_BUSCADOR_MS * 2));
    expect(nav.replace).toHaveBeenCalledTimes(1);
  });

  it("recorta los espacios y no navega si queda igual que la URL", () => {
    vi.useFakeTimers();
    conProvider(<BuscadorProductos />, { search: "q=bomba" });
    fireEvent.change(campo(), { target: { value: "  bomba  " } });
    act(() => vi.advanceTimersByTime(ESPERA_BUSCADOR_MS * 2));
    expect(nav.replace).not.toHaveBeenCalled();
    fireEvent.change(campo(), { target: { value: "   " } });
    act(() => vi.advanceTimersByTime(ESPERA_BUSCADOR_MS * 2));
    expect(ultimaUrl()).toBe("/productos");
  });

  it("vaciar el campo saca q de la URL y conserva los demás filtros", () => {
    vi.useFakeTimers();
    conProvider(<BuscadorProductos />, { search: "q=bomba&sinMarcas=A" });
    fireEvent.change(campo(), { target: { value: "" } });
    act(() => vi.advanceTimersByTime(ESPERA_BUSCADOR_MS + 10));
    expect(ultimaUrl()).toBe("/productos?sinMarcas=A");
  });

  it("si la URL cambia desde afuera (Limpiar todo, un chip, atrás) el campo la sigue", () => {
    nav.search = "q=bomba";
    const cargar = vi.fn(
      async (): Promise<FacetasActionResult> => ({ ok: true, facetas: facetas() }),
    );
    const ui = () => (
      <FiltrosProductosProvider cargarFacetas={cargar}>
        <BuscadorProductos />
      </FiltrosProductosProvider>
    );
    const { rerender } = render(ui());
    expect(campo().value).toBe("bomba");
    nav.search = "";
    rerender(ui());
    expect(campo().value).toBe("");
    nav.search = "q=filtro";
    rerender(ui());
    expect(campo().value).toBe("filtro");
  });

  it("lo que se escribe mientras llega la respuesta no se pisa con la URL anterior", () => {
    vi.useFakeTimers();
    nav.search = "";
    const cargar = vi.fn(
      async (): Promise<FacetasActionResult> => ({ ok: true, facetas: facetas() }),
    );
    const ui = () => (
      <FiltrosProductosProvider cargarFacetas={cargar}>
        <BuscadorProductos />
      </FiltrosProductosProvider>
    );
    const { rerender } = render(ui());
    fireEvent.change(campo(), { target: { value: "bom" } });
    act(() => vi.advanceTimersByTime(ESPERA_BUSCADOR_MS + 10)); // navega q=bom
    fireEvent.change(campo(), { target: { value: "bomb" } }); // sigue escribiendo
    nav.search = "q=bom"; // llega la URL de la navegación anterior
    rerender(ui());
    expect(campo().value).toBe("bomb");
  });

  it("el chip de Búsqueda sale en los filtros activos y 'Limpiar todo' lo saca", () => {
    conProvider(<FiltrosActivos />, { search: "q=bomba&estado=activo" });
    expect(screen.getByText("Búsqueda: “bomba”")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Quitar filtro: Búsqueda: “bomba”" }));
    expect(ultimaUrl()).toBe("/productos?estado=activo");
    nav.replace.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Limpiar todo" }));
    expect(ultimaUrl()).toBe("/productos");
  });
});
