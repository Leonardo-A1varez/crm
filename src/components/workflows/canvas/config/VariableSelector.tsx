"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  LISTA_VARIABLES_DE_TEXTO,
  type VARIABLES_DE_TEXTO,
  type VariableDeTexto,
} from "@/lib/workflows/config-nodos";

export interface Variable {
  key: string;
  label: string;
  /** Lo que dice el chip dentro del texto: corto, porque va en medio de una frase. */
  corto: string;
  tipo: "string" | "number" | "date" | "boolean";
  ejemplo?: string;
}

/**
 * Cómo se presenta cada variable. Cuáles hay NO se decide acá: son las que el
 * motor carga (`VARIABLES_DE_TEXTO` en `lib/workflows/config-nodos.ts`).
 *
 * Una variable que el motor no carga no falla: sale como un hueco en el
 * mensaje ("Hola , tu  está lista"). Por eso el panel no puede ofrecerla, y
 * por eso esto es un `Record` y no una lista: una variable nueva del motor
 * sin su etiqueta acá no compila, y una que el motor no conoce tampoco.
 */
const PRESENTACION: Readonly<Record<VariableDeTexto, Omit<Variable, "key">>> = {
  "lead.nombre": {
    label: "Nombre del lead",
    corto: "nombre",
    tipo: "string",
    ejemplo: "Juan Perez",
  },
  "lead.telefono": {
    label: "Telefono",
    corto: "teléfono",
    tipo: "string",
    ejemplo: "+521234567890",
  },
  // El canal de origen tal como lo guarda el lead: "wa", "ig" o "fb".
  "lead.canal": { label: "Canal", corto: "canal", tipo: "string", ejemplo: "wa" },
  "lead.email": { label: "Email", corto: "email", tipo: "string", ejemplo: "juan@example.com" },
  // La etapa de la sesión activa: el lead no tiene etapa propia.
  "lead.etapa": { label: "Etapa actual", corto: "etapa", tipo: "string", ejemplo: "cotizado" },
  "sesion.current_stage": {
    label: "Etapa de la sesion",
    corto: "etapa de la sesión",
    tipo: "string",
    ejemplo: "cotizado",
  },
  // El vendedor asignado a la sesión. Vacío si no hay uno.
  "vendedor.nombre": {
    label: "Nombre del vendedor",
    corto: "vendedor",
    tipo: "string",
    ejemplo: "Maria Lopez",
  },
  "vendedor.email": {
    label: "Email del vendedor",
    corto: "email del vendedor",
    tipo: "string",
    ejemplo: "maria@empresa.com",
  },
};

export const VARIABLES_DISPONIBLES: Variable[] = LISTA_VARIABLES_DE_TEXTO.map((key) => ({
  key,
  ...PRESENTACION[key],
}));

interface VariableSelectorProps {
  onSelect: (variable: string) => void;
  filter?: string;
  compact?: boolean;
}

export function VariableSelector({ onSelect, filter, compact }: VariableSelectorProps) {
  const [busqueda, setBusqueda] = useState("");

  const variablesFiltradas = useMemo(() => {
    let variables = VARIABLES_DISPONIBLES;

    if (filter) {
      variables = variables.filter((v) => v.key.startsWith(filter));
    }

    if (busqueda) {
      const q = busqueda.toLowerCase();
      variables = variables.filter(
        (v) =>
          v.key.toLowerCase().includes(q) ||
          v.label.toLowerCase().includes(q) ||
          v.ejemplo?.toLowerCase().includes(q),
      );
    }

    return variables;
  }, [filter, busqueda]);

  const grouped = useMemo(() => {
    const groups: Record<string, Variable[]> = {};
    for (const v of variablesFiltradas) {
      const ns = v.key.split(".")[0]!;
      if (!groups[ns]) groups[ns] = [];
      groups[ns].push(v);
    }
    return groups;
  }, [variablesFiltradas]);

  const namespaceLabels: Record<string, string> = {
    lead: "Lead",
    sesion: "Sesion",
    vendedor: "Vendedor asignado",
  } satisfies Record<keyof typeof VARIABLES_DE_TEXTO, string>;

  if (compact) {
    return (
      <div className="border-line-control bg-surface-panel rounded-md border">
        <div className="border-line-layout border-b p-2">
          <Input
            placeholder="Buscar variable..."
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className="h-7 text-[11px]"
          />
        </div>
        <ScrollArea className="h-[180px]">
          <div className="p-1">
            {Object.entries(grouped).map(([ns, vars]) => (
              <div key={ns} className="mb-2">
                <div className="text-ink-faint px-2 py-1 text-[10px] tracking-wide uppercase">
                  {namespaceLabels[ns] ?? ns}
                </div>
                {vars.map((v) => (
                  <button
                    key={v.key}
                    type="button"
                    onClick={() => onSelect(`{{${v.key}}}`)}
                    className="hover:bg-surface-hover text-ink-primary flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-[11px]"
                  >
                    <code className="text-accent-blue font-mono">{`{{${v.key}}}`}</code>
                    <span className="text-ink-faint ml-2 truncate">{v.label}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </ScrollArea>
      </div>
    );
  }

  return (
    <div className="border-line-layout bg-surface-panel rounded-lg border">
      <div className="border-line-layout flex items-center justify-between border-b px-3 py-2">
        <span className="text-ink-secondary text-[11px] font-medium">Variables disponibles</span>
      </div>
      <div className="p-2">
        <Input
          placeholder="Buscar variable..."
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          className="mb-2 h-8 text-[12px]"
        />
      </div>
      <ScrollArea className="h-[200px]">
        <div className="px-2 pb-2">
          {Object.entries(grouped).map(([ns, vars]) => (
            <div key={ns} className="mb-3">
              <div className="text-ink-faint mb-1 px-1 text-[10px] tracking-wide uppercase">
                {namespaceLabels[ns] ?? ns}
              </div>
              <div className="space-y-0.5">
                {vars.map((v) => (
                  <button
                    key={v.key}
                    type="button"
                    onClick={() => onSelect(`{{${v.key}}}`)}
                    className="hover:bg-surface-hover group flex w-full items-center justify-between rounded px-2 py-1.5 text-left"
                  >
                    <div className="flex items-center gap-2">
                      <code className="text-accent-blue font-mono text-[11px]">{`{{${v.key}}}`}</code>
                    </div>
                    <span className="text-ink-faint group-hover:text-ink-secondary text-[11px]">
                      {v.label}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
          {variablesFiltradas.length === 0 && (
            <div className="text-ink-faint py-4 text-center text-[11px]">
              No se encontraron variables
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
