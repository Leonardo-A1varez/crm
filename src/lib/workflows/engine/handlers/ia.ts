/**
 * Handlers de nodos de IA.
 *
 * Clasificación, generación de respuestas, extracción de datos, etc.
 * Estos handlers preparan la llamada al modelo y guardan la configuración
 * para que el wiring de Inngest use los servicios reales (OpenAI, etc.).
 */

import type { ContextoEjecucion } from "../contexto-ejecucion";
import { registrarHandler, type ResultadoHandler } from "./registro";

/**
 * Clasificar intent del mensaje.
 */
async function iaClasificar(
  config: Record<string, unknown>,
  ctx: ContextoEjecucion,
): Promise<ResultadoHandler> {
  const texto = (config.texto as string) ?? ctx.mensaje?.contenido ?? "";
  const intentsActivos = config.intents as string[] | undefined;

  if (!texto) {
    return {
      puerto: "salida",
      contexto: {
        intent_clasificado: null,
        intent_confianza: 0,
      },
      salida: {
        tipo: "ia_clasificar",
        resultado: null,
        razon: "sin_texto",
      },
    };
  }

  return {
    puerto: "salida",
    salida: {
      tipo: "ia_clasificar",
      texto_length: texto.length,
      intents_filtro: intentsActivos?.length ?? "todos",
      pendiente_ejecucion: true,
    },
  };
}

/**
 * Generar respuesta IA.
 */
async function iaResponder(
  config: Record<string, unknown>,
  ctx: ContextoEjecucion,
): Promise<ResultadoHandler> {
  const instrucciones = config.instrucciones as string | undefined;
  const contextoConversacion = (config.incluir_contexto as boolean) ?? true;
  const maxTokens = config.max_tokens as number | undefined;
  const temperatura = config.temperatura as number | undefined;

  const mensajeOriginal = ctx.mensaje?.contenido ?? "";

  return {
    puerto: "salida",
    salida: {
      tipo: "ia_responder",
      instrucciones_length: instrucciones?.length ?? 0,
      mensaje_length: mensajeOriginal.length,
      incluir_contexto: contextoConversacion,
      max_tokens: maxTokens ?? 500,
      temperatura: temperatura ?? 0.7,
      lead_id: ctx.lead?.id,
      pendiente_ejecucion: true,
    },
  };
}

/**
 * Extraer datos estructurados.
 */
async function iaExtraer(
  config: Record<string, unknown>,
  ctx: ContextoEjecucion,
): Promise<ResultadoHandler> {
  const campos = config.campos as
    | Array<{ nombre: string; tipo: string; descripcion?: string }>
    | undefined;
  const texto = (config.texto as string) ?? ctx.mensaje?.contenido ?? "";

  if (!campos || campos.length === 0) {
    throw new Error("El nodo ia_extraer requiere definir los campos a extraer");
  }

  return {
    puerto: "salida",
    salida: {
      tipo: "ia_extraer",
      campos: campos.map((c) => c.nombre),
      texto_length: texto.length,
      pendiente_ejecucion: true,
    },
  };
}

/**
 * Analizar sentimiento.
 */
async function iaSentimiento(
  config: Record<string, unknown>,
  ctx: ContextoEjecucion,
): Promise<ResultadoHandler> {
  const texto = (config.texto as string) ?? ctx.mensaje?.contenido ?? "";
  const detalles = (config.detalles as boolean) ?? false;

  if (!texto) {
    return {
      puerto: "salida",
      contexto: {
        sentimiento: "neutral",
        sentimiento_score: 0.5,
      },
      salida: {
        tipo: "ia_sentimiento",
        resultado: "neutral",
        razon: "sin_texto",
      },
    };
  }

  return {
    puerto: "salida",
    salida: {
      tipo: "ia_sentimiento",
      texto_length: texto.length,
      detalles,
      pendiente_ejecucion: true,
    },
  };
}

/**
 * Resumir conversación.
 */
async function iaResumir(
  config: Record<string, unknown>,
  ctx: ContextoEjecucion,
): Promise<ResultadoHandler> {
  const maxMensajes = config.max_mensajes as number | undefined;
  const maxPalabras = config.max_palabras as number | undefined;

  return {
    puerto: "salida",
    salida: {
      tipo: "ia_resumir",
      session_id: ctx.sesion?.id,
      max_mensajes: maxMensajes ?? 50,
      max_palabras: maxPalabras ?? 200,
      pendiente_ejecucion: true,
    },
  };
}

/**
 * Traducir mensaje.
 */
async function iaTraducir(
  config: Record<string, unknown>,
  ctx: ContextoEjecucion,
): Promise<ResultadoHandler> {
  const texto = (config.texto as string) ?? ctx.mensaje?.contenido ?? "";
  const idiomaDestino = (config.idioma_destino as string) ?? "es";
  const idiomaOrigen = config.idioma_origen as string | undefined;

  if (!texto) {
    return {
      puerto: "salida",
      contexto: {
        traduccion: "",
      },
      salida: {
        tipo: "ia_traducir",
        resultado: "",
        razon: "sin_texto",
      },
    };
  }

  return {
    puerto: "salida",
    salida: {
      tipo: "ia_traducir",
      texto_length: texto.length,
      idioma_destino: idiomaDestino,
      idioma_origen: idiomaOrigen ?? "auto",
      pendiente_ejecucion: true,
    },
  };
}

/**
 * Verificar si es spam.
 */
async function iaSpam(
  config: Record<string, unknown>,
  ctx: ContextoEjecucion,
): Promise<ResultadoHandler> {
  const texto = (config.texto as string) ?? ctx.mensaje?.contenido ?? "";
  const umbral = config.umbral as number | undefined;

  if (!texto) {
    return {
      puerto: "salida",
      contexto: {
        es_spam: false,
        spam_score: 0,
      },
      salida: {
        tipo: "ia_spam",
        resultado: false,
        razon: "sin_texto",
      },
    };
  }

  return {
    puerto: "salida",
    salida: {
      tipo: "ia_spam",
      texto_length: texto.length,
      umbral: umbral ?? 0.8,
      pendiente_ejecucion: true,
    },
  };
}

// Registrar todos los handlers de IA
export function registrarHandlersIa(): void {
  registrarHandler("ia_clasificar", iaClasificar);
  registrarHandler("ia_responder", iaResponder);
  registrarHandler("ia_extraer", iaExtraer);
  registrarHandler("ia_sentimiento", iaSentimiento);
  registrarHandler("ia_resumir", iaResumir);
  registrarHandler("ia_traducir", iaTraducir);
  registrarHandler("ia_spam", iaSpam);
}
