# Workflows Inngest

> Fuente de verdad: `src/inngest/functions/index.ts` y `src/inngest/events.ts`. Estado verificado el 2026-08-13: **12 funciones registradas** y **12 tipos de evento**.

## Patrón de implementación

Cada workflow separa:

- handler puro, testeable con repositorios y servicios inyectados;
- factory `make*Fn(deps)`, que enlaza el handler con Inngest;
- composición real en `src/inngest/bootstrap.ts`;
- registro único mediante `makeCrmInngestFunctions(deps)`.

Los errores de dominio no reintentables se convierten en `NonRetriableError`. Los errores de infraestructura y rate limit permanecen reintentables. Las operaciones con efectos externos usan keys explícitas de evento, `step.run` o constraints de base según el caso.

## Funciones registradas

### 1. `on-message-received`

- Archivo: `on-message-received.ts`.
- Trigger: `meta/message.received`.
- Concurrencia: `limit: 1` por `event.data.parsed.meta_user_id`.
- Acción: deduplica el entrante, resuelve lead/conversación/sesión, persiste el mensaje, cancela recordatorios vivos, aplica horario y guardas, clasifica intent, ejecuta regla o LLM, envía la respuesta y publica eventos posteriores.
- Efectos derivados: `lead/created`, `lead-session/turn.completed` y `lead-session/auto-handoff.evaluate`.
- Idempotencia saliente: `out:<meta_message_id_entrante>`; `sendOutbound` reserva la fila antes de llamar a Meta.

### 2. `on-status-received`

- Archivo: `on-status-received.ts`.
- Trigger: `meta/status.received`.
- Acción: aplica en `mensajes` la progresión de entrega reportada por Meta.
- Un `meta_message_id` desconocido termina como no-op exitoso; puede corresponder a un envío originado fuera del CRM.

### 3. `update-lead-twin`

- Archivo: `update-lead-twin.ts`.
- Trigger: `lead-session/turn.completed`.
- Acción: ejecuta `TwinExtractorService`, actualiza la ficha estructurada y registra procedencia del mensaje origen cuando está disponible.

### 4. `detect-intents.batch`

- Archivo: `detect-intents.batch.ts`.
- Triggers: `intents/detect.batch.requested` y cron `0 3 * * 0`.
- Acción: toma sesiones cerradas de los últimos siete días, detecta intents con LLM y crea propuestas inactivas que todavía no existen.

### 5. `auto-handoff`

- Archivo: `auto-handoff.ts`.
- Trigger: `lead-session/auto-handoff.evaluate`.
- Acción: evalúa clasificaciones recientes usando la configuración activa. Si supera el umbral, transiciona la sesión mediante `HandoffService` con motivo `unknown_intents`, pausa la IA y solicita aviso al cliente.
- Idempotencia de transición: `auto-handoff:<event.id>` como `source_event_key`.

### 6. `purge-old-sessions`

- Archivo: `purge-old-sessions.cron.ts`.
- Triggers: `sessions/purge.requested` y cron `0 4 * * *`.
- Acción: purga sesiones cerradas hace más de 29 días mediante el servicio que limpia Storage y luego elimina la sesión; los mensajes relacionados caen por `ON DELETE CASCADE`.

### 7. `reactivation-predictor`

- Archivo: `reactivation-predictor.cron.ts`.
- Triggers: `leads/reactivation.requested` y cron `0 9 * * 1`.
- Acción: busca sesiones perdidas dentro de la ventana configurada, respeta cooldown persistido en `reactivation_dispatches` y envía la plantilla correspondiente.
- Idempotencia del envío: `react-<sessionId>`; el historial de dispatches evita spam entre ejecuciones semanales.

### 8. `recordatorio-seguimiento`

- Archivo: `recordatorio-seguimiento.ts`.
- Trigger: `lead-session/recordatorio.programado`.
- Acción: duerme con `sleepUntil(recordarAt)` y marca el recordatorio como `avisado` si la fila continúa viva y conserva la misma fecha.
- Cancelación: `lead-session/recordatorio.cancelado` solo cancela cuando coinciden `recordatorioId` **y** el `recordarAt` anterior. Así una cancelación vieja no alcanza una reprogramación nueva.
- Segunda barrera: `marcarAvisado(..., esperadoRecordarAt)` compara la fecha persistida en Postgres.
- El callback `avisarAlCliente` no está inyectado deliberadamente: hoy el vencimiento eleva la conversación en el Inbox, pero no envía mensajes automáticos al cliente.

### 9. `handoff-notification`

