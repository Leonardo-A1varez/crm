import { env } from "@/lib/env";
import { createSupabaseServerClient } from "@/server/auth/supabase-ssr";
import { defaultDbClientFactory } from "@/server/db/client";
import { SupabaseConversationsRepository } from "@/server/repositories/conversations.supabase.repo";
import { SupabaseLeadSessionRepository } from "@/server/repositories/lead-session.supabase.repo";
import { SupabaseMediaStorage } from "@/server/repositories/media-storage.supabase.repo";
import { SupabaseMessagesRepository } from "@/server/repositories/messages.supabase.repo";
import { DefaultMetaApiService } from "@/server/services/meta-api.service";
import {
  DefaultAccesoMediaService,
  type AccesoMediaService,
} from "@/server/services/media/acceso-media.service";
import { reducirImagenParaEnviar } from "@/server/services/media/comprimir-imagen";
import {
  DefaultEnviarAdjuntoService,
  type EnviarAdjuntoService,
} from "@/server/services/media/enviar-adjunto.service";
import { GraphApiMediaClient } from "@/server/services/meta/graph-api-media";
import { crearMetaClientDelPanel } from "./inbox-bootstrap";
import { getResolverCredencialesWhatsApp } from "./whatsapp-credenciales-bootstrap";

/**
 * Abrir o descargar el archivo de un mensaje (`/api/media/[mensajeId]`). TODO con
 * el cliente de la sesión de quien mira: el mensaje lo recorta la RLS y la URL se
 * firma con la policy de SELECT del bucket (admin y vendedor). Sin service role.
 */
export async function getAccesoMediaServiceForRequest(): Promise<AccesoMediaService> {
  const db = await createSupabaseServerClient();
  return new DefaultAccesoMediaService({
    messages: new SupabaseMessagesRepository(db),
    storage: new SupabaseMediaStorage(db),
  });
}

/**
 * Mandar un archivo desde el composer (`DefaultEnviarAdjuntoService`).
 *
 * Dos clientes de Supabase, cada uno para lo suyo:
 *  - el del request (sesión del vendedor, RLS) para la sesión, la conversación
 *    y el mensaje saliente, igual que el envío de texto;
 *  - el de service role SÓLO para el bucket privado `mensajes_media`: el panel no
 *    tiene permiso de escritura ahí (ni debe), y subir, bajar y borrar el archivo
 *    del composer lo hace el servidor. La superficie es el service: valida que la
 *    ruta sea `sesiones/<sesión que el vendedor ya puede ver>/<uuid>.<ext>` antes
 *    de tocar nada.
 */
export async function getEnviarAdjuntoServiceForRequest(): Promise<EnviarAdjuntoService> {
  const db = await createSupabaseServerClient();
  const convs = new SupabaseConversationsRepository(db);
  const messages = new SupabaseMessagesRepository(db);
  return new DefaultEnviarAdjuntoService({
    sessions: new SupabaseLeadSessionRepository(db),
    convs,
    messages,
    metaApi: new DefaultMetaApiService(convs, messages, crearMetaClientDelPanel()),
    metaMedia: new GraphApiMediaClient({
      graphApiVersion: env.META_GRAPH_API_VERSION,
      whatsappPhoneNumberId: env.META_WHATSAPP_PHONE_NUMBER_ID,
      whatsappAccessToken: env.META_WHATSAPP_ACCESS_TOKEN,
      credenciales: getResolverCredencialesWhatsApp(),
    }),
    storage: new SupabaseMediaStorage(defaultDbClientFactory().serviceRole()),
    reducirImagen: reducirImagenParaEnviar,
  });
}
