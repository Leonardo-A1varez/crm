import { diaSemanaDePared, horaDePared, zonaValida } from "@/lib/zona-horaria";
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
  return zonaValida(tz);
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

/** Domingo primero, como devuelve `diaSemanaDePared`. */
const DIA_POR_INDICE: readonly DiaSemana[] = ["dom", "lun", "mar", "mie", "jue", "vie", "sab"];

/**
 * Extrae dia de semana y minutos del dia en la timezone dada. La lectura del
 * reloj vive en `lib/zona-horaria.ts`: es la unica implementacion de husos del
 * proyecto, y el recordatorio de seguimiento usa la misma.
 */
function momentoLocal(tz: string, ahora: Date): { dia: DiaSemana; minutos: number } | null {
  const pared = horaDePared(tz, ahora);
  if (pared === null) return null;

  const dia = DIA_POR_INDICE[diaSemanaDePared(pared)];
  if (!dia) return null;

  return { dia, minutos: pared.horas * 60 + pared.minutos };
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

const PASO_MS = 15 * 60_000;
const HORIZONTE_MS = 8 * 24 * 60 * 60_000;

/**
 * El próximo instante en que el negocio está abierto, o `ahora` si ya lo está.
 * `null` si el horario no tiene un solo rango válido — ahí no hay hora hábil a
 * la que diferir y quien llama decide qué hacer.
 *
 * Sondea con `estaAbierto` en vez de calcular el borde del rango a mano. Es
 * más trabajo de CPU (a lo sumo 768 evaluaciones, y sólo cuando hay un mensaje
 * que diferir) a cambio de que las dos funciones no puedan discrepar nunca:
 * un cálculo propio de bordes tendría que reimplementar el manejo de zona
 * horaria y de días sin rangos, y ahí es donde aparecen los desacuerdos.
 */
export function proximaApertura(horario: Horario, timezone: string, ahora: Date): Date | null {
  if (!tieneAlgunRango(horario)) return null;
  for (let t = 0; t <= HORIZONTE_MS; t += PASO_MS) {
    const candidato = new Date(ahora.getTime() + t);
    if (estaAbierto(horario, timezone, candidato)) return candidato;
  }
  return null;
}
