import type { ConversationsRepository } from "@/server/repositories/conversations.repo";
import type { MessagesRepository } from "@/server/repositories/messages.repo";
import type { ParsedMessage } from "@/lib/meta/parse-webhook";
import type { Canal, Sender } from "@/types/domain";
import type { Mensaje, MensajeMetadata, PlantillaSaliente, UUID } from "@/types/entities";

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

export interface MetaApiClient {
  sendText(input: MetaSendTextInput): Promise<MetaSendResult>;
}

export interface SendOutboundInput {
  conversacionId: UUID;
  leadSessionId: UUID;
  canal: Canal;
  to: string;
  contenido: string;
  sender: Extract<Sender, "ia" | "humano">;
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

export interface MetaApiService {
  sendOutbound(input: SendOutboundInput): Promise<Mensaje>;
  recordInbound(input: RecordInboundInput): Promise<Mensaje>;
}

export class DefaultMetaApiService implements MetaApiService {
  constructor(
    private readonly conversations: ConversationsRepository,
    private readonly messages: MessagesRepository,
    private readonly client: MetaApiClient,
  ) {}

  async sendOutbound(input: SendOutboundInput): Promise<Mensaje> {
    if (input.idempotencyKey) {
      const existing = await this.messages.findByIdempotencyKey(input.idempotencyKey);
      if (existing) return existing;
    }

    const result = await this.client.sendText({
      canal: input.canal,
      to: input.to,
      text: input.contenido,
    });

    const msg = await this.messages.create({
      conversacion_id: input.conversacionId,
      lead_session_id: input.leadSessionId,
      direction: "out",
      sender: input.sender,
      sender_user_id: input.senderUserId ?? null,
      tipo: "text",
      contenido: input.contenido,
      media_url: null,
      meta_message_id: result.meta_message_id,
      idempotency_key: input.idempotencyKey ?? null,
      metadata: metadataDelSaliente(input.plantilla),
    });

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
      metadata: { raw: parsed.raw },
    });

    await this.conversations.touch(conversacionId);
    return msg;
  }
}
