"use client";

import { useState } from "react";
import { Add, Close } from "@/components/icons";
import { MAX_LARGO_PALABRA, MAX_PALABRAS, normalizarTexto } from "@/lib/agente/escalado";

/**
 * Los chips removibles del handoff §4.2 ("reclamo, abogado, devolución,
 * factura A, roto") más el "+ Agregar" punteado.
 *
 * Normaliza al agregar y no solo al guardar: el schema de la Server Action
 * vuelve a normalizar —esa es la garantía real—, pero si el chip mostrara
 * "Devolución" y lo guardado fuera "devolucion", el admin vería una lista y el
 * agente compararía otra.
 */
export function PalabrasEscalado({
  palabras,
  onChange,
  disabled,
}: {
  palabras: string[];
  onChange: (palabras: string[]) => void;
  disabled?: boolean;
}) {
  const [borrador, setBorrador] = useState("");

  const lleno = palabras.length >= MAX_PALABRAS;

  function agregar() {
    const nueva = normalizarTexto(borrador);
    // Vacía o repetida: se limpia el input igual. Rechazar en silencio sin
    // limpiar dejaría al admin apretando Enter contra una palabra que ya está.
    if (nueva !== "" && !palabras.includes(nueva) && !lleno) {
      onChange([...palabras, nueva]);
    }
    setBorrador("");
  }

  function quitar(palabra: string) {
    onChange(palabras.filter((p) => p !== palabra));
  }

  return (
    <div>
      <ul className="flex flex-wrap gap-1.5">
        {palabras.map((palabra) => (
          <li key={palabra}>
            <span className="border-line-control bg-surface-input text-ink-body inline-flex items-center gap-1 rounded-[7px] border py-[3px] pr-1 pl-2 text-[11px]">
              {palabra}
              <button
                type="button"
                onClick={() => quitar(palabra)}
                disabled={disabled}
                aria-label={`Quitar "${palabra}"`}
                className="text-ink-faint hover:text-danger transition-colors disabled:opacity-40"
              >
                <Close size={11} />
              </button>
            </span>
          </li>
        ))}

        {palabras.length === 0 ? (
          <li className="text-ink-ghost text-[10.5px]">
            Sin palabras: ninguna conversación escala por su texto.
          </li>
        ) : null}
      </ul>

      <div className="mt-2.5 flex items-center gap-2">
        <input
          type="text"
          value={borrador}
          onChange={(e) => setBorrador(e.target.value)}
          // Enter agrega sin enviar el formulario que envuelve a la consola.
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            agregar();
          }}
          maxLength={MAX_LARGO_PALABRA}
          disabled={disabled || lleno}
          placeholder="reclamo, abogado, factura a…"
          aria-label="Palabra o frase que escala"
          className="border-line-control text-ink-body placeholder:text-ink-ghost min-w-0 flex-1 rounded-[9px] border border-dashed bg-transparent px-2.5 py-1.5 text-[11.5px] disabled:opacity-50"
        />
        <button
          type="button"
          onClick={agregar}
          disabled={disabled || lleno || borrador.trim() === ""}
          className="border-line-control text-ink-dim hover:text-ink-primary flex shrink-0 items-center gap-1 rounded-[9px] border border-dashed px-2.5 py-1.5 text-[11px] transition-colors disabled:opacity-40"
        >
          <Add size={12} />
          Agregar
        </button>
      </div>

      <p className="text-ink-ghost mt-2 text-[10.5px]">
        Coinciden por palabra completa, sin distinguir mayúsculas ni tildes:{" "}
        <code className="font-mono">roto</code> no se dispara dentro de «rotonda».{" "}
        {lleno ? `Llegaste al máximo de ${MAX_PALABRAS}.` : `Hasta ${MAX_PALABRAS}.`}
      </p>
    </div>
  );
}
