"use server";

import { revalidatePath } from "next/cache";
import { DomainError, NotFoundError, PermissionDeniedError } from "@/lib/errors";
import { getLogger } from "@/lib/observability/get-logger";
import { AsignarEmpresaErpSchema } from "@/lib/validation/ajustes.schema";
import { getCurrentRol } from "@/server/auth/guards";
import { getAuthenticatedUser } from "@/server/auth/supabase-ssr";
import { getUsuariosAdminServiceForRequest } from "@/server/bootstrap/usuarios-bootstrap";
import type { ActionResult } from "@/types/inbox";

const SOLO_ADMIN = "Solo un administrador puede cambiar la empresa de un usuario.";

/**
 * Le asigna (o le quita, con `empresaErp` vacío) la empresa del ERP a un usuario:
 * la columna de precio que ve resaltada en /productos.
 *
 * Zod primero (AGENTS.md §0.9); el chequeo de rol es para dar un mensaje
 * entendible, la RLS de `usuarios` lo vuelve a exigir en la base. El servicio
 * deja la fila de auditoría.
 */
export async function asignarEmpresaErpAction(raw: unknown): Promise<ActionResult> {
  const parsed = AsignarEmpresaErpSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  try {
    if ((await getCurrentRol()) !== "admin") throw new PermissionDeniedError(SOLO_ADMIN);
    const admin = await getAuthenticatedUser();
    await (
      await getUsuariosAdminServiceForRequest()
    ).asignarEmpresaErp({ ...parsed.data, actorId: admin?.id ?? null });
    revalidatePath("/ajustes");
    revalidatePath("/productos");
    return { ok: true };
  } catch (e) {
    if (e instanceof PermissionDeniedError) return { ok: false, error: SOLO_ADMIN };
    if (e instanceof NotFoundError) {
      return { ok: false, error: "Ese usuario ya no existe. Refrescá la página." };
    }
    if (e instanceof DomainError) return { ok: false, error: e.message };
    getLogger({ scope: "ajustes" }).error("ajustes.empresa_erp.fallo", {
      tipo: e instanceof Error ? e.name : typeof e,
    });
    return { ok: false, error: "No se pudo guardar la empresa. Probá de nuevo." };
  }
}
