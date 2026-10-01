"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { normalizarValor } from "@/lib/catalogo/normalizar-valor";
import { filtrosParaFacetas, gruposActivos } from "@/lib/ui/filtros-productos";
import { listaCompleta, resolverSeleccion, seleccionDesdeUrl } from "@/lib/ui/seleccion-faceta";
import { useFiltrosProductos } from "./FiltrosProductosProvider";
import type { Resolucion, Seleccion } from "@/lib/ui/seleccion-faceta";
import type { Faceta } from "@/types/productos";

export type ColumnaLista = "marca" | "categoria";

/** Espera que se termine de escribir antes de preguntarle al servidor. */
export const ESPERA_BUSQUEDA_MS = 250;

function useConEspera<T>(valor: T, ms: number): T {
  const [esperado, setEsperado] = useState(valor);
  useEffect(() => {
    const id = setTimeout(() => setEsperado(valor), ms);
    return () => clearTimeout(id);
  }, [valor, ms]);
  return esperado;
}

type Resultado =
  | { tipo: "listo"; faceta: Faceta; q: string }
  | { tipo: "error"; mensaje: string; q: string };

export interface ListaFiltro {
  seleccion: Seleccion;
  setSeleccion: (s: Seleccion) => void;
  /** Texto escrito en el buscador de la lista. */
  q: string;
  setQ: (q: string) => void;
  /** Hay un pedido en vuelo, o todavía no se pidió la búsqueda que se ve en el input. */
  cargando: boolean;
  faceta: Faceta | null;
  error: string | null;
  reintentar: () => void;
  /** `true` si lo que se ve es la columna entera (sin búsqueda y sin recorte). */
  completa: boolean;
  /** Lo que se escribiría en la URL con la selección de ahora. */
  resolucion: Resolucion;
}

/**
 * Una lista de filtro estilo Excel: pide los valores al servidor con los demás
 * filtros puestos, mantiene la selección en borrador y dice a qué se traduce.
 *
 * La lista se pide al abrir y se vuelve a pedir al buscar (con espera). Cada
 * pedido conoce el `q` con el que salió: una respuesta que llega vieja no pisa
 * a una nueva.
 */
export function useListaFiltro(
  columna: ColumnaLista,
  incluirUrl: readonly string[],
  excluirUrl: readonly string[],
  /**
   * Hay un filtro sin aplicar en el mismo desplegable (el texto de Descripción):
   * al aplicar va junto con esta lista, así que cuenta como "otro filtro".
   */
  otroFiltroEnBorrador = false,
): ListaFiltro {
  const { filtros, query, cargarFacetas } = useFiltrosProductos();
  const otrosFiltros = otroFiltroEnBorrador || gruposActivos(filtros).some((g) => g !== columna);
  const [seleccion, setSeleccion] = useState(() => seleccionDesdeUrl(incluirUrl, excluirUrl));
  const [q, setQ] = useState("");
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [intento, setIntento] = useState(0);
  const qPedida = useConEspera(normalizarValor(q), ESPERA_BUSQUEDA_MS);

  useEffect(() => {
    let vigente = true;
    const filtros = filtrosParaFacetas(new URLSearchParams(query));
    const busqueda = qPedida === "" ? undefined : qPedida;
    const opciones = columna === "marca" ? { qMarca: busqueda } : { qCategoria: busqueda };
    cargarFacetas({ filtros, columna, ...opciones })
      .then((r) => {
        if (!vigente) return;
        setResultado(
          r.ok
            ? {
                tipo: "listo",
                faceta: columna === "marca" ? r.facetas.marcas : r.facetas.categorias,
                q: qPedida,
              }
            : { tipo: "error", mensaje: r.error, q: qPedida },
        );
      })
      .catch(() => {
        if (!vigente) return;
        setResultado({
          tipo: "error",
          mensaje: "No se pudo cargar la lista. Reintentá.",
          q: qPedida,
        });
      });
    return () => {
      vigente = false;
    };
  }, [columna, query, qPedida, intento, cargarFacetas]);

  const faceta = resultado?.tipo === "listo" ? resultado.faceta : null;
  const completa = faceta !== null && listaCompleta(faceta, resultado?.q !== "");
  const resolucion = useMemo(
    () =>
      resolverSeleccion(seleccion, completa && faceta ? faceta.valores.map((v) => v.valor) : null, {
        otrosFiltros,
      }),
    [seleccion, completa, faceta, otrosFiltros],
  );
  const reintentar = useCallback(() => {
    setResultado(null);
    setIntento((n) => n + 1);
  }, []);

  return {
    seleccion,
    setSeleccion,
    q,
    setQ,
    cargando: resultado === null || resultado.q !== normalizarValor(q),
    faceta,
    error: resultado?.tipo === "error" ? resultado.mensaje : null,
    reintentar,
    completa,
    resolucion,
  };
}
