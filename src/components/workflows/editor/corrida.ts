/**
 * Estado de una corrida y, sobre todo, **qué va a pasar si la reanudás**.
 *
 * ────────────────────────────────────────────────────────────────────────
 * EL PROBLEMA QUE ESTO RESUELVE
 * ────────────────────────────────────────────────────────────────────────
 *
 * Zapier llama "Replay" a las dos acciones —retomar desde donde falló y volver
 * a correr todo— y las dibuja igual. La consecuencia es conocida y cara: se
 * aprieta la que parece obvia y salen de nuevo los mensajes que ya se habían
 * mandado. El cliente recibe dos veces el mismo WhatsApp, y en un canal donde
 * Meta mide la calidad del número eso no es sólo vergüenza.
 *
 * Acá las dos acciones tienen **nombres distintos, íconos distintos, peso
 * visual distinto**, y sobre todo:
 *
 * **El lienzo muestra el plan antes de confirmar.** Al apuntar cualquiera de
 * los dos botones, los nodos que se van a reusar se hunden en gris con la hora
 * de la que sale el resultado guardado, y los que van a volver a correr quedan
 * en color.
 *
 * ────────────────────────────────────────────────────────────────────────
 * EL PLAN LO DECIDE EL SERVIDOR
 * ────────────────────────────────────────────────────────────────────────
 *
 * Qué se reusa y qué mensajes se repiten no se adivina acá: lo calcula el
 * servidor con las mismas reglas que después aplica al reanudar (`reusados`,
 * `envios`), y esta pantalla lo dibuja. La primera versión lo deducía del tipo
 * de nodo por prefijo (`msg_*`) y no veía el bloque `accion` legacy que también
 * manda WhatsApp: el diálogo habría dicho "no se repite ningún envío" sobre una
 * corrida que sí lo repetía.
 */

/** En qué quedó cada paso de la corrida. */
/**
 * `saltado`: un tope de seguridad saltó el mensaje y el lead salió del flujo
 * acá (PRD §6.6). No es un fallo y no se pinta como tal.
 */
export type EstadoPaso = "completado" | "activo" | "saltado" | "fallado" | "pendiente";

export interface PasoCorrida {
  nodoId: string;
  /** Nombre legible. Del catálogo, no el tipo crudo. */
  nombre: string;
  /** El tipo de nodo, crudo. Va en mono en el detalle: es lo que se busca en un log. */
  tipo: string;
  estado: EstadoPaso;
  /** Hora en que terminó, formateada ("14:32"). Es el dato del memoizado. */
  hora?: string;
  /** Cuánto tardó, formateado ("1,2 s", "36 s"). */
  duracion?: string;
  /** Lo que entró y lo que salió del paso. Se muestran al clickearlo. */
  entrada?: Readonly<Record<string, string>>;
  salida?: Readonly<Record<string, string>>;
}

/** Las dos formas de volver a lanzar una corrida fallada. Nunca se llaman igual. */
export type PlanReanudacion = "reanudar" | "desde_cero";

export const PLAN_NOMBRE: Record<PlanReanudacion, string> = {
  reanudar: "Reanudar desde el fallo",
  desde_cero: "Ejecutar de nuevo desde el principio",
};

/**
 * Lo que el servidor dice de "Reanudar desde el fallo": si se puede y qué
 * pasos reusa, o por qué no, en una frase para quien mira.
 */
export type PreviaReanudar =
  | {
      posible: true;
      /** El nodo que vuelve a correr: el del paso que falló. */
      desdeNodo: string;
      /** Los que se reusan, con la hora del resultado guardado. */
      reusados: readonly { nodoId: string; hora?: string }[];
    }
  | { posible: false; motivo: string };

/** Un mensaje que ya salió y que "ejecutar de nuevo" vuelve a mandar. */
export interface EnvioRepetido {
  nodoId: string;
  /** Qué bloque lo mandó. */
  nombre: string;
  /** Cuándo salió la primera vez. */
  hora?: string;
  /** Lo que decía. `null` si ya no se puede leer (la sesión se purgó). */
  texto: string | null;
}

/** Lo que el servidor dice de "Ejecutar de nuevo desde el principio". */
export type PreviaRepetir =
  | { posible: true; destinatario?: string; envios: readonly EnvioRepetido[] }
  | { posible: false; motivo: string };

/** Qué le va a pasar a cada nodo bajo un plan dado. */
export type AccionNodo = "reusa" | "recorre" | "no_alcanzado";

export interface PlanNodo {
  accion: AccionNodo;
  /** Sólo en `reusa`: de qué hora sale el resultado guardado. */
  hora?: string;
}

/**
 * Qué le pasa a cada nodo bajo cada plan.
 *
 * - `reanudar`: se reusa exactamente lo que el servidor lista en `reusados`,
 *   con su hora. El resto de lo que se ejecutó vuelve a correr.
 * - `desde_cero`: no se reusa nada.
 *
 * Los pasos que nunca se alcanzaron quedan en `no_alcanzado` en los dos planes:
 * dibujarlos como "van a correr" prometería algo que depende de lo que
 * devuelvan los pasos de arriba.
 */
export function planDeReanudacion(
  pasos: readonly PasoCorrida[],
  plan: PlanReanudacion,
  reanudar: PreviaReanudar,
): Map<string, PlanNodo> {
  const reusados =
    plan === "reanudar" && reanudar.posible
      ? new Map(reanudar.reusados.map((r) => [r.nodoId, r.hora]))
      : new Map<string, string | undefined>();
  const out = new Map<string, PlanNodo>();
  for (const p of pasos) {
    if (p.estado === "pendiente") {
      out.set(p.nodoId, { accion: "no_alcanzado" });
    } else if (reusados.has(p.nodoId)) {
      out.set(p.nodoId, { accion: "reusa", hora: reusados.get(p.nodoId) });
    } else {
      out.set(p.nodoId, { accion: "recorre" });
    }
  }
  return out;
}

/** Cuántos pasos se reusan bajo un plan. Va en el resumen, en Geist Mono. */
export function contarReusados(plan: PlanReanudacion, reanudar: PreviaReanudar): number {
  return plan === "reanudar" && reanudar.posible ? reanudar.reusados.length : 0;
}

/** Los envíos que se repiten bajo un plan. Reanudar no repite ninguno: reusa. */
export function enviosQueSeRepiten(
  plan: PlanReanudacion,
  repetir: PreviaRepetir,
): readonly EnvioRepetido[] {
  return plan === "desde_cero" && repetir.posible ? repetir.envios : [];
}

/** El paso que falló, si hay alguno. */
export function pasoFallado(pasos: readonly PasoCorrida[]): PasoCorrida | null {
  return pasos.find((p) => p.estado === "fallado") ?? null;
}
