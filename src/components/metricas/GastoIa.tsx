import { Eyebrow } from "@/components/shared/Eyebrow";
import { MonoMeta } from "@/components/shared/MonoMeta";
import { formatearEntero, formatearTokens, formatearUsd } from "@/lib/ui/metricas";
import { WORKFLOW_LLM } from "@/types/domain";
import type { GastoIa as GastoIaDatos } from "@/types/metricas";

/**
 * Nombre en castellano de cada tipo de llamada al modelo. La columna de la base
 * guarda el identificador técnico —tiene que sobrevivir a renombres— y la
 * traducción vive acá. Un workflow que no esté en el mapa se muestra crudo en
 * vez de desaparecer: preferimos un nombre feo antes que gasto invisible.
 */
const LABEL_WORKFLOW: Record<string, string> = {
  [WORKFLOW_LLM.agente]: "Agente vendedor",
  [WORKFLOW_LLM.agentePreview]: "Pruebas desde la consola",
  [WORKFLOW_LLM.clasificador]: "Clasificador de intents",
  [WORKFLOW_LLM.extractorTwin]: "Extractor del Twin",
  [WORKFLOW_LLM.resumidor]: "Resumidor de conversación",
  [WORKFLOW_LLM.detectorBatch]: "Detector de intents (semanal)",
};

function Cifra({ valor, label, color }: { valor: string; label: string; color?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span
        className="font-mono text-[15px] leading-none font-semibold tracking-[-0.02em]"
        style={color ? { color } : undefined}
      >
        {valor}
      </span>
      <span className="text-ink-faint text-[10px]">{label}</span>
    </div>
  );
}

/**
 * "Gasto de IA" del handoff §3.2, sin la barra contra el tope: el dueño del
 * producto decidió que no quiere tope de gasto, así que no hay contra qué
 * dibujarla. Queda la lectura, que es lo que pidió.
 */
export function GastoIa({ gasto, dias }: { gasto: GastoIaDatos; dias: number }) {
  const sinDatos = gasto.llamadas === 0;

  return (
    <section
      className="border-brand/25 rounded-[14px] border p-[17px]"
      // Mismo gradiente que la tarjeta destacada del handoff.
      style={{
        background: "linear-gradient(160deg,var(--color-surface-glow),var(--color-surface-card))",
      }}
    >
      <div className="mb-3.5 flex items-baseline justify-between gap-2">
        <Eyebrow>Gasto de IA</Eyebrow>
        <MonoMeta>{`últimos ${dias} días`}</MonoMeta>
      </div>

      {sinDatos ? (
        <p className="text-ink-faint text-[11.5px]">
          Sin llamadas al modelo registradas en el período. Cada llamada se anota al terminar el
          turno, así que los turnos anteriores a que esto existiera no aparecen.
        </p>
      ) : (
        <>
          <div className="flex items-baseline gap-2.5">
            <span className="text-ink-primary font-mono text-[30px] leading-none font-semibold tracking-[-0.035em]">
              {formatearUsd(gasto.totalUsd)}
            </span>
            <span className="text-ink-faint font-mono text-[12.5px]">
              {formatearUsd(gasto.hoyUsd)} hoy
            </span>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-3.5 sm:grid-cols-4">
            <Cifra valor={formatearTokens(gasto.tokensEntrada)} label="tokens de entrada" />
            <Cifra valor={formatearTokens(gasto.tokensSalida)} label="tokens de salida" />
            <Cifra valor={formatearEntero(gasto.llamadas)} label="llamadas al modelo" />
            <Cifra
              valor={
                gasto.ahorroReglasUsd === null ? "—" : `−${formatearUsd(gasto.ahorroReglasUsd)}`
              }
              label="ahorro estimado por reglas"
              color={gasto.ahorroReglasUsd === null ? undefined : "var(--color-ok)"}
            />
          </div>

          <ul className="border-line-card mt-4 flex flex-col gap-2 border-t pt-3.5">
            {gasto.porWorkflow.map((w) => (
              <li key={w.workflow} className="flex items-baseline gap-2">
                <span className="text-ink-dim min-w-0 flex-1 truncate text-[11.5px]">
                  {LABEL_WORKFLOW[w.workflow] ?? w.workflow}
                </span>
                <MonoMeta className="shrink-0">{formatearEntero(w.llamadas)}</MonoMeta>
                <span className="text-ink-secondary w-20 shrink-0 text-right font-mono text-[11.5px] tabular-nums">
                  {formatearUsd(w.usd)}
                </span>
              </li>
            ))}
          </ul>

          <p className="text-ink-ghost mt-3.5 text-[10.5px] leading-relaxed">
            {gasto.ahorroReglasUsd === null
              ? "El ahorro por reglas no se puede estimar: el agente no resolvió ningún turno en el período, así que no hay costo promedio con el cual comparar."
              : `El ahorro es una estimación: los turnos que contestó una regla por el costo promedio de un turno del agente (${formatearUsd(gasto.promedioTurnoUsd ?? 0)}). Queda por encima del ahorro real, porque ese promedio sale de los turnos que ninguna regla cubrió, que suelen ser los más largos.`}
          </p>
        </>
      )}
    </section>
  );
}
