import type { HandoffEvent } from "@/types/entities";

const LABEL: Record<HandoffEvent["reason_code"], string> = {
  unknown_intents: "intents desconocidos",
  sensitive_keyword: "palabra sensible",
  quote_limit: "límite de cotización",
  discount_limit: "límite de descuento",
  rule_handoff: "regla de revisión",
  manual_pause: "pausa manual",
  manual_resume: "reanudación manual",
  other: "otro motivo",
};

export function motivoHandoffLabel(reason: HandoffEvent["reason_code"]): string {
  return LABEL[reason];
}
