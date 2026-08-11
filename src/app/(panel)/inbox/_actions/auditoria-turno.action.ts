"use server";

import { AuditoriaTurnoSchema } from "@/lib/validation/inbox.schema";
import { getInboxServiceForRequest } from "@/server/bootstrap/inbox-bootstrap";
import { toActionError } from "./action-error";
import type { ResultadoAuditoria } from "@/types/inbox";

/**
 * Lee por qué el agente contestó ese mensaje: regla o LLM, herramientas y costo.
 *
 * Es la única action del inbox que no escribe nada, así que tampoco
 * `revalidatePath`: revalidar la ruta volvería a pedir el hilo entero y el Twin
 * cada vez que alguien despliega una burbuja, que es exactamente el costo que
 * esta pantalla evita al leer la auditoría de a un turno.
 */
export async function auditoriaTurnoAction(raw: unknown): Promise<ResultadoAuditoria> {
  const parsed = AuditoriaTurnoSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Mensaje inválido: refrescá la página." };
  }

  try {
    const svc = await getInboxServiceForRequest();
    return { ok: true, auditoria: await svc.getAuditoriaTurno(parsed.data.mensajeId) };
  } catch (e) {
    return toActionError(e, "auditoria-turno");
  }
}
