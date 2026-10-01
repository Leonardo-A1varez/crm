import Form from "next/form";
import Link from "next/link";
import { FirstPage, LastPage, NavigateBefore, NavigateNext } from "@/components/icons";
import { conPagina, hrefCon, rangoDePagina } from "@/lib/ui/filtros-productos";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

const numeroFmt = new Intl.NumberFormat("es-AR");

const BOTON =
  "border-line-control text-ink-secondary focus-visible:ring-brand/60 inline-flex size-8 items-center justify-center rounded-[8px] border transition-colors outline-none focus-visible:ring-2";

/**
 * Un control de página: un link de verdad (se abre en otra pestaña, funciona sin
 * JavaScript) o, en el borde del rango, un botón apagado. El apagado no
 * desaparece, así los controles no cambian de lugar.
 */
function Control({
  etiqueta,
  href,
  children,
}: {
  etiqueta: string;
  href: string | null;
  children: ReactNode;
}) {
  if (href === null) {
    return (
      <button type="button" disabled aria-label={etiqueta} className={cn(BOTON, "opacity-40")}>
        {children}
      </button>
    );
  }
  return (
    <Link
      href={href}
      aria-label={etiqueta}
      scroll={false}
      className={cn(BOTON, "hover:bg-surface-hover")}
    >
      {children}
    </Link>
  );
}

/**
 * Pie de la tabla de `/productos`: qué filas se ven, cuántas hay en total y cómo
 * moverse. Es de servidor y navega con links, así la página N tiene su propia URL.
 *
 * El total es el del filtro entero, no el de la página. El texto de la izquierda
 * es una región `status`: al cambiar de página o de filtro, el lector de pantalla
 * anuncia el rango nuevo.
 */
export function PaginacionProductos({
  pathname,
  query,
  total,
  pagina,
  porPagina,
}: {
  pathname: string;
  /** Los `searchParams` actuales, tal cual, para arrastrar los filtros. */
  query: URLSearchParams;
  total: number;
  pagina: number;
  porPagina: number;
}) {
  const { totalPaginas, desde, hasta } = rangoDePagina(total, pagina, porPagina);
  const href = (p: number) => hrefCon(pathname, conPagina(query, p));
  const hayAnterior = pagina > 1;
  const haySiguiente = pagina < totalPaginas;
  // Los hidden de "Ir a la página" arrastran todo menos la página, que es el input.
  const arrastrar = [...query.entries()].filter(([clave]) => clave !== "pagina");

  return (
    <nav
      aria-label="Paginación de productos"
      className="border-line-layout bg-surface-panel flex shrink-0 flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t px-5 py-2"
    >
      <p role="status" className="text-ink-dim text-[12px] tabular-nums">
        {total === 0 ? (
          "Sin resultados"
        ) : (
          <>
            Mostrando{" "}
            <span className="text-ink-primary font-semibold">
              {numeroFmt.format(desde)}–{numeroFmt.format(hasta)}
            </span>{" "}
            de <span className="text-ink-primary font-semibold">{numeroFmt.format(total)}</span>{" "}
            {total === 1 ? "producto" : "productos"}
          </>
        )}
      </p>

      <div className="flex items-center gap-1.5">
        <Control etiqueta="Primera página" href={hayAnterior ? href(1) : null}>
          <FirstPage size={15} aria-hidden />
        </Control>
        <Control etiqueta="Página anterior" href={hayAnterior ? href(pagina - 1) : null}>
          <NavigateBefore size={15} aria-hidden />
        </Control>

        <Form
          action={pathname}
          className="text-ink-dim mx-1.5 flex items-center gap-1.5 text-[12px]"
        >
          {arrastrar.map(([clave, valor], i) => (
            <input key={`${clave}-${i}`} type="hidden" name={clave} value={valor} />
          ))}
          <label htmlFor="ir-a-pagina">Página</label>
          <input
            key={pagina}
            id="ir-a-pagina"
            name="pagina"
            type="number"
            min={1}
            max={totalPaginas}
            step={1}
            inputMode="numeric"
            defaultValue={pagina}
            className="text-ink-body border-line-input bg-surface-input focus-visible:ring-brand/60 h-8 w-[68px] rounded-[8px] border px-2 text-center font-mono text-[12px] tabular-nums outline-none focus-visible:ring-2"
          />
          <span>de {numeroFmt.format(totalPaginas)}</span>
          <button type="submit" className="sr-only">
            Ir a la página
          </button>
        </Form>

        <Control etiqueta="Página siguiente" href={haySiguiente ? href(pagina + 1) : null}>
          <NavigateNext size={15} aria-hidden />
        </Control>
        <Control etiqueta="Última página" href={haySiguiente ? href(totalPaginas) : null}>
          <LastPage size={15} aria-hidden />
        </Control>
      </div>
    </nav>
  );
}
