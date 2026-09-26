import { CAMPOS_TWIN_EDITABLES, type CampoTwinEditable } from "@/types/domain";

/**
 * "Actualizar campo del Twin": qué campos puede escribir un flujo y cómo se lee
 * el valor que escribió quien lo armó.
 *
 * Los campos son los mismos que una persona corrige con el lápiz del Twin
 * (`CAMPOS_TWIN_EDITABLES`): los de texto libre de `lead_session`. La etapa no
 * entra —la mueve «Cambiar etapa», que sólo ofrece las del embudo— y el resto
 * de la sesión (`ia_pausada`, `resultado`…) lo gobiernan reglas que un flujo no
 * puede saltearse.
 *
 * Lo usan la config (que rechaza un número mal escrito antes de publicar) y la
 * acción (que lee el valor ya con las variables resueltas): la regla es una.
 */

export const ETIQUETA_CAMPO_TWIN: Readonly<Record<CampoTwinEditable, string>> = {
  consulta: "Consulta",
  codigo_interno: "Código de producto",
  precio_cotizado: "Precio cotizado",
  cantidad: "Cantidad",
  bloqueador: "Bloqueador",
};

export function esCampoTwinEditable(valor: unknown): valor is CampoTwinEditable {
  return typeof valor === "string" && (CAMPOS_TWIN_EDITABLES as readonly string[]).includes(valor);
}

/**
 * Los numéricos, con la forma que admite su columna: `precio_cotizado` es
 * `numeric(12,2)` y `cantidad` es `integer`.
 */
const NUMERICOS: Readonly<Partial<Record<CampoTwinEditable, "decimal" | "entero">>> = {
  precio_cotizado: "decimal",
  cantidad: "entero",
};

/** Hasta dos decimales, con punto o coma. `1.500` no pasa: no se sabe si es mil quinientos. */
const DECIMAL = /^\d+(?:[.,]\d{1,2})?$/;
const ENTERO = /^\d+$/;
/** Los topes de las columnas: `numeric(12,2)` y un `integer` de Postgres. */
const MAX_DECIMAL = 9_999_999_999.99;
const MAX_ENTERO = 2_147_483_647;

/** Si el texto lleva variables (`{{lead.nombre}}`): su valor recién se sabe al correr. */
export function tieneVariables(texto: string): boolean {
  return /\{\{[^}]+\}\}/.test(texto);
}

export type LecturaCampoTwin =
  | { ok: true; valor: string | number | null }
  | { ok: false; error: string };

/**
 * El valor que se escribe en la columna. Vacío borra el dato: `null`, salvo en
 * `consulta`, que es `not null` y queda en texto vacío.
 */
export function leerValorCampoTwin(campo: CampoTwinEditable, texto: string): LecturaCampoTwin {
  const limpio = texto.trim();
  if (limpio === "") return { ok: true, valor: campo === "consulta" ? "" : null };

  const numerico = NUMERICOS[campo];
  if (numerico === undefined) return { ok: true, valor: limpio };

  if (numerico === "entero") {
    const n = ENTERO.test(limpio) ? Number(limpio) : NaN;
    if (!Number.isSafeInteger(n) || n > MAX_ENTERO) {
      return { ok: false, error: `«${campo}» es un número entero: «${limpio}» no lo es` };
    }
    return { ok: true, valor: n };
  }

  const n = DECIMAL.test(limpio) ? Number(limpio.replace(",", ".")) : NaN;
  if (!Number.isFinite(n) || n > MAX_DECIMAL) {
    return {
      ok: false,
      error: `«${campo}» es un número con hasta dos decimales, sin separador de miles: «${limpio}» no lo es`,
    };
  }
  return { ok: true, valor: n };
}
