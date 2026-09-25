import { Bolt, PanTool, ReceiptLong, Schedule, Sell, SmartToy } from "@/components/icons";
import type { ComponentType } from "react";

export interface Plantilla {
  id: string;
  nombre: string;
  /** Qué resuelve, en una frase. Nada de vender: qué hace. */
  descripcion: string;
  glifo: ComponentType<{ size?: number; className?: string; strokeWidth?: number }>;
  /** El disparador en castellano, completando "Cuando…". */
  disparador: string;
  /** Los pasos en el orden en que ocurren, completando "Entonces…". */
  pasos: readonly string[];
  /** El trabajo manual que deja de hacer una persona. */
  reemplaza: string;
}

/**
 * Las seis plantillas con las que se puede crear un flujo.
 *
 * Los pasos están escritos en castellano y no con los nombres de los nodos
 * ("enviar_mensaje", "condicion"). Alguien que entra a elegir una plantilla
 * todavía no sabe cómo se llaman los bloques —los va a aprender en el lienzo,
 * después de elegir—, así que nombrarlos acá pide el vocabulario antes de
 * enseñarlo.
 *
 * Se numeran al dibujarlos, y esa numeración sí significa algo: los pasos
 * ocurren en ese orden. No es una decoración de lista.
 */
export const PLANTILLAS: readonly Plantilla[] = [
  {
    id: "responder-automatico",
    nombre: "Responder automático",
    descripcion:
      "Contesta las preguntas repetidas con un texto fijo, sin gastar una llamada al modelo.",
    glifo: Bolt,
    disparador: "llega un mensaje de un lead",
    pasos: [
      "clasificar de qué habla el mensaje",
      "buscar una regla que coincida",
      "responder con el texto de la regla",
      "si ninguna coincide, seguir con el agente",
    ],
    reemplaza: "responder a mano lo mismo veinte veces por día",
  },
  {
    id: "etiquetar-automatico",
    nombre: "Etiquetar automáticamente",
    descripcion:
      "Cuelga una etiqueta según de qué habla el lead. No contesta nada ni corta la conversación.",
    glifo: Sell,
    disparador: "llega un mensaje de un lead",
    pasos: [
      "clasificar de qué habla el mensaje",
      "aplicar todas las etiquetas que correspondan",
      "dejar que la conversación siga su curso",
    ],
    reemplaza: "acordarse de etiquetar, que es lo primero que se cae un día ocupado",
  },
  {
    id: "escalar-a-humano",
    nombre: "Escalar a humano",
    descripcion: "Pasa la conversación a una persona cuando el agente se traba o el lead lo pide.",
    glifo: PanTool,
    disparador: "el agente no entiende dos mensajes seguidos",
    pasos: [
      "marcar la sesión como que requiere una persona",
      "pausar al agente en esa conversación",
      "avisar al vendedor asignado",
    ],
    reemplaza: "descubrir tarde que un lead quedó dando vueltas con el bot",
  },
  {
    id: "reactivar-perdidos",
    nombre: "Reactivar perdidos",
    descripcion:
      "Vuelve a escribirle a los leads que se cayeron, con un mensaje distinto según por qué se cayeron.",
    glifo: Schedule,
    disparador: "es lunes a las 9:00",
    pasos: [
      "juntar los leads perdidos y agruparlos por motivo",
      "descartar a los que ya recibieron un mensaje hace poco",
      "enviar la plantilla que corresponde a cada motivo",
      "abrir una sesión nueva si alguno contesta",
    ],
    reemplaza: "una lista de perdidos que nadie vuelve a abrir",
  },
  {
    id: "bienvenida-agente",
    nombre: "Bienvenida + agente",
    descripcion:
      "Saluda al lead nuevo, le pregunta qué busca y le entrega la conversación al agente vendedor.",
    glifo: SmartToy,
    disparador: "se crea un lead nuevo",
    pasos: [
      "saludar y preguntar qué repuesto necesita",
      "esperar la respuesta",
      "guardar el vehículo en la ficha del lead",
      "delegar al agente vendedor",
    ],
    reemplaza: "el primer mensaje, que define si el lead se queda o se va",
  },
  {
    id: "seguimiento-cotizacion",
    nombre: "Seguimiento de cotización",
    descripcion:
      "Le recuerda al lead la cotización que no contestó, y para de insistir cuando responde.",
    glifo: ReceiptLong,
    disparador: "la etapa del lead pasa a cotizado",
    pasos: [
      "esperar 24 horas",
      "si no contestó, enviar la plantilla de recordatorio",
      "esperar 48 horas más",
      "si sigue sin contestar, pasárselo a una persona para que decida si se perdió",
    ],
    reemplaza: "perseguir cotizaciones de memoria y con una libreta",
  },
];
