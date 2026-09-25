/**
 * Cuándo toca un trigger "Programado": qué franjas de su horario cayeron en
 * una ventana del reloj.
 *
 * El cron `workflow-programados` corre cada pocos minutos y pregunta "¿qué
 * franjas de este flujo cayeron en (desde, hasta]?". Se recorre minuto a
 * minuto en hora local del flujo y se compara contra el horario: así el
 * horario de verano, los días de la semana y los cambios de mes no necesitan
 * aritmética de fechas propia — los resuelve `Intl` con la base de zonas del
 * runtime.
 *
 * Cada franja es la hora local en texto (`2026-09-14T09:00`): es la clave de
 * idempotencia del disparo, y en hora local para que la hora que se repite al
 * atrasar el reloj (dos 01:30 en la misma noche) sea una sola franja.
 */

import type { ConfigDeTipo } from "./config-nodos";

export type ConfigProgramada = ConfigDeTipo<"trigger_cron">;

export type ResultadoFranjas = { franjas: string[] } | { error: string };

interface HoraLocal {
  anio: number;
  mes: number; // 1-12
  dia: number; // 1-31
  hora: number; // 0-23
  minuto: number;
  /** Como en cron: 0 = domingo … 6 = sábado. */
  diaSemana: number;
}

/** Minutos revisados como máximo por llamada: un día. La ventana normal es de minutos. */
const MAX_MINUTOS = 24 * 60;
const MINUTO_MS = 60_000;

const DIAS_EN_INGLES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const FORMATEADORES = new Map<string, Intl.DateTimeFormat>();

function formateador(timezone: string): Intl.DateTimeFormat | null {
  const guardado = FORMATEADORES.get(timezone);
  if (guardado) return guardado;
  try {
    const f = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      weekday: "short",
    });
    FORMATEADORES.set(timezone, f);
    return f;
  } catch {
    return null;
  }
}

function horaLocal(f: Intl.DateTimeFormat, instante: Date): HoraLocal {
  const partes = Object.fromEntries(f.formatToParts(instante).map((p) => [p.type, p.value]));
  return {
    anio: Number(partes["year"]),
    mes: Number(partes["month"]),
    dia: Number(partes["day"]),
    hora: Number(partes["hour"]),
    minuto: Number(partes["minute"]),
    diaSemana: DIAS_EN_INGLES.indexOf(partes["weekday"] ?? ""),
  };
}

const dos = (n: number) => String(n).padStart(2, "0");

function claveDeFranja(l: HoraLocal): string {
  return `${l.anio}-${dos(l.mes)}-${dos(l.dia)}T${dos(l.hora)}:${dos(l.minuto)}`;
}

type Coincide = (l: HoraLocal) => boolean;

function leerHora(hora: string): { hora: number; minuto: number } | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hora.trim());
  return m ? { hora: Number(m[1]), minuto: Number(m[2]) } : null;
}

/** Del índice del panel (0 = lunes) al de cron (0 = domingo). */
function diaDeCron(indicePanel: number): number {
  return (indicePanel + 1) % 7;
}

function reglaDe(config: ConfigProgramada): Coincide | { error: string } {
  if (config.frecuencia === "personalizado") return reglaDeCron(config.cron);
  if (config.frecuencia === "mensual") {
    return {
      error:
        "la frecuencia mensual no deja elegir el día del mes: usá la personalizada con una expresión cron (ej. 0 9 1 * *)",
    };
  }
  const h = leerHora(config.hora);
  if (!h) return { error: `la hora ${JSON.stringify(config.hora)} no es HH:MM` };
  if (config.frecuencia === "cada_hora") return (l) => l.minuto === h.minuto;
  if (config.frecuencia === "diario") return (l) => l.hora === h.hora && l.minuto === h.minuto;
  // semanal
  if (config.dias.length === 0) {
    return { error: "la frecuencia semanal no tiene ningún día elegido" };
  }
  const dias = new Set(config.dias.map(diaDeCron));
  return (l) => dias.has(l.diaSemana) && l.hora === h.hora && l.minuto === h.minuto;
}

