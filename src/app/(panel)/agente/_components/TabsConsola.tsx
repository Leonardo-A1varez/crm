"use client";

import { AccountTree, PanTool, Psychology, Speed } from "@/components/icons";
import { cn } from "@/lib/utils";
import type { TabAgente } from "./tabs";
import type { ComponentType } from "react";

interface DefTab {
  id: TabAgente;
  label: string;
  /** Aclaración a la derecha de la barra: qué configura la pestaña activa. */
  aclaracion: string;
  Icon: ComponentType<{ className?: string; size?: number; strokeWidth?: number }>;
}

const DEFS: readonly DefTab[] = [
  {
    id: "reglas",
    label: "Reglas IF/THEN",
    aclaracion: "se ejecutan antes del LLM — sin costo de tokens",
    Icon: AccountTree,
  },
  {
    id: "escalado",
    label: "Escalado",
    aclaracion: "cuándo la conversación pasa a un humano",
    Icon: PanTool,
  },
  {
    id: "comporta",
    label: "Comportamiento",
    aclaracion: "solo afecta lo que genera el LLM",
    Icon: Psychology,
  },
  {
    id: "limites",
    label: "Límites y costo",
    aclaracion: "modelo, tope de gasto y horario",
    Icon: Speed,
  },
];

/** Mismo patrón que Métricas (§3): borde inferior de 2px en la activa. */
export function TabsConsola({
  activa,
  onChange,
}: {
  activa: TabAgente;
  onChange: (t: TabAgente) => void;
}) {
  const def = DEFS.find((d) => d.id === activa);

  return (
    <div className="border-line-layout flex items-center justify-between gap-4 border-b">
      <div role="tablist" aria-label="Secciones del agente" className="flex items-end gap-1">
        {DEFS.map(({ id, label, Icon }) => {
          const act = id === activa;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={act}
              onClick={() => onChange(id)}
              className={cn(
                "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-[12.5px] font-semibold transition-colors",
                act
                  ? "border-brand text-ink-primary"
                  : "text-ink-dim hover:text-ink-primary border-transparent",
              )}
            >
              <Icon size={16} strokeWidth={1.5} className="shrink-0" />
              {label}
            </button>
          );
        })}
      </div>
      {def ? (
        <span className="text-ink-faint hidden shrink-0 pb-2 text-[10.5px] lg:block">
          {def.aclaracion}
        </span>
      ) : null}
    </div>
  );
}
