import { env } from "@/lib/env";
import { llaveroDesdeEnv } from "@/lib/meta/token-cifrado";
import { defaultDbClientFactory } from "@/server/db/client";
import { SupabaseWhatsAppNumerosRepository } from "@/server/repositories/whatsapp-numeros.supabase.repo";
import {
  DefaultResolverCredencialesWhatsApp,
  type ResolverCredencialesWhatsApp,
} from "@/server/services/meta/credenciales-whatsapp.service";

let resolver: ResolverCredencialesWhatsApp | null = null;

/**
 * El token de los números conectados desde Ajustes, para los envíos que hace
 * el panel (el composer del Inbox).
 *
 * Es la única pieza del lado del panel que usa service role, y a propósito:
 * el token no lo puede leer nadie del panel por REST (la tabla no tiene grant
 * para `authenticated`), pero el envío que dispara un vendedor tiene que salir
 * por el número de la conversación. La superficie es una sola operación —
 * `para(phoneNumberId)`, con el id que sale de una conversación que la RLS ya
 * le dejó leer al que manda— y devuelve el token sólo hacia el cliente de la
 * Graph API, nunca hacia la UI. Singleton por proceso: así el caché de 60 s
 * sirve a todos los requests.
 */
export function getResolverCredencialesWhatsApp(): ResolverCredencialesWhatsApp {
  if (resolver === null) {
    resolver = new DefaultResolverCredencialesWhatsApp({
      repo: new SupabaseWhatsAppNumerosRepository(defaultDbClientFactory().serviceRole()),
      llavero: () => llaveroDesdeEnv(env),
    });
  }
  return resolver;
}
