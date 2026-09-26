/**
 * Los atajos de teclado del editor, como funciones puras.
 *
 * - **⌘K / Ctrl+K** lleva a la búsqueda de bloques.
 * - **Tab / Shift+Tab** con el foco en el lienzo pasa al bloque siguiente o
 *   anterior, en orden de lectura, y lo abre en el panel.
 *
 * Ninguno de los dos actúa con el foco en un campo de texto: ahí Ctrl+K y Tab
 * son del campo. Y Tab no atrapa: en el último bloque deja pasar la tecla y el
 * foco sale del lienzo como en cualquier otro lado (WCAG 2.1.2).
 */

interface NodoPosicionado {
  id: string;
  position: { x: number; y: number };
}

/** El bloque que sigue en orden de lectura. `null` = no hay más en esa dirección. */
export function siguienteNodo(
  nodos: readonly NodoPosicionado[],
  actual: string | null,
  atras: boolean,
): string | null {
  const orden = [...nodos].sort(
    (a, b) => a.position.y - b.position.y || a.position.x - b.position.x,
  );
  if (orden.length === 0) return null;
  const i = actual === null ? -1 : orden.findIndex((n) => n.id === actual);
  if (i === -1) return (atras ? orden[orden.length - 1] : orden[0])?.id ?? null;
  return orden[atras ? i - 1 : i + 1]?.id ?? null;
}

const TIPOS_DE_INPUT_SIN_TEXTO = new Set([
  "checkbox",
  "radio",
  "button",
  "submit",
  "reset",
  "range",
  "color",
  "file",
]);

/** Si el foco está en algo donde se escribe. */
export function esCampoEditable(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el instanceof HTMLInputElement) return !TIPOS_DE_INPUT_SIN_TEXTO.has(el.type);
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  return el.isContentEditable || el.closest("[contenteditable='true']") !== null;
}

/** ⌘K en Mac, Ctrl+K en el resto, sin Shift ni Alt. */
export function esAtajoBuscar(e: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}): boolean {
  return e.key.toLowerCase() === "k" && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey;
}
