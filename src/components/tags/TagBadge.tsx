/**
 * La etiqueta tal como la ve el vendedor en la ficha del lead. La pantalla de
 * administración la repite en vez de listar el nombre pelado para que el admin
 * elija el color mirando el resultado y no un swatch suelto.
 */
export function TagBadge({ nombre, color }: { nombre: string; color: string }) {
  return (
    <span
      className="inline-flex max-w-full items-center truncate rounded-md border px-[7px] py-[2.5px] text-[10.5px] font-semibold"
      style={{ borderColor: color, color }}
    >
      {nombre}
    </span>
  );
}
