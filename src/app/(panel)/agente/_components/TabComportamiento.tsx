"use client";

import { useState } from "react";
import { VerifiedUser } from "@/components/icons";
import { Eyebrow } from "@/components/shared/Eyebrow";
import { componerSystemPrompt, REGLAS_INVIOLABLES } from "@/lib/agente/prompt";
import { EMOJIS, LARGO, TONO, type AgenteConfigValores } from "@/types/agente";
import { SegmentedControl } from "./SegmentedControl";
import { SliderDescuento } from "./SliderDescuento";
import { TarjetaConsola } from "./TarjetaConsola";

const MAX_INSTRUCCIONES = 4000;

const ETIQUETAS_TONO = { formal: "Formal", neutro: "Neutro", cercano: "Cercano (vos)" } as const;
const ETIQUETAS_LARGO = { corto: "Corto", medio: "Medio", detallado: "Detallado" } as const;
const ETIQUETAS_EMOJIS = { nunca: "Nunca", ocasional: "Ocasional", libre: "Libre" } as const;

export function TabComportamiento({
  valores,
  onChange,
  disabled,
}: {
  valores: AgenteConfigValores;
  onChange: (patch: Partial<AgenteConfigValores>) => void;
  disabled?: boolean;
}) {
  const [verPrompt, setVerPrompt] = useState(false);
  const restantes = MAX_INSTRUCCIONES - valores.instrucciones.length;

  return (
    <div className="flex flex-col gap-5">
      <TarjetaConsola
        titulo="Cómo habla el agente"
        subtitulo="Afecta todas las respuestas generadas con LLM, no las reglas fijas."
      >
        <div className="flex flex-col gap-4">
          <div>
            <Eyebrow>Tono</Eyebrow>
            <div className="mt-2">
              <SegmentedControl
                opciones={TONO}
                valor={valores.tono}
                onChange={(tono) => onChange({ tono })}
                etiquetas={ETIQUETAS_TONO}
                disabled={disabled}
              />
            </div>
          </div>
          <div>
            <Eyebrow>Largo</Eyebrow>
            <div className="mt-2">
              <SegmentedControl
                opciones={LARGO}
                valor={valores.largo}
                onChange={(largo) => onChange({ largo })}
                etiquetas={ETIQUETAS_LARGO}
                disabled={disabled}
              />
            </div>
          </div>
          <div>
            <Eyebrow>Emojis</Eyebrow>
            <div className="mt-2">
              <SegmentedControl
                opciones={EMOJIS}
                valor={valores.emojis}
                onChange={(emojis) => onChange({ emojis })}
                etiquetas={ETIQUETAS_EMOJIS}
                disabled={disabled}
              />
            </div>
          </div>
        </div>
      </TarjetaConsola>

      <TarjetaConsola
        titulo="Descuento máximo que puede ofrecer solo"
        subtitulo="Por encima de eso pide autorización al vendedor antes de ofrecerlo: una respuesta que lo exceda no se envía."
      >
        <SliderDescuento
          valor={valores.descuento_max_pct}
          onChange={(descuento_max_pct) => onChange({ descuento_max_pct })}
          disabled={disabled}
        />
        {valores.descuento_max_pct === 0 ? (
          <p className="text-ink-faint mt-2 text-[10.5px]">
            En 0 el agente no ofrece descuentos: deriva a un vendedor.
          </p>
        ) : null}
      </TarjetaConsola>

      {/* Estado, no control: no hay switch, no hay forma de desactivarlas. */}
      <TarjetaConsola
        titulo="Reglas duras"
        subtitulo="No se pueden desactivar: protegen contra respuestas inventadas."
        icono={<VerifiedUser className="text-ok" size={14} />}
      >
        <ul className="flex flex-col gap-2">
          {REGLAS_INVIOLABLES.map((regla) => (
            <li key={regla} className="text-ink-secondary flex gap-2 text-[11.5px]">
              <span aria-hidden className="text-ink-ghost">
                &#128274;
              </span>
              <span>{regla}</span>
            </li>
          ))}
        </ul>
      </TarjetaConsola>

      {/* Fuera del handoff: G1 agregó instrucciones de negocio en texto libre.
          Se mantiene porque es funcionalidad real y auditable, no maqueta. */}
      <TarjetaConsola
        titulo="Instrucciones del negocio"
        subtitulo="Se suman al prompt del agente. No pueden desactivar las reglas duras de arriba."
      >
        <textarea
          value={valores.instrucciones}
          onChange={(e) => onChange({ instrucciones: e.target.value })}
          maxLength={MAX_INSTRUCCIONES}
          disabled={disabled}
          rows={6}
          placeholder="Ej: Mencioná siempre que hacemos envíos a todo el país."
          className="bg-surface-input border-line-input text-ink-body w-full rounded-[12px] border p-3 text-[12.5px]"
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-ink-ghost font-mono text-[10px]">
            {restantes} caracteres restantes
          </span>
          <button
            type="button"
            onClick={() => setVerPrompt((v) => !v)}
            className="text-ink-dim hover:text-ink-primary text-[11px] underline"
          >
            {verPrompt ? "Ocultar" : "Ver"} el prompt que se va a enviar
          </button>
        </div>
        {/* La relacion config -> prompt tiene que ser auditable desde la pantalla:
            sin esto, el admin escribe a ciegas y no ve donde cae su texto. */}
        {verPrompt ? (
          <pre className="bg-surface-elevated border-line-card text-ink-secondary mt-3 max-h-80 overflow-auto rounded-[12px] border p-3 font-mono text-[10.5px] whitespace-pre-wrap">
            {componerSystemPrompt(valores)}
          </pre>
        ) : null}
      </TarjetaConsola>
    </div>
  );
}
