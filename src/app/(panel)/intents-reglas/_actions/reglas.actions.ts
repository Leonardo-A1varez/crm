"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ConflictError, DomainError, PermissionDeniedError } from "@/lib/errors";
import { RESPUESTA_TIPO } from "@/types/domain";
import { getCurrentRol } from "@/server/auth/guards";
import { getReglasAdminServiceForRequest } from "@/server/bootstrap/reglas-bootstrap";
import type { ActionResult } from "@/types/inbox";

const UUIDSchema = z.string().uuid();

const CrearIntentSchema = z.object({
  nombre: z
    .string()
    .trim()
    .min(2)
    .max(60)
    // El nombre viaja al prompt del clasificador: sin esta guarda, un nombre
    // con saltos de línea puede reescribir la instrucción que lo rodea.
    .regex(/^[a-z0-9_]+$/, "solo minúsculas, números y guion bajo"),
  descripcion: z.string().trim().max(300),
  ejemplos: z.array(z.string().trim().max(300)).max(20),
});

const CrearReglaSchema = z.object({
  intentId: UUIDSchema,
  respuestaTipo: z.enum(RESPUESTA_TIPO),
  respuestaContenido: z.string().trim().min(1).max(4096),
  prioridad: z.number().int().min(0).max(1000),
});

const ToggleSchema = z.object({ id: UUIDSchema, valor: z.boolean() });

const CrearReglaEtiquetaSchema = z.object({ intentId: UUIDSchema, tagId: UUIDSchema });

const BorrarSchema = z.object({ id: UUIDSchema });

/**
 * Las cuatro acciones revalidan `/agente` y no `/intents-reglas/*`: intents y
 * reglas se administran desde la pestaña "Reglas IF/THEN" de la consola
 * (handoff §4.1) y las rutas viejas quedaron solo como redirección. Las
 * acciones siguen viviendo acá para no mover su ruta pública.
 */

/**
 * Gate de rol en el server. RLS lo vuelve a enforcear en la DB: esto existe
 * para dar un mensaje entendible, no como única defensa.
 */
async function soloAdmin(): Promise<void> {
  const rol = await getCurrentRol();
  if (rol !== "admin") {
    throw new PermissionDeniedError("solo un admin puede tocar intents y reglas");
  }
}

function fallo(e: unknown, fallback: string): ActionResult {
  if (e instanceof PermissionDeniedError) {
    return { ok: false, error: "Solo un administrador puede hacer esto." };
  }
  if (e instanceof DomainError) return { ok: false, error: e.message };
  return { ok: false, error: fallback };
}

export async function crearIntentAction(raw: unknown): Promise<ActionResult> {
  const parsed = CrearIntentSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Intent inválido." };
  }
  try {
    await soloAdmin();
    const svc = await getReglasAdminServiceForRequest();
    await svc.crearIntent(parsed.data);
  } catch (e) {
    return fallo(e, "No se pudo crear el intent.");
  }
  revalidatePath("/agente");
  return { ok: true };
}

export async function setIntentActivoAction(raw: unknown): Promise<ActionResult> {
  const parsed = ToggleSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Dato inválido." };
  try {
    await soloAdmin();
    const svc = await getReglasAdminServiceForRequest();
    await svc.setIntentActivo(parsed.data.id, parsed.data.valor);
  } catch (e) {
    return fallo(e, "No se pudo cambiar el intent.");
  }
  revalidatePath("/agente");
  return { ok: true };
}

export async function crearReglaAction(raw: unknown): Promise<ActionResult> {
  const parsed = CrearReglaSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Regla inválida." };
  }
  try {
    await soloAdmin();
    const svc = await getReglasAdminServiceForRequest();
    await svc.crearRegla(parsed.data);
  } catch (e) {
    return fallo(e, "No se pudo crear la regla.");
  }
  revalidatePath("/agente");
  return { ok: true };
}

export async function setReglaActivaAction(raw: unknown): Promise<ActionResult> {
  const parsed = ToggleSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Dato inválido." };
  try {
    await soloAdmin();
    const svc = await getReglasAdminServiceForRequest();
    await svc.setReglaActiva(parsed.data.id, parsed.data.valor);
  } catch (e) {
    return fallo(e, "No se pudo cambiar la regla.");
  }
  revalidatePath("/agente");
  return { ok: true };
}

/**
 * Las tres de etiquetado comparten el gate y la revalidación de arriba. Viven
 * acá y no en `_actions` de `/agente` para que toda la administración de
 * reglas —las que contestan y las que etiquetan— entre por la misma puerta.
 */

export async function crearReglaEtiquetaAction(raw: unknown): Promise<ActionResult> {
  const parsed = CrearReglaEtiquetaSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Elegí un intent y una etiqueta." };
  try {
    await soloAdmin();
    const svc = await getReglasAdminServiceForRequest();
    await svc.crearReglaEtiqueta(parsed.data);
  } catch (e) {
    // `reglas_etiqueta_par_unico`: el mismo par colgaría la etiqueta dos veces.
    if (e instanceof ConflictError) {
      return { ok: false, error: "Ese intent ya cuelga esa etiqueta." };
    }
    return fallo(e, "No se pudo crear la regla de etiquetado.");
  }
  revalidatePath("/agente");
  return { ok: true };
}

export async function setReglaEtiquetaActivaAction(raw: unknown): Promise<ActionResult> {
  const parsed = ToggleSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Dato inválido." };
  try {
    await soloAdmin();
    const svc = await getReglasAdminServiceForRequest();
    await svc.setReglaEtiquetaActiva(parsed.data.id, parsed.data.valor);
  } catch (e) {
    return fallo(e, "No se pudo cambiar la regla de etiquetado.");
  }
  revalidatePath("/agente");
  return { ok: true };
}

export async function borrarReglaEtiquetaAction(raw: unknown): Promise<ActionResult> {
  const parsed = BorrarSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Dato inválido." };
  try {
    await soloAdmin();
    const svc = await getReglasAdminServiceForRequest();
    await svc.borrarReglaEtiqueta(parsed.data.id);
  } catch (e) {
    return fallo(e, "No se pudo borrar la regla de etiquetado.");
  }
  revalidatePath("/agente");
  return { ok: true };
}
