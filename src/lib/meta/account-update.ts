import { z } from "zod";

/**
 * El webhook `account_update` de WhatsApp, leído para la escalera de sanciones.
 *
 * Fuente: la referencia de Meta del campo
 * (developers.facebook.com/docs/whatsapp/cloud-api/webhooks/reference/account_update),
 * leída el 2026-09-25. El `value` trae un `event` y, según el evento,
 * `violation_info.violation_type`, `restriction_info[]` (`restriction_type`,
 * `expiration` en segundos Unix, `remediation`) o `ban_info`
 * (`waba_ban_state` = DISABLE | REINSTATE | SCHEDULE_FOR_DISABLE y
 * `waba_ban_date` como texto, "April 17, 2025"). El `entry.id` es la WABA:
 * ningún evento nombra un número, así que las sanciones son de la cuenta.
 *
 * El crudo se guarda entero en `meta_operational_events.payload`; esto es sólo
 * la lectura. Una forma que no cumpla el contrato queda `ilegible` y NO se
 * adivina: a veces Meta cambia un payload sin avisar.
 */

const ValueSchema = z.object({
  event: z.string().min(1),
  violation_info: z.object({ violation_type: z.string().min(1).optional() }).optional(),
  restriction_info: z
    .array(
      z.object({
        restriction_type: z.string().min(1),
        expiration: z.number().int().positive().optional(),
        remediation: z.string().optional(),
      }),
    )
    .optional(),
  ban_info: z
    .object({
      waba_ban_state: z.string().min(1),
      waba_ban_date: z.string().optional(),
    })
    .optional(),
});

export interface Restriccion {
  /** `restriction_type` crudo. */
  tipo: string;
  /** `expiration`. `null` si Meta no lo mandó. */
  vence: Date | null;
  remediacion: string | null;
}

export type EventoDeCuenta =
  | { tipo: "infraccion"; violacion: string | null }
  | { tipo: "restriccion"; restricciones: Restriccion[] }
  | { tipo: "baja"; estado: string; fecha: string | null }
  | { tipo: "desconexion"; evento: string }
  | { tipo: "otro"; evento: string }
  | { tipo: "ilegible"; evento: string | null };

const DESCONEXIONES = new Set(["ACCOUNT_OFFBOARDED", "ACCOUNT_RECONNECTED", "ACCOUNT_DELETED"]);

export function interpretarAccountUpdate(value: Record<string, unknown>): EventoDeCuenta {
  const parsed = ValueSchema.safeParse(value);
  if (!parsed.success) {
    const evento = typeof value["event"] === "string" ? value["event"] : null;
    return { tipo: "ilegible", evento };
  }
  const v = parsed.data;
  switch (v.event) {
    case "ACCOUNT_VIOLATION":
      return { tipo: "infraccion", violacion: v.violation_info?.violation_type ?? null };
    case "ACCOUNT_RESTRICTION":
      if (v.restriction_info === undefined) return { tipo: "ilegible", evento: v.event };
      return {
        tipo: "restriccion",
        restricciones: v.restriction_info.map((r) => ({
          tipo: r.restriction_type,
          vence: r.expiration === undefined ? null : new Date(r.expiration * 1000),
          remediacion: r.remediation ?? null,
        })),
      };
    case "DISABLED_UPDATE":
      if (v.ban_info === undefined) return { tipo: "ilegible", evento: v.event };
      return {
        tipo: "baja",
        estado: v.ban_info.waba_ban_state,
        fecha: v.ban_info.waba_ban_date ?? null,
      };
    default:
      return DESCONEXIONES.has(v.event)
        ? { tipo: "desconexion", evento: v.event }
        : { tipo: "otro", evento: v.event };
  }
}

export interface RegistroDeCuenta {
  evento: EventoDeCuenta;
  /** Cuándo lo disparó Meta (`entry.time`), o cuándo llegó si no lo dijo. */
  at: Date;
}

/**
 * Índices de `ESCALERA_DE_SANCIONES` (`ajustes/_lib/politica-meta.ts`), que
 * sigue el orden de la página de policy enforcement de Meta.
 */
export const ESCALON = {
  advertencia: 0,
  bloqueoPlantillas: 1,
  bloqueoMensajes: 2,
  deshabilitada: 4,
} as const;

