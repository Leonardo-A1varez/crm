import { MOTIVO_TRIAGE } from "@/types/domain";
import type { CurrentStage, MotivoAtencion } from "@/types/domain";

export type { MotivoAtencion };

/**
 * El recordatorio de seguimiento de la sesión, ya vencido, reducido a lo que el
 * triage necesita. `null` = no hay ninguno esperando.
 */
export interface RecordatorioVencido {
  /** Lo que escribió el vendedor al programarlo. Vacío es un caso legítimo. */
  nota: string;
}

export interface EntradaTriage {
  stage: CurrentStage;
  iaPausada: boolean;
  bloqueador: string | null;
  comprobantePagoUrl: string | null;
  /**
   * Único campo que no sale de la fila de `lead_session`. Sigue sin obligar a
   * leer el hilo: son los recordatorios vencidos, que se traen todos de una
   * sola query, así que contar cuántas conversaciones requieren atención sigue
   * costando dos consultas y no una por lead.
   */
  recordatorio?: RecordatorioVencido | null;
}

export interface Triage {
  /** `null` cuando no hay nada que atender: la IA la está manejando sola. */
  motivo: MotivoAtencion | null;
}

/**
 * Peso de orden de cada motivo. Sale del índice en `MOTIVO_TRIAGE` para que
 * agregar un motivo no obligue a mantener dos listas en sincronía; sin motivo
 * va al fondo, después de los tres.
 */
export function pesoMotivo(motivo: MotivoAtencion | null): number {
  return motivo === null ? MOTIVO_TRIAGE.length : MOTIVO_TRIAGE.indexOf(motivo.tipo);
}

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

/** Un bloqueador en blanco no es un bloqueador. */
function bloqueadorActivo(bloqueador: string | null): bloqueador is string {
  return bloqueador !== null && bloqueador.trim() !== "";
}

/**
 * Lo que se lee en el chip cuando el motivo es un seguimiento. La nota del
 * vendedor es lo primero porque es lo que le devuelve el contexto ("dijo que lo
 * pensaba, tiene el precio"); sin nota queda el enunciado pelado, que igual
 * dice lo único que hace falta: hay que volver a escribirle.
 */
function textoSeguimiento(r: RecordatorioVencido): string {
  const nota = r.nota.trim();
  return nota === "" ? "Toca volver a contactarlo" : `Seguimiento: ${nota}`;
}

/**
 * Triage de una conversación: si requiere a una persona y por qué.
 *
 * El orden de las reglas es el del handoff (`requiere_humano` → bloqueador →
 * `esperando_pago` sin comprobante → seguimiento vencido → resto) y no es
 * cosmético: la primera que matchea define el motivo, y el motivo define tanto
 * el chip de la fila como la posición en la lista.
 *
 * El seguimiento va último de los cuatro porque es el único que no lo pide el
 * cliente: los tres de arriba son alguien esperando del otro lado, y este es
 * una cita que nos pusimos nosotros. Una conversación con las dos cosas se
 * muestra por la del cliente, que es la que no puede esperar.
 *
 * Depende solo de campos de la sesión y del recordatorio vencido —nada del
 * hilo— para que contar cuántas conversaciones requieren atención (el badge del
 * SideNav) no obligue a leer los mensajes de todas.
 */
export function triage(e: EntradaTriage): Triage {
  if (e.stage === "requiere_humano") {
    return { motivo: { tipo: "humano", texto: "Pidió hablar con una persona" } };
  }
  // La IA pausada a mano también es "esto lo contesta una persona": sin esta
  // regla, una conversación tomada por un vendedor caería en el grupo
  // "La IA está manejando", que es justo lo contrario de lo que pasa.
  if (e.iaPausada) {
    return { motivo: { tipo: "humano", texto: "La atiende un vendedor" } };
  }
  if (bloqueadorActivo(e.bloqueador)) {
    return { motivo: { tipo: "bloqueo", texto: `Bloqueador: ${e.bloqueador.trim()}` } };
  }
  if (e.stage === "esperando_pago" && e.comprobantePagoUrl === null) {
    return { motivo: { tipo: "pago", texto: "Pago sin comprobante" } };
  }
  if (e.recordatorio) {
    return { motivo: { tipo: "seguimiento", texto: textoSeguimiento(e.recordatorio) } };
  }
  return { motivo: null };
}
