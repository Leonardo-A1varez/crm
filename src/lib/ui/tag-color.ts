/**
 * Paleta cerrada de colores para las etiquetas.
 *
 * No hay input de color libre a propósito. El panel es solo tema oscuro
 * (handoff §Fidelity) y una etiqueta se lee en un badge de 10px donde el color
 * es a la vez borde y texto: un hex elegido a mano sobre un picker claro
 * produce etiquetas que no se leen sobre `--color-surface-root`. Estos nueve
 * son colores que el handoff ya usa sobre ese fondo — los seis de las etapas
 * del embudo (`src/lib/ui/stage.ts`) más el ámbar y el azul de acento.
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
