"use client";

import { useState, useTransition } from "react";
import type { ActionResult } from "@/types/inbox";

/**
 * Alta de un flujo. Solo nombre y descripción: el grafo se arma después, en el
 * detalle.
 *
 * Nace apagado —así lo decide `crear()` en el servicio— y eso se dice en
 * pantalla: un flujo que empieza andando manda mensajes reales a leads reales
 * apenas se guarda, y nadie quiere descubrir eso después.
 *
 * La action llega por prop y no importada: `components/**` no puede importar
 * de `app/**` (boundaries), y es el mismo patrón que ya usa `SideNav` con
 * `onLogout`.
 */
export function CrearWorkflowDialog({
  onCrear,
}: {
  onCrear: (input: { nombre: string; descripcion: string | null }) => Promise<ActionResult>;
}) {
  const [abierto, setAbierto] = useState(false);
  const [nombre, setNombre] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, startEnviar] = useTransition();

  const enviar = () => {
    setError(null);
    startEnviar(async () => {
      const r = await onCrear({
        nombre,
        descripcion: descripcion.trim() === "" ? null : descripcion,
      });
      if (r.ok) {
        setAbierto(false);
        setNombre("");
        setDescripcion("");
      } else {
        setError(r.error);
      }
    });
  };

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="border-line-control text-ink-secondary hover:bg-surface-hover rounded-[9px] border px-[11px] py-1.5 text-[11.5px] font-semibold transition-colors"
      >
        Nuevo flujo
      </button>
    );
  }

  return (
    <div className="border-line-layout bg-surface-panel absolute top-16 right-5 z-20 w-[320px] rounded-[11px] border p-4 shadow-lg">
      <h2 className="text-ink-primary mb-3 text-[13px] font-[680]">Nuevo flujo</h2>

      <label className="text-ink-secondary mb-1 block text-[11.5px]">Nombre</label>
      <input
        autoFocus
        value={nombre}
        onChange={(e) => setNombre(e.target.value)}
        placeholder="Seguimiento de cotización"
        className="border-line-control bg-surface-root text-ink-primary mb-3 w-full rounded-[9px] border px-2 py-1.5 text-[12px]"
      />

      <label className="text-ink-secondary mb-1 block text-[11.5px]">Descripción (opcional)</label>
      <textarea
        value={descripcion}
        onChange={(e) => setDescripcion(e.target.value)}
        rows={2}
        className="border-line-control bg-surface-root text-ink-primary mb-3 w-full rounded-[9px] border px-2 py-1.5 text-[12px]"
      />

      <p className="text-ink-faint mb-3 text-[11px]">
        Nace apagado. No va a correr hasta que publiques una versión y lo prendas.
      </p>

      {error ? <p className="mb-2 text-[11.5px] text-red-600 dark:text-red-400">{error}</p> : null}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => setAbierto(false)}
          className="text-ink-faint text-[11.5px]"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={enviar}
          disabled={enviando || nombre.trim() === ""}
          className="rounded-[9px] bg-emerald-600 px-3 py-1.5 text-[11.5px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
        >
          {enviando ? "Creando…" : "Crear"}
        </button>
      </div>
    </div>
  );
}
