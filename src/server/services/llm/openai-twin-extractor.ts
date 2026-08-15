import { generateObject, type LanguageModel } from "ai";
import type { CostTracker } from "@/lib/observability/cost-tracker";
import { CLAVE_MOTIVO_SUGERIDO } from "@/lib/ui/motivo-perdida";
import { LeadTwinUpdateSchema, type LeadTwinUpdate } from "@/lib/validation/ai";
import type {
  TwinExtractorLLM,
  TwinExtractorLLMInput,
} from "@/server/services/twin-extractor.service";
import { WORKFLOW_LLM } from "@/types/domain";
import { recordLlmUsage } from "./cost-tracker-bridge";
import { NON_STRICT_JSON_SCHEMA } from "./structured-output";

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
  // El auto no vive en la sesión sino en `lead_vehiculos`, y el service lo
  // escribe por otro repo. Se pide acá porque el turno de conversación es el
  // único lugar donde aparece: el cliente dice "para mi aveo" una sola vez.
  // La regla de "solo lo que cambia" no se puede aplicar acá: el auto NO está en
  // el snapshot que recibe el modelo —vive en otra tabla—, así que no tiene con
  // qué comparar y ante la duda lo omite. Repetirlo no cuesta nada: el service
  // solo llena huecos y descarta lo que ya está cargado.
  "vehiculo: {marca, modelo, anio, motor} del auto del que habla el cliente. Este campo es la EXCEPCIÓN a la regla de arriba: incluilo SIEMPRE que la conversación permita identificar el auto, aunque ya se haya mencionado antes. Poné solo lo que el cliente dijo o lo que se deduce sin ninguna duda; omití los campos que no sepas en vez de adivinarlos. Nunca incluyas placa ni VIN: esos los carga una persona.",
  // Sin esto la IA no tiene forma de proponer un motivo sin cerrar la sesión:
  // `motivo_perdida` viaja pegado a `resultado`, y `resultado` cierra. Esta
  // clave es la propuesta que el vendedor confirma en el popover del rail.
  `Si la conversación sugiere que la venta se está perdiendo pero NO hay evidencia para cerrarla, dejá resultado en null y poné extras.${CLAVE_MOTIVO_SUGERIDO} con uno de esos mismos valores: es una propuesta que confirma una persona.`,
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
      providerOptions: NON_STRICT_JSON_SCHEMA,
    });

    await recordLlmUsage(this.cfg.costTracker, result, {
      model: this.cfg.modelName,
      workflow: WORKFLOW_LLM.extractorTwin,
      sessionId: input.current.id,
      ...(input.mensajeOrigenId ? { mensajeId: input.mensajeOrigenId } : {}),
    });

    return result.object;
  }
}
