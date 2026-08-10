"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Add } from "@/components/icons";
import { MAX_LARGO_CLAVE, MAX_LARGO_VALOR } from "@/lib/datos-extra";
import type { AgregarDatoLeadInput, CampoContactoLead } from "@/lib/validation/inbox.schema";
import type { UUID } from "@/types/entities";
import type { ActionResult } from "@/types/inbox";

/** Columna de `leads` que el formulario ofrece, con el rótulo que se ve. */
interface OpcionCampo {
  campo: CampoContactoLead;
  label: string;
  /** `true` cuando la columna ya tiene valor: se avisa que se va a pisar. */
  cargado: boolean;
}

/** Valor del `<select>` que abre los dos inputs de campo libre. */
const OTRO = "__otro__";

/**
 * El `+` de la ficha de contacto: carga un dato en un campo que existe o
 * inventa uno nuevo.
 *
 * Un solo control con un `<select>` y no dos botones separados porque para
 * quien lo usa es la misma intención —"falta un dato, lo agrego"— y el nombre
 * del campo es lo primero que tiene en la cabeza. "Otro…" al final de la lista
 * es la puerta al campo libre, y aparece recién cuando ninguna de las opciones
 * sirve.
 *
 * Queda fuera del área con scroll de la sección a propósito: si viviera adentro
 * habría que scrollear para encontrar el botón que agrega la fila que va a
 * hacer scrollear más.
 */
export function AgregarDato({
  leadId,
  opciones,
  onAgregar,
}: {
  leadId: UUID;
  opciones: OpcionCampo[];
  onAgregar: (input: AgregarDatoLeadInput) => Promise<ActionResult>;
}) {
  const [abierto, setAbierto] = useState(false);
  const [seleccion, setSeleccion] = useState<string>(opciones[0]?.campo ?? OTRO);
  const [clave, setClave] = useState("");
  const [valor, setValor] = useState("");
  const [isPending, startTransition] = useTransition();

  const esLibre = seleccion === OTRO;
  const puedeGuardar = valor.trim() !== "" && (!esLibre || clave.trim() !== "") && !isPending;

  const cerrar = () => {
    setAbierto(false);
    setSeleccion(opciones[0]?.campo ?? OTRO);
    setClave("");
    setValor("");
  };

  const guardar = () => {
    if (!puedeGuardar) return;
    const input: AgregarDatoLeadInput = esLibre
      ? { tipo: "libre", leadId, clave: clave.trim(), valor: valor.trim() }
      : { tipo: "campo", leadId, campo: seleccion as CampoContactoLead, valor: valor.trim() };

    startTransition(async () => {
      const r = await onAgregar(input);
      if (r.ok) {
        cerrar();
      } else {
        toast.error(r.error);
      }
    });
  };

  if (!abierto) {
    return (
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setAbierto(true)}
          aria-label="Agregar un dato de contacto"
          title="Agregar un dato de contacto"
          className="border-line-control text-ink-dim hover:border-brand/50 hover:text-brand inline-flex h-[26px] w-[26px] items-center justify-center rounded-[8px] border border-dashed transition-colors"
        >
          <Add size={14} />
        </button>
      </div>
    );
  }

  const pisado = opciones.find((o) => o.campo === seleccion)?.cargado ?? false;

  return (
    <div className="border-line-control bg-surface-elevated flex flex-col gap-1.5 rounded-[10px] border p-2">
      <select
        value={seleccion}
        disabled={isPending}
        aria-label="Qué dato agregar"
        onChange={(e) => setSeleccion(e.target.value)}
        className="text-ink-body border-line-input bg-surface-input w-full rounded-[7px] border px-2 py-1 text-[11.5px] outline-none"
      >
        {opciones.map((o) => (
          <option key={o.campo} value={o.campo}>
            {o.label}
          </option>
        ))}
        <option value={OTRO}>Otro…</option>
      </select>

      {esLibre ? (
        <input
          value={clave}
          autoFocus
          disabled={isPending}
          maxLength={MAX_LARGO_CLAVE}
          aria-label="Nombre del dato"
          placeholder="Nombre del dato (ej. Cumpleaños)"
          onChange={(e) => setClave(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") cerrar();
          }}
          className="text-ink-body border-line-input bg-surface-input w-full rounded-[7px] border px-2 py-1 text-[11.5px] outline-none"
        />
      ) : null}

      <input
        value={valor}
        autoFocus={!esLibre}
        disabled={isPending}
        maxLength={MAX_LARGO_VALOR}
        aria-label="Valor del dato"
        placeholder="Valor"
        onChange={(e) => setValor(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") guardar();
          if (e.key === "Escape") cerrar();
        }}
        className="text-ink-body border-line-input bg-surface-input w-full rounded-[7px] border px-2 py-1 text-[11.5px] outline-none"
      />

      {pisado ? (
        <p className="text-ink-fainter text-[10px] leading-snug">
          Ese campo ya tiene un valor: se reemplaza.
        </p>
      ) : null}

      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={guardar}
          disabled={!puedeGuardar}
          className="bg-brand text-brand-ink rounded-[7px] px-2 py-[3px] text-[10.5px] font-semibold disabled:opacity-50"
        >
          {isPending ? "Guardando…" : "Guardar"}
        </button>
        <button
          type="button"
          onClick={cerrar}
          disabled={isPending}
          className="text-ink-dim border-line-control rounded-[7px] border px-2 py-[3px] text-[10.5px] font-semibold"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
