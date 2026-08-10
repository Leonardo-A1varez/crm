import { BarraReparto } from "@/components/metricas/BarraReparto";
import { BloqueFaltante, KpiFaltante } from "@/components/metricas/Faltante";
import { IntentsSinRegla } from "@/components/metricas/IntentsSinRegla";
import { Seccion } from "@/components/metricas/Seccion";
import { TarjetaKpi } from "@/components/metricas/TarjetaKpi";
import { DatabaseSearch, PanTool, SmartToy } from "@/components/icons";
import { formatearEntero, formatearPorcentaje, porcentajeDe } from "@/lib/ui/metricas";
import type { Metricas } from "@/types/metricas";

export function PanelAgente({ m }: { m: Metricas }) {
  const turnos = m.turnos.regla + m.turnos.llm + m.turnos.escalado;

  return (
    <div className="flex flex-col gap-4 p-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <TarjetaKpi
          label="Resueltas sin humano"
          valor={formatearPorcentaje(porcentajeDe(m.agente.sinHumano, m.totalSesiones))}
          subtitulo={`${formatearEntero(m.agente.sinHumano)} de ${formatearEntero(m.totalSesiones)} sesiones`}
          icono={SmartToy}
        />
        <TarjetaKpi
          label="Escaladas a humano"
          valor={formatearPorcentaje(porcentajeDe(m.agente.escaladas, m.totalSesiones))}
          subtitulo="escribió una persona, o la sesión está pidiendo una"
          icono={PanTool}
        />
        <KpiFaltante
          label="Latencia 1ra respuesta"
          falta="registrar cuándo llegó el mensaje del cliente. mensajes.created_at marca la inserción del webhook, así que el delta entrante→saliente mediría el tiempo de proceso y no la espera real."
        />
        <KpiFaltante
          label="Costo por lead"
          falta="persistir el gasto de cada turno junto al lead. El CostTracker solo lleva un total diario en memoria (Upstash no está configurado) y no lo atribuye a ninguna conversación."
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.55fr_1fr]">
        <Seccion
          titulo="Cómo resolvió cada turno"
          extra={`${formatearEntero(turnos)} turnos`}
          nota="Las reglas IF/THEN no consumen tokens: cada punto que sube esa franja baja el costo. Cuánto baja no se puede decir todavía — el gasto por turno no se guarda."
        >
          <BarraReparto
            vacio="Sin turnos contestados en el período."
            partes={[
              {
                label: "Regla IF/THEN",
                cantidad: m.turnos.regla,
                color: "var(--color-ok)",
                detalle: "sin tokens",
              },
              { label: "LLM", cantidad: m.turnos.llm, color: "var(--color-brand)" },
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
          nota="Cada uno se responde con LLM hoy: escribirle una regla lo vuelve gratis. Cuántas veces se usó cada uno y cuánto cuesta por día no se puede mostrar todavía — la clasificación de un turno solo queda registrada cuando matchea una regla, que es justo el caso opuesto al de esta lista, y el gasto por turno no se persiste."
        >
          <IntentsSinRegla intents={m.intentsSinRegla} />
        </Seccion>

        <BloqueFaltante
          label="Gasto de IA hoy"
          descripcion="La tarjeta destacada del handoff: gastado contra el tope diario, barra de consumo, estado del kill switch, tokens de entrada y salida, y el ahorro que generaron las reglas."
          falta="un contador de gasto que sobreviva al proceso. InMemoryCostTracker es el que está activo y se reinicia en cada cold start; UpstashCostTracker ya está escrito pero necesita UPSTASH_REDIS_REST_URL y UPSTASH_REDIS_REST_TOKEN. Los tokens de entrada/salida tampoco se guardan por turno."
        />
      </div>
    </div>
  );
}
