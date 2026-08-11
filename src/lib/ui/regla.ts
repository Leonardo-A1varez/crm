/**
 * Cómo se nombra una regla IF/THEN en pantalla.
 *
 * El schema no le da nombre propio: `reglas` es intent + condiciones +
 * respuesta. Lo que la identifica para una persona es la primera línea de su
 * respuesta, y esa convención tiene que ser la misma en la tabla de la consola
 * del agente y en la auditoría de un turno del inbox — dos lugares donde se lee
 * la misma regla y donde dos derivaciones distintas darían dos nombres.
 */
export function nombreDeRegla(respuestaContenido: string): string {
  const primera = respuestaContenido.split("\n")[0]?.trim() ?? "";
  return primera.length > 0 ? primera : "(sin contenido)";
}
