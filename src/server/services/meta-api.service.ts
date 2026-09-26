import { RateLimitError } from "@/lib/errors";
import type { ConversationsRepository } from "@/server/repositories/conversations.repo";
import type { MessagesRepository } from "@/server/repositories/messages.repo";
import type { ParsedMessage } from "@/lib/meta/parse-webhook";
import type { Canal, Sender } from "@/types/domain";
import type {
  Mensaje,
  MensajeMetadata,
  MensajeRico,
  PlantillaSaliente,
  UUID,
} from "@/types/entities";

/**
 * Prefijo de `mensajes.idempotency_key` en los salientes que produce el
 * pipeline. La clave completa es `out:<meta_message_id del entrante>`.
 *
 * Nació como dedup de reintentos y es, además, el **único** vínculo persistido
 * entre una respuesta y el mensaje que la disparó: no hay columna que ate el
 * saliente al entrante. La auditoría por turno lo lee al revés para encontrar
 * el turno de una burbuja. Cambiar el formato rompe las dos cosas.
 */
const PREFIJO_SALIENTE = "out:";

/** Clave de idempotencia del saliente que responde a un entrante de Meta. */
export function claveSaliente(metaMessageIdEntrante: string): string {
  return `${PREFIJO_SALIENTE}${metaMessageIdEntrante}`;
}

/**
 * El `meta_message_id` del entrante que originó un saliente, leído de su clave
 * de idempotencia. `null` cuando el saliente no lo tiene: lo escribió una
 * persona desde el composer, o es anterior a la convención.
 */
export function entranteDeClave(idempotencyKey: string | null): string | null {
  if (idempotencyKey === null || !idempotencyKey.startsWith(PREFIJO_SALIENTE)) return null;
  const id = idempotencyKey.slice(PREFIJO_SALIENTE.length);
  return id.length > 0 ? id : null;
}

export interface MetaSendTextInput {
  canal: Canal;
  to: string;
  text: string;
}

export interface MetaSendResult {
  meta_message_id: string;
}

/**
 * Una plantilla aprobada de WhatsApp, tal como la manda Meta. Es lo único que
 * Meta deja mandar fuera de la ventana de 24 h.
 *
 * Genérica a propósito: la usa un paso de un flujo y la va a usar el motor de
 * difusión. Nada de acá sabe de workflows.
 */
export interface PlantillaMeta {
  /** El nombre con que se aprobó en el WhatsApp Manager. */
  nombre: string;
  /** El código de idioma con que se aprobó (`es`, `es_AR`, `pt_BR`…). */
  idioma: string;
  /**
   * Los valores de las variables del cuerpo (`{{1}}`, `{{2}}`…), en orden.
   * Vacío = la plantilla no tiene variables.
   */
  parametrosCuerpo: readonly string[];
}

export interface MetaSendTemplateInput {
  to: string;
  plantilla: PlantillaMeta;
}

/**
 * Un mensaje de WhatsApp que no es texto ni plantilla: botones de respuesta,
 * lista, imagen o ubicación. Todos son mensajes de servicio: Meta sólo los deja
 * salir con la ventana de 24 h abierta ("When the window closes, you can only
 * send pre-approved template messages", doc de Meta leída el 2026-09-26).
 *
 * Los opcionales van en `null` y no se mandan: un `footer` o un `caption`
 * vacío no le suma nada al mensaje.
 */
export type ContenidoRico =
  | {
      tipo: "botones";
      cuerpo: string;
      /** 1 a 3. El `id` vuelve en `button_reply.id` cuando el lead toca uno. */
      botones: readonly { id: string; titulo: string }[];
    }
  | {
      tipo: "lista";
      encabezado: string | null;
      cuerpo: string;
      pie: string | null;
      /** El texto del botón que abre la lista. */
      boton: string;
      secciones: readonly {
        titulo: string | null;
        filas: readonly { id: string; titulo: string; descripcion: string | null }[];
      }[];
    }
  | { tipo: "imagen"; url: string; caption: string | null }
  | {
      tipo: "ubicacion";
      lat: number;
      lon: number;
      nombre: string | null;
      direccion: string | null;
    };

export interface MetaSendRicoInput {
  to: string;
  contenido: ContenidoRico;
}

export interface MetaApiClient {
  sendText(input: MetaSendTextInput): Promise<MetaSendResult>;
  /** Sólo WhatsApp: Instagram y Messenger no tienen plantillas aprobadas. */
  sendTemplate(input: MetaSendTemplateInput): Promise<MetaSendResult>;
  /** Sólo WhatsApp: botones, lista, imagen o ubicación. */
  sendRico(input: MetaSendRicoInput): Promise<MetaSendResult>;
}

