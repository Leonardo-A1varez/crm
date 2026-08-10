/**
 * Par etiqueta/valor de la ficha.
 *
 * Sin valor **no se dibuja nada**. La raya que había antes ocupaba el mismo
 * espacio que un dato y no decía nada: ocho filas con guiones hacen parecer que
 * falta información cuando nunca la hubo. Devolver `null` deja que quien llama
 * escriba la fila sin preguntar si hay dato.
 */
export function TwinField({ label, value }: { label: string; value?: React.ReactNode }) {
  if (value === undefined || value === null || value === "") return null;

  return (
    <div>
      <div className="text-ink-faint text-[10.5px]">{label}</div>
      <div className="text-ink-secondary mt-[3px] text-[12.5px]">{value}</div>
    </div>
  );
}
