"use server";

import { revalidatePath } from "next/cache";
import { CambiarModoRespuestaSchema } from "@/lib/validation/copiloto.schema";
import { getCopilotoServiceForRequest } from "@/server/bootstrap/copiloto-bootstrap";
import { toActionError } from "./action-error";
import type { ActionResult } from "@/types/inbox";

/**
 * El interruptor de 3 estados del encabezado. `segun_horario` vuelve el
 * override a `null`. No toca borradores ya generados: el modo se decide al
 * llegar cada mensaje.
 */
export async function cambiarModoRespuestaAction(raw: unknown): Promise<ActionResult> {
  const parsed = CambiarModoRespuestaSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Modo inválido: refrescá la página." };

  try {
    const svc = await getCopilotoServiceForRequest();
    await svc.cambiarModo({
      conversacionId: parsed.data.conversacionId,
      override: parsed.data.modo === "segun_horario" ? null : parsed.data.modo,
    });
  } catch (e) {
    return toActionError(e, "cambiar-modo-respuesta");
  }

  revalidatePath(`/inbox/${parsed.data.leadId}`);
  return { ok: true };
}
