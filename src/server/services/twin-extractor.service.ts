import type {
  LeadSessionRepository,
  LeadSessionUpdate,
  MarcasProcedencia,
} from "@/server/repositories/lead-session.repo";
import type {
  LeadVehiculosRepository,
  LeadVehiculoUpdate,
} from "@/server/repositories/lead-vehiculos.repo";
import {
  LeadTwinUpdateSchema,
  type LeadTwinUpdate,
  type VehiculoDetectado,
} from "@/lib/validation/ai";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { CLAVE_MOTIVO_SUGERIDO } from "@/lib/ui/motivo-perdida";
import { NoopSessionLock, type SessionLock } from "@/server/lock/session-lock";
import { CAMPOS_CON_PROCEDENCIA } from "@/types/domain";
import type { CampoConProcedencia } from "@/types/domain";
import type { LeadSession, Procedencia, UUID } from "@/types/entities";

export interface TwinExtractorInput {
  sessionId: UUID;
  conversationTurn: string[];
  /** Mensaje entrante que disparó el turno; queda anotado en la procedencia. */
  mensajeOrigenId?: UUID | null;
}

export interface TwinExtractorLLMInput {
  current: LeadSession;
  conversationTurn: string[];
  /** Mismo mensaje que ancla la procedencia; acá ancla además el gasto. */
  mensajeOrigenId?: UUID | null;
}

export interface TwinExtractorLLM {
  extract(input: TwinExtractorLLMInput): Promise<LeadTwinUpdate>;
}

export interface TwinExtractorService {
  extract(input: TwinExtractorInput): Promise<LeadSession>;
}

export class DefaultTwinExtractorService implements TwinExtractorService {
  constructor(
    private readonly sessions: LeadSessionRepository,
    private readonly llm: TwinExtractorLLM,
    private readonly vehiculos: LeadVehiculosRepository,
    private readonly lock: SessionLock = new NoopSessionLock(),
  ) {}

  async extract({
    sessionId,
    conversationTurn,
    mensajeOrigenId = null,
  }: TwinExtractorInput): Promise<LeadSession> {
    return this.lock.withLock(`twin:${sessionId}`, () =>
      this.runExtraction(sessionId, conversationTurn, mensajeOrigenId),
    );
  }

  private async runExtraction(
    sessionId: UUID,
    conversationTurn: string[],
    mensajeOrigenId: UUID | null,
  ): Promise<LeadSession> {
    const current = await this.sessions.findById(sessionId);
    if (!current)
      throw new NotFoundError(`sesión no encontrada: ${sessionId}`, "lead_session", sessionId);
    if (current.resultado !== null) return current;

    const raw = await this.llm.extract({ current, conversationTurn, mensajeOrigenId });
    const parseResult = LeadTwinUpdateSchema.safeParse(raw);
    if (!parseResult.success) {
      throw new ValidationError(
        "LLM devolvió patch inválido para LeadTwinUpdate",
        parseResult.error.issues,
        parseResult.error,
      );
    }
    const patch = parseResult.data;

    // `vehiculo` sale del patch antes de armar el update: el resto son columnas
    // de `lead_session` y el auto es del lead, en otra tabla y por otro repo.
    const { resultado, motivo_perdida, extras: patchExtras, vehiculo, ...mutable } = patch;

    let result = current;
    const updatePatch = descartarCorregidosAMano(
      filterDefined(mutable) as LeadSessionUpdate,
      current.procedencia,
    );

    // El extractor NO cierra sesiones. Un "no tenemos" del agente hacía que el
    // LLM devolviera `resultado: perdido` y el servicio cerrara la venta: la
    // conversación desaparecía del Inbox, entraba a la ventana de purga de 29
    // días y las métricas contaban una pérdida por stock que nunca ocurrió.
    // Pasó en la primera conversación real, y el prompt ya le pedía lo
    // contrario ("no cierres salvo evidencia clara").
    //
    // Cerrar es una decisión humana y tiene una sola puerta: el rail del Twin
    // (decisión cerrada, `AGENTS.md §2`). Lo que el LLM creía un cierre entra
    // como propuesta bajo `CLAVE_MOTIVO_SUGERIDO`, que es lo que el popover del
    // rail ofrece para que alguien confirme.
    const extrasFinales: Record<string, unknown> = { ...patchExtras };
    if (resultado === "perdido" && motivo_perdida) {
      extrasFinales[CLAVE_MOTIVO_SUGERIDO] = motivo_perdida;
    }

    // Shallow merge extras (no replace) — preserva keys previas.
    if (Object.keys(extrasFinales).length > 0) {
      updatePatch.extras = { ...current.extras, ...extrasFinales };
    }

    if (Object.keys(updatePatch).length > 0) {
      result = await this.sessions.aplicarExtraccion(
        sessionId,
        updatePatch,
        marcasDelExtractor(updatePatch, current, mensajeOrigenId),
      );
    }

    if (vehiculo) await this.guardarVehiculo(current.lead_id, vehiculo);

    return result;
  }

