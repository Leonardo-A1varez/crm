"use client";

import { useCallback, useEffect, useState } from "react";
import { motivoLegible } from "@/lib/whatsapp/chat";
import type { VistaWhatsApp } from "@/types/crm-escritorio";

/**
 * La configuración de la vista nativa de WhatsApp (recorte izquierdo del ancho
 * de ventana actual y modo completo), que vive en la app de escritorio y no en el CRM: el CRM la lee al
 * montar y la cambia por el puente.
 *
 * `activo` es "estamos dentro de la app de escritorio". Los cambios se aplican
 * de inmediato en pantalla y se confirman contra la app; si ésta los rechaza se
 * vuelve a leer lo que quedó de verdad, para que el control no se quede
 * mostrando un valor que no está aplicado.
 */
export function useVistaWhatsApp(activo: boolean) {
  const [vista, setVista] = useState<VistaWhatsApp | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const puente = activo ? window.crmEscritorio : undefined;
    if (!puente) return;
    let cancelado = false;
    puente
      .obtenerVistaWhatsApp()
      .then((leida) => {
        if (!cancelado) setVista(leida);
      })
      .catch(() => {
        if (!cancelado) setError("No se pudo leer la configuración de la vista de WhatsApp.");
      });
    return () => {
      cancelado = true;
    };
  }, [activo]);

  // El recorte efectivo cambia solo cuando cambia el ancho de la ventana.
  useEffect(() => {
    const puente = activo ? window.crmEscritorio : undefined;
    if (!puente?.alCambiarVistaWhatsApp) return;
    return puente.alCambiarVistaWhatsApp((estado) => setVista(estado));
  }, [activo]);

  const cambiar = useCallback(async (cambios: Partial<VistaWhatsApp>) => {
    const puente = window.crmEscritorio;
    if (!puente) return;
    setError(null);
    // Mover el recorte lo guarda como la calibración de este ancho de ventana.
    setVista((previa) =>
      previa
        ? {
            ...previa,
            ...cambios,
            ...(cambios.recorteIzquierdo !== undefined && previa.anchoArea != null
              ? { calibrado: true }
              : {}),
          }
        : previa,
    );
    try {
      const resultado = await puente.configurarVistaWhatsApp(cambios);
      if (!resultado.ok) {
        setError(motivoLegible(resultado.motivo));
        setVista(await puente.obtenerVistaWhatsApp());
      }
    } catch {
      setError("No se pudo cambiar la vista de WhatsApp.");
    }
  }, []);

  return { vista, error, cambiar };
}
