import {
  asArray,
  asString,
  extractWaContenido,
  isObject,
  numeroNegocioDe,
  timestampDe,
  waMedia,
  waTipo,
} from "@/lib/meta/parse-webhook";
import type { MediaEntrante } from "@/lib/meta/parse-webhook";
import type { Direction, TipoMensaje } from "@/types/domain";

export { CAMPOS_COEXISTENCIA } from "@/lib/meta/campos-coexistencia";

/**
 * Parser de los webhooks de coexistencia: `history`, `smb_app_state_sync` y
 * `smb_message_echoes`. Formas tomadas de los ejemplos de Meta
 * (developers.facebook.com/docs/whatsapp/embedded-signup/custom-flows/
 * onboarding-business-app-users, leída el 2026-10-11). Todo lo que no tenga
 * la forma esperada se descarta sin tirar el resto del lote.
 *
 * Puro: no loguea. Lo que sale de acá trae teléfonos y textos (PII); quien lo
 * use tampoco los loguea (AGENTS.md §0.8).
 */

/** Un mensaje del historial o un eco, ya normalizado. */
export interface MensajeCoexistencia {
  meta_message_id: string;
  /** `in`: lo escribió el cliente. `out`: lo mandó el negocio desde la app. */
  direction: Direction;
  tipo: TipoMensaje;
  contenido: string | null;
  /** El archivo, si lo trae y tiene id (ver `MediaEntrante`). */
  media?: MediaEntrante;
  /** `timestamp` de Meta (segundos). null si vino roto. */
  at: Date | null;
}

export interface HiloHistorial {
  /** `threads[].id`: el teléfono del cliente. */
  telefono_cliente: string;
  mensajes: MensajeCoexistencia[];
}

export interface LoteHistorial {
  phone_number_id: string;
  /** 0 = día 0-1, 1 = día 1-90, 2 = día 90-180. */
  fase: number | null;
  chunk: number | null;
  /** 0-100; 100 = sincronización completa. */
  progreso: number | null;
  hilos: HiloHistorial[];
  /** Mensajes que no se importan (p. ej. `media_placeholder`). Sólo la cuenta. */
  omitidos: number;
}

export interface ErrorHistorial {
  phone_number_id: string;
  /** 2593109 = el negocio apagó compartir el historial desde la app. */
  codigo: number | null;
}

export interface ContactoCoexistencia {
  phone_number_id: string;
  /** Sólo dígitos, como guarda `leads.telefono` el pipeline. */
  telefono: string;
  /** `full_name`, o `first_name` si no vino el completo. */
  nombre: string | null;
  /** `add` o `remove` según la doc; se pasa tal cual lo que venga. */
  accion: string;
}

export interface EcoCoexistencia {
  phone_number_id: string;
  /** `to` del eco: el cliente al que le escribió el negocio. */
  telefono_cliente: string;
  mensaje: MensajeCoexistencia;
}

export interface CoexistenciaParseada {
  historial: LoteHistorial[];
  historialErrores: ErrorHistorial[];
  contactos: ContactoCoexistencia[];
  ecos: EcoCoexistencia[];
}

// ===========================================================================
// Serialización para los eventos de Inngest: una `Date` no sobrevive el JSON.
// ===========================================================================

export type MensajeSerializado = Omit<MensajeCoexistencia, "at"> & { at: string | null };
export type LoteSerializado = Omit<LoteHistorial, "hilos"> & {
  hilos: { telefono_cliente: string; mensajes: MensajeSerializado[] }[];
};
export type EcoSerializado = Omit<EcoCoexistencia, "mensaje"> & { mensaje: MensajeSerializado };

export function serializarMensaje(m: MensajeCoexistencia): MensajeSerializado {
  return { ...m, at: m.at ? m.at.toISOString() : null };
}

export function deserializarMensaje(m: MensajeSerializado): MensajeCoexistencia {
  return { ...m, at: m.at ? new Date(m.at) : null };
}

export function deserializarLote(l: LoteSerializado): LoteHistorial {
  return {
    ...l,
    hilos: l.hilos.map((h) => ({ ...h, mensajes: h.mensajes.map(deserializarMensaje) })),
  };
}

/** Máximo de mensajes por evento: un lote de Meta puede ser grande. */
export const MENSAJES_POR_EVENTO = 100;

