"use server";

import { revalidatePath } from "next/cache";
import { DomainError, PermissionDeniedError } from "@/lib/errors";
import {
  ImportarFlujoInputSchema,
  leerFlujoImportado,
} from "@/lib/validation/importar-flujo.schema";
import { getCurrentRol } from "@/server/auth/guards";
import { getAuthenticatedUser } from "@/server/auth/supabase-ssr";
import { getWorkflowsAdminServiceForRequest } from "@/server/bootstrap/workflows-bootstrap";
import { importarFlujo } from "@/server/services/workflows/importar-flujo";
import type { UUID } from "@/types/entities";

/**
 * Importa un flujo desde el JSON pegado o leído de un archivo.
 *
 * Zod dos veces, por capas: el sobre (`ImportarFlujoInputSchema`, primera
 * línea) y el flujo adentro del texto (`leerFlujoImportado`). El sentido del
 * grafo lo revisa `guardarVersion` con `validarGrafo`. Entra como borrador:
 * apagado y sin publicar. Sólo admin.
 */
export async function importarFlujoAction(
  raw: unknown,
): Promise<
  { ok: true; workflowId: UUID; problemasParaPublicar: number } | { ok: false; error: string }
> {
  const parsed = ImportarFlujoInputSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }
  const leido = leerFlujoImportado(parsed.data.texto);
  if (!leido.ok) return leido;

  try {
    if ((await getCurrentRol()) !== "admin") {
      throw new PermissionDeniedError("solo un admin puede importar flujos");
    }
    const svc = await getWorkflowsAdminServiceForRequest();
    const user = await getAuthenticatedUser();
    const r = await importarFlujo(svc, { ...leido.flujo, userId: user?.id ?? null });
    revalidatePath("/workflows");
    return { ok: true, ...r };
  } catch (e) {
    if (e instanceof PermissionDeniedError) {
      return { ok: false, error: "Solo un administrador puede hacer esto." };
    }
    // Los `ValidationError` de `guardarVersion` enumeran los problemas del
    // grafo: es exactamente lo que hay que leer para corregir el archivo.
    if (e instanceof DomainError) return { ok: false, error: e.message };
    return { ok: false, error: "No se pudo importar el flujo." };
  }
}
