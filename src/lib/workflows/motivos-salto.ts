import type { MotivoSalto } from "@/types/workflows";

/**
 * Cómo se le dice a una persona cada motivo por el que un tope de seguridad
 * saltó un mensaje (PRD §6.6). Fuente única: la usan el historial de
 * corridas, la corrida sobre el lienzo y la pestaña "Topes de seguridad" de
 * Ajustes. Tres copias divergen.
 */
export interface DescriptorMotivoSalto {
  /** Corto, para una fila o un chip. */
  label: string;
  /** Qué pasó, en una frase. */
  explicacion: string;
}

export const MOTIVO_SALTO: Record<MotivoSalto, DescriptorMotivoSalto> = {
  tope_frecuencia: {
    label: "Tope de mensajes",
    explicacion: "Ya había recibido el máximo de mensajes automáticos en 24 horas.",
  },
  dado_de_baja: {
    label: "Dado de baja",
    explicacion: "Pidió no recibir más mensajes: está en la lista de bajas.",
  },
  sin_ventana: {
    label: "Sin ventana de 24 h",
    explicacion:
      "Pasaron más de 24 horas desde su último mensaje: Meta sólo deja mandar una plantilla aprobada.",
  },
  conversacion_activa: {
    label: "Conversación activa",
    explicacion: "Estaba en medio de una conversación.",
  },
  requiere_humano: {
    label: "Requiere humano",
    explicacion: "Una persona está a cargo de la conversación.",
  },
};
