import { VENTANA_ATRIBUCION_DIAS } from "@/lib/difusion/respuesta";
import { ConflictError, RateLimitError } from "@/lib/errors";
import { errorDeGraph } from "@/lib/meta/error-graph";
import type { MessagesRepository } from "@/server/repositories/messages.repo";
import type {
  PlantillaSinSesion,
  WorkflowPlantillasSinSesionRepository,
} from "@/server/repositories/workflow-plantillas-sin-sesion.repo";
import {
  contenidoDePlantilla,
  type MetaApiClient,
  type PlantillaMeta,
} from "@/server/services/meta-api.service";
import type { EstadoEntrega } from "@/types/domain";
import type { UUID } from "@/types/entities";

/**
 * La plantilla de un flujo a un lead SIN sesión.
 *
 * "Reactivar perdidos" le escribe a leads cuya última sesión está cerrada, y
 * el cron no le pasa esa sesión a la corrida (`workflow-programados.ts`).
 * `MetaApiService.sendTemplate` escribe en `mensajes`, que exige una sesión:
 * por eso fallaba con `lead_session_id_ausente`. Se resuelve con el mismo
 * criterio que el motor de difusión:
 *
 * - **Al mandar**: reserva en `workflow_plantillas_sin_sesion` ANTES de llamar
 *   a Meta, con la clave `wf:<runId>:<orden>`. Un reintento ve la reserva y no
 *   manda otra vez; mismo contrato que `MetaApiService.enviar`: un 429 libera
 *   la reserva (no salió nada), cualquier otro error la deja fallida y no se
 *   reenvía (un WhatsApp duplicado no se puede retirar).
 * - **Al responder**: el pipeline de entrada la anota en el hilo de la sesión
 *   que abre el entrante, con la hora en que salió (`DefaultAnotar...`).
 */

export interface EnviarPlantillaSinSesionInput {
  idempotencyKey: string;
  workflowRunId: UUID;
  leadId: UUID;
  conversacionId: UUID;
  to: string;
  plantilla: PlantillaMeta;
}

export interface EnvioPlantillaSinSesion {
  enviar(
    input: EnviarPlantillaSinSesionInput,
  ): Promise<{ id: UUID; meta_message_id: string | null }>;
  /** Para el tope de frecuencia: lo que salió y todavía no está en `mensajes`. */
  contarNoAnotadasDesde(leadId: UUID, desde: Date): Promise<number>;
}

export interface EnvioPlantillaSinSesionDeps {
  repo: Pick<
    WorkflowPlantillasSinSesionRepository,
    | "findByIdempotencyKey"
    | "reservar"
    | "marcarAceptado"
    | "marcarFallido"
    | "liberarReserva"
    | "contarNoAnotadasDesde"
  >;
  meta: Pick<MetaApiClient, "sendTemplate">;
  ahora?: () => Date;
}

const LARGO_DETALLE = 1000;

export class DefaultEnvioPlantillaSinSesion implements EnvioPlantillaSinSesion {
  private readonly ahora: () => Date;

  constructor(private readonly deps: EnvioPlantillaSinSesionDeps) {
    this.ahora = deps.ahora ?? (() => new Date());
  }

  contarNoAnotadasDesde(leadId: UUID, desde: Date): Promise<number> {
    return this.deps.repo.contarNoAnotadasDesde(leadId, desde);
  }

  async enviar(
    input: EnviarPlantillaSinSesionInput,
  ): Promise<{ id: UUID; meta_message_id: string | null }> {
    const previa = await this.deps.repo.findByIdempotencyKey(input.idempotencyKey);
    if (previa) return { id: previa.id, meta_message_id: previa.meta_message_id };

    let reserva: PlantillaSinSesion;
    try {
      reserva = await this.deps.repo.reservar({
        idempotency_key: input.idempotencyKey,
        workflow_run_id: input.workflowRunId,
        lead_id: input.leadId,
        conversacion_id: input.conversacionId,
        plantilla_nombre: input.plantilla.nombre,
        plantilla_idioma: input.plantilla.idioma,
        contenido: contenidoDePlantilla(input.plantilla),
        parametros_cuerpo: [...input.plantilla.parametrosCuerpo],
        intento_at: this.ahora(),
      });
    } catch (e) {
      // Otro intento reservó en el medio: ese es el que manda.
      if (!(e instanceof ConflictError)) throw e;
      const otra = await this.deps.repo.findByIdempotencyKey(input.idempotencyKey);
      if (!otra) throw e;
      return { id: otra.id, meta_message_id: otra.meta_message_id };
    }

    let wamid: string;
    try {
      const r = await this.deps.meta.sendTemplate({ to: input.to, plantilla: input.plantilla });
      wamid = r.meta_message_id;
    } catch (error) {
      if (error instanceof RateLimitError) {
        await this.deps.repo.liberarReserva(reserva.id);
        throw error;
      }
      const g = errorDeGraph(error);
      const detalle = error instanceof Error ? error.message : String(error);
      await this.deps.repo.marcarFallido(reserva.id, {
        codigo:
          g.codigo ?? (g.clase === "desconocido" ? "desenlace_desconocido" : "rechazo_sin_codigo"),
        detalle: detalle.slice(0, LARGO_DETALLE),
      });
      throw error;
    }
    // Fuera del try: si anotar falla, la reserva queda y el reintento no reenvía.
    const fila = await this.deps.repo.marcarAceptado(reserva.id, wamid);
    return { id: fila.id, meta_message_id: fila.meta_message_id };
  }
}

