"use client";

import { useState } from "react";
import { AutoAwesome } from "@/components/icons";
import { Eyebrow } from "@/components/shared/Eyebrow";
import { MonoMeta } from "@/components/shared/MonoMeta";
import type { AgenteConfigValores } from "@/types/agente";

/**
 * Sin `disabled`: previsualizar es de solo lectura (no persiste nada, no le
 * escribe nada al cliente) y el server la protege igual (`previsualizarAction`
 * exige admin). Dejarla habilitada para cualquier rol es justamente lo que le
 * permite a un vendedor comprobar en carne propia que el permiso se aplica.
 */
export function PanelPreview({
  valores,
  sesiones,
  onPrevisualizar,
  resultado,
  cargando,
}: {
  valores: AgenteConfigValores;
  sesiones: { id: string; etiqueta: string }[];
  onPrevisualizar: (leadSessionId: string) => Promise<void>;
  resultado: { respuesta: string; respuestaOriginal: string | null } | null;
  cargando: boolean;
}) {
  const [sesionId, setSesionId] = useState(sesiones[0]?.id ?? "");

  return (
    <section className="bg-surface-card border-line-card rounded-[15px] border p-[17px]">
      <div className="flex items-center gap-2">
        <AutoAwesome className="text-brand" size={15} />
        <Eyebrow>Previsualizar</Eyebrow>
      </div>
      <p className="text-ink-faint mt-1 mb-1 text-[10.5px]">
        Corre la config de arriba —todavía sin guardar— contra el historial real de una sesión. No
        guarda nada ni le envía nada al cliente.
      </p>
      <MonoMeta className="mb-3 block">
        candidata: {valores.modelo} · tono {valores.tono} · largo {valores.largo}
      </MonoMeta>

      {sesiones.length === 0 ? (
        <p className="text-ink-ghost text-[10.5px] italic">No hay sesiones disponibles.</p>
      ) : (
        <div className="flex items-center gap-2">
          <select
            value={sesionId}
            onChange={(e) => setSesionId(e.target.value)}
            className="bg-surface-input border-line-input text-ink-body flex-1 rounded-[10px] border p-2 text-[11.5px]"
          >
            {sesiones.map((s) => (
              <option key={s.id} value={s.id}>
                {s.etiqueta}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={cargando || sesionId === ""}
            onClick={() => void onPrevisualizar(sesionId)}
            className="bg-brand text-brand-ink rounded-[9px] px-3 py-2 text-[11.5px] font-semibold disabled:opacity-50"
          >
            {cargando ? "Generando…" : "Previsualizar"}
          </button>
        </div>
      )}

      {resultado ? (
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div>
            <MonoMeta className="uppercase">Respuesta actual</MonoMeta>
            <p className="bg-surface-elevated border-line-card text-ink-secondary mt-1.5 max-h-56 overflow-auto rounded-[10px] border p-2.5 text-[11px] whitespace-pre-wrap">
              {resultado.respuestaOriginal ?? "Sin respuesta de la IA registrada en esta sesión."}
            </p>
          </div>
          <div>
            <MonoMeta className="uppercase">Con esta config</MonoMeta>
            <p className="bg-surface-elevated border-line-card text-ink-secondary mt-1.5 max-h-56 overflow-auto rounded-[10px] border p-2.5 text-[11px] whitespace-pre-wrap">
              {resultado.respuesta}
            </p>
          </div>
        </div>
      ) : null}
    </section>
  );
}
