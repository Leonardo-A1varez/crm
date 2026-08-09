import { DIAS_SEMANA, type DiaSemana, type Horario, type RangoHorario } from "@/types/agente";

const HORA_VALIDA = /^([01]\d|2[0-3]):([0-5]\d)$/;

function aMinutos(hhmm: string): number | null {
  const m = HORA_VALIDA.exec(hhmm);
  if (!m) return null;
  const horas = Number(m[1]);
  const minutos = Number(m[2]);
  return horas * 60 + minutos;
}

export function esTimezoneValida(tz: string): boolean {
  if (tz === "") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Ordena por inicio, descarta invalidos y fusiona solapados o adyacentes.
 * Se aplica antes de guardar: dejar rangos solapados en la base obliga a que
 * cada lector los resuelva, y tarde o temprano uno lo hace distinto.
 *
 * LIMITACION CONOCIDA: un rango que cruza medianoche (22:00-02:00) se descarta
 * por invertido. El modelo es "rangos dentro de un dia", no "intervalos en una
 * linea de tiempo". Para un negocio nocturno hay que partirlo en dos dias
 * —lun 22:00-23:59 y mar 00:00-02:00— y eso funciona sin huecos, pero la UI
 * tiene que guiarlo: quien escriba 22:00-02:00 a mano se queda sin horario y
 * en silencio. Aceptado a proposito: soportar wrap-around mete logica de
 * frontera de dia en `estaAbierto` por un caso que un negocio de repuestos
 * casi no tiene.
 */
export function normalizarRangos(rangos: RangoHorario[]): RangoHorario[] {
  const validos = rangos
    .map((r) => ({ desde: aMinutos(r.desde), hasta: aMinutos(r.hasta), original: r }))
    .filter(
      (r): r is { desde: number; hasta: number; original: RangoHorario } =>
        r.desde !== null && r.hasta !== null && r.desde < r.hasta,
    )
    .sort((a, b) => a.desde - b.desde);

  const out: { desde: number; hasta: number; original: RangoHorario }[] = [];
  for (const rango of validos) {
    const ultimo = out.at(-1);
    if (ultimo && rango.desde <= ultimo.hasta) {
      // Solapado o adyacente: extiende el anterior en vez de agregar uno nuevo.
      if (rango.hasta > ultimo.hasta) {
        ultimo.hasta = rango.hasta;
        ultimo.original = { desde: ultimo.original.desde, hasta: rango.original.hasta };
      }
      continue;
    }
    out.push({ ...rango, original: { ...rango.original } });
  }

  return out.map((r) => r.original);
}

/**
 * Extrae dia de semana y minutos del dia en la timezone dada. `Intl` es lo
 * unico que resuelve esto bien sin una libreria: hacer la cuenta a mano falla
 * en horario de verano.
 */
function momentoLocal(tz: string, ahora: Date): { dia: DiaSemana; minutos: number } | null {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const partes = fmt.formatToParts(ahora);
    const weekday = partes.find((p) => p.type === "weekday")?.value ?? "";
    const hora = Number(partes.find((p) => p.type === "hour")?.value ?? NaN);
    const minuto = Number(partes.find((p) => p.type === "minute")?.value ?? NaN);
    if (Number.isNaN(hora) || Number.isNaN(minuto)) return null;

    const mapa: Record<string, DiaSemana> = {
      Mon: "lun",
      Tue: "mar",
      Wed: "mie",
      Thu: "jue",
      Fri: "vie",
      Sat: "sab",
      Sun: "dom",
    };
    const dia = mapa[weekday];
    if (!dia) return null;

    // Intl devuelve "24" para medianoche con hour12:false en algunos runtimes.
    return { dia, minutos: (hora % 24) * 60 + minuto };
  } catch {
    return null;
  }
}

/**
 * Los bordes cuentan como abierto: un rango 08:00-18:00 incluye las 18:00.
 *
 * Ante timezone invalida o `Intl` que falla, devuelve `true` (abierto). Cerrar
 * el agente por una zona mal escrita seria peor que responder: el fallo se
 * vuelve silencio hacia el cliente, que es el peor modo de falla del producto.
 */
export function estaAbierto(horario: Horario, timezone: string, ahora: Date): boolean {
  const momento = momentoLocal(timezone, ahora);
  if (!momento) return true;

  const rangos = horario[momento.dia] ?? [];
  for (const rango of rangos) {
    const desde = aMinutos(rango.desde);
    const hasta = aMinutos(rango.hasta);
    if (desde === null || hasta === null) continue;
    if (momento.minutos >= desde && momento.minutos <= hasta) return true;
  }
  return false;
}

/** Todos los días con al menos un rango válido. Para que la UI resuma el estado. */
export function tieneAlgunRango(horario: Horario): boolean {
  return DIAS_SEMANA.some((dia) => normalizarRangos(horario[dia] ?? []).length > 0);
}
