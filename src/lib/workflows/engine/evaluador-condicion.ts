/**
 * Evaluador de condiciones para el motor de workflows.
 *
 * Evalúa expresiones de la forma `campo operador valor` contra el contexto.
 * Los campos usan la misma sintaxis que el interpolador: `lead.nombre`,
 * `sesion.current_stage`, `var.resultado`.
 */

import type { ContextoEjecucion } from "./contexto-ejecucion";

/**
 * Operadores soportados por el evaluador.
 *
 * Los nombres están en español porque los configura un usuario de negocio, no
 * un programador. `regex` es la excepción porque "expresión regular" no cabe
 * en un dropdown.
 */
export const OPERADORES_CONDICION = [
  "es",
  "no_es",
  "contiene",
  "no_contiene",
  "mayor_que",
  "menor_que",
  "mayor_igual",
  "menor_igual",
  "existe",
  "no_existe",
  "empieza_con",
  "termina_con",
  "en_lista",
  "no_en_lista",
  "regex",
] as const;

export type OperadorCondicion = (typeof OPERADORES_CONDICION)[number];

/**
 * Una condición a evaluar.
 *
 * `valor` es opcional para operadores unarios como `existe` / `no_existe`.
 */
export interface Condicion {
  campo: string;
  operador: OperadorCondicion;
  valor?: unknown;
}

/**
 * Grupo de condiciones con operador lógico.
 *
 * Para condiciones compuestas: "si A Y B" o "si A O B".
 */
export interface GrupoCondiciones {
  operador: "y" | "o";
  condiciones: Condicion[];
}

/**
 * Resuelve un path desde el contexto de ejecución.
 * Reutiliza la misma lógica que el interpolador.
 */
function resolverCampo(campo: string, ctx: ContextoEjecucion): unknown {
  const partes = campo.split(".");
  const namespace = partes[0];
  const resto = partes.slice(1);

  let raiz: unknown;
  switch (namespace) {
    case "lead":
      raiz = ctx.lead;
      break;
    case "sesion":
      raiz = ctx.sesion;
      break;
    case "vendedor":
      raiz = ctx.vendedor;
      break;
    case "mensaje":
      raiz = ctx.mensaje;
      break;
    case "trigger":
      raiz = ctx.trigger.datos;
      break;
    case "var":
      raiz = Object.fromEntries(ctx.variables);
      break;
    default:
      return ctx.variables.get(campo);
  }

  if (raiz === undefined || raiz === null) {
    return undefined;
  }

  return resto.reduce<unknown>((obj, key) => {
    if (obj === undefined || obj === null || typeof obj !== "object") {
      return undefined;
    }
    return (obj as Record<string, unknown>)[key];
  }, raiz);
}

/**
 * Compara dos valores como números. Devuelve NaN si alguno no es numérico.
 */
function compararNumeros(a: unknown, b: unknown): { aNum: number; bNum: number } {
  const aNum = typeof a === "number" ? a : Number(a);
  const bNum = typeof b === "number" ? b : Number(b);
  return { aNum, bNum };
}

/**
 * Evalúa una condición individual contra el contexto.
 *
 * Un campo ausente (`undefined` o `null`) devuelve `false` para la mayoría de
 * operadores, excepto `no_existe` que devuelve `true`. Esto es intencional:
 * que un dato no exista es información, no un error.
 */