// ---------------------------------------------------------------------------

export interface AnotarPlantillasInput {
  leadId: UUID;
  conversacionId: UUID;
  /** La sesión que resolvió el entrante: nueva o la activa. */
  leadSessionId: UUID;
  ahora: Date;
}

export interface AnotarPlantillasSinSesion {
  /** Cuántas plantillas anotó en el hilo. */
  registrar(input: AnotarPlantillasInput): Promise<number>;
}

export interface AnotarPlantillasSinSesionDeps {
  repo: Pick<WorkflowPlantillasSinSesionRepository, "pendientesDeAnotar" | "marcarAnotada">;
  messages: Pick<MessagesRepository, "findByMetaMessageId" | "registrarSalienteYaEnviado">;
}

/**
 * Tope de plantillas anotadas por entrante. Decisión propia sin fuente: un
 * lead no recibe más de un puñado de plantillas por semana (el tope de
 * frecuencia del agente), así que 10 es holgado y acota la consulta.
 */
const MAXIMO_POR_ENTRANTE = 10;
const DIA_MS = 24 * 3_600_000;

/** `aceptado` es el 200 de la Cloud API: todavía no hay estado de entrega. */
const ESTADO_ENTREGA_DE: Partial<Record<PlantillaSinSesion["estado"], EstadoEntrega>> = {
  entregado: "entregado",
  leido: "leido",
};

/**
 * Cuando el lead escribe, las plantillas que los flujos le mandaron sin sesión
 * en los últimos `VENTANA_ATRIBUCION_DIAS` (la misma que la de difusión) entran
 * al hilo, con la hora en que salieron: quedan antes del entrante en el Inbox
 * y en el turno del agente.
 *
 * Idempotente: el wamid es único en `mensajes`; si la fila ya está (un
 * reintento, o la carrera con otro entrante), sólo se marca como anotada.
 */
export class DefaultAnotarPlantillasSinSesion implements AnotarPlantillasSinSesion {
  constructor(private readonly deps: AnotarPlantillasSinSesionDeps) {}

  async registrar(input: AnotarPlantillasInput): Promise<number> {
    const desde = new Date(input.ahora.getTime() - VENTANA_ATRIBUCION_DIAS * DIA_MS);
    const pendientes = await this.deps.repo.pendientesDeAnotar(
      input.leadId,
      desde,
      MAXIMO_POR_ENTRANTE,
    );
    let anotadas = 0;
    for (const p of pendientes) {
      if (p.meta_message_id === null) continue;
      const mensajeId = await this.anotar(p, p.meta_message_id, input);
      await this.deps.repo.marcarAnotada(p.id, mensajeId);
      anotadas += 1;
    }
    return anotadas;
  }

  private async anotar(p: PlantillaSinSesion, wamid: string, input: AnotarPlantillasInput) {
    const ya = await this.deps.messages.findByMetaMessageId(wamid);
    if (ya) return ya.id;
    const estado = ESTADO_ENTREGA_DE[p.estado] ?? null;
    try {
      const m = await this.deps.messages.registrarSalienteYaEnviado({
        conversacion_id: input.conversacionId,
        lead_session_id: input.leadSessionId,
        direction: "out",
        sender: "sistema",
        sender_user_id: null,
        tipo: "template",
        contenido: p.contenido,
        media_url: null,
        meta_message_id: wamid,
        idempotency_key: null,
        metadata: {
          plantilla_meta: {
            nombre: p.plantilla_nombre,
            idioma: p.plantilla_idioma,
            parametros_cuerpo: [...p.parametros_cuerpo],
          },
          workflow: { run_id: p.workflow_run_id },
        },
        platform_created_at: null,
        created_at: p.intento_at,
        estado_entrega: estado,
        estado_entrega_at: estado ? p.estado_at : null,
      });
      return m.id;
    } catch (e) {
      if (!(e instanceof ConflictError)) throw e;
      const otro = await this.deps.messages.findByMetaMessageId(wamid);
      if (!otro) throw e;
      return otro.id;
    }
  }
}
