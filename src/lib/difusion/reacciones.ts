/**
 * Qué hace el motor de difusión con cada código de error de la Cloud API.
 *
 * Es la tabla de `docs/prd-workflows-difusion.md` §4.4 ("esta tabla ES la
 * política de reintento del planificador") más las reacciones de §7.3 punto 8
 * y §8.5: `368`, `131031` y `131048` frenan todo; `132015` saca la plantilla y
 * avisa que requiere intervención. Los códigos y su significado se
 * verificaron contra la página de error codes de Meta el 2026-09-25.
 *
 * El mismo código puede llegar por dos caminos —en la respuesta del envío o
 * por el webhook de estado— y Meta no documenta cuál usa para cada uno. La
 * reacción es la misma, salvo en lo que el camino cambia: una fila que ya salió
 * de la cola (webhook) no puede volver a ella.
 */

export type OrigenFallo = "envio" | "webhook";

export type Reaccion =
  /** Se marca la fila fallida con su código y se sigue con las demás. */
  | { tipo: "fallar_fila" }
  /** Meta no la aceptó: la fila vuelve a la cola para un lote posterior. */
  | { tipo: "reintentar_despues" }
  /** Throughput: la fila vuelve a la cola y el lote corta acá. */
  | { tipo: "frenar_lote" }
  /** Fila fallida y baja irreversible del teléfono (131050). */
  | { tipo: "baja_meta" }
  /** Fila fallida y la difusión pasa a revisión con este motivo. */
  | { tipo: "pausar"; motivo: string }
  /** Fila fallida y la difusión se detiene: lo pendiente se cancela. */
  | { tipo: "detener"; motivo: string };

const DETENER: Readonly<Record<string, string>> = {
  "368":
    "Meta restringió la cuenta de WhatsApp por una violación de política (368). Se frenó todo lo pendiente.",
  "131031":
    "Meta restringió la cuenta de WhatsApp o rechazó un dato de verificación (131031). Se frenó todo lo pendiente.",
  "131048":
    "Meta limitó el número por calidad: demasiados mensajes bloqueados o marcados como spam (131048). Se frenó todo lo pendiente.",
  "132016":
    "Meta deshabilitó la plantilla para siempre por baja calidad (132016): no se puede volver a mandar con ella.",
};

const PAUSAR: Readonly<Record<string, string>> = {
  "132015":
    "Meta pausó la plantilla por baja calidad (132015): hay que revisarla antes de reanudar, y si la pausa es por ritmo de envío no vuelve sola.",
  // Decisión propia, no del PRD: el PRD lo lista como "reintentable tras el
  // período", pero el bloqueo es de la cuenta entera y aplica también a los
  // mensajes directos. Seguir mandando sólo quema filas.
  "131064":
    "Meta limitó la cuenta por violaciones de clasificación de plantillas (131064): el bloqueo se levanta solo al terminar el período de sanción.",
};

export function reaccionAFallo(codigo: string, origen: OrigenFallo): Reaccion {
  if (Object.hasOwn(DETENER, codigo)) return { tipo: "detener", motivo: DETENER[codigo] ?? "" };
  if (Object.hasOwn(PAUSAR, codigo)) return { tipo: "pausar", motivo: PAUSAR[codigo] ?? "" };
  switch (codigo) {
    case "131050":
      return { tipo: "baja_meta" };
    case "130429":
      return origen === "envio" ? { tipo: "frenar_lote" } : { tipo: "fallar_fila" };
    case "131056":
      return origen === "envio" ? { tipo: "reintentar_despues" } : { tipo: "fallar_fila" };
    default:
      return { tipo: "fallar_fila" };
  }
}
