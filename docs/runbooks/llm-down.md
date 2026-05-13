# Runbook: LLM Provider Down / Degraded

> Trigger: `llm_classify_latency_p95 > 5s` o `llm_respond_latency_p95 > 10s` sostenido. O 5xx errores OpenAI > 5% rate.

---

## 1. Detección

| Signal                                                 | Source                                  |
| ------------------------------------------------------ | --------------------------------------- |
| Slack alert `llm-latency-warn`                         | `#crm-alerts`                           |
| Vercel logs `error_name=NetworkError` o `TimeoutError` | Vercel Log Drains                       |
| Inngest function retries spike                         | Inngest dashboard `on-message-received` |
| [OpenAI status page](https://status.openai.com)        | Manual check                            |

---

## 2. Diagnóstico (5 min)

### OpenAI status

Check [status.openai.com](https://status.openai.com) — global outage o regional?

### Error sample

```bash
# Vercel CLI logs últimos errors LLM
vercel logs --since 30m --filter 'level=error workflow=intent-classify'
vercel logs --since 30m --filter 'level=error workflow=agent-respond'
```

### Rate limit vs outage

| Error code                  | Significado                                     |
| --------------------------- | ----------------------------------------------- |
| 429 + `rate_limit_exceeded` | Tier limit hit. Backoff retry resuelve.         |
| 429 + `tokens_exceeded`     | Daily token quota cuenta excedida.              |
| 500 / 502 / 503             | Server-side OpenAI issue.                       |
| 401 / 403                   | Credencial inválida o suspended. Manual review. |
| Timeout > 30s               | OpenAI degradado. Check status page.            |

---

## 3. Mitigation steps

### Inmediato (<5 min)

1. **Si OpenAI global outage confirmed:**
   - Inngest functions retry automático (backoff exponencial 4 retries).
   - Rule engine sigue respondiendo intents conocidos sin LLM.
   - Pausar `ai_agent.enabled` flag temporal vía Edge Config (Slice 1 7.7):
     ```
     ai_agent.enabled = false
     ```
   - Esto force handoff a humano para todos los nuevos mensajes que no matcheen reglas IF/THEN.

2. **Si rate limit cuenta:**
   - Upgrade tier OpenAI vía dashboard.
   - O reducir concurrency Inngest (`limit: 1` ya activo per `meta_user_id`).

3. **Si credencial revoked:**
   - Rotate `OPENAI_API_KEY` vía Vercel env.
   - Redeploy.

### Corto plazo (<30 min)

4. **Provider failover (Slice 1 7.5+):** Vercel AI SDK permite swap provider 1 línea. Si OpenAI down sustained, swap a Anthropic:

   ```typescript
   // Before
   const model = openai("gpt-4o-mini");
   // After
   const model = anthropic("claude-3-haiku-20240307");
   ```

   Requiere `ANTHROPIC_API_KEY` env + reinstall `@ai-sdk/anthropic`.

5. **Manual handoff bulk:** admin UI puede pausar todas las sesiones activas → vendedores humanos atienden.

### Mediano plazo (<2h)

6. **Notify clientes.** Email account manager → afectados.
7. **Postmortem** post-outage.
8. **Re-evaluar SLO** `llm_classify_latency_p95` / `llm_respond_latency_p95`.

---

## 4. Provider failover criteria

| Outage duration | Action                                                    |
| --------------- | --------------------------------------------------------- |
| < 5 min         | Inngest retries handle. No intervention.                  |
| 5-30 min        | Slack alert. Monitor. Si crítico → pause `ai_agent` flag. |
| 30 min - 2h     | Consider provider failover (Anthropic via AI SDK swap).   |
| > 2h            | Mandatory failover + notify clientes + postmortem.        |

---

## 5. Communication

| Stakeholder      | Channel             | Trigger                          |
| ---------------- | ------------------- | -------------------------------- |
| Oncall engineer  | Slack DM            | Page si page-level alert fires   |
| Tech lead        | Slack `#crm-alerts` | Inmediato                        |
| Account managers | Email               | Outage > 1h sostenido            |
| Cliente empresa  | Email per account   | Outage > 2h + user-facing impact |

---

## 6. Prevention

- **Multi-provider readiness (Slice 1 7.5):** Vercel AI SDK abstraction permite swap rapido.
- **Rule engine coverage:** ~60-70% intent matches reducen exposición LLM outage.
- **Async pipeline:** Inngest workflows retry automático, lead percibe latencia ligera no error.
- **Quarterly:** test failover drill (chaos engineering minimo).
- **Monitor OpenAI status RSS:** future alert RSS feed integration.
