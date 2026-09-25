import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * El cliente de Supabase del navegador. Hoy lo usa sólo Realtime.
 *
 * Es el patrón oficial de `@supabase/ssr`: `createBrowserClient` lee la sesión
 * de las cookies que deja el login y, por defecto, devuelve siempre la misma
 * instancia en el navegador (`isSingleton`), así que llamarlo desde varios
 * componentes no abre varios sockets.
 *
 * **Las policies aplican.** supabase-js le pasa a Realtime el JWT de la sesión
 * (`accessToken` → `_getAccessToken`), y Realtime entrega cada fila con las
 * policies de SELECT del rol de quien mira: el canal ve lo mismo que la API
 * REST. Con la anon key y sin sesión, `workflow_runs` no manda nada.
 *
 * Las variables se leen de `process.env` y no de `@/lib/env`: ese módulo valida
 * también los secretos del servidor, que en el navegador no existen, y fallaría
 * al cargar. Next reemplaza las `NEXT_PUBLIC_*` en el build.
 *
 * Sin el tipo generado de la base: vive en `server/db/`, que `lib/` no puede
 * importar, y Realtime no lo usa — el payload se descarta y la pantalla vuelve
 * a pedir la vista por la Server Action.
 */
export function clienteNavegador(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  // Sin configuración no hay canal: quien llama lo dice en pantalla como
  // "sin conexión en vivo" en vez de romper la página entera.
  if (!url || !anonKey) return null;
  return createBrowserClient(url, anonKey);
}

/** Si el navegador tiene con qué abrir un canal. Da lo mismo en el servidor y en el cliente. */
export function hayRealtimeEnNavegador(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
