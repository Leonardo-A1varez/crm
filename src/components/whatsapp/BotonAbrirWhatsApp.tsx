"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { motivoLegible } from "@/lib/whatsapp/chat";

/**
 * Acción "Abrir WhatsApp Web" de la barra del centro. Solo existe dentro de la
 * app de escritorio (quien monta la barra ya decidió que hay puente): pide
 * `mostrarWhatsApp({ recargar: true })` y muestra el motivo si falla.
 *
 * `alRecargar` corre cuando la recarga salió bien: recargar lleva WhatsApp Web
 * a su portada, y quien llama puede querer volver a poner el chat que estaba.
 */
export function BotonAbrirWhatsApp({ alRecargar }: { alRecargar?: () => void } = {}) {
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function abrir() {
    const crmEscritorio = window.crmEscritorio;
    if (!crmEscritorio) return;
    setCargando(true);
    setError(null);
    const resultado = await crmEscritorio.mostrarWhatsApp({ recargar: true });
    setCargando(false);
    if (resultado.ok) {
      alRecargar?.();
    } else {
      setError(motivoLegible(resultado.motivo));
    }
  }

  return (
    <div className="flex items-center gap-2">
      {error ? <p className="text-danger text-[11px]">{error}</p> : null}
      <Button variant="outline" size="sm" onClick={abrir} disabled={cargando}>
        {cargando ? "Abriendo…" : "Abrir WhatsApp Web"}
      </Button>
    </div>
  );
}
