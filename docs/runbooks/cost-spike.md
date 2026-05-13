# Runbook: LLM Cost Spike

> Trigger: alert `llm_daily_spend_usd >= 80%` daily cap o `>= 100%` (kill switch fired).

---

## 1. Detección

| Signal                           | Source                |
| -------------------------------- | --------------------- |
| Slack alert `cost-cap-warn`      | `#crm-alerts` channel |
| `BudgetExceededError` en logs    | Vercel Log Drains     |
| Cost dashboard `/ajustes/costos` | spend hoy > esperado  |

---

## 2. Diagnóstico inmediato (5 min)

### Verify scope

```sql
-- Spend último día por workflow
SELECT workflow, SUM(usd) total_usd, COUNT(*) calls
FROM cost_records
WHERE day = CURRENT_DATE
GROUP BY workflow
ORDER BY total_usd DESC;
```

### Top sessions

```sql
-- Top 20 sessions costosas hoy
SELECT lead_session_id, SUM(usd) total_usd, COUNT(*) llm_calls
FROM cost_records
WHERE day = CURRENT_DATE AND lead_session_id IS NOT NULL
GROUP BY lead_session_id
ORDER BY total_usd DESC
LIMIT 20;
```

### Tool execution anomaly

```sql
-- Tool calls per minute último hour
SELECT date_trunc('minute', created_at) min, tool_name, COUNT(*)
FROM tool_executions
WHERE created_at > now() - interval '1 hour'
GROUP BY 1, 2
ORDER BY 1 DESC;
```

---

## 3. Causas comunes

| Causa                                                     | Diagnosis hint                                                 | Fix                                                                      |
| --------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Agente loop infinito (multi-step retries)                 | `tool_executions` count >50 per sesión                         | Reducir `stopWhen: stepCountIs(5)` → 3. Pause sesión via admin UI.       |
| Lead malicioso prompt injection                           | Sesión con 100+ msgs en horas. `intent_nombre = null` repetido | Pause agente via admin UI. Block lead Meta API.                          |
| Cron summarize loop (R10)                                 | `workflow='summarize-conversation'` spike                      | Verify threshold setting (`DEFAULT_SUMMARY_THRESHOLD` = 20).             |
| Rule engine bypass (todos a LLM)                          | `workflow='intent-classify'` spike + `rule_executions` count 0 | Verify reglas activas. Check `reglas WHERE activa=true`.                 |
| LLM provider issue (timeouts → retries)                   | Slack alert `llm_respond_latency_p95 > 5s` simultáneo          | Switch provider via Vercel AI SDK (e.g. Anthropic fallback Slice 1 7.5). |
| Pricing update OpenAI no reflejado en `CostTrackerConfig` | Spend desproporcional vs calls count                           | Update `PRICING` table en `docs/cost-budget.md` + redeploy.              |
| Cap config wrong (cap más bajo que real necesidad)        | Cap fires con volumen razonable                                | Re-baseline cap. Si producción real-traffic > pilot tier, upgrade tier.  |

---

## 4. Mitigation steps

### Inmediato (<10 min)

1. **Si kill switch fired (`BudgetExceededError`):** sistema ya pausa LLM calls automatic. Verificar logs.
2. **Si solo warning (80%):** Slack notify admin. Decidir acción manual.
3. **Pause feature flag `ai_agent.enabled`** vía Edge Config si critical (Slice 1 7.7):
   ```bash
   vercel env pull
   # Edit Edge Config feature flag ai_agent.enabled = false
   ```
   Esto pausa LLM en agente; reglas IF/THEN siguen respondiendo.

### Corto plazo (<1h)

4. **Identify top contributor session.** Ver query SQL § 2.
5. **Si lead malicioso:** pause sesión + handoff humano vía admin UI. Document `admin_actions`.
6. **Si bug rule engine:** rollback deploy hasta fix.
7. **Si pricing OpenAI cambio:** update `docs/cost-budget.md` + redeploy.

### Mediano plazo (<24h)

8. **Raise daily cap** si demand legítima:
   ```bash
   vercel env add LLM_DAILY_CAP_USD 200 production
   vercel --prod redeploy
   ```
9. **Postmortem** (template `docs/postmortem-template.md` Slice 4).
10. **Update SLO** si recurrente.

---

## 5. Communication

| Stakeholder         | Channel                 | Cuando notify                   |
| ------------------- | ----------------------- | ------------------------------- |
| Oncall engineer     | Slack DM                | Inmediato (within 5min de page) |
| CRM admin cliente   | Email                   | Si downtime user-facing > 30min |
| Tech lead + product | Slack `#crm-alerts`     | Inmediato                       |
| Cliente empresa     | Account manager → email | Si downtime > 1h o data impact  |

---

## 6. Prevention

- **CostTracker baseline daily monitoring.** Slack alerts 80% cap.
- **Rule engine coverage > 60% intent matches** (cron weekly review).
- **Sesión active timeout:** auto-close sesiones sin actividad >24h (Slice 4 cron).
- **Tool call max per session limit:** `stopWhen: stepCountIs(5)` en agente.
- **Quarterly:** review pricing OpenAI vs config.
