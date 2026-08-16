"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SwitchConsola } from "./SwitchConsola";
import type { ReglaEtiquetaConNombres } from "@/server/services/reglas/reglas-admin.service";
import type { ActionResult } from "@/types/inbox";

/**
 * Las reglas que cuelgan una etiqueta, en la consola del agente.
 *
 * Deliberadamente más pobre que `TablaReglas`: estas no tienen prioridad ni
 * respuesta, porque no compiten por el único lugar de la respuesta ni cortan el
 * LLM. Aplican todas las que matcheen y el turno sigue igual. Mostrar columnas
 * de prioridad acá sugeriría un orden que no existe.
 */
export function TablaReglasEtiqueta({
  filas,
  esAdmin,
  onToggle,
  onBorrar,
}: {
  filas: ReglaEtiquetaConNombres[];
  esAdmin: boolean;
  onToggle: (input: { id: string; valor: boolean }) => Promise<ActionResult>;
  onBorrar: (input: { id: string }) => Promise<ActionResult>;
}) {
  if (filas.length === 0) {
    return (
      <p className="text-ink-faint text-[11.5px]">
        Ninguna regla etiqueta sola todavía. Una acá le cuelga la etiqueta al lead sin contestarle
        nada: la conversación sigue con el agente como siempre.
      </p>
    );
  }

  return (
    <ul className="flex flex-col">
      {filas.map((f) => (
        <Fila key={f.regla.id} fila={f} esAdmin={esAdmin} onToggle={onToggle} onBorrar={onBorrar} />
      ))}
    </ul>
  );
}

function Fila({
  fila,
  esAdmin,
  onToggle,
  onBorrar,
}: {
  fila: ReglaEtiquetaConNombres;
  esAdmin: boolean;
  onToggle: (input: { id: string; valor: boolean }) => Promise<ActionResult>;
  onBorrar: (input: { id: string }) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [confirmando, setConfirmando] = useState(false);
  const [pendiente, iniciar] = useTransition();

  function borrar(): void {
    iniciar(async () => {
      const r = await onBorrar({ id: fila.regla.id });
      setConfirmando(false);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success("Regla de etiquetado borrada.");
      router.refresh();
    });
  }

  return (
    <li className="border-line-layout flex items-center gap-2.5 border-b py-2 last:border-0">
      <span className="text-ink-primary min-w-0 flex-1 truncate font-mono text-[11.5px]">
        {fila.intentNombre}
      </span>
      <span aria-hidden className="text-ink-ghost shrink-0 text-[11px]">
        →
      </span>
      <span
        className="shrink-0 truncate rounded-md border px-[7px] py-[2.5px] text-[10.5px] font-semibold"
        style={{ borderColor: fila.tagColor, color: fila.tagColor }}
      >
        {fila.tagNombre}
      </span>

      {esAdmin ? (
        confirmando ? (
          <span className="flex shrink-0 items-center gap-1.5">
            <Button size="sm" variant="destructive" onClick={borrar} disabled={pendiente}>
              {pendiente ? "Borrando…" : "Borrar"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setConfirmando(false)}
              disabled={pendiente}
            >
              No
            </Button>
          </span>
        ) : (
          <span className="flex shrink-0 items-center gap-1.5">
            <SwitchConsola
              activo={fila.regla.activa}
              etiqueta={`${fila.regla.activa ? "Desactivar" : "Activar"} la regla que etiqueta ${fila.tagNombre}`}
              disabled={pendiente}
              onChange={(valor) => {
                iniciar(async () => {
                  const r = await onToggle({ id: fila.regla.id, valor });
                  if (!r.ok) toast.error(r.error);
                  else router.refresh();
                });
              }}
            />
            <Button size="sm" variant="ghost" onClick={() => setConfirmando(true)}>
              Borrar
            </Button>
          </span>
        )
      ) : (
        <span className="text-ink-faint shrink-0 font-mono text-[10px]">
          {fila.regla.activa ? "activa" : "apagada"}
        </span>
      )}
    </li>
  );
}
