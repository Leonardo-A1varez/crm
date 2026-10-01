"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SearchIcon } from "@/components/icons";
import { useFiltrosProductos } from "./FiltrosProductosProvider";

/** Espera a que se termine de escribir antes de mandar la búsqueda a la URL. */
export const ESPERA_BUSCADOR_MS = 350;

/**
 * Buscador general de `/productos`, arriba de la tabla. Busca por código, por
 * descripción y por marca a la vez, y se combina con los filtros de cada columna.
 *
 * Escribe `q` en la URL con espera, como cualquier otro filtro: vuelve a la
 * página 1, aparece como chip "Búsqueda" y lo saca "Limpiar todo". Enter lo manda
 * sin esperar.
 *
 * La URL es la fuente de verdad, pero el campo es del que escribe. `enviado` es
 * lo último que este campo le mandó a la URL: si la URL cambia a eso, es la
 * respuesta a lo que se acaba de escribir y el campo no se toca (el que escribe
 * ya puede ir tres letras más adelante); si cambia a otra cosa —un chip, "Limpiar
 * todo", el botón atrás— el campo la sigue.
 *
 * Es del mismo estilo que `SearchField` pero no lo reusa: aquel es un GET con
 * botón que recarga la página entera, y acá el filtrado va en vivo.
 */
export function BuscadorProductos() {
  const { filtros, aplicar } = useFiltrosProductos();
  const [valor, setValor] = useState(filtros.q);
  const enviado = useRef(filtros.q);

  useEffect(() => {
    if (filtros.q !== enviado.current) {
      enviado.current = filtros.q;
      setValor(filtros.q);
    }
  }, [filtros.q]);

  const enviar = useCallback(
    (texto: string) => {
      const q = texto.trim();
      if (q === enviado.current) return;
      enviado.current = q;
      aplicar(["busqueda"], { q });
    },
    [aplicar],
  );

  useEffect(() => {
    const id = setTimeout(() => enviar(valor), ESPERA_BUSCADOR_MS);
    return () => clearTimeout(id);
  }, [valor, enviar]);

  return (
    <div className="border-line-layout bg-surface-panel shrink-0 border-b px-5 py-2.5">
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          enviar(valor);
        }}
        className="max-w-[420px] min-w-0"
      >
        <div className="bg-surface-elevated border-line-card has-[input:focus-visible]:ring-brand/60 flex items-center gap-2 rounded-[9px] border py-1.5 pr-2 pl-2.5 has-[input:focus-visible]:ring-2">
          <SearchIcon className="text-ink-ghost shrink-0" size={15} aria-hidden />
          <input
            type="search"
            value={valor}
            maxLength={100}
            autoComplete="off"
            spellCheck={false}
            aria-label="Buscar productos"
            placeholder="Buscar por código, descripción o marca…"
            onChange={(e) => setValor(e.target.value)}
            className="text-ink-body placeholder:text-ink-faint min-w-0 flex-1 bg-transparent text-[12px] outline-none"
          />
        </div>
      </form>
    </div>
  );
}
