import { inngest } from "@/inngest/client";
import { whatsappNumeroConectado } from "@/inngest/events";
import { env } from "@/lib/env";
import { IllegalStateError } from "@/lib/errors";
import { llaveroDesdeEnv } from "@/lib/meta/token-cifrado";
import { getLogger } from "@/lib/observability/get-logger";
import { SupabaseWhatsAppNumerosRepository } from "@/server/repositories/whatsapp-numeros.supabase.repo";
import {
  DefaultConectarWhatsAppService,
  type ConectarWhatsAppService,
} from "@/server/services/meta/conectar-whatsapp.service";
import { GraphApiOnboardingClient } from "@/server/services/meta/graph-api-onboarding";
import type { WhatsAppNumero } from "@/types/whatsapp-numeros";
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
 * "Conectar WhatsApp" con el client authed del admin: el alta va por el RPC
 * `whatsapp_numero_conectar`, que exige admin en la base. El canje del código
 * usa el id y el secreto de la app (sólo servidor). Sin `META_APP_ID` no se
 * puede canjear: `IllegalStateError` con el nombre de la variable.
 */
export async function getConectarWhatsAppServiceForRequest(): Promise<ConectarWhatsAppService> {
  if (!env.META_APP_ID) {
    throw new IllegalStateError("falta META_APP_ID en el servidor", "meta_app_id");
  }
  const db = await createSupabaseServerClient();
  return new DefaultConectarWhatsAppService({
    graph: new GraphApiOnboardingClient({
      graphApiVersion: env.META_GRAPH_API_VERSION,
      appId: env.META_APP_ID,
      appSecret: env.META_APP_SECRET,
    }),
    numeros: new SupabaseWhatsAppNumerosRepository(db),
    llavero: () => llaveroDesdeEnv(env),
    emitirConectado: async ({ phoneNumberId, conectadoAt }) => {
      await inngest.send({
        name: whatsappNumeroConectado.name,
        data: { phoneNumberId, conectadoAt },
        // Clave explícita: función, día de la conexión, número. Un doble click
        // no arranca dos sincronizaciones (y la reserva en la base tampoco).
        id: `sincronizar-coexistencia-${conectadoAt.slice(0, 10)}-${phoneNumberId}`,
      });
    },
    logger: getLogger({ scope: "conectar-whatsapp" }),
  });
}

/** Los números conectados, para el admin (RLS: sólo admin los lee). */
export async function listarNumerosConectadosForRequest(): Promise<WhatsAppNumero[]> {
  return new SupabaseWhatsAppNumerosRepository(await createSupabaseServerClient()).listar();
}

/**
 * Lo que necesita el botón para abrir el popup de Meta: el id de la app y el
 * de la configuración. Son públicos (van al SDK en el navegador); el secreto
 * de la app y la clave de tokens se chequean acá pero no salen.
 */
export function configuracionConectarWhatsApp():
  | { estado: "lista"; appId: string; configId: string; graphVersion: string }
  | { estado: "incompleta"; faltan: string[] } {
  const faltan = [
    !env.META_APP_ID && "META_APP_ID",
    !env.META_EMBEDDED_SIGNUP_CONFIG_ID && "META_EMBEDDED_SIGNUP_CONFIG_ID",
    !env.META_TOKENS_CLAVE && "META_TOKENS_CLAVE",
  ].filter((v): v is string => typeof v === "string");
  if (faltan.length > 0 || !env.META_APP_ID || !env.META_EMBEDDED_SIGNUP_CONFIG_ID) {
    return { estado: "incompleta", faltan };
  }
  return {
    estado: "lista",
    appId: env.META_APP_ID,
    configId: env.META_EMBEDDED_SIGNUP_CONFIG_ID,
    graphVersion: env.META_GRAPH_API_VERSION,
  };
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
