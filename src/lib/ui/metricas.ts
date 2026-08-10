import type { Comparado } from "@/types/metricas";

const ENTERO = new Intl.NumberFormat("es-AR");
const DECIMAL = new Intl.NumberFormat("es-AR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

export function formatearEntero(n: number): string {
  return ENTERO.format(n);
}

/**
 * USD con la precisión que el número necesita. Un turno con un modelo nano
 * cuesta del orden de una milésima de dólar: con dos decimales fijos, todo el
 * gasto por lead se leería "$0,00" y la pantalla no serviría para nada. Por eso
 * los montos chicos muestran cuatro decimales y los grandes dos.
 */
export function formatearUsd(n: number): string {
  const decimales = n !== 0 && Math.abs(n) < 1 ? 4 : 2;
  return `$${n.toLocaleString("es-AR", {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  })}`;
}

/** Miles con sufijo `k`, para los conteos de tokens del handoff §3.2 (412k). */
export function formatearTokens(n: number): string {
  if (n < 1000) return ENTERO.format(n);
  return `${DECIMAL.format(n / 1000)}k`;
}

/** Porcentaje con un decimal: `23,4%`. */
export function formatearPorcentaje(n: number): string {
  return `${DECIMAL.format(n)}%`;
}

/** Parte sobre total en porcentaje. Total en cero devuelve 0, no NaN. */
export function porcentajeDe(parte: number, total: number): number {
  return total > 0 ? Math.round((parte / total) * 1000) / 10 : 0;
}

/**
 * Dirección del cambio contra la ventana anterior. La pantalla la pinta
 * asumiendo que subir es bueno, que es cierto para las dos métricas que hoy
 * llevan delta (leads nuevos y tasa de cierre).
 */
export type SentidoDelta = "sube" | "baja" | "igual";

export interface Delta {
  texto: string;
  sentido: SentidoDelta;
}

function sentidoDe(diferencia: number): SentidoDelta {
  if (diferencia > 0) return "sube";
  if (diferencia < 0) return "baja";
  return "igual";
}

/** El menos tipográfico del handoff (−41%), no el guion del teclado. */
function conSigno(valor: number, unidad: string): string {
  const signo = valor > 0 ? "+" : "−";
  return `${signo}${DECIMAL.format(Math.abs(valor))}${unidad}`;
}

/**
 * Variación relativa contra la ventana anterior. `null` cuando no hay con qué
 * comparar: sin ventana anterior, o con la anterior en cero, donde el porcentaje
 * de cambio es una división por cero y no un "+100%".
 */
export function deltaRelativo({ valor, anterior }: Comparado): Delta | null {
  if (anterior === null || anterior === 0) return null;
  const variacion = ((valor - anterior) / anterior) * 100;
  const redondeada = Math.round(variacion * 10) / 10;
  if (redondeada === 0) return { texto: "sin cambio", sentido: "igual" };
  return { texto: conSigno(redondeada, "%"), sentido: sentidoDe(redondeada) };
}

/**
 * Diferencia en puntos porcentuales, para métricas que ya son un porcentaje:
 * restar dos porcentajes da puntos, no un porcentaje de porcentaje.
 */
export function deltaPuntos({ valor, anterior }: Comparado): Delta | null {
  if (anterior === null) return null;
  const diferencia = Math.round((valor - anterior) * 10) / 10;
  if (diferencia === 0) return { texto: "sin cambio", sentido: "igual" };
  return { texto: conSigno(diferencia, " pts"), sentido: sentidoDe(diferencia) };
}
