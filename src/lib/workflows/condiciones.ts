/**
 * Los campos que una condición puede mirar. Lista blanca a propósito: W3 la
 * amplía agregando entradas acá, y nadie amplía una gramática.
 */
export const CAMPOS_CONDICION = [
  "lead.etapa",
  "lead.nombre",
  "lead.canal",
  "sesion.respondio",
  "sesion.tiene_cotizacion",
] as const;
export type CampoCondicion = (typeof CAMPOS_CONDICION)[number];

export const OPERADORES = ["es", "no_es", "contiene", "es_verdadero", "es_falso"] as const;
export type Operador = (typeof OPERADORES)[number];

export interface Condicion {
  campo: CampoCondicion;
  operador: Operador;
  valor: string | null;
}

function leer(contexto: Record<string, unknown>, campo: string): unknown {
  return campo.split(".").reduce<unknown>((actual, parte) => {
    if (actual === null || typeof actual !== "object") return undefined;
    return (actual as Record<string, unknown>)[parte];
  }, contexto);
}

/**
 * Un campo ausente da `false`, nunca una excepción: que un dato todavía no
 * exista es información, no una falla. La rama `falso` de la condición siempre
 * está conectada porque el validador de W1 lo exige, así que el flujo tiene a
 * dónde ir.
 */
export function evaluarCondicion(cond: Condicion, contexto: Record<string, unknown>): boolean {
  const actual = leer(contexto, cond.campo);
  if (cond.operador === "es_verdadero") return actual === true;
  if (cond.operador === "es_falso") return actual === false;
  if (actual === undefined || actual === null) return false;
  const texto = String(actual);
  if (cond.operador === "es") return texto === cond.valor;
  if (cond.operador === "no_es") return texto !== cond.valor;
  return texto.toLowerCase().includes(String(cond.valor ?? "").toLowerCase());
}
