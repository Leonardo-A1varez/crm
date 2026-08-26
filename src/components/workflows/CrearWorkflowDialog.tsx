"use client";

import { useRef, useState, useTransition } from "react";
import { useCerrarAlSalir } from "@/hooks/use-cerrar-al-salir";
import type { ActionResult } from "@/types/inbox";

const NOMBRE_MAX = 80;
const DESCRIPCION_MAX = 500;

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
  const dialogRef = useRef<HTMLDivElement>(null);

  const cerrar = () => {
    setAbierto(false);
    setError(null);
    setNombre("");
    setDescripcion("");
  };
  useCerrarAlSalir(abierto, dialogRef, cerrar);

  const enviar = () => {
    if (nombre.trim() === "" || enviando) return;
    setError(null);
    startEnviar(async () => {
      const r = await onCrear({
        nombre,
        descripcion: descripcion.trim() === "" ? null : descripcion,
      });
      if (r.ok) {
        cerrar();
      } else {
        setError(r.error);
      }
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="border-line-control text-ink-secondary hover:bg-surface-hover rounded-[9px] border px-[11px] py-1.5 text-[11.5px] font-semibold transition-colors"
      >
        Nuevo flujo
      </button>

      {abierto ? (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/20 p-4">
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="crear-workflow-titulo"
            className="border-line-layout bg-surface-panel w-full max-w-[380px] rounded-[12px] border p-4 shadow-xl"
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 id="crear-workflow-titulo" className="text-ink-primary text-[14px] font-[680]">
                Nuevo flujo
              </h2>
              <button
                type="button"
                onClick={cerrar}
                aria-label="Cerrar"
                className="text-ink-faint hover:text-ink-primary text-[16px] leading-none"
              >
                ✕
              </button>
            </div>

            <label
              htmlFor="crear-workflow-nombre"
              className="text-ink-secondary mb-1 block text-[11.5px]"
            >
              Nombre
            </label>
            <input
              id="crear-workflow-nombre"
              autoFocus
              value={nombre}
              onChange={(e) => setNombre(e.target.value.slice(0, NOMBRE_MAX))}
              onKeyDown={(e) => e.key === "Enter" && enviar()}
              placeholder="Seguimiento de cotización"
              className="border-line-control bg-surface-root text-ink-primary w-full rounded-[9px] border px-2 py-1.5 text-[12px]"
            />
            <p className="text-ink-faint mt-1 mb-3 text-right text-[10px]">
              {nombre.length}/{NOMBRE_MAX}
            </p>

            <label
              htmlFor="crear-workflow-descripcion"
              className="text-ink-secondary mb-1 block text-[11.5px]"
            >
              Descripción (opcional)
            </label>
            <textarea
              id="crear-workflow-descripcion"
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value.slice(0, DESCRIPCION_MAX))}
              rows={3}
              className="border-line-control bg-surface-root text-ink-primary w-full resize-none rounded-[9px] border px-2 py-1.5 text-[12px]"
            />
            <p className="text-ink-faint mt-1 mb-3 text-right text-[10px]">
              {descripcion.length}/{DESCRIPCION_MAX}
            </p>

            <p className="text-ink-faint mb-3 text-[11px]">
              Nace apagado. No va a correr hasta que publiques una versión y lo prendas.
            </p>

            {error ? (
              <p className="mb-2 text-[11.5px] text-red-600 dark:text-red-400">{error}</p>
            ) : null}

            <div className="flex justify-end gap-2">
              <button type="button" onClick={cerrar} className="text-ink-faint text-[11.5px]">
                Cancelar
              </button>
              <button
                type="button"
                onClick={enviar}
                disabled={enviando || nombre.trim() === ""}
                className="rounded-[9px] bg-emerald-600 px-3 py-1.5 text-[11.5px] font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-40"
              >
                {enviando ? "Creando…" : "Crear workflow →"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
