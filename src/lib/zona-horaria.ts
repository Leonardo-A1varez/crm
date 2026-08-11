/**
 * La hora de pared del negocio.
 *
 * Una sola forma de manejar husos en todo el proyecto: `Intl` con
 * `formatToParts`, que es lo único que resuelve horario de verano sin traer una
 * librería —hacer la cuenta a mano falla dos veces al año, y el repo no suma
 * deps de fechas: `date-fns` no maneja zonas sin `date-fns-tz`—.
 *
 * De acá leen los dos lugares que necesitan saber qué hora es "allá":
 * `lib/agente/horario.ts` para decidir si el negocio está abierto, y el
 * recordatorio de seguimiento para convertir "martes a las 10" en un instante.
 *
 * **La zona es la del negocio (`agente_config.horario_timezone`), nunca la del
 * navegador.** Un vendedor que viaja, o un dueño que mira el panel desde otro
 * país, tienen que ver y programar la misma hora que el que está en el local.
 */

/** Hora de pared en una zona: lo que marca el reloj de la pared, sin offset. */
export interface HoraDePared {
  anio: number;
  /** 1-12, no 0-11: esto es lo que se lee, no un índice de `Date`. */
  mes: number;
  dia: number;
  horas: number;
  minutos: number;
}

/** `true` si `Intl` reconoce la zona. `""` y `"No/Existe"` dan `false`. */
export function zonaValida(tz: string): boolean {
  return formateador(tz) !== null;
}

function formateador(tz: string): Intl.DateTimeFormat | null {
  if (tz === "") return null;
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      // `hourCycle` y no `hour12: false`: este último hace que algunos runtimes
      // devuelvan "24" para la medianoche.
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return null;
  }
}

/**
 * Qué hora es en `tz` en ese instante. `null` si la zona no existe o la fecha
 * es inválida — quien llame decide qué hacer con eso, porque el default seguro
 * no es el mismo para "¿está abierto?" que para "¿qué muestro?".
 */
export function horaDePared(tz: string, instante: Date): HoraDePared | null {
  const fmt = formateador(tz);
  if (fmt === null || Number.isNaN(instante.getTime())) return null;

  let partes: Intl.DateTimeFormatPart[];
  try {
    partes = fmt.formatToParts(instante);
  } catch {
    return null;
  }

  const leer = (tipo: Intl.DateTimeFormatPartTypes): number => {
    const valor = partes.find((p) => p.type === tipo)?.value;
    return valor === undefined ? NaN : Number(valor);
  };

  const anio = leer("year");
  const mes = leer("month");
  const dia = leer("day");
  const horas = leer("hour");
  const minutos = leer("minute");
  if ([anio, mes, dia, horas, minutos].some(Number.isNaN)) return null;

  // `% 24` por si un runtime viejo ignora `hourCycle` y devuelve 24.
  return { anio, mes, dia, horas: horas % 24, minutos };
}

/** 0 = domingo. Se deriva de la fecha civil y no del `weekday` de `Intl`. */
export function diaSemanaDePared(pared: HoraDePared): number {
  return new Date(Date.UTC(pared.anio, pared.mes - 1, pared.dia)).getUTCDay();
}

/**
 * El camino inverso: "martes 18 de agosto a las 10:00 en Buenos Aires" → el
 * instante real. Es la conversión que decide si el recordatorio salta a la hora
 * que el vendedor pidió o a otra.
 *
 * Dos pasadas porque el offset depende del instante y el instante depende del
 * offset: la primera estima el offset tratando la hora de pared como si fuera
 * UTC, la segunda lo recalcula ya parado sobre la fecha corregida. Sin la
 * segunda, una fecha del otro lado de un cambio de horario de verano sale
 * corrida una hora.
 *
 * CASOS RAROS DEL HORARIO DE VERANO, aceptados a propósito:
 *   * Hora que no existe (el salto hacia adelante se come 02:30): converge al
 *     instante equivalente ya corrido. El recordatorio salta una hora después
 *     de lo escrito, no se pierde.
 *   * Hora repetida (el salto hacia atrás la ocurre dos veces): elige una de
 *     las dos. Un aviso interno con una hora de diferencia no justifica una API
 *     que obligue a desambiguar.
 *
 * `null` si la zona no existe o los campos no forman una fecha.
 */
export function instanteDesdeHoraDePared(tz: string, pared: HoraDePared): Date | null {
  const comoSiFueraUtc = Date.UTC(pared.anio, pared.mes - 1, pared.dia, pared.horas, pared.minutos);
  if (Number.isNaN(comoSiFueraUtc)) return null;

  let ts = comoSiFueraUtc;
  for (let i = 0; i < 2; i++) {
    const offset = offsetMs(tz, new Date(ts));
    if (offset === null) return null;
    const corregido = comoSiFueraUtc - offset;
    if (corregido === ts) break;
    ts = corregido;
  }
  return new Date(ts);
}

