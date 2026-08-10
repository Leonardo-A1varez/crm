"use client";

import { AccountTree, Bolt } from "@/components/icons";
import { Eyebrow } from "@/components/shared/Eyebrow";
import { MonoMeta } from "@/components/shared/MonoMeta";
import { TarjetaConsola } from "./TarjetaConsola";
import { TIPO_LABEL } from "./TablaReglas";
import type { ReglaConIntent } from "@/server/services/reglas/reglas-admin.service";

/** Placeholders de una respuesta `template`: son las variables que se rellenan. */
function variablesDe(contenido: string): string[] {
  const encontradas = contenido.match(/\{[a-zA-Z0-9_]+\}/g) ?? [];
  return Array.from(new Set(encontradas));
}

function condicionesDe(fila: ReglaConIntent): string[] {
  const out = [`intent == "${fila.intentNombre}"`];
  const extra = fila.regla.condiciones_extra;
  if (extra) {
    for (const [clave, valor] of Object.entries(extra)) {
      out.push(`${clave} == ${JSON.stringify(valor)}`);
    }
  }
  return out;
}

export function DetalleRegla({ fila }: { fila: ReglaConIntent | null }) {
  if (!fila) {
    return (
      <TarjetaConsola
        titulo="Detalle de la regla"
        subtitulo="Elegí una fila de la tabla para ver qué condición la dispara y qué contesta."
        icono={<AccountTree size={14} className="text-ink-ghost" />}
      >
        <p className="text-ink-ghost text-[11px] italic">Ninguna regla seleccionada.</p>
      </TarjetaConsola>
    );
  }

  const variables = variablesDe(fila.regla.respuesta_contenido);

  return (
    <TarjetaConsola
      titulo="Detalle de la regla"
      subtitulo={`${TIPO_LABEL[fila.regla.respuesta_tipo] ?? fila.regla.respuesta_tipo} · prioridad ${fila.regla.prioridad}`}
      icono={<AccountTree size={14} className="text-brand" />}
    >
      <div className="flex flex-col gap-3">
        <div>
          <span className="text-info font-mono text-[9.5px] font-semibold tracking-[0.13em] uppercase">
            Si
          </span>
          <div className="bg-surface-input border-line-input mt-1.5 rounded-[10px] border p-2.5">
            {condicionesDe(fila).map((c) => (
              <p key={c} className="text-ink-secondary font-mono text-[11px]">
                {c}
              </p>
            ))}
          </div>
        </div>

        <div>
          <span className="text-brand font-mono text-[9.5px] font-semibold tracking-[0.13em] uppercase">
            Entonces
          </span>
          <div className="border-brand/30 bg-brand/[0.06] mt-1.5 rounded-[10px] border p-2.5">
            <p className="text-ink-warm text-[11.5px] whitespace-pre-wrap">
              {fila.regla.respuesta_tipo === "handoff"
                ? `Pasa la conversación a un humano. Motivo: ${fila.regla.respuesta_contenido}`
                : fila.regla.respuesta_contenido}
            </p>
            {variables.length > 0 ? (
              <MonoMeta className="mt-2 block text-[9.5px]">
                variables: {variables.join(", ")}
              </MonoMeta>
            ) : null}
          </div>
        </div>

        {/* El handoff pone acá "Evita 214 llamadas al LLM por semana". Las
            ejecuciones se auditan en `rule_executions` desde el pipeline, pero
            nadie las cuenta por ventana de tiempo ni guarda el costo del turno
            evitado, así que el número no existe: se dice qué falta. */}
        <p className="text-ink-faint flex items-start gap-1.5 text-[10.5px]">
          <Bolt size={13} className="text-ok mt-px shrink-0" />
          <span>
            Cada vez que coincide, el turno se resuelve sin llamar al LLM. Cuántas veces pasó no se
            puede mostrar todavía: falta contar <code className="font-mono">rule_executions</code>{" "}
            por semana.
          </span>
        </p>

        <div className="border-line-layout border-t pt-3">
          <Eyebrow>Probador</Eyebrow>
          <p className="text-ink-faint mt-1.5 text-[10.5px]">
            Sin construir. Probar un mensaje de ejemplo exige correr el clasificador de intents —una
            llamada al LLM que se factura— y el motor de reglas todavía no está expuesto fuera del
            pipeline de mensajes entrantes.
          </p>
        </div>
      </div>
    </TarjetaConsola>
  );
}
