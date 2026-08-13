import { BarraReparto } from "@/components/metricas/BarraReparto";
import { BloqueFaltante, KpiFaltante } from "@/components/metricas/Faltante";
import { Seccion } from "@/components/metricas/Seccion";
import { TarjetaKpi } from "@/components/metricas/TarjetaKpi";
import { Group, Schedule, TaskAlt } from "@/components/icons";
import {
  cantidad,
  formatearEntero,
  formatearEspera,
  formatearPorcentaje,
  porcentajeDe,
} from "@/lib/ui/metricas";
import { stageColor } from "@/lib/ui/stage";
import type { Metricas } from "@/types/metricas";

/**
 * La tabla del handoff §3.3, con las columnas que hoy tienen dato. "Ticket
 * promedio" no está: `precio_cotizado` es lo cotizado y no lo facturado.
 *
 * Las sesiones que tomó alguien sin usuario registrado viajan aparte y se
 * declaran al pie en vez de repartirse: son las anteriores a que el envío del
 * panel propagara `sender_user_id`, y meterlas en una fila inventaría trabajo.
 */
function TablaVendedores({ vendedores }: { vendedores: Metricas["vendedores"] }) {
  const { filas, sinAtribuir, tomaEnSegundos } = vendedores;

  const nota =
    sinAtribuir > 0
      ? `${formatearEntero(sinAtribuir)} ${sinAtribuir === 1 ? "sesión tomada" : "sesiones tomadas"} sin usuario registrado: son anteriores a que el envío del panel guardara quién escribió. No se reparten entre las filas.`
      : "«Toma» es la mediana de lo que el cliente esperó hasta la primera respuesta de esa persona. «Ticket promedio» no está: lo que la sesión guarda es lo cotizado, no lo facturado.";

  return (
    <Seccion
      titulo="Rendimiento por vendedor"
      extra={tomaEnSegundos !== null ? `toma global ${formatearEspera(tomaEnSegundos)}` : undefined}
      nota={nota}
    >
      {filas.length === 0 ? (
        <p className="text-ink-faint text-[11.5px]">
          Ninguna persona tomó una conversación en el período.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] border-collapse text-left">
            <thead>
              <tr className="text-ink-ghost font-mono text-[9px] tracking-[0.13em] uppercase">
                <th className="pb-2 font-semibold">Vendedor</th>
                <th className="pb-2 text-right font-semibold">Tomadas</th>
                <th className="pb-2 text-right font-semibold">Toma</th>
                <th className="pb-2 text-right font-semibold">Cerradas</th>
                <th className="pb-2 text-right font-semibold">Cierre</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.usuarioId} className="border-line-row border-t">
                  <td className="text-ink-secondary py-2 text-[11.5px]">{f.nombre}</td>
                  <td className="text-ink-body py-2 text-right font-mono text-[11.5px]">
                    {formatearEntero(f.tomadas)}
                  </td>
                  <td className="text-ink-dim py-2 text-right font-mono text-[11.5px]">
                    {formatearEspera(f.tomaEnSegundos)}
                  </td>
                  <td className="text-ink-body py-2 text-right font-mono text-[11.5px]">
                    {formatearEntero(f.cerradas)}
                  </td>
                  <td className="text-ink-body py-2 text-right font-mono text-[11.5px]">
                    {formatearPorcentaje(f.cierre)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Seccion>
  );
}

export function PanelVendedores({ m }: { m: Metricas }) {
  // Las escaladas que nadie contestó todavía. Restar en vez de leer el conteo
  // de requiere_humano mantiene las tres partes disjuntas: una sesión que
  // pidió humano y además fue atendida ya está contada en las tomadas.
  const esperando = m.agente.escaladas - m.tomadasPorHumano;

  return (
    <div className="flex flex-col gap-4 p-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <TarjetaKpi
          label="Conversaciones tomadas"
          valor={formatearEntero(m.tomadasPorHumano)}
          subtitulo="sesiones en las que una persona escribió"
          icono={Group}
        />
        <TarjetaKpi
          label="Cierre tras handoff"
          valor={formatearPorcentaje(porcentajeDe(m.cierres.vendedor, m.tomadasPorHumano))}
          subtitulo={`${formatearEntero(m.cierres.vendedor)} cerradas de ${formatearEntero(m.tomadasPorHumano)} tomadas`}
          icono={TaskAlt}
        />
        <KpiFaltante
          label="Ticket promedio"
          falta="un monto por sesión cerrada. lead_session.precio_cotizado es lo que se cotizó, no lo que se facturó, y no hay tabla de venta ni de orden."
        />
        {/* Mediana y no promedio: una sesión que quedó abierta de un viernes a
            un lunes corre el promedio de todos y no dice nada del equipo. */}
        <TarjetaKpi
          label="Tiempo hasta tomar"
          valor={formatearEspera(m.vendedores.tomaEnSegundos)}
          subtitulo={
            m.tiempoPrimeraRespuesta.personas.muestras === 0
              ? "Sin datos medibles"
              : `${formatearEntero(m.tiempoPrimeraRespuesta.personas.muestras)} muestras con timestamp de Meta`
          }
          icono={Schedule}
        />
      </div>

      <TablaVendedores vendedores={m.vendedores} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Seccion
          titulo="Reparto de la atención"
          extra={cantidad(m.totalSesiones, "sesión", "sesiones")}
          nota="Es lo más cerca que se puede estar hoy del corte por vendedor: separa lo que tocó una persona de lo que no, sin poder decir cuál."
        >
          <BarraReparto
            vacio="Sin sesiones en el período."
            partes={[
              {
                label: "Las resolvió el agente",
                cantidad: m.agente.sinIntervencionHumana,
                color: "var(--color-brand)",
              },
              {
                label: "Las tomó una persona",
                cantidad: m.tomadasPorHumano,
                color: "var(--color-info)",
              },
              {
                label: "Esperando a una persona",
                cantidad: esperando,
                color: stageColor("requiere_humano"),
                detalle: "pidió humano y nadie contestó",
              },
            ]}
          />
        </Seccion>

        <BloqueFaltante
          label="Por qué se escaló a humano"
          descripcion="El desglose del handoff por motivo: pidió humano, intent desconocido, pausa manual, bloqueador sin resolver."
          falta="registrar el motivo del handoff. La sesión termina en requiere_humano sin guardar qué lo disparó, así que los cuatro motivos no se pueden separar: hoy solo se sabe el total."
        />
      </div>
    </div>
  );
}
