import { inngest } from "@/inngest/client";
import { getLogger } from "@/lib/observability/get-logger";
import { createSupabaseServerClient } from "@/server/auth/supabase-ssr";
import { getSaludWhatsAppService } from "@/server/bootstrap/ajustes-bootstrap";
import { SupabaseAgenteConfigRepository } from "@/server/repositories/agente-config.supabase.repo";
import { SupabaseDifusionAudienciaRepository } from "@/server/repositories/difusion-audiencia.supabase.repo";
import { SupabaseDifusionEnviosRepository } from "@/server/repositories/difusion-envios.supabase.repo";
import { SupabaseDifusionProgramacionRepository } from "@/server/repositories/difusion-programacion.supabase.repo";
import { SupabaseDifusionSupresionesRepository } from "@/server/repositories/difusion-supresiones.supabase.repo";
import { SupabaseDifusionesRepository } from "@/server/repositories/difusiones.supabase.repo";
import { SupabaseLeadSessionRepository } from "@/server/repositories/lead-session.supabase.repo";
import { SupabaseLeadVehiculosRepository } from "@/server/repositories/lead-vehiculos.supabase.repo";
import { SupabaseLeadsRepository } from "@/server/repositories/leads.supabase.repo";
import { SupabaseTagsRepository } from "@/server/repositories/tags.supabase.repo";
import { SupabaseUsersRepository } from "@/server/repositories/users.supabase.repo";
import { CachedAgentConfigProvider } from "@/server/services/agente/config-provider";
import { cargarDatosDelLeadParaDifusion } from "@/server/services/difusion/datos-lead";
import { DefaultDifusionService } from "@/server/services/difusion/difusion.service";
import { topeDesdeLimite } from "@/server/services/difusion/tope";
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
    logger,
  });
}

/** Panel: un servicio por request, con el client autenticado (RLS real). */
export async function getDifusionServiceForRequest(): Promise<DifusionService> {
  return makeDifusionService(await createSupabaseServerClient());
}
