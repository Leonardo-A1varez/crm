# Arquitectura

> Detalle vivo. Espejo de decisiones implementadas en `src/`. Actualizado 2026-08-12.

## Capas (DDD-light)

```
┌─────────────────────────────────────────────────────────────┐
│ HTTP boundary                                                │
│  - app/api/webhooks/meta/route.ts       (signature verify)   │
│  - app/api/webhooks/inngest/route.ts    (serve handler)      │
│  - app/api/leads/route.ts, messages/send, etc.               │
│  - Server Actions (RSC interactivity)                        │
│  Validation: Zod schemas en src/lib/validation/              │
└──────────────────────┬──────────────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ Workflows (Inngest functions)                                │
│  Pure handlers (testable) + factory binding (DI deps)        │
│  - on-message-received  (10 granular steps R4)               │
│  - update-lead-twin                                          │
│  - detect-intents.batch (cron)                               │
│  - auto-handoff                                              │
│  - purge-old-sessions   (cron)                               │
│  - reactivation-predictor (cron)                             │
│  Orquestan services. No tocan repos directo.                 │
└──────────────────────┬──────────────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ Services (business logic)                                    │
│  - catalog-matcher       (scoring + filtering)               │
│  - intent-classifier     (LLM + sanitize alucinación)        │
│  - rule-engine           (intent → respuesta fija)           │
│  - twin-extractor        (LLM patch + SessionLock R3)        │
│  - handoff               (pause/resume/evaluate)             │
│  - meta-api              (send/record + idempotency R2)      │
│  - ai-agent              (rule → LLM + tool audit R8)        │
│  - conversation-summarizer (R10)                             │
│  - admin-audit           (R11)                               │
│  - lead-merge-detector   (R12)                               │
│  - event-bus             (B2 outbox + optimistic dispatch)   │
│  DI repos por constructor. No tocan DB directo.              │
│  Externos detrás de interfaces (LLM/Meta).                   │
└──────────────────────┬──────────────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ Repositories (data access)                                   │
│  Interface + InMemory impl (Fase 4-12).                      │
│  Supabase impl Fase 7.                                       │
│  - leads, lead-session, conversations, messages              │
│  - productos, intents, rules, tags, users                    │
│  - tool-executions (R8), admin-audit (R11), merge-candidates (R12) │
│  - reactivation-dispatches (A2), event-outbox (B2)           │
│  Deep-clone defensivo en jsonb fields (parity Supabase).     │
└──────────────────────┬──────────────────────────────────────┘
                       ▼
              ┌────────┴────────┐
              ▼                 ▼
      ┌──────────────┐  ┌──────────────┐
      │ Supabase DB  │  │  Storage     │
      │ (Postgres)   │  │  (buckets)   │
      └──────────────┘  └──────────────┘

       ┌─────────────────────────────────────────────┐
       │ External (interfaces inyectables, mock+real)│
       ├─────────────────────────────────────────────┤
       │ LLM:  IntentClassifierLLM / TwinExtractorLLM│
       │       AgentLLM / IntentBatchDetectorLLM     │
       │       ConversationSummarizerLLM             │
       │       Real (Fase 7): @ai-sdk/openai         │
       ├─────────────────────────────────────────────┤
       │ Meta: MetaApiClient                         │
       │       Real (Fase 7): Graph API v21.0        │
       ├─────────────────────────────────────────────┤
       │ Infra (R5-R7):                              │
       │   Logger        (Noop/Console/Pino)         │
       │   CostTracker   (InMemory/VercelKV)         │
       │   FeatureFlags  (Static/AllEnabled/EdgeCfg) │
       │   SessionLock   (Noop/InMemory/Postgres)    │
       └─────────────────────────────────────────────┘
```

## Reglas duras

1. **API/Action → Service → Repository → DB.** Saltar capas prohibido.
2. **Services NO tocan DB.** Reciben repos por DI.
3. **Repos NO conocen services.** Solo CRUD + custom queries de su agregado.
4. **Inngest functions NO tocan DB.** Solo orquestan services.
5. **Externos (LLM, Meta, Logger, etc.) detrás de interface.** Mock Fase 4-12, real Fase 7+ swap.
6. **Zod validation en boundary.** Services confían input typed. Excepción defensiva: twin-extractor re-parsea schema LLM output (anti-alucinación).
7. **Idempotency end-to-end.** Cada step Inngest re-ejecutable sin side-effects duplicados. Ver `docs/idempotency.md`.
8. **Service-role vs authed clients separados.** `src/server/db/client.ts` expone `serviceRole()` y `authed(jwt)`. Service-role solo en workflows + repos (RLS bypass). Authed solo en `src/app/**` (UI/Server Actions, RLS aplicada). ESLint enforcement vía `eslint-plugin-boundaries` (A7).
9. **Errores tipados.** `DomainError` separa validación, estado, permisos, conflictos, presupuesto, infraestructura y rate limit. Los workflows reintentan `InfraError`/`RateLimitError`; nunca se lanza `Error` plano desde `src/server/**`.
10. **Polling acotado.** Inbox usa una función SQL `security invoker` para traer una cola limitada por sesión; no puede descargar el historial completo en cada refresco.

## Patrones consolidados (post-REPAIR)

### Pattern: pure handler + factory binding

