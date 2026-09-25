import { BudgetExceededError, IllegalStateError, ValidationError } from "@/lib/errors";
import type { CurrentStage } from "@/types/domain";
import type { UUID } from "@/types/entities";
import {
  MOTIVO_EXCLUSION,
  motivoDeSupresion,
  type CategoriaPlantilla,
  type MotivoExclusion,
  type OrigenSupresion,
  type RutaEnvio,
} from "./modelo";
import { normalizarTelefonoWhatsApp } from "./telefono";

/**
 * El planificador de envío de una difusión (docs/prd-workflows.md §7.4,
 * docs/prd-workflows-difusion.md §6.1, §7.3, §7.4).
 *
 * Función pura: recibe la audiencia ya resuelta y el estado del número, y
 * devuelve a quién se le manda, por qué ruta y en qué tanda —y a quién no, con
 * su motivo—. No lee la base ni llama a Meta: quien la usa trae los datos y
 * persiste el plan. Por eso se prueba entera sin montar nada.
 *
 * ────────────────────────────────────────────────────────────────────────
 * LA UNIDAD ES LA PERSONA, NO EL LEAD
 * ────────────────────────────────────────────────────────────────────────
 *
 * El chat de WhatsApp es del número. Dos leads con el mismo teléfono son una
 * sola persona para Meta: comparten la ventana de servicio, el cap de
 * marketing (131049) y el límite de 1 mensaje cada 6 s. Por eso:
 *
 * - bajas, ventana, saturación y tope de frecuencia se evalúan por teléfono;
 * - si UNO de los leads del número está con una persona, en conversación o
 *   negociando, no recibe NINGUNO: mandarle al otro es mandarle a la misma
 *   persona. El otro queda como `duplicado_telefono`;
 * - si ninguno tiene motivo, recibe uno solo: el del entrante más reciente,
 *   que es donde vive la conversación.
 *
 * ────────────────────────────────────────────────────────────────────────
 * EL CUPO ES CONSERVADOR A PROPÓSITO
 * ────────────────────────────────────────────────────────────────────────
 *
 * Cada tanda de 24 h lleva `restante − reserva` plantillas, también la de
 * mañana. Supone que el tráfico que hoy ya consumió cupo (el agente, los
 * workflows) se repite mañana: es la cuenta del ejemplo de §7.4 del PRD
 * (1.550 hoy · 1.550 mañana · 473 pasado). Mandar de más no cuesta plata,
 * cuesta el número; quedarse corto sólo alarga la difusión un día.
 */

export interface CandidatoDifusion {
  leadId: UUID;
  /** Tal como está en `leads.telefono`: con o sin `+`, con separadores, o un placeholder `ig:`/`fb:`. */
  telefono: string | null;
  /** `current_stage` de la sesión activa del lead; `null` si no tiene una abierta. */
  etapa: CurrentStage | null;
  /** Último mensaje entrante del lead: abre la ventana de servicio de 24 h. */
  ultimoEntranteAt: Date | null;
  /** Salientes automáticos (IA, workflows, difusiones) de las últimas 24 h. */
  salientesAutomaticos24h: number;
}

/** Una baja activa de `difusion_supresiones`. */
export interface SupresionActiva {
  telefono: string;
  origen: OrigenSupresion;
}

/** El último 131049 que Meta devolvió para ese teléfono. */
export interface SaturacionMeta {
  telefono: string;
  ultimoAt: Date;
}

export interface CupoDisponible {
  /** Destinatarios fuera de ventana que todavía entran en la ventana móvil de 24 h. Leído por API (§7.3). */
  restante: number;
  /** Apartado para conversaciones vivas: la difusión no lo toca. */
  reserva: number;
}

export interface PoliticaPlanificador {
  /** Una sesión activa con un entrante más nuevo que esto es una conversación en curso. */
  conversacionActivaMinutos: number;
  /** Una ventana que cierra antes de esto se trata como cerrada: el texto libre llegaría tarde (131047). */
  margenVentanaMinutos: number;
  /** Cuánto se respeta un 131049 antes de volver a intentar marketing con esa persona. */
  esperaSaturadoHoras: number;
}

/**
 * Cuánto hace del último entrante para que una conversación cuente como activa
 * y la difusión no se le cruce. Confirmado por el dueño 2026-09-24: el PRD habla
 * de "entrante reciente" sin dar un número.
 */