export interface SendOutboundInput {
  conversacionId: UUID;
  leadSessionId: UUID;
  canal: Canal;
  to: string;
  contenido: string;
  sender: Extract<Sender, "ia" | "humano" | "sistema">;
  senderUserId?: UUID;
  // Dedup outbound. Si presente y ya existe mensaje out con esta key, retorna
  // existing sin invocar Meta client. Convención: "out:<inbound_meta_message_id>".
  idempotencyKey?: string;
  /**
   * Qué plantilla fija produjo este saliente, cuando no lo produjo el agente.
   * Se guarda en `mensajes.metadata` y es lo que la auditoría del turno lee
   * para decir quién resolvió el turno.
   */
  plantilla?: PlantillaSaliente;
}

/**
 * Una plantilla aprobada, por WhatsApp. Mismo contrato de idempotencia y de
 * reserva que `SendOutboundInput`. No lleva canal: las plantillas son sólo de
 * WhatsApp, y quien llama tiene que haberlo chequeado contra la conversación.
 */
export interface SendTemplateInput {
  conversacionId: UUID;
  leadSessionId: UUID;
  to: string;
  plantilla: PlantillaMeta;
  sender: Extract<Sender, "ia" | "humano" | "sistema">;
  senderUserId?: UUID;
  idempotencyKey?: string;
}

/**
 * Botones, lista, imagen o ubicación, por WhatsApp. Mismo contrato de
 * idempotencia y de reserva que `SendOutboundInput`. Sin canal: son sólo de
 * WhatsApp, y quien llama tiene que haberlo chequeado contra la conversación.
 */
export interface SendRicoInput {
  conversacionId: UUID;
  leadSessionId: UUID;
  to: string;
  contenido: ContenidoRico;
  /**
   * Sólo imagen subida a Storage: su ruta. `contenido.url` es entonces una URL
   * firmada, que viaja a Meta pero no se escribe en el hilo.
   */
  archivo?: string;
  sender: Extract<Sender, "ia" | "humano" | "sistema">;
  senderUserId?: UUID;
  idempotencyKey?: string;
}

/** El tipo de fila, el texto buscable y lo que el hilo dibuja de un saliente rico. */
export function registroDeRico(
  contenido: ContenidoRico,
  archivo?: string,
): {
  tipo: "interactive" | "image" | "location";
  texto: string | null;
  rico: MensajeRico;
  media_url: string | null;
} {
  switch (contenido.tipo) {
    case "botones":
      return { tipo: "interactive", texto: contenido.cuerpo, rico: contenido, media_url: null };
    case "lista":
      return { tipo: "interactive", texto: contenido.cuerpo, rico: contenido, media_url: null };
    case "imagen": {
      const url = archivo === undefined ? contenido.url : null;
      return {
        tipo: "image",
        texto: contenido.caption,
        rico: { tipo: "imagen", url, archivo: archivo ?? null, caption: contenido.caption },
        media_url: url,
      };
    }
    case "ubicacion": {
      const partes = [contenido.nombre, contenido.direccion].filter((p): p is string => !!p);
      return {
        tipo: "location",
        texto: partes.length > 0 ? partes.join(" · ") : null,
        rico: contenido,
        media_url: null,
      };
    }
  }
}

/** Lo que el hilo muestra de una plantilla: cuál salió y con qué valores. */
export function contenidoDePlantilla(plantilla: PlantillaMeta): string {
  const valores = plantilla.parametrosCuerpo.join(", ");
  return `Plantilla «${plantilla.nombre}»${valores ? `: ${valores}` : ""}`;
}

export interface RecordInboundInput {
  conversacionId: UUID;
  leadSessionId: UUID;
  parsed: ParsedMessage;
}

/**
 * La clave se omite cuando no hay plantilla en vez de escribirla en `null`: un
 * `{}` es "este saliente lo produjo el agente o una persona", y una clave
 * presente con valor nulo obligaría a distinguir dos formas del mismo hecho.
 */
function metadataDelSaliente(plantilla: PlantillaSaliente | undefined): MensajeMetadata {
  return plantilla === undefined ? {} : { plantilla };
}

/** Texto del error para `error_entrega`. Nunca incluye el contenido del mensaje. */
function mensajeDeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface MetaApiService {
  sendOutbound(input: SendOutboundInput): Promise<Mensaje>;
  /** Una plantilla aprobada de WhatsApp. La única salida fuera de la ventana de 24 h. */
  sendTemplate(input: SendTemplateInput): Promise<Mensaje>;
  /** Botones, lista, imagen o ubicación por WhatsApp. Sólo dentro de la ventana de 24 h. */
  sendRico(input: SendRicoInput): Promise<Mensaje>;
  recordInbound(input: RecordInboundInput): Promise<Mensaje>;
}

/** Lo que cambia entre un texto y una plantilla; la reserva y el envío son iguales. */
interface Saliente {
  conversacionId: UUID;
  leadSessionId: UUID;
  sender: SendOutboundInput["sender"];
  senderUserId?: UUID;
  idempotencyKey?: string;
  tipo: "text" | "template" | "interactive" | "image" | "location";
  contenido: string | null;
  media_url?: string | null;
  metadata: MensajeMetadata;
  llamarAMeta: () => Promise<MetaSendResult>;
}

export class DefaultMetaApiService implements MetaApiService {
  constructor(
    private readonly conversations: ConversationsRepository,
    private readonly messages: MessagesRepository,
    private readonly client: MetaApiClient,
  ) {}

