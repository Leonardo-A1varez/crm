import { Eyebrow } from "@/components/shared/Eyebrow";
import { MonoMeta } from "@/components/shared/MonoMeta";
import { stageColor, stageLabel } from "@/lib/ui/stage";
import type { ConteoEtapa, Metricas } from "@/types/metricas";

function Seccion({
  titulo,
  extra,
  children,
}: {
  titulo: string;
  extra?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-line-card bg-surface-card rounded-[14px] border p-[17px]">
      <div className="mb-3.5 flex items-baseline justify-between gap-2">
        <Eyebrow>{titulo}</Eyebrow>
        {extra ? <MonoMeta>{extra}</MonoMeta> : null}
      </div>
      {children}
    </section>
  );
}

/**
 * Barra proporcional al máximo de su propio corte, no al total: con un embudo
 * donde casi todo cae en la primera etapa, escalar contra el total dejaría las
 * demás en un pelo invisible y el corte no diría nada.
 */
function Barra({
  label,
  cantidad,
  maximo,
  color,
}: {
  label: string;
  cantidad: number;
  maximo: number;
  color: string;
}) {
  const pct = maximo > 0 ? Math.round((cantidad / maximo) * 100) : 0;
  return (
    <div className="flex items-center gap-2.5">
      <span className="text-ink-dim w-[110px] shrink-0 truncate text-[11.5px]">{label}</span>
      <div className="bg-line-card h-[7px] min-w-0 flex-1 overflow-hidden rounded-full">
        <div
          className="h-full rounded-full"
          style={{ width: `${pct}%`, backgroundColor: color }}
          aria-hidden
        />
      </div>
      <span className="text-ink-body w-8 shrink-0 text-right font-mono text-[11px] tabular-nums">
        {cantidad}
      </span>
    </div>
  );
}

function BarrasEtapa({ filas }: { filas: ConteoEtapa[] }) {
  const maximo = Math.max(...filas.map((f) => f.cantidad), 0);
  return (
    <div className="flex flex-col gap-2">
      {filas.map((f) => (
        <Barra
          key={f.stage}
          label={stageLabel(f.stage)}
          cantidad={f.cantidad}
          maximo={maximo}
          color={stageColor(f.stage)}
        />
      ))}
    </div>
  );
}

function Cifra({ valor, label, color }: { valor: number; label: string; color?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span
        className="text-[26px] leading-none font-[680] tracking-[-0.03em]"
        style={color ? { color } : undefined}
      >
        {valor}
      </span>
      <span className="text-ink-faint text-[10.5px]">{label}</span>
    </div>
  );
}

export function PanelMetricas({ m }: { m: Metricas }) {
  const totalMensajes = m.autoria.lead + m.autoria.ia + m.autoria.humano + m.autoria.sistema;
  const respuestas = m.autoria.ia + m.autoria.humano;
  const pctIa = respuestas > 0 ? Math.round((m.autoria.ia / respuestas) * 100) : 0;

  return (
    <div className="flex flex-col gap-4 p-5">
      <div className="grid gap-4 lg:grid-cols-2">
        <Seccion titulo="Embudo" extra={`${m.totalSesiones} sesiones`}>
          {m.totalSesiones === 0 ? (
            <p className="text-ink-faint text-[11.5px]">Sin sesiones en el período.</p>
          ) : (
            <>
              <BarrasEtapa filas={m.embudo} />
              {m.desvios.some((d) => d.cantidad > 0) ? (
                <div className="border-line-layout mt-3.5 border-t pt-3.5">
                  <p className="text-ink-ghost mb-2 text-[10.5px]">
                    Fuera del embudo: no son pasos siguientes, son salidas.
                  </p>
                  <BarrasEtapa filas={m.desvios} />
                </div>
              ) : null}
            </>
          )}
        </Seccion>

        <Seccion titulo="Resultado de las sesiones">
          <div className="mb-4 flex items-end gap-7">
            <Cifra valor={m.resultado.exito} label="cerradas con éxito" color="var(--color-ok)" />
            <Cifra valor={m.resultado.perdido} label="perdidas" color="var(--color-danger)" />
            <Cifra valor={m.resultado.abiertas} label="todavía abiertas" />
          </div>
          {m.resultado.porMotivo.length > 0 ? (
            <>
              <p className="text-ink-ghost mb-2 text-[10.5px]">Por qué se perdieron</p>
              <ul className="flex flex-col gap-1.5">
                {m.resultado.porMotivo.map((r) => (
                  <li key={r.motivo} className="flex items-baseline justify-between gap-2">
                    <span className="text-ink-dim truncate text-[11.5px]">{r.motivo}</span>
                    <MonoMeta>{r.cantidad}</MonoMeta>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-ink-faint text-[11.5px]">Ninguna sesión perdida en el período.</p>
          )}
        </Seccion>
      </div>

      <Seccion titulo="Quién contestó" extra={`${totalMensajes} mensajes`}>
        {respuestas === 0 ? (
          <p className="text-ink-faint text-[11.5px]">Sin respuestas enviadas en el período.</p>
        ) : (
          <>
            <div className="mb-4 flex items-end gap-7">
              <Cifra valor={pctIa} label="% contestado por la IA" color="var(--color-brand)" />
              <Cifra valor={m.autoria.ia} label="respuestas de la IA" />
              <Cifra valor={m.autoria.humano} label="respuestas de un vendedor" />
              <Cifra valor={m.autoria.lead} label="mensajes del cliente" />
            </div>
            <div className="bg-line-card flex h-[7px] overflow-hidden rounded-full">
              <div
                className="bg-brand h-full"
                style={{ width: `${pctIa}%` }}
                aria-label={`IA ${pctIa}%`}
              />
              <div
                className="bg-info h-full"
                style={{ width: `${100 - pctIa}%` }}
                aria-label={`Vendedor ${100 - pctIa}%`}
              />
            </div>
          </>
        )}
      </Seccion>
    </div>
  );
}
