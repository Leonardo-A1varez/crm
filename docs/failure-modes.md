# Failure Modes

> Tabla por workflow → modo de falla → comportamiento esperado (retry / skip / alert / compensate). Referenciada en Inngest binding via `isNonRetriable()` mapping.

## Convenciones

- **Retry** = Inngest reintenta automáticamente con backoff exponencial. Step memoizado preserva work previa.
- **NonRetriable** = `NonRetriableError` lanzada. Inngest marca run como failed, no reintenta.
- **Skip** = handler short-circuit (sin throw). Run completa con result indicando skip.
- **Alert** = log nivel error + (Fase 7) push notification a admin.
- **Compensate** = ejecutar rollback explícito (raro, mostrado donde aplica).

## Mapping Domain errors → Inngest

`src/lib/errors.ts` define jerarquía. `isNonRetriable()` mapea:

| DomainError                                   | Retry?       | Razón                                                                                           |
| --------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------- |
| `NotFoundError`                               | NonRetriable | Recurso falta. Reintentar no cambia.                                                            |
| `ValidationError`                             | NonRetriable | Input inválido. Reintentar no cambia.                                                           |
| `PermissionDeniedError`                       | NonRetriable | RLS / auth fail. Reintentar no cambia.                                                          |
| `IllegalStateError`                           | NonRetriable | Estado inconsistente (e.g., close con resultado distinto). Bug del caller, retry repite el bug. |
| `ConflictError`                               | Retry        | Race condition probable. Reintento puede ganar.                                                 |
| `BudgetExceededError` (A4)                    | NonRetriable | Cap LLM diario excedido. Esperar override admin.                                                |
| Otros (`Error` genérico, network, rate limit) | Retry        | Transient default.                                                                              |

## Workflows

### `on-message-received` (R4 — 10 stages)

| Stage               | Falla típica                                     | Retry?                        | Acción                                                                                                     |
| ------------------- | ------------------------------------------------ | ----------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `dedup`             | DB transient                                     | Retry                         | Idempotente (read-only).                                                                                   |
| `resolve-lead`      | telefono UNIQUE race                             | Retry                         | Race entre 2 webhooks mismo `meta_user_id`. Retry post-loser hace `findByTelefono` → finds row → no crash. |
| `upsert-conv`       | `(canal, thread) ya pertenece a otro lead`       | NonRetriable                  | Conflict cross-lead. Manual investigation (probable merge needed). Alert.                                  |
| `resolve-session`   | partial UNIQUE race                              | Retry                         | Mismo patrón que resolve-lead.                                                                             |
| `record-inbound`    | DB transient                                     | Retry                         | Idempotente via `findByMetaMessageId` dedup.                                                               |
| `classify`          | LLM timeout / network                            | Retry                         | Backoff. Cost tracker pre-check evita budget burn.                                                         |
| `classify`          | LLM budget excedido (Fase 7)                     | NonRetriable                  | `BudgetExceededError`. Run falla. Admin alert.                                                             |
| `build-turn`        | DB transient                                     | Retry                         | Read-only.                                                                                                 |
| `respond`           | LLM timeout                                      | Retry                         | Backoff.                                                                                                   |
| `respond`           | Agent throws                                     | Retry                         | Bug agente. Después N retries → permanent fail + alert.                                                    |
| `send`              | Meta API rate limit                              | Retry                         | Inngest backoff respeta `Retry-After`.                                                                     |
| `send`              | Meta API permanent (token revoked, phone banned) | NonRetriable (Fase 7 mapping) | Alert ops. Manual remediation.                                                                             |
| `send`              | sendOutbound idempotency hit (race)              | Skip                          | `findByIdempotencyKey` retorna existing → no segundo send. Memo OK.                                        |
| `emit-turn`         | Inngest event dispatch fail                      | Retry                         | Transient.                                                                                                 |
| `emit-handoff-eval` | idem                                             | Retry                         | idem.                                                                                                      |

**Pipeline-level (handler try/catch):**

- Cualquier throw no-handled → log `pipeline-error` + propagate. Inngest aplica retry o NonRetriable según `isNonRetriable(e)`.
- Sesión cerrada mid-pipeline → `ConflictError` desde agent/twin → retry (race poco probable; eventually consistent OK).

### `update-lead-twin`

| Falla                                                              | Retry?          | Acción                                                                                      |
| ------------------------------------------------------------------ | --------------- | ------------------------------------------------------------------------------------------- |
| Sesión no encontrada                                               | NonRetriable    | `NotFoundError`. Race orphan event. Skip.                                                   |
| Sesión cerrada                                                     | Skip            | Service short-circuits sin throw.                                                           |
| LLM `generateObject` Zod parse fail                                | NonRetriable    | `ValidationError`. Defensa anti-alucinación LLM. Alert.                                     |
| LLM network/timeout                                                | Retry           | Backoff.                                                                                    |
| Session lock contention                                            | Retry implícito | `withLock` serializa caller. Tiempo wait determinado por LLM call previo.                   |
| `sessions.update` DB transient                                     | Retry           | Idempotente.                                                                                |
| `sessions.close` mismo resultado/motivo sobre sesión ya cerrada    | Skip (no throw) | Idempotente: repo retorna sesión existente. Retry Inngest seguro.                           |
| `sessions.close` resultado/motivo distinto sobre sesión ya cerrada | NonRetriable    | `IllegalStateError` (`session_already_closed_different`). Bug del caller — no reintentable. |

