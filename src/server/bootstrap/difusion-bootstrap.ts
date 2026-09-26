import { inngest } from "@/inngest/client";
import { env } from "@/lib/env";
import { getLogger } from "@/lib/observability/get-logger";
import { createSupabaseServerClient } from "@/server/auth/supabase-ssr";
import { getSaludWhatsAppService } from "@/server/bootstrap/ajustes-bootstrap";
import { SupabaseAdminAuditRepository } from "@/server/repositories/admin-audit.supabase.repo";
import { SupabaseAgenteConfigRepository } from "@/server/repositories/agente-config.supabase.repo";
import { SupabaseDifusionAudienciaRepository } from "@/server/repositories/difusion-audiencia.supabase.repo";
import { SupabaseDifusionEnviosRepository } from "@/server/repositories/difusion-envios.supabase.repo";
import { SupabaseDifusionProgramacionRepository } from "@/server/repositories/difusion-programacion.supabase.repo";
import { SupabaseDifusionSupresionesRepository } from "@/server/repositories/difusion-supresiones.supabase.repo";
import { SupabaseDifusionesRepository } from "@/server/repositories/difusiones.supabase.repo";
import { SupabaseLeadSessionRepository } from "@/server/repositories/lead-session.supabase.repo";
import { SupabaseLeadVehiculosRepository } from "@/server/repositories/lead-vehiculos.supabase.repo";
import { SupabaseLeadsRepository } from "@/server/repositories/leads.supabase.repo";
import { SupabaseMessagesRepository } from "@/server/repositories/messages.supabase.repo";
import { SupabaseTagsRepository } from "@/server/repositories/tags.supabase.repo";
import { SupabaseUsersRepository } from "@/server/repositories/users.supabase.repo";
import { CachedAgentConfigProvider } from "@/server/services/agente/config-provider";
import { cargarDatosDelLeadParaDifusion } from "@/server/services/difusion/datos-lead";
import { DefaultDifusionService } from "@/server/services/difusion/difusion.service";
import {
  DefaultPruebaDifusionService,
  type PruebaDifusionService,
} from "@/server/services/difusion/prueba.service";
import { topeDesdeLimite } from "@/server/services/difusion/tope";
import { GraphApiMetaClient } from "@/server/services/meta/graph-api-client";
import type { AppClient } from "@/server/db/client";
import type { DifusionService } from "@/server/services/difusion/difusion.service";
import type { SaludWhatsApp } from "@/server/services/meta/salud-whatsapp.service";

/** Cuánto se reutiliza una lectura de la salud de WhatsApp en esta instancia. */
const TTL_SALUD_MS = 60_000;

let saludCache: { expira: number; lectura: Promise<SaludWhatsApp> } | null = null;

/**
 * La salud de WhatsApp leída de Meta, compartida hasta un minuto por
 * instancia.
 *
 * El alcance se recalcula mientras se editan las condiciones, y cada lectura
 * son cinco pedidos a la Graph API. Un minuto de atraso en el escalón o en el
 * estado de una plantilla no cambia ninguna decisión; cinco pedidos por cada
 * cambio del árbol sí gastan el límite de la API. La pantalla muestra cuándo
 * se leyó (`consultadoAt`). `leer()` no lanza nunca: lo que no llega vuelve
 * con su motivo.
 */
export function leerSaludWhatsAppCacheada(): Promise<SaludWhatsApp> {
  const ahora = Date.now();
  if (saludCache !== null && ahora < saludCache.expira) return saludCache.lectura;
  const lectura = getSaludWhatsAppService().leer();
  saludCache = { expira: ahora + TTL_SALUD_MS, lectura };
  return lectura;
}

/**
 * Composición pura sobre un client dado. En el panel es el client autenticado
 * del request: el resolver y las lecturas corren con el RLS de quien mira, y
 * `programar_difusion()` exige que sea admin.
 *
 * El aviso directo al motor vive acá y no en el servicio porque
 * `server/services/**` no puede importar `src/inngest/**` (boundaries): es la
 * misma costura que el recordatorio del Inbox. El `id` es la idempotency key:
 * el aviso directo y el reenvío del outbox son un solo evento para Inngest.
 */
