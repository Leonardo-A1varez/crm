"use server";

import { CalcularAlcanceSchema } from "@/lib/validation/difusion-acciones.schema";
import { getDifusionServiceForRequest } from "@/server/bootstrap/difusion-bootstrap";
import { errorDeAccion, type ResultadoAccion } from "./action-error";
import { exigirAdmin } from "./permisos";
import type { Alcance } from "@/server/services/difusion/difusion.service";

/**
 * El tamaño de la audiencia mientras se arma, y la lista exacta en el
 * pre-vuelo (con `muestra.desde` se piden más páginas). Es de admin porque es
 * parte de armar una difusión, que es de admin.
 */
export async function calcularAlcanceAction(raw: unknown): Promise<ResultadoAccion<Alcance>> {
  const parsed = CalcularAlcanceSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "La audiencia no es válida." };
  }
  const admin = await exigirAdmin();
  if (!admin.ok) return admin;

  try {
    const svc = await getDifusionServiceForRequest();
    return { ok: true, datos: await svc.calcularAlcance(parsed.data) };
  } catch (e) {
    return errorDeAccion(e, "calcular-alcance");
  }
}
