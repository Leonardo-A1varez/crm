import type { CurrentStage, Prioridad, Urgencia } from "@/types/domain";

export interface EntradaTriage {
  stage: CurrentStage;
  urgencia: Urgencia;
  iaPausada: boolean;
  bloqueador: string | null;
  /** Mensajes entrantes posteriores al último saliente. */
  sinResponder: number;
  /** `created_at` del primero de esos entrantes; `null` si no hay ninguno. */
  esperandoDesde: Date | null;
  ahora: Date;
}

export interface Triage {
  prioridad: Prioridad;
  /** Por qué está priorizada. `null` cuando no hay nada que atender. */
  motivo: string | null;
}

/** Una hora sin respuesta escala la conversación a prioridad alta. */
export const UMBRAL_ESPERA_ALTA_MS = 60 * 60 * 1000;

/**
 * "hace 12m" / "hace 3h" / "hace 2d". Redondea hacia abajo: decir menos tiempo
 * del que pasó es el error seguro para un dato que dispara una prioridad.
 */
export function esperaLegible(ms: number): string {
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "recién";
  if (min < 60) return `hace ${min}m`;
  const horas = Math.floor(min / 60);
  if (horas < 24) return `hace ${horas}h`;
  return `hace ${Math.floor(horas / 24)}d`;
}

/**
 * Triage de una conversación: qué tan urgente es y por qué.
 *
 * El orden de las reglas importa y no es cosmético — la primera que matchea
 * define el motivo, así que arriba van las que describen mejor la situación.
 * Que la IA esté pausada gana sobre el tiempo de espera: si un vendedor tomó
 * la conversación, "la tomaste vos y no contestaste" explica más que "hace 2h".
 *
 * Función pura y con `ahora` inyectado: el triage se recalcula en cada render
 * del server y tiene que dar lo mismo en un test que en producción.
 */
export function triage(e: EntradaTriage): Triage {
  const esperaMs = e.esperandoDesde !== null ? e.ahora.getTime() - e.esperandoDesde.getTime() : 0;

  if (e.stage === "requiere_humano") {
    return { prioridad: "alta", motivo: "Escalado a un humano" };
  }
  if (e.iaPausada) {
    return { prioridad: "alta", motivo: "IA pausada, contesta un vendedor" };
  }
  if (e.sinResponder > 0 && esperaMs >= UMBRAL_ESPERA_ALTA_MS) {
    return { prioridad: "alta", motivo: `Sin responder ${esperaLegible(esperaMs)}` };
  }
  if (e.sinResponder > 0 && e.urgencia === "alta") {
    return { prioridad: "alta", motivo: "Urgencia alta sin responder" };
  }
  if (e.bloqueador !== null && e.bloqueador.trim() !== "") {
    return { prioridad: "media", motivo: "Con bloqueador" };
  }
  if (e.sinResponder > 0) {
    return { prioridad: "media", motivo: `Sin responder ${esperaLegible(esperaMs)}` };
  }
  if (e.stage === "esperando_pago") {
    return { prioridad: "media", motivo: "Esperando pago" };
  }
  return { prioridad: "baja", motivo: null };
}
