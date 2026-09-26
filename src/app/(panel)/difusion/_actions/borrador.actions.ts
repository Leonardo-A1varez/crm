"use server";

import { revalidatePath } from "next/cache";
import {
  CrearBorradorSchema,
  GuardarBorradorSchema,
} from "@/lib/validation/difusion-acciones.schema";
import { getDifusionServiceForRequest } from "@/server/bootstrap/difusion-bootstrap";
import { errorDeAccion, type ResultadoAccion } from "./action-error";
import { exigirAdmin } from "./permisos";

export async function crearBorradorAction(raw: unknown): Promise<ResultadoAccion<{ id: string }>> {
  const parsed = CrearBorradorSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "La difusión no es válida." };
  }
  const admin = await exigirAdmin();
  if (!admin.ok) return admin;

  try {
    const svc = await getDifusionServiceForRequest();
    const d = await svc.crearBorrador(parsed.data, admin.usuarioId);
    revalidatePath("/difusion");
    return { ok: true, datos: { id: d.id } };
  } catch (e) {
    return errorDeAccion(e, "crear-borrador");
  }
}

export async function guardarBorradorAction(raw: unknown): Promise<ResultadoAccion<null>> {
  const parsed = GuardarBorradorSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "La difusión no es válida." };
  }
  const admin = await exigirAdmin();
  if (!admin.ok) return admin;

  const { id, ...patch } = parsed.data;
  try {
    const svc = await getDifusionServiceForRequest();
    await svc.guardarBorrador(id, patch, admin.usuarioId);
    revalidatePath("/difusion");
    revalidatePath(`/difusion/${id}`);
    return { ok: true, datos: null };
  } catch (e) {
    return errorDeAccion(e, "guardar-borrador");
  }
}
