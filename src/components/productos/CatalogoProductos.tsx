"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Inventory2 } from "@/components/icons";
import { EmptyState } from "@/components/shared/EmptyState";
import { campoDeEmpresa, formatearPrecio, precioDeEmpresa } from "@/lib/catalogo/precios-erp";
import { hayFiltros } from "@/lib/ui/filtros-productos";
import { ALTO_FILA, calcularVentana, indiceAriaDeFila } from "@/lib/ui/ventana-virtual";
import { cn } from "@/lib/utils";
import {
  ANCHO_ACCIONES,
  anchoDeColumna,
  anchoMinimoDeTabla,
  COLUMNAS_VISIBLES,
  type ColumnaTabla,
} from "./columnas";
import { EncabezadoProductos } from "./filtros/EncabezadoProductos";
import { LimpiarFiltrosBoton } from "./filtros/FiltrosActivos";
import { useFiltrosProductos } from "./filtros/FiltrosProductosProvider";
import { ProductoRowActions } from "./ProductoRowActions";
import type { EstadoCarga } from "./use-carga-productos";
import type {
  SetProductoActivoInput,
  UpdateProductoInput,
} from "@/lib/validation/productos.schema";
import type { ActionResult } from "@/types/inbox";
import type { ProductoFila } from "@/types/productos";

const ALTO_VISIBLE_INICIAL = 600;
const FILAS_ESQUELETO = 12;

const numeroFmt = new Intl.NumberFormat("es-EC");

/**
 * Celda de una fila de alto fijo: una sola línea, truncada con puntos suspensivos y el
 * texto completo en el `title`. La línea de abajo es una sombra interna y no un borde:
 * un borde sumaría al alto de la fila y la cuenta de la virtualización dejaría de dar.
 */
const TD =
  "h-[38px] overflow-hidden px-3.5 py-0 text-ellipsis whitespace-nowrap shadow-[inset_0_-1px_0_var(--color-line-layout)]";

const columnasConAncho = COLUMNAS_VISIBLES.map(anchoDeColumna);

/** El tinte de la columna de precio de la empresa del usuario: se lee sin competir con el resto. */
const RESALTE = "bg-brand/[0.07]";

function Vacio() {
  return <span className="text-ink-ghost">—</span>;
}

function valorDeTexto(p: ProductoFila, c: ColumnaTabla): string | null {
  switch (c.id) {
    case "codigo":
      return p.codigo_interno;
    case "codigoFabrica":
      return p.codigo_fabrica;
    case "otrosCodigos":
      return p.otros_codigos.length > 0 ? p.otros_codigos.join(", ") : null;
    case "categoria":
      return p.categoria;
    case "descripcion":
      return p.nombre;
    case "marca":
      return p.descripcion;
    default:
      return null;
  }
}

