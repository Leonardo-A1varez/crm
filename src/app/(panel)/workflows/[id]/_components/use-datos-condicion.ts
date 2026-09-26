"use client";

import { useEffect, useRef, useState } from "react";
import { condicionCompleta, type Grupo } from "@/lib/ui/condiciones";
import {
  catalogosCondicionAction,
  coincidenciasCondicionAction,
} from "../../_actions/condicion.actions";

import type { CatalogosDeCondicion } from "../_lib/campos-condicion";
import type { CampoCondicion } from "@/lib/workflows/condiciones";

/** Cuánto se espera después del último cambio antes de volver a contar. */
const ESPERA_CONTEO_MS = 400;

/**
 * Lo que dice el contador del panel:
 *
 * - `contado`: la cifra. Con `recalculando` la cifra es la anterior y hay otra
 *   consulta en vuelo: se sigue mostrando atenuada en vez de un spinner.
 * - `no_contable`: la condición usa un campo que depende del disparo.
 * - `error`: no se pudo contar; se dice en una línea.
 * - `pendiente`: todavía no volvió la primera consulta.
 */
export type EstadoConteo =
  | { tipo: "pendiente" }
  | { tipo: "contado"; cantidad: number; recalculando: boolean }
  | { tipo: "no_contable"; campos: CampoCondicion[] }
  | { tipo: "error"; mensaje: string };

/** Intents y etiquetas de la base, una vez por panel abierto. */
export function useCatalogosCondicion(): CatalogosDeCondicion | null {
  const [catalogos, setCatalogos] = useState<CatalogosDeCondicion | null>(null);
  useEffect(() => {
    let vivo = true;
    void catalogosCondicionAction().then((r) => {
      if (vivo && r.ok) setCatalogos(r.data);
    });
    return () => {
      vivo = false;
    };
  }, []);
  return catalogos;
}

/**
 * Cuántos leads cumplen `arbol` ahora. Sólo pregunta con la condición entera
 * —una a medias no tiene número que valga—, espera a que se deje de tipear y
 * descarta respuestas viejas: la que llega tarde de un árbol anterior no pisa
 * la del árbol de ahora.
 */
export function useConteoCondicion(arbol: Grupo | null): EstadoConteo {
  // El resultado recuerda para qué árbol se calculó: si el árbol cambió desde
  // entonces, la cifra es la anterior y se muestra atenuada ("recalculando").
  const [resultado, setResultado] = useState<{ arbol: Grupo; estado: EstadoConteo } | null>(null);
  const turno = useRef(0);
  const completa = arbol !== null && arbol.hijos.length > 0 && condicionCompleta(arbol);

  useEffect(() => {
    if (!completa || arbol === null) return;
    const mio = ++turno.current;
    const t = setTimeout(() => {
      void coincidenciasCondicionAction({ arbol, muestra: 0 }).then((r) => {
        if (mio !== turno.current) return;
        const estado: EstadoConteo = !r.ok
          ? { tipo: "error", mensaje: r.error }
          : r.data.tipo === "no_contable"
            ? { tipo: "no_contable", campos: r.data.campos }
            : { tipo: "contado", cantidad: r.data.total, recalculando: false };
        setResultado({ arbol, estado });
      });
    }, ESPERA_CONTEO_MS);
    return () => clearTimeout(t);
  }, [arbol, completa]);

  if (resultado === null) return { tipo: "pendiente" };
  if (resultado.arbol !== arbol && resultado.estado.tipo === "contado") {
    return { ...resultado.estado, recalculando: true };
  }
  return resultado.estado;
}