- Archivo: `handoff-notification.ts`.
- Trigger: `lead-session/handoff.notification.requested`.
- Acción: verifica que la sesión exista y siga pausada, elige la conversación más reciente y envía `plantilla_escalado` como mensaje de sistema.
- Idempotencia: `handoff-notice:<handoffEventId>` en `mensajes.idempotency_key` y step `handoff-notice-<día>-<handoffEventId>`.
- No-envíos válidos: `session_missing`, `session_resumed` y `conversation_missing`.

### 10. `detect-merge-candidates-per-lead`

- Archivo: `detect-merge-candidates.ts`.
- Trigger: `lead/created`.
- Acción: compara el lead nuevo contra la ventana reciente y registra candidatos de merge no existentes.

### 11. `detect-merge-candidates-global`

- Archivo: `detect-merge-candidates.ts`.
- Triggers: `merge-candidates/detect.requested` y cron `0 5 * * *`.
- Acción: reescanea los leads de la ventana de siete días para recuperar carreras que el handler por lead pudo perder.

### 12. `dispatch-outbox-events`

- Archivo: `dispatch-outbox-events.cron.ts`.
- Triggers: `outbox/dispatch.requested` y cron `*/1 * * * *`.
- Acción: toma hasta 50 filas pendientes del outbox, emite cada evento y marca éxito o fallo por fila.
- Semántica: entrega al menos una vez; el consumidor debe conservar su propia idempotencia.

## Catálogo de eventos

| Evento                                        | Productor principal     | Consumidor                 |
| --------------------------------------------- | ----------------------- | -------------------------- |
| `meta/message.received`                       | webhook Meta            | `on-message-received`      |
| `meta/status.received`                        | webhook Meta            | `on-status-received`       |
| `lead-session/turn.completed`                 | pipeline entrante       | `update-lead-twin`         |
| `lead-session/auto-handoff.evaluate`          | pipeline entrante       | `auto-handoff`             |
| `lead-session/handoff.notification.requested` | outbox del handoff      | `handoff-notification`     |
| `intents/detect.batch.requested`              | manual/ops              | `detect-intents.batch`     |
| `sessions/purge.requested`                    | manual/ops              | `purge-old-sessions`       |
| `leads/reactivation.requested`                | manual/ops              | `reactivation-predictor`   |
| `lead-session/recordatorio.programado`        | Inbox service           | `recordatorio-seguimiento` |
| `lead-session/recordatorio.cancelado`         | Inbox/pipeline entrante | `cancelOn` de recordatorio |
| `lead/created`                                | pipeline entrante       | detector por lead          |
| `merge-candidates/detect.requested`           | manual/ops              | detector global            |
| `outbox/dispatch.requested`                   | manual/ops              | dispatcher del outbox      |

## Dependencias de composición

`makeCrmInngestFunctions` recibe exactamente estas doce dependencias agrupadas:

```ts
export interface CrmInngestDeps {
  onMessageReceived: OnMessageReceivedDeps;
  onStatusReceived: OnStatusReceivedDeps;
  updateLeadTwin: UpdateLeadTwinDeps;
  detectIntentsBatch: DetectIntentsBatchDeps;
  autoHandoff: AutoHandoffDeps;
  purgeOldSessions: PurgeOldSessionsDeps;
  reactivationPredictor: ReactivationPredictorDeps;
  recordatorioSeguimiento: RecordatorioSeguimientoDeps;
  handoffNotification: HandoffNotificationDeps;
  detectMergeCandidatesPerLead: DetectMergeCandidatesPerLeadDeps;
  detectMergeCandidatesGlobal: DetectMergeCandidatesGlobalDeps;
  dispatchOutboxEvents: DispatchOutboxEventsDeps;
}
```

No duplicar esta lista en otro bootstrap: agregar una función exige actualizar el índice, el catálogo de eventos y el smoke que afirma el total.

## Desarrollo y observabilidad

- App: `node node_modules/next/dist/bin/next dev -p 3001`.
- Inngest local: el script `inngest:dev` apunta a `http://localhost:3001/api/webhooks/inngest`.
- `INNGEST_DEV=true` mantiene los eventos en el dev server; una key dummy contra Cloud devuelve 401.
- Producción usa `PinoLogger`; desarrollo usa `ConsoleLogger`, seleccionados por `getLogger(env)`.
- OTel instrumenta los caminos principales. Vercel Log Drains y observación productiva siguen pendientes del deploy.

## Verificación pendiente

- Observar en el dashboard local una reprogramación completa de recordatorio y confirmar el `cancelOn` entre steps.
- Los tests unitarios cubren handlers y replay; los contratos contra Postgres siguen congelados hasta disponer de un proyecto Supabase exclusivo para tests.
