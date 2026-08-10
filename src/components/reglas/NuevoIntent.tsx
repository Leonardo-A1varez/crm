"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/types/inbox";

const CAMPO =
  "text-ink-body placeholder:text-ink-ghost border-line-input bg-surface-input w-full rounded-[9px] border px-2.5 py-[7px] text-[12px] outline-none";

export function NuevoIntent({
  onCrear,
}: {
  onCrear: (input: {
    nombre: string;
    descripcion: string;
    ejemplos: string[];
  }) => Promise<ActionResult>;
}) {
  const [abierto, setAbierto] = useState(false);
  const [nombre, setNombre] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [ejemplos, setEjemplos] = useState("");
  const [isPending, startTransition] = useTransition();

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="bg-brand text-brand-ink inline-flex items-center rounded-[9px] px-[11px] py-1.5 text-[11.5px] font-semibold"
      >
        Nuevo intent
      </button>
    );
  }

  const guardar = () => {
    startTransition(async () => {
      const r = await onCrear({
        nombre,
        descripcion,
        // Un ejemplo por línea: son las frases que el clasificador usa para
        // reconocer el intent, y separarlas por coma rompería las que la traen.
        ejemplos: ejemplos.split("\n"),
      });
      if (r.ok) {
        setNombre("");
        setDescripcion("");
        setEjemplos("");
        setAbierto(false);
        toast.success("Intent creado.");
      } else {
        toast.error(r.error);
      }
    });
  };

  return (
    <div className="border-line-card bg-surface-card flex flex-col gap-2 rounded-[12px] border p-3">
      <input
        value={nombre}
        onChange={(e) => setNombre(e.target.value)}
        placeholder="nombre_del_intent"
        aria-label="Nombre del intent"
        className={`${CAMPO} font-mono`}
      />
      <input
        value={descripcion}
        onChange={(e) => setDescripcion(e.target.value)}
        placeholder="Cuándo aplica"
        aria-label="Descripción"
        className={CAMPO}
      />
      <textarea
        value={ejemplos}
        onChange={(e) => setEjemplos(e.target.value)}
        placeholder={"Un ejemplo por línea\nhola\nbuenas, están?"}
        aria-label="Ejemplos"
        rows={3}
        className={`${CAMPO} resize-none`}
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={guardar}
          disabled={isPending || nombre.trim().length < 2}
          className="bg-brand text-brand-ink rounded-[9px] px-[11px] py-1.5 text-[11.5px] font-semibold disabled:opacity-50"
        >
          {isPending ? "Creando…" : "Crear"}
        </button>
        <button
          type="button"
          onClick={() => setAbierto(false)}
          className="text-ink-dim border-line-control rounded-[9px] border px-[11px] py-1.5 text-[11.5px] font-semibold"
        >
          Cancelar
        </button>
      </div>
      <p className="text-ink-ghost text-[10.5px]">
        Solo minúsculas, números y guion bajo: el nombre viaja al prompt del clasificador.
      </p>
    </div>
  );
}
