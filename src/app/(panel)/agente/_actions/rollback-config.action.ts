"use server";

import { revalidatePath } from "next/cache";
import { RollbackConfigSchema } from "@/lib/validation/agente.schema";
import { rolFromUser } from "@/server/auth/guards";
import { getAuthenticatedUser } from "@/server/auth/supabase-ssr";
import { getAgenteConfigServiceForRequest } from "@/server/bootstrap/agente-bootstrap";
import { toActionError } from "./action-error";
import type { ActionResult } from "@/types/inbox";

export async function rollbackConfigAction(raw: unknown): Promise<ActionResult> {
  const parsed = RollbackConfigSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Datos invalidos. Refrescá la página." };
  }

  // Un solo round-trip a Supabase Auth: el mismo user sirve de gate y de actor.
  const user = await getAuthenticatedUser();
  if (rolFromUser(user) !== "admin") {
    return { ok: false, error: "Solo un admin puede cambiar la configuracion del agente." };
  }

  try {
    const svc = await getAgenteConfigServiceForRequest();
    await svc.rollback({
      configId: parsed.data.configId,
      actorUserId: user?.id ?? null,
    });
  } catch (e) {
    return toActionError(e, "rollback-config");
  }

  revalidatePath("/agente");
  return { ok: true };
}
