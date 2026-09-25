"use client";

import { useEffect, useRef, useState } from "react";
import { clienteNavegador, hayRealtimeEnNavegador } from "@/lib/realtime/cliente-navegador";

export type EstadoSuscripcion = "conectando" | "conectada" | "caida";

/**
 * Escucha una corrida en vivo y avisa cada vez que cambió.
 *
 * Dos fuentes, las dos filtradas por la corrida:
 *   - INSERT en `workflow_run_pasos` (`run_id=eq.<id>`): terminó un paso.
 *   - UPDATE en `workflow_runs` (`id=eq.<id>`): cambió el estado o el nodo.
 *
 * El payload no se usa. La pantalla vuelve a pedir la vista entera, porque lo
 * que dibuja —qué se reusa, qué mensajes se repetirían— lo calcula el servidor
 * a partir de todos los pasos, y rearmarlo acá con una fila suelta sería una
 * segunda versión de esas reglas.
 *
 * **Al quedar suscripta también avisa.** Entre que el servidor leyó la página
 * y que el canal quedó abierto pueden haber terminado pasos; sin esa primera
 * relectura, la pantalla se quedaba mostrando la foto vieja hasta el próximo
 * cambio, que en una corrida que espera un día puede no llegar nunca.
 *
 * `onCambio` se lee de un ref: una función nueva en cada render no reabre el
 * canal. El canal se cierra al desmontar o al cambiar de corrida.
 */
export function useCorridaEnVivo(
  runId: string,
  onCambio: () => void,
  { activa = true }: { activa?: boolean } = {},
): EstadoSuscripcion {
  const [estado, setEstado] = useState<EstadoSuscripcion>("conectando");
  const alCambiar = useRef(onCambio);
  useEffect(() => {
    alCambiar.current = onCambio;
  });

  const disponible = activa && hayRealtimeEnNavegador();

  useEffect(() => {
    if (!disponible) return;
    const supabase = clienteNavegador();
    if (supabase === null) return;
    const avisar = () => alCambiar.current();
    const canal = supabase
      .channel(`corrida:${runId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "workflow_run_pasos",
          filter: `run_id=eq.${runId}`,
        },
        avisar,
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "workflow_runs", filter: `id=eq.${runId}` },
        avisar,
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          setEstado("conectada");
          avisar();
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setEstado("caida");
        }
      });

    return () => {
      void supabase.removeChannel(canal);
    };
  }, [runId, disponible]);

  return disponible ? estado : "caida";
}
