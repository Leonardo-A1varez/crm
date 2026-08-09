"use client";

import { useState } from "react";
import { Warning } from "@/components/icons";
import { Eyebrow } from "@/components/shared/Eyebrow";
import { cn } from "@/lib/utils";
import { OPENAI_PRICING } from "@/lib/agente/modelos";
import { POLITICA_TOPE, type AgenteConfigValores, type PoliticaTope } from "@/types/agente";
import { EditorHorario } from "./EditorHorario";

const MAX_PLANTILLA = 1000;

const ETIQUETAS_POLITICA: Record<PoliticaTope, string> = {
  pausar: "Pausar",
  solo_reglas: "Solo reglas",
  seguir: "Seguir sin tope",
};

function formatUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}

/** Estilo compartido por los tres inputs numéricos de límites operativos. */
const inputNumeroClase =
  "bg-surface-input border-line-input text-ink-body w-24 rounded-[10px] border px-2.5 py-1.5 text-right font-mono text-[12.5px]";

export function TabLimites({
  valores,
  onChange,
  disabled,
}: {
  valores: AgenteConfigValores;
  onChange: (patch: Partial<AgenteConfigValores>) => void;
  disabled?: boolean;
}) {
  // Confirmación explícita antes de aplicar "seguir": sin este paso el kill
  // switch se apaga con un click perdido en un radio, no una decisión.
  const [confirmarSeguir, setConfirmarSeguir] = useState(false);
  const esGpt5 = valores.modelo.startsWith("gpt-5");

  function seleccionarPolitica(p: PoliticaTope) {
    if (p === "seguir" && valores.politica_tope !== "seguir") {
      setConfirmarSeguir(true);
      return;
    }
    setConfirmarSeguir(false);
    onChange({ politica_tope: p });
  }

  return (
    <div className="flex flex-col gap-5">
      <section className="bg-surface-card border-line-card rounded-[15px] border p-[17px]">
        <Eyebrow>Modelo</Eyebrow>
        <select
          value={valores.modelo}
          onChange={(e) => onChange({ modelo: e.target.value })}
          disabled={disabled}
          className="bg-surface-input border-line-input text-ink-body mt-2 w-full rounded-[10px] border p-2.5 font-mono text-[12px]"
        >
          {Object.entries(OPENAI_PRICING).map(([modelo, precio]) => (
            <option key={modelo} value={modelo}>
              {modelo} — entrada {formatUsd(precio.inputUsdPer1M)} / salida{" "}
              {formatUsd(precio.outputUsdPer1M)} por 1M tok
            </option>
          ))}
        </select>
        {esGpt5 ? (
          <p className="text-danger mt-2 flex items-start gap-1.5 text-[10.5px]">
            <Warning size={13} className="mt-0.5 shrink-0" />
            <span>
              Modelo de razonamiento: los tokens de reasoning se facturan como salida sin aparecer
              en la respuesta. El costo real puede ser varias veces el nominal.
            </span>
          </p>
        ) : null}
      </section>

      <section className="bg-surface-card border-line-card flex flex-col gap-3 rounded-[15px] border p-[17px]">
        <Eyebrow>Límites operativos</Eyebrow>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-ink-body text-[12px] font-medium">Pasos de tool por turno</p>
            <p className="text-ink-faint text-[10.5px]">Máximo de llamadas a herramientas.</p>
          </div>
          <input
            type="number"
            min={1}
            max={10}
            step={1}
            value={valores.max_pasos_tool}
            onChange={(e) => onChange({ max_pasos_tool: Number(e.target.value) })}
            disabled={disabled}
            className={inputNumeroClase}
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-ink-body text-[12px] font-medium">Ventana de contexto</p>
            <p className="text-ink-faint text-[10.5px]">Mensajes recientes que ve el agente.</p>
          </div>
          <input
            type="number"
            min={4}
            max={40}
            step={1}
            value={valores.ventana_contexto_mensajes}
            onChange={(e) => onChange({ ventana_contexto_mensajes: Number(e.target.value) })}
            disabled={disabled}
            className={inputNumeroClase}
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-ink-body text-[12px] font-medium">Umbral de resumen</p>
            <p className="text-ink-faint text-[10.5px]">Turnos antes de resumir la conversación.</p>
          </div>
          <input
            type="number"
            min={10}
            max={100}
            step={1}
            value={valores.umbral_resumen_turnos}
            onChange={(e) => onChange({ umbral_resumen_turnos: Number(e.target.value) })}
            disabled={disabled}
            className={inputNumeroClase}
          />
        </div>
      </section>

      <section className="bg-surface-card border-line-card rounded-[15px] border p-[17px]">
        <Eyebrow>Tope de gasto diario</Eyebrow>
        <div className="mt-2 flex items-center gap-2">
          <span className="text-ink-faint font-mono text-[12.5px]">USD</span>
          <input
            type="number"
            min={0.5}
            max={1000}
            step={0.5}
            value={valores.tope_gasto_diario_usd}
            onChange={(e) => onChange({ tope_gasto_diario_usd: Number(e.target.value) })}
            disabled={disabled}
            className={inputNumeroClase}
          />
          <span className="text-ink-faint text-[10.5px]">por día</span>
        </div>

        <p className="text-ink-faint mt-4 mb-2 text-[10.5px] font-medium">
          Qué hacer al llegar al tope
        </p>
        <div className="border-line-control bg-surface-input flex gap-1 rounded-[10px] border p-[3px]">
          {POLITICA_TOPE.map((p) => {
            const activo = p === valores.politica_tope;
            const esSeguir = p === "seguir";
            return (
              <button
                key={p}
                type="button"
                disabled={disabled}
                onClick={() => seleccionarPolitica(p)}
                className={cn(
                  "flex-1 rounded-[7px] py-2 text-[11.5px] font-semibold transition-colors",
                  activo && esSeguir && "bg-danger text-ink-primary",
                  activo && !esSeguir && "bg-brand text-brand-ink",
                  !activo && esSeguir && "text-danger hover:text-danger/80 bg-transparent",
                  !activo && !esSeguir && "text-ink-dim hover:text-ink-primary bg-transparent",
                )}
              >
                {ETIQUETAS_POLITICA[p]}
              </button>
            );
          })}
        </div>

        {confirmarSeguir ? (
          <div className="border-danger bg-danger/10 mt-3 rounded-[12px] border p-3">
            <p className="text-danger text-[11.5px] font-semibold">
              Esto convierte el kill switch en un adorno.
            </p>
            <p className="text-ink-secondary mt-1 text-[10.5px]">
              El agente va a seguir respondiendo aunque supere los{" "}
              {formatUsd(valores.tope_gasto_diario_usd)}/día. Confirmá que es lo que querés.
            </p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmarSeguir(false)}
                className="text-ink-dim hover:text-ink-primary text-[11px] underline"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => seleccionarPolitica("seguir")}
                className="bg-danger text-ink-primary ml-auto rounded-[7px] px-3 py-1.5 text-[11px] font-semibold"
              >
                Sí, desactivar el tope
              </button>
            </div>
          </div>
        ) : null}

        {!confirmarSeguir && valores.politica_tope === "seguir" ? (
          <p className="text-danger mt-3 text-[10.5px]">
            El tope de gasto diario está desactivado: el agente sigue respondiendo aunque lo supere.
          </p>
        ) : null}
        {valores.politica_tope === "solo_reglas" ? (
          <p className="text-caution mt-3 text-[10.5px]">
            Hasta que exista el sub-proyecto G2 (motor de reglas), esta opción se comporta igual que
            &quot;Pausar&quot;.
          </p>
        ) : null}
      </section>

      <section className="bg-surface-card border-line-card rounded-[15px] border p-[17px]">
        <Eyebrow>Horario de atención</Eyebrow>
        <div className="mt-3">
          <EditorHorario
            horario={valores.horario}
            timezone={valores.horario_timezone}
            onChange={onChange}
            disabled={disabled}
          />
        </div>
      </section>

      <section className="bg-surface-card border-line-card rounded-[15px] border p-[17px]">
        <Eyebrow>Plantilla fuera de horario</Eyebrow>
        <p className="text-ink-faint mt-1 mb-3 text-[10.5px]">
          Se envía en vez de generar una respuesta cuando el horario de arriba dice cerrado. Vacía =
          el agente no contesta nada y la sesión queda para que un humano la retome.
        </p>
        <textarea
          value={valores.plantilla_fuera_horario}
          onChange={(e) => onChange({ plantilla_fuera_horario: e.target.value })}
          maxLength={MAX_PLANTILLA}
          disabled={disabled}
          rows={3}
          placeholder="Ej: Gracias por escribir. Nuestro horario es de 9 a 18. Te respondemos apenas abramos."
          className="bg-surface-input border-line-input text-ink-body w-full rounded-[12px] border p-3 text-[12.5px]"
        />
        <span className="text-ink-ghost mt-2 block font-mono text-[10px]">
          {MAX_PLANTILLA - valores.plantilla_fuera_horario.length} caracteres restantes
        </span>
      </section>
    </div>
  );
}
