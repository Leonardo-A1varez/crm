"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { ChannelIcons } from "@/components/inbox/ChannelIcons";
import { InitialsAvatar } from "@/components/shared/InitialsAvatar";
import { UpdateLeadProfileSchema } from "@/lib/validation/leads.schema";
import { canalesDelLead } from "@/lib/ui/canal";
import { formatearTelefono } from "@/lib/ui/telefono";
import type { ActionResult } from "@/types/inbox";
import type { Lead } from "@/types/entities";
import type { LeadTagView } from "@/types/leads";

function Campo({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex flex-col gap-[3px]">
      <span className="text-ink-faint text-[10.5px]">{label}</span>
      <span className="text-ink-secondary text-[12.5px]">{value?.trim() ? value : "—"}</span>
    </div>
  );
}

function Entrada({
  label,
  name,
  defaultValue,
  error,
  type = "text",
  maxLength,
}: {
  label: string;
  name: string;
  defaultValue: string;
  error?: string;
  type?: "text" | "email" | "number";
  maxLength?: number;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-ink-faint text-[10.5px] font-medium">{label}</span>
      <input
        name={name}
        type={type}
        defaultValue={defaultValue}
        maxLength={maxLength}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${name}-error` : undefined}
        className="border-line-control bg-surface-elevated text-ink-primary focus:border-brand h-9 rounded-[8px] border px-2.5 text-[12px] transition-colors outline-none"
      />
      {error ? (
        <span id={`${name}-error`} className="text-danger text-[10.5px]">
          {error}
        </span>
      ) : null}
    </label>
  );
}

export function LeadFicha({
  lead,
  tags,
  onUpdate,
}: {
  lead: Lead;
  tags: LeadTagView[];
  onUpdate: (formData: FormData) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [editando, setEditando] = useState(false);
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<string | null>(null);
  const vehiculo = [lead.vehiculo_marca, lead.vehiculo_modelo, lead.vehiculo_anio ?? ""]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .join(" ");
  const canales = canalesDelLead(lead);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const parsed = UpdateLeadProfileSchema.safeParse(formData);
    if (!parsed.success) {
      const fieldErrors = parsed.error.flatten().fieldErrors;
      setErrors(Object.fromEntries(Object.entries(fieldErrors).map(([k, v]) => [k, v?.[0] ?? ""])));
      return;
    }
    setErrors({});
    startTransition(async () => {
      const result = await onUpdate(formData);
      if (!result.ok) {
        setFeedback(result.error);
        return;
      }
      setFeedback("Cambios guardados.");
      setEditando(false);
      router.refresh();
    });
  }

  return (
    <section className="flex flex-col gap-4 px-5 py-[18px]">
      <div className="flex items-center gap-3">
        <InitialsAvatar nombre={lead.nombre} size={38} />
        <div className="min-w-0 flex-1">
          <h2 className="text-ink-primary truncate text-[18px] font-[680] tracking-[-0.02em]">
            {lead.nombre}
          </h2>
          <div className="mt-1">
            <ChannelIcons activos={canales} activoActual={lead.canal_origen} />
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            setEditando((value) => !value);
            setErrors({});
            setFeedback(null);
          }}
          className="border-line-control text-ink-secondary hover:bg-surface-hover rounded-[8px] border px-3 py-1.5 text-[11.5px] font-semibold"
        >
          {editando ? "Cancelar" : "Editar ficha"}
        </button>
      </div>

      {editando ? (
        <form onSubmit={submit} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <input type="hidden" name="leadId" value={lead.id} />
          <Entrada
            label="Nombre"
            name="nombre"
            defaultValue={lead.nombre}
            maxLength={120}
            error={errors.nombre}
          />
          <Entrada
            label="Email"
            name="email"
            type="email"
            defaultValue={lead.email ?? ""}
            maxLength={254}
            error={errors.email}
          />
          <Entrada
            label="Dirección"
            name="direccion"
            defaultValue={lead.direccion ?? ""}
            maxLength={300}
            error={errors.direccion}
          />
          <Entrada
            label="Marca"
            name="vehiculoMarca"
            defaultValue={lead.vehiculo_marca ?? ""}
            maxLength={100}
            error={errors.vehiculoMarca}
          />
          <Entrada
            label="Modelo"
            name="vehiculoModelo"
            defaultValue={lead.vehiculo_modelo ?? ""}
            maxLength={100}
            error={errors.vehiculoModelo}
          />
          <Entrada
            label="Año"
            name="vehiculoAnio"
            type="number"
            defaultValue={lead.vehiculo_anio?.toString() ?? ""}
            error={errors.vehiculoAnio}
          />
          <Entrada
            label="Motor"
            name="vehiculoMotor"
            defaultValue={lead.vehiculo_motor ?? ""}
            maxLength={100}
            error={errors.vehiculoMotor}
          />
          <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-2">
            <button
              type="submit"
              disabled={pending}
              className="bg-brand text-brand-ink rounded-[8px] px-3 py-2 text-[11.5px] font-semibold disabled:opacity-50"
            >
              {pending ? "Guardando…" : "Guardar cambios"}
            </button>
            <span className="text-ink-faint pb-2 text-[10.5px]">
              Teléfono e identificadores Meta son de solo lectura.
            </span>
          </div>
        </form>
      ) : (
        <div className="grid grid-cols-2 gap-x-6 gap-y-3.5 lg:grid-cols-3">
          <Campo label="Teléfono" value={formatearTelefono(lead.telefono)} />
          <Campo label="Email" value={lead.email} />
          <Campo label="Dirección" value={lead.direccion} />
          <Campo label="Vehículo" value={vehiculo || null} />
          <Campo label="Motor" value={lead.vehiculo_motor} />
        </div>
      )}
      {feedback ? (
        <p className="text-ink-secondary text-[11px]" role="status">
          {feedback}
        </p>
      ) : null}
      {tags.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {tags.map((tag) => (
            <span
              key={tag.id}
              className="inline-flex items-center rounded-md border px-[7px] py-[2.5px] text-[10px] font-semibold"
              style={{ borderColor: tag.color, color: tag.color }}
            >
              {tag.nombre}
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}
