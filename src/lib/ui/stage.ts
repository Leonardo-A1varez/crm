import { ETAPAS_EMBUDO } from "@/types/domain";
import type { CurrentStage, EtapaEmbudo } from "@/types/domain";

/**
 * El embudo son estas 6 etapas y nada más. `perdido` y `requiere_humano` NO
 * son los pasos 7 y 8: son desvíos: la conversación se sale del embudo y el
 * progreso se congela en la última etapa alcanzada. Modelarlos como índices
 * consecutivos propaga el error a la barra de progreso del Twin y al embudo
 * de Métricas.
 *
 * La lista vive en `types/domain` porque `LeadSession.etapa_alcanzada` la
 * necesita para tiparse; acá se re-exporta con el nombre con el que la conoce
 * toda la UI.
 */
export const FUNNEL_STAGES = ETAPAS_EMBUDO;

export const FUNNEL_LENGTH = FUNNEL_STAGES.length;

const COLOR: Record<CurrentStage, string> = {
  nuevo: "var(--stage-nuevo)",
  identificando: "var(--stage-identificando)",
  cotizado: "var(--stage-cotizado)",
  negociando: "var(--stage-negociando)",
  esperando_pago: "var(--stage-esperando-pago)",
  cerrado: "var(--stage-cerrado)",
  perdido: "var(--stage-perdido)",
  requiere_humano: "var(--stage-requiere-humano)",
};

const LABEL: Record<CurrentStage, string> = {
  nuevo: "Nuevo",
  identificando: "Identificando",
  cotizado: "Cotizado",
  negociando: "Negociando",
  esperando_pago: "Esperando pago",
  cerrado: "Cerrado",
  perdido: "Perdido",
  requiere_humano: "Requiere humano",
};

export function stageColor(stage: CurrentStage): string {
  return COLOR[stage];
}

export function stageLabel(stage: CurrentStage): string {
  return LABEL[stage];
}

/**
 * Fondo del badge de etapa: 13% del color de la etapa (el alpha 0x21 del
 * handoff). `color-mix` y no concatenación de hex + alpha porque `COLOR[stage]`
 * es un `var(--stage-...)`: pegarle un sufijo de hex produciría el string
 * literal `var(--stage-nuevo)21`, que el navegador no puede interpretar.
 */
export function stageBadgeBackground(stage: CurrentStage): string {
  return `color-mix(in srgb, ${COLOR[stage]} 13%, transparent)`;
}

export function isDetour(stage: CurrentStage): boolean {
  return !(FUNNEL_STAGES as readonly string[]).includes(stage);
}

/**
 * Guarda de tipo para estrechar una etapa cualquiera a una del embudo.
 *
 * La necesita el mapper del repo: la columna `etapa_alcanzada` es del enum
 * completo en Postgres (no hay un enum de 6) y lo que la limita a las 6 es un
 * CHECK, que el tipo generado no puede ver. Estrechar acá deja el tipo del
 * dominio angosto en vez de ensancharlo para que entre lo que la DB ya rechaza.
 */
export function esEtapaEmbudo(stage: CurrentStage): stage is EtapaEmbudo {
  return !isDetour(stage);
}

/** Posición 1..6 dentro del embudo. `null` en desvíos: no tienen posición. */
export function funnelStep(stage: CurrentStage): number | null {
  const index = (FUNNEL_STAGES as readonly string[]).indexOf(stage);
  return index === -1 ? null : index + 1;
}

/**
 * Hasta dónde llegó la sesión en el embudo después de moverse a `nueva`.
 *
 * Un desvío no avanza nada: es la razón de ser del campo. Y el máximo nunca
 * retrocede — que el extractor devuelva `identificando` sobre una sesión que ya
 * cotizó no borra que cotizó, y el rail del Twin no puede desandar.
 */
export function etapaAlcanzada(previa: EtapaEmbudo, nueva: CurrentStage): EtapaEmbudo {
  const pasoNuevo = funnelStep(nueva);
  if (pasoNuevo === null) return previa;
  const pasoPrevio = funnelStep(previa) ?? 0;
  return pasoNuevo > pasoPrevio ? (nueva as EtapaEmbudo) : previa;
}
