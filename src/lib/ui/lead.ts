/**
 * Cómo se nombra un lead donde no se lo puede editar.
 *
 * El pipeline crea los leads con `nombre: ""` y nunca copia el de Meta, así que
 * el vacío es frecuente y no es una anomalía. Donde hay lugar para editarlo
 * —el Twin— el vacío es una invitación a escribirlo; donde no lo hay —la lista,
 * el header— dejar el hueco en blanco hace que la fila parezca rota.
 */
export function nombreVisible(nombre: string): string {
  return nombre.trim() === "" ? "Sin nombre" : nombre.trim();
}

/** `true` cuando todavía nadie identificó al lead: sirve para atenuarlo. */
export function sinNombre(nombre: string): boolean {
  return nombre.trim() === "";
}
