/**
 * La respuesta de un lead a una difusión (docs/prd-workflows.md §7.6: "una
 * conversación como cualquier otra, con la campaña de origen anotada").
 *
 * El motor manda la plantilla sin sesión —el destinatario típico no tiene una—,
 * así que no queda en `mensajes`. Cuando el lead responde, el pipeline de
 * entrada la anota en el hilo de la sesión que abre (o de la activa) y deja en
 * `lead_session.extras` a qué difusión respondió: el Twin lo muestra entre los
 * datos adicionales y el agente lo recibe en su contexto durante toda la
 * sesión, aunque la plantilla ya haya salido de la ventana de mensajes.
 */

/** La clave en `lead_session.extras`. El Twin la muestra como "Difusion respondida". */
export const CLAVE_DIFUSION_RESPONDIDA = "difusion_respondida";

/**
 * Hasta cuántos días después del envío un entrante cuenta como respuesta a la
 * difusión. Decisión propia, sin fuente que la fije: es lo que dura el tope de
 * marketing de Meta por persona (ventana de 7 días, PRD §4.3), y queda muy por
 * debajo de la purga de 29 días, así que la plantilla anotada no se borra antes
 * de que venza la atribución.
 */
export const VENTANA_ATRIBUCION_DIAS = 7;

/**
 * Cómo se nombra la difusión en el Twin y en el contexto del agente. `null`
 * como plantilla = salió como texto libre (PRD §7.3.5).
 */
export function describirDifusion(nombre: string, plantilla: string | null): string {
  return plantilla === null
    ? `«${nombre}» · texto libre`
    : `«${nombre}» · plantilla «${plantilla}»`;
}

/** El texto de la difusión anotada en el hilo. */
export function contenidoDifusionEnHilo(nombre: string, plantilla: string | null): string {
  return `Difusión ${describirDifusion(nombre, plantilla)}`;
}

/**
 * A qué difusión respondió el lead en esta sesión, o `null`. `extras` es jsonb
 * que también escribe el extractor: lo que no sea texto no se toma.
 */
export function difusionRespondidaDe(extras: Record<string, unknown>): string | null {
  const v = extras[CLAVE_DIFUSION_RESPONDIDA];
  return typeof v === "string" && v.trim() !== "" ? v : null;
}