export const CONVERSACION_ACTIVA_MINUTOS = 60;

/**
 * Margen antes del cierre de la ventana de 24 h: una ventana que cierra antes
 * se trata como cerrada. Confirmado por el dueño 2026-09-24.
 */
export const MARGEN_VENTANA_MINUTOS = 60;

/**
 * `esperaSaturadoHoras` sale de Meta: tras un 131049 "hay que esperar ≥24 h"
 * (PRD §4.3). Los otros dos son decisión de producto, confirmada por el dueño
 * 2026-09-24. Se exponen para que el servicio los lea de configuración cuando
 * exista.
 */
export const POLITICA_POR_DEFECTO: Readonly<PoliticaPlanificador> = Object.freeze({
  conversacionActivaMinutos: CONVERSACION_ACTIVA_MINUTOS,
  margenVentanaMinutos: MARGEN_VENTANA_MINUTOS,
  esperaSaturadoHoras: 24,
});

export interface EntradaPlanificador {
  ahora: Date;
  audiencia: readonly CandidatoDifusion[];
  supresiones: readonly SupresionActiva[];
  saturaciones: readonly SaturacionMeta[];
  cupo: CupoDisponible;
  /** `agente_config.max_salientes_automaticos_24h`: el mismo tope que los workflows (§7.2). */
  maxSalientesAutomaticos24h: number;
  /** La plantilla para quien no tiene la ventana abierta. `null` = sólo texto libre en ventana. */
  plantilla: { categoria: CategoriaPlantilla } | null;
  /** `difusiones.incluir_en_negociacion`. */
  incluirEnNegociacion?: boolean;
  /** `difusiones.exenta_tope_frecuencia`. */
  exentaTopeFrecuencia?: boolean;
  /** No pagar: quien no tiene la ventana abierta queda `sin_ventana` aunque haya plantilla. */
  soloVentanaAbierta?: boolean;
  politica?: Partial<PoliticaPlanificador>;
}

export interface DestinatarioPlanificado {
  leadId: UUID;
  /** Normalizado: dígitos E.164 sin `+`. */
  telefono: string;
  ruta: RutaEnvio;
  /** 0 = hoy. */
  tanda: number;
  programadoPara: Date;
}

export interface ExclusionPlanificada {
  leadId: UUID;
  /** Normalizado; `null` sólo con `sin_telefono`. */
  telefono: string | null;
  motivo: MotivoExclusion;
}

export interface TandaPlanificada {
  tanda: number;
  desde: Date;
  porPlantilla: number;
  porVentanaAbierta: number;
}

export interface PlanDifusion {
  audienciaInicial: number;
  /** En orden de salida: por tanda, y dentro de cada tanda quien escribió más recientemente primero. */
  destinatarios: DestinatarioPlanificado[];
  /** Por precedencia del motivo y después por lead. */
  exclusiones: ExclusionPlanificada[];
  exclusionesPorMotivo: Record<MotivoExclusion, number>;
  porRuta: Record<RutaEnvio, number>;
  cupo: {
    restante: number;
    reserva: number;
    /** Plantillas que entran en cada tanda de 24 h. */
    porTanda: number;
    /** Plantillas que pide esta difusión. Las de ventana abierta no consumen cupo. */
    solicitado: number;
  };
  tandas: TandaPlanificada[];
}

const MINUTO_MS = 60_000;
const HORA_MS = 60 * MINUTO_MS;
const DIA_MS = 24 * HORA_MS;
/** La ventana de servicio de WhatsApp: 24 h desde el último mensaje del cliente (PRD §4.8). */
const VENTANA_SERVICIO_MS = DIA_MS;

const ETAPAS_NEGOCIACION: ReadonlySet<CurrentStage> = new Set<CurrentStage>([
  "negociando",
  "esperando_pago",
]);

const PRECEDENCIA = new Map<MotivoExclusion, number>(MOTIVO_EXCLUSION.map((m, i) => [m, i]));

interface Contexto {
  ahora: number;
  conversacionActivaMs: number;
  margenVentanaMs: number;
  plantilla: EntradaPlanificador["plantilla"];
  soloVentanaAbierta: boolean;
  incluirEnNegociacion: boolean;
  exentaTopeFrecuencia: boolean;
  maxSalientes: number;
}