const FilaProducto = memo(function FilaProducto({
  producto: p,
  indice,
  isAdmin,
  campoPropio,
  onUpdate,
  onToggleActivo,
}: {
  producto: ProductoFila;
  indice: number;
  isAdmin: boolean;
  /** La columna de precio de la empresa del usuario, o `null` si no tiene. */
  campoPropio: ReturnType<typeof campoDeEmpresa>;
  onUpdate: (input: UpdateProductoInput) => Promise<ActionResult>;
  onToggleActivo: (input: SetProductoActivoInput) => Promise<ActionResult>;
}) {
  return (
    <tr
      data-fila="producto"
      aria-rowindex={indiceAriaDeFila(indice)}
      style={{ height: ALTO_FILA }}
      className="hover:bg-surface-elevated"
    >
      {COLUMNAS_VISIBLES.map((v) => {
        if (v.tipo === "empresa") {
          const precio = precioDeEmpresa(p, v.empresa.campo);
          const propia = v.empresa.campo === campoPropio;
          return (
            <td
              key={v.empresa.campo}
              title={precio === null ? undefined : String(precio)}
              className={cn(
                TD,
                "text-right font-mono tabular-nums",
                propia ? cn(RESALTE, "text-ink-primary font-semibold") : "text-ink-secondary",
              )}
            >
              {precio === null ? <Vacio /> : formatearPrecio(precio)}
            </td>
          );
        }
        const c = v.columna;
        if (c.id === "precio") {
          return (
            <td
              key={c.id}
              title={p.precio === null ? undefined : String(p.precio)}
              className={cn(
                TD,
                "text-right font-mono tabular-nums",
                p.precio === null ? "text-ink-dim font-sans" : "text-ink-body",
              )}
            >
              {formatearPrecio(p.precio)}
            </td>
          );
        }
        if (c.id === "stock") {
          return (
            <td
              key={c.id}
              className={cn(TD, "text-ink-secondary text-right font-mono tabular-nums")}
            >
              {numeroFmt.format(p.stock)}
            </td>
          );
        }
        if (c.id === "estado") {
          return (
            <td key={c.id} className={TD}>
              {p.activo ? (
                <span className="text-ok bg-ok/10 border-ok/28 inline-flex items-center rounded-md border px-[7px] py-[2.5px] text-[10px] font-semibold">
                  Activo
                </span>
              ) : (
                <span className="text-ink-dim border-line-control inline-flex items-center rounded-md border px-[7px] py-[2.5px] text-[10px] font-semibold">
                  Inactivo
                </span>
              )}
            </td>
          );
        }
        const texto = valorDeTexto(p, c);
        return (
          <td
            key={c.id}
            title={texto ?? undefined}
            className={cn(
              TD,
              c.mono ? "text-ink-secondary font-mono text-[11.5px]" : "text-ink-body",
              c.id === "descripcion" && "text-ink-primary",
            )}
          >
            {texto === null || texto === "" ? <Vacio /> : texto}
            {c.id === "codigo" && p.codigo_difiere === true ? (
              <span
                title="Código difiere: el del ERP no coincide con el código interno"
                className="text-warn bg-warn/10 border-warn/28 ml-2 inline-flex items-center rounded-md border px-[6px] py-[1.5px] align-middle font-sans text-[9.5px] font-semibold"
              >
                Difiere
                <span className="sr-only"> (el código del ERP no coincide con el interno)</span>
              </span>
            ) : null}
          </td>
        );
      })}
      {isAdmin ? (
        <td className="h-[38px] px-3.5 py-0 shadow-[inset_0_-1px_0_var(--color-line-layout)]">
          <ProductoRowActions producto={p} onUpdate={onUpdate} onToggleActivo={onToggleActivo} />
        </td>
      ) : null}
    </tr>
  );
});

/** `aria-rowcount`: el total + el encabezado; -1 (desconocido) si falló y hay filas dibujadas. */
function cuentaDeFilas(estado: EstadoCarga): number | undefined {
  if (estado.tipo === "lista") return estado.total + 1;
  if (estado.tipo === "error" && estado.filas.length > 0) {
    return estado.total !== null ? estado.total + 1 : -1;
  }
  return undefined;
}

