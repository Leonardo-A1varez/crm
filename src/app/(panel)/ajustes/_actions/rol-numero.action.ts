"use server";

import { revalidatePath } from "next/cache";
import { DomainError, PermissionDeniedError } from "@/lib/errors";
import { getLogger } from "@/lib/observability/get-logger";
import { GuardarRolNumeroSchema } from "@/lib/validation/ajustes.schema";
import { getCurrentRol } from "@/server/auth/guards";
import { getAuthenticatedUser } from "@/server/auth/supabase-ssr";
import { getRegistrosWhatsAppServiceForRequest } from "@/server/bootstrap/ajustes-bootstrap";
import type { ActionResult } from "@/types/inbox";

const SOLO_ADMIN = "Solo un administrador puede cambiar el rol de un número.";

/**
 * Le pone (o le saca, con `rol` vacío) la etiqueta a un número de WhatsApp.
 * Es sólo informativa: no cambia por qué número sale nada.
 *
 * Zod primero (AGENTS.md §0.9); el chequeo de rol es para dar un mensaje
 * entendible, la RLS de `whatsapp_numeros_rol` lo vuelve a exigir en la base.
 */
export async function guardarRolNumeroAction(raw: unknown): Promise<ActionResult> {
  const parsed = GuardarRolNumeroSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  try {
    if ((await getCurrentRol()) !== "admin") throw new PermissionDeniedError(SOLO_ADMIN);
    const usuario = await getAuthenticatedUser();
    await (
      await getRegistrosWhatsAppServiceForRequest()
    ).guardarRol({ ...parsed.data, actorId: usuario?.id ?? null });
    revalidatePath("/ajustes");
    return { ok: true };
  } catch (e) {
    if (e instanceof PermissionDeniedError) return { ok: false, error: SOLO_ADMIN };
    if (e instanceof DomainError) return { ok: false, error: e.message };
    getLogger({ scope: "ajustes" }).error("ajustes.rol_numero.fallo", {
      tipo: e instanceof Error ? e.name : typeof e,
    });
    return { ok: false, error: "No se pudo guardar el rol. Probá de nuevo." };
  }
}
