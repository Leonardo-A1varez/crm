import type { HandoffEvent } from "@/types/entities";

const LABEL: Record<HandoffEvent["reason_code"], string> = {
  unknown_intents: "intents desconocidos",
  sensitive_keyword: "palabra sensible",
  quote_limit: "límite de cotización",
  discount_limit: "límite de descuento",
  rule_handoff: "regla de revisión",
  manual_pause: "pausa manual",
  manual_resume: "reanudación manual",
  respuesta_desde_telefono: "respondió el equipo desde el teléfono",
  reanudacion_automatica: "reanudación automática",
  other: "otro motivo",
};

export function motivoHandoffLabel(reason: HandoffEvent["reason_code"]): string {
  return LABEL[reason];
}