export function makeDifusionService(db: AppClient): DifusionService {
  const logger = getLogger({ scope: "difusion" });
  const configAgente = new CachedAgentConfigProvider(
    new SupabaseAgenteConfigRepository(db),
    logger,
  );

  return new DefaultDifusionService({
    // Con el client de quien aprieta: `admin_actions` sólo acepta inserts de admin.
    audit: new SupabaseAdminAuditRepository(db),
    difusiones: new SupabaseDifusionesRepository(db),
    envios: new SupabaseDifusionEnviosRepository(db),
    supresiones: new SupabaseDifusionSupresionesRepository(db),
    audiencia: new SupabaseDifusionAudienciaRepository(db),
    programacion: new SupabaseDifusionProgramacionRepository(db),
    tags: new SupabaseTagsRepository(db),
    usuarios: new SupabaseUsersRepository(db),
    leerTopeMensajeria: async () => topeDesdeLimite((await leerSaludWhatsAppCacheada()).limite),
    leerMaxSalientes24h: async () => (await configAgente.get()).max_salientes_automaticos_24h,
    avisarProgramada: async (evento) => {
      await inngest.send({ name: evento.name, data: evento.data, id: evento.id });
    },
    // La misma carga que usa el motor al mandar, con el client de quien mira.
    datosDelLead: (leadId, campos) =>
      cargarDatosDelLeadParaDifusion(
        {
          leads: new SupabaseLeadsRepository(db),
          vehiculos: new SupabaseLeadVehiculosRepository(db),
          sessions: new SupabaseLeadSessionRepository(db),
        },
        leadId,
        campos,
      ),
    avisarReanudada: async (evento) => {
      await inngest.send({ name: evento.name, data: evento.data, id: evento.id });
    },
    // Las respuestas de la pantalla de envío: el texto del entrante (por su
    // wamid) y el nombre del lead. Con el RLS de quien mira; son pocas (el
    // detalle lista hasta 20).
    leerRespuestas: async (wamids, leadIds) => {
      const messages = new SupabaseMessagesRepository(db);
      const [mensajes, leads] = await Promise.all([
        Promise.all(wamids.map((w) => messages.findByMetaMessageId(w))),
        new SupabaseLeadsRepository(db).listByIds([...leadIds]),
      ]);
      const textos = new Map<string, { contenido: string | null; tipo: string }>();
      for (const m of mensajes) {
        if (m?.meta_message_id)
          textos.set(m.meta_message_id, { contenido: m.contenido, tipo: m.tipo });
      }
      const nombres = new Map(
        leads.map((l) => [l.id, l.nombre.trim() || l.nombre_perfil?.trim() || ""] as const),
      );
      return { textos, nombres };
    },
    logger,
  });
}

/** Panel: un servicio por request, con el client autenticado (RLS real). */
export async function getDifusionServiceForRequest(): Promise<DifusionService> {
  return makeDifusionService(await createSupabaseServerClient());
}

/**
 * "Enviar de prueba a mi número". Con el client autenticado: la difusión y la
 * auditoría (`admin_actions`, insert sólo admin) pasan por el RLS de quien
 * aprieta. Manda por el mismo `GraphApiMetaClient` que el motor; la URL base
 * la resuelve el cliente (`META_GRAPH_API_BASE_URL` en el entorno local apunta
 * al mock de Meta).
 */
export async function getPruebaDifusionServiceForRequest(): Promise<PruebaDifusionService> {
  const db = await createSupabaseServerClient();
  return new DefaultPruebaDifusionService({
    difusiones: new SupabaseDifusionesRepository(db),
    audit: new SupabaseAdminAuditRepository(db),
    supresiones: new SupabaseDifusionSupresionesRepository(db),
    meta: new GraphApiMetaClient({
      graphApiVersion: env.META_GRAPH_API_VERSION,
      whatsappPhoneNumberId: env.META_WHATSAPP_PHONE_NUMBER_ID,
      whatsappAccessToken: env.META_WHATSAPP_ACCESS_TOKEN,
      igPageId: env.META_IG_PAGE_ID,
      igAccessToken: env.META_IG_ACCESS_TOKEN,
      fbPageId: env.META_FB_PAGE_ID,
      fbAccessToken: env.META_FB_PAGE_ACCESS_TOKEN,
    }),
    datosDelLead: (leadId, campos) =>
      cargarDatosDelLeadParaDifusion(
        {
          leads: new SupabaseLeadsRepository(db),
          vehiculos: new SupabaseLeadVehiculosRepository(db),
          sessions: new SupabaseLeadSessionRepository(db),
        },
        leadId,
        campos,
      ),
  });
}
