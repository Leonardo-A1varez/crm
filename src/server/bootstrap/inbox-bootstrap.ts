import { inngest } from "@/inngest/client";
import { recordatorioProgramado } from "@/inngest/events";
import { env } from "@/lib/env";
import { createSupabaseServerClient } from "@/server/auth/supabase-ssr";
import { SupabaseConversationsRepository } from "@/server/repositories/conversations.supabase.repo";
import { SupabaseIntentsRepository } from "@/server/repositories/intents.supabase.repo";
import { SupabaseLeadSessionRepository } from "@/server/repositories/lead-session.supabase.repo";
import { SupabaseLeadsRepository } from "@/server/repositories/leads.supabase.repo";
import { SupabaseLlmUsageRepository } from "@/server/repositories/llm-usage.supabase.repo";
import { SupabaseMessagesRepository } from "@/server/repositories/messages.supabase.repo";
import { SupabaseProductsRepository } from "@/server/repositories/productos.supabase.repo";
import { SupabaseRuleExecutionsRepository } from "@/server/repositories/rule-executions.supabase.repo";
import { SupabaseRulesRepository } from "@/server/repositories/rules.supabase.repo";
import { SupabaseSessionRecordatoriosRepository } from "@/server/repositories/session-recordatorios.supabase.repo";
import { SupabaseTagsRepository } from "@/server/repositories/tags.supabase.repo";
import { SupabaseToolExecutionsRepository } from "@/server/repositories/tool-executions.supabase.repo";
import { SupabaseTurnClassificationsRepository } from "@/server/repositories/turn-classifications.supabase.repo";
import { DefaultHandoffService } from "@/server/services/handoff.service";
import { DefaultInboxService } from "@/server/services/inbox/default-inbox.service";
import { DefaultMetaApiService } from "@/server/services/meta-api.service";
import { GraphApiMetaClient } from "@/server/services/meta/graph-api-client";
import type { AppClient } from "@/server/db/client";
import type {
  InboxService,
  ProgramarAvisoRecordatorioFn,
} from "@/server/services/inbox/inbox.service";

/**
 * Arranca el workflow durable del recordatorio.
 *
 * Vive acá y no adentro del service porque `server/services/**` no puede
 * importar `src/inngest/**` (boundaries), y no adentro de la Server Action
 * porque `app/**` tampoco —las dos únicas excepciones son los dos webhooks—.
 * Este bootstrap es la costura donde las capas se encuentran.
 *
 * El `id` es la idempotency key de Inngest: dos emisiones del mismo
 * recordatorio son una sola ejecución dormida, no dos avisos.
 *
 * **La fecha forma parte del `id`, y no es cosmético.** Reprogramar emite otro
 * evento sobre el mismo recordatorio; con la key vieja (`recordatorio:<id>`)
 * Inngest lo descartaría por duplicado dentro de su ventana de deduplicación y
 * la cita nueva no arrancaría nunca — el vendedor vería la fecha cambiada en la
 * ficha y no saltaría nada. Con la fecha adentro, cada cita tiene su ejecución
 * y reprogramar dos veces a la misma hora sigue siendo una sola.
 *
 * La ejecución vieja no se cancela: sigue durmiendo hasta su fecha y ahí sale
 * por `sin-efecto`, porque `marcarAvisado` compara la fecha del evento contra
 * la de la fila. Dos ejecuciones vivas un rato, un solo aviso.
 */
const programarAvisoRecordatorio: ProgramarAvisoRecordatorioFn = async (input) => {
  await inngest.send({
    // El nombre literal, como en el webhook de Meta: `inngest.send` tipa `name`
    // como string y el `eventType` se importa para que este literal no pueda
    // desalinearse del que registra el trigger sin que alguien lo note.
    name: recordatorioProgramado.name,
    data: {
      recordatorioId: input.recordatorioId,
      leadSessionId: input.leadSessionId,
      recordarAt: input.recordarAt.toISOString(),
    },
    id: `recordatorio:${input.recordatorioId}:${input.recordarAt.toISOString()}`,
  });
};

/** Composición pura del service sobre un client dado (authed o service-role en tests). */
export function makeInboxService(db: AppClient): InboxService {
  const convs = new SupabaseConversationsRepository(db);
  const messages = new SupabaseMessagesRepository(db);
  const sessions = new SupabaseLeadSessionRepository(db);

  // Canal sin config → ValidationError fail-fast con envHint al primer send.
  const metaClient = new GraphApiMetaClient({
    graphApiVersion: env.META_GRAPH_API_VERSION,
    whatsappPhoneNumberId: env.META_WHATSAPP_PHONE_NUMBER_ID,
    whatsappAccessToken: env.META_WHATSAPP_ACCESS_TOKEN,
    igPageId: env.META_IG_PAGE_ID,
    igAccessToken: env.META_IG_ACCESS_TOKEN,
    fbPageId: env.META_FB_PAGE_ID,
    fbAccessToken: env.META_FB_PAGE_ACCESS_TOKEN,
  });

  return new DefaultInboxService({
    leads: new SupabaseLeadsRepository(db),
    sessions,
    convs,
    messages,
    metaApi: new DefaultMetaApiService(convs, messages, metaClient),
    handoff: new DefaultHandoffService(sessions),
    productos: new SupabaseProductsRepository(db),
    tags: new SupabaseTagsRepository(db),
    // Solo lectura desde acá: quien escribe `llm_usage` es el pipeline con
    // service-role. La policy de SELECT alcanza al vendedor autenticado, que es
    // quien mira el panel.
    llmUsage: new SupabaseLlmUsageRepository(db),
    // Auditoría del turno. Igual que `llmUsage`: solo lectura desde el panel,
    // las escribe el pipeline con service-role. Las cuatro tablas tienen policy
    // de SELECT para vendedor y admin (`rule_executions` la ganó en la
    // migración de `turn_classifications`, que documenta por qué faltaba).
    ruleExecutions: new SupabaseRuleExecutionsRepository(db),
    turnClassifications: new SupabaseTurnClassificationsRepository(db),
    toolExecutions: new SupabaseToolExecutionsRepository(db),
    rules: new SupabaseRulesRepository(db),
    intents: new SupabaseIntentsRepository(db),
    // Este sí lo escribe el panel: programar y cancelar son actos del vendedor.
    // La migración le dio policies de SELECT/INSERT/UPDATE; DELETE no tiene, y
    // nada acá borra —cancelar es un UPDATE de estado—.
    recordatorios: new SupabaseSessionRecordatoriosRepository(db),
    programarAviso: programarAvisoRecordatorio,
  });
}

/**
 * Slice 3: el panel consume la DB con el client authed del request (RLS real).
 * Un service nuevo por request — construcción barata, el pool vive en PostgREST.
 * Inngest/webhooks siguen con service-role vía su propio bootstrap (7.8).
 */
export async function getInboxServiceForRequest(): Promise<InboxService> {
  const db = await createSupabaseServerClient();
  return makeInboxService(db);
}
