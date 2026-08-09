"use client";

import { useTransition } from "react";
import { AltRoute, TaskAlt } from "@/components/icons";
import { Eyebrow } from "@/components/shared/Eyebrow";
import { MonoMeta } from "@/components/shared/MonoMeta";
import { RelativeTime } from "@/components/shared/RelativeTime";
import type { AgenteConfig } from "@/types/agente";

export function HistorialVersiones({
  versiones,
  onRestaurar,
  puedeRestaurar,
}: {
  versiones: AgenteConfig[];
  onRestaurar: (configId: string) => Promise<void>;
  puedeRestaurar: boolean;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <section className="bg-surface-card border-line-card rounded-[15px] border p-[17px]">
      <Eyebrow>Historial de versiones</Eyebrow>
      <p className="text-ink-faint mt-1 mb-3 text-[10.5px]">
        Restaurar crea una versión nueva con esos valores — nunca revive la fila vieja.
      </p>
      <ul className="flex flex-col gap-2">
        {versiones.map((v) => (
          <li
            key={v.id}
            className="border-line-card flex items-center gap-2.5 rounded-[10px] border px-2.5 py-2"
          >
            <MonoMeta className="text-ink-primary text-[11px] font-semibold">v{v.version}</MonoMeta>
            {v.activa ? (
              <span className="bg-brand/15 text-brand flex items-center gap-1 rounded-full px-1.5 py-px text-[9.5px] font-semibold">
                <TaskAlt size={10} /> Activa
              </span>
            ) : null}
            {v.rollback_de ? (
              <span
                className="text-ink-ghost flex items-center gap-1 text-[9.5px]"
                title="Rollback"
              >
                <AltRoute size={10} />
              </span>
            ) : null}
            <span className="text-ink-faint flex-1 truncate text-[10.5px]">{v.nota ?? "—"}</span>
            <MonoMeta>
              <RelativeTime iso={v.created_at} />
            </MonoMeta>
            {puedeRestaurar && !v.activa ? (
              <button
                type="button"
                disabled={isPending}
                onClick={() => startTransition(async () => onRestaurar(v.id))}
                className="text-ink-dim hover:text-ink-primary shrink-0 text-[10.5px] underline disabled:opacity-50"
              >
                Restaurar
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
