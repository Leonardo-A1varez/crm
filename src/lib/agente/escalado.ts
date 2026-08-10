/**
 * Condiciones de escalado del handoff §4.2 que se resuelven mirando el texto
 * entrante. Vive en `lib/` y no en un service porque lo comparten dos lados:
 * el pipeline lo evalúa por turno y el schema de la Server Action lo usa para
 * dejar la lista canónica antes de guardarla. Si cada uno normalizara por su
 * cuenta, se guardaría "Devolución" y no coincidiría nunca con "devolucion".
 */

/** Minúsculas, sin tildes, sin espacios de más. Dos escrituras de la misma palabra colapsan. */
export function normalizarTexto(valor: string): string {
  return valor
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Largo máximo de una palabra o frase. Lo valida Zod; el CHECK de la migración solo acota la cantidad. */
export const MAX_LARGO_PALABRA = 60;

/** Cantidad máxima de palabras. Espeja `agente_config_palabras_cantidad`. */
export const MAX_PALABRAS = 50;

/**
 * Rangos del handoff §4.2. Viven acá y no en el schema de Zod porque los usan
 * los tres lados: el schema al validar, el CHECK de la migración al que espejan
 * y los steppers de la pantalla. Tres literales sueltos se desincronizan.
 */
export const UMBRAL_INTENTS_MIN = 1;
export const UMBRAL_INTENTS_MAX = 5;
export const COTIZACION_MIN = 100_000;
export const COTIZACION_MAX = 2_000_000;
export const COTIZACION_PASO = 100_000;

/** Corte de `buscar_repuesto` en ms (§4.4). Espeja `agente_config_timeout_rango`. */
export const TIMEOUT_TOOL_MIN_MS = 500;
export const TIMEOUT_TOOL_MAX_MS = 30_000;

/**
 * Deja la lista lista para guardar: normaliza, descarta vacías y deduplica
 * conservando el orden en que las escribió el admin — la primera aparición es
 * la que se ve en los chips.
 */
export function normalizarPalabrasEscalado(palabras: string[]): string[] {
  const vistas = new Set<string>();
  const salida: string[] = [];
  for (const cruda of palabras) {
    const p = normalizarTexto(cruda);
    if (p === "" || vistas.has(p)) continue;
    vistas.add(p);
    salida.push(p);
  }
  return salida;
}

/**
 * Prefijo con el que el pipeline arma cada línea del turno (`${sender}: …`).
 * `lead` es el único sender que representa al cliente; `ia`, `humano` y
 * `sistema` son nuestros y no pueden disparar un escalado.
 */
const PREFIJO_CLIENTE = "lead: ";

/**
 * El texto del último mensaje del turno, sólo si lo escribió el cliente.
 *
 * ACOPLAMIENTO CONOCIDO: depende del formato `"${sender}: ${contenido}"` que
 * arma `buildConversationTurn` en el pipeline. Es la única forma de ver el
 * mensaje entrante desde el service — `AgentTurnInput` no lo trae aparte. Por
 * eso `AgentTurnInput.textoEntrante` existe y tiene prioridad: en cuanto el
 * pipeline lo mande, esta lectura por prefijo deja de usarse. Si el formato
 * cambia antes de eso, el escalado por palabra deja de dispararse en silencio
 * — de ahí que `evaluarEscalado` se testee con las dos entradas.
 */
export function textoDelCliente(conversationTurn: string[]): string | null {
  const ultima = conversationTurn.at(-1);
  if (ultima === undefined || !ultima.startsWith(PREFIJO_CLIENTE)) return null;
  return ultima.slice(PREFIJO_CLIENTE.length);
}

/** Los metacaracteres de una palabra escrita por un admin son literales, no un patrón. */
function escaparRegex(valor: string): string {
  return valor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * La primera palabra de la lista que aparece en el texto, o `null`.
 *
 * Coincide por palabra completa y no por subcadena: con `includes`, "factura A"
 * se dispararía dentro de "facturación" y "roto" dentro de "rotonda". Los
 * límites se escriben a mano (`(?<![\p{L}\p{N}])`) en vez de `\b` porque `\b`
 * de JavaScript trata cualquier letra acentuada como límite de palabra y
 * "devolución" dejaría de coincidir con "devolucion" ya normalizado.
 */
export function palabraQueEscala(texto: string | null, palabras: string[]): string | null {
  if (texto === null || palabras.length === 0) return null;
  const normalizado = normalizarTexto(texto);
  if (normalizado === "") return null;

  for (const palabra of palabras) {
    const patron = new RegExp(`(?<![\\p{L}\\p{N}])${escaparRegex(palabra)}(?![\\p{L}\\p{N}])`, "u");
    if (patron.test(normalizado)) return palabra;
  }
  return null;
}

/** Qué condición del §4.2 se cumplió. El motivo es el que queda en la sesión. */
export interface CondicionEscalado {
  condicion: "palabra" | "cotizacion";
  motivo: string;
}

export interface EntradaEscalado {
  palabras: string[];
  /** `null` = condición apagada. */
  cotizacionDesde: number | null;
  /** Lo que la sesión tiene cotizado hasta este turno. `null` = todavía nada. */
  precioCotizado: number | null;
  textoEntrante: string | null;
}

/**
 * Las condiciones del §4.2 que se pueden resolver con lo que el service ya
 * tiene en la mano. Devuelve la PRIMERA que se cumple —el handoff es explícito:
 * "la primera condición que se cumpla pausa la IA"— y `null` si ninguna.
 *
 * Las palabras van antes que la cotización porque son la condición "siempre":
 * si el cliente escribió "abogado", el monto de la cotización ya no importa.
 *
 * Función pura y sin config completa a propósito: recibe los cuatro datos que
 * usa, no un `AgenteConfigValores`, para que agregar un campo a la config no
 * obligue a tocar este archivo ni sus tests.
 */
export function evaluarEscalado(input: EntradaEscalado): CondicionEscalado | null {
  const palabra = palabraQueEscala(input.textoEntrante, input.palabras);
  if (palabra !== null) {
    return { condicion: "palabra", motivo: `El cliente escribió "${palabra}"` };
  }

  if (input.cotizacionDesde !== null && input.precioCotizado !== null) {
    if (input.precioCotizado >= input.cotizacionDesde) {
      return {
        condicion: "cotizacion",
        motivo: `Cotización de ${input.precioCotizado} sobre el tope de ${input.cotizacionDesde}`,
      };
    }
  }

  return null;
}
