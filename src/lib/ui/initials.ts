/**
 * Iniciales para avatares: primera letra de la primera y de la última palabra.
 * Los nombres de lead llegan del perfil de Meta, así que pueden venir vacíos,
 * con espacios de más o con una sola palabra.
 */
export function initials(nombre: string): string {
  const partes = nombre.trim().split(/\s+/).filter(Boolean);
  const primera = partes.at(0)?.charAt(0) ?? "";
  const ultima = partes.length > 1 ? (partes.at(-1)?.charAt(0) ?? "") : "";
  const resultado = `${primera}${ultima}`.toLocaleUpperCase("es");
  return resultado === "" ? "?" : resultado;
}
