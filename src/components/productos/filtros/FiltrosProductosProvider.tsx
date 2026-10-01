"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import {
  aplicarGrupos,
  consultaCanonica,
  hrefCon,
  leerFiltros,
  limpiarGrupos,
  limpiarTodo as limpiarTodoParams,
} from "@/lib/ui/filtros-productos";
import { cargadoresDeRed } from "../cliente-productos";
import { useCargaProductos } from "../use-carga-productos";
import type { CargadoresProductos } from "../cliente-productos";
import type { Carga } from "../use-carga-productos";
import type { FiltrosUrl, GrupoFiltro, ValoresGrupo } from "@/lib/ui/filtros-productos";
import type { ReactNode } from "react";

interface Contexto {
  filtros: FiltrosUrl;
  /** La URL tal cual está hoy, sin el `?`. */
  query: string;
  /** La URL reducida a lo que define las filas (filtros y orden), en forma canónica. */
  consulta: string;
  carga: Carga;
  /** De dónde salen los lotes y las listas de valores; se inyecta en los tests. */
  cargadores: CargadoresProductos;
  /** Escribe una URL nueva sin recargar la página. */
  navegar: (params: URLSearchParams) => void;
  aplicar: (grupos: readonly GrupoFiltro[], valores: ValoresGrupo) => void;
  limpiar: (grupos: readonly GrupoFiltro[]) => void;
  limpiarTodo: () => void;
  /** Vuelve a leer el catálogo sin esqueleto: se llama al guardar un producto. */
  recargar: () => void;
}

const FiltrosContext = createContext<Contexto | null>(null);

/**
 * Estado compartido de `/productos`: la URL, los filtros que salen de ella y la carga
 * completa del catálogo que esos filtros definen.
 *
 * Los encabezados, los chips y el buscador escriben la misma URL por acá, con la API
 * nativa `history.replaceState`, que Next integra con `useSearchParams`: la URL cambia
 * al instante y la carga arranca ya, sin pasar por un viaje al servidor que no tiene
 * nada que decidir (la página no lee los filtros: los lee el navegador y los manda a
 * `/api/productos/*`). `replaceState` y no `pushState`: cambiar cinco filtros seguidos
 * no son cinco pasos atrás.
 */
export function FiltrosProductosProvider({
  cargadores = cargadoresDeRed,
  children,
}: {
  cargadores?: CargadoresProductos;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = searchParams.toString();
  const [version, setVersion] = useState(0);
  const consulta = useMemo(() => consultaCanonica(new URLSearchParams(query)), [query]);
  const carga = useCargaProductos(consulta, version, cargadores.lote);

  const navegar = useCallback(
    (params: URLSearchParams) => {
      window.history.replaceState(null, "", hrefCon(pathname, params));
    },
    [pathname],
  );
  const recargar = useCallback(() => setVersion((v) => v + 1), []);

  const valor = useMemo<Contexto>(
    () => ({
      filtros: leerFiltros(new URLSearchParams(query)),
      query,
      consulta,
      carga,
      cargadores,
      navegar,
      aplicar: (grupos, valores) => navegar(aplicarGrupos(query, grupos, valores)),
      limpiar: (grupos) => navegar(limpiarGrupos(query, grupos)),
      limpiarTodo: () => navegar(limpiarTodoParams(query)),
      recargar,
    }),
    [query, consulta, carga, cargadores, navegar, recargar],
  );

  return <FiltrosContext.Provider value={valor}>{children}</FiltrosContext.Provider>;
}

export function useFiltrosProductos(): Contexto {
  const ctx = useContext(FiltrosContext);
  if (ctx === null) {
    throw new Error("useFiltrosProductos va dentro de <FiltrosProductosProvider>");
  }
  return ctx;
}

/**
 * Para quien guarda un producto: vuelve a leer el catálogo. Fuera del proveedor no
 * hace nada (el formulario de alta no depende de que haya una tabla a la vista).
 */
export function useRecargarProductos(): () => void {
  return useContext(FiltrosContext)?.recargar ?? noHacerNada;
}

function noHacerNada() {}
