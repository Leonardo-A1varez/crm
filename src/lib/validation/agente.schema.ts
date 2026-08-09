import { z } from "zod";
import { esTimezoneValida, normalizarRangos } from "@/lib/agente/horario";
import { OPENAI_PRICING } from "@/lib/agente/modelos";
import { UUIDSchema } from "@/lib/validation/schemas";
import { EMOJIS, LARGO, POLITICA_TOPE, TONO } from "@/types/agente";
import type { Horario } from "@/types/agente";

// Inputs de la pantalla /agente (Task 10). Regla §0.9.3: parse línea 1.
//
// Los rangos acá espejan el CHECK de la migración (spec §3.2): Zod protege la
// entrada de la UI, el CHECK protege el dato de cualquier escritura futura
// por otra vía. `modelo` no lleva CHECK en SQL — la lista vive en
// `OPENAI_PRICING` (TypeScript) y duplicarla en SQL crearía dos fuentes de
// verdad que se desincronizan en cuanto se agregue un modelo nuevo.

const RangoHorarioSchema = z.object({
  desde: z.string(),
  hasta: z.string(),
});

/**
 * Las 7 claves son obligatorias (spec §5.4): un día ausente sería un cierre
 * silencioso, indistinguible de "el admin lo dejó vacío a propósito".
 *
 * El `.transform()` aplica `normalizarRangos` a cada día: fusiona rangos
 * solapados o adyacentes y descarta los inválidos (incluido el caso de
 * cruce de medianoche, ver LIMITACION CONOCIDA en `lib/agente/horario.ts`),
 * para que lo que llega al repo ya esté canónico.
 */
const HorarioSchema = z
  .object({
    lun: z.array(RangoHorarioSchema),
    mar: z.array(RangoHorarioSchema),
    mie: z.array(RangoHorarioSchema),
    jue: z.array(RangoHorarioSchema),
    vie: z.array(RangoHorarioSchema),
    sab: z.array(RangoHorarioSchema),
    dom: z.array(RangoHorarioSchema),
  })
  .transform(
    (horario): Horario => ({
      lun: normalizarRangos(horario.lun),
      mar: normalizarRangos(horario.mar),
      mie: normalizarRangos(horario.mie),
      jue: normalizarRangos(horario.jue),
      vie: normalizarRangos(horario.vie),
      sab: normalizarRangos(horario.sab),
      dom: normalizarRangos(horario.dom),
    }),
  );

/**
 * Igual que `resolveLlmModels` en `server/services/llm/llm-factory.ts`: el
 * mensaje nombra los modelos válidos para que el error sea accionable sin
 * tener que ir a leer `OPENAI_PRICING`.
 */
const ModeloSchema = z.string().superRefine((modelo, ctx) => {
  if (modelo in OPENAI_PRICING) return;
  ctx.addIssue(
    `Modelo OpenAI sin pricing configurado: ${modelo}. Válidos: ` +
      `${Object.keys(OPENAI_PRICING).join(", ")}.`,
  );
});

/** `esTimezoneValida` ya vive en Task 3; acá solo se enchufa con un mensaje. */
const HorarioTimezoneSchema = z.string().superRefine((tz, ctx) => {
  if (esTimezoneValida(tz)) return;
  ctx.addIssue(`Timezone inválida: "${tz}".`);
});

export const GuardarConfigSchema = z.object({
  modelo: ModeloSchema,
  instrucciones: z.string().max(4000),
  tono: z.enum(TONO),
  largo: z.enum(LARGO),
  emojis: z.enum(EMOJIS),
  descuento_max_pct: z.number().min(0).max(20),
  max_pasos_tool: z.number().int().min(1).max(10),
  ventana_contexto_mensajes: z.number().int().min(4).max(40),
  umbral_resumen_turnos: z.number().int().min(10).max(100),
  tope_gasto_diario_usd: z.number().min(0.5).max(1000),
  politica_tope: z.enum(POLITICA_TOPE),
  horario: HorarioSchema,
  horario_timezone: HorarioTimezoneSchema,
  plantilla_fuera_horario: z.string().max(1000),
});
export type GuardarConfigFormInput = z.infer<typeof GuardarConfigSchema>;

export const RollbackConfigSchema = z.object({ configId: UUIDSchema });
export type RollbackConfigFormInput = z.infer<typeof RollbackConfigSchema>;

/**
 * Input de `previsualizarAction` (Task 11). Reusa `GuardarConfigSchema` para
 * la config candidata en vez de duplicar sus 14 campos: una config que no es
 * guardable tampoco es previsualizable, y con schemas distintos esa garantía
 * se pierde en cuanto uno de los dos cambie sin el otro.
 */
export const PrevisualizarConfigSchema = z.object({
  config: GuardarConfigSchema,
  leadSessionId: UUIDSchema,
});
export type PrevisualizarConfigFormInput = z.infer<typeof PrevisualizarConfigSchema>;
