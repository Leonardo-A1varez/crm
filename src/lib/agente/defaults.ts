import { DIAS_SEMANA, type AgenteConfigValores, type Horario } from "@/types/agente";

/** 24/7 abierto: hoy el agente no tiene restricción horaria y la semilla no debe inventarle una. */
function horarioAbiertoSiempre(): Horario {
  const horario = {} as Horario;
  for (const dia of DIAS_SEMANA) horario[dia] = [{ desde: "00:00", hasta: "23:59" }];
  return horario;
}

/**
 * Config de fábrica. Cumple dos roles a la vez, y por eso vive en un solo lugar:
 *
 *   1. Alimenta la fila semilla de la migración.
 *   2. Es el fallback cuando la config no se puede leer en runtime.
 *
 * Dos copias que se desincronizan serían la variante fea del mismo problema:
 * la app arrancaría con un comportamiento y degradaría a otro distinto.
 *
 * Cada valor reproduce una constante que hoy está hardcodeada. Cambiar uno acá
 * cambia el comportamiento del agente — no es un default cosmético.
 */
export const CONFIG_DE_FABRICA: AgenteConfigValores = {
  modelo: "gpt-4o-mini",
  instrucciones: "",
  tono: "cercano",
  largo: "corto",
  emojis: "nunca",
  descuento_max_pct: 0,
  max_pasos_tool: 5,
  ventana_contexto_mensajes: 10,
  umbral_resumen_turnos: 20,
  // El límite de §4.4 que antes no existía. No reproduce una constante previa
  // porque no había ninguna: la tool de catálogo corría sin corte. 3 s es el
  // valor del handoff; subirlo lo vuelve inerte, bajarlo corta búsquedas sanas.
  timeout_tool_ms: 3000,
  tope_gasto_diario_usd: 10,
  politica_tope: "pausar",
  // 2 y no 3: el handoff pide 2 con rango 1–5. El 3 anterior vivía fijo en
  // `handoff.service` y nadie podía cambiarlo.
  escalar_umbral_intents: 2,
  // Las dos condiciones que agregan escalado nuevo arrancan apagadas: encender
  // un escalado que el negocio no eligió le esconde conversaciones al agente.
  escalar_palabras: [],
  escalar_cotizacion_desde: null,
  horario: horarioAbiertoSiempre(),
  // Explícita a propósito: en Vercel el server es UTC, y heredarlo haría que el
  // agente cierre a la hora equivocada, en silencio, para todos.
  horario_timezone: "America/Argentina/Buenos_Aires",
  plantilla_fuera_horario: "",
  plantilla_escalado:
    "Necesito que revisemos tu caso antes de continuar. Dejé la conversación marcada para revisión administrativa y no voy a confirmar precios ni condiciones hasta que sea revisada.",
};