/** Lo que vale para todos los leads de un mismo teléfono. */
interface Persona {
  bajaPropia: boolean;
  bajaMeta: boolean;
  ruta: RutaEnvio | null;
  saturada: boolean;
  salientes24h: number;
}

export function planificarDifusion(entrada: EntradaPlanificador): PlanDifusion {
  const politica = validarEntrada(entrada);
  exigirLeadsUnicos(entrada.audiencia);

  const ahora = entrada.ahora.getTime();
  const ctx: Contexto = {
    ahora,
    conversacionActivaMs: politica.conversacionActivaMinutos * MINUTO_MS,
    margenVentanaMs: politica.margenVentanaMinutos * MINUTO_MS,
    plantilla: entrada.plantilla,
    soloVentanaAbierta: entrada.soloVentanaAbierta ?? false,
    incluirEnNegociacion: entrada.incluirEnNegociacion ?? false,
    exentaTopeFrecuencia: entrada.exentaTopeFrecuencia ?? false,
    maxSalientes: entrada.maxSalientesAutomaticos24h,
  };
  const bajas = indexarBajas(entrada.supresiones);
  const saturadas = indexarSaturadas(
    entrada.saturaciones,
    ahora - politica.esperaSaturadoHoras * HORA_MS,
  );

  const exclusiones: ExclusionPlanificada[] = [];
  const porTelefono = new Map<string, CandidatoDifusion[]>();
  for (const candidato of entrada.audiencia) {
    const telefono = normalizarTelefonoWhatsApp(candidato.telefono);
    if (telefono === null) {
      exclusiones.push({ leadId: candidato.leadId, telefono: null, motivo: "sin_telefono" });
      continue;
    }
    const leads = porTelefono.get(telefono);
    if (leads) leads.push(candidato);
    else porTelefono.set(telefono, [candidato]);
  }

  const elegidos: { candidato: CandidatoDifusion; telefono: string; ruta: RutaEnvio }[] = [];
  for (const [telefono, leads] of porTelefono) {
    const persona = describirPersona(telefono, leads, bajas, saturadas, ctx);
    const motivos = leads.map((c) => motivoDelLead(c, persona, ctx));
    const ruta = persona.ruta;

    if (ruta === null || motivos.some((m) => m !== null)) {
      leads.forEach((c, i) =>
        exclusiones.push({
          leadId: c.leadId,
          telefono,
          motivo: motivos[i] ?? "duplicado_telefono",
        }),
      );
      continue;
    }

    const [representante, ...resto] = [...leads].sort(porPrioridad);
    if (representante) elegidos.push({ candidato: representante, telefono, ruta });
    for (const c of resto) {
      exclusiones.push({ leadId: c.leadId, telefono, motivo: "duplicado_telefono" });
    }
  }

  elegidos.sort((a, b) => porPrioridad(a.candidato, b.candidato));
  const solicitado = elegidos.filter((e) => e.ruta === "plantilla").length;
  const porTanda = Math.max(0, entrada.cupo.restante - entrada.cupo.reserva);
  if (solicitado > 0 && porTanda === 0) {
    throw new BudgetExceededError(
      `no hay cupo para plantillas: el restante de la ventana de 24 h (${entrada.cupo.restante}) ` +
        `no supera la reserva para conversaciones vivas (${entrada.cupo.reserva}). ` +
        `Los que tienen la ventana abierta pueden salir igual con soloVentanaAbierta.`,
      "cupo_mensajeria",
    );
  }

  let plantillasAsignadas = 0;
  const destinatarios: DestinatarioPlanificado[] = elegidos.map(({ candidato, telefono, ruta }) => {
    // Los de ventana abierta salen hoy: mañana su ventana puede estar cerrada.
    const tanda = ruta === "plantilla" ? Math.floor(plantillasAsignadas++ / porTanda) : 0;
    return {
      leadId: candidato.leadId,
      telefono,
      ruta,
      tanda,
      programadoPara: new Date(ahora + tanda * DIA_MS),
    };
  });
  // Estable: dentro de cada tanda se conserva el orden de prioridad.
  destinatarios.sort((a, b) => a.tanda - b.tanda);

  exclusiones.sort(
    (a, b) =>
      (PRECEDENCIA.get(a.motivo) ?? 0) - (PRECEDENCIA.get(b.motivo) ?? 0) ||
      compararIds(a.leadId, b.leadId),
  );

  const exclusionesPorMotivo = Object.fromEntries(MOTIVO_EXCLUSION.map((m) => [m, 0])) as Record<
    MotivoExclusion,
    number
  >;
  for (const e of exclusiones) exclusionesPorMotivo[e.motivo] += 1;

  const plan: PlanDifusion = {
    audienciaInicial: entrada.audiencia.length,
    destinatarios,
    exclusiones,
    exclusionesPorMotivo,
    porRuta: { ventana_abierta: destinatarios.length - solicitado, plantilla: solicitado },
    cupo: {
      restante: entrada.cupo.restante,
      reserva: entrada.cupo.reserva,
      porTanda,
      solicitado,
    },
    tandas: armarTandas(destinatarios, ahora),
  };

  // La última línea antes de devolver: un plan que no cuadra no sale de acá.
  verificarInvariantesPlan(entrada.audiencia, plan);
  return plan;
}

