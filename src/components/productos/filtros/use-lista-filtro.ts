"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFINICIONES_LISTA, type ColumnaLista } from "@/lib/catalogo/columnas-productos";
import { normalizarValor } from "@/lib/catalogo/normalizar-valor";
import {
  consultaCanonica,
  gruposActivos,
  valoresDeLista,
  type ValoresGrupo,
} from "@/lib/ui/filtros-productos";
import {
  listaCompleta,
  PRESUPUESTO_URL_DEFAULT,
  resolverSeleccion,
  seleccionDesdeUrl,
  TODO,
} from "@/lib/ui/seleccion-faceta";
import { ErrorLectura } from "../cliente-productos";
import { useFiltrosProductos } from "./FiltrosProductosProvider";
import type { Resolucion, Seleccion } from "@/lib/ui/seleccion-faceta";
import type { Faceta } from "@/types/productos";

/** Espera que se termine de escribir antes de preguntarle al servidor. */
export const ESPERA_BUSQUEDA_MS = 250;

function useConEspera<T>(valor: T, ms: number): T {
  const [esperado, setEsperado] = useState(valor);
  useEffect(() => {
    if (Object.is(valor, esperado)) return;
    const id = setTimeout(() => setEsperado(valor), ms);
    return () => clearTimeout(id);
  }, [valor, esperado, ms]);
  return esperado;
}

type Resultado =
  | { tipo: "listo"; faceta: Faceta; q: string }
  | { tipo: "error"; mensaje: string; q: string };

export interface ListaFiltro {
  seleccion: Seleccion;
  /**
   * Cambia lo marcado y, si lo marcado se puede escribir en la URL, lo aplica en el
   * acto: no hay botón "Aplicar". Si no se puede (nada marcado, demasiados valores) la
   * selección queda como borrador, la URL no cambia y `resolucion` dice por qué.
   */
  elegir: (s: Seleccion) => void;
  /** Saca el filtro de la columna y vuelve a marcar todo. */
  quitarFiltro: () => void;
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
  /** La columna tiene un filtro puesto en la URL. */
  hayFiltro: boolean;
}

/**
 * La lista de valores estilo Excel de una columna: pide los valores al servidor con los
 * demás filtros puestos, mantiene la selección en borrador y la aplica al instante.
 *
 * La lista se pide al abrir y se vuelve a pedir al buscar (con espera). Cada pedido
 * conoce el `q` con el que salió: una respuesta que llega vieja no pisa a una nueva, y
 * un pedido en vuelo se aborta si llega otro.
 *
 * Marcar un valor cambia la URL, y la URL cambia el pedido de las OTRAS listas, no el de
 * ésta: la lista de una columna se calcula sin sus propios filtros. Por eso la clave de
 * este efecto es la consulta SIN esta columna: aplicar lo recién marcado no la vuelve a
 * pedir ni le parpadea la lista bajo el mouse.
 */
export function useListaFiltro(columna: ColumnaLista): ListaFiltro {
  const { filtros, query, cargadores, aplicar, limpiar } = useFiltrosProductos();
  const d = DEFINICIONES_LISTA[columna];
  const enUrl = filtros.listas[columna];
  const otrosFiltros = gruposActivos(filtros).some((g) => g !== columna);

  const [seleccion, setSeleccion] = useState(() => seleccionDesdeUrl(enUrl.incluir, enUrl.excluir));
  const [q, setQ] = useState("");
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [intento, setIntento] = useState(0);
  const qPedida = useConEspera(normalizarValor(q), ESPERA_BUSQUEDA_MS);

  // El pedido lleva la consulta completa (la lista necesita saber qué valores están
  // seleccionados), pero solo se repite si cambia lo que NO es de esta columna.
  const consultaSinColumna = consultaCanonica(new URLSearchParams(query), {
    sinOrden: true,
    sinColumna: columna,
  });
  const consultaCompleta = consultaCanonica(new URLSearchParams(query), { sinOrden: true });
  const ultimaConsulta = useRef(consultaCompleta);
  // Antes del efecto de abajo (se ejecutan en el orden en que se declaran): el pedido
  // siempre lee la consulta de ESTE render.
  useEffect(() => {
    ultimaConsulta.current = consultaCompleta;
  });

  useEffect(() => {
    const controlador = new AbortController();
    cargadores
      .faceta(ultimaConsulta.current, columna, qPedida, controlador.signal)
      .then((faceta) => setResultado({ tipo: "listo", faceta, q: qPedida }))
      .catch((e: unknown) => {
        if (controlador.signal.aborted) return;
        setResultado({
          tipo: "error",
          mensaje:
            e instanceof ErrorLectura && e.mensajes.length > 0
              ? e.mensajes.join(" ")
              : "No se pudo cargar la lista. Reintentá.",
          q: qPedida,
        });
      });
    return () => controlador.abort();
  }, [columna, consultaSinColumna, qPedida, intento, cargadores]);

  const faceta = resultado?.tipo === "listo" ? resultado.faceta : null;
  const completa = faceta !== null && listaCompleta(faceta, resultado?.q !== "");
  // Cuánto de la URL le queda a esta lista una vez puestos los demás filtros.
  const presupuestoChars = Math.max(600, PRESUPUESTO_URL_DEFAULT - consultaSinColumna.length);
  const resolver = useCallback(
    (s: Seleccion) =>
      resolverSeleccion(s, completa && faceta ? faceta.valores.map((v) => v.valor) : null, {
        otrosFiltros,
        presupuestoChars,
        sobrecargaPorValor: d.incluir.length + 2,
      }),
    [completa, faceta, otrosFiltros, presupuestoChars, d.incluir.length],
  );
  const resolucion = useMemo(() => resolver(seleccion), [resolver, seleccion]);

  const elegir = useCallback(
    (s: Seleccion) => {
      setSeleccion(s);
      const valores: ValoresGrupo | null = valoresDeLista(resolver(s), columna);
      if (valores !== null) aplicar([columna], valores);
    },
    [resolver, columna, aplicar],
  );
  const quitarFiltro = useCallback(() => {
    setSeleccion(TODO);
    limpiar([columna]);
  }, [columna, limpiar]);
  const reintentar = useCallback(() => {
    setResultado(null);
    setIntento((n) => n + 1);
  }, []);

  return {
    seleccion,
    elegir,
    quitarFiltro,
    q,
    setQ,
    cargando: resultado === null || resultado.q !== normalizarValor(q),
    faceta,
    error: resultado?.tipo === "error" ? resultado.mensaje : null,
    reintentar,
    completa,
    resolucion,
    hayFiltro: enUrl.incluir.length + enUrl.excluir.length > 0,
  };
}
