"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { EnvioEnCurso, formatearEntero } from "@/components/difusion";
import { RefreshPoller } from "@/components/shared/RefreshPoller";
import { detenerAction, pausarAction, reanudarAction } from "../_actions/envio.actions";
import type { AccionEnvio, EnvioDifusion } from "@/components/difusion";
import type { ResultadoAccion } from "../_actions/action-error";

/**
 * Cada cuánto se vuelve a leer mientras hay algo en cola. Los estados los
 * escribe el motor de envío y los webhooks de Meta; no hay Realtime en esta
 * pantalla, así que se re-lee, igual que la Bandeja.
 */
const REFRESCO_MS = 5000;

/**
 * El envío de una difusión programada.
 *
 * Detener, pausar y reanudar son Server Actions contra el servicio (sólo de
 * admin, con Zod en la primera línea). Lo que muestra la pantalla vuelve de la
 * base con `router.refresh()`: acá no se sostiene un estado inventado.
 */
export function PantallaEnvio({
  envio,
  puedeActuar,
}: {
  envio: EnvioDifusion;
  puedeActuar: boolean;
}) {
  const router = useRouter();
  const [accion, setAccion] = useState<AccionEnvio | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function ejecutar<T>(
    tipo: AccionEnvio,
    pedir: () => Promise<ResultadoAccion<T>>,
    exito: (datos: T) => string,
  ) {
    setAccion(tipo);
    setError(null);
    try {
      const r = await pedir();
      if (!r.ok) {
        setError(r.error);
        return;
      }
      toast.success(exito(r.datos));
      router.refresh();
    } catch {
      setError("El servidor no respondió. Recargá la página para ver en qué quedó.");
    } finally {
      setAccion(null);
    }
  }

  const vivo = envio.estado === "programada" || envio.estado === "enviando";

  return (
    <>
      {vivo ? <RefreshPoller intervalMs={REFRESCO_MS} /> : null}
      <EnvioEnCurso
        envio={envio}
        puedeActuar={puedeActuar}
        accion={accion}
        error={error}
        onVolver={() => router.push("/difusion")}
        onDetener={() =>
          void ejecutar(
            "detener",
            () => detenerAction({ id: envio.id }),
            (d) =>
              `Detenida: se frenaron ${formatearEntero(d.cancelados)} en cola${
                d.yaSalieron > 0 ? ` y ${formatearEntero(d.yaSalieron)} ya estaban en Meta` : ""
              }.`,
          )
        }
        onPausar={() =>
          void ejecutar(
            "pausar",
            () => pausarAction({ id: envio.id }),
            () => "Pausada: queda en revisión hasta que alguien la reanude.",
          )
        }
        onReanudar={() =>
          void ejecutar(
            "reanudar",
            () => reanudarAction({ id: envio.id }),
            () => "Reanudada.",
          )
        }
      />
    </>
  );
}