/**
 * Parte un lote del historial en lotes de a lo sumo `MENSAJES_POR_EVENTO`
 * mensajes (un hilo largo se reparte en varios), para que cada evento entre
 * holgado en el tope de tamaño de Inngest. El progreso viaja sólo en la
 * última parte: si viajara en todas, la primera podría dar el historial por
 * completo antes de importar el resto.
 */
export function partirLote(lote: LoteHistorial): LoteSerializado[] {
  const partes: LoteSerializado[] = [];
  let actual: LoteSerializado["hilos"] = [];
  let cuenta = 0;
  const cerrar = () => {
    if (actual.length === 0) return;
    partes.push({ ...lote, progreso: null, omitidos: 0, hilos: actual });
    actual = [];
    cuenta = 0;
  };
  for (const hilo of lote.hilos) {
    let i = 0;
    while (i < hilo.mensajes.length) {
      const espacio = MENSAJES_POR_EVENTO - cuenta;
      const tramo = hilo.mensajes.slice(i, i + espacio).map(serializarMensaje);
      actual.push({ telefono_cliente: hilo.telefono_cliente, mensajes: tramo });
      cuenta += tramo.length;
      i += tramo.length;
      if (cuenta >= MENSAJES_POR_EVENTO) cerrar();
    }
  }
  cerrar();
  if (partes.length === 0) {
    partes.push({ ...lote, hilos: [] });
  } else {
    const ultima = partes[partes.length - 1]!;
    partes[partes.length - 1] = { ...ultima, progreso: lote.progreso, omitidos: lote.omitidos };
  }
  return partes;
}

export function parseCoexistencia(payload: unknown): CoexistenciaParseada {
  const out: CoexistenciaParseada = {
    historial: [],
    historialErrores: [],
    contactos: [],
    ecos: [],
  };
  if (!isObject(payload) || payload.object !== "whatsapp_business_account") return out;

  for (const entry of asArray(payload.entry)) {
    if (!isObject(entry)) continue;
    for (const change of asArray(entry.changes)) {
      if (!isObject(change) || !isObject(change.value)) continue;
      const value = change.value;
      const phoneNumberId = numeroNegocioDe(value);
      if (!phoneNumberId) continue;

      switch (change.field) {
        case "history":
          leerHistorial(value, phoneNumberId, out);
          leerHistorialConMedia(value, phoneNumberId, out);
          break;
        case "smb_app_state_sync":
          leerContactos(value, phoneNumberId, out);
          break;
        case "smb_message_echoes":
          leerEcos(value, phoneNumberId, out);
          break;
        default:
          break;
      }
    }
  }
  return out;
}

function leerHistorial(
  value: Record<string, unknown>,
  phoneNumberId: string,
  out: CoexistenciaParseada,
): void {
  for (const item of asArray(value.history)) {
    if (!isObject(item)) continue;

    const errores = asArray(item.errors).filter(isObject);
    if (errores.length > 0) {
      const codigo = errores[0]!.code;
      out.historialErrores.push({
        phone_number_id: phoneNumberId,
        codigo: typeof codigo === "number" && Number.isInteger(codigo) ? codigo : null,
      });
      continue;
    }

    const meta = isObject(item.metadata) ? item.metadata : {};
    const hilos: HiloHistorial[] = [];
    let omitidos = 0;
    for (const hilo of asArray(item.threads)) {
      if (!isObject(hilo)) continue;
      const cliente = soloDigitos(asString(hilo.id));
      if (!cliente) continue;
      const mensajes: MensajeCoexistencia[] = [];
      for (const m of asArray(hilo.messages)) {
        if (!isObject(m)) continue;
        // El cliente es el id del hilo: lo que escribe él entra, lo demás lo
        // mandó el negocio desde la app.
        const desde = soloDigitos(asString(m.from));
        const parsed = mensajeDe(m, desde === cliente ? "in" : "out");
        if (parsed) mensajes.push(parsed);
        else omitidos += 1;
      }
      if (mensajes.length > 0) hilos.push({ telefono_cliente: cliente, mensajes });
    }

    out.historial.push({
      phone_number_id: phoneNumberId,
      fase: entero(meta.phase),
      chunk: entero(meta.chunk_order),
      progreso: entero(meta.progress),
      hilos,
      omitidos,
    });
  }
}

