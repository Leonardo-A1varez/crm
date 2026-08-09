"use server";

import { env } from "@/lib/env";
import { makeRateLimiterFromEnv } from "@/lib/rate-limit";
import { PrevisualizarConfigSchema } from "@/lib/validation/agente.schema";
import { rolFromUser } from "@/server/auth/guards";
import { getAuthenticatedUser } from "@/server/auth/supabase-ssr";
import { getAgentePreviewServiceForRequest } from "@/server/bootstrap/agente-bootstrap";
import { toActionError } from "./action-error";

export interface PrevisualizarActionSuccess {
  ok: true;
  respuesta: string;
  respuestaOriginal: string | null;
}
export interface PrevisualizarActionFailure {
  ok: false;
  error: string;
}
export type PrevisualizarActionResult = PrevisualizarActionSuccess | PrevisualizarActionFailure;

// Una sola instancia por proceso (mismo patrón que el rate limiter del
// webhook Meta en `src/app/api/webhooks/meta/route.ts`): 10 previews por
// minuto y por usuario. Sin esto el preview es una vía abierta para quemar
// presupuesto — cada llamada es un request real a OpenAI.
const previewRateLimiter = makeRateLimiterFromEnv({
  url: env.UPSTASH_REDIS_REST_URL,
  token: env.UPSTASH_REDIS_REST_TOKEN,
  limit: 10,
  window: "1 m",
  prefix: "agente-preview",
});

/**
 * Corre el agente con una config candidata SIN GUARDAR contra el historial
 * real de una sesión, y devuelve la respuesta candidata junto a la que el
 * agente dio de verdad en esa sesión (spec §7). No persiste mensajes, no crea
 * `tool_executions`, no llama a Meta — el service (`AgentePreviewService`)
 * nunca toca esos caminos. Sí consume tokens reales y los registra en el
 * `CostTracker` con `workflow: "agente-preview"`.
 */
export async function previsualizarAction(raw: unknown): Promise<PrevisualizarActionResult> {
  const parsed = PrevisualizarConfigSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos invalidos." };
  }

  // Un solo round-trip a Supabase Auth: el mismo user sirve de gate y de actor.
  const user = await getAuthenticatedUser();
  if (rolFromUser(user) !== "admin") {
    return { ok: false, error: "Solo un admin puede previsualizar la configuracion del agente." };
  }

  // rolFromUser(null) nunca es "admin", así que si llegamos acá `user` no es
  // null — pero el tipo sigue siendo `User | null`, de ahí el fallback.
  const userId = user?.id ?? "sin-usuario";
  const limit = await previewRateLimiter.limit(`agente-preview:${userId}`);
  if (!limit.success) {
    return { ok: false, error: "Demasiadas previsualizaciones. Esperá un minuto y reintentá." };
  }

  try {
    const svc = await getAgentePreviewServiceForRequest();
    const resultado = await svc.previsualizar({
      valores: parsed.data.config,
      leadSessionId: parsed.data.leadSessionId,
    });
    return {
      ok: true,
      respuesta: resultado.respuesta,
      respuestaOriginal: resultado.respuestaOriginal,
    };
  } catch (e) {
    return toActionError(e, "previsualizar-config");
  }
}
