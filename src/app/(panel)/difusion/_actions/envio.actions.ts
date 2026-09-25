"use server";

import { revalidatePath } from "next/cache";
import {
  DetenerSchema,
  DifusionIdSchema,
  ProgramarSchema,
} from "@/lib/validation/difusion-acciones.schema";
import { getDifusionServiceForRequest } from "@/server/bootstrap/difusion-bootstrap";
import { errorDeAccion, type ResultadoAccion } from "./action-error";
import { exigirAdmin } from "./permisos";
import type {
  ResultadoCancelar,
  ResultadoProgramar,
} from "@/server/services/difusion/difusion.service";

/** El motivo que queda escrito cuando una persona detiene sin explicar por qué. */
const MOTIVO_DETENCION_MANUAL = "Detenida a mano desde el panel.";

function revalidar(id: string) {
  revalidatePath("/difusion");
  revalidatePath(`/difusion/${id}`);
}

export async function programarAction(raw: unknown): Promise<ResultadoAccion<ResultadoProgramar>> {
  const parsed = ProgramarSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Pedido inválido." };
  }
  const admin = await exigirAdmin();
  if (!admin.ok) return admin;

  try {
    const svc = await getDifusionServiceForRequest();
    const r = await svc.programar(parsed.data.id, { canaryTamano: parsed.data.canaryTamano });
    revalidar(parsed.data.id);
    return { ok: true, datos: r };
  } catch (e) {
    return errorDeAccion(e, "programar");
  }
}

export async function detenerAction(raw: unknown): Promise<ResultadoAccion<ResultadoCancelar>> {
  const parsed = DetenerSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Pedido inválido." };
  }
  const admin = await exigirAdmin();
  if (!admin.ok) return admin;

  try {
    const svc = await getDifusionServiceForRequest();
    const r = await svc.cancelar(parsed.data.id, {
      motivo: parsed.data.motivo ?? MOTIVO_DETENCION_MANUAL,
      actorId: admin.usuarioId,
    });
    revalidar(parsed.data.id);
    return { ok: true, datos: r };
  } catch (e) {
    return errorDeAccion(e, "detener");
  }
}

export async function pausarAction(raw: unknown): Promise<ResultadoAccion<null>> {
  const parsed = DifusionIdSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Pedido inválido." };
  }
  const admin = await exigirAdmin();
  if (!admin.ok) return admin;

  try {
    const svc = await getDifusionServiceForRequest();
    await svc.pausar(parsed.data.id);
    revalidar(parsed.data.id);
    return { ok: true, datos: null };
  } catch (e) {
    return errorDeAccion(e, "pausar");
  }
}

export async function reanudarAction(raw: unknown): Promise<ResultadoAccion<null>> {
  const parsed = DifusionIdSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Pedido inválido." };
  }
  const admin = await exigirAdmin();
  if (!admin.ok) return admin;

  try {
    const svc = await getDifusionServiceForRequest();
    await svc.reanudar(parsed.data.id);
    revalidar(parsed.data.id);
    return { ok: true, datos: null };
  } catch (e) {
    return errorDeAccion(e, "reanudar");
  }
}
