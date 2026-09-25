import { BarraReparto } from "@/components/metricas/BarraReparto";
import { KpiFaltante } from "@/components/metricas/Faltante";
import { Seccion } from "@/components/metricas/Seccion";
import { TarjetaKpi } from "@/components/metricas/TarjetaKpi";
import { DoneAll, Group, Schedule, TaskAlt } from "@/components/icons";
import {
  COLORES_ATENCION,
  TRAMOS_RAMPA,
  cantidad,
  escalaSecuencial,
  formatearEntero,
  formatearEspera,
  formatearPorcentaje,
  formatearUsd,
  porcentajeDe,
} from "@/lib/ui/metricas";
import type { ConteoMotivo, Metricas } from "@/types/metricas";
import type { Parte } from "@/components/metricas/BarraReparto";

/**
 * Los motivos de escalado, listos para la barra.
 *
 * `razonesEscalado` ya viene ordenado de mayor a menor por el service, y ese
 * orden es lo que ata cada franja con su renglón numerado en la leyenda. La
 * cola se agrupa en vez de seguir estirando la rampa: a partir del sexto tramo
 * dos contiguos se separan ΔE 7,1 y dejan de distinguirse (`TRAMOS_RAMPA`).
 * Agrupar dice la verdad —el conteo sigue estando— y no inventa colores que no
 * se leen.
 */
function motivosParaLaBarra(razones: readonly ConteoMotivo[]): Parte[] {
  const colores = escalaSecuencial(Math.min(razones.length, TRAMOS_RAMPA));
  if (razones.length <= TRAMOS_RAMPA) {
    return razones.map((r, i) => ({
      label: r.motivo,
      cantidad: r.cantidad,
      color: colores[i] ?? colores[colores.length - 1] ?? "var(--color-info)",
    }));
  }

  const visibles = razones.slice(0, TRAMOS_RAMPA - 1);
  const cola = razones.slice(TRAMOS_RAMPA - 1);
  const partes: Parte[] = visibles.map((r, i) => ({
    label: r.motivo,
    cantidad: r.cantidad,
    color: colores[i] ?? "var(--color-info)",
  }));
  partes.push({
    label: "Otros motivos",
    cantidad: cola.reduce((acc, r) => acc + r.cantidad, 0),
    color: colores[colores.length - 1] ?? "var(--color-info)",
    detalle: cantidad(cola.length, "motivo"),
  });
  return partes;
}

/**
 * La tabla del handoff §3.3, con las columnas que hoy tienen dato.
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
      : "«Toma» es la mediana de lo que el cliente esperó hasta la primera respuesta de esa persona.";

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
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
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
        {m.ventas.montoTotalUsd === null ? (
          <KpiFaltante
            label="Ticket promedio"
            falta="ninguna venta del período tiene precio_cotizado registrado."
          />
        ) : (
          <TarjetaKpi
            label="Ticket promedio"
            valor={formatearUsd(m.ventas.ticketPromedioUsd ?? 0)}
            subtitulo={`sobre ${formatearEntero(m.ventas.conPrecio)} ventas con precio (todas las fuentes)`}
            icono={TaskAlt}
          />
        )}
        {/* Mediana y no promedio: una sesión que quedó abierta de un viernes a
            un lunes corre el promedio de todos y no dice nada del equipo. */}
        <TarjetaKpi
          label="Tiempo hasta tomar"
          valor={formatearEspera(m.vendedores.tomaEnSegundos)}
          subtitulo={
            m.vendedores.muestras === 0
              ? "Sin datos medibles"
              : `${formatearEntero(m.vendedores.muestras)} muestras con timestamp de Meta`
          }
          icono={Schedule}
        />
        <TarjetaKpi
          label="Tiempo en cerrar"
          valor={formatearEspera(m.tiempoCierre.medianaSegundos)}
          subtitulo={
            m.tiempoCierre.muestras === 0
              ? "Sin sesiones resueltas"
              : `mediana sobre ${formatearEntero(m.tiempoCierre.muestras)} sesiones resueltas`
          }
          icono={DoneAll}
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
                color: COLORES_ATENCION.resueltoPorAgente,
              },
              {
                label: "Las tomó una persona",
                cantidad: m.tomadasPorHumano,
                color: COLORES_ATENCION.tomadoPorPersona,
              },
              {
                label: "Esperando a una persona",
                cantidad: esperando,
                color: COLORES_ATENCION.sinAtender,
                detalle: "pidió humano y nadie contestó",
              },
            ]}
          />
        </Seccion>

        <Seccion
          titulo="Por qué se escaló a humano"
          extra={cantidad(
            m.razonesEscalado.reduce((acc, r) => acc + r.cantidad, 0),
            "escalado",
          )}
          nota="Cada pausa registrada en handoff_events, con su motivo."
        >
          {/* Numerada y con rampa, no categórica: un motivo de escalado no
              tiene color propio, y la escala anterior repetía colores con `%`
              apenas había más de seis. */}
          <BarraReparto
            numerada
            vacio="Ninguna conversación se escaló a humano en el período."
            partes={motivosParaLaBarra(m.razonesEscalado)}
          />
        </Seccion>
      </div>
    </div>
  );
}
