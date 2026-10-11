import {
  asArray,
  asString,
  extractWaContenido,
  isObject,
  numeroNegocioDe,
  timestampDe,
  waTipo,
} from "@/lib/meta/parse-webhook";
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
  return {
    meta_message_id: id,
    direction,
    tipo,
    contenido: extractWaContenido(tipo, m),
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
