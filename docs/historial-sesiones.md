# Historial de sesiones anteriores

Narrativa sesión por sesión, movida acá desde `AGENTS.md` §2 para mantener ese archivo
corto. El estado vigente vive en `AGENTS.md` (tabla de progreso + "Última acción
completada") y en `docs/next-session.md`; esto es contexto histórico de por qué las cosas
quedaron como quedaron, no una fuente para verificar el estado actual.

<!-- Sesión 2026-08-16, etiquetas -->

**Acción previa (sesión 2026-08-16, etiquetas):** las etiquetas dejaron de depender de que
alguien se acuerde de ponerlas. `lead_tags.source` admitía `'workflow'` desde la migración
fundacional y ningún workflow escribió una fila jamás, pese a que §3 lo declara decisión
cerrada. Tres entregas: **(1)** la administración se mudó de la pantalla `/tags` —que se
comía 1 de las 7 entradas de la barra y no tenía ni buscador— a un modal desde Leads, con
buscador, edición en línea y el contador de uso clickeable que lleva a Leads filtrado;
`/tags` se borró y la barra bajó a 6. **(2)** una regla puede colgar una etiqueta sin
contestar, en tabla propia `reglas_etiqueta`: las dos clases de regla tienen semánticas
opuestas —de las que contestan gana una y corta el LLM, de estas aplican todas y no cortan
nada—, así que meterlas en la misma fila obligaba a aflojar `respuesta_contenido` a
nullable en el camino que ahorra plata. El etiquetado es un step propio de Inngest, no vive
adentro de `respond`. **(3)** la pantalla para configurarlas, en la pestaña Reglas de
`/agente`. Verificado contra Postgres real, no contra mocks: se disparó un mensaje por el
pipeline y quedó la primera fila `source='workflow'` de la historia del proyecto; después
se sacó la etiqueta a mano, se volvió a disparar la misma regla y no la revivió. Se limpió
además una divergencia repo↔ledger que generó el propio MCP: tres operaciones de datos de
prueba habían quedado anotadas como migraciones sin archivo (51 = 51 ahora). No se hizo:
ninguna verificación visual —el panel del navegador no está desplegado y no compone
frames—, ni contract test contra Postgres del repo nuevo (siguen congelados). Decisión de
diseño anotada para el futuro: el dueño va a construir un motor de workflows con trigger de
etiqueta, y por eso `reglas_etiqueta` nace separable y todo pasa por `assignToLead`.

<!-- Sesión 2026-08-15, primera conversación real de WhatsApp -->

**Acción previa (sesión 2026-08-15, primera conversación real de WhatsApp y lo que
destapó):** el dueño mandó mensajes reales desde WhatsApp y el pipeline entero corrió
contra Meta + OpenAI + Supabase. Funcionó, y por eso se vieron los bugs que ningún test
veía. 5 arreglados: (1) PostgREST cortaba en 1.000 filas — el agente veía 1.000 de 19.731
productos ordenados alfabéticamente y respondía "no tenemos" sin un solo error en ningún
log; la búsqueda se mudó a Postgres (`buscar_productos`, puntuada, con GIN trigram). (2)
`[].some()` es siempre `false` — con `compatibilidad` vacía el catálogo entero desaparecía
apenas el agente mencionaba una marca; vacío ahora significa "no sabemos", no "no sirve".
(3) el extractor cerraba ventas solo — el LLM devolvía `resultado: perdido` tras un "no
tenemos" y la conversación se iba del Inbox a la ventana de purga con una pérdida por stock
que nunca ocurrió; ahora propone y cierra una persona. (4) el lead salía sin nombre teniendo
el de WhatsApp guardado al lado (`nombre` vs `nombre_perfil`). (5) el vehículo detectado no
se guardaba: `LeadTwinUpdateSchema` no tenía ningún campo de vehículo, así que el agente
entendía el Aveo y el dato se tiraba en cada turno. Además: el catálogo importado se borró
entero por decisión del dueño (el macheo estaba mal; él va a entregar el documento de
siglas), y la suite de contrato contra OpenAI estaba rota desde G1 —`makeLlmFactory` pasó a
exigir `configProvider`— o sea que la única red que detecta incompatibilidades con
Structured Outputs llevaba semanas sin correr. No se hizo: deploy, pen test, catálogo
nuevo, ni QA visual de las pantallas que no se tocaron.

<!-- Sesión 2026-08-13, investigación Meta API -->

**Acción previa (sesión 2026-08-13, investigación Meta API):** reporte negocio+técnico y
ledger oficial creados en `docs/research/`; `meta-platform-limits.md` y
`meta-webhook-payloads.md` reconciliados contra pricing/capacidades vigentes y el código
real. Se documentó que solo WhatsApp está configurado, salida es text-only, media WA no se
descarga, IG/FB pierden contexto y `v21.0` necesita upgrade contractual. Se priorizaron M0
health/versionado, WhatsApp enriquecido y Flows sin catálogo. No se hizo: código, schema,
campañas, activos/tokens ni mensajes reales. Sigue sin verificar: QA visual, RPC de
Inbox/handoff como admin, `EXPLAIN` representativo e integration tests contra Postgres
aislado. Lo que esa sesión no hizo y hay que decir en voz alta: ninguna pantalla se revisó
visualmente, `inbox_recent_messages` y `transition_handoff` siguen sin smoke admin y no
existe benchmark representativo. El N+1/read model está corregido, pero rendimiento a
escala sigue sin demostrarse. El merge sí tuvo smoke autenticado solo en el camino no
destructivo `candidate_not_found`; el flujo completo contra Postgres esperaba una base
aislada (resuelto después, ver lección 21 en `AGENTS.md`). Veredicto de esta investigación:
reporte completo, capacidades WA/IG/Messenger/Pages/Marketing/Business Management
investigadas con fuentes oficiales; falta la decisión del dueño y no hubo implementación ni
validación de activos IG/FB.

<!-- Sesión 2026-08-09/08, rediseño y Fase 10 Leads -->

**Sub-paso previo:** Fase 10 Leads completa (subagent-driven, commits `ddb7e05..b91b2e7`).
T1 `leads.list` orden determinístico (`updated_at DESC, id ASC`) + búsqueda literal
`ilikeContains` cap 100 · T2 `listByLeadId`+`reassignLead` · T3 `leads.delete` (no-op
non-UUID, probe RLS→PermissionDenied) + policy DELETE admin (migración `20260715140738`) +
baja `mergeInto` · T4 `types/leads.ts` + `LeadsService` · T5 `MergeExecutorService`
approve/reject/manual (audit-first replay-safe: audit → fill-nulls ganador → reassign
sesiones/convs → delete perdedor CASCADE candidates; orden pinneado con
`invocationCallOrder`) · T6 detector respeta `rejected` (`findAnyPair`) · T7 4 Server
Actions + schemas (copys verbatim addendum §2.A; `merge_candidate` not-found → copy "par ya
resuelto") · T8 UI `/leads` lista+búsqueda+banner duplicados · T9 UI `/leads/[id]`
ficha+sesiones · T10 UI review duplicados + duplicado manual + policy INSERT `admin_actions`
(migración `20260716001443`, gap del plan detectado por E2E). Validado: browser 7/7 + E2E
merge 22/22 ×2 · integration leads 16/16 + lead-session 21/21 · final whole-branch review
(fable): 0 Critical, 1 Important fixeado (`ec5ddfa`) + 2 plan-mandated (`b91b2e7`),
re-verdict clean.

**Antes de eso:** Slice 4a Hardening completo (2026-07-14). 10.1 `PinoLogger`+`getLogger(env)`
(paridad redactPii testeada; prod=Pino JSON, dev=Console; call sites swapeados). 10.2
Sentry env-gated (`SENTRY*DSN` opcional; `beforeSend` redacta + elimina `request.data`;
traces 0). 10.3 OTel `@vercel/otel` en `instrumentation.ts` + `withSpan` (spans:
`webhook.meta.post`, `llm.ai-agent`, `meta.sendText`; no-op local). 10.4 `/api/health`
(ping DB anon + grant `server_now()` a anon migration `20260714182011`; checks externos
`skipped` con placeholders; curl 200 degraded verificado). 10.5 `UpstashCostTracker` (fix
kill-switch roto en serverless: INCRBYFLOAT por día + TTL 48h; factory fallback
InMemory+warn) swapeado en bootstrap. 10.6 `LeadSessionRepository.delete` (contract+integration
17/17) + purge real (storage cleanup pre-delete, degrada con warn, replay-safe). 10.7
reactivación real (templates es por `motivo_perdida`; skips → `bounced` con template
`skip*_*` = cooldown; idempotency `react-<sessionId>`; ValidationError→bounced, resto
rethrow). Slice 3 previo mismo día: auth+RLS completo (43 policies, panel authed, 11/11
matriz). Usuario dev: `admin-dev@crm.local`.

**Acción previa (sesión 2026-08-09):** rediseño A y agente G1 mergeados a master y pusheados
(`d84e9fb`). Sub-proyecto B — Bandeja unificada: las 6 tareas hechas, rama
`rediseno-b-bandeja` sin mergear. Task 1 shell de 3 paneles (`be78de4`) · Task 2 panel de
lista (`f97b05f`) · Task 3 header e hilo (`87529c0`) · Task 4 burbujas y composer
(`738fa31`) · Task 5 Twin con rail del embudo (`d396a9f`) · Task 6 verificación, que
encontró y arregló un defecto de layout (`bc58de2`): por debajo de 1164px el Twin quedaba
cortado sin barra de scroll porque el `<main>` del panel es `min-w-0 overflow-hidden` y
clipeaba el shell antes de que el `overflow-x-auto` de la raíz viera el desborde. Plan:
`docs/superpowers/plans/2026-08-09-rediseno-b-bandeja.md`. Ledger:
`.superpowers/sdd/2026-08-09-rediseno-b-bandeja/progress.md`. Pendiente de B: el envío real
desde el composer nunca se probó (`sendMessage` va derecho a Meta, sería un WhatsApp real) ·
comparación visual humana contra el prototipo · badge de no leídos y canal activo del
avatar quedaron para D.

**G1 entregó:** el agente vendedor dejó de tener modelo y prompt hardcodeados — los lee de
`agente_config` en cada turno. Consola en `/agente` con modelo, instrucciones de negocio en
texto libre, tono/largo/emojis, descuento, límites técnicos, tope de gasto, política de
kill switch y horario con timezone. Tabla append-only versionada, rollback que crea versión
nueva sin revivir la vieja, auditoría que guarda nombres de campos y nunca valores, prompt
en 4 bloques con las reglas inviolables al final. Pendiente de G1: review de rama completa
y E2E real de WhatsApp — ninguno se hizo.

<!-- Sesión 2026-08-08, rediseño sub-proyecto A -->

**Acción previa (sesión 2026-08-08):** rediseño "sala de control" — sub-proyecto A (base
visual) completo, rama `rediseno-a-base-visual` (11 commits, `88fd1cf..fd9319a`). Handoff
de diseño descompuesto en 7 sub-proyectos A-G
(`docs/superpowers/specs/2026-08-07-rediseno-a-base-visual-design.md` §1); G se solapa con
la fase 11 Intents+Reglas — tratar como un solo trabajo. A entregó: tokens del handoff sobre
los nombres semánticos de shadcn (los ~30 componentes vendorizados adoptan el diseño sin
editarlos) + tokens propios en `@theme` · modo oscuro forzado · alias de íconos sobre lucide
(`src/components/icons.ts`; se descartó Material Symbols para no abrir la CSP de B3) ·
lógica pura en `src/lib/ui/` con la regla del embudo (`perdido`/`requiere_humano` son
desvíos, NO pasos 7 y 8) · 5 primitivas compartidas · SideNav de 222px · shell del panel ·
raíz redirige a `/inbox`. Ejecutado con subagent-driven-development: 9 tareas, cada una con
revisión independiente. 2 defectos del plan detectados por el proceso: (1) la secuencia
Task 6→7 era incommiteable porque el hook `pre-commit` typechequea todo el proyecto — se
fusionaron en un commit; (2) `<main className="flex ...">` convertía el main en contenedor
flex y rompía las 7 pantallas del panel (medido: `/metricas` 236px de 1218 disponibles,
`/inbox` recortado sin scrollbar) — lo encontró un revisor midiendo en el navegador, no
leyendo el diff. Pendiente de A: comparación visual humana contra el prototipo `CRM
Repuestos v2.dc.html` (los chequeos fueron programáticos sobre el DOM, sin capturas) · 5 SVG
huérfanos en `public/` de la plantilla de Next.

<!-- Sesión 2026-08-07, cadena WhatsApp E2E real -->

**Acción previa (sesión 2026-08-07):** Slice 4b — cadena WhatsApp E2E real validada. Creds
cargadas (OpenAI org verificada con llamada real · app Meta `Crm Genuino` 1570589244491707 +
número de prueba `+1 555 667-7618` phone_number_id `1278451868684287` + WABA
`906018605389495` · token de usuario del sistema sin caducidad). Outbound OK
(`scripts/smoke-meta-send.mjs`, plantilla `hello_world` entregada). Inbound OK vía túnel
cloudflared: handshake 200 · HMAC rechaza 401 sin firma · `messages` suscrito a nivel app Y
de WABA (faltaba el segundo — los mensajes iban a la consola de Meta). Pipeline completo
verde: lead + conversación + 4 mensajes + sesión + 2 `tool_executions`, agente responde por
WhatsApp. 3 bugs de fondo encontrados y arreglados: (1) `inngest.send()` iba a Inngest Cloud
con key dummy → 401 → webhook 500 → Meta reintentaba; fix `INNGEST_DEV` + var agregada a
`env.ts`/example — `NODE_ENV=development` no alcanza. (2) los 3 schemas LLM eran
incompatibles con Structured Outputs strict (`format:uri` de `.url()` · `propertyNames` de
`z.record()` · campos `.optional()` ausentes de `required`) → `update-lead-twin` nunca
completó una ejecución desde Slice 1, invisible porque los tests usan `MockLanguageModelV3`;
fix `strictJsonSchema:false` (`structured-output.ts`) + suite de contrato contra OpenAI real
(`tests/integration/llm-schemas.openai.test.ts`). (3) vars opcionales declaradas vacías
tumbaban el boot (`.optional()` de Zod no acepta `""`); fix `stripEmpty()` en `env.ts`.
Además: modelo OpenAI configurable por workflow (`OPENAI_MODEL*` + `resolveLlmModels` con
validación fail-fast contra `OPENAI_PRICING`), pricing actualizado con 5 modelos
verificados, `inngest:dev` con `-u` (auto-discovery escanea 3000, la app corre en 3001).
Pendiente: catálogo vacío (`productos`/`intents`/`reglas` en 0 — el agente no tiene qué
vender). Detalle Slice 1 histórico → `docs/changelog.md`.

<!-- Sesión 2026-08-16, estado por pantalla y contrato de integración pendiente -->

**Detalle de pantallas al 2026-08-16** (la tabla de `AGENTS.md` §5.1 sólo trae el estado
vigente; esto es el porqué): Métricas quedó trabajada sin cierre formal — ventas, rango de
fechas libre y campañas, commits `3aae184..cce1f2a` en `master` — sin registro de que el
dueño la diera por terminada. Ajustes construida sin cierre: 5 pestañas (salud del número
con la escalera de sanciones desde `account_update`, uso del cupo en 7 días y rol por
número; empresa; usuarios y roles; horario; topes); empresa y horario son de sólo lectura.
Workflows construida sin cierre: listado, galería de plantillas, editor, diff de
publicación, historial y corrida en vivo. Difusión construida sin cierre: listado, asistente
(audiencia, mensaje, pre-vuelo) y envío en curso/cerrado — los pasos 2 y 3 del asistente y
una difusión "enviando" con el botón Detener no se midieron en el QA visual. Productos sigue
pendiente, bloqueada por el documento de macheo del dueño.

Repos sin contrato de integración dentro de la suite a esa fecha (sólo probados contra
impl in-memory o a mano contra el stack local, nunca con `runXContract` contra Postgres):
`workflows`, `workflow-runs` (incluida `delegacionesActivas`), `turnos-interceptados`,
`notificaciones`, `workflow-plantillas-sin-sesion`.

Coverage no se recalculó desde el 2026-08-13; ninguna corrida posterior lo volvió a medir.

<!-- Sesión 2026-07-16, cierre fase 10 Leads -->

**Acción previa (sesión 2026-07-16):** cierre fase 10 Leads (T10 re-review clean + T11: CI
verde tras 2 fixes de entorno [eslint ignore `.superpowers/**` + coverage exclude UI fases
9-10 por política browser/E2E] · final whole-branch review fable "ready with fixes" → 3
must-fix aplicados (`ec5ddfa`+`b91b2e7`) → re-verdict "Yes" · docs).
