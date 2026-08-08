import type { CurrentStage } from "@/types/domain";

/**
 * El embudo son estas 6 etapas y nada más. `perdido` y `requiere_humano` NO
 * son los pasos 7 y 8: son desvíos: la conversación se sale del embudo y el
 * progreso se congela en la última etapa alcanzada. Modelarlos como índices
 * consecutivos propaga el error a la barra de progreso del Twin y al embudo
 * de Métricas.
 */
export const FUNNEL_STAGES = [
  "nuevo",
  "identificando",
  "cotizado",
  "negociando",
  "esperando_pago",
  "cerrado",
] as const satisfies readonly CurrentStage[];

export const FUNNEL_LENGTH = FUNNEL_STAGES.length;

const COLOR: Record<CurrentStage, string> = {
  nuevo: "#38BDF8",
  identificando: "#818CF8",
  cotizado: "#A78BFA",
  negociando: "#FBBF24",
  esperando_pago: "#FB923C",
  cerrado: "#34D399",
  perdido: "#F87171",
  requiere_humano: "#E879F9",
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

/** Alpha 13% del handoff = 0x21 sobre 0xFF. */
const BADGE_ALPHA = "21";

export function stageColor(stage: CurrentStage): string {
  return COLOR[stage];
}

export function stageLabel(stage: CurrentStage): string {
  return LABEL[stage];
}

export function stageBadgeBackground(stage: CurrentStage): string {
  return `${COLOR[stage]}${BADGE_ALPHA}`;
}

export function isDetour(stage: CurrentStage): boolean {
  return !(FUNNEL_STAGES as readonly string[]).includes(stage);
}

/** Posición 1..6 dentro del embudo. `null` en desvíos: no tienen posición. */
export function funnelStep(stage: CurrentStage): number | null {
  const index = (FUNNEL_STAGES as readonly string[]).indexOf(stage);
  return index === -1 ? null : index + 1;
}
