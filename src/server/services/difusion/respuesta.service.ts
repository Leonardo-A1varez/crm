import type { EstadoEnvio } from "@/lib/difusion/modelo";
import {
  CLAVE_DIFUSION_RESPONDIDA,
  VENTANA_ATRIBUCION_DIAS,
  contenidoDifusionEnHilo,
  describirDifusion,
} from "@/lib/difusion/respuesta";
import { ConflictError } from "@/lib/errors";
import type { DifusionEnviosRepository } from "@/server/repositories/difusion-envios.repo";
import type { DifusionesRepository } from "@/server/repositories/difusiones.repo";
import type { LeadSessionRepository } from "@/server/repositories/lead-session.repo";
import type { MessagesRepository } from "@/server/repositories/messages.repo";
import type { EstadoEntrega } from "@/types/domain";
import type { UUID } from "@/types/entities";

/**
 * Cuando un lead escribe, si lo último que le salió fue una difusión, la anota
 * en el hilo y en la sesión (ver `lib/difusion/respuesta.ts`).
 *
 * Se eligió anotar al responder y no al mandar porque `mensajes` exige una
 * sesión, y abrirle una a cada destinatario llenaría el Inbox de miles de
 * sesiones sin conversación (y "máximo una sesión activa por lead" haría que
 * una difusión le cambie la sesión a quien no respondió). La plantilla se
 * anota con la hora en que salió, así queda en su lugar en el hilo, antes de
 * la respuesta.
 *
 * Idempotente: el wamid es único en `mensajes`, y la marca en la sesión se
 * escribe antes que el mensaje, así que un reintento después de cualquiera de
 * las dos escrituras termina en el mismo estado.
 *
 * Si salió como texto libre (PRD §7.3.5): con sesión activa el motor lo mandó
 * por el hilo y ya está en `mensajes`, quizá en una sesión que después se
 * cerró; eso no es "ya respondió antes", así que igual cuenta. Sin sesión se
 * anota al responder, como la plantilla, con el texto de la difusión como
 * descripción: el texto con las variables resueltas no se guarda fuera del hilo.
 */

export interface RegistrarRespuestaInput {
  leadId: UUID;
  conversacionId: UUID;
  /** La sesión que resolvió el entrante: nueva o la activa. */
  leadSessionId: UUID;
  ahora: Date;
  /** El wamid del entrante: marca el envío como respondido, una sola vez. */
  entranteMetaMessageId: string;
}

export interface RespuestaDifusion {
  difusionId: UUID;
  envioId: UUID;
  mensajeId: UUID;
  /**
   * Este entrante es LA respuesta a la difusión (el primero después de que
   * salió). Es lo que dispara "Difusión respondida": los mensajes siguientes
   * de la misma conversación no lo vuelven a disparar.
   */
  primera: boolean;
}

export interface RespuestaDifusionService {
  /** `null` si el entrante no responde a ninguna difusión. */
  registrar(input: RegistrarRespuestaInput): Promise<RespuestaDifusion | null>;
}

export interface RespuestaDifusionDeps {
  envios: Pick<DifusionEnviosRepository, "ultimoSalidoParaLead" | "marcarRespondido">;
  difusiones: Pick<DifusionesRepository, "findById">;
  messages: Pick<MessagesRepository, "findByMetaMessageId" | "registrarSalienteYaEnviado">;
  sessions: Pick<LeadSessionRepository, "findById" | "update">;
}

const DIA_MS = 24 * 3_600_000;

/** `aceptado` es el 200 de la Cloud API: todavía no hay estado de entrega. */
const ESTADO_ENTREGA_DE: Partial<Record<EstadoEnvio, EstadoEntrega>> = {
  entregado: "entregado",
  leido: "leido",
};

export class DefaultRespuestaDifusionService implements RespuestaDifusionService {
  constructor(private readonly deps: RespuestaDifusionDeps) {}

  async registrar(input: RegistrarRespuestaInput): Promise<RespuestaDifusion | null> {
    const desde = new Date(input.ahora.getTime() - VENTANA_ATRIBUCION_DIAS * DIA_MS);
    const envio = await this.deps.envios.ultimoSalidoParaLead(input.leadId, desde);
    if (!envio || envio.meta_message_id === null || envio.intento_at === null) return null;

    const textoLibre = envio.salio_como === "texto_libre";
    const yaAnotado = await this.deps.messages.findByMetaMessageId(envio.meta_message_id);
    // Una plantilla anotada en otra sesión: este lead ya respondió a esa
    // difusión antes, y este mensaje es otra conversación. Un texto libre por
    // el hilo se escribió al mandar, así que su sesión no dice nada.
    if (yaAnotado && yaAnotado.lead_session_id !== input.leadSessionId) {
      if (!textoLibre) return null;
      // El texto libre ya tuvo su respuesta con otro entrante: esta es otra conversación.
      const otraRespuesta =
        envio.respuesta_meta_message_id !== null &&
        envio.respuesta_meta_message_id !== input.entranteMetaMessageId;
      if (otraRespuesta) return null;
    }

    const difusion = await this.deps.difusiones.findById(envio.difusion_id);
    if (!difusion || difusion.plantilla_nombre === null) return null;
    const plantilla = difusion.plantilla_nombre;
    const descripcion = describirDifusion(difusion.nombre, textoLibre ? null : plantilla);

    const sesion = await this.deps.sessions.findById(input.leadSessionId);
    if (sesion && sesion.extras[CLAVE_DIFUSION_RESPONDIDA] !== descripcion) {
      await this.deps.sessions.update(sesion.id, {
        extras: { ...sesion.extras, [CLAVE_DIFUSION_RESPONDIDA]: descripcion },
      });
    }

    const primera = await this.deps.envios.marcarRespondido(
      envio.id,
      input.entranteMetaMessageId,
      input.ahora,
    );

    if (yaAnotado) {
      return { difusionId: difusion.id, envioId: envio.id, mensajeId: yaAnotado.id, primera };
    }

    try {
      const mensaje = await this.deps.messages.registrarSalienteYaEnviado({
        conversacion_id: input.conversacionId,
        lead_session_id: input.leadSessionId,
        direction: "out",
        sender: "sistema",
        sender_user_id: null,
        tipo: textoLibre ? "text" : "template",
        contenido: contenidoDifusionEnHilo(difusion.nombre, textoLibre ? null : plantilla),
        media_url: null,
        meta_message_id: envio.meta_message_id,
        idempotency_key: null,
        metadata: {
          difusion: textoLibre
            ? { difusion_id: difusion.id, envio_id: envio.id, texto_libre: true }
            : {
                difusion_id: difusion.id,
                envio_id: envio.id,
                plantilla,
                idioma: difusion.plantilla_idioma,
              },
        },
        platform_created_at: null,
        created_at: envio.intento_at,
        estado_entrega: ESTADO_ENTREGA_DE[envio.estado] ?? null,
        estado_entrega_at: ESTADO_ENTREGA_DE[envio.estado] ? envio.estado_at : null,
      });
      return { difusionId: difusion.id, envioId: envio.id, mensajeId: mensaje.id, primera };
    } catch (e) {
      // Una carrera con otro entrante del mismo lead: el otro la anotó primero.
      if (!(e instanceof ConflictError)) throw e;
      const otro = await this.deps.messages.findByMetaMessageId(envio.meta_message_id);
      if (!otro || (otro.lead_session_id !== input.leadSessionId && !textoLibre)) return null;
      return { difusionId: difusion.id, envioId: envio.id, mensajeId: otro.id, primera };
    }
  }
}
