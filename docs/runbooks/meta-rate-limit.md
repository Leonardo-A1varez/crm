# Runbook: Meta API Rate Limit / Quality Drop

> Trigger: error `131005` / `131047` / `131056` Meta. O WABA quality "Yellow"/"Red". O 429 rate limit.

---

## 1. Detección

| Signal                                                                    | Source               |
| ------------------------------------------------------------------------- | -------------------- |
| Error code Meta en `mensajes.metadata`                                    | DB query             |
| Vercel logs `level=error msg=send-out-failed`                             | Vercel Log Drains    |
| [Meta Business Manager → Account Quality](https://business.facebook.com/) | Manual check         |
| Webhook quality drop notification Meta                                    | Email account holder |

---

## 2. Diagnóstico (5 min)

### Recent send failures

```sql
SELECT created_at, metadata->>'error_code' code, metadata->>'error_message' msg, COUNT(*)
FROM mensajes
WHERE direction = 'out'
  AND created_at > now() - interval '1 hour'
  AND metadata->>'error_code' IS NOT NULL
GROUP BY 1, 2, 3
ORDER BY 1 DESC
LIMIT 20;
```

### Quality rating actual

Meta Business Manager → Phone numbers → Quality rating column. Green/Yellow/Red.

### Throughput actual vs cap

```sql
-- Msgs/sec last 10 min
SELECT date_trunc('second', created_at) sec, COUNT(*) cnt
FROM mensajes
WHERE direction = 'out' AND created_at > now() - interval '10 minutes'
GROUP BY 1
ORDER BY 1 DESC;
```

---

## 3. Error code mapping

| Code   | Significado                                   | Acción inmediata                                             |
| ------ | --------------------------------------------- | ------------------------------------------------------------ |
| 131005 | Re-engagement msg out-of-window (no HSM)      | Forzar template HSM o mark lead `requires_template`.         |
| 131016 | Service unavailable                           | Retry backoff Inngest. Sin acción manual.                    |
| 131021 | Recipient incapaz (blocked / opted out)       | Mark lead `blocked` en `meta_user_ids` extras. Stop sending. |
| 131026 | Recipient incapaz general                     | Mark lead `unreachable`.                                     |
| 131031 | Account locked                                | Alert admin + manual Meta Business Manager review.           |
| 131047 | Marketing template 60d-window passed          | Use Utility template fallback.                               |
| 131056 | Account restricted                            | Manual Meta review. Pause sending.                           |
| 132xxx | Template issues (name not exist, format, etc) | Re-sync templates Meta + verify approval status.             |

---

## 4. Quality rating mitigation

### Yellow → Red trajectory

| Quality | Action                                                                                         |
| ------- | ---------------------------------------------------------------------------------------------- |
| Green   | OK. Continue normal ops.                                                                       |
| Yellow  | **Warning.** Pause Marketing templates 24h. Send only Utility + user-initiated replies.        |
| Red     | **Throttled.** Halt all business-initiated. Audit recent templates + block rates. Re-strategy. |
| Flagged | **Account flagged.** Manual Meta review. Possible suspension. Notify clients.                  |

### Common quality drop causes

| Cause                                    | Mitigation                                             |
| ---------------------------------------- | ------------------------------------------------------ |
| Mass marketing template sin user opt-in  | Strict opt-in enforce. Audit recent template sends.    |
| Template content spam-like / promotional | Re-review template content. Submit utility version.    |
| Send rate > tier limit sustained         | Throttle outbound (multi-number load balance Slice 4). |
| Block rate > 2-3% sostenido              | Reducir frequency + improve template content.          |

---

## 5. Mitigation steps

### Inmediato (<5 min)

1. **Si quality drop (Yellow):**
   - Pause `reactivation.enabled` flag vía Edge Config:
     ```
     reactivation.enabled = false
     ```
   - Reactivation cron envía templates marketing → para esos.

2. **Si rate limit 429:**
   - Inngest retries handle automatic.
   - Check phone_number_id tier en Meta Business Manager.
   - Si tier 1 maxed → request upgrade tier 2.

3. **Si quality Red sostenido:**
   - Pause `ai_agent.enabled` + manual handoff humano.
   - Audit recent outbound templates.

### Corto plazo (<1h)

4. **Audit recent template sends:** identify mass sends + revisar opt-in compliance.
5. **Block lead audit:** identify leads que reportaron / bloquearon.
   ```sql
   SELECT lead_id, COUNT(*) errors
   FROM mensajes
   WHERE direction='out' AND metadata->>'error_code' IN ('131021','131026')
   AND created_at > now() - interval '24 hours'
   GROUP BY lead_id
   ORDER BY errors DESC;
   ```
6. **Re-submit templates:** si rejected, revisar content guidelines + re-submit.

### Mediano plazo (<24h)

7. **Multi-number setup (post-pilot):** Si volumen crece, agregar phone_number_id secundario + load balance.
8. **Opt-in audit:** review consent capture flow. Compliance LGPD/Latam.
9. **Postmortem.**

---

## 6. Multi-number load balancing (post-pilot)

Si peak sostenido > 60 msg/sec per número (75% tier 1 cap):

1. Add segundo `phone_number_id` Meta Business Manager.
2. Update `META_WHATSAPP_PHONE_NUMBER_ID` env → multi-number config (JSON array).
3. Service `meta-api` load balance round-robin o per-lead sticky.
4. Test failover si un número degrade.

---

## 7. Communication

| Stakeholder     | Channel             | Trigger                         |
| --------------- | ------------------- | ------------------------------- |
| Oncall          | Slack DM            | Page si quality Red             |
| Tech lead       | Slack `#crm-alerts` | Inmediato si Yellow+            |
| Account manager | Email               | Quality Red > 1h                |
| Cliente empresa | Email               | Quality flagged o downtime ≥ 2h |

---

## 8. Prevention

- **Strict opt-in enforce.** No business-initiated sin opt-in audit trail.
- **Template content review** pre-submit Meta (avoid promotional language en Utility).
- **Block rate monitoring** semanal.
- **CTWA ads para entry points:** evita 24h window restrictions + asegura intent inbound primero.
- **Multi-number readiness** pre-launch tier upgrade.