// ── Cron de 5 campos: minuto hora día-del-mes mes día-de-la-semana ─────────

const CAMPOS_CRON = [
  { nombre: "minuto", min: 0, max: 59 },
  { nombre: "hora", min: 0, max: 23 },
  { nombre: "día del mes", min: 1, max: 31 },
  { nombre: "mes", min: 1, max: 12 },
  { nombre: "día de la semana", min: 0, max: 7 },
] as const;

interface CampoCron {
  valores: ReadonlySet<number>;
  /** Escrito como `*`: no restringe. Importa para la regla día-del-mes / día-de-la-semana. */
  libre: boolean;
}

function leerCampo(texto: string, min: number, max: number): CampoCron | null {
  const valores = new Set<number>();
  for (const parte of texto.split(",")) {
    const m = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(parte);
    if (!m) return null;
    const paso = m[4] === undefined ? 1 : Number(m[4]);
    const desde = m[1] === "*" ? min : Number(m[2]);
    const hasta = m[1] === "*" ? max : m[3] === undefined ? (m[4] ? max : desde) : Number(m[3]);
    if (paso < 1 || desde < min || hasta > max || desde > hasta) return null;
    for (let v = desde; v <= hasta; v += paso) valores.add(v);
  }
  return { valores, libre: texto === "*" };
}

function reglaDeCron(expresion: string): Coincide | { error: string } {
  const campos = expresion.trim().split(/\s+/);
  const invalida = { error: `la expresión cron ${JSON.stringify(expresion)} no es válida` };
  if (campos.length !== 5) return invalida;
  const leidos: CampoCron[] = [];
  for (const [i, def] of CAMPOS_CRON.entries()) {
    const campo = leerCampo(campos[i]!, def.min, def.max);
    if (!campo) return invalida;
    leidos.push(campo);
  }
  const [minuto, hora, diaMes, mes, diaSemana] = leidos as [
    CampoCron,
    CampoCron,
    CampoCron,
    CampoCron,
    CampoCron,
  ];
  const coincideDiaSemana = (d: number) =>
    diaSemana.valores.has(d) || (d === 0 && diaSemana.valores.has(7));

  return (l) => {
    if (!minuto.valores.has(l.minuto) || !hora.valores.has(l.hora) || !mes.valores.has(l.mes)) {
      return false;
    }
    // La regla de cron: si los dos días están restringidos, alcanza con uno.
    if (!diaMes.libre && !diaSemana.libre) {
      return diaMes.valores.has(l.dia) || coincideDiaSemana(l.diaSemana);
    }
    return diaMes.valores.has(l.dia) && coincideDiaSemana(l.diaSemana);
  };
}

/**
 * Las franjas del horario que cayeron en `(desde, hasta]`, en orden, sin
 * repetir. `{ error }` = la config no describe un horario que se pueda cumplir
 * (timezone inexistente, semanal sin días, mensual sin día, cron inválido): el
 * flujo no corre nunca, y quien llama lo tiene que decir en voz alta.
 */
export function franjasProgramadas(
  config: ConfigProgramada,
  desde: Date,
  hasta: Date,
): ResultadoFranjas {
  const f = formateador(config.timezone);
  if (!f) return { error: `la timezone ${JSON.stringify(config.timezone)} no existe` };
  const regla = reglaDe(config);
  if (typeof regla !== "function") return regla;

  const franjas: string[] = [];
  // El primer minuto entero posterior a `desde`.
  let t = Math.floor(desde.getTime() / MINUTO_MS) * MINUTO_MS + MINUTO_MS;
  const fin = Math.min(hasta.getTime(), t + (MAX_MINUTOS - 1) * MINUTO_MS);
  for (; t <= fin; t += MINUTO_MS) {
    const local = horaLocal(f, new Date(t));
    if (!regla(local)) continue;
    const clave = claveDeFranja(local);
    if (!franjas.includes(clave)) franjas.push(clave);
  }
  return { franjas };
}
