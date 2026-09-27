"use client";

import { useCallback, useMemo } from "react";
import { ConstructorCondiciones } from "@/components/shared/condiciones";
import { ConfigDelegar } from "@/components/workflows/canvas/config";
import { arbolDeConfig } from "@/lib/workflows/condiciones.schema";
import { editorDeConfig } from "@/lib/workflows/config-nodos";
import { camposDeCondicion } from "../_lib/campos-condicion";
import { useCatalogosCondicion } from "./use-datos-condicion";

import type { Grupo } from "@/lib/ui/condiciones";

/**
 * El formulario de "Delegar al agente" en el panel del editor: el de
 * `canvas/config/ConfigDelegar` con la condición del Twin armada con el mismo
 * constructor de cajas que «Condición». Vive acá y no en `components/` porque
 * los campos de la condición salen de los catálogos de esta página.
 *
 * «Respondió» no se ofrece: depende de lo que dispara el flujo, no de la
 * conversación que el agente tiene durante el tramo.
 */
export function FormularioDelegar({
  config,
  onChange,
  intents,
  readonly = false,
}: {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  intents: ReadonlyArray<{ id: string; nombre: string }>;
  readonly?: boolean;
}) {
  const catalogos = useCatalogosCondicion();
  const campos = useMemo(
    () => camposDeCondicion(catalogos ?? undefined).filter((c) => c.id !== "sesion.respondio"),
    [catalogos],
  );
  const condicion = editorDeConfig("ia_delegar", config).valores.condicionTwin;
  const arbol = useMemo(
    () => (condicion === undefined ? null : arbolDeConfig(condicion)),
    [condicion],
  );
  const cambiar = useCallback(
    (g: Grupo) => onChange(editorDeConfig("ia_delegar", config).con("condicionTwin", { arbol: g })),
    [config, onChange],
  );

  return (
    <ConfigDelegar
      config={config}
      onChange={onChange}
      intents={intents}
      readonly={readonly}
      condicionTwin={
        arbol ? (
          <fieldset disabled={readonly} className="m-0 min-w-0 border-0 p-0">
            <ConstructorCondiciones grupo={arbol} campos={campos} onCambiar={cambiar} />
          </fieldset>
        ) : null
      }
    />
  );
}