/**
 * Las reglas duras de un plan, verificadas sobre el resultado y no sobre el
 * código que lo armó. La primera es la del postmortem de Buttondown (16 de
 * octubre de 2025): **los destinatarios nunca superan la audiencia inicial**.
 * Si alguna se rompe, lanza `IllegalStateError` —no reintentable— y el envío
 * se aborta antes de la primera llamada a Meta.
 *
 * Exportada para que el motor la vuelva a correr sobre el plan persistido
 * antes de drenar la primera tanda.
 */
export function verificarInvariantesPlan(
  audiencia: readonly { leadId: UUID }[],
  plan: Pick<PlanDifusion, "destinatarios" | "exclusiones" | "tandas" | "cupo">,
): void {
  const n = audiencia.length;
  const m = plan.destinatarios.length;
  if (m > n) romper(`${m} destinatarios para una audiencia de ${n}`);

  const enAudiencia = new Set(audiencia.map((a) => a.leadId));
  const vistos = new Set<string>();
  for (const { leadId } of [...plan.destinatarios, ...plan.exclusiones]) {
    if (!enAudiencia.has(leadId)) romper(`el lead ${leadId} no estaba en la audiencia`);
    if (vistos.has(leadId)) romper(`el lead ${leadId} aparece dos veces en el plan`);
    vistos.add(leadId);
  }
  if (vistos.size !== n) {
    romper(
      `${n - vistos.size} leads de la audiencia no quedaron ni como destinatarios ni como excluidos`,
    );
  }

  const telefonos = new Set<string>();
  for (const d of plan.destinatarios) {
    if (telefonos.has(d.telefono))
      romper(`el destinatario ${d.leadId} comparte teléfono con otro destinatario`);
    telefonos.add(d.telefono);
  }

  const contadas = new Map<number, { porPlantilla: number; porVentanaAbierta: number }>();
  for (const d of plan.destinatarios) {
    const c = contadas.get(d.tanda) ?? { porPlantilla: 0, porVentanaAbierta: 0 };
    if (d.ruta === "plantilla") c.porPlantilla += 1;
    else c.porVentanaAbierta += 1;
    contadas.set(d.tanda, c);
  }
  const declaradas = new Set(plan.tandas.map((t) => t.tanda));
  for (const tanda of contadas.keys()) {
    if (!declaradas.has(tanda))
      romper(`hay destinatarios en la tanda ${tanda} y esa tanda no existe`);
  }
  for (const t of plan.tandas) {
    const c = contadas.get(t.tanda) ?? { porPlantilla: 0, porVentanaAbierta: 0 };
    if (c.porPlantilla !== t.porPlantilla || c.porVentanaAbierta !== t.porVentanaAbierta) {
      romper(
        `la tanda ${t.tanda} declara ${t.porPlantilla}+${t.porVentanaAbierta} y tiene ` +
          `${c.porPlantilla}+${c.porVentanaAbierta} destinatarios`,
      );
    }
    if (t.porPlantilla > plan.cupo.porTanda) {
      romper(
        `la tanda ${t.tanda} lleva ${t.porPlantilla} plantillas y el cupo por tanda es ${plan.cupo.porTanda}`,
      );
    }
  }
}

