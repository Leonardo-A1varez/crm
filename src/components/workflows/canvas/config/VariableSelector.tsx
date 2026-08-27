"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";

export interface Variable {
  key: string;
  label: string;
  tipo: "string" | "number" | "date" | "boolean";
  ejemplo?: string;
}

export const VARIABLES_DISPONIBLES: Variable[] = [
  // Lead
  { key: "lead.nombre", label: "Nombre del lead", tipo: "string", ejemplo: "Juan Perez" },
  { key: "lead.telefono", label: "Telefono", tipo: "string", ejemplo: "+521234567890" },
  { key: "lead.email", label: "Email", tipo: "string", ejemplo: "juan@example.com" },
  { key: "lead.etapa", label: "Etapa actual", tipo: "string", ejemplo: "contacto" },
  { key: "lead.canal", label: "Canal", tipo: "string", ejemplo: "whatsapp" },
  { key: "lead.created_at", label: "Fecha de creacion", tipo: "date" },

  // Sesion
  { key: "sesion.auto_marca", label: "Marca del auto", tipo: "string", ejemplo: "Chevrolet" },
  { key: "sesion.auto_modelo", label: "Modelo del auto", tipo: "string", ejemplo: "Aveo" },
  { key: "sesion.auto_anio", label: "Anio del auto", tipo: "number", ejemplo: "2015" },
  {
    key: "sesion.current_stage",
    label: "Etapa de la sesion",
    tipo: "string",
    ejemplo: "cotizacion",
  },
  {
    key: "sesion.pieza_buscada",
    label: "Pieza buscada",
    tipo: "string",
    ejemplo: "Filtro de aceite",
  },
  { key: "sesion.cotizacion_total", label: "Total cotizado", tipo: "number", ejemplo: "1500" },

  // Vendedor
  { key: "vendedor.nombre", label: "Nombre del vendedor", tipo: "string", ejemplo: "Maria Lopez" },
  {
    key: "vendedor.email",
    label: "Email del vendedor",
    tipo: "string",
    ejemplo: "maria@empresa.com",
  },
  { key: "vendedor.telefono", label: "Telefono del vendedor", tipo: "string" },

  // Contexto (runtime)
  { key: "contexto.mensaje", label: "Ultimo mensaje", tipo: "string" },
  { key: "contexto.intent", label: "Intent detectado", tipo: "string", ejemplo: "buscar_repuesto" },
  { key: "contexto.fecha", label: "Fecha actual", tipo: "date" },
  { key: "contexto.hora", label: "Hora actual", tipo: "string" },
];

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
    vendedor: "Vendedor",
    contexto: "Contexto",
  };

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
