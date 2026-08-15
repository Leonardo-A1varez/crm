"use client";

import { useCallback, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Add } from "@/components/icons";
import { useCerrarAlSalir } from "@/hooks/use-cerrar-al-salir";
import { LARGO_MAX_CRUDO } from "@/lib/identificadores";
import type { AgregarVehiculoFormInput } from "@/lib/validation/leads.schema";
import type { UUID } from "@/types/entities";
import type { ActionResult } from "@/types/inbox";

/**
 * El `+` de la sección Vehículo: agrega otro auto al lead.
 *
 * Existe porque una persona tiene más de un auto y un taller tiene una flota:
 * hasta que hubo tabla propia entraba uno solo, y el segundo se perdía o pisaba
 * al primero.
 *
 * Ningún campo es obligatorio salvo que haya al menos uno. El vendedor a veces
 * carga primero la placa —que es lo que el cliente dicta por teléfono— y
 * completa marca y modelo cuando ve el auto; exigirle los seis lo obligaría a
 * inventar para poder guardar el único que sabe.
 *
 * Mismo gesto que el `+` de contacto: flota sobre la sección, se abre anclado
 * al mismo borde y se cierra con Escape o clickeando afuera.
 */
export function AgregarVehiculo({
  leadId,
  onAgregar,
}: {
  leadId: UUID;
  onAgregar: (input: AgregarVehiculoFormInput) => Promise<ActionResult>;
}) {
  const [abierto, setAbierto] = useState(false);
  const [marca, setMarca] = useState("");
  const [modelo, setModelo] = useState("");
  const [anio, setAnio] = useState("");
  const [motor, setMotor] = useState("");
  const [placa, setPlaca] = useState("");
  const [vin, setVin] = useState("");
  const [isPending, startTransition] = useTransition();
  const panel = useRef<HTMLDivElement>(null);

  const cerrar = useCallback(() => {
    setAbierto(false);
    setMarca("");
    setModelo("");
    setAnio("");
    setMotor("");
    setPlaca("");
    setVin("");
  }, []);

  useCerrarAlSalir(abierto, panel, cerrar);

  const hayAlgo = [marca, modelo, anio, motor, placa, vin].some((v) => v.trim() !== "");

  function guardar() {
    if (isPending || !hayAlgo) return;
    startTransition(async () => {
      const r = await onAgregar({
        leadId,
        // Se manda solo lo que se escribió: una cadena vacía en `anio` no es un
        // año y el schema la rechazaría por no ser número.
        marca: marca.trim() || undefined,
        modelo: modelo.trim() || undefined,
        anio: anio.trim() || undefined,
        motor: motor.trim() || undefined,
        placa: placa.trim() || undefined,
        vin: vin.trim() || undefined,
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
          onClick={() => setAbierto(true)}
          aria-label="Agregar otro vehículo"
          title="Agregar otro vehículo"
          className="border-line-control bg-surface-card text-ink-dim hover:border-brand/50 hover:text-brand inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[8px] border border-dashed transition-colors"
        >
          <Add size={14} />
        </button>
      )}

      {abierto ? (
        <div
          ref={panel}
          className="border-line-control bg-surface-elevated absolute inset-x-3 z-20 flex flex-col gap-1.5 rounded-[10px] border p-2 shadow-lg"
        >
          <div className="grid grid-cols-2 gap-1.5">
            <input
              value={marca}
              autoFocus
              disabled={isPending}
              maxLength={60}
              aria-label="Marca"
              placeholder="Marca"
              onChange={(e) => setMarca(e.target.value)}
              className={CAMPO}
            />
            <input
              value={modelo}
              disabled={isPending}
              maxLength={60}
              aria-label="Modelo"
              placeholder="Modelo"
              onChange={(e) => setModelo(e.target.value)}
              className={CAMPO}
            />
            <input
              value={anio}
              disabled={isPending}
              inputMode="numeric"
              maxLength={4}
              aria-label="Año"
              placeholder="Año"
              onChange={(e) => setAnio(e.target.value)}
              className={CAMPO}
            />
            <input
              value={motor}
              disabled={isPending}
              maxLength={60}
              aria-label="Motor"
              placeholder="Motor"
              onChange={(e) => setMotor(e.target.value)}
              className={CAMPO}
            />
          </div>

          <input
            value={placa}
            disabled={isPending}
            maxLength={LARGO_MAX_CRUDO}
            aria-label="Placa o matrícula"
            placeholder="Placa o matrícula"
            onChange={(e) => setPlaca(e.target.value)}
            className={CAMPO}
          />
          <input
            value={vin}
            disabled={isPending}
            maxLength={LARGO_MAX_CRUDO}
            aria-label="VIN o chasis"
            placeholder="VIN o chasis"
            onChange={(e) => setVin(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") guardar();
            }}
            className={CAMPO}
          />

          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={guardar}
              disabled={isPending || !hayAlgo}
              className="bg-brand text-brand-ink rounded-[7px] px-2 py-[3px] text-[10.5px] font-semibold disabled:opacity-50"
            >
              {isPending ? "Guardando…" : "Agregar"}
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
