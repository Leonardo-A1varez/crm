"use server";

import { revalidatePath } from "next/cache";
import { EditarCampoTwinSchema } from "@/lib/validation/inbox.schema";
import { getAuthenticatedUser } from "@/server/auth/supabase-ssr";
import { getInboxServiceForRequest } from "@/server/bootstrap/inbox-bootstrap";
import { toActionError } from "./action-error";
import type { ActionResult } from "@/types/inbox";

/** Campos numéricos del Twin: llegan como texto del input y viajan como número. */
const NUMERICOS = new Set(["precio_cotizado", "cantidad"]);

export async function editarCampoTwinAction(raw: unknown): Promise<ActionResult> {
  const parsed = EditarCampoTwinSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Campo inválido: revisá el valor." };
  }

  const { campo, valor } = parsed.data;

  // Un vacío borra el dato en vez de guardar "". La ficha distingue "no lo sé"
  // de "es una cadena vacía", y el extractor escribe null cuando no sabe.
  let normalizado: string | number | null =
    typeof valor === "string" && valor.trim() === "" ? null : valor;

  if (NUMERICOS.has(campo) && typeof normalizado === "string") {
    const n = Number(normalizado.replace(",", "."));
    if (!Number.isFinite(n) || n < 0) {
      return { ok: false, error: "Tiene que ser un número mayor o igual a cero." };
    }
    normalizado = n;
  }

  try {
    const user = await getAuthenticatedUser();
    const svc = await getInboxServiceForRequest();
    await svc.editarCampoTwin({
      sessionId: parsed.data.sessionId,
      campo,
      valor: normalizado,
      userId: user?.id ?? null,
    });
  } catch (e) {
    return toActionError(e, "editar-campo-twin");
  }

  revalidatePath(`/inbox/${parsed.data.leadId}`);
  return { ok: true };
}