```typescript
// Handler puro testable
export async function onMessageReceivedHandler(
  input, deps, step = passthroughStep
): Promise<Result> {
  return step.run("stage-1", () => ...);
}

// Factory que produce InngestFunction con DI
export function makeOnMessageReceivedFn(deps: OnMessageReceivedDeps) {
  return inngest.createFunction(
    { id, triggers: [{ event }] },
    async ({ event, step }) => {
      try {
        return await onMessageReceivedHandler({...}, deps, adaptInngestStep(step));
      } catch (e) {
        if (isNonRetriable(e)) throw new NonRetriableError(...);
        throw e;
      }
    },
  );
}
```

Tests usan handler directo + passthrough step. Real Inngest binding wireup en `factory().route.ts`.

### Pattern: interface + Noop default

```typescript
export interface SomeExternal {
  doThing(): Promise<X>;
}

export class NoopSomeExternal implements SomeExternal {
  async doThing() {
    return defaultValue;
  }
}

export class DefaultService {
  constructor(
    private deps: Repos,
    private ext: SomeExternal = new NoopSomeExternal(),
  ) {}
}
```

Tests existentes no inyectan ext → Noop default. Tests específicos del feature inyectan FakeExternal. Real impl Fase 7+ swap.

### Pattern: Domain error → Inngest mapping

```typescript
// src/lib/errors.ts
export abstract class DomainError extends Error { ... }
export class NotFoundError, ConflictError, ValidationError, PermissionDeniedError {}
export function isNonRetriable(e): boolean { ... }

// Inngest binding
catch (e) {
  if (isNonRetriable(e)) throw new NonRetriableError(e.message, { cause: e });
  throw e; // retry
}
```

NotFound/Validation/PermissionDenied → NonRetriable. Conflict → retry-able (race conditions tolerables).

### Pattern: SessionLock single-flight

```typescript
async extract(input) {
  return this.lock.withLock(`twin:${input.sessionId}`, () => this.runExtraction(...));
}
```

Real impl Postgres advisory lock — multi-process safe en Vercel serverless.

### Pattern: Transactional outbox + optimistic dispatch (B2)

```typescript
// EventBusService.publish:
//   1. outbox.enqueue(event)        // durable record in DB
//   2. try inngest.send(event)      // optimistic direct dispatch
//      → success: outbox.markSent
//      → failure: outbox.markFailedAttempt (sigue pending)
//   3. Cron *1m dispatch-outbox-events.cron poll pending → retry
async publish(event) {
  const row = await this.outbox.enqueue({
    event_name: event.name,
    event_data: event.data,
    event_id: event.id ?? null,
  });
  try {
    await this.inngestEmit(event);
    await this.outbox.markSent(row.id);
  } catch (e) {
    await this.outbox.markFailedAttempt(row.id, errMsg);
    // Cron retries
  }
}
```

Garantía: **at-least-once delivery**. State consistency entre DB write y workflow event aunque Inngest down al momento del emit. Detalle → `docs/idempotency.md` § outbox.

## Flujo webhook → reply

```
1. Meta envía POST → /api/webhooks/meta/route.ts
2. verifyMetaSignature (HMAC-SHA256 + timingSafeEqual)
3. parseMetaWebhook → ParsedMessage[]
4. Por cada parsed: inngest.send("meta/message.received", { parsed })
5. Response 200 inmediato (<5s SLA Meta).
   ↓
6. Inngest dispatcher → makeOnMessageReceivedFn → 10 steps memoizables:
   dedup → resolve-lead → upsert-conv → resolve-session → record-inbound →
   (short-circuit dup) → classify → build-turn → respond →
   (skip send si handoff) → emit-turn → emit-handoff-eval
   ↓
7. emit "lead-session/turn.completed" → makeUpdateLeadTwinFn
   ↓
   - twin-extractor.extract (con SessionLock + LLM generateObject)
   - sessions.update con LeadTwinUpdate patch
   - shallow merge extras

8. emit "lead-session/auto-handoff.evaluate" → makeAutoHandoffFn
   ↓
   - handoff.evaluate(recentClassifications)
   - if pausar → handoff.pause(sessionId, motivo)
```

## AI SDK integration (Fase 7 wireup)

Interfaces ya definidas. Real impls usan Vercel AI SDK:

```typescript
import { generateObject, streamText, tool, stepCountIs } from "ai";
import { openai } from "@ai-sdk/openai";

// IntentClassifierLLM
const result = await generateObject({
  model: openai("gpt-4o-mini"),
  schema: IntentClassificationSchema,
  prompt: buildClassifyPrompt(text, candidates),
});

// TwinExtractorLLM
const result = await generateObject({
  model: openai("gpt-4o-mini"),
  schema: LeadTwinUpdateSchema,
  prompt: buildExtractPrompt(current, conversationTurn),
});

// AgentLLM
const result = await streamText({
  model: openai("gpt-4o"),
  system: AGENT_SYSTEM,
  messages: buildMessages(session, turn, classification),
  tools: {
    buscar_repuesto: tool({
      inputSchema: BuscarRepuestoInputSchema,
      execute: input.tools.buscar_repuesto,
    }),
  },
  stopWhen: stepCountIs(5),
});
return { text: result.text, toolCalls: result.toolCalls };
```

## Supabase Realtime (Slice 2)

Inbox UI subscribe a:

- `mensajes` (new row WHERE conversacion_id IN visible convs) → push msg al ChatThread.
- `lead_session` (UPDATE) → push twin update al TwinPanel.
- `conversaciones` (UPDATE ultima_actividad_at) → reorder ChatList.

## Errores y retries

Ver `docs/failure-modes.md` para tabla completa por stage.

## Costos

Ver `docs/cost-budget.md` para targets + wireup CostTracker.

## Idempotency

Ver `docs/idempotency.md` para keys por op.
