"use client";

import { useId, useRef, useState } from "react";
import { SearchIcon } from "@/components/icons";
import { Casilla } from "@/components/shared/Casilla";
import { normalizarValor } from "@/lib/catalogo/normalizar-valor";
import {
  alternarMaestro,
  alternarValor,
  estaMarcado,
  estadoMaestro,
} from "@/lib/ui/seleccion-faceta";
import { SIN_CATEGORIA, SIN_MARCA } from "@/lib/validation/productos-filtros.schema";
import type { ListaFiltro as EstadoLista } from "./use-lista-filtro";

const cantidadFmt = new Intl.NumberFormat("es-AR");

const COMODINES: ReadonlySet<string> = new Set([SIN_MARCA, SIN_CATEGORIA]);

/**
 * Lista de valores con buscador, casillas y cantidades, estilo Excel.
 *
 * Es solo la vista: quién la usa (`useListaFiltro`) tiene la selección, el
 * pedido al servidor y la traducción a la URL. Los dos rótulos dependen de la
 * columna ("marca"/"marcas", "categoría"/"categorías") y los pone quien la usa.
 *
 * Teclado: la lista es un solo punto de tabulación (`roving tabindex`) y se
 * recorre con las flechas, Inicio y Fin; Espacio marca. Con 500 valores,
 * tabular de a uno sería un castigo.
 */
export function ListaFiltro({
  lista,
  nombre,
  plural,
}: {
  lista: EstadoLista;
  /** Singular con mayúscula, para rotular el buscador: "Marca". */
  nombre: string;
  /** Plural en minúscula, para los avisos: "marcas". */
  plural: string;
}) {
  const id = useId();
  const contenedor = useRef<HTMLUListElement>(null);
  const [foco, setFoco] = useState(0);
  const { seleccion, faceta, q, cargando, error } = lista;

  const valores = faceta?.valores ?? [];
  const nombres = valores.map((v) => v.valor);
  // Con algo escrito en el buscador "Seleccionar todo" habla de los resultados, no de la
  // columna entera, y eso vale también mientras la búsqueda todavía viaja: los valores
  // que se ven son de la anterior y marcarlos o desmarcarlos a todos sería actuar sobre
  // lo que nadie pidió.
  const hayBusqueda = normalizarValor(q) !== "";
  const estado = estadoMaestro(seleccion, nombres, {
    global: !hayBusqueda,
    completo: lista.completa,
  });
  const focoActivo = Math.min(foco, Math.max(0, valores.length - 1));
  const conFilas = valores.filter((v) => v.cantidad > 0).length;
  const recortada = faceta !== null && faceta.distintos > conFilas;

  function moverFoco(a: number) {
    const inputs = contenedor.current?.querySelectorAll<HTMLInputElement>("input[type=checkbox]");
    const destino = inputs?.[Math.max(0, Math.min(a, (inputs?.length ?? 1) - 1))];
    destino?.focus();
  }

  function alTeclear(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") moverFoco(focoActivo + 1);
    else if (e.key === "ArrowUp") moverFoco(focoActivo - 1);
    else if (e.key === "Home") moverFoco(0);
    else if (e.key === "End") moverFoco(valores.length - 1);
    else return;
    e.preventDefault();
  }

  return (
    <div className="flex min-h-0 flex-col gap-1.5">
      <div className="relative">
        <SearchIcon
          size={13}
          aria-hidden
          className="text-ink-faint pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2"
        />
        <input
          type="search"
          value={lista.q}
          maxLength={100}
          autoComplete="off"
          aria-label={`Buscar en ${nombre}`}
          placeholder={`Buscar ${nombre.toLowerCase()}…`}
          onChange={(e) => lista.setQ(e.target.value)}
          className="text-ink-body border-line-input bg-surface-input placeholder:text-ink-faint focus-visible:ring-brand/60 w-full rounded-[7px] border py-[5px] pr-2 pl-[30px] text-[12px] outline-none focus-visible:ring-2"
        />
      </div>

      {error !== null ? (
        <div
          role="alert"
          className="text-danger flex flex-col items-start gap-1.5 py-2 text-[11.5px]"
        >
          <p>{error}</p>
          <button
            type="button"
            onClick={lista.reintentar}
            className="text-ink-secondary hover:text-ink-primary font-semibold underline underline-offset-2"
          >
            Reintentar
          </button>
        </div>
      ) : faceta === null ? (
        <div role="status" aria-label={`Cargando ${plural}`} className="flex flex-col gap-1.5 py-1">
          {[72, 54, 64, 48, 60].map((w) => (
            <div key={w} className="flex items-center gap-2">
              <div className="bg-surface-avatar size-[18px] shrink-0 animate-pulse rounded-[5px]" />
              <div
                className="bg-surface-avatar h-3 animate-pulse rounded"
                style={{ width: `${w}%` }}
              />
            </div>
          ))}
        </div>
      ) : (
        <>
          {valores.length > 0 ? (
            <label className="border-line-layout hover:bg-surface-hover -mx-1 flex cursor-pointer items-center gap-2 rounded-[6px] border-b px-1 py-1 text-[12px] font-[600]">
              <Casilla
                checked={estado === "todos"}
                indeterminate={estado === "algunos"}
                disabled={cargando}
                onChange={() => {
                  if (cargando) return;
                  lista.setSeleccion(alternarMaestro(seleccion, estado, nombres, !hayBusqueda));
                }}
              />
              <span className="text-ink-primary">
                {hayBusqueda ? "Seleccionar resultados" : "Seleccionar todo"}
              </span>
            </label>
          ) : null}

          <p id={`${id}-ayuda`} className="sr-only">
            Usá las flechas arriba y abajo para moverte por la lista y la barra espaciadora para
            marcar.
          </p>
          <ul
            ref={contenedor}
            aria-label={`Valores de ${nombre}`}
            aria-describedby={`${id}-ayuda`}
            onKeyDown={alTeclear}
            className="-mx-1 flex max-h-[216px] min-h-0 flex-col overflow-y-auto px-1"
          >
            {valores.map((v, i) => (
              <li key={v.valor}>
                <label className="hover:bg-surface-hover flex cursor-pointer items-center gap-2 rounded-[6px] px-1 py-[5px] text-[12px]">
                  <Casilla
                    checked={estaMarcado(seleccion, v.valor)}
                    tabIndex={i === focoActivo ? 0 : -1}
                    onFocus={() => setFoco(i)}
                    onChange={() => lista.setSeleccion(alternarValor(seleccion, v.valor))}
                  />
                  <span
                    title={v.valor}
                    className={`min-w-0 flex-1 truncate ${
                      COMODINES.has(v.valor) ? "text-ink-dim italic" : "text-ink-body"
                    }`}
                  >
                    {v.valor}
                  </span>
                  <span className="text-ink-faint shrink-0 font-mono text-[10.5px] tabular-nums">
                    <span className="sr-only">, </span>
                    {cantidadFmt.format(v.cantidad)}
                    <span className="sr-only"> productos</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>

          <div role="status" aria-live="polite" className="text-ink-faint text-[11px] leading-snug">
            {valores.length === 0
              ? hayBusqueda
                ? `Ninguna ${nombre.toLowerCase()} coincide con “${normalizarValor(q)}”.`
                : `No hay ${plural} con los demás filtros puestos.`
              : recortada
                ? `Mostrando ${cantidadFmt.format(conFilas)} de ${cantidadFmt.format(faceta.distintos)} ${plural}. Buscá para ver el resto.`
                : null}
          </div>
        </>
      )}
    </div>
  );
}
