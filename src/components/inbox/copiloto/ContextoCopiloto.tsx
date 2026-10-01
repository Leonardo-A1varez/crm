"use client";

import { createContext, useContext } from "react";
import type { UbicacionTarjeta } from "@/lib/copiloto/acciones";

export type ResultadoInsertar = { ok: true } | { ok: false; error: string };

export interface ContextoCopilotoValor {
  /** `null` mientras no se sabe si la página corre en la app de escritorio (primer render). */
  ubicacion: UbicacionTarjeta | null;
  /** E.164 sin `+`, o `null` si el chat no se puede abrir en WhatsApp Web. */
  telefono: string | null;
  /**
   * Abre el chat en la vista de WhatsApp de la app de escritorio con el texto
   * precargado. Lo implementa `CentroConversacion`, que es el dueño del puente y
   * de la vista: si se está en "Hilo del CRM" pasa también a "WhatsApp Web".
   */
  insertarEnWhatsApp(texto: string): Promise<ResultadoInsertar>;
}

const POR_DEFECTO: ContextoCopilotoValor = {
  ubicacion: null,
  telefono: null,
  insertarEnWhatsApp: async () => ({
    ok: false,
    error: "La app de escritorio no está disponible.",
  }),
};

export const ContextoCopiloto = createContext<ContextoCopilotoValor>(POR_DEFECTO);

export function useContextoCopiloto(): ContextoCopilotoValor {
  return useContext(ContextoCopiloto);
}
