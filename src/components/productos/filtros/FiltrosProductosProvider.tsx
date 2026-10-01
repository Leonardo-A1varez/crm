"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, useCallback, useContext, useMemo, useTransition } from "react";
import {
  aplicarGrupos,
  hrefCon,
  leerFiltros,
  limpiarGrupos,
  limpiarTodo as limpiarTodoParams,
} from "@/lib/ui/filtros-productos";
import type { FiltrosUrl, GrupoFiltro, ValoresGrupo } from "@/lib/ui/filtros-productos";
import type {
  FacetasActionInput,
  FacetasActionResult,
} from "@/lib/validation/productos-facetas-action.schema";
import type { ReactNode } from "react";

interface Contexto {
  filtros: FiltrosUrl;
  /** La URL tal cual está hoy, sin el `?`. */
  query: string;
  /** Hay una navegación de filtro en curso: la tabla se atenúa hasta que llega. */
  pendiente: boolean;
  /** La Server Action que trae las listas de filtro; la inyecta la página. */
  cargarFacetas: (input: FacetasActionInput) => Promise<FacetasActionResult>;
  aplicar: (grupos: readonly GrupoFiltro[], valores: ValoresGrupo) => void;
  limpiar: (grupos: readonly GrupoFiltro[]) => void;
  limpiarTodo: () => void;
}

const FiltrosContext = createContext<Contexto | null>(null);

/**
 * Estado compartido de los filtros de `/productos`: los desplegables de los
 * encabezados y los chips escriben la misma URL por acá.
 *
 * `router.replace` y no `push`: cambiar cinco filtros seguidos no son cinco
 * pasos atrás. La navegación va en una transición para que la tabla vieja siga
 * a la vista (atenuada, `aria-busy`) hasta que llega la nueva, en vez de
 * desaparecer detrás del esqueleto de carga.
 */
export function FiltrosProductosProvider({
  cargarFacetas,
  children,
}: {
  cargarFacetas: Contexto["cargarFacetas"];
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pendiente, iniciar] = useTransition();
  const query = searchParams.toString();

  const navegar = useCallback(
    (params: URLSearchParams) => {
      iniciar(() => router.replace(hrefCon(pathname, params), { scroll: false }));
    },
    [pathname, router],
  );

  const valor = useMemo<Contexto>(
    () => ({
      filtros: leerFiltros(new URLSearchParams(query)),
      query,
      pendiente,
      cargarFacetas,
      aplicar: (grupos, valores) => navegar(aplicarGrupos(query, grupos, valores)),
      limpiar: (grupos) => navegar(limpiarGrupos(query, grupos)),
      limpiarTodo: () => navegar(limpiarTodoParams(query)),
    }),
    [query, pendiente, cargarFacetas, navegar],
  );

  return (
    <FiltrosContext.Provider value={valor}>
      <div
        aria-busy={pendiente}
        className="group/filtros flex min-h-0 flex-1 flex-col"
        data-pendiente={pendiente ? "" : undefined}
      >
        {children}
      </div>
    </FiltrosContext.Provider>
  );
}

export function useFiltrosProductos(): Contexto {
  const ctx = useContext(FiltrosContext);
  if (ctx === null) {
    throw new Error("useFiltrosProductos va dentro de <FiltrosProductosProvider>");
  }
  return ctx;
}