/**
 * El follow-up de `history` con los ids de media: los mensajes de media del
 * historial llegan primero como `media_placeholder` (sin contenido, se omiten) y
 * después, en OTRO webhook `history`, como `messages[]` directo en el `value`
 * (no dentro de `history[]`) con su `image`/`video`/... y el id para bajarlos.
 * Sólo para los de los últimos 14 días (docs/meta/media.md §1).
 *
 * La doc no muestra `to` en ese follow-up. Si lo mandó el cliente, el cliente es
 * `from`; si lo mandó el negocio hace falta `to`, y sin él no se sabe a qué hilo
 * pertenece: se descarta en vez de adivinar.
 */
function leerHistorialConMedia(
  value: Record<string, unknown>,
  phoneNumberId: string,
  out: CoexistenciaParseada,
): void {
  const metadata = isObject(value.metadata) ? value.metadata : {};
  const propio = soloDigitos(asString(metadata.display_phone_number));
  const porCliente = new Map<string, MensajeCoexistencia[]>();
  let omitidos = 0;

  for (const m of asArray(value.messages)) {
    if (!isObject(m)) continue;
    const desde = soloDigitos(asString(m.from));
    const esDelNegocio = propio !== null && desde === propio;
    const cliente = esDelNegocio ? soloDigitos(asString(m.to)) : desde;
    const parsed = cliente ? mensajeDe(m, esDelNegocio ? "out" : "in") : null;
    if (!cliente || !parsed) {
      omitidos += 1;
      continue;
    }
    porCliente.set(cliente, [...(porCliente.get(cliente) ?? []), parsed]);
  }

  if (porCliente.size === 0 && omitidos === 0) return;
  out.historial.push({
    phone_number_id: phoneNumberId,
    fase: null,
    chunk: null,
    progreso: null,
    hilos: [...porCliente].map(([telefono_cliente, mensajes]) => ({ telefono_cliente, mensajes })),
    omitidos,
  });
}

function leerContactos(
  value: Record<string, unknown>,
  phoneNumberId: string,
  out: CoexistenciaParseada,
): void {
  for (const s of asArray(value.state_sync)) {
    if (!isObject(s) || s.type !== "contact" || !isObject(s.contact)) continue;
    const telefono = soloDigitos(asString(s.contact.phone_number));
    const accion = asString(s.action);
    if (!telefono || !accion) continue;
    const nombre = asString(s.contact.full_name) ?? asString(s.contact.first_name);
    out.contactos.push({
      phone_number_id: phoneNumberId,
      telefono,
      nombre: nombre?.trim() || null,
      accion,
    });
  }
}

function leerEcos(
  value: Record<string, unknown>,
  phoneNumberId: string,
  out: CoexistenciaParseada,
): void {
  for (const e of asArray(value.message_echoes)) {
    if (!isObject(e)) continue;
    const cliente = soloDigitos(asString(e.to));
    const mensaje = mensajeDe(e, "out");
    if (!cliente || !mensaje) continue;
    out.ecos.push({ phone_number_id: phoneNumberId, telefono_cliente: cliente, mensaje });
  }
}

/**
 * Los mismos tipos que el entrante normal (`waTipo`). `media_placeholder` y lo
 * que el CRM no dibuja (stickers, reacciones, contactos, `edit`/`revoke`…)
 * devuelven null: inventarles un texto sería peor que no traerlos.
 */
function mensajeDe(m: Record<string, unknown>, direction: Direction): MensajeCoexistencia | null {
  const id = asString(m.id);
  const type = asString(m.type);
  if (!id || !type) return null;
  const tipo = waTipo(type);
  if (!tipo) return null;
  const media = waMedia(type, m);
  return {
    meta_message_id: id,
    direction,
    tipo,
    contenido: extractWaContenido(tipo, m),
    ...(media ? { media } : {}),
    at: timestampDe(m.timestamp, "segundos"),
  };
}

function soloDigitos(v: string | null): string | null {
  if (!v) return null;
  const d = v.replace(/\D/g, "");
  return d.length > 0 ? d : null;
}

function entero(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : Number.NaN;
  return Number.isInteger(n) ? n : null;
}
