# SLO + SLI definitions

> Service Level Objectives + Indicators. B5 baseline pilot tier. Re-tune post-launch con data real producción.

---

## 1. Filosofía SLO

- **SLI** = qué medimos (latencia P95, error rate, uptime).
- **SLO** = target sobre SLI (P95 < 3s en 30-day rolling window).
- **Error budget** = 100% - SLO. Si SLO = 99.5% uptime, error budget = 0.5% = ~3.5h/mes downtime aceptable.
- **Burn rate alerts:** alertar cuando error budget consume >2× rate esperado (e.g. 2h downtime en 1 día = burn rate 13.7× normal).

Para pilot tier: SLO **conservadores** (99.5% en lugar de 99.9%). Empresas medianas Latam aceptan ventanas mantenimiento + degradación corta.

---

## 2. SLI catalog

### Availability

| SLI                        | Definición                                                     | Source                                |
| -------------------------- | -------------------------------------------------------------- | ------------------------------------- |
| `webhook_meta_uptime`      | % requests `/api/webhooks/meta` con 2xx response               | Vercel Logs HTTP status codes         |
| `inngest_functions_uptime` | % Inngest function runs success (no NonRetriable + not failed) | Inngest dashboard / API               |
| `supabase_db_uptime`       | % Supabase Postgres queries < timeout                          | Supabase metrics + Vercel cold starts |

### Latency

| SLI                            | Definición                                                         | Source                            |
| ------------------------------ | ------------------------------------------------------------------ | --------------------------------- |
| `webhook_response_latency_p95` | Webhook Meta endpoint response time P95                            | Vercel function metrics           |
| `webhook_to_reply_latency_p95` | Tiempo desde webhook receive hasta `metaApi.sendOutbound` complete | Custom span via logger + tracing  |
| `inngest_function_latency_p95` | P95 ejecución `on-message-received` end-to-end                     | Inngest dashboard per function    |
| `llm_classify_latency_p95`     | P95 `intent-classifier.classify` LLM call                          | Custom span + cost-tracker        |
| `llm_respond_latency_p95`      | P95 `ai-agent.respond` LLM call                                    | Custom span + cost-tracker        |
| `twin_extract_latency_p95`     | P95 `twin-extractor.extract` con lock contention                   | Custom span + SessionLock metrics |

### Correctness

| SLI                                    | Definición                                                        | Source                               |
| -------------------------------------- | ----------------------------------------------------------------- | ------------------------------------ |
| `inbound_dedup_correctness`            | % inbound messages persistidos sin duplicate (UNIQUE constraints) | Postgres logs + admin queries        |
| `outbound_idempotency_correctness`     | % outbound mensajes 1:1 con inbound (no doble envío)              | `mensajes.idempotency_key` UNIQUE    |
| `outbox_eventually_sent_pct`           | % event_outbox rows con `status='sent'` < 5min post-create        | DB query                             |
| `merge_candidates_false_positive_rate` | % approved merges revertidos por admin                            | `admin_actions` + `merge_candidates` |

### Cost

| SLI                        | Definición                                     | Source                               |
| -------------------------- | ---------------------------------------------- | ------------------------------------ |
| `llm_daily_spend_usd`      | Suma total `cost-tracker` records día actual   | CostTracker `getDailySpendUsd`       |
| `llm_per_conversation_avg` | LLM cost promedio por sesión cerrada (last 7d) | Aggregate cost_records by session_id |
| `llm_cap_proximity_pct`    | spend actual / daily cap                       | CostTracker comparison               |

---

## 3. SLO targets (pilot tier)

| SLO                                        | Target                            | Window         | Justificación                                      |
| ------------------------------------------ | --------------------------------- | -------------- | -------------------------------------------------- |
| **`webhook_meta_uptime`**                  | **99.5%**                         | 30-day rolling | Meta retries dentro 24h. <0.5% downtime tolerable. |
| **`webhook_response_latency_p95`**         | **< 500ms**                       | 30-day rolling | Meta SLA webhook ≤20s. Buffer amplio.              |
| **`webhook_to_reply_latency_p95`**         | **< 3s**                          | 30-day rolling | UX lead: respuesta percibida "rápida".             |
| **`inngest_functions_uptime`**             | **99%**                           | 30-day rolling | Inngest retries reducen impact. Free→Hobby tier.   |
| **`supabase_db_uptime`**                   | **99.9%**                         | 30-day rolling | Supabase Pro SLA 99.9%.                            |
| **`llm_classify_latency_p95`**             | **< 1s**                          | 30-day rolling | GPT-4o-mini fast model.                            |
| **`llm_respond_latency_p95`**              | **< 5s**                          | 30-day rolling | GPT-4o quality model. Stream mejora percepción.    |
| **`outbox_eventually_sent_pct`**           | **99.9%**                         | 7-day rolling  | At-least-once delivery hard requirement.           |
| **`llm_daily_spend_usd`**                  | **<= $50** dev / **<= $200** prod | daily          | Cap configurable. Kill switch en 100%.             |
| **`merge_candidates_false_positive_rate`** | **< 5%**                          | 30-day rolling | Heurística post-tune Slice 4.                      |

