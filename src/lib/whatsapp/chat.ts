import { normalizarTelefonoWhatsApp } from "@/lib/difusion/telefono";
import type { Canal } from "@/types/domain";

/** Límites del recorte izquierdo: son los que valida la app de escritorio. */
export const RECORTE_MINIMO = 0;
export const RECORTE_MAXIMO = 1200;
export const RECORTE_PASO = 10;

export type MotivoSinChat = "otro_canal" | "sin_telefono";

export type ChatWhatsApp = { telefono: string } | { motivo: MotivoSinChat };

/**
 * Si la conversación del lead se puede abrir en WhatsApp Web, y con qué número.
 *
 * Un lead de Instagram o Messenger guarda un placeholder en `leads.telefono`
 * que `normalizarTelefonoWhatsApp` rechaza, así que el canal se mira primero
 * para poder decirle a la persona el motivo real (otro canal) en vez de uno
 * genérico. El número sale en E.164 sin `+`, que es lo que exige `abrirChat`.
 */
export function chatWhatsAppDeLead(lead: { telefono: string }, canalActivo: Canal): ChatWhatsApp {
  if (canalActivo !== "wa") return { motivo: "otro_canal" };
  const telefono = normalizarTelefonoWhatsApp(lead.telefono);
  return telefono ? { telefono } : { motivo: "sin_telefono" };
}

const MOTIVOS_LEGIBLES: Record<string, string> = {
  no_disponible: "WhatsApp Web no está disponible en este momento.",
  sin_area: "Todavía no hay dónde mostrarlo — esperá a que la pantalla termine de cargar.",
  telefono_invalido: "El número de este lead no sirve para abrir un chat de WhatsApp.",
  timeout_30s: "WhatsApp Web tardó más de 30 segundos en cargar.",
  recorte_invalido: `El recorte tiene que estar entre ${RECORTE_MINIMO} y ${RECORTE_MAXIMO} px.`,
  remitente_no_permitido: "La app de escritorio no aceptó el pedido de esta pantalla.",
};

/**
 * Los motivos que devuelve la app de escritorio, en texto para una persona.
 * Uno que no está en la tabla se muestra tal cual lo mandó la app — mejor un
 * texto técnico que uno inventado. `carga_fallida:<código>` se agrupa porque el
 * código de red es un detalle que la persona no puede usar.
 */
export function motivoLegible(motivo: string): string {
  if (motivo.startsWith("carga_fallida:")) {
    return "No se pudo cargar WhatsApp Web. Revisá la conexión a internet.";
  }
  return MOTIVOS_LEGIBLES[motivo] ?? motivo;
}
