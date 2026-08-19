/**
 * Paleta cerrada de colores para las etiquetas.
 *
 * No hay input de color libre a propósito: una etiqueta se lee en un badge de
 * 10px donde el color es a la vez borde y texto, y un hex elegido a mano sobre
 * un picker no garantiza que se lea sobre `--color-surface-root`. Estos nueve
 * son los mismos hex que el handoff original usaba sobre fondo oscuro — ya no
 * viven los seis de las etapas del embudo en `src/lib/ui/stage.ts` (ese
 * archivo pasó a tokens `var(--stage-*)` con el tema claro/oscuro; ver
 * `globals.css`) más el ámbar y el azul de acento.
 *
 * **Estos valores están calibrados para tema oscuro y no tienen contraparte
 * clara.** A diferencia de `stage.ts`, esta paleta se persiste tal cual en
 * `tags.color` (Supabase): una etiqueta creada hoy guarda el hex, no un
 * token, así que "arreglarla" para tema claro no es solo código — implica una
 * migración que reinterprete o reescriba las filas existentes. Queda afuera
 * del alcance del tema claro/oscuro por esa razón. Mismo problema en
 * `COLORES_ETIQUETA` de `src/server/services/inbox/default-inbox.service.ts`,
 * que además sigue escribiendo `#FFAF3A` (ámbar pre-rebrand) en etiquetas
 * nuevas creadas al vuelo desde el Twin — tampoco se tocó en esta rama por el
 * mismo motivo de datos persistidos.
 *
 * **Es un superconjunto de `COLORES_ETIQUETA`** (`default-inbox.service.ts`),
 * los seis con los que el Twin pinta las etiquetas que se crean al vuelo desde
 * la conversación. Tiene que seguir siéndolo: si la paleta dejara afuera un
 * color que el Twin genera, esas etiquetas no se podrían editar acá sin
 * cambiarles el color. `tests/unit/ui/tag-color.test.ts` lo verifica.
 */
export const TAG_COLORS = [
  { value: "#FFAF3A", label: "Ámbar" },
  { value: "#FB923C", label: "Naranja" },
  { value: "#F87171", label: "Rojo" },
  { value: "#E879F9", label: "Magenta" },
  { value: "#A78BFA", label: "Violeta" },
  { value: "#818CF8", label: "Índigo" },
  { value: "#7FB3F5", label: "Azul" },
  { value: "#38BDF8", label: "Cielo" },
  { value: "#34D399", label: "Verde" },
] as const;

export type TagColor = (typeof TAG_COLORS)[number]["value"];

/** Tupla no vacía: es la forma que `z.enum` necesita para tipar el union. */
export const TAG_COLOR_VALUES: readonly [TagColor, ...TagColor[]] = [
  TAG_COLORS[0].value,
  ...TAG_COLORS.slice(1).map((c) => c.value),
];

export function esTagColor(valor: string): valor is TagColor {
  return (TAG_COLOR_VALUES as readonly string[]).includes(valor);
}

/**
 * Nombre del color para lectores de pantalla y tooltips. Una etiqueta cargada
 * por SQL antes de esta pantalla puede tener un hex fuera de la paleta: se
 * devuelve el hex crudo en vez de inventarle un nombre.
 */
export function tagColorLabel(valor: string): string {
  return TAG_COLORS.find((c) => c.value === valor)?.label ?? valor;
}
