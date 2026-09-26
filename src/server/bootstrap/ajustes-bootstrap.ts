import { env } from "@/lib/env";
import { getLogger } from "@/lib/observability/get-logger";
import { createSupabaseServerClient } from "@/server/auth/supabase-ssr";
import { SupabaseEmpresasRepository } from "@/server/repositories/empresas.supabase.repo";
import { SupabaseMetaOperationalEventsRepository } from "@/server/repositories/meta-operational-events.supabase.repo";
import { SupabaseUsoCupoRepository } from "@/server/repositories/uso-cupo.supabase.repo";
import { SupabaseWhatsAppNumerosRolRepository } from "@/server/repositories/whatsapp-numeros-rol.supabase.repo";
import { DefaultEmpresaService } from "@/server/services/empresa/empresa.service";
import { GraphApiMetaLecturaClient } from "@/server/services/meta/graph-api-lectura";
import { DefaultRegistrosWhatsAppService } from "@/server/services/meta/registros-whatsapp.service";
import { DefaultSaludWhatsAppService } from "@/server/services/meta/salud-whatsapp.service";
import type { AppClient } from "@/server/db/client";
import type { EmpresaService } from "@/server/services/empresa/empresa.service";
import type { RegistrosWhatsAppService } from "@/server/services/meta/registros-whatsapp.service";
import type { SaludWhatsAppService } from "@/server/services/meta/salud-whatsapp.service";

/** Composición pura del service sobre un client dado (authed o service-role en tests). */
export function makeEmpresaService(db: AppClient): EmpresaService {
  return new DefaultEmpresaService({ empresas: new SupabaseEmpresasRepository(db) });
}

/** Panel: client authed del request (RLS real: `empresas_select`). Uno por request. */
export async function getEmpresaServiceForRequest(): Promise<EmpresaService> {
  return makeEmpresaService(await createSupabaseServerClient());
}

/**
 * El panel de salud de WhatsApp. Lee la Graph API de Meta con el token del
 * servidor y SÓLO con GET (`GraphApiMetaLecturaClient`).
 *
 * El token no sale de acá: el servicio devuelve datos ya interpretados —ni
 * token, ni URLs de Meta— y la página los pasa a componentes de servidor. La
 * versión es la de `META_GRAPH_API_VERSION` tal cual; subirla está prohibido
 * sin contract tests (`docs/meta-platform-limits.md`).
 *
 * No usa el client de Supabase: nada de esto vive en la base. La ruta está
 * detrás del `proxy.ts`, que redirige a `/login` antes de renderizar.
 */
export function getSaludWhatsAppService(): SaludWhatsAppService {
  return new DefaultSaludWhatsAppService({
    cliente: new GraphApiMetaLecturaClient({
      graphApiVersion: env.META_GRAPH_API_VERSION,
      accessToken: env.META_WHATSAPP_ACCESS_TOKEN,
    }),
    phoneNumberId: env.META_WHATSAPP_PHONE_NUMBER_ID,
    versionApi: env.META_GRAPH_API_VERSION,
    logger: getLogger({ scope: "meta-salud" }),
  });
}

/**
 * Lo que la salud de WhatsApp saca de la base: account_update guardados, uso
 * del cupo con los envíos propios y el rol de cada número. Client authed del
 * request: la RLS decide qué se lee y quién escribe el rol (sólo admin).
 */
export async function getRegistrosWhatsAppServiceForRequest(): Promise<RegistrosWhatsAppService> {
  const db = await createSupabaseServerClient();
  return new DefaultRegistrosWhatsAppService({
    eventos: new SupabaseMetaOperationalEventsRepository(db),
    uso: new SupabaseUsoCupoRepository(db),
    roles: new SupabaseWhatsAppNumerosRolRepository(db),
  });
}
