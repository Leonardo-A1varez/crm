import { FUNNEL_STAGES } from "@/lib/ui/stage";
import type { MetricsRepository } from "@/server/repositories/metrics.repo";
import { CURRENT_STAGE, SENDER } from "@/types/domain";
import type { CurrentStage, Sender } from "@/types/domain";
import type { ConteoMotivo, Metricas } from "@/types/metricas";
import type { MetricsService } from "./metricas.service";

const MOTIVO_LABEL: Record<string, string> = {
  precio: "Precio",
  stock: "Sin stock",
  tiempo: "Tiempos de entrega",
  no_responde: "No responde",
  otro: "Otro",
};

/** Etapas que no son el embudo: se cuentan aparte para no falsear el progreso. */
const DESVIOS: CurrentStage[] = CURRENT_STAGE.filter(
  (s) => !(FUNNEL_STAGES as readonly string[]).includes(s),
);

export class DefaultMetricsService implements MetricsService {
  constructor(private readonly deps: { metrics: MetricsRepository }) {}

  async obtener(dias: number, ahora: Date = new Date()): Promise<Metricas> {
    const desde = new Date(ahora.getTime() - dias * 24 * 60 * 60 * 1000);

    const [sesiones, mensajes] = await Promise.all([
      this.deps.metrics.listSesionesDesde(desde),
      this.deps.metrics.listMensajesDesde(desde),
    ]);

    const porEtapa = new Map<CurrentStage, number>();
    for (const s of sesiones) {
      porEtapa.set(s.current_stage, (porEtapa.get(s.current_stage) ?? 0) + 1);
    }

    const motivos = new Map<string, number>();
    let exito = 0;
    let perdido = 0;
    for (const s of sesiones) {
      if (s.resultado === "exito") exito++;
      else if (s.resultado === "perdido") {
        perdido++;
        // El motivo puede venir null incluso en una sesión perdida: se cierra
        // sin motivo desde la UI y contarlo como "otro" mentiría sobre el dato.
        const clave = s.motivo_perdida ?? "sin_motivo";
        motivos.set(clave, (motivos.get(clave) ?? 0) + 1);
      }
    }

    const porMotivo: ConteoMotivo[] = [...motivos.entries()]
      .map(([motivo, cantidad]) => ({
        motivo:
          motivo === "sin_motivo" ? "Sin motivo registrado" : (MOTIVO_LABEL[motivo] ?? motivo),
        cantidad,
      }))
      .sort((a, b) => b.cantidad - a.cantidad || a.motivo.localeCompare(b.motivo));

    const autoria = Object.fromEntries(SENDER.map((s) => [s, 0])) as Record<Sender, number>;
    for (const m of mensajes) autoria[m.sender]++;

    return {
      desde,
      dias,
      totalSesiones: sesiones.length,
      embudo: FUNNEL_STAGES.map((stage) => ({ stage, cantidad: porEtapa.get(stage) ?? 0 })),
      desvios: DESVIOS.map((stage) => ({ stage, cantidad: porEtapa.get(stage) ?? 0 })),
      resultado: {
        abiertas: sesiones.length - exito - perdido,
        exito,
        perdido,
        porMotivo,
      },
      autoria,
    };
  }
}
