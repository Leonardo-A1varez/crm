"use client";

import { useState } from "react";
import { Warning } from "@/components/icons";
import { Eyebrow } from "@/components/shared/Eyebrow";
import { cn } from "@/lib/utils";
import { OPENAI_PRICING } from "@/lib/agente/modelos";
import { POLITICA_TOPE, type AgenteConfigValores, type PoliticaTope } from "@/types/agente";
import { EditorHorario } from "./EditorHorario";
import { TarjetaConsola } from "./TarjetaConsola";
import type { ReactNode } from "react";

const MAX_PLANTILLA = 1000;

/** Copys del handoff §4.4, no las abreviaturas del prototipo G1. */
const ETIQUETAS_POLITICA: Record<PoliticaTope, string> = {
  pausar: "Pausar la IA y avisar al equipo",
  solo_reglas: "Seguir solo con reglas IF/THEN",
  seguir: "Seguir generando (sin tope real)",
};

function formatUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}

const inputNumeroClase =
  "bg-surface-input border-line-input text-ink-body w-24 rounded-[10px] border px-2.5 py-1.5 text-right font-mono text-[12.5px]";

/** Fila label / subtítulo / valor del bloque "Modelo y límites técnicos". */
function FilaLimite({
  label,
  subtitulo,
  children,
}: {
  label: string;
  subtitulo: string;
  children: ReactNode;
}) {
  return (
    <div className="border-line-layout flex items-center justify-between gap-3 border-b py-2.5 last:border-0">
      <div className="min-w-0">
        <p className="text-ink-body text-[12px] font-medium">{label}</p>
        <p className="text-ink-faint text-[10.5px]">{subtitulo}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

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

  // No reentra en seleccionarPolitica: en el momento del click, valores.politica_tope
  // todavía no es "seguir" (el onChange real no se disparó todavía), así que llamar
  // seleccionarPolitica("seguir") de nuevo solo reabriría la confirmación en vez de
  // aplicar el cambio. "seguir" queda inalcanzable desde la UI si se reentra.
  function confirmarSeguirPolitica() {
    setConfirmarSeguir(false);
    onChange({ politica_tope: "seguir" });
  }

  return (
    <div className="grid grid-cols-[1.35fr_1fr] items-start gap-5">
      <div className="flex min-w-0 flex-col gap-5">
        <TarjetaConsola
          titulo="Modelo y límites técnicos"
          subtitulo="Se leen en cada turno: cambiarlos acá no requiere deploy."
        >
          <FilaLimite label="Modelo" subtitulo="se puede cambiar sin tocar código — Vercel AI SDK">
            <select
              value={valores.modelo}
              onChange={(e) => onChange({ modelo: e.target.value })}
              disabled={disabled}
              aria-label="Modelo"
              className="bg-surface-input border-line-input text-ink-body max-w-[260px] rounded-[10px] border p-2 font-mono text-[11.5px]"
            >
              {Object.entries(OPENAI_PRICING).map(([modelo, precio]) => (
                <option key={modelo} value={modelo}>
                  {modelo} — {formatUsd(precio.inputUsdPer1M)} / {formatUsd(precio.outputUsdPer1M)}{" "}
                  por 1M tok
                </option>
              ))}
            </select>
          </FilaLimite>

          <FilaLimite
            label="Pasos de tool por turno"
            subtitulo="Máximo de llamadas a herramientas antes de cortar."
          >
            <input
              type="number"
              min={1}
              max={10}
              step={1}
              value={valores.max_pasos_tool}
              onChange={(e) => onChange({ max_pasos_tool: Number(e.target.value) })}
              disabled={disabled}
              aria-label="Pasos de tool por turno"
              className={inputNumeroClase}
            />
          </FilaLimite>

          <FilaLimite
            label="Ventana de contexto por sesión"
            subtitulo="Mensajes recientes que ve el agente, además del Twin."
          >
            <input
              type="number"
              min={4}
              max={40}
              step={1}
              value={valores.ventana_contexto_mensajes}
              onChange={(e) => onChange({ ventana_contexto_mensajes: Number(e.target.value) })}
              disabled={disabled}
              aria-label="Ventana de contexto por sesión"
              className={inputNumeroClase}
            />
          </FilaLimite>

          <FilaLimite
            label="Umbral de resumen"
            subtitulo="Turnos antes de resumir la conversación."
          >
            <input
              type="number"
              min={10}
              max={100}
              step={1}
              value={valores.umbral_resumen_turnos}
              onChange={(e) => onChange({ umbral_resumen_turnos: Number(e.target.value) })}
              disabled={disabled}
              aria-label="Umbral de resumen"
              className={inputNumeroClase}
            />
          </FilaLimite>

          {esGpt5 ? (
            <p className="text-danger mt-3 flex items-start gap-1.5 text-[10.5px]">
              <Warning size={13} className="mt-0.5 shrink-0" />
              <span>
                Modelo de razonamiento: los tokens de reasoning se facturan como salida sin aparecer
                en la respuesta. El costo real puede ser varias veces el nominal.
              </span>
            </p>
          ) : null}

          {/* El handoff pide tres filas más. No se maquetan con valores de
              ejemplo: no existen ni en la config ni en el código. */}
          <p className="text-ink-ghost mt-3 text-[10.5px]">
            El diseño pide además «máximo de turnos por sesión», «timeout de herramienta» y
            «reintentos ante error de Meta». Ninguno existe: la sesión no tiene tope de turnos, la
            tool de catálogo corre sin timeout propio y los reintentos hacia Meta son los que pone
            Inngest por defecto, no un número configurable.
          </p>
        </TarjetaConsola>

        <TarjetaConsola
          titulo="Horario del agente"
          subtitulo="Fuera de horario responde con plantilla y no genera con LLM."
        >
          <EditorHorario
            horario={valores.horario}
            timezone={valores.horario_timezone}
            onChange={onChange}
            disabled={disabled}
          />
        </TarjetaConsola>

        <TarjetaConsola
          titulo="Plantilla fuera de horario"
          subtitulo="Vacía = el agente no contesta nada y la sesión queda para que un humano la retome."
        >
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
        </TarjetaConsola>
      </div>

      <div className="sticky top-[22px] min-w-0">
        <section
          className="border-brand/25 rounded-[15px] border p-[17px]"
          // Mismo gradiente que la tarjeta de gasto de Métricas (handoff §3.2).
          // Gradiente de la tarjeta destacada del handoff.
          style={{
            background:
              "linear-gradient(160deg,var(--color-surface-glow),var(--color-surface-card))",
          }}
        >
          <h2 className="text-ink-primary text-[13px] font-[650] tracking-[-0.015em]">
            Tope de gasto diario
          </h2>

          <div className="mt-3 flex items-center gap-2">
            <span className="text-ink-faint font-mono text-[12.5px]">USD</span>
            <input
              type="number"
              min={0.5}
              max={1000}
              step={0.5}
              value={valores.tope_gasto_diario_usd}
              onChange={(e) => onChange({ tope_gasto_diario_usd: Number(e.target.value) })}
              disabled={disabled}
              aria-label="Tope de gasto diario en dólares"
              className={inputNumeroClase}
            />
            <span className="text-ink-faint text-[10.5px]">por día</span>
          </div>

          {/* El handoff pide "usados $4,12 / barra al 41%". El gasto del día no
              se puede leer desde el panel: el contador vive en el proceso que
              hace las llamadas y sin Upstash ni siquiera sobrevive un cold
              start. Una barra al 0% sería peor que no tenerla. */}
          <p className="text-ink-faint mt-2 text-[10.5px]">
            Cuánto se lleva gastado hoy no se puede mostrar acá: el contador de gasto vive junto a
            las llamadas al modelo y todavía no se expone al panel.
          </p>

          <p className="text-ink-faint mt-4 mb-2 text-[10.5px] font-medium">
            Qué hacer al llegar al tope
          </p>
          <div
            role="radiogroup"
            aria-label="Qué hacer al llegar al tope"
            className="flex flex-col gap-1.5"
          >
            {POLITICA_TOPE.map((p) => {
              const activo = p === valores.politica_tope;
              return (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={activo}
                  disabled={disabled}
                  onClick={() => seleccionarPolitica(p)}
                  className={cn(
                    "flex items-center gap-2.5 rounded-[10px] border px-2.5 py-2 text-left text-[11.5px] transition-colors duration-[160ms] disabled:opacity-50",
                    activo
                      ? "border-brand/30 bg-brand/[0.09] text-ink-primary font-semibold"
                      : "text-ink-dim hover:bg-surface-elevated border-transparent",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "flex h-[13px] w-[13px] shrink-0 items-center justify-center rounded-full border",
                      activo ? "border-brand" : "border-line-control",
                    )}
                  >
                    {activo ? <span className="bg-brand h-[7px] w-[7px] rounded-full" /> : null}
                  </span>
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
                  onClick={confirmarSeguirPolitica}
                  className="bg-danger text-ink-primary ml-auto rounded-[7px] px-3 py-1.5 text-[11px] font-semibold"
                >
                  Sí, desactivar el tope
                </button>
              </div>
            </div>
          ) : null}

          {!confirmarSeguir && valores.politica_tope === "seguir" ? (
            <p className="text-danger mt-3 text-[10.5px]">
              El tope de gasto diario está desactivado: el agente sigue respondiendo aunque lo
              supere.
            </p>
          ) : null}
          {valores.politica_tope === "solo_reglas" ? (
            <p className="text-caution mt-3 text-[10.5px]">
              Hasta que exista el motor de reglas completo, esta opción se comporta igual que
              &quot;Pausar&quot;.
            </p>
          ) : null}

          <div className="border-line-card mt-4 border-t pt-3">
            <Eyebrow>Advertencia</Eyebrow>
            <p className="text-caution mt-1 text-[10.5px]">
              El valor de arriba se guarda y se versiona, pero el corte real de gasto todavía lo
              decide una variable de entorno del servidor, no este campo.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
