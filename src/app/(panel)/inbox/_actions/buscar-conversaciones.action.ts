"use server";

import { BuscarConversacionesSchema } from "@/lib/validation/inbox.schema";
import { getAuthenticatedUser } from "@/server/auth/supabase-ssr";
import { getBusquedaServiceForRequest } from "@/server/bootstrap/busqueda-bootstrap";
import { toActionError } from "./action-error";
import type { ResultadoBusquedaAction } from "@/types/inbox";

/**
 * Busca conversaciones en TODO el historial: mensajes, nombre, perfil de Meta y
 * teléfono, con filtros de canal, etapa, etiqueta, actividad y sesión.
 *
 * No escribe nada, así que tampoco `revalidatePath` — mismo criterio que la
 * auditoría del turno: revalidar volvería a pedir el hilo y el Twin en cada
 * tecleo del buscador.
 *
 * **Nada de lo que entra o sale de acá se loguea.** El término de búsqueda es
 * lo que un vendedor está buscando de un cliente, y los fragmentos que vuelven
 * son texto que escribió el cliente por WhatsApp: las dos cosas son PII y el
 * único lugar donde pueden estar es la pantalla de quien las pidió. Por eso los
 * errores se mapean con `toActionError` sin adjuntar el input.
 */
export async function buscarConversacionesAction(raw: unknown): Promise<ResultadoBusquedaAction> {
  const parsed = BuscarConversacionesSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Búsqueda inválida: refrescá la página." };
  }

  // El panel entero está detrás del proxy de sesión, pero una Server Action es
  // un endpoint POST con su propia URL: se comprueba acá igual, y con
  // `getUser()` —que valida el JWT contra el Auth server— y no con la sesión de
  // la cookie, que el cliente puede escribir.
  const user = await getAuthenticatedUser();
  if (!user) {
    return { ok: false, error: "Tu sesión expiró. Volvé a entrar." };
  }

  try {
    const svc = await getBusquedaServiceForRequest();
    return { ok: true, pagina: await svc.buscar(parsed.data) };
  } catch (e) {
    return toActionError(e, "buscar-conversaciones");
  }
}
