"use server";

import { revalidatePath } from "next/cache";
import { GuardarConfigSchema } from "@/lib/validation/agente.schema";
import { rolFromUser } from "@/server/auth/guards";
import { getAuthenticatedUser } from "@/server/auth/supabase-ssr";
import { getAgenteConfigServiceForRequest } from "@/server/bootstrap/agente-bootstrap";
import { toActionError } from "./action-error";
import type { ActionResult } from "@/types/inbox";

export async function guardarConfigAction(raw: unknown): Promise<ActionResult> {
  const parsed = GuardarConfigSchema.safeParse(raw);
  if (!parsed.success) {
    // El mensaje del schema es util: nombra el modelo invalido o el rango
    // excedido. Tragarlo obligaria al usuario a adivinar que campo esta mal.
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos invalidos." };
  }

  // Un solo round-trip a Supabase Auth: el mismo user sirve de gate y de actor.
  const user = await getAuthenticatedUser();
  if (rolFromUser(user) !== "admin") {
    return { ok: false, error: "Solo un admin puede cambiar la configuracion del agente." };
  }

  try {
    const svc = await getAgenteConfigServiceForRequest();
    // `GuardarConfigSchema` es plano (los 15 campos de `AgenteConfigValores`
    // directamente, sin wrapper `valores` ni campo `nota` — ese `nota` lo
    // genera el propio service solo para rollback). `parsed.data` YA es la
    // forma que pide `guardarYActivar`.
    await svc.guardarYActivar({
      valores: parsed.data,
      actorUserId: user?.id ?? null,
    });
  } catch (e) {
    return toActionError(e, "guardar-config");
  }

  revalidatePath("/agente");
  return { ok: true };
}
