"use server";

import { revalidatePath } from "next/cache";
import {
  AgregarVehiculoSchema,
  EditarIdentidadVehiculoSchema,
  QuitarVehiculoSchema,
} from "@/lib/validation/leads.schema";
import { getAuthenticatedUser } from "@/server/auth/supabase-ssr";
import { getLeadsServiceForRequest } from "@/server/bootstrap/leads-bootstrap";
import { toActionError } from "./action-error";
import type { ActionResult } from "@/types/inbox";

/**
 * Las tres acciones sobre los autos del lead, en un archivo.
 *
 * Van juntas porque comparten schema, permisos y revalidación, y separarlas en
 * tres archivos de veinte líneas idénticas sería tres lugares donde corregir el
 * mismo copy.
 *
 * Ninguna es admin-only: las policies de `lead_vehiculos` habilitan a admin y a
 * vendedor, y es el vendedor el que tiene la placa a mano mientras habla con el
 * cliente. El gate real es la RLS del client autenticado, no un `if` acá.
 *
 * Ninguna escribe `admin_actions`: la policy de INSERT de esa tabla es
 * admin-only (migración `20260716001443`), así que auditar rompería la acción
 * justo para el rol que más la va a usar.
 */

/** El primer issue del schema, que está escrito para leerse en el toast. */
function primerError(issues: readonly { message: string }[]): string {
  return issues[0]?.message ?? "Datos inválidos. Refrescá la página.";
}

/** Las dos pantallas que muestran los autos del lead. */
function revalidar(leadId: string): void {
  revalidatePath(`/leads/${leadId}`);
  revalidatePath(`/inbox/${leadId}`);
}

export async function agregarVehiculoAction(raw: unknown): Promise<ActionResult> {
  const parsed = AgregarVehiculoSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: primerError(parsed.error.issues) };

  try {
    const user = await getAuthenticatedUser();
    if (!user) return { ok: false, error: "Tu sesión expiró. Volvé a entrar." };
    const svc = await getLeadsServiceForRequest();
    await svc.agregarVehiculo(parsed.data);
  } catch (e) {
    return toActionError(e, "agregar-vehiculo", {
      permisoDenegado: "No tenés permiso para cargar vehículos de este lead.",
    });
  }

  revalidar(parsed.data.leadId);
  return { ok: true };
}

/** Carga o corrige la placa y el VIN de un auto ya detectado. */
export async function editarIdentidadVehiculoAction(raw: unknown): Promise<ActionResult> {
  const parsed = EditarIdentidadVehiculoSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: primerError(parsed.error.issues) };

  try {
    const user = await getAuthenticatedUser();
    if (!user) return { ok: false, error: "Tu sesión expiró. Volvé a entrar." };
    const svc = await getLeadsServiceForRequest();
    await svc.editarIdentidadVehiculo(parsed.data);
  } catch (e) {
    return toActionError(e, "editar-identidad-vehiculo", {
      permisoDenegado: "No tenés permiso para editar los vehículos de este lead.",
      noEncontrado: "Ese vehículo ya no está en el lead. Refrescá la página.",
    });
  }

  revalidar(parsed.data.leadId);
  return { ok: true };
}

export async function quitarVehiculoAction(raw: unknown): Promise<ActionResult> {
  const parsed = QuitarVehiculoSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Vehículo inválido." };

  try {
    const user = await getAuthenticatedUser();
    if (!user) return { ok: false, error: "Tu sesión expiró. Volvé a entrar." };
    const svc = await getLeadsServiceForRequest();
    await svc.quitarVehiculo(parsed.data);
  } catch (e) {
    return toActionError(e, "quitar-vehiculo", {
      permisoDenegado: "No tenés permiso para quitar vehículos de este lead.",
      noEncontrado: "Ese vehículo ya no está en el lead. Refrescá la página.",
    });
  }

  revalidar(parsed.data.leadId);
  return { ok: true };
}
