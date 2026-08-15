/**
 * Cómo se nombra un lead donde no se lo puede editar.
 *
 * Desde que el pipeline siembra `nombre` con el perfil de Meta, el vacío quedó
 * para los canales que no mandan nombre —Instagram y Messenger— y para los leads
 * cargados a mano. Es raro, pero sigue siendo posible. Donde hay lugar para
 * editarlo —el Twin— el vacío es una invitación a escribirlo; donde no lo hay
 * —la lista, el header— dejar el hueco en blanco hace que la fila parezca rota.
 */
export function nombreVisible(nombre: string): string {
  return nombre.trim() === "" ? "Sin nombre" : nombre.trim();
}

/** `true` cuando todavía nadie identificó al lead: sirve para atenuarlo. */
export function sinNombre(nombre: string): boolean {
  return nombre.trim() === "";
}
