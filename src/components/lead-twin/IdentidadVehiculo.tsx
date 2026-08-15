"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Add } from "@/components/icons";
import { useCerrarAlSalir } from "@/hooks/use-cerrar-al-salir";
import { LARGO_MAX_CRUDO } from "@/lib/identificadores";
import type { EditarIdentidadVehiculoInput } from "@/lib/validation/leads.schema";
import type { LeadVehiculo, UUID } from "@/types/entities";
import type { ActionResult } from "@/types/inbox";

/**
 * El `+` de la tarjeta del auto: carga su placa y su VIN.
 *
 * Son los dos datos que identifican al auto y que el agente no puede deducir de
 * la conversación con la misma confianza que la marca — el cliente los dicta, y
 * casi siempre después de que ya se habló del modelo. Por eso van acá y no en
 * el alta: el auto ya existe, lo que falta es su identidad.
 *
 * Los dos campos juntos en un panel y no dos botones: quien tiene el papel del
 * auto adelante los lee de corrido, y hacerle abrir dos veces sería
 * interrumpirlo a la mitad.
 *
 * Vacío significa borrar. Es la única forma de sacar una placa mal cargada, y
 * por eso el panel arranca con lo que ya está escrito en vez de en blanco.
 */
export function IdentidadVehiculo({
  leadId,
  vehiculo,
  onGuardar,
}: {
  leadId: UUID;
  vehiculo: LeadVehiculo;
  onGuardar: (input: EditarIdentidadVehiculoInput) => Promise<ActionResult>;
}) {
  const [abierto, setAbierto] = useState(false);
  const [placa, setPlaca] = useState("");
  const [vin, setVin] = useState("");
  const [isPending, startTransition] = useTransition();
  const panel = useRef<HTMLDivElement>(null);

  const cerrar = useCallback(() => setAbierto(false), []);
  useCerrarAlSalir(abierto, panel, cerrar);

  function abrir() {
    // Precargado con lo que hay: se corrige sobre lo escrito, y vaciar el campo
    // es lo que borra el dato.
    setPlaca(vehiculo.placa_original ?? vehiculo.placa ?? "");
    setVin(vehiculo.vin_original ?? vehiculo.vin ?? "");
    setAbierto(true);
  }

  function guardar() {
    if (isPending) return;
    startTransition(async () => {
      const r = await onGuardar({
        leadId,
        vehiculoId: vehiculo.id,
        placa: placa.trim(),
        vin: vin.trim(),
      });
      if (r.ok) cerrar();
      else toast.error(r.error);
    });
  }

  const CAMPO =
    "text-ink-body border-line-input bg-surface-input w-full rounded-[7px] border px-2 py-1 text-[11.5px] outline-none";

  return (
    <>
      {abierto ? null : (
        <button
          type="button"
          onClick={abrir}
          aria-label="Cargar placa y VIN de este vehículo"
          title="Cargar placa y VIN"
          className="border-line-control bg-surface-card text-ink-dim hover:border-brand/50 hover:text-brand inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[7px] border border-dashed transition-colors"
        >
          <Add size={12} />
        </button>
      )}

      {abierto ? (
        <div
          ref={panel}
          className="border-line-control bg-surface-elevated absolute inset-x-3 z-20 flex flex-col gap-1.5 rounded-[10px] border p-2 shadow-lg"
        >
          <label className="text-ink-faint flex flex-col gap-1 text-[10px]">
            Placa o matrícula
            <input
              value={placa}
              autoFocus
              disabled={isPending}
              maxLength={LARGO_MAX_CRUDO}
              placeholder="AB-123-CD"
              onChange={(e) => setPlaca(e.target.value)}
              className={CAMPO}
            />
          </label>

          <label className="text-ink-faint flex flex-col gap-1 text-[10px]">
            VIN o chasis
            <input
              value={vin}
              disabled={isPending}
              maxLength={LARGO_MAX_CRUDO}
              placeholder="17 caracteres"
              onChange={(e) => setVin(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") guardar();
              }}
              className={CAMPO}
            />
          </label>

          <p className="text-ink-fainter text-[10px] leading-snug">
            Dejar un campo vacío borra ese dato.
          </p>

          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={guardar}
              disabled={isPending}
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