function romper(detalle: string): never {
  throw new IllegalStateError(
    `invariante del plan de difusión rota, se aborta antes de enviar: ${detalle}`,
    "invariante_difusion",
  );
}

function motivoDelLead(
  c: CandidatoDifusion,
  persona: Persona,
  ctx: Contexto,
): MotivoExclusion | null {
  if (persona.bajaPropia) return "baja_propia";
  if (persona.bajaMeta) return "baja_meta";
  if (c.etapa === "requiere_humano") return "requiere_humano";
  if (enConversacionActiva(c, ctx)) return "conversacion_activa";
  if (persona.ruta === null) return "sin_ventana";
  // El cap de 131049 es de plantillas de marketing: el texto libre dentro de la
  // ventana y las plantillas utility no cuentan (PRD §4.3).
  if (
    persona.ruta === "plantilla" &&
    ctx.plantilla?.categoria === "marketing" &&
    persona.saturada
  ) {
    return "saturado_meta";
  }
  if (!ctx.exentaTopeFrecuencia && persona.salientes24h >= ctx.maxSalientes)
    return "cap_frecuencia";
  if (!ctx.incluirEnNegociacion && c.etapa !== null && ETAPAS_NEGOCIACION.has(c.etapa)) {
    return "en_negociacion";
  }
  return null;
}

/** Sesión abierta y un entrante reciente: el agente o un vendedor están hablando con esta persona. */
function enConversacionActiva(c: CandidatoDifusion, ctx: Contexto): boolean {
  if (c.etapa === null || c.ultimoEntranteAt === null) return false;
  return ctx.ahora - c.ultimoEntranteAt.getTime() <= ctx.conversacionActivaMs;
}

function describirPersona(
  telefono: string,
  leads: readonly CandidatoDifusion[],
  bajas: ReadonlyMap<string, ReadonlySet<"baja_propia" | "baja_meta">>,
  saturadas: ReadonlySet<string>,
  ctx: Contexto,
): Persona {
  const ultimo = entranteMasReciente(leads);
  // Abierta y con margen: una ventana que cierra en diez minutos no alcanza
  // para que el texto libre llegue antes de que Meta lo rechace.
  const ventanaAbierta =
    ultimo !== null && ctx.ahora - ultimo < VENTANA_SERVICIO_MS - ctx.margenVentanaMs;
  const ruta: RutaEnvio | null = ventanaAbierta
    ? "ventana_abierta"
    : ctx.plantilla !== null && !ctx.soloVentanaAbierta
      ? "plantilla"
      : null;
  const motivosDeBaja = bajas.get(telefono);
  return {
    bajaPropia: motivosDeBaja?.has("baja_propia") ?? false,
    bajaMeta: motivosDeBaja?.has("baja_meta") ?? false,
    ruta,
    saturada: saturadas.has(telefono),
    salientes24h: leads.reduce((total, c) => total + c.salientesAutomaticos24h, 0),
  };
}

function entranteMasReciente(leads: readonly CandidatoDifusion[]): number | null {
  let max: number | null = null;
  for (const c of leads) {
    const t = c.ultimoEntranteAt?.getTime();
    if (t !== undefined && (max === null || t > max)) max = t;
  }
  return max;
}

function indexarBajas(
  supresiones: readonly SupresionActiva[],
): Map<string, Set<"baja_propia" | "baja_meta">> {
  const porTelefono = new Map<string, Set<"baja_propia" | "baja_meta">>();
  for (const s of supresiones) {
    // En la base el teléfono ya está normalizado (CHECK E.164); normalizar acá
    // cubre a quien arme la entrada a mano.
    const telefono = normalizarTelefonoWhatsApp(s.telefono);
    if (telefono === null) continue;
    const motivos = porTelefono.get(telefono) ?? new Set<"baja_propia" | "baja_meta">();
    motivos.add(motivoDeSupresion(s.origen));
    porTelefono.set(telefono, motivos);
  }
  return porTelefono;
}

function indexarSaturadas(saturaciones: readonly SaturacionMeta[], desde: number): Set<string> {
  const saturadas = new Set<string>();
  for (const s of saturaciones) {
    const telefono = normalizarTelefonoWhatsApp(s.telefono);
    if (telefono !== null && s.ultimoAt.getTime() > desde) saturadas.add(telefono);
  }
  return saturadas;
}

