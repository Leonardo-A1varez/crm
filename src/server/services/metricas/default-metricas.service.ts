import { porcentajeDe } from "@/lib/ui/metricas";
import { FUNNEL_STAGES } from "@/lib/ui/stage";
import type {
  FilaSesionMetrica,
  FilaToolExecutionMetrica,
  MetricsRepository,
} from "@/server/repositories/metrics.repo";
import { CANAL, CURRENT_STAGE, SENDER } from "@/types/domain";
import type { Canal, CurrentStage, Sender } from "@/types/domain";
import type {
  ConteoCanal,
  ConteoHerramienta,
  ConteoMotivo,
  IntentSinRegla,
  Metricas,
} from "@/types/metricas";
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

const DIA_MS = 24 * 60 * 60 * 1000;

/** Éxito sobre lo ya resuelto: las sesiones abiertas todavía no votaron. */
function tasaCierreDe(sesiones: FilaSesionMetrica[]): number {
  let exito = 0;
  let resueltas = 0;
  for (const s of sesiones) {
    if (s.resultado === null) continue;
    resueltas++;
    if (s.resultado === "exito") exito++;
  }
  return porcentajeDe(exito, resueltas);
}

export class DefaultMetricsService implements MetricsService {
  constructor(private readonly deps: { metrics: MetricsRepository }) {}

  async obtener(dias: number, ahora: Date = new Date()): Promise<Metricas> {
    const ventana = dias * DIA_MS;
    const desde = new Date(ahora.getTime() - ventana);
    // La ventana anterior se pide solo para sesiones y leads, que son tablas
    // chicas. Mensajes es el corte más caro de la pantalla y duplicarlo para
    // poder dibujar un delta más no lo justifica: por eso las métricas que
    // dependen de mensajes viajan con `anterior: null` y la UI no muestra delta.
    const desdeAnterior = new Date(desde.getTime() - ventana);

    const [sesionesAmbas, mensajes, leadsAmbos, reglas, tools, intents, reglasActivas] =
      await Promise.all([
        this.deps.metrics.listSesionesDesde(desdeAnterior),
        this.deps.metrics.listMensajesDesde(desde),
        this.deps.metrics.listLeadsDesde(desdeAnterior),
        this.deps.metrics.listRuleExecutionsDesde(desde),
        this.deps.metrics.listToolExecutionsDesde(desde),
        this.deps.metrics.listIntentsActivos(),
        this.deps.metrics.listReglasActivas(),
      ]);

    const corte = desde.getTime();
    const sesiones = sesionesAmbas.filter((s) => s.started_at.getTime() >= corte);
    const sesionesAnteriores = sesionesAmbas.filter((s) => s.started_at.getTime() < corte);
    const leadsNuevos = leadsAmbos.filter((l) => l.created_at.getTime() >= corte).length;
    const leadsAnteriores = leadsAmbos.length - leadsNuevos;

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
    const porCanalConteo = new Map<Canal, number>();
    // Un humano que escribió es la única señal de intervención que hay: la
    // asignación de vendedor (`mensajes.sender_user_id`) nunca se llenó.
    const sesionesConHumano = new Set<string>();
    for (const m of mensajes) {
      autoria[m.sender]++;
      porCanalConteo.set(m.canal, (porCanalConteo.get(m.canal) ?? 0) + 1);
      if (m.sender === "humano") sesionesConHumano.add(m.lead_session_id);
    }

    // Orden canónico y no por cantidad: la barra apilada se lee comparando
    // períodos, y reordenarla según quién ganó esta semana rompe esa lectura.
    const porCanal: ConteoCanal[] = CANAL.map((canal) => ({
      canal,
      cantidad: porCanalConteo.get(canal) ?? 0,
    })).filter((c) => c.cantidad > 0);

    let escaladas = 0;
    let tomadas = 0;
    let cierresIa = 0;
    let cierresVendedor = 0;
    for (const s of sesiones) {
      const escribioHumano = sesionesConHumano.has(s.id);
      if (escribioHumano) tomadas++;
      if (escribioHumano || s.current_stage === "requiere_humano") escaladas++;
      if (s.resultado === "exito") {
        // La atribución del cierre mira solo si un humano llegó a escribir:
        // una sesión parada en `requiere_humano` que nadie atendió la cerró la IA.
        if (escribioHumano) cierresVendedor++;
        else cierresIa++;
      }
    }

    // Cada fila de `rule_executions` es un turno que contestó una regla IF/THEN
    // en vez del LLM, así que el resto de lo que mandó la IA se resolvió con
    // modelo. El clamp cubre el desfase de borde: la regla se audita contra el
    // mensaje entrante y su saliente puede haber caído fuera de la ventana.
    const turnosRegla = Math.min(reglas.length, autoria.ia);
    const herramientas: ConteoHerramienta[] = agruparHerramientas(tools);

    // Un intent sin regla activa es uno que hoy contesta el LLM. Los más nuevos
    // primero: son los que el detector acaba de encontrar y nadie miró todavía.
    const conRegla = new Set(reglasActivas.map((r) => r.intent_id));
    const intentsSinRegla: IntentSinRegla[] = intents
      .filter((i) => !conRegla.has(i.id))
      .map((i) => ({
        id: i.id,
        nombre: i.nombre,
        descripcion: i.descripcion,
        autoDetectado: i.auto_detectado,
        detectadoEl: i.created_at,
      }))
      .sort(
        (a, b) =>
          b.detectadoEl.getTime() - a.detectadoEl.getTime() || a.nombre.localeCompare(b.nombre),
      );

    return {
      desde,
      dias,
      totalSesiones: sesiones.length,
      leadsNuevos: { valor: leadsNuevos, anterior: leadsAnteriores },
      tasaCierre: {
        valor: tasaCierreDe(sesiones),
        anterior: tasaCierreDe(sesionesAnteriores),
      },
      embudo: FUNNEL_STAGES.map((stage) => ({ stage, cantidad: porEtapa.get(stage) ?? 0 })),
      desvios: DESVIOS.map((stage) => ({ stage, cantidad: porEtapa.get(stage) ?? 0 })),
      porCanal,
      resultado: {
        abiertas: sesiones.length - exito - perdido,
        exito,
        perdido,
        porMotivo,
      },
      autoria,
      agente: {
        sinHumano: sesiones.length - escaladas,
        escaladas,
      },
      tomadasPorHumano: tomadas,
      cierres: { ia: cierresIa, vendedor: cierresVendedor },
      turnos: {
        regla: turnosRegla,
        llm: autoria.ia - turnosRegla,
        escalado: autoria.humano,
      },
      herramientas,
      intentsSinRegla,
    };
  }
}

/** Llamadas y fallas por herramienta, de la más usada a la menos. */
function agruparHerramientas(tools: FilaToolExecutionMetrica[]): ConteoHerramienta[] {
  const acc = new Map<string, ConteoHerramienta>();
  for (const t of tools) {
    const fila = acc.get(t.tool_name) ?? { nombre: t.tool_name, llamadas: 0, fallidas: 0 };
    fila.llamadas++;
    if (t.error !== null) fila.fallidas++;
    acc.set(t.tool_name, fila);
  }
  return [...acc.values()].sort(
    (a, b) => b.llamadas - a.llamadas || a.nombre.localeCompare(b.nombre),
  );
}
