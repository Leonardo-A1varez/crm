# Cost Budget

> LLM cost design + alertas + kill switch. Implementado por `CostTracker` (R6) + feature flags (R7).

## Targets

| Métrica                            | Target                             | Caja                                                                                                        |
| ---------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Cost per conversation cerrada      | ≤ $0.05                            | Mid-conv: classify ($0.001) + respond ($0.02-$0.04) + twin extract ($0.005) + posible summary cron ($0.005) |
| Daily total                        | ≤ $50 (dev/staging), ≤ $300 (prod) | 1000 leads/sem × $0.05 ≈ $7/día base. 6x headroom para retries + batch detection.                           |
| Daily HARD CAP                     | $100 dev / $500 prod               | Trigger NonRetriable kill switch. Alert push.                                                               |
| Cost per webhook (avg)             | ≤ $0.01                            | Muchos no llegan a LLM (rule match + dedup)                                                                 |
| Cost detect-intents.batch (weekly) | ≤ $1                               | Procesa N sesiones cerradas semana.                                                                         |

## Pricing tables

Por config `CostTrackerConfig.pricing`:

```typescript
const PRICING: PricingTable = {
  "gpt-4o": { inputUsdPer1M: 2.5, outputUsdPer1M: 10 },
  "gpt-4o-mini": { inputUsdPer1M: 0.15, outputUsdPer1M: 0.6 },
  // Fase 7 cargar más models dinámicamente
};
```

Updates: pricing OpenAI cambia ~trimestralmente. Pull updates manual o (Fase 7 deluxe) fetch from OpenAI pricing endpoint.

## Wireup pattern (Fase 7)

Real LLM impls wrap SDK calls:

```typescript
export class OpenAIIntentClassifier implements IntentClassifierLLM {
  constructor(
    private openai: OpenAI,
    private cost: CostTracker,
    private model = "gpt-4o-mini",
  ) {}

  async classify(input: IntentClassifierInput): Promise<IntentClassification> {
    if (await this.cost.exceedsCap()) {
      throw new BudgetExceededError("daily LLM budget excedido");
    }
    const response = await generateObject({
      model: openai(this.model),
      schema: IntentClassificationSchema,
      // ...
    });
    await this.cost.record({
      model: this.model,
      inputTokens: response.usage.inputTokens,
      outputTokens: response.usage.outputTokens,
      workflow: "intent-classify",
    });
    return response.object;
  }
}
```

**`BudgetExceededError`:** Fase 7. Extender DomainError + agregar a `isNonRetriable()` true. Maps a Inngest `NonRetriableError`.

## Alert thresholds

| Threshold                 | Acción                                                               |
| ------------------------- | -------------------------------------------------------------------- |
| 50% daily cap             | Log warn                                                             |
| 80% daily cap             | Push notification admin (Fase 7)                                     |
| 100% daily cap            | Kill switch — `exceedsCap()` true → LLM calls fail-fast NonRetriable |
| 150% daily cap (override) | Si admin sube cap manual, log info "cap raised" + retry budget       |

## Day key

UTC `YYYY-MM-DD`. Simple, evita timezone complexity. Argentina (UTC-3) day rollover @ 9 PM local — admin debe saber. Si problema, agregar `timezone` config Fase 7.

## Per-session cost tracking

`UsageRecord.sessionId` opcional. Cost per session computable via:

```sql
SELECT lead_session_id, SUM(usd)
FROM cost_records
WHERE day = '2026-05-12'
GROUP BY lead_session_id
ORDER BY SUM(usd) DESC
LIMIT 20;
```

Identifica sessions costosas (loop infinito agente, mega-context, etc).

## Per-workflow cost tracking

`UsageRecord.workflow` opcional:

- `intent-classify`
- `twin-extract`
- `agent-respond`
- `detect-intents-batch`
- `summarize-conversation`

Aggregate por workflow detecta cost drivers.

## Persistence Fase 7

`InMemoryCostTracker` para tests. Real impl:

**Opción A — Vercel KV (Redis):**

```typescript
class VercelKvCostTracker implements CostTracker {
  async record(u) {
    const day = dayKey(u.at ?? new Date());
    const usd = computeUsd(u);
    await kv.hincrbyfloat(`cost:${day}`, "total", usd);
    await kv.hincrbyfloat(`cost:${day}`, `model:${u.model}`, usd);
    await kv.hincrbyfloat(`cost:${day}`, `workflow:${u.workflow ?? "unknown"}`, usd);
    if (u.sessionId) {
      await kv.hincrbyfloat(`cost:${day}`, `session:${u.sessionId}`, usd);
    }
  }
  async getDailySpendUsd(day) {
    return parseFloat((await kv.hget(`cost:${dayKey(day)}`, "total")) ?? "0");
  }
}
```

Atomic increments. TTL 90d para auto-purge.

**Opción B — Supabase `cost_records` table:**

```sql
CREATE TABLE cost_records (
  id uuid PK,
  day date,
  model text,
  workflow text,
  session_id uuid nullable,
  input_tokens int,
  output_tokens int,
  usd numeric(10,4),
  created_at timestamptz
);
CREATE INDEX ON cost_records (day);
CREATE INDEX ON cost_records (session_id);
```

Más flexible para queries analytics. Slower writes.

**Recomendación:** KV para hot-path (record + check). Postgres replicate weekly via Inngest cron para analytics persistente.

## Cost dashboard (Slice 1 sub-paso 7.14)

UI mínima:

- `/ajustes/costos` admin-only.
- Spend hoy / ayer / últimos 7d.
- Breakdown por workflow + model.
- Top 10 sessions costosas.
- Daily cap config (UI updates env var or KV key).

## Cost optimization patterns

1. **Rule engine prevalece sobre LLM.** ~70% turnos comunes (saludo, pide precio común, objeción típica) deberían matchear regla. Solo edge cases caen a LLM.
2. **Model selector por context.** Twin extract = `gpt-4o-mini` (cheap, schema-constrained). Agent respond = `gpt-4o` (calidad). Intent classify = `gpt-4o-mini`. Tradeoffs cuantificables semanalmente.
3. **Context window minimization.** R10 rolling summary reemplaza msgs antiguos. Si convo crece >30 turns, savings dramáticos.
4. **Caching de prompts comunes.** Vercel AI SDK + OpenAI prompt caching beta — invalidación nula para system prompts repetidos.
5. **Tool use minimization.** Catalog tool barato pero `tool_executions` row + LLM tool call overhead = $0.001+. Si rule engine puede pre-responder con stock genérico, ahorrar.

## Postmortem template (cost spike)

```
Date: YYYY-MM-DD
Spend: $X (esperado $Y, exceso Z%)
Top contributors:
  - workflow=X: $A
  - session=B (largo, runaway agente)
Root cause:
Action:
Prevention:
```