---

## 4. Alert thresholds + burn rate

### Critical (page oncall)

- `webhook_meta_uptime` < 99% (rolling 1h) → page.
- `llm_daily_spend_usd` ≥ 100% cap → page + auto kill switch.
- `outbox_eventually_sent_pct` < 95% (rolling 1h) → page.
- `supabase_db_uptime` < 99% (rolling 5min) → page.

### Warning (Slack notification)

- `webhook_meta_uptime` < 99.5% (rolling 24h) → warn.
- `webhook_to_reply_latency_p95` > 3s (rolling 1h) → warn.
- `llm_daily_spend_usd` ≥ 80% cap → warn.
- `outbox_eventually_sent_pct` < 99% (rolling 24h) → warn.
- `inngest_functions_uptime` < 99% (rolling 24h) → warn.

### Info (log only)

- `webhook_response_latency_p95` > 300ms (rolling 5min) → log.
- `merge_candidates` pending count > 50 → log (UI admin review).

---

## 5. Alert canal

**Pilot tier default: Slack** (free tier 10K msgs/mes + native incoming webhooks + smartphone push).

**Alternativas documentadas:**

| Canal               | Pro                                        | Con                                  | Cost (pilot tier)  |
| ------------------- | ------------------------------------------ | ------------------------------------ | ------------------ |
| **Slack** (default) | Mensajería team + smartphone push native   | Requiere workspace + invitar admin   | Free 10K msgs/mes  |
| Discord             | Free unlimited                             | Menos profesional B2B                | Free               |
| Email vía Resend    | No requiere workspace                      | Latencia notificación + filtros spam | Free 3K emails/mes |
| PagerDuty           | Industria SRE oncall rotation              | Pricing $$+ (~$50/user/mes)          | Overkill pilot     |
| Sentry              | Errores capturados automático + dashboards | Otro vendor + cost                   | Free 5K events/mes |

**Setup Slack (recomendado):**

1. Crear workspace Slack (si no existe) o canal dedicado `#crm-alerts`.
2. Add app Incoming Webhooks → generate URL.
3. Env var `SLACK_WEBHOOK_URL` (server-only, no `NEXT_PUBLIC_`).
4. Helper `src/lib/alerts/slack.ts` (Slice 1 7.7).
5. Test: send manual alert vía script.

**Setup alternativo Discord/email:** mismo pattern, swap helper.

---

## 6. Dashboards futuro

### Pilot tier (Slice 1 7.7)

- Cost dashboard `/ajustes/costos` admin-only. Spend hoy/ayer/últimos 7d + breakdown workflow + top sessions.
- Supabase dashboard nativo (DB metrics + slow queries).
- Inngest dashboard nativo (function runs + retries + latency).
- Vercel dashboard nativo (deployments + function metrics + bandwidth).

### Mid-market tier (post-pilot)

- Custom Grafana / Vercel Observability Plus para business metrics.
- Datadog / New Relic APM (opcional).
- Custom Realtime dashboard inbox UX metrics.

---

## 7. SLO review cadence

- **Weekly:** review actual vs target (during pilot Y0).
- **Monthly:** adjust targets based on real data (post-pilot Y1+).
- **Quarterly:** re-baseline based on growth.
- **Post-incident:** check if SLO violated + update if needed.

---

## 8. Error budget policy

Si error budget consume rate > 2× expected (e.g. consume 50% del budget mensual en 1 semana):

1. **Freeze feature releases.** Solo bug fixes + reliability mejoras.
2. **Postmortem** del incident (template `docs/postmortem-template.md` — Slice 4).
3. **Re-assess SLO target** si recurrente: indica spec inalcanzable con stack actual.

Si error budget no consume durante 3+ meses sostenido:

1. **Considerar relax SLO** o **aumentar feature velocity** (otherwise over-engineering observability).
