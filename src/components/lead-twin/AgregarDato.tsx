"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Add } from "@/components/icons";
import { useCerrarAlSalir } from "@/hooks/use-cerrar-al-salir";
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
 * Flota sobre la sección, abajo a la derecha: no entra en el flujo de la
 * columna de datos y por eso no reserva ninguna franja propia —una franja vacía
 * debajo del último dato fue justamente lo que hubo que sacar—. Tampoco vive
 * dentro del área con scroll: si viviera adentro habría que scrollear para
 * encontrar el botón que agrega la fila que va a hacer scrollear más.
 *
 * Exige que su contenedor sea `relative`; el formulario se abre anclado al
 * mismo borde, tapando los datos en vez de empujarlos.
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
  const panel = useRef<HTMLDivElement>(null);

  const esLibre = seleccion === OTRO;
  const puedeGuardar = valor.trim() !== "" && (!esLibre || clave.trim() !== "") && !isPending;

  const primerCampo = opciones[0]?.campo ?? OTRO;
  const cerrar = useCallback(() => {
    setAbierto(false);
    setSeleccion(primerCampo);
    setClave("");
    setValor("");
  }, [primerCampo]);

  // Cerrar al click afuera y con Escape. Mientras el formulario está abierto el
  // `+` no se dibuja, así que el panel es todo lo que cuenta como "adentro".
  useCerrarAlSalir(abierto, panel, cerrar);

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

  const pisado = opciones.find((o) => o.campo === seleccion)?.cargado ?? false;

  return (
    <>
      {abierto ? null : (
        <button
          type="button"
          onClick={() => setAbierto(true)}
          aria-label="Agregar un dato de contacto"
          title="Agregar un dato de contacto"
          className="border-line-control bg-surface-card text-ink-dim hover:border-brand/50 hover:text-brand absolute right-4 bottom-3 z-10 inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[8px] border border-dashed transition-colors"
        >
          <Add size={14} />
        </button>
      )}

      {abierto ? (
        <div
          ref={panel}
          className="border-line-control bg-surface-elevated absolute inset-x-3 bottom-3 z-20 flex flex-col gap-1.5 rounded-[10px] border p-2 shadow-lg"
        >
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
      ) : null}
    </>
  );
}