### `auto-handoff`

| Falla                              | Retry?       | Acción                                                           |
| ---------------------------------- | ------------ | ---------------------------------------------------------------- |
| `handoff.evaluate` (puro)          | N/A          | No fail mode.                                                    |
| `handoff.pause` sesión cerrada     | NonRetriable | `ConflictError` → race con cierre. Skip OK (no pausa needed).    |
| `handoff.pause` sesión inexistente | NonRetriable | Orphan event.                                                    |
| Flag `auto_handoff.enabled=false`  | Skip         | Handler retorna `paused: false, motivo: "desactivado por flag"`. |

### `detect-intents.batch` (cron)

| Falla                      | Retry? | Acción                                                                                                |
| -------------------------- | ------ | ----------------------------------------------------------------------------------------------------- |
| DB query timeout           | Retry  | Backoff.                                                                                              |
| LLM batch detector fail    | Retry  | Backoff. Cost cap potencial trigger.                                                                  |
| `intents.create` duplicado | Skip   | Service checks `findByNombre` antes — race poco probable. Si trigger igual, retry detecta dup y skip. |

### `purge-old-sessions.cron`

| Falla                               | Retry?                       | Acción                                                                                                                                                                         |
| ----------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `listClosedBefore` timeout          | Retry                        | Read-only idempotente.                                                                                                                                                         |
| `purgeSession` callback fail per ID | **Per-ID continue** (Fase 7) | Real impl debe try/catch per session + log + skip. Bulk purge no debe abort por 1 row. **Actualmente:** for-loop crash → retry from start. **TODO Fase 7:** per-row try/catch. |
| Storage cleanup parcial             | Compensate (Fase 7)          | Si DELETE row succeeds pero Storage object delete fails, reschedule via separate cron.                                                                                         |

### `reactivation-predictor.cron`

| Falla                             | Retry?                   | Acción                           |
| --------------------------------- | ------------------------ | -------------------------------- |
| `listClosedBefore` timeout        | Retry                    | Read-only.                       |
| `sendReactivation` callback fail  | Per-ID continue (Fase 7) | Mismo patrón purge.              |
| Flag `reactivation.enabled=false` | Skip                     | Handler retorna `dispatched: 0`. |

### Meta webhook endpoint (HTTP)

| Falla                              | Response               | Acción                                                               |
| ---------------------------------- | ---------------------- | -------------------------------------------------------------------- |
| Signature inválida                 | 401 + log error        | Posible attack. Fase 7: rate-limit IP.                               |
| Body no JSON                       | 400 + log              | Meta retry.                                                          |
| `parseMetaWebhook` returns []      | 200 + log info         | Payload reconocido pero sin mensajes (status update, etc). No error. |
| `inngest.send` fail                | 500 + log error        | Meta retry. Inngest dispatcher down — alert.                         |
| Webhook timeout (Meta espera ≤20s) | Response 200 inmediato | **Always respond 200 ASAP**. Procesamiento async vía Inngest.        |

## Cost overflow

- LLM `tracker.exceedsCap(today)` true → `BudgetExceededError` (Fase 7 — actualmente `ConflictError` o sin guard).
- NonRetriable. Inngest run fails.
- Alert admin via push notification (Fase 7).
- Mitigation: admin sube cap manualmente o desactiva `ai_agent.enabled` flag.

## Crons que pueden coincidir

| Cron                   | Schedule          | Conflict potencial         |
| ---------------------- | ----------------- | -------------------------- |
| purge-old-sessions     | `0 4 * * *`       | None                       |
| detect-intents.batch   | `0 3 * * 0` (dom) | Solo lectura, sin conflict |
| reactivation-predictor | `0 9 * * 1` (lun) | Solo lectura, sin conflict |

Idle period 0-3 AM. Purge antes que cualquier batch para liberar storage.

## Bugs forensics path

| Síntoma                    | Look at                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------ |
| Agente cotizó mal precio   | `tool_executions WHERE lead_session_id = X` → ver args + result                      |
| Lead duplicado en inbox    | `merge_candidates WHERE LEAST(src,dst)=A AND GREATEST(src,dst)=B`                    |
| IA pausada misteriosamente | `admin_actions WHERE action='session.pause_ia' AND entity_id=X`                      |
| Costo LLM disparado        | `cost-tracker.getDailySpendUsd(day)` + log entries `level=info msg=classified` count |
| Mensaje no enviado al lead | log `level=info msg=send-skipped` (handoff) vs `msg=send-out`                        |
