"use client";

import { useState, type ReactNode } from "react";
import { Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { CATEGORIAS_NODOS, buscarNodos } from "@/lib/workflows/nodos-catalogo";
import { CategoriaColapsable } from "./CategoriaColapsable";
import { NodoDraggable } from "./NodoDraggable";

interface PaletaNodosProps {
  onDragStart: (tipo: string) => void;
  busqueda?: string;
  onBusquedaChange?: (valor: string) => void;
}

const CATEGORIA_ABIERTA_POR_DEFECTO = "triggers";

function resaltarMatch(texto: string, query: string): ReactNode {
  if (!query) return texto;
  const inicio = texto.toLowerCase().indexOf(query.toLowerCase());
  if (inicio === -1) return texto;
  const fin = inicio + query.length;

  return (
    <>
      {texto.slice(0, inicio)}
      <mark className="rounded-sm bg-amber-200 text-inherit dark:bg-amber-500/40">
        {texto.slice(inicio, fin)}
      </mark>
      {texto.slice(fin)}
    </>
  );
}

/**
 * Paleta de nodos del editor: 57 tipos en 7 categorías colapsables, con
 * búsqueda que aplana el resultado en una sola lista (sin categorías) para
 * no obligar a expandir cada una durante la búsqueda.
 */
export function PaletaNodos({
  onDragStart,
  busqueda: busquedaControlada,
  onBusquedaChange,
}: PaletaNodosProps) {
  const [busquedaInterna, setBusquedaInterna] = useState("");
  const busqueda = busquedaControlada ?? busquedaInterna;

  const [categoriasAbiertas, setCategoriasAbiertas] = useState<Set<string>>(
    () => new Set([CATEGORIA_ABIERTA_POR_DEFECTO]),
  );

  const handleBusquedaChange = (valor: string) => {
    setBusquedaInterna(valor);
    onBusquedaChange?.(valor);
  };

  const toggleCategoria = (id: string) => {
    setCategoriasAbiertas((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const query = busqueda.trim();
  const buscando = query.length > 0;
  const resultados = buscando ? buscarNodos(query) : [];

  return (
    <div className="border-line-layout bg-surface-panel flex h-full w-60 flex-col border-r">
      <div className="border-line-layout border-b p-2">
        <div className="relative">
          <Search
            className="text-ink-faint pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2"
            aria-hidden
          />
          <Input
            value={busqueda}
            onChange={(event) => handleBusquedaChange(event.target.value)}
            placeholder="Buscar nodos..."
            aria-label="Buscar nodos"
            className="h-8 pl-7 text-xs"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {buscando ? (
          resultados.length === 0 ? (
            <p className="text-ink-faint p-4 text-center text-xs">Sin resultados</p>
          ) : (
            <div className="flex flex-col gap-0.5 p-2">
              {resultados.map(({ categoria, nodo }) => (
                <NodoDraggable
                  key={nodo.tipo}
                  tipo={nodo.tipo}
                  nombre={resaltarMatch(nodo.nombre, query)}
                  descripcion={nodo.descripcion}
                  icono={nodo.icono}
                  categoria={categoria.nombre}
                  onDragStart={onDragStart}
                />
              ))}
            </div>
          )
        ) : (
          CATEGORIAS_NODOS.map((categoria) => (
            <CategoriaColapsable
              key={categoria.id}
              nombre={categoria.nombre}
              color={categoria.color}
              cantidad={categoria.nodos.length}
              abierta={categoriasAbiertas.has(categoria.id)}
              onToggle={() => toggleCategoria(categoria.id)}
            >
              <div className="flex flex-col gap-0.5 px-2 pb-2">
                {categoria.nodos.map((nodo) => (
                  <NodoDraggable
                    key={nodo.tipo}
                    tipo={nodo.tipo}
                    nombre={nodo.nombre}
                    descripcion={nodo.descripcion}
                    icono={nodo.icono}
                    onDragStart={onDragStart}
                  />
                ))}
              </div>
            </CategoriaColapsable>
          ))
        )}
      </div>
    </div>
  );
}
