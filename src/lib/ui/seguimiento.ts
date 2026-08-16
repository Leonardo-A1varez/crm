/**
 * Cómo se lee la fecha de un seguimiento en la lista del Inbox.
 *
 * Un vendedor que mira la bandeja no quiere leer `2026-08-17T15:30:00Z`: quiere
 * saber si es hoy, mañana, o si se le pasó. La fecha exacta solo aporta cuando
 * está lo bastante lejos como para que "en 4 días" no ubique a nadie.
 *
 * Es una función pura y recibe el "ahora": sin eso habría que esperar a mañana
 * para probar el caso de mañana.
 */

const DIAS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"] as const;
const MESES = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sep",
  "oct",
  "nov",
  "dic",
] as const;

export interface SeguimientoLegible {
  /** Lo que se muestra: `hoy 15:30`, `mañana 09:00`, `mar 19 ago 15:30`. */
  texto: string;
  /**
   * `true` cuando la fecha ya pasó. La lista lo usa para marcarlo: un
   * seguimiento vencido no es un dato más, es trabajo atrasado.
   */
  vencido: boolean;
}

/** Medianoche local del día de esa fecha, para comparar días y no instantes. */
function inicioDelDia(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function seguimientoLegible(at: Date, ahora: Date): SeguimientoLegible {
  const vencido = at.getTime() < ahora.getTime();
  const diasDeDiferencia = Math.round(
    (inicioDelDia(at) - inicioDelDia(ahora)) / (24 * 60 * 60 * 1000),
  );

  // El día importa más que las horas: algo agendado a las 09:00 de mañana
  // sigue siendo "mañana" aunque falten 20 horas y no 24.
  if (diasDeDiferencia === 0) return { texto: `hoy ${hhmm(at)}`, vencido };
  if (diasDeDiferencia === 1) return { texto: `mañana ${hhmm(at)}`, vencido };
  if (diasDeDiferencia === -1) return { texto: `ayer ${hhmm(at)}`, vencido };

  // Más lejos que eso, "en 5 días" no ubica a nadie: va la fecha.
  const dia = DIAS[at.getDay()] ?? "";
  const mes = MESES[at.getMonth()] ?? "";
  return { texto: `${dia} ${at.getDate()} ${mes} ${hhmm(at)}`, vencido };
}
