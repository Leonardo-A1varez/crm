import type { Canal, TipoMensaje } from "@/types/domain";

export interface ParsedMessage {
  canal: Canal;
  canal_thread_id: string;
  meta_user_id: string;
  meta_message_id: string;
  tipo: TipoMensaje;
  contenido: string | null;
  media_url: string | null;
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
      const messages = asArray(value.messages);
      for (const m of messages) {
        if (!isObject(m)) continue;
        const parsed = waMessage(m);
        if (parsed) out.push(parsed);
      }
    }
  }
  return out;
}

function waMessage(m: Record<string, unknown>): ParsedMessage | null {
  const from = asString(m.from);
  const id = asString(m.id);
  const type = asString(m.type);
  if (!from || !id || !type) return null;

  const tipo = waTipo(type);
  if (!tipo) return null;

  const contenido = extractWaContenido(tipo, m);

  return {
    canal: "wa",
    canal_thread_id: from,
    meta_user_id: from,
    meta_message_id: id,
    tipo,
    contenido,
    media_url: null,
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
    raw: ev,
  };
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