  /**
   * Deja el auto detectado en `lead_vehiculos`, sin pisar nada ya cargado.
   *
   * El auto no es un campo de la sesión: es del lead y vive en su propia tabla,
   * con su propia UI. Hasta acá el extractor no tenía por dónde escribirlo, así
   * que el agente entendía perfecto que le hablaban de un Aveo —se lo pasaba a
   * `buscar_repuesto` para buscar el repuesto— y el Twin del Inbox mostraba el
   * lead sin ningún auto. La información existía y se tiraba.
   *
   * Dos reglas, las dos conservadoras a propósito:
   *
   * 1. **Solo llena huecos.** Si el auto ya tiene `modelo`, el extractor no lo
   *    cambia. Un vendedor que escribió "Aveo Family" no puede perderlo porque
   *    el modelo entendió "Aveo" en el turno siguiente. Es la misma promesa que
   *    `descartarCorregidosAMano` hace con los campos de la sesión; acá alcanza
   *    con mirar el hueco porque `lead_vehiculos` no lleva procedencia.
   * 2. **No crea un segundo auto.** Decidir si "un Aveo" es el que ya está
   *    cargado o el otro auto del mismo cliente es criterio de negocio, no de un
   *    extractor: para eso está el botón de agregar vehículo. El primero sí lo
   *    crea, porque ahí no hay ambigüedad posible.
   *
   * Placa y VIN nunca se tocan acá: los dicta una persona y son con lo que el
   * detector compara autos entre leads.
   */
  private async guardarVehiculo(leadId: UUID, detectado: VehiculoDetectado): Promise<void> {
    const marca = limpiar(detectado.marca);
    const modelo = limpiar(detectado.modelo);
    const motor = limpiar(detectado.motor);
    const anio = detectado.anio ?? null;
    if (marca === null && modelo === null && motor === null && anio === null) return;

    // `listByLeadId` devuelve el principal primero.
    const [principal] = await this.vehiculos.listByLeadId(leadId);

    if (!principal) {
      await this.vehiculos.create({
        lead_id: leadId,
        marca,
        modelo,
        anio,
        motor,
        placa: null,
        placa_original: null,
        vin: null,
        vin_original: null,
        principal: true,
      });
      return;
    }

    const patch: LeadVehiculoUpdate = {};
    if (principal.marca === null && marca !== null) patch.marca = marca;
    if (principal.modelo === null && modelo !== null) patch.modelo = modelo;
    if (principal.anio === null && anio !== null) patch.anio = anio;
    if (principal.motor === null && motor !== null) patch.motor = motor;

    if (Object.keys(patch).length > 0) await this.vehiculos.update(principal.id, patch);
  }
}

/** Un `""` del modelo es "no sé", no un dato: no puede tapar el hueco. */
function limpiar(valor: string | null | undefined): string | null {
  const texto = valor?.trim();
  return texto ? texto : null;
}

/**
 * Una corrección humana gana sobre el extractor: el campo se saca del patch,
 * no se pisa. Es la promesa que el panel le hace al vendedor cuando le muestra
 * "Corregido por vos" — si el próximo turno lo revirtiera, corregir a mano no
 * serviría de nada.
 *
 * `current_stage` entra en el mismo trato desde que el rail del Twin es
 * clickeable. Sin esto el control sería mentira: el extractor recalcula la
 * etapa en cada turno, así que la etapa puesta a mano duraría hasta el próximo
 * mensaje del cliente. El costo es explícito: una vez movida a mano, la etapa
 * de esa sesión deja de avanzar sola y queda a cargo de la persona. La escalada
 * a `requiere_humano` no se ve afectada — la escriben el pipeline y el agente
 * con `sessions.update`, que no pasa por este filtro, y una guarda de seguridad
 * no puede depender de que nadie haya tocado el rail.
 */
function descartarCorregidosAMano(
  patch: LeadSessionUpdate,
  procedencia: Procedencia,
): LeadSessionUpdate {
  const out: LeadSessionUpdate = { ...patch };
  for (const campo of CAMPOS_CON_PROCEDENCIA) {
    if (procedencia[campo]?.por === "humano") delete out[campo];
  }
  return out;
}

/**
 * Marcas de procedencia de lo que acaba de escribir el extractor.
 *
 * Solo para los campos que el Twin declara (`CAMPOS_CON_PROCEDENCIA`): son los
 * únicos que muestran chip y línea de origen, y anotar el patch entero llenaría
 * el jsonb de filas que nadie lee.
 */
function marcasDelExtractor(
  patch: LeadSessionUpdate,
  current: LeadSession,
  mensajeOrigenId: UUID | null,
): MarcasProcedencia {
  const at = new Date().toISOString();
  const marcas: MarcasProcedencia = {};
  for (const campo of CAMPOS_CON_PROCEDENCIA) {
    if (patch[campo] === undefined) continue;
    marcas[campo] = {
      por: "ia",
      at,
      // El extractor no es un usuario: el `user_id` solo lo llena una persona.
      user_id: null,
      mensaje_origen_id: mensajeOrigenId,
      valor_anterior: valorAnterior(current, campo),
    };
  }
  return marcas;
}

function valorAnterior(session: LeadSession, campo: CampoConProcedencia): string | number | null {
  const previo: unknown = session[campo];
  if (typeof previo === "string" || typeof previo === "number") return previo;
  return null;
}

function filterDefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const k of Object.keys(obj) as Array<keyof T>) {
    if (obj[k] !== undefined) out[k] = obj[k];
  }
  return out;
}
