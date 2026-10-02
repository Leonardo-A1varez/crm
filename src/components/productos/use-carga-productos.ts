"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LOTE_TAMANO } from "@/lib/validation/productos-filtros.schema";
import { ErrorLectura } from "./cliente-productos";
import type { CargadoresProductos } from "./cliente-productos";
import type { LoteProductos, ProductoFila } from "@/types/productos";

/** Cuántos lotes se piden a la vez después del primero. */
export const LOTES_EN_PARALELO = 4;

export type EstadoCarga =
  /** Todavía no llegó el primer lote. */
  | { tipo: "cargando" }
  /** El servidor rechazó los filtros de la URL (400). */
  | { tipo: "invalido"; mensajes: string[] }
  /** Falló la carga. Las filas que alcanzaron a llegar siguen a la vista. */
  | { tipo: "error"; filas: ProductoFila[]; total: number | null; mensaje: string }
  | {
      tipo: "lista";
      filas: ProductoFila[];
      total: number;
      /** Ya están todos los lotes. */
      completo: boolean;
      /** Se está refrescando en segundo plano: las filas que se ven son las de antes. */
      actualizando: boolean;
    };

export interface Carga {
  estado: EstadoCarga;
  /** Vuelve a pedir todo desde cero, con el esqueleto: es el "Reintentar" del pie. */
  reintentar: () => void;
}

/**
 * La carga completa del catálogo: el primer lote solo, y después los que falten de a
 * `LOTES_EN_PARALELO`, juntándolos en una sola lista que la tabla virtualiza.
 *
 * Se pinta tras cada tanda: el lote 1 cubre la espera, el resto llega de fondo. Lo que
 * se ve es siempre un PREFIJO correcto del conjunto filtrado y ordenado (el filtro y el
 * orden los aplica el servidor), nunca un cálculo del cliente sobre un conjunto a
 * medias. Si cambia `consulta` a mitad de camino se aborta lo que viaja y se empieza
 * de cero.
 *
 * `version` sube cuando se guarda un producto: ahí se vuelve a pedir TODO con la misma
 * consulta, pero sin esqueleto. Las filas de antes siguen a la vista (con
 * `actualizando`) y se cambian de una vez cuando llegó el último lote, para que la
 * tabla no parpadee ni salte de scroll por una edición.
 */
export function useCargaProductos(
  consulta: string,
  version: number,
  cargarLote: CargadoresProductos["lote"],
): Carga {
  const [estado, setEstado] = useState<EstadoCarga>({ tipo: "cargando" });
  const [intento, setIntento] = useState(0);
  const estadoRef = useRef(estado);
  // Antes del efecto de carga (se ejecutan en el orden en que se declaran).
  useEffect(() => {
    estadoRef.current = estado;
  });
  const ultima = useRef<{ consulta: string; intento: number } | null>(null);

  useEffect(() => {
    const controlador = new AbortController();
    const previa = ultima.current;
    ultima.current = { consulta, intento };
    const enSegundoPlano =
      previa !== null &&
      previa.consulta === consulta &&
      previa.intento === intento &&
      estadoRef.current.tipo === "lista";

    if (enSegundoPlano) {
      setEstado((e) => (e.tipo === "lista" ? { ...e, actualizando: true } : e));
    } else {
      setEstado({ tipo: "cargando" });
    }

    const filas: ProductoFila[] = [];
    const ids = new Set<string>();
    let totalConocido: number | null = null;

    function publicar(completo: boolean) {
      if (controlador.signal.aborted || totalConocido === null) return;
      setEstado({
        tipo: "lista",
        filas: [...filas],
        total: totalConocido,
        completo,
        actualizando: !completo,
      });
    }

    function agregar(l: LoteProductos, numero: number, total: number) {
      if (l.lote !== numero || l.desde !== (numero - 1) * LOTE_TAMANO) {
        throw new ErrorLectura("Los lotes del catálogo llegaron fuera de orden.", null);
      }
      if (l.total !== total) {
        throw new ErrorLectura("El catálogo cambió durante la carga.", null);
      }
      if (l.filas.length !== Math.min(LOTE_TAMANO, total - l.desde)) {
        throw new ErrorLectura("La carga completa del catálogo quedó incompleta.", null);
      }
      // Se valida el lote entero ANTES de sumarlo: si una fila repite un id, las filas
      // válidas de antes —que ya podrían estar en pantalla— no se contaminan.
      const nuevas = new Set<string>();
      for (const f of l.filas) {
        if (ids.has(f.id) || nuevas.has(f.id)) {
          throw new ErrorLectura("La carga repitió un producto.", null);
        }
        nuevas.add(f.id);
      }
      for (const id of nuevas) ids.add(id);
      filas.push(...l.filas);
    }

    async function cargarTodo() {
      const primero = await cargarLote(consulta, 1, controlador.signal);
      totalConocido = primero.total;
      agregar(primero, 1, primero.total);
      const lotes = Math.ceil(primero.total / LOTE_TAMANO);
      if (!enSegundoPlano || lotes <= 1) publicar(lotes <= 1);

      for (let inicio = 2; inicio <= lotes; inicio += LOTES_EN_PARALELO) {
        const numeros = Array.from(
          { length: Math.min(LOTES_EN_PARALELO, lotes - inicio + 1) },
          (_, i) => inicio + i,
        );
        const respuestas = await Promise.all(
          numeros.map((n) => cargarLote(consulta, n, controlador.signal)),
        );
        respuestas.forEach((r, i) => agregar(r, numeros[i] as number, primero.total));
        const completo = inicio + numeros.length - 1 >= lotes;
        if (!enSegundoPlano || completo) publicar(completo);
      }
    }

    void cargarTodo().catch((e: unknown) => {
      if (controlador.signal.aborted) return;
      if (e instanceof ErrorLectura && e.estado === 400) {
        setEstado({ tipo: "invalido", mensajes: e.mensajes });
        return;
      }
      const mensaje = e instanceof ErrorLectura ? e.message : "No se pudo cargar el catálogo.";
      const previas = estadoRef.current;
      setEstado({
        tipo: "error",
        // En segundo plano las filas de antes siguen siendo las mejores que hay.
        filas: enSegundoPlano && previas.tipo === "lista" ? previas.filas : [...filas],
        total: enSegundoPlano && previas.tipo === "lista" ? previas.total : totalConocido,
        mensaje,
      });
    });

    return () => controlador.abort();
  }, [consulta, version, intento, cargarLote]);

  const reintentar = useCallback(() => setIntento((n) => n + 1), []);
  return useMemo(() => ({ estado, reintentar }), [estado, reintentar]);
}
