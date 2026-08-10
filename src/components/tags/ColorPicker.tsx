import { TAG_COLORS, esTagColor } from "@/lib/ui/tag-color";

/**
 * Selector de color de la paleta cerrada. Radios nativos y no botones con
 * estado propio: el formulario lee por `FormData`, el grupo queda navegable con
 * las flechas del teclado y `required` impide guardar sin color sin agregar
 * validación aparte. Lo seleccionado se ve por `peer-checked`, sin JS.
 */
export function ColorPicker({
  name,
  defaultValue,
  disabled,
  onValueChange,
}: {
  name: string;
  defaultValue?: string;
  disabled?: boolean;
  /** Solo para la vista previa del formulario: lo que se guarda sale del FormData. */
  onValueChange?: (color: string) => void;
}) {
  // Una etiqueta cargada por SQL antes de esta pantalla puede traer un hex
  // fuera de la paleta. No se agrega como opción: el punto de la paleta es que
  // todas se lean sobre el fondo oscuro. Se avisa y se obliga a elegir.
  const fueraDePaleta = defaultValue !== undefined && !esTagColor(defaultValue);

  return (
    <fieldset disabled={disabled} className="flex flex-col gap-1.5">
      <legend className="text-muted-foreground text-xs">Color *</legend>
      <div className="mt-1.5 flex flex-wrap gap-2.5">
        {TAG_COLORS.map((c) => (
          <label key={c.value} className="cursor-pointer">
            <input
              type="radio"
              name={name}
              value={c.value}
              required
              defaultChecked={c.value === defaultValue}
              onChange={() => onValueChange?.(c.value)}
              className="peer sr-only"
            />
            {/* `color` inline alimenta el `outline-current` del estado elegido:
                el anillo tiene que ser del color del swatch y Tailwind no puede
                generar una clase por hex. */}
            <span
              aria-hidden
              className="block size-7 rounded-[9px] border-2 outline-offset-[3px] outline-current peer-checked:outline-2 peer-focus-visible:outline-2 peer-focus-visible:outline-dashed"
              style={{ backgroundColor: `${c.value}2E`, borderColor: c.value, color: c.value }}
            />
            <span className="sr-only">{c.label}</span>
          </label>
        ))}
      </div>
      {fueraDePaleta ? (
        <p className="text-warn mt-0.5 text-[11px]">
          El color actual ({defaultValue}) quedó fuera de la paleta. Elegí uno para poder guardar.
        </p>
      ) : null}
    </fieldset>
  );
}
