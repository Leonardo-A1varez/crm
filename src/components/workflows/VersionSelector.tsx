"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { WorkflowVersion } from "@/types/entities";
import { VersionBadge, estadoDeVersion } from "./VersionBadge";

interface VersionSelectorProps {
  versiones: readonly WorkflowVersion[];
  versionActualId: string;
  onCambiar: (versionId: string) => void;
  disabled?: boolean;
}

/**
 * Dropdown para cambiar entre versiones de un workflow.
 *
 * Muestra el badge de estado junto al número de versión. La publicada se marca
 * con "activa" para distinguirla visualmente de las demás.
 */
export function VersionSelector({
  versiones,
  versionActualId,
  onCambiar,
  disabled,
}: VersionSelectorProps) {
  const versionActual = versiones.find((v) => v.id === versionActualId);

  if (versiones.length === 0) {
    return <div className="text-ink-faint text-[12px]">Sin versiones guardadas</div>;
  }

  const handleChange = (value: string | null) => {
    if (value) onCambiar(value);
  };

  return (
    <Select value={versionActualId} onValueChange={handleChange} disabled={disabled}>
      <SelectTrigger className="w-[180px]">
        <SelectValue>
          {versionActual ? (
            <div className="flex items-center gap-2">
              <VersionBadge estado={estadoDeVersion(versionActual.publicada)} />
              <span className="text-[12px] font-medium">v{versionActual.version}</span>
            </div>
          ) : (
            <span className="text-ink-faint">Seleccionar versión</span>
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {versiones.map((v) => (
          <SelectItem key={v.id} value={v.id}>
            <div className="flex items-center gap-2">
              <VersionBadge estado={estadoDeVersion(v.publicada)} />
              <span className="text-[12px] font-medium">v{v.version}</span>
              {v.publicada && (
                <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                  activa
                </span>
              )}
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
