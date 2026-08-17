import { BarraReparto } from "@/components/metricas/BarraReparto";
import { EmbudoEtapas } from "@/components/metricas/EmbudoEtapas";
import { KpiFaltante } from "@/components/metricas/Faltante";
import { Seccion } from "@/components/metricas/Seccion";
import { TarjetaKpi } from "@/components/metricas/TarjetaKpi";
import { TopLista } from "@/components/metricas/TopLista";
import { VolumenCanal } from "@/components/metricas/VolumenCanal";
import { ContactEmergency, ReceiptLong, Savings, TaskAlt } from "@/components/icons";
import { MonoMeta } from "@/components/shared/MonoMeta";
import {
  cantidad,
  deltaPuntos,
  deltaRelativo,
  formatearEntero,
  formatearPorcentaje,
  formatearUsd,
} from "@/lib/ui/metricas";
import type { Metricas } from "@/types/metricas";

export function PanelTotal({ m }: { m: Metricas }) {
  const respuestas = m.autoria.ia + m.autoria.humano;

  return (
    <div className="flex flex-col gap-4 p-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <TarjetaKpi
          label="Leads nuevos"
          valor={formatearEntero(m.leadsNuevos.valor)}
          subtitulo={`entraron en los últimos ${m.dias} días`}
          delta={deltaRelativo(m.leadsNuevos)}
          icono={ContactEmergency}
        />
        <TarjetaKpi
          label="Tasa de cierre"
          valor={formatearPorcentaje(m.tasaCierre.valor)}
          subtitulo="sobre las sesiones ya resueltas"
          delta={deltaPuntos(m.tasaCierre)}
          icono={TaskAlt}
        />
        <KpiFaltante
          label="1ra respuesta"
          falta="medir el tiempo entre el mensaje entrante y el saliente que lo contesta. Hoy mensajes.created_at es la hora en que el webhook insertó la fila, no la hora en que el cliente escribió."
        />
        {m.gasto.porLeadUsd === null ? (
          <KpiFaltante
            label="Costo IA / lead"
            falta="leads en el período. El gasto sí está registrado; sin leads nuevos la división no tiene denominador y un cero diría que la IA salió gratis."
          />
        ) : (
          <TarjetaKpi
            label="Costo IA / lead"
            valor={formatearUsd(m.gasto.porLeadUsd)}
            subtitulo={`${formatearUsd(m.gasto.totalUsd)} en modelo sobre ${formatearEntero(m.leadsNuevos.valor)} leads nuevos`}
            icono={Savings}
          />
        )}
        <TarjetaKpi
          label="Ventas realizadas"
          valor={formatearEntero(m.ventas.conteo)}
          subtitulo="sesiones cerradas con éxito en el período"
          icono={ReceiptLong}
        />
        {m.ventas.montoTotalUsd === null ? (
          <KpiFaltante
            label="Ticket promedio"
            falta="ninguna de las ventas del período tiene precio_cotizado registrado."
          />
        ) : (
          <TarjetaKpi
            label="Ticket promedio"
            valor={formatearUsd(m.ventas.ticketPromedioUsd ?? 0)}
            subtitulo={`${formatearUsd(m.ventas.montoTotalUsd)} sobre ${formatearEntero(m.ventas.conPrecio)} de ${formatearEntero(m.ventas.conteo)} ventas con precio`}
            icono={Savings}
          />
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.55fr_1fr]">
        <Seccion
          titulo="Embudo por etapa"
          extra={cantidad(m.totalSesiones, "sesión", "sesiones")}
          nota="El porcentaje es sobre el total de sesiones del período: las etapas no se acumulan, cada sesión cuenta una sola vez en la etapa donde está hoy."
        >
          {m.totalSesiones === 0 ? (
            <p className="text-ink-faint text-[11.5px]">Sin sesiones en el período.</p>
          ) : (
            <>
              <EmbudoEtapas filas={m.embudo} total={m.totalSesiones} />
              {m.desvios.some((d) => d.cantidad > 0) ? (
                <div className="border-line-layout mt-3.5 border-t pt-3.5">
                  <p className="text-ink-ghost mb-2 text-[10.5px]">
                    Fuera del embudo: no son pasos siguientes, son salidas.
                  </p>
                  <EmbudoEtapas filas={m.desvios} total={m.totalSesiones} />
                </div>
              ) : null}
            </>
          )}
        </Seccion>

        <Seccion titulo="Volumen por canal" extra="mensajes">
          <VolumenCanal filas={m.porCanal} />
        </Seccion>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Seccion
          titulo="Quién cerró la venta"
          extra={`${formatearEntero(m.resultado.exito)} cerradas`}
          nota="Se atribuye al vendedor la sesión en la que una persona llegó a escribir. Sin ticket por sesión no se puede comparar el monto de cada lado."
        >
          <BarraReparto
            vacio="Ninguna sesión cerrada con éxito en el período."
            partes={[
              { label: "Agente IA", cantidad: m.cierres.ia, color: "var(--color-brand)" },
              { label: "Vendedor", cantidad: m.cierres.vendedor, color: "var(--color-info)" },
            ]}
          />
        </Seccion>

        <Seccion titulo="Quién contestó" extra={cantidad(respuestas, "respuesta")}>
          <BarraReparto
            vacio="Sin respuestas enviadas en el período."
            partes={[
              { label: "Agente IA", cantidad: m.autoria.ia, color: "var(--color-brand)" },
              { label: "Vendedor", cantidad: m.autoria.humano, color: "var(--color-info)" },
            ]}
          />
        </Seccion>
      </div>

      <Seccion titulo="Resultado de las sesiones">
        <div className="mb-4 flex flex-wrap items-end gap-7">
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
                  <MonoMeta>{formatearEntero(r.cantidad)}</MonoMeta>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-ink-faint text-[11.5px]">Ninguna sesión perdida en el período.</p>
        )}
      </Seccion>

      <div className="grid gap-4 lg:grid-cols-2">
        <Seccion
          titulo="Códigos más vendidos"
          extra={cantidad(m.codigosMasVendidos.length, "código")}
          nota="lead_session guarda 1 producto por sesión: si una conversación negoció varios repuestos, solo el último queda registrado. «Apariciones» es la métrica primaria; «unidades» solo suma las ventas que registraron cantidad."
        >
          <TopLista
            vacio="Ninguna venta con código de producto en el período."
            filas={m.codigosMasVendidos.map((c) => ({
              label: c.codigoInterno,
              meta: c.unidadesConDato > 0 ? `${formatearEntero(c.unidades)} unid.` : undefined,
              valor: c.apariciones,
            }))}
          />
        </Seccion>

        <Seccion
          titulo="Repuestos más preguntados"
          extra="demanda"
          nota="De las llamadas del agente a buscar_repuesto — no depende de tener catálogo cargado, es demanda pura. Los términos son texto libre y pueden fragmentar variantes de la misma pieza; se muestran los 15 más pedidos."
        >
          <p className="text-ink-ghost mb-2 text-[10.5px]">Por marca</p>
          <TopLista
            vacio="El agente no buscó ninguna marca en el período."
            filas={m.repuestosMasPreguntados.porMarca.map((r) => ({
              label: r.motivo,
              valor: r.cantidad,
            }))}
          />
          <p className="text-ink-ghost mt-3.5 mb-2 text-[10.5px]">Por término buscado</p>
          <TopLista
            vacio="El agente no buscó ningún término en el período."
            filas={m.repuestosMasPreguntados.porTermino.map((r) => ({
              label: r.motivo,
              valor: r.cantidad,
            }))}
          />
        </Seccion>
      </div>
    </div>
  );
}

function Cifra({ valor, label, color }: { valor: number; label: string; color?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span
        className="font-mono text-[26px] leading-none font-semibold tracking-[-0.03em]"
        style={color ? { color } : undefined}
      >
        {formatearEntero(valor)}
      </span>
      <span className="text-ink-faint text-[10.5px]">{label}</span>
    </div>
  );
}