function armarTandas(
  destinatarios: readonly DestinatarioPlanificado[],
  ahora: number,
): TandaPlanificada[] {
  const porIndice = new Map<number, TandaPlanificada>();
  for (const d of destinatarios) {
    let t = porIndice.get(d.tanda);
    if (t === undefined) {
      t = {
        tanda: d.tanda,
        desde: new Date(ahora + d.tanda * DIA_MS),
        porPlantilla: 0,
        porVentanaAbierta: 0,
      };
      porIndice.set(d.tanda, t);
    }
    if (d.ruta === "plantilla") t.porPlantilla += 1;
    else t.porVentanaAbierta += 1;
  }
  return [...porIndice.values()].sort((a, b) => a.tanda - b.tanda);
}

/**
 * Quien escribió más recientemente va primero: es quien tiene la conversación
 * más viva, y a igualdad decide el id para que el plan no dependa del orden en
 * que llegó la audiencia.
 */
function porPrioridad(a: CandidatoDifusion, b: CandidatoDifusion): number {
  const ta = a.ultimoEntranteAt?.getTime() ?? null;
  const tb = b.ultimoEntranteAt?.getTime() ?? null;
  if (ta !== tb) {
    if (ta === null) return 1;
    if (tb === null) return -1;
    return tb - ta;
  }
  return compararIds(a.leadId, b.leadId);
}

function compararIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function exigirLeadsUnicos(audiencia: readonly CandidatoDifusion[]): void {
  const vistos = new Set<string>();
  for (const { leadId } of audiencia) {
    if (vistos.has(leadId)) {
      throw new IllegalStateError(
        `la audiencia llegó con el lead ${leadId} repetido: la resolución está multiplicando ` +
          `filas. Se aborta antes de planificar.`,
        "invariante_difusion",
      );
    }
    vistos.add(leadId);
  }
}

function validarEntrada(e: EntradaPlanificador): PoliticaPlanificador {
  if (!(e.ahora instanceof Date) || Number.isNaN(e.ahora.getTime())) {
    invalida("`ahora` no es una fecha válida");
  }
  exigirEnteroNoNegativo(e.cupo.restante, "cupo.restante");
  exigirEnteroNoNegativo(e.cupo.reserva, "cupo.reserva");
  if (!Number.isInteger(e.maxSalientesAutomaticos24h) || e.maxSalientesAutomaticos24h < 1) {
    invalida(
      `maxSalientesAutomaticos24h tiene que ser un entero ≥ 1 (llegó ${e.maxSalientesAutomaticos24h})`,
    );
  }
  for (const c of e.audiencia) {
    exigirEnteroNoNegativo(c.salientesAutomaticos24h, `salientesAutomaticos24h de ${c.leadId}`);
    if (c.ultimoEntranteAt !== null && Number.isNaN(c.ultimoEntranteAt.getTime())) {
      invalida(`ultimoEntranteAt de ${c.leadId} no es una fecha válida`);
    }
  }
  for (const s of e.saturaciones) {
    if (Number.isNaN(s.ultimoAt.getTime())) invalida("una saturación trae una fecha inválida");
  }

  const p = e.politica ?? {};
  const politica: PoliticaPlanificador = {
    conversacionActivaMinutos:
      p.conversacionActivaMinutos ?? POLITICA_POR_DEFECTO.conversacionActivaMinutos,
    margenVentanaMinutos: p.margenVentanaMinutos ?? POLITICA_POR_DEFECTO.margenVentanaMinutos,
    esperaSaturadoHoras: p.esperaSaturadoHoras ?? POLITICA_POR_DEFECTO.esperaSaturadoHoras,
  };
  for (const [clave, valor] of Object.entries(politica)) {
    if (!Number.isFinite(valor) || valor <= 0)
      invalida(`politica.${clave} tiene que ser positivo (llegó ${valor})`);
  }
  return politica;
}

function exigirEnteroNoNegativo(n: number, nombre: string): void {
  if (!Number.isInteger(n) || n < 0) invalida(`${nombre} tiene que ser un entero ≥ 0 (llegó ${n})`);
}

function invalida(detalle: string): never {
  throw new ValidationError(`entrada del planificador inválida: ${detalle}`);
}
