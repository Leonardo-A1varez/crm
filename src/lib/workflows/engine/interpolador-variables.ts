/**
 * Interpolador de variables para el motor de workflows.
 *
 * Reemplaza `{{namespace.campo}}` con el valor correspondiente del contexto.
 * Soporta namespaces anidados hasta 3 niveles: `{{lead.datos_extra.empresa}}`.
 *
 * Namespaces disponibles:
 * - `lead`: datos del lead (`{{lead.nombre}}`, `{{lead.telefono}}`)
 * - `sesion`: sesión actual (`{{sesion.consulta}}`, `{{sesion.current_stage}}`)
 * - `vendedor`: vendedor asignado (`{{vendedor.nombre}}`)
 * - `mensaje`: mensaje que disparó (`{{mensaje.contenido}}`)
 * - `trigger`: datos del trigger (`{{trigger.tipo}}`)
 * - `var`: variables acumuladas (`{{var.resultado_http}}`)
 */

import type { ContextoEjecucion } from "./contexto-ejecucion";

/** Captura `{{namespace.campo.subcampo}}` — hasta 3 niveles. */
const PATRON_VARIABLE = /\{\{([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*){1,2})\}\}/g;

export interface ResultadoInterpolacion {
  /** Texto con las variables reemplazadas. */
  texto: string;
  /** Variables que no se pudieron resolver. */
  noResueltas: string[];
}

/**
 * Resuelve un path como "lead.nombre" o "sesion.extras.promo" desde el contexto.
 *
 * Devuelve `undefined` si el path no existe o algún segmento intermedio es null.
 */
function resolverPath(path: string, ctx: ContextoEjecucion): unknown {
  const partes = path.split(".");
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
      // Namespace desconocido: intentar en variables directamente
      return ctx.variables.get(path);
  }

  if (raiz === undefined || raiz === null) {
    return undefined;
  }

  // Navegar el resto del path
  return resto.reduce<unknown>((obj, key) => {
    if (obj === undefined || obj === null || typeof obj !== "object") {
      return undefined;
    }
    return (obj as Record<string, unknown>)[key];
  }, raiz);
}

/**
 * Convierte un valor a string de forma segura para interpolación.
 *
 * - `null` y `undefined` → cadena vacía
 * - Objetos y arrays → JSON
 * - El resto → String()
 */
function valorAString(valor: unknown): string {
  if (valor === undefined || valor === null) {
    return "";
  }
  if (typeof valor === "object") {
    return JSON.stringify(valor);
  }
  return String(valor);
}

/**
 * Interpola un string reemplazando `{{path}}` con valores del contexto.
 */
export function interpolarTexto(texto: string, ctx: ContextoEjecucion): ResultadoInterpolacion {
  const noResueltas: string[] = [];

  const resultado = texto.replace(PATRON_VARIABLE, (match, path: string) => {
    const valor = resolverPath(path.trim(), ctx);
    if (valor === undefined) {
      noResueltas.push(path);
      return ""; // Reemplazar con vacío en vez de dejar el placeholder
    }
    return valorAString(valor);
  });

  return { texto: resultado, noResueltas };
}

/**
 * Interpola variables en cualquier valor: string, objeto o array.
 *
 * Recorre recursivamente la estructura y aplica `interpolarTexto` a cada string.
 * Devuelve el valor interpolado y acumula los paths no resueltos.
 */
export function interpolarValor(
  valor: unknown,
  ctx: ContextoEjecucion,
): { valor: unknown; noResueltas: string[] } {
  const noResueltas: string[] = [];

  function interpolar(v: unknown): unknown {
    if (typeof v === "string") {
      const { texto, noResueltas: nr } = interpolarTexto(v, ctx);
      noResueltas.push(...nr);
      return texto;
    }

    if (Array.isArray(v)) {
      return v.map((item) => interpolar(item));
    }

    if (v !== null && typeof v === "object") {
      return Object.fromEntries(Object.entries(v).map(([k, val]) => [k, interpolar(val)]));
    }

    return v;
  }

  return { valor: interpolar(valor), noResueltas };
}

/**
 * Versión simple que solo devuelve el texto interpolado.
 * Usa cuando no necesites saber qué variables fallaron.
 */
export function interpolar(texto: string, ctx: ContextoEjecucion): string {
  return interpolarTexto(texto, ctx).texto;
}
