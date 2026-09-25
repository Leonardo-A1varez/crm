import { MOTIVO_EXCLUSION, type MotivoExclusion } from "@/lib/difusion/modelo";
import { POLITICA_POR_DEFECTO } from "@/lib/difusion/planificador";
import type { Exclusion } from "./tipos";

export interface DescriptorExclusion {
  etiqueta: string;
  /** Qué pasa si NO se excluye. Es el único argumento que importa. */
  consecuencia: string;
  /** Código de error de la Cloud API, cuando el motivo viene de Meta. */
  codigo: string | null;
  color: string;
}

/**
 * Los diez motivos del planificador, en sus palabras para la pantalla.
 *
 * Cada uno dice qué pasa si se desmarca, no qué significa: "se dio de baja en
 * Meta" no le dice nada a nadie; "Meta rechaza el mensaje y no se le reintenta
 * nunca" sí. Las cifras de las consecuencias salen de la política del
 * planificador, no se repiten a mano.
 */
export const EXCLUSION: Record<MotivoExclusion, DescriptorExclusion> = {
  sin_telefono: {
    etiqueta: "Sin teléfono de WhatsApp",
    consecuencia:
      "llegó por Instagram o Messenger, o el número no es válido: no hay a dónde mandarle",
    codigo: null,
    color: "var(--color-ink-faint)",
  },
  duplicado_telefono: {
    etiqueta: "Mismo teléfono que otro lead",
    consecuencia: "es la misma persona para WhatsApp: recibiría el mensaje dos veces",
    codigo: null,
    color: "var(--color-ink-faint)",
  },
  baja_propia: {
    etiqueta: "En la lista de supresión propia",
    consecuencia: "pidió no recibir más mensajes: escribirle igual es lo que termina en un reporte",
    codigo: null,
    color: "var(--color-danger)",
  },
  baja_meta: {
    etiqueta: "Se dio de baja de marketing en WhatsApp",
    consecuencia: "Meta rechaza el mensaje y no se le reintenta nunca",
    codigo: "131050",
    color: "var(--color-danger)",
  },
  requiere_humano: {
    etiqueta: "Esperando a una persona",
    consecuencia:
      "la conversación está escalada: una promo automática en el medio pisa lo que la persona está resolviendo",
    codigo: null,
    color: "var(--color-caution)",
  },
  conversacion_activa: {
    etiqueta: "En una conversación ahora",
    consecuencia: `escribió hace menos de ${POLITICA_POR_DEFECTO.conversacionActivaMinutos} min con una sesión abierta: la promo le llega en medio de la consulta`,
    codigo: null,
    color: "var(--color-caution)",
  },
  sin_ventana: {
    etiqueta: "Sin ventana abierta y sin plantilla",
    consecuencia: "fuera de la ventana de 24 h sólo se le puede escribir con plantilla",
    codigo: null,
    color: "var(--color-ink-faint)",
  },
  saturado_meta: {
    etiqueta: "Meta le rebotó marketing hace poco",
    consecuencia: `ya recibe marketing de varios negocios: otra plantilla de marketing antes de ${POLITICA_POR_DEFECTO.esperaSaturadoHoras} h vuelve a rebotar`,
    codigo: "131049",
    color: "var(--color-danger)",
  },
  cap_frecuencia: {
    etiqueta: "Tope de mensajes automáticos",
    consecuencia:
      "ya recibió en 24 h el máximo de mensajes automáticos que fija la configuración del agente",
    codigo: null,
    color: "var(--color-caution)",
  },
  en_negociacion: {
    etiqueta: "En negociación o esperando pago",
    consecuencia: "una promo genérica encima de una cotización abierta se lee como un error",
    codigo: null,
    color: "var(--color-caution)",
  },
};

const PRECEDENCIA = new Map<MotivoExclusion, number>(MOTIVO_EXCLUSION.map((m, i) => [m, i]));

/**
 * Las filas que muestra "Excluir siempre".
 *
 * Las eximibles se ven siempre porque son controles: aunque hoy no excluyan a
 * nadie, alguien tiene que poder decidir sobre ellas. Las obligatorias se ven
 * sólo cuando excluyen a alguien: ocho filas en cero son ruido, y ninguna se
 * puede tocar. El orden es la precedencia del planificador.
 */
export function exclusionesVisibles(exclusiones: readonly Exclusion[]): Exclusion[] {
  return exclusiones
    .filter((e) => e.cantidad > 0 || e.eximible)
    .sort((a, b) => (PRECEDENCIA.get(a.motivo) ?? 0) - (PRECEDENCIA.get(b.motivo) ?? 0));
}
