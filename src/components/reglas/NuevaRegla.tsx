"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import type { RespuestaTipo } from "@/types/domain";
import type { UUID } from "@/types/entities";
import type { ActionResult } from "@/types/inbox";

const CAMPO =
  "text-ink-body placeholder:text-ink-ghost border-line-input bg-surface-input w-full rounded-[9px] border px-2.5 py-[7px] text-[12px] outline-none";

export function NuevaRegla({
  intents,
  onCrear,
}: {
  intents: { id: UUID; nombre: string }[];
  onCrear: (input: {
    intentId: UUID;
    respuestaTipo: RespuestaTipo;
    respuestaContenido: string;
    prioridad: number;
  }) => Promise<ActionResult>;
}) {
  const [abierto, setAbierto] = useState(false);
  const [intentId, setIntentId] = useState(intents[0]?.id ?? "");
  const [tipo, setTipo] = useState<RespuestaTipo>("text");
  const [contenido, setContenido] = useState("");
  const [prioridad, setPrioridad] = useState("0");
  const [isPending, startTransition] = useTransition();

  if (intents.length === 0) {
    return (
      <p className="text-ink-faint text-[11.5px]">
        Primero creá un intent: una regla cuelga de uno.
      </p>
    );
  }

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="bg-brand text-brand-ink inline-flex items-center rounded-[9px] px-[11px] py-1.5 text-[11.5px] font-semibold"
      >
        Nueva regla
      </button>
    );
  }

  const guardar = () => {
    startTransition(async () => {
      const r = await onCrear({
        intentId,
        respuestaTipo: tipo,
        // `handoff` no manda texto al cliente: el contenido queda como el
        // motivo que ve el vendedor, por eso igual se pide algo escrito.
        respuestaContenido: contenido,
        prioridad: Number(prioridad) || 0,
      });
      if (r.ok) {
        setContenido("");
        setAbierto(false);
        toast.success("Regla creada.");
      } else {
        toast.error(r.error);
      }
    });
  };

  return (
    <div className="border-line-card bg-surface-card flex flex-col gap-2 rounded-[12px] border p-3">
      <select
        value={intentId}
        onChange={(e) => setIntentId(e.target.value)}
        aria-label="Intent"
        className={CAMPO}
      >
        {intents.map((i) => (
          <option key={i.id} value={i.id}>
            {i.nombre}
          </option>
        ))}
      </select>
      <div className="flex gap-2">
        <select
          value={tipo}
          onChange={(e) => setTipo(e.target.value as RespuestaTipo)}
          aria-label="Tipo de respuesta"
          className={CAMPO}
        >
          <option value="text">Texto fijo</option>
          <option value="template">Plantilla</option>
          <option value="handoff">Escalar a un humano</option>
        </select>
        <input
          value={prioridad}
          onChange={(e) => setPrioridad(e.target.value)}
          inputMode="numeric"
          aria-label="Prioridad"
          placeholder="Prioridad"
          className={`${CAMPO} max-w-[110px] font-mono`}
        />
      </div>
      <textarea
        value={contenido}
        onChange={(e) => setContenido(e.target.value)}
        placeholder={
          tipo === "handoff" ? "Motivo del escalado" : "Lo que se le responde al cliente"
        }
        aria-label="Respuesta"
        rows={3}
        className={`${CAMPO} resize-none`}
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={guardar}
          disabled={isPending || contenido.trim().length === 0}
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
        A mayor prioridad, primero. Con dos reglas de la misma prioridad gana la más vieja.
      </p>
    </div>
  );
}
