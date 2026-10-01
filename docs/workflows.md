# Workflows Inngest

> Fuente de verdad: `src/inngest/functions/index.ts` y `src/inngest/events.ts`. Verificado el 2026-09-30 contra el código: **19 funciones registradas** (`makeCrmInngestFunctions`, fijado por `tests/unit/inngest-functions-factory.test.ts`) y **24 tipos de evento** (`grep -c "= eventType(" src/inngest/events.ts`). Esta página detalla las 13 primeras (las anteriores a workflows y difusión); las demás —`workflow-disparar`, `workflow-segmento`, `workflow-programados`, `workflow-inactividad` y `drenar-difusiones`— se describen en `docs/prd-workflows.md` y `docs/prd-workflows-difusion.md`, y `on-operational-received` en `docs/meta-webhook-payloads.md`.

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
- Acción: deduplica el entrante, resuelve lead/conversación/sesión, persiste el mensaje, cancela recordatorios vivos, **descarta el borrador vigente de la conversación** (`invalidar-borrador-previo`), aplica horario y guardas, **decide el modo** (`decidir-modo`: Copiloto, Automático o Fuera de horario, según `agente_config.horario` + `horario_equipo` y `conversaciones.modo_respuesta_override`), clasifica intent, ejecuta regla o LLM y, según el modo, **envía la respuesta por la API (Automático) o la guarda como borrador en `borradores_ia` (Copiloto)**; luego publica eventos posteriores.
- Efectos derivados: `lead/created`, `lead-session/turn.completed` y `lead-session/auto-handoff.evaluate`.
- Idempotencia saliente: `out:<meta_message_id_entrante>`; `sendOutbound` reserva la fila antes de llamar a Meta.
- **Excepción al "en Copiloto no sale nada por la API":** el borrador reemplaza solo la respuesta del agente. Siguen saliendo por la API la confirmación de BAJA, el aviso de escalado (`plantilla_escalado`, vía el handoff del agente: palabras que escalan, cotización sobre el tope y auto-handoff por intents desconocidos) y el de la guarda de descuento (`pausar-por-descuento` con `notifyCustomer`). Son mensajes del sistema, no una respuesta redactada.
- Resiliencia del copiloto: si `invalidar-borrador-previo` falla (por ejemplo, el código desplegado antes que la migración `20260930120000_copiloto.sql`), el turno NO se cae cuando el modo decidido no es Copiloto: se registra `borrador.invalidar_previo_fallo` (sin PII) y sigue. Con Copiloto, `decidir-modo` repite la invalidación y el turno falla en voz alta. Una config memoizada sin `horario_equipo` (corrida en vuelo durante un deploy) se lee como "sin equipo".
- En Copiloto, si `iniciar-borrador` devuelve `obsoleto` (llegó otro entrante) o un `existente` que ya no está `redactando`, el turno termina sin llamar al agente (log `borrador-omitido`): no se paga el LLM para tirar la respuesta.

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

### 13. `copiloto-borrador`

- Archivo: `copiloto-borrador.ts`.
- Trigger: `copiloto/borrador.solicitado` (lo emite `src/server/bootstrap/copiloto-bootstrap.ts` al tocar "Regenerar" o "Reintentar" en la tarjeta del Inbox).
- Concurrencia: `limit: 1` por `event.data.conversacionId`; el RPC `iniciar_borrador_ia` (lock a la conversación) cubre la carrera contra `on-message-received`.
- Acción: valida que el borrador siga vigente (`listo` o `error`) y que su sesión siga activa, arranca uno nuevo con `forzar` (descarta el anterior), reusa la clasificación auditada del turno (o vuelve a clasificar), lee los tramos de "Delegar al agente" vivos, arma el turno con `buildConversationTurn` y llama a `aiAgent.respond` con `soloRedactar` (sin efectos: una escalada no pausa la sesión ni avisa al cliente). `handoff` → borrador en `error` con `ia_no_disponible`; descuento excedido → `error` con `descuento_excedido`; fallo del modelo → `error` con `llm_error` / `tope_diario` y la función falla.
- Ids de step: `copiloto-borrador-<día>-<borradorId>-<paso>`.
- No envía nada por Meta: ni siquiera el aviso de escalado ni el de descuento, que el pipeline sí manda (ver la excepción en el punto 1). Regenerar no tiene efectos; esos casos quedan como borrador en `error`.
- Nota: las funciones de workflows y difusión no se detallan en esta página (ver la nota del encabezado).

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
| `copiloto/borrador.solicitado`                | Server Action del Inbox | `copiloto-borrador`        |

## Dependencias de composición

`makeCrmInngestFunctions` recibe estas diecinueve dependencias agrupadas, una por función (el número lo fija `tests/unit/inngest-functions-factory.test.ts`; la fuente es `CrmInngestDeps` en `src/inngest/functions/index.ts`):

```ts
export interface CrmInngestDeps {
  onMessageReceived: OnMessageReceivedDeps;
  onStatusReceived: OnStatusReceivedDeps;
  onOperationalReceived: OnOperationalReceivedDeps;
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
  workflowDisparar: DispararWorkflowDeps;
  workflowSegmento: WorkflowSegmentoDeps;
  workflowProgramados: WorkflowProgramadosDeps;
  workflowInactividad: WorkflowInactividadDeps;
  drenarDifusiones: DrenarDifusionesDeps;
  copilotoBorrador: CopilotoBorradorDeps;
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
