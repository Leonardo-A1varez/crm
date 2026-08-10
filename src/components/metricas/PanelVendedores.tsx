import { BarraReparto } from "@/components/metricas/BarraReparto";
import { BloqueFaltante, KpiFaltante } from "@/components/metricas/Faltante";
import { Seccion } from "@/components/metricas/Seccion";
import { TarjetaKpi } from "@/components/metricas/TarjetaKpi";
import { Group, TaskAlt } from "@/components/icons";
import { formatearEntero, formatearPorcentaje, porcentajeDe } from "@/lib/ui/metricas";
import { stageColor } from "@/lib/ui/stage";
import type { Metricas } from "@/types/metricas";

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
        <KpiFaltante
          label="Tiempo hasta tomar"
          falta="marcar cuándo se pidió el humano y cuándo contestó. La sesión guarda la etapa actual, no el instante en que entró en requiere_humano."
        />
      </div>

      <BloqueFaltante
        label="Rendimiento por vendedor"
        descripcion="La tabla del handoff: vendedor, tomadas, tiempo de toma, cerradas, ticket promedio y tasa de cierre, una fila por persona."
        falta="saber qué persona mandó cada mensaje. La columna mensajes.sender_user_id existe desde el primer día pero nunca se llenó: el envío la escribe siempre en null porque el panel todavía no le pasa el usuario autenticado. Sin eso, todo lo humano es una sola bolsa anónima y ninguna fila de esta tabla se puede armar."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Seccion
          titulo="Reparto de la atención"
          extra={`${formatearEntero(m.totalSesiones)} sesiones`}
          nota="Es lo más cerca que se puede estar hoy del corte por vendedor: separa lo que tocó una persona de lo que no, sin poder decir cuál."
        >
          <BarraReparto
            vacio="Sin sesiones en el período."
            partes={[
              {
                label: "Las resolvió el agente",
                cantidad: m.agente.sinHumano,
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
