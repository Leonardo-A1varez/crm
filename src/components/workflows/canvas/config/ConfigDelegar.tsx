"use client";

import { useId, type ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { SelectOpciones } from "@/components/shared/SelectOpciones";
import { Textarea } from "@/components/ui/textarea";
import { arbolDeConfig } from "@/lib/workflows/condiciones.schema";
import { MAX_INSTRUCCIONES_TRAMO, editorDeConfig } from "@/lib/workflows/config-nodos";
import { cn } from "@/lib/utils";

interface ConfigDelegarProps {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  intents: ReadonlyArray<{ id: string; nombre: string }>;
  /**
   * El constructor de la condición del Twin. Lo arma el editor (necesita los
   * catálogos de campos de la página); este formulario sólo lo ubica.
   */
  condicionTwin?: ReactNode;
  readonly?: boolean;
}

const UNIDADES = { minutos: "minutos", horas: "horas", dias: "días" } as const;

/**
 * "Delegar al agente" (PRD §4.5): instrucciones del tramo, cuándo vuelve,
 * tiempo máximo obligatorio y topes. Las cinco salidas y a dónde va cada una
 * las muestra «Después de esto», debajo del formulario, como en todo bloque.
 *
 * Qué clave escribe cada campo sale del contrato de config (`editorDeConfig`):
 * el mismo schema que revisa el validador y lee la acción.
 */
export function ConfigDelegar({
  config,
  onChange,
  intents,
  condicionTwin,
  readonly,
}: ConfigDelegarProps) {
  const c = editorDeConfig("ia_delegar", config);
  const ids = useId();
  const labelClass = "text-ink-secondary mb-1.5 block text-[11px] font-semibold";
  const inputClass = "border-line-control bg-surface-root text-ink-primary h-8 text-[12px]";
  const selectClass = "border-line-control bg-surface-root text-ink-primary text-[12px]";

  const instrucciones = String(c.valores.instrucciones ?? "");
  const intentId = typeof c.valores.intentId === "string" ? c.valores.intentId : "";
  // "" = marcado y sin elegir todavía; ausente = desmarcado.
  const conIntent = typeof c.valores.intentId === "string";
  const conTwin = c.valores.condicionTwin !== undefined;
  const timeout = c.valores.timeout;
  const timeoutValido = typeof timeout === "number" && timeout > 0;

  return (
    <div className="flex flex-col gap-5">
      <p className="border-special/20 bg-special/6 text-ink-secondary rounded-lg border px-3 py-2.5 text-[11.5px] leading-relaxed text-pretty">
        Mientras está activo el agente vendedor sigue respondiendo cada mensaje. El flujo no lo
        reemplaza: lo observa y espera una de cinco salidas.
      </p>

      <div>
        <label htmlFor={`${ids}-instr`} className={labelClass}>
          Instrucciones extra para este tramo
        </label>
        <Textarea
          id={`${ids}-instr`}
          value={instrucciones}
          onChange={(e) => onChange(c.con("instrucciones", e.target.value))}
          placeholder="Ej: si no te dice el año del auto, pedilo antes de cotizar."
          maxLength={MAX_INSTRUCCIONES_TRAMO}
          rows={3}
          disabled={readonly}
          aria-describedby={`${ids}-instr-ayuda`}
          className="border-line-control bg-surface-root text-ink-primary min-h-20 resize-y text-[12px] leading-relaxed"
        />
        <span
          id={`${ids}-instr-ayuda`}
          className="text-ink-faint mt-1 flex justify-between gap-2 text-[10.5px] leading-snug"
        >
          <span className="text-pretty">
            Se suman al prompt del agente sólo mientras dura el tramo.
          </span>
          <span className="shrink-0 font-mono tabular-nums">
            {instrucciones.length}/{MAX_INSTRUCCIONES_TRAMO}
          </span>
        </span>
      </div>

      <fieldset className="m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0" disabled={readonly}>
        <legend className={cn(labelClass, "mb-2")}>Volver cuando</legend>

        <div
          className={cn(
            "flex flex-col gap-2 rounded-lg border px-2.5 py-1.5",
            conIntent ? "border-line-control" : "border-line-row",
          )}
        >
          <div className="flex min-h-7 items-center gap-2.5">
            <input
              id={`${ids}-intent`}
              type="checkbox"
              checked={conIntent}
              onChange={(e) => onChange(c.con("intentId", e.target.checked ? "" : undefined))}
              className="accent-special size-3.5 shrink-0"
            />
            <label
              htmlFor={`${ids}-intent`}
              className={cn("flex-1 text-[11.5px]", conIntent ? "text-ink-body" : "text-ink-faint")}
            >
              Se detecte el intent
            </label>
          </div>
          {conIntent ? (
            <SelectOpciones
              value={intentId}
              onValueChange={(v) => onChange(c.con("intentId", v))}
              disabled={readonly}
              aria-label="Intent que resuelve el tramo"
              className={cn(selectClass, "mb-1.5 h-8 w-full font-mono text-[11.5px]")}
              placeholder="Elegir intent"
              opciones={intents.map((i) => ({ value: i.id, label: i.nombre }))}
            />
          ) : null}
        </div>

        <div
          className={cn(
            "flex flex-col gap-2 rounded-lg border px-2.5 py-1.5",
            conTwin ? "border-line-control" : "border-line-row",
          )}
        >
          <div className="flex min-h-7 items-center gap-2.5">
            <input
              id={`${ids}-twin`}
              type="checkbox"
              checked={conTwin}
              onChange={(e) =>
                onChange(
                  c.con(
                    "condicionTwin",
                    e.target.checked ? { arbol: arbolDeConfig({}) } : undefined,
                  ),
                )
              }
              className="accent-special size-3.5 shrink-0"
            />
            <label
              htmlFor={`${ids}-twin`}
              className={cn("flex-1 text-[11.5px]", conTwin ? "text-ink-body" : "text-ink-faint")}
            >
              Un campo del Twin cumpla
            </label>
          </div>
          {conTwin && condicionTwin ? <div className="pb-1.5">{condicionTwin}</div> : null}
        </div>
      </fieldset>

      <div>
        <div className="mb-1.5 flex items-baseline gap-1.5">
          <label
            htmlFor={`${ids}-timeout`}
            className="text-ink-secondary text-[11px] font-semibold"
          >
            Tiempo máximo
          </label>
          <span className="bg-danger/8 text-danger rounded px-1.5 py-0.5 font-mono text-[9.5px]">
            obligatorio
          </span>
        </div>
        <div className="flex gap-2">
          <Input
            id={`${ids}-timeout`}
            type="number"
            min={1}
            inputMode="numeric"
            value={typeof timeout === "number" ? timeout : ""}
            onChange={(e) =>
              onChange(c.con("timeout", e.target.value === "" ? null : Number(e.target.value)))
            }
            aria-invalid={!timeoutValido}
            aria-describedby={`${ids}-timeout-ayuda`}
            disabled={readonly}
            className={cn(inputClass, "flex-1 font-mono tabular-nums")}
          />
          <SelectOpciones
            value={String(c.valores.unidadTimeout)}
            onValueChange={(v) => onChange(c.con("unidadTimeout", v))}
            disabled={readonly}
            aria-label="Unidad del tiempo máximo"
            className={cn(selectClass, "w-28")}
            opciones={Object.entries(UNIDADES).map(([value, label]) => ({ value, label }))}
          />
        </div>
        <span
          id={`${ids}-timeout-ayuda`}
          className="text-ink-faint mt-1 block text-[10.5px] leading-snug text-pretty"
        >
          No se publica sin esto: ningún tramo delegado queda sin destino final. Hasta 7 días.
        </span>
      </div>

      <fieldset className="m-0 min-w-0 border-0 p-0" disabled={readonly}>
        <legend className={labelClass}>Topes del tramo</legend>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-ink-faint text-[10.5px]">Turnos del agente</span>
            <Input
              type="number"
              min={1}
              max={50}
              inputMode="numeric"
              value={Number(c.valores.maxTurnos)}
              onChange={(e) => onChange(c.con("maxTurnos", Number(e.target.value)))}
              className={cn(inputClass, "font-mono tabular-nums")}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-ink-faint text-[10.5px]">Gasto de IA (USD)</span>
            <Input
              type="number"
              min={0.01}
              max={20}
              step={0.01}
              inputMode="decimal"
              value={Number(c.valores.maxCostoUsd)}
              onChange={(e) => onChange(c.con("maxCostoUsd", Number(e.target.value)))}
              className={cn(inputClass, "font-mono tabular-nums")}
            />
          </label>
        </div>
        <span className="text-ink-faint mt-1 block text-[10.5px] leading-snug text-pretty">
          Pasado cualquiera, vuelve por «No pudo». También vuelve así si se agota el gasto del día
          del agente.
        </span>
      </fieldset>
    </div>
  );
}