/**
 * La página de policy enforcement describe dos bloqueos —"1 or 3 day block on
 * sending marketing, utility, and authentication template messages" y "5, 7,
 * or 30 day block on sending any messages and adding additional phone
 * numbers"— pero NO dice qué `restriction_type` manda Meta en cada uno
 * (verificado el 2026-09-25). Esta correspondencia es una inferencia por lo que
 * bloquea cada tipo, y por eso la posición que sale de acá lleva `inferido`:
 *
 *   - Bloquear lo iniciado por el cliente o sumar números sólo aparece en el
 *     bloqueo de mensajes.
 *   - Bloquear lo iniciado por el negocio (las plantillas) sin lo anterior es
 *     el bloqueo de plantillas.
 *
 * Las restricciones de llamadas no están en la escalera de mensajería.
 */
const BLOQUEAN_MENSAJES = new Set([
  "RESTRICTED_CUSTOMER_INITIATED_MESSAGING",
  "RESTRICTED_ADD_PHONE_NUMBER_ACTION",
]);
const BLOQUEAN_PLANTILLAS = new Set([
  "RESTRICTED_BIZ_INITIATED_MESSAGING",
  "RESTRICTED_UTILITY_TEMPLATES",
  "RESTRICTED_DIRECT_SEND_UTILITY_TEMPLATES",
]);

export type PosicionLeida =
  | { tipo: "sin-registros" }
  | { tipo: "sin-sancion"; observadoDesde: Date }
  | { tipo: "en-escalon"; indice: number; desde: Date; inferido: string | null };

function inferencia(tipos: readonly string[]): string {
  return `Meta no documenta qué escalón corresponde a cada restricción: se infiere de lo que bloquea (${tipos.join(", ")}).`;
}

/**
 * Dónde está parada la cuenta, de lo más grave a lo menos:
 *
 *   1. Deshabilitada si el último DISABLED_UPDATE con DISABLE o REINSTATE es
 *      DISABLE. SCHEDULE_FOR_DISABLE es un aviso y no mueve la posición.
 *   2. Un bloqueo, si la ÚLTIMA restricción que mandó Meta sigue vigente.
 *      Sin `expiration` se toma como vigente: es lo que Meta dijo por última vez.
 *   3. La advertencia, si hubo alguna infracción. Meta no documenta que una
 *      infracción caduque, así que no se hace caducar.
 *   4. Sin sanción, desde el primer account_update recibido: que haya llegado
 *      uno prueba que el campo está suscrito desde ahí. Antes, no se sabe.
 */
export function posicionEnLaEscalera(
  registros: readonly RegistroDeCuenta[],
  ahora: Date,
): PosicionLeida {
  if (registros.length === 0) return { tipo: "sin-registros" };
  const orden = [...registros].sort((a, b) => a.at.getTime() - b.at.getTime());

  const ultimaBaja = orden
    .filter(
      (r): r is RegistroDeCuenta & { evento: { tipo: "baja" } } =>
        r.evento.tipo === "baja" &&
        (r.evento.estado === "DISABLE" || r.evento.estado === "REINSTATE"),
    )
    .at(-1);
  if (ultimaBaja?.evento.estado === "DISABLE") {
    return {
      tipo: "en-escalon",
      indice: ESCALON.deshabilitada,
      desde: ultimaBaja.at,
      inferido: null,
    };
  }

  const ultimaRestriccion = orden
    .filter(
      (r): r is RegistroDeCuenta & { evento: { tipo: "restriccion" } } =>
        r.evento.tipo === "restriccion",
    )
    .at(-1);
  if (ultimaRestriccion) {
    const vigentes = ultimaRestriccion.evento.restricciones
      .filter((x) => x.vence === null || x.vence.getTime() > ahora.getTime())
      .map((x) => x.tipo);
    const mensajes = vigentes.filter((t) => BLOQUEAN_MENSAJES.has(t));
    const plantillas = vigentes.filter((t) => BLOQUEAN_PLANTILLAS.has(t));
    if (mensajes.length > 0) {
      return {
        tipo: "en-escalon",
        indice: ESCALON.bloqueoMensajes,
        desde: ultimaRestriccion.at,
        inferido: inferencia(vigentes),
      };
    }
    if (plantillas.length > 0) {
      return {
        tipo: "en-escalon",
        indice: ESCALON.bloqueoPlantillas,
        desde: ultimaRestriccion.at,
        inferido: inferencia(vigentes),
      };
    }
  }

  const ultimaInfraccion = orden.filter((r) => r.evento.tipo === "infraccion").at(-1);
  if (ultimaInfraccion) {
    return {
      tipo: "en-escalon",
      indice: ESCALON.advertencia,
      desde: ultimaInfraccion.at,
      inferido: null,
    };
  }

  // `orden` no está vacío: se chequeó arriba.
  return { tipo: "sin-sancion", observadoDesde: orden[0]!.at };
}