  async sendOutbound(input: SendOutboundInput): Promise<Mensaje> {
    return this.enviar({
      conversacionId: input.conversacionId,
      leadSessionId: input.leadSessionId,
      sender: input.sender,
      senderUserId: input.senderUserId,
      idempotencyKey: input.idempotencyKey,
      tipo: "text",
      contenido: input.contenido,
      metadata: metadataDelSaliente(input.plantilla),
      llamarAMeta: () =>
        this.client.sendText({ canal: input.canal, to: input.to, text: input.contenido }),
    });
  }

  async sendTemplate(input: SendTemplateInput): Promise<Mensaje> {
    const { nombre, idioma, parametrosCuerpo } = input.plantilla;
    return this.enviar({
      conversacionId: input.conversacionId,
      leadSessionId: input.leadSessionId,
      sender: input.sender,
      senderUserId: input.senderUserId,
      idempotencyKey: input.idempotencyKey,
      tipo: "template",
      contenido: contenidoDePlantilla(input.plantilla),
      // `plantilla_meta` y no `plantilla`: esa clave es la marca de las
      // respuestas fijas del pipeline (`PlantillaSaliente`), otra cosa.
      metadata: {
        plantilla_meta: { nombre, idioma, parametros_cuerpo: [...parametrosCuerpo] },
      },
      llamarAMeta: () => this.client.sendTemplate({ to: input.to, plantilla: input.plantilla }),
    });
  }

  async sendRico(input: SendRicoInput): Promise<Mensaje> {
    const registro = registroDeRico(input.contenido, input.archivo);
    return this.enviar({
      conversacionId: input.conversacionId,
      leadSessionId: input.leadSessionId,
      sender: input.sender,
      senderUserId: input.senderUserId,
      idempotencyKey: input.idempotencyKey,
      tipo: registro.tipo,
      contenido: registro.texto,
      media_url: registro.media_url,
      metadata: { rico: registro.rico },
      llamarAMeta: () => this.client.sendRico({ to: input.to, contenido: input.contenido }),
    });
  }

  private async enviar(input: Saliente): Promise<Mensaje> {
    // Una reserva sin `meta_message_id` significa "ya se intentó, desenlace
    // desconocido". No se reenvía: un WhatsApp duplicado no se puede retirar,
    // y esta fila sí se ve en el hilo marcada como fallida.
    if (input.idempotencyKey) {
      const existing = await this.messages.findByIdempotencyKey(input.idempotencyKey);
      if (existing) return existing;
    }

    // La fila se escribe ANTES de llamar a Meta. Si se escribiera después, un
    // fallo de esa escritura dejaría al reintento sin rastro del envío y el
    // cliente recibiría el mensaje dos veces.
    const reserva = await this.messages.create({
      conversacion_id: input.conversacionId,
      lead_session_id: input.leadSessionId,
      direction: "out",
      sender: input.sender,
      sender_user_id: input.senderUserId ?? null,
      tipo: input.tipo,
      contenido: input.contenido,
      media_url: input.media_url ?? null,
      meta_message_id: null,
      idempotency_key: input.idempotencyKey ?? null,
      metadata: input.metadata,
      platform_created_at: null,
    });

    let result: MetaSendResult;
    try {
      result = await input.llamarAMeta();
    } catch (error) {
      // 429: Meta rechazó explícitamente, no llegó nada. Se libera la clave
      // para que el reintento pueda volver a intentar de verdad.
      if (error instanceof RateLimitError) {
        await this.messages.liberarReserva(reserva.id);
        throw error;
      }
      // Todo lo demás queda visible en el hilo. Para ValidationError el envío
      // está descartado; para InfraError el desenlace es desconocido y esa
      // ambigüedad es justamente lo que la marca comunica.
      await this.messages.marcarFalloEnvio(reserva.id, mensajeDeError(error));
      throw error;
    }

    const msg = await this.messages.confirmarEnvio(reserva.id, result.meta_message_id);
    await this.conversations.touch(input.conversacionId);
    return msg;
  }

  async recordInbound(input: RecordInboundInput): Promise<Mensaje> {
    const { parsed, conversacionId, leadSessionId } = input;

    const existing = await this.messages.findByMetaMessageId(parsed.meta_message_id);
    if (existing) return existing;

    const msg = await this.messages.create({
      conversacion_id: conversacionId,
      lead_session_id: leadSessionId,
      direction: "in",
      sender: "lead",
      sender_user_id: null,
      tipo: parsed.tipo,
      contenido: parsed.contenido,
      media_url: parsed.media_url,
      meta_message_id: parsed.meta_message_id,
      idempotency_key: null,
      metadata: {
        raw: parsed.raw,
        ...(parsed.respuesta_interactiva
          ? { respuesta_interactiva: parsed.respuesta_interactiva }
          : {}),
      },
      platform_created_at: parsed.platform_created_at ?? null,
    });

    await this.conversations.touch(conversacionId);
    return msg;
  }
}
