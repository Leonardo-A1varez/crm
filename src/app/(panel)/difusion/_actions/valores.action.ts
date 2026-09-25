"use server";

import { ValoresVariablesSchema } from "@/lib/validation/difusion-acciones.schema";
import { getDifusionServiceForRequest } from "@/server/bootstrap/difusion-bootstrap";
import { errorDeAccion, type ResultadoAccion } from "./action-error";
import { exigirAdmin } from "./permisos";
import type { ValoresDeLead } from "@/server/services/difusion/difusion.service";

/**
 * Lo que tiene cada lead de la muestra para las variables de la plantilla: los
 * mismos datos con que el motor las resuelve al mandar. Es de admin porque es
 * parte de armar una difusión.
 */
export async function valoresVariablesAction(
  raw: unknown,
): Promise<ResultadoAccion<Record<string, ValoresDeLead>>> {
  const parsed = ValoresVariablesSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "La muestra no es válida." };
  }
  const admin = await exigirAdmin();
  if (!admin.ok) return admin;

  try {
    const svc = await getDifusionServiceForRequest();
    return { ok: true, datos: await svc.valoresDeVariables(parsed.data.leadIds) };
  } catch (e) {
    return errorDeAccion(e, "valores-variables");
  }
}