export interface EntradaDeHistorial {
  at: Date;
  /** El `event` crudo de Meta. */
  evento: string;
  titulo: string;
  /** Lo que Meta dijo, con sus valores crudos. `null` si no dijo nada más. */
  detalle: string | null;
}

/** Traducción literal de `restriction_type`; el valor crudo va siempre al lado. */
const RESTRICCION_LEGIBLE: Readonly<Record<string, string>> = {
  RESTRICTED_BIZ_INITIATED_MESSAGING: "mensajes iniciados por el negocio",
  RESTRICTED_CUSTOMER_INITIATED_MESSAGING: "respuestas a mensajes del cliente",
  RESTRICTED_ADD_PHONE_NUMBER_ACTION: "sumar números",
  RESTRICTED_UTILITY_TEMPLATES: "plantillas utility",
  RESTRICTED_DIRECT_SEND_UTILITY_TEMPLATES: "envío directo de plantillas utility",
  RESTRICTED_BUSINESS_INITIATED_CALLING: "llamadas iniciadas por el negocio",
  RESTRICTED_USER_INITIATED_CALLING: "llamadas del cliente",
  RESTRICTED_USER_INITIATED_CALLING_CALL_BUTTON_HIDDEN: "llamadas del cliente (botón oculto)",
  RESTRICTED_BIZ_INITIATED_AND_USER_INITIATED_CALLING: "todas las llamadas",
};

function restriccionLegible(r: Restriccion, formatear: (d: Date) => string): string {
  const nombre = RESTRICCION_LEGIBLE[r.tipo];
  const base = nombre ? `${nombre} (${r.tipo})` : r.tipo;
  return r.vence === null
    ? `${base}, sin vencimiento informado`
    : `${base}, vence ${formatear(r.vence)}`;
}

const BAJA_LEGIBLE: Readonly<Record<string, string>> = {
  DISABLE: "Meta deshabilitó la cuenta",
  REINSTATE: "Meta rehabilitó la cuenta",
  SCHEDULE_FOR_DISABLE: "Meta programó la deshabilitación de la cuenta",
};

const DESCONEXION_LEGIBLE: Readonly<Record<string, string>> = {
  ACCOUNT_OFFBOARDED:
    "La cuenta quedó desconectada (cambio de dispositivo o re-registro del número)",
  ACCOUNT_RECONNECTED: "La cuenta se volvió a conectar",
  ACCOUNT_DELETED: "La cuenta fue eliminada",
};

/**
 * Lo que pasó con la cuenta según Meta, lo más reciente primero. Quedan afuera
 * los account_update que no son de política (partners, país, precios): no
 * cuentan para la escalera y enterrarían lo que sí.
 */
export function historialDeSanciones(
  registros: readonly RegistroDeCuenta[],
  formatear: (d: Date) => string = (d) => d.toISOString(),
): EntradaDeHistorial[] {
  const salida: EntradaDeHistorial[] = [];
  for (const { evento, at } of registros) {
    switch (evento.tipo) {
      case "infraccion":
        salida.push({
          at,
          evento: "ACCOUNT_VIOLATION",
          titulo: "Meta registró una infracción a sus políticas",
          detalle: evento.violacion === null ? null : `Tipo que informa Meta: ${evento.violacion}.`,
        });
        break;
      case "restriccion":
        salida.push({
          at,
          evento: "ACCOUNT_RESTRICTION",
          titulo: "Meta restringió la cuenta",
          detalle:
            evento.restricciones.length === 0
              ? "Meta no listó ninguna restricción."
              : `${evento.restricciones.map((r) => restriccionLegible(r, formatear)).join("; ")}.`,
        });
        break;
      case "baja":
        salida.push({
          at,
          evento: "DISABLED_UPDATE",
          titulo: BAJA_LEGIBLE[evento.estado] ?? `Meta informó ${evento.estado}`,
          detalle: evento.fecha === null ? null : `Fecha que informa Meta: ${evento.fecha}.`,
        });
        break;
      case "desconexion":
        salida.push({
          at,
          evento: evento.evento,
          titulo: DESCONEXION_LEGIBLE[evento.evento] ?? evento.evento,
          detalle: null,
        });
        break;
      case "ilegible":
        salida.push({
          at,
          evento: evento.evento ?? "sin event",
          titulo: "Llegó un account_update que no se pudo leer",
          detalle:
            "La forma no coincide con la documentada. El payload crudo está en meta_operational_events.",
        });
        break;
      case "otro":
        break;
    }
  }
  return salida.sort((a, b) => b.at.getTime() - a.at.getTime());
}
