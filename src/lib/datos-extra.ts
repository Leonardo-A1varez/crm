/**
 * Campos libres del lead: las reglas que gobiernan `leads.datos_extra`.
 *
 * El vendedor escribe nombre y valor a mano ("Cumpleaños" / "12/03") y eso se
 * guarda en un jsonb. Las dos cosas que hay que impedir son que una clave libre
 * duplique una columna real —dos fuentes del mismo dato, y ninguna manda— y que
 * el objeto crezca sin techo.
 *
 * Vive en `lib/` porque lo necesitan los tres lados: el schema de la Server
 * Action al validar, el service al escribir y el Twin al mostrar.
 */

/**
 * Nombres que ya tienen columna en `leads`, en las formas en que alguien los
 * escribiría a mano. Se comparan normalizados, así que "Teléfono", "telefono" y
 * "TELEFONO" caen todos acá.
 */
const CLAVES_RESERVADAS: readonly string[] = [
  "id",
  "nombre",
  "nombre perfil",
  "contacto",
  "telefono",
  "email",
  "e-mail",
  "correo",
  "direccion",
  "vehiculo",
  "vehiculo marca",
  "vehiculo modelo",
  "vehiculo anio",
  "vehiculo año",
  "vehiculo motor",
  "marca",
  "modelo",
  "motor",
  "canal",
  "canal origen",
  "empresa",
  "datos extra",
  "meta user ids",
];

/** Tope de campos libres por lead. Es una ficha, no una base de datos. */
export const MAX_DATOS_EXTRA = 20;

/** Largo máximo del nombre del campo: más que esto deja de leerse en 322px. */
export const MAX_LARGO_CLAVE = 40;

/** Largo máximo del valor. Un párrafo va en la consulta, no en un campo suelto. */
export const MAX_LARGO_VALOR = 200;

/**
 * Forma canónica para comparar dos nombres de campo.
 *
 * Saca acentos, mayúsculas y todo lo que no sea letra o número, así que
 * "Vehículo Marca", "vehiculo_marca" y "VehiculoMarca" son la misma clave. Es
 * solo para comparar: lo que se guarda y se muestra es lo que escribió la
 * persona.
 */
export function claveComparable(clave: string): string {
  return clave
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

const RESERVADAS = new Set(CLAVES_RESERVADAS.map(claveComparable));

/** `true` si el nombre choca con una columna real de `leads`. */
export function esClaveReservada(clave: string): boolean {
  return RESERVADAS.has(claveComparable(clave));
}

/**
 * Devuelve el objeto con el campo agregado o pisado.
 *
 * Si ya existe una clave equivalente —distinta capitalización, con o sin
 * acento— se sobrescribe **esa**, conservando cómo estaba escrita. Agregar una
 * segunda dejaría dos filas que dicen lo mismo con distinto valor.
 */
export function conDatoExtra(
  actuales: Record<string, string>,
  clave: string,
  valor: string,
): Record<string, string> {
  const comparable = claveComparable(clave);
  const existente = Object.keys(actuales).find((k) => claveComparable(k) === comparable);
  return { ...actuales, [existente ?? clave]: valor };
}

/**
 * Devuelve el objeto sin ese campo.
 *
 * La clave se busca por su forma comparable y no por igualdad literal: lo que
 * viaja desde el `×` es el texto de la fila, y un campo guardado como
 * "Cumpleaños" tiene que poder borrarse aunque llegue "cumpleanos". Sin eso, un
 * campo escrito con acento quedaría imposible de sacar, que es justo el caso
 * que el borrado viene a resolver.
 *
 * Si no hay ninguna clave equivalente devuelve un objeto igual al de entrada:
 * borrar lo que ya no está no es un error.
 */
export function sinDatoExtra(
  actuales: Record<string, string>,
  clave: string,
): Record<string, string> {
  const comparable = claveComparable(clave);
  return Object.fromEntries(
    Object.entries(actuales).filter(([k]) => claveComparable(k) !== comparable),
  );
}

/** `true` si agregar esa clave superaría el tope (pisar una que ya está, no). */
export function excedeTope(actuales: Record<string, string>, clave: string): boolean {
  const comparable = claveComparable(clave);
  const yaEsta = Object.keys(actuales).some((k) => claveComparable(k) === comparable);
  return !yaEsta && Object.keys(actuales).length >= MAX_DATOS_EXTRA;
}
