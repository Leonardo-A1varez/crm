import { generateObject, type LanguageModel } from "ai";
import type { CostTracker } from "@/lib/observability/cost-tracker";
import { LeadTwinUpdateSchema, type LeadTwinUpdate } from "@/lib/validation/ai";
import type {
  TwinExtractorLLM,
  TwinExtractorLLMInput,
} from "@/server/services/twin-extractor.service";
import { recordLlmUsage } from "./cost-tracker-bridge";

export interface OpenAiTwinExtractorConfig {
  model: LanguageModel;
  modelName: string;
  costTracker: CostTracker;
}

const SYSTEM_PROMPT = [
  "Sos un extractor de información estructurada (Lead Twin) para un CRM de venta de repuestos automotrices.",
  "Recibís el estado actual de la sesión + el último turno de conversación.",
  "Devolvés SOLO los campos que cambian o tienen información nueva (omití campos sin cambio).",
  "current_stage: nuevo|identificando|cotizado|negociando|esperando_pago|cerrado|perdido|requiere_humano.",
  "urgencia: baja|media|alta. metodo_pago: transferencia|efectivo|tarjeta o null.",
  "resultado: exito|perdido o null (no cierres salvo evidencia clara).",
  "motivo_perdida (solo si resultado=perdido): precio|stock|tiempo|no_responde|otro.",
  "extras: jsonb con campos custom shallow-merged en service (preserva keys previas).",
].join(" ");

/**
 * OpenAI impl `TwinExtractorLLM`. Slice 1 sub-paso 7.5.
 *
 * Usa `generateObject` + `LeadTwinUpdateSchema` (parcial — todos los campos
 * opcionales). Service consumidor (`DefaultTwinExtractorService`)
 * shallow-mergea extras + dispara close si `resultado !== null`.
 */
export class OpenAiTwinExtractorLLM implements TwinExtractorLLM {
  constructor(private readonly cfg: OpenAiTwinExtractorConfig) {}

  async extract(input: TwinExtractorLLMInput): Promise<LeadTwinUpdate> {
    const sessionSnapshot = JSON.stringify(
      {
        current_stage: input.current.current_stage,
        urgencia: input.current.urgencia,
        consulta: input.current.consulta,
        codigo_interno: input.current.codigo_interno,
        precio_cotizado: input.current.precio_cotizado,
        cantidad: input.current.cantidad,
        bloqueador: input.current.bloqueador,
        comprobante_pago_url: input.current.comprobante_pago_url,
        metodo_pago: input.current.metodo_pago,
        resultado: input.current.resultado,
        motivo_perdida: input.current.motivo_perdida,
        extras: input.current.extras,
      },
      null,
      2,
    );

    const conversationText = input.conversationTurn
      .map((line, i) => `[${i + 1}] ${line}`)
      .join("\n");

    const result = await generateObject({
      model: this.cfg.model,
      schema: LeadTwinUpdateSchema,
      system: SYSTEM_PROMPT,
      prompt: [
        "Estado actual de la sesión (Lead Twin actual):",
        sessionSnapshot,
        "",
        "Último turno de conversación:",
        conversationText,
        "",
        "Devolvé el patch (solo campos a cambiar).",
      ].join("\n"),
    });

    await recordLlmUsage(this.cfg.costTracker, result, {
      model: this.cfg.modelName,
      workflow: "twin-extractor",
      sessionId: input.current.id,
    });

    return result.object;
  }
}
