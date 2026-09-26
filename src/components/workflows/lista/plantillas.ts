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
      "Contesta con un texto fijo cuando se cumple la condición que elijas. Si no se cumple, termina sin contestar.",
    glifo: Bolt,
    disparador: "llega un mensaje de un lead",
    pasos: [
      "mirar si se cumple la condición que elijas",
      "si se cumple, contestar con el texto fijo",
      "si no, terminar sin contestar",
    ],
    reemplaza: "responder a mano lo mismo veinte veces por día",
  },
  {
    id: "etiquetar-automatico",
    nombre: "Etiquetar automáticamente",
    descripcion:
      "Pone las etiquetas que elijas cuando se cumple una condición. No le contesta nada al lead.",
    glifo: Sell,
    disparador: "llega un mensaje de un lead",
    pasos: [
      "mirar si se cumple la condición que elijas",
      "si se cumple, poner las etiquetas elegidas",
      "terminar",
    ],
    reemplaza: "acordarse de etiquetar, que es lo primero que se cae un día ocupado",
  },
  {
    id: "escalar-a-humano",
    nombre: "Escalar a humano",
    descripcion:
      "Pausa al agente y deja la conversación para una persona cuando se cumple la condición que elijas.",
    glifo: PanTool,
    disparador: "llega un mensaje de un lead",
    pasos: [
      "mirar si se cumple la condición que elijas",
      "si se cumple, pausar al agente en esa conversación",
      "avisarle al cliente que lo atiende una persona (se puede apagar)",
    ],
    reemplaza: "descubrir tarde que un lead quedó dando vueltas con el bot",
  },
  {
    id: "reactivar-perdidos",
    nombre: "Reactivar perdidos",
    descripcion:
      "Cada lunes le escribe con una plantilla aprobada por Meta a los leads en etapa perdido.",
    glifo: Schedule,
    disparador: "es lunes a las 9:00, una vez por cada lead",
    pasos: [
      "quedarse con los leads en etapa perdido",
      "enviar la plantilla aprobada que elijas",
      "poner la etiqueta que elijas",
    ],
    reemplaza: "una lista de perdidos que nadie vuelve a abrir",
  },
  {
    id: "bienvenida-agente",
    nombre: "Bienvenida",
    descripcion: "Saluda al lead nuevo y le pregunta qué repuesto busca y para qué vehículo.",
    glifo: SmartToy,
    disparador: "se crea un lead nuevo",
    pasos: ["saludar y preguntar qué repuesto y para qué vehículo", "terminar"],
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
