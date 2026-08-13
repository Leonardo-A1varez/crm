import type { Canal, EstadoEntrega, TipoMensaje } from "@/types/domain";

export interface ParsedStatus {
  meta_message_id: string;
  estado: EstadoEntrega;
  /** Momento que reporta Meta, no el de recepción del webhook. */
  at: Date;
  /** Título del error cuando `estado` es `fallido`. */
  error: string | null;
}

export interface ParsedMessage {
  canal: Canal;
  canal_thread_id: string;
  meta_user_id: string;
  meta_message_id: string;
  tipo: TipoMensaje;
  contenido: string | null;
  media_url: string | null;
  /**
   * Cómo se llama a sí mismo el contacto en la plataforma.
   *
   * Solo WhatsApp: viene en `value.contacts[].profile.name` de cada POST.
   * Instagram y Messenger no lo mandan en el webhook —hace falta una llamada
   * aparte a la Graph API— así que ahí es `null`, que significa "no lo sabemos"
   * y no "no tiene".
   */
  nombre_perfil: string | null;
  /** Hora original de Meta; ausente o inválida queda en null. */
  platform_created_at?: Date | null;
  raw: Record<string, unknown>;
}

export function parseMetaWebhook(payload: unknown): ParsedMessage[] {
  if (!isObject(payload)) return [];
  const object = payload.object;

  if (object === "whatsapp_business_account") return parseWA(payload);
  if (object === "instagram") return parseMessenger(payload, "ig");
  if (object === "page") return parseMessenger(payload, "fb");
  return [];
}

/**
 * Cambios de estado de mensajes salientes.
 *
 * Solo WhatsApp: Instagram y Messenger reportan `delivery`/`read` como marcas
 * de agua sobre el hilo entero, sin id de mensaje, así que no se pueden mapear
 * a una fila sin inventar a cuál corresponden. Un payload de esos canales
 * devuelve `[]` a propósito.
 */
export function parseMetaStatuses(payload: unknown): ParsedStatus[] {
  if (!isObject(payload)) return [];
  if (payload.object !== "whatsapp_business_account") return [];

  const out: ParsedStatus[] = [];
  for (const entry of asArray(payload.entry)) {
    if (!isObject(entry)) continue;
    for (const change of asArray(entry.changes)) {
      if (!isObject(change)) continue;
      if (change.field !== "messages") continue;
      const value = isObject(change.value) ? change.value : {};
      for (const s of asArray(value.statuses)) {
        if (!isObject(s)) continue;
        const parsed = waStatus(s);
        if (parsed) out.push(parsed);
      }
    }
  }
  return out;
}

function waStatus(s: Record<string, unknown>): ParsedStatus | null {
  const id = asString(s.id);
  const estado = waEstado(asString(s.status));
  if (!id || !estado) return null;

  // Meta manda el timestamp en segundos y como string. Si viene roto se usa el
  // momento de recepción: perder el orden exacto es mejor que descartar el
  // estado y dejar el mensaje marcado como si nunca hubiera salido.
  const segundos = Number(asString(s.timestamp) ?? "");
  const at = Number.isFinite(segundos) && segundos > 0 ? new Date(segundos * 1000) : new Date();

  const primerError = asArray(s.errors).find(isObject);
  const error = primerError ? (asString(primerError.title) ?? asString(primerError.message)) : null;

  return { meta_message_id: id, estado, at, error };
}

function waEstado(status: string | null): EstadoEntrega | null {
  switch (status) {
    case "sent":
      return "enviado";
    case "delivered":
      return "entregado";
    case "read":
      return "leido";
    case "failed":
      return "fallido";
    default:
      // `deleted` y lo que Meta agregue después no son escalones de entrega.
      return null;
  }
}

function parseWA(payload: Record<string, unknown>): ParsedMessage[] {
  const entries = asArray(payload.entry);
  const out: ParsedMessage[] = [];
  for (const entry of entries) {
    if (!isObject(entry)) continue;
    const changes = asArray(entry.changes);
    for (const change of changes) {
      if (!isObject(change)) continue;
      if (change.field !== "messages") continue;
      const value = isObject(change.value) ? change.value : {};
      const perfiles = waPerfiles(value.contacts);
      const messages = asArray(value.messages);
      for (const m of messages) {
        if (!isObject(m)) continue;
        const parsed = waMessage(m, perfiles);
        if (parsed) out.push(parsed);
      }
    }
  }
  return out;
}