export function evaluarCondicion(condicion: Condicion, ctx: ContextoEjecucion): boolean {
  const valorCampo = resolverCampo(condicion.campo, ctx);
  const valorComparar = condicion.valor;

  switch (condicion.operador) {
    case "es":
      // Comparación estricta excepto null == undefined
      if (valorCampo == null && valorComparar == null) return true;
      return valorCampo === valorComparar;

    case "no_es":
      if (valorCampo == null && valorComparar == null) return false;
      return valorCampo !== valorComparar;

    case "contiene":
      if (valorCampo == null || valorComparar == null) return false;
      return String(valorCampo).toLowerCase().includes(String(valorComparar).toLowerCase());

    case "no_contiene":
      if (valorCampo == null) return true;
      if (valorComparar == null) return false;
      return !String(valorCampo).toLowerCase().includes(String(valorComparar).toLowerCase());

    case "mayor_que": {
      if (valorCampo == null || valorComparar == null) return false;
      const { aNum, bNum } = compararNumeros(valorCampo, valorComparar);
      if (Number.isNaN(aNum) || Number.isNaN(bNum)) return false;
      return aNum > bNum;
    }

    case "menor_que": {
      if (valorCampo == null || valorComparar == null) return false;
      const { aNum, bNum } = compararNumeros(valorCampo, valorComparar);
      if (Number.isNaN(aNum) || Number.isNaN(bNum)) return false;
      return aNum < bNum;
    }

    case "mayor_igual": {
      if (valorCampo == null || valorComparar == null) return false;
      const { aNum, bNum } = compararNumeros(valorCampo, valorComparar);
      if (Number.isNaN(aNum) || Number.isNaN(bNum)) return false;
      return aNum >= bNum;
    }

    case "menor_igual": {
      if (valorCampo == null || valorComparar == null) return false;
      const { aNum, bNum } = compararNumeros(valorCampo, valorComparar);
      if (Number.isNaN(aNum) || Number.isNaN(bNum)) return false;
      return aNum <= bNum;
    }

    case "existe":
      return valorCampo != null && valorCampo !== "";

    case "no_existe":
      return valorCampo == null || valorCampo === "";

    case "empieza_con":
      if (valorCampo == null || valorComparar == null) return false;
      return String(valorCampo).toLowerCase().startsWith(String(valorComparar).toLowerCase());

    case "termina_con":
      if (valorCampo == null || valorComparar == null) return false;
      return String(valorCampo).toLowerCase().endsWith(String(valorComparar).toLowerCase());

    case "en_lista": {
      if (valorCampo == null) return false;
      if (!Array.isArray(valorComparar)) return false;
      return valorComparar.some((item) => {
        if (typeof valorCampo === "string" && typeof item === "string") {
          return valorCampo.toLowerCase() === item.toLowerCase();
        }
        return valorCampo === item;
      });
    }

    case "no_en_lista": {
      if (valorCampo == null) return true;
      if (!Array.isArray(valorComparar)) return true;
      return !valorComparar.some((item) => {
        if (typeof valorCampo === "string" && typeof item === "string") {
          return valorCampo.toLowerCase() === item.toLowerCase();
        }
        return valorCampo === item;
      });
    }

    case "regex": {
      if (valorCampo == null || valorComparar == null) return false;
      try {
        const regex = new RegExp(String(valorComparar), "i");
        return regex.test(String(valorCampo));
      } catch {
        // Regex inválido: no matchea
        return false;
      }
    }

    default:
      return false;
  }
}

/**
 * Evalúa un grupo de condiciones con operador lógico.
 *
 * - `y` (AND): todas deben ser true
 * - `o` (OR): al menos una debe ser true
 */
export function evaluarGrupo(grupo: GrupoCondiciones, ctx: ContextoEjecucion): boolean {
  if (grupo.condiciones.length === 0) {
    // Grupo vacío: asumimos true (no hay restricciones)
    return true;
  }

  if (grupo.operador === "y") {
    return grupo.condiciones.every((c) => evaluarCondicion(c, ctx));
  }

  return grupo.condiciones.some((c) => evaluarCondicion(c, ctx));
}

/**
 * Evalúa condiciones que pueden venir como array o como grupo.
 *
 * Conveniencia para cuando la config tiene `condiciones: [...]` sin operador
 * explícito — asume AND.
 */
export function evaluarCondiciones(
  condiciones: Condicion[] | GrupoCondiciones | undefined,
  ctx: ContextoEjecucion,
): boolean {
  if (!condiciones) return true;

  if (Array.isArray(condiciones)) {
    return evaluarGrupo({ operador: "y", condiciones }, ctx);
  }

  return evaluarGrupo(condiciones, ctx);
}
