"use client";

import { useEffect, useState } from "react";
import { estadoSincronizacion, type NivelSincronizacion } from "@/lib/catalogo/precios-erp";
import { cn } from "@/lib/utils";

const CADA_MS = 60_000;

/** El estado como viaja del servidor: fechas en ISO, y del error solo si hubo o no. */
export interface EstadoErpSerializado {
  ultimoExito: string | null;
  huboError: boolean;
  /** La hora del servidor al armar la página: el primer dibujo del cliente parte de ahí. */
  ahora: string;
}

const COLOR: Record<NivelSincronizacion, string> = {
  ok: "text-ink-faint",
  "sin-datos": "text-ink-faint",
  atrasado: "text-warn",
  error: "text-danger",
};

/**
 * "Actualizado hace X min" del catálogo respecto del ERP. Avisa en otro color si la
 * última corrida salió mal o si pasaron más de 30 minutos. Se recalcula cada minuto
 * para que la página abierta no mienta; el primer dibujo usa la hora del servidor, así
 * el HTML del servidor y el del cliente dicen lo mismo.
 */
export function AvisoSincronizacionErp({ estado }: { estado: EstadoErpSerializado }) {
  const [ahora, setAhora] = useState(() => new Date(estado.ahora));

  useEffect(() => {
    const id = window.setInterval(() => setAhora(new Date()), CADA_MS);
    return () => window.clearInterval(id);
  }, []);

  const r = estadoSincronizacion(
    {
      ultimo_inicio: null,
      ultimo_fin: null,
      ultimo_exito: estado.ultimoExito === null ? null : new Date(estado.ultimoExito),
      ultimo_error: estado.huboError ? "error" : null,
      filas_cargadas: null,
      actualizado_at: null,
    },
    ahora,
  );

  return (
    <span
      role="status"
      data-nivel={r.nivel}
      className={cn("inline-flex items-center gap-1.5", COLOR[r.nivel])}
    >
      {r.nivel === "atrasado" || r.nivel === "error" ? (
        <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current" />
      ) : null}
      {r.texto}
      {r.nivel === "atrasado" ? " · atrasado" : ""}
    </span>
  );
}
