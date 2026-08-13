import { BarraReparto } from "@/components/metricas/BarraReparto";
import { KpiFaltante } from "@/components/metricas/Faltante";
import { GastoIa } from "@/components/metricas/GastoIa";
import { IntentsSinRegla } from "@/components/metricas/IntentsSinRegla";
import { Seccion } from "@/components/metricas/Seccion";
import { TarjetaKpi } from "@/components/metricas/TarjetaKpi";
import { DatabaseSearch, PanTool, Savings, SmartToy } from "@/components/icons";
import {
  cantidad,
  formatearEntero,
  formatearEspera,
  formatearPorcentaje,
  formatearUsd,
  porcentajeDe,
} from "@/lib/ui/metricas";
import { WORKFLOW_LLM } from "@/types/domain";
import type { Metricas } from "@/types/metricas";

export function PanelAgente({ m }: { m: Metricas }) {
  const turnos = m.turnos.regla + m.turnos.llm + m.turnos.escalado;
  // Lo que costó la franja "LLM" de la barra. Es el gasto del agente vendedor y
  // no el total de IA: el clasificador corre igual cuando contesta una regla, y
  // cargárselo a esta franja diría que las reglas ahorran más de lo que ahorran.
  const usdAgente = m.gasto.porWorkflow.find((w) => w.workflow === WORKFLOW_LLM.agente)?.usd ?? 0;

  return (
    <div className="flex flex-col gap-4 p-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <TarjetaKpi
          label="Resueltas por IA"
          valor={formatearPorcentaje(porcentajeDe(m.agente.resueltasPorIa, m.totalSesiones))}
          subtitulo={`${formatearEntero(m.agente.resueltasPorIa)} cerradas sin intervención · ${formatearEntero(m.agente.sinIntervencionHumana)} sin intervención total`}
          icono={SmartToy}
        />
        <TarjetaKpi
          label="Escaladas a humano"
          valor={formatearPorcentaje(porcentajeDe(m.agente.escaladas, m.totalSesiones))}
          subtitulo="escribió una persona, o la sesión está pidiendo una"
          icono={PanTool}
        />
        <TarjetaKpi
          label="Primera respuesta IA"
          valor={formatearEspera(m.tiempoPrimeraRespuesta.ia.medianaSegundos)}
          subtitulo={
            m.tiempoPrimeraRespuesta.ia.muestras === 0
              ? "Sin datos medibles"
              : `${formatearEntero(m.tiempoPrimeraRespuesta.ia.muestras)} muestras con timestamp de Meta`
          }
          icono={SmartToy}
        />
        {m.gasto.porLeadUsd === null ? (
          <KpiFaltante
            label="Costo por lead"
            falta="leads en el período. El gasto de cada turno sí queda registrado; lo que falta es el denominador."
          />
        ) : (
          <TarjetaKpi
            label="Costo por lead"
            valor={formatearUsd(m.gasto.porLeadUsd)}
            subtitulo={`${formatearUsd(m.gasto.totalUsd)} en modelo sobre ${formatearEntero(m.leadsNuevos.valor)} leads nuevos`}
            icono={Savings}
          />
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.55fr_1fr]">
        <Seccion
          titulo="Cómo resolvió cada turno"
          extra={cantidad(turnos, "turno")}
          nota="Las reglas IF/THEN no llaman al modelo para generar la respuesta: cada punto que sube esa franja baja el costo. El clasificador de intents sí corre en los tres casos, así que su gasto no se le imputa a ninguna franja."
        >
          <BarraReparto
            vacio="Sin turnos contestados en el período."
            partes={[
              {
                label: "Regla IF/THEN",
                cantidad: m.turnos.regla,
                color: "var(--color-ok)",
                detalle: `${formatearUsd(0)} en generación`,
              },
              {
                label: "LLM",
                cantidad: m.turnos.llm,
                color: "var(--color-brand)",
                detalle: formatearUsd(usdAgente),
              },
              {
                label: "Escalado a humano",
                cantidad: m.turnos.escalado,
                color: "var(--color-info)",
              },
            ]}
          />
        </Seccion>

        <Seccion
          titulo="Uso del catálogo"
          extra="llamadas del agente"
          nota="Una llamada fallida es la que devolvió error. Las que respondieron vacío no se distinguen todavía: el resultado se guarda como JSON sin un campo que diga si hubo match."
        >
          {m.herramientas.length === 0 ? (
            <p className="text-ink-faint text-[11.5px]">
              El agente no llamó a ninguna herramienta en el período.
            </p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {m.herramientas.map((h) => (
                <li key={h.nombre} className="flex items-center gap-2">
                  <DatabaseSearch size={13} className="text-ink-ghost shrink-0" aria-hidden />
                  <span className="text-ink-dim min-w-0 flex-1 truncate font-mono text-[11px]">
                    {h.nombre}
                  </span>
                  {h.fallidas > 0 ? (
                    <span
                      className="shrink-0 rounded-[5px] px-1.5 py-px font-mono text-[9.5px] font-semibold"
                      style={{
                        color: "var(--color-danger)",
                        backgroundColor: "color-mix(in srgb, var(--color-danger) 13%, transparent)",
                      }}
                    >
                      {formatearEntero(h.fallidas)} con error
                    </span>
                  ) : null}
                  <span className="text-ink-secondary w-14 shrink-0 text-right font-mono text-[11.5px] tabular-nums">
                    {formatearEntero(h.llamadas)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Seccion>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Seccion
          titulo="Intents sin regla"
          extra={`${formatearEntero(m.intentsSinRegla.length)} sin cubrir`}
          nota="Cada uno se responde con LLM hoy: escribirle una regla le saca el costo de generación. El costo diario es un reparto del gasto real usando el promedio de un turno del agente, porque el gasto se registra por turno y no por intent."
        >
          <IntentsSinRegla
            intents={m.intentsSinRegla}
            promedioTurnoUsd={m.gasto.promedioTurnoUsd}
            dias={m.dias}
          />
        </Seccion>

        <GastoIa gasto={m.gasto} dias={m.dias} />
      </div>
    </div>
  );
}