function Esqueleto({ columnas }: { columnas: number }) {
  return (
    <>
      {Array.from({ length: FILAS_ESQUELETO }, (_, fila) => (
        <tr key={fila} data-esqueleto="fila" style={{ height: ALTO_FILA }}>
          {Array.from({ length: columnas }, (_, i) => (
            <td key={i} className="px-3.5 py-0 shadow-[inset_0_-1px_0_var(--color-line-layout)]">
              <span
                aria-hidden
                className="bg-surface-avatar block h-[12px] animate-pulse rounded-[4px] motion-reduce:animate-none"
                style={{ width: `${52 + ((fila + i) % 4) * 11}%` }}
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

function FilaMensaje({ columnas, children }: { columnas: number; children: React.ReactNode }) {
  return (
    <tr>
      <td colSpan={columnas} className="px-5 py-14">
        <div className="mx-auto flex max-w-md flex-col items-center gap-3 text-center">
          {children}
        </div>
      </td>
    </tr>
  );
}

/**
 * La tabla del catálogo: las 21.000 filas en memoria, sin paginar, y el DOM solo con las
 * que se ven.
 *
 * Alto fijo por fila + dos filas espaciadoras (ver `ventana-virtual.ts`): el recorrido
 * es continuo, la barra de desplazamiento es la de la lista entera y no hay saltos. El
 * encabezado es `sticky` dentro de la misma región con scroll, y la tabla es
 * `table-layout: fixed` con anchos por columna: si el ancho dependiera del contenido, la
 * columna cambiaría de medida según qué filas están dibujadas y el encabezado saltaría
 * al desplazarse. Si no entra a lo ancho, se desplaza de costado dentro de su región y
 * no en la página.
 *
 * La región ocupa el alto que deja el resto de la pantalla (es un hijo `flex-1` de una
 * columna del alto de la ventana) y el pie queda siempre a la vista. Las filas llegan
 * por lotes: el pie dice cuánto lleva cargado.
 */
export function CatalogoProductos({
  isAdmin,
  empresaErp = null,
  onUpdate,
  onToggleActivo,
}: {
  isAdmin: boolean;
  /** La empresa del ERP del usuario: se le resalta su columna de precio. */
  empresaErp?: number | null;
  onUpdate: (input: UpdateProductoInput) => Promise<ActionResult>;
  onToggleActivo: (input: SetProductoActivoInput) => Promise<ActionResult>;
}) {
  const { filtros, consulta, carga } = useFiltrosProductos();
  const { estado, reintentar } = carga;
  const region = useRef<HTMLDivElement>(null);
  const cuadro = useRef<number | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [altoVisible, setAltoVisible] = useState(ALTO_VISIBLE_INICIAL);
  const columnas = COLUMNAS_VISIBLES.length + (isAdmin ? 1 : 0);
  const campoPropio = campoDeEmpresa(empresaErp);
  const filtrado = hayFiltros(filtros);

  // Una carga nueva (otra consulta, o "Reintentar") arranca arriba. Un refresco en
  // segundo plano, no: la tabla se queda donde estaba.
  const cargando = estado.tipo === "cargando";
  useEffect(() => {
    if (!cargando) return;
    // Asignar `scrollTop` dispara el evento `scroll`, y `alDesplazar` actualiza el estado.
    if (region.current !== null) region.current.scrollTop = 0;
  }, [consulta, cargando]);

  useEffect(() => {
    const caja = region.current;
    if (caja === null) return;
    const medir = () => setAltoVisible(caja.clientHeight || ALTO_VISIBLE_INICIAL);
    medir();
    const observador = new ResizeObserver(medir);
    observador.observe(caja);
    return () => observador.disconnect();
  }, []);

  useEffect(
    () => () => {
      if (cuadro.current !== null) cancelAnimationFrame(cuadro.current);
    },
    [],
  );

  // Un `setState` por cada evento de scroll son decenas por segundo: se junta uno por cuadro.
  const alDesplazar = useCallback(() => {
    if (cuadro.current !== null) return;
    cuadro.current = requestAnimationFrame(() => {
      cuadro.current = null;
      if (region.current !== null) setScrollTop(region.current.scrollTop);
    });
  }, []);

  const filas = estado.tipo === "lista" || estado.tipo === "error" ? estado.filas : [];
  const ventana = calcularVentana(filas.length, scrollTop, altoVisible);
  const visibles = filas.slice(ventana.inicio, ventana.fin);
  const sinCatalogo = estado.tipo === "lista" && estado.completo && estado.total === 0 && !filtrado;
  const ocupado = estado.tipo === "cargando" || (estado.tipo === "lista" && estado.actualizando);

  const pie = (
    <div className="border-line-layout bg-surface-panel text-ink-dim flex min-h-[39px] shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t px-5 py-2 font-mono text-[11px] tabular-nums">
      {estado.tipo === "lista" ? (
        estado.completo ? (
          <>
            <span role="status">
              {numeroFmt.format(estado.total)} {estado.total === 1 ? "producto" : "productos"}
              {filtrado ? " con los filtros aplicados" : ""} · carga completa
              {estado.actualizando ? " · actualizando…" : ""}
            </span>
            {estado.total > 0 ? <span>No hay más productos.</span> : null}
          </>
        ) : (
          <span>
            {numeroFmt.format(estado.filas.length)} de {numeroFmt.format(estado.total)} cargados…
          </span>
        )
      ) : estado.tipo === "error" ? (
        <>
          <span role="alert" className="text-danger">
            {estado.filas.length > 0
              ? `Se cargaron ${numeroFmt.format(estado.filas.length)}${
                  estado.total !== null ? ` de ${numeroFmt.format(estado.total)}` : ""
                } y no se pudo traer el resto. ${estado.mensaje}`
              : estado.mensaje}
          </span>
          <button
            type="button"
            onClick={reintentar}
            className="border-line-control text-ink-secondary hover:bg-surface-hover focus-visible:ring-brand/60 inline-flex min-h-[28px] items-center rounded-[6px] border px-[10px] font-sans text-[12px] outline-none focus-visible:ring-2"
          >
            Reintentar
          </button>
        </>
      ) : estado.tipo === "invalido" ? (
        <span>Hay filtros que no se pudieron aplicar.</span>
      ) : (
        <span>Cargando el catálogo…</span>
      )}
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={region}
        role="region"
        aria-label="Catálogo de productos"
        aria-busy={ocupado}
        tabIndex={0}
        onScroll={alDesplazar}
        className="focus-visible:ring-brand/60 min-h-0 flex-1 overflow-auto outline-none focus-visible:ring-2 focus-visible:ring-inset"
      >
        {sinCatalogo ? (
          <EmptyState
            icon={<Inventory2 size={34} strokeWidth={1.4} />}
            title="Sin productos"
            description="Cargá el catálogo a mano o importá un CSV para que el agente pueda cotizar."
          />
        ) : (
          <table
            aria-rowcount={cuentaDeFilas(estado)}
            style={{ minWidth: anchoMinimoDeTabla(isAdmin) }}
            className="w-full table-fixed border-separate border-spacing-0 text-[12.5px]"
          >
            <colgroup>
              {columnasConAncho.map((ancho, i) => (
                <col key={i} style={ancho !== undefined ? { width: ancho } : undefined} />
              ))}
              {isAdmin ? <col style={{ width: ANCHO_ACCIONES }} /> : null}
            </colgroup>
            <EncabezadoProductos isAdmin={isAdmin} empresaErp={empresaErp} />
            <tbody>
              {estado.tipo === "cargando" ? <Esqueleto columnas={columnas} /> : null}
              {estado.tipo === "invalido" ? (
                <FilaMensaje columnas={columnas}>
                  <div role="alert" className="flex flex-col items-center gap-1.5">
                    <p className="text-ink-primary text-[13px] font-semibold">
                      No se pudieron aplicar los filtros
                    </p>
                    {estado.mensajes.map((m) => (
                      <p key={m} className="text-ink-dim text-[12px]">
                        {m}
                      </p>
                    ))}
                  </div>
                  <LimpiarFiltrosBoton />
                </FilaMensaje>
              ) : null}
              {estado.tipo === "lista" && estado.completo && estado.total === 0 ? (
                <FilaMensaje columnas={columnas}>
                  <div className="flex flex-col items-center gap-1">
                    <p className="text-ink-primary text-[13px] font-semibold">
                      Ningún producto coincide con los filtros
                    </p>
                    <p className="text-ink-dim text-[12px]">
                      Soltá alguno desde su encabezado para ver más.
                    </p>
                  </div>
                  <LimpiarFiltrosBoton />
                </FilaMensaje>
              ) : null}
              {ventana.altoAntes > 0 ? (
                <tr aria-hidden="true">
                  <td colSpan={columnas} style={{ height: ventana.altoAntes, padding: 0 }} />
                </tr>
              ) : null}
              {visibles.map((p, i) => (
                <FilaProducto
                  key={p.id}
                  producto={p}
                  indice={ventana.inicio + i}
                  isAdmin={isAdmin}
                  campoPropio={campoPropio}
                  onUpdate={onUpdate}
                  onToggleActivo={onToggleActivo}
                />
              ))}
              {ventana.altoDespues > 0 ? (
                <tr aria-hidden="true">
                  <td colSpan={columnas} style={{ height: ventana.altoDespues, padding: 0 }} />
                </tr>
              ) : null}
            </tbody>
          </table>
        )}
      </div>
      {pie}
    </div>
  );
}