/** Cuánto adelanta `tz` respecto de UTC en ese instante, en ms. */
function offsetMs(tz: string, instante: Date): number | null {
  const pared = horaDePared(tz, instante);
  if (pared === null) return null;
  // Se compara contra el instante truncado al minuto porque `horaDePared` no
  // trae segundos. Todos los offsets IANA modernos son minutos enteros.
  const base = Math.floor(instante.getTime() / 60_000) * 60_000;
  return Date.UTC(pared.anio, pared.mes - 1, pared.dia, pared.horas, pared.minutos) - base;
}

const DIAS_CORTOS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"] as const;
const MESES_CORTOS = [
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

/**
 * Los nombres se escriben acá y no se piden a `date-fns` ni al locale de `Intl`
 * por dos razones: `date-fns` formatea siempre en la zona del navegador —usarlo
 * obligaría a fabricar un `Date` mentiroso con los componentes corridos— y el
 * texto corto de `Intl` cambia entre versiones de ICU, lo que haría frágil
 * cualquier test sobre lo que el vendedor lee.
 */
function conCero(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Si la zona configurada no existe, se muestra UTC antes que una hora inventada. */
function paredOUtc(tz: string, instante: Date): HoraDePared | null {
  return horaDePared(tz, instante) ?? horaDePared("UTC", instante);
}

/** "mié 13 ago, 15:40" en la hora del negocio. Día y hora, que es lo que hace falta para confiar. */
export function fechaLegibleEnZona(tz: string, instante: Date): string {
  const p = paredOUtc(tz, instante);
  if (p === null) return "";
  const dia = DIAS_CORTOS[diaSemanaDePared(p)] ?? "";
  const mes = MESES_CORTOS[p.mes - 1] ?? "";
  return `${dia} ${p.dia} ${mes}, ${conCero(p.horas)}:${conCero(p.minutos)}`;
}

/** "2026-08-13": el valor de un `<input type="date">` en la hora del negocio. */
export function campoFechaEnZona(tz: string, instante: Date): string {
  const p = paredOUtc(tz, instante);
  if (p === null) return "";
  return `${p.anio}-${conCero(p.mes)}-${conCero(p.dia)}`;
}

/** "15:40": el valor de un `<input type="time">` en la hora del negocio. */
export function campoHoraEnZona(tz: string, instante: Date): string {
  const p = paredOUtc(tz, instante);
  if (p === null) return "";
  return `${conCero(p.horas)}:${conCero(p.minutos)}`;
}

const CAMPO_FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;
const CAMPO_HORA = /^(\d{2}):(\d{2})$/;

/**
 * Lo que devuelven los dos inputs nativos, leído como hora del negocio.
 *
 * Se valida el rango de los componentes en vez de dejar que `Date.UTC` los
 * normalice: un "2026-02-31" que se convierte solo en el 3 de marzo es
 * exactamente la clase de sorpresa que hace desconfiar de un recordatorio.
 */
export function instanteDesdeCampos(tz: string, fecha: string, hora: string): Date | null {
  const f = CAMPO_FECHA.exec(fecha);
  const h = CAMPO_HORA.exec(hora);
  if (!f || !h) return null;

  const pared: HoraDePared = {
    anio: Number(f[1]),
    mes: Number(f[2]),
    dia: Number(f[3]),
    horas: Number(h[1]),
    minutos: Number(h[2]),
  };
  if (pared.mes < 1 || pared.mes > 12 || pared.dia < 1 || pared.dia > 31) return null;
  if (pared.horas > 23 || pared.minutos > 59) return null;

  const instante = instanteDesdeHoraDePared(tz, pared);
  if (instante === null) return null;

  // Un 31 de febrero pasa las guardas de arriba y `Date.UTC` lo corre al 3 de
  // marzo. La única forma barata de detectarlo es volver a leer la fecha.
  const vuelta = paredOUtc(tz, instante);
  if (vuelta === null || vuelta.dia !== pared.dia || vuelta.mes !== pared.mes) return null;

  return instante;
}

/**
 * "Buenos Aires" a partir de "America/Argentina/Buenos_Aires".
 *
 * Para el rótulo del selector: el vendedor tiene que ver de qué reloj le están
 * hablando, y el identificador IANA crudo no es algo que nadie quiera leer.
 */
export function ciudadDeZona(tz: string): string {
  const ultimo = tz.split("/").at(-1) ?? tz;
  return ultimo.replaceAll("_", " ");
}
