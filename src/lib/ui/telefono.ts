/**
 * Separación del código de país en los teléfonos que muestra la UI.
 *
 * `593979932363` es ilegible de un vistazo; `+593 979932363` se lee. Meta
 * entrega el número en E.164 sin `+` ni separadores, así que el corte lo
 * tenemos que hacer nosotros.
 *
 * Tabla propia y no una librería: el mercado del producto son ocho países y una
 * dependencia de 200 kB para partir un string es peor negocio que ocho filas.
 */

export interface CodigoPais {
  readonly codigo: string;
  readonly pais: string;
}

/**
 * Los ocho países del mercado (README §1). Declarados por código ascendente.
 *
 * `as const` y no una anotación suelta: la tabla de banderas del panel se tipa
 * contra estos códigos, así que agregar un país al mercado sin dibujarle la
 * bandera deja de compilar en vez de fallar callado en pantalla.
 */
export const CODIGOS_PAIS = [
  { codigo: "51", pais: "Perú" },
  { codigo: "52", pais: "México" },
  { codigo: "54", pais: "Argentina" },
  { codigo: "55", pais: "Brasil" },
  { codigo: "56", pais: "Chile" },
  { codigo: "57", pais: "Colombia" },
  { codigo: "593", pais: "Ecuador" },
  { codigo: "595", pais: "Paraguay" },
] as const satisfies readonly CodigoPais[];

/** Los códigos que la tabla reconoce, como unión de literales. */
export type CodigoTelefono = (typeof CODIGOS_PAIS)[number]["codigo"];

/**
 * El matcheo va del código más largo al más corto, no en el orden declarado.
 *
 * Hoy ningún código de la tabla es prefijo de otro, así que cualquier orden da
 * el mismo resultado; el día que se agregue uno de dos dígitos que sí lo sea
 * —`59` sobre `593` y `595`— el orden declarado devolvería el país equivocado
 * en silencio. Ordenar por largo hace que ese día no exista.
 */
// Sin anotar el tipo: anotarlo como `CodigoPais[]` ensancharía `codigo` de
// vuelta a `string` y la tabla de banderas dejaría de estar comprobada.
const POR_LARGO_DESC = [...CODIGOS_PAIS].sort((a, b) => b.codigo.length - a.codigo.length);

/**
 * Mínimo de dígitos que tiene que quedar después del código para creerle al
 * corte. Los números nacionales de estos ocho países tienen 8 dígitos o más;
 * cortar `5411` en `+54 11` sería partir mal un número que no es E.164.
 */
const MIN_NACIONAL = 6;

/** Solo el `+` inicial y los separadores de escritura; el resto tiene que ser dígito. */
const SEPARADORES = /[\s().-]/g;

export interface TelefonoPartido {
  /** Código de país sin `+`. */
  codigo: CodigoTelefono;
  /** El resto del número, tal como vino. */
  nacional: string;
  pais: string;
}

/**
 * Parte el número en código de país y resto, o `null` si no se puede afirmar.
 *
 * Devuelve `null` —y no un corte a ciegas— cuando el valor no es un E.164 de la
 * tabla: los leads de Instagram y Messenger no tienen teléfono y guardan
 * `ig:17841400000000` en esa columna, y un número de un país fuera del mercado
 * no se parte mejor por adivinarle dos dígitos.
 */
export function separarTelefono(raw: string): TelefonoPartido | null {
  const limpio = raw.trim().replace(SEPARADORES, "").replace(/^\+/, "");
  if (limpio === "" || !/^\d+$/.test(limpio)) return null;

  for (const { codigo, pais } of POR_LARGO_DESC) {
    if (!limpio.startsWith(codigo)) continue;
    const nacional = limpio.slice(codigo.length);
    if (nacional.length < MIN_NACIONAL) return null;
    return { codigo, nacional, pais };
  }
  return null;
}

/**
 * El teléfono como se muestra en la ficha: `+593 979932363`.
 *
 * Lo que no matchea ningún código vuelve **tal cual llegó**. Mostrar el número
 * sin partir es un formato pobre; partirlo mal es un dato equivocado, y el
 * vendedor lo copia al marcador.
 */
export function formatearTelefono(raw: string): string {
  const partido = separarTelefono(raw);
  return partido ? `+${partido.codigo} ${partido.nacional}` : raw;
}