/**
 * Nombres de perfil del `value`, indexados por `wa_id`.
 *
 * Meta manda los contactos al lado de los mensajes y no adentro de cada uno, y
 * `wa_id` es la clave que los une con `messages[].from`. El índice se arma una
 * vez por `value` porque un mismo POST puede traer varios mensajes del mismo
 * contacto.
 */
function waPerfiles(contacts: unknown): Map<string, string> {
  const porWaId = new Map<string, string>();
  for (const c of asArray(contacts)) {
    if (!isObject(c)) continue;
    const waId = asString(c.wa_id);
    const nombre = isObject(c.profile) ? asString(c.profile.name) : null;
    if (waId && nombre) porWaId.set(waId, nombre);
  }
  return porWaId;
}

function waMessage(
  m: Record<string, unknown>,
  perfiles: Map<string, string>,
): ParsedMessage | null {
  const from = asString(m.from);
  const id = asString(m.id);
  const type = asString(m.type);
  if (!from || !id || !type) return null;

  const tipo = waTipo(type);
  if (!tipo) return null;

  const contenido = extractWaContenido(tipo, m);

  // Se cruza por `wa_id`. Cuando el `value` trae un solo contacto se usa ese
  // aunque no matchee: México y Argentina devuelven a veces un `wa_id`
  // normalizado (sin el 1 ni el 9) que no coincide con el `from` del mensaje, y
  // con un único contacto en el lote no hay a quién más pertenecer.
  const unico = perfiles.size === 1 ? [...perfiles.values()][0] : null;
  const nombrePerfil = perfiles.get(from) ?? unico ?? null;

  return {
    canal: "wa",
    canal_thread_id: from,
    meta_user_id: from,
    meta_message_id: id,
    tipo,
    contenido,
    media_url: null,
    nombre_perfil: nombrePerfil,
    platform_created_at: timestampDe(m.timestamp, "segundos"),
    raw: m,
  };
}

function waTipo(type: string): TipoMensaje | null {
  switch (type) {
    case "text":
      return "text";
    case "image":
      return "image";
    case "audio":
      return "audio";
    case "video":
      return "video";
    case "document":
      return "doc";
    case "location":
      return "location";
    default:
      return null;
  }
}

function extractWaContenido(tipo: TipoMensaje, m: Record<string, unknown>): string | null {
  if (tipo === "text") {
    const text = isObject(m.text) ? asString(m.text.body) : null;
    return text;
  }
  if (tipo === "image" || tipo === "video" || tipo === "doc") {
    const obj = isObject(m[mediaKey(tipo)]) ? (m[mediaKey(tipo)] as Record<string, unknown>) : null;
    return obj ? asString(obj.caption) : null;
  }
  return null;
}

function mediaKey(tipo: TipoMensaje): string {
  if (tipo === "image") return "image";
  if (tipo === "video") return "video";
  if (tipo === "doc") return "document";
  return "";
}

function parseMessenger(payload: Record<string, unknown>, canal: "ig" | "fb"): ParsedMessage[] {
  const entries = asArray(payload.entry);
  const out: ParsedMessage[] = [];
  for (const entry of entries) {
    if (!isObject(entry)) continue;
    const messaging = asArray(entry.messaging);
    for (const ev of messaging) {
      if (!isObject(ev)) continue;
      const parsed = messengerEvent(ev, canal);
      if (parsed) out.push(parsed);
    }
  }
  return out;
}

function messengerEvent(ev: Record<string, unknown>, canal: "ig" | "fb"): ParsedMessage | null {
  const sender = isObject(ev.sender) ? asString(ev.sender.id) : null;
  if (!sender) return null;

  const message = isObject(ev.message) ? ev.message : null;
  if (!message) return null;

  const mid = asString(message.mid);
  if (!mid) return null;

  const text = asString(message.text);
  return {
    canal,
    canal_thread_id: sender,
    meta_user_id: sender,
    meta_message_id: mid,
    tipo: "text",
    contenido: text,
    media_url: null,
    // Messenger e Instagram no mandan el nombre en el evento de mensaje.
    nombre_perfil: null,
    platform_created_at: timestampDe(ev.timestamp, "milisegundos"),
    raw: ev,
  };
}

function timestampDe(value: unknown, unidad: "segundos" | "milisegundos"): Date | null {
  const numeric = typeof value === "number" ? value : Number(asString(value) ?? Number.NaN);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  const date = new Date(unidad === "segundos" ? numeric * 1000 : numeric);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}
