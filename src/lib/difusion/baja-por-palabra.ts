/**
 * Qué mensaje entrante es una baja propia: las cuatro palabras de
 * `docs/prd-workflows.md` §13 ("BAJA", "SALIR", "PARAR", "SAIR"), en español y
 * portugués.
 *
 * ## La regla
 *
 * La palabra **sola**: el mensaje entero, sin importar tildes ni mayúsculas, y
 * tolerando espacios, puntuación y emojis alrededor ("¡Baja!", "PARAR 🙏").
 * Nada más. "No quiero salir de la promo" o "baja por favor" no son bajas.
 *
 * Es estricta a propósito: una baja no se deshace por escritura automática
 * (`difusion_supresiones` sólo la levanta un admin, con motivo), así que un
 * falso positivo le corta el marketing a alguien que no lo pidió, y nadie se
 * entera. Uno que se escapa ("quiero la baja") lo resuelve una persona leyendo
 * la conversación.
 */

export const PALABRAS_DE_BAJA = ["BAJA", "SALIR", "PARAR", "SAIR"] as const;

/**
 * Lo que se le contesta a quien acaba de darse de baja, textual (decisión del
 * dueño). Sólo con una baja nueva: el que escribe BAJA tres veces recibe una.
 * Es texto libre transaccional dentro de la ventana de 24 h —el cliente acaba
 * de escribir—, no marketing: la baja recién registrada no lo bloquea.
 */
export const CONFIRMACION_BAJA =
  "Listo, no te enviaremos más promociones. Si fue un error, escríbenos y lo revertimos.";
export type PalabraDeBaja = (typeof PALABRAS_DE_BAJA)[number];

/** Tildes y demás marcas que deja `normalize("NFD")` separadas de su letra. */
const MARCAS = /\p{M}/gu;

/**
 * Lo que puede rodear a la palabra sin cambiar que esté sola: espacios,
 * puntuación ("¡", "?", "."), símbolos (los emojis son `\p{S}`) y los
 * caracteres invisibles de formato que unen emojis compuestos.
 */
const BORDES = /^[\p{P}\p{S}\p{Cf}\s]+|[\p{P}\p{S}\p{Cf}\s]+$/gu;

const PALABRAS: ReadonlySet<string> = new Set(PALABRAS_DE_BAJA);

function esPalabraDeBaja(valor: string): valor is PalabraDeBaja {
  return PALABRAS.has(valor);
}

/**
 * La palabra de baja que es el mensaje, en mayúsculas, o `null` si el mensaje
 * no es una baja. Lo que devuelve es lo que se guarda en
 * `difusion_supresiones.detalle`: la palabra, nunca el texto del cliente.
 */
export function palabraDeBaja(texto: string | null | undefined): PalabraDeBaja | null {
  if (!texto) return null;
  const limpio = texto.normalize("NFD").replace(MARCAS, "").replace(BORDES, "").toUpperCase();
  return esPalabraDeBaja(limpio) ? limpio : null;
}
