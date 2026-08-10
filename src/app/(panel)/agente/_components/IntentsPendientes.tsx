"use client";

import { useState } from "react";
import { NuevaRegla } from "@/components/reglas/NuevaRegla";
import { MonoMeta } from "@/components/shared/MonoMeta";
import type { RespuestaTipo } from "@/types/domain";
import type { Intent, UUID } from "@/types/entities";
import type { ActionResult } from "@/types/inbox";

interface CrearReglaInput {
  intentId: UUID;
  respuestaTipo: RespuestaTipo;
  respuestaContenido: string;
  prioridad: number;
}

/**
 * Tarjeta ámbar de §4.1. "Pendiente de aprobación" no es un estado inventado:
 * el cron semanal `detect-intents.batch` (domingos 03:00) inserta los intents
 * que detecta con `auto_detectado: true, activo: false`, y esa combinación es
 * exactamente la cola de aprobación.
 *
 * Lo que el handoff pide y no se puede mostrar:
 *
 * - "96 veces esta semana · $0,38/día en LLM · confianza 0,93": ni el conteo
 *   de ocurrencias ni el costo por intent ni la confianza del detector se
 *   guardan. El detector devuelve nombre, descripción y ejemplos, nada más.
 * - "Ignorar": `intents` no tiene estado `descartado`. Un intent que no se
 *   aprueba queda pendiente para siempre, así que el botón no puede hacer
 *   nada que sobreviva a un refresh.
 */
export function IntentsPendientes({
  intents,
  onCrearRegla,
}: {
  intents: Intent[];
  onCrearRegla: (input: CrearReglaInput) => Promise<ActionResult>;
}) {
  const [creandoPara, setCreandoPara] = useState<UUID | null>(null);

  return (
    <section
      className="border-brand/30 rounded-[15px] border p-[17px]"
      // Gradiente de la tarjeta destacada del
      // handoff (§3.2, reusado por §4.1) y no tiene token en globals.css.
      style={{
        background: "linear-gradient(160deg,var(--color-surface-glow),var(--color-surface-card))",
      }}
    >
      <h2 className="text-ink-primary text-[13px] font-[650] tracking-[-0.015em]">
        {intents.length} {intents.length === 1 ? "intent espera" : "intents esperan"} tu aprobación
      </h2>
      <p className="text-ink-faint mt-1 mb-3 text-[10.5px]">
        detectados por el cron semanal — hasta que tengan regla, cada uno se responde con LLM
      </p>

      <ul className="flex flex-col gap-2.5">
        {intents.map((i) => (
          <li key={i.id} className="border-line-card bg-surface-card rounded-[12px] border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <span className="text-ink-primary text-[12px] font-semibold">
                  &ldquo;{i.nombre}&rdquo;
                </span>
                <MonoMeta className="mt-0.5 block text-[9.5px]">
                  {i.ejemplos.length} ejemplos · usos, costo y confianza: sin registrar
                </MonoMeta>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => setCreandoPara(creandoPara === i.id ? null : i.id)}
                  className="bg-brand text-brand-ink rounded-[9px] px-[11px] py-1.5 text-[11.5px] font-semibold"
                >
                  {creandoPara === i.id ? "Cancelar" : "Crear regla"}
                </button>
                <button
                  type="button"
                  disabled
                  title="No se puede: `intents` no tiene un estado descartado. Un intent sin aprobar queda pendiente, y volver a marcarlo no cambia nada en la base."
                  className="text-ink-dim border-line-control rounded-[9px] border px-[11px] py-1.5 text-[11.5px] font-semibold disabled:cursor-not-allowed disabled:opacity-45"
                >
                  Ignorar
                </button>
              </div>
            </div>

            {i.descripcion ? (
              <p className="text-ink-dim mt-1.5 text-[11px]">{i.descripcion}</p>
            ) : null}

            {creandoPara === i.id ? (
              <div className="mt-3">
                <NuevaRegla intents={[{ id: i.id, nombre: i.nombre }]} onCrear={onCrearRegla} />
                <p className="text-ink-ghost mt-2 text-[10.5px]">
                  Al crear la regla, el intent queda aprobado y activo: una regla sobre un intent
                  apagado no se ejecuta nunca.
                </p>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
