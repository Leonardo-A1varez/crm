"use client";

import { useEffect, useRef } from "react";
import { clienteNavegador, hayRealtimeEnNavegador } from "@/lib/realtime/cliente-navegador";

/**
 * Avisa cuando le llega un aviso nuevo a `usuarioId` ("Avisar al equipo").
 *
 * INSERT en `notificaciones` filtrado por `usuario_id`. Realtime entrega la
 * fila con la policy de SELECT de quien mira, así que aunque alguien cambie el
 * filtro no recibe los avisos de otro. El payload no se usa: la campanita
 * vuelve a pedir su lista, que ya trae el nombre del lead resuelto por el
 * servidor. Sin Realtime configurado, la lista se actualiza en la próxima
 * carga del panel.
 */
export function useAvisosEnVivo(usuarioId: string | null, onNuevo: () => void): void {
  const alNuevo = useRef(onNuevo);
  useEffect(() => {
    alNuevo.current = onNuevo;
  });

  useEffect(() => {
    if (usuarioId === null || !hayRealtimeEnNavegador()) return;
    const supabase = clienteNavegador();
    if (supabase === null) return;
    const canal = supabase
      .channel(`avisos:${usuarioId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notificaciones",
          filter: `usuario_id=eq.${usuarioId}`,
        },
        () => alNuevo.current(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(canal);
    };
  }, [usuarioId]);
}
