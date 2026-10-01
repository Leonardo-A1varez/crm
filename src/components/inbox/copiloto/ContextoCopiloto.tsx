"use client";

import { createContext, useCallback, useContext, useState } from "react";
import type { UbicacionTarjeta } from "@/lib/copiloto/acciones";
import type { ViaUsoBorrador } from "@/types/copiloto";

export type ResultadoInsertar = { ok: true } | { ok: false; error: string };

/**
 * Lo que la tarjeta recuerda de un borrador y no puede perder cuando se
 * desmonta: la tarjeta vive en dos lugares según la vista (sobre el composer en
 * "Hilo del CRM", entre la barra y WhatsApp en "WhatsApp Web") y al insertar
 * desde el hilo se cambia de vista a mitad de la operación.
 */
export interface EstadoTarjeta {
  /** El texto editado; `undefined` = el del borrador. No se persiste (§5). */
  texto?: string | undefined;
  /** Uso exitoso que el refresco de 5 s todavía no trajo (evita un segundo envío). */
  usadoVia?: ViaUsoBorrador | undefined;
  /** "Redactando…" pedido con Regenerar/Reintentar; `inicio` es `Date.now()` del pedido. */
  regeneracion?: { inicio: number; vencido: boolean } | undefined;
  /** Acción de envío en curso. */
  enCurso?: "insertar" | "copiar" | "al_composer" | undefined;
  /** El envío por la API rechazó: puede que el servidor ya lo haya mandado. */
  envioDudoso?: boolean | undefined;
}

export interface AlmacenEstadoTarjeta {
  /** Por id de borrador. */
  estados: Readonly<Record<string, EstadoTarjeta>>;
  /** Identidad estable: se puede llamar desde una instancia que ya se desmontó. */
  actualizar(borradorId: string, cambio: (previo: EstadoTarjeta) => EstadoTarjeta): void;
}

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
  /**
   * Estado de las tarjetas por borrador, que vive en `CentroConversacion` para
   * sobrevivir al cambio de vista. Sin proveedor la tarjeta usa estado local.
   */
  almacenTarjeta?: AlmacenEstadoTarjeta;
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

const VACIO: EstadoTarjeta = {};

export type CambioEstadoTarjeta =
  | Partial<EstadoTarjeta>
  | ((previo: EstadoTarjeta) => Partial<EstadoTarjeta>);

/**
 * El estado de la tarjeta de un borrador. Si `CentroConversacion` aportó el
 * almacén vive ahí (y sobrevive al remontaje); si no, queda local.
 * `actualizar` mezcla con lo previo y tiene identidad estable.
 */
export function useEstadoTarjeta(
  borradorId: string,
): [EstadoTarjeta, (cambio: CambioEstadoTarjeta) => void] {
  const { almacenTarjeta } = useContextoCopiloto();
  const actualizarAlmacen = almacenTarjeta?.actualizar;
  const [local, setLocal] = useState<Readonly<Record<string, EstadoTarjeta>>>({});

  const estado = (almacenTarjeta ? almacenTarjeta.estados[borradorId] : local[borradorId]) ?? VACIO;

  const actualizar = useCallback(
    (cambio: CambioEstadoTarjeta) => {
      const aplicar = (previo: EstadoTarjeta): EstadoTarjeta => ({
        ...previo,
        ...(typeof cambio === "function" ? cambio(previo) : cambio),
      });
      if (actualizarAlmacen) actualizarAlmacen(borradorId, aplicar);
      else setLocal((m) => ({ ...m, [borradorId]: aplicar(m[borradorId] ?? VACIO) }));
    },
    [actualizarAlmacen, borradorId],
  );

  return [estado, actualizar];
}
