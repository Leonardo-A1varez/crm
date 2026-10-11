"use server";

import { revalidatePath } from "next/cache";
import { DomainError, PermissionDeniedError } from "@/lib/errors";
import { getLogger } from "@/lib/observability/get-logger";
import { ConectarWhatsAppSchema } from "@/lib/validation/ajustes.schema";
import { getCurrentRol } from "@/server/auth/guards";
import { getConectarWhatsAppServiceForRequest } from "@/server/bootstrap/ajustes-bootstrap";

const SOLO_ADMIN = "Solo un administrador puede conectar un número de WhatsApp.";

/**
 * "Conectar WhatsApp": recibe lo que devolvió el popup de Meta (código +
 * cuenta) y conecta el número del lado del servidor.
 *
 * Zod primero (AGENTS.md §0.9). Server Action y no una ruta: Next compara
 * `Origin` con el host en cada Server Action, que es la protección CSRF; una
 * ruta propia habría que cuidarla a mano. El rol se chequea para dar un
 * mensaje claro; la base lo vuelve a exigir en `whatsapp_numero_conectar`.
 *
 * Nunca devuelve ni loguea el código ni el token.
 */
export async function conectarWhatsAppAction(
  raw: unknown,
): Promise<{ ok: true; numero: string } | { ok: false; error: string }> {
  const parsed = ConectarWhatsAppSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  try {
    if ((await getCurrentRol()) !== "admin") throw new PermissionDeniedError(SOLO_ADMIN);
    const servicio = await getConectarWhatsAppServiceForRequest();
    const numero = await servicio.conectar(parsed.data);
    revalidatePath("/ajustes");
    return { ok: true, numero: numero.displayPhoneNumber ?? numero.phoneNumberId };
  } catch (e) {
    if (e instanceof PermissionDeniedError) return { ok: false, error: SOLO_ADMIN };
    getLogger({ scope: "ajustes" }).error("ajustes.conectar_whatsapp.fallo", {
      tipo: e instanceof Error ? e.name : typeof e,
    });
    if (e instanceof DomainError) return { ok: false, error: e.message };
    return { ok: false, error: "No se pudo conectar el número. Probá de nuevo." };
  }
}
