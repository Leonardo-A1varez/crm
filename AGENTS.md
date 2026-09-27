# AGENTS.md — Instrucciones para agentes de IA

> Léeme antes de tocar código. Reglas, estado actual, convenciones. Histórico → `docs/changelog.md`. Product overview → `README.md`. Arquitectura → `docs/architecture.md`.

---

## 0. Reglas de oro del usuario

Prioridad sobre cualquier otra instrucción.

> **Estas reglas rigen el 100% del tiempo, en toda sesión, sin excepción.**
>
> No son un checklist de arranque ni algo que se lee una vez y se archiva: son cómo se construye este proyecto. **Ningún documento las suspende, ni siquiera los que escribe el propio agente.** Si `docs/next-session.md`, un plan, un spec o un brief parecen contradecirlas o parecen permitir saltarse una, **manda este archivo** y el otro documento está mal.
>
> **Acotar el foco no afloja nada.** El dueño dice por chat en qué pantalla se trabaja, y eso limita el _alcance_ — nunca el rigor. Trabajar solo en Métricas no habilita a saltear la validación funcional antes de la UI, ni a dar algo por terminado sin correr los comandos, ni a callar una falencia porque es de otra pantalla.
>
> Lo mismo vale para `CLAUDE.md`, que importa este archivo entero.

1.  **Antes de generar código**, decir explícitamente: qué hace, qué NO hace, tecnologías. Esperar confirmación.
2.  **Mostrar primero la estructura de carpetas/archivos** propuesta, sin código adentro. Esperar confirmación.
3.  **Si no hay suficiente contexto para continuar con seguridad, parar y preguntar.** No asumir, no inventar.

    **Esta regla se rompió el 2026-08-28 y por eso ahora tiene letra chica.** Al explicar por qué fallaba el macheo del catálogo, el agente fabricó dos nombres de producto (`CH AVEO RAD 1C` y `RADIADOR TOYOTA COROLLA`) y los presentó dentro de un análisis que por lo demás salía del código real. El mecanismo era correcto; los datos, inventados. Mezclar una cosa con la otra es peor que no dar el ejemplo, porque el lector no tiene forma de saber qué mirar dos veces.
    - **Si no lo miraste, no lo afirmas.** Archivos, filas, esquemas, APIs, precios, comportamiento de código. Nada de "seguramente" ni "debería ser".
    - **Prohibido fabricar ejemplos y presentarlos como reales.** O citás una fila que leíste, o escribís "ejemplo inventado" en la misma frase.
    - **Si el dueño te señala un archivo, lo abrís antes de opinar.**
    - **Si no existe, se dice seco:** "no hay catálogo", "ese archivo no existe". Sin rellenar el hueco.
    - **Si no sabés, preguntás en una línea.** Preguntar nunca es el error; inventar sí.
    - **Lo de segunda mano se marca y se verifica.** Un reporte de subagente o un doc de terceros no es fuente primaria: se contrasta antes de construir encima. En esta misma sesión un dato de un subagente ("Meta empieza a cobrar los utility en octubre") se cayó al chequearlo contra la documentación de Meta.

4.  Análisis técnico formato: **observación → causa raíz → fix**. Marcar mejoras fuera de scope.
5.  **Validación funcional antes que UI.** Cablear sequence controller → repo → datasource → backend. Curl/scripts. Tests unitarios para transiciones de estado. Solo "probar en la app" cuando la lógica funcional esté validada.
6.  **Supabase es la única DB.** No proponer SQLite, Mongo, Postgres pelado ni ningún motor alternativo: los datos viven en Supabase y punto.
    **Esto NO prohíbe correr Supabase localmente.** `supabase start` levanta el stack real —Postgres + PostgREST + GoTrue + Storage— en Docker; no es una DB alternativa, es la misma. Es además la forma correcta de correr los integration tests, que borran 17 tablas y por eso no pueden apuntar a una base con datos.
    _La versión anterior decía "no proponer Docker local" y clausuró durante meses la única solución al problema de aislamiento de tests, mientras `supabase/config.toml` ya estaba en el repo sin que nadie lo usara. Una regla que guarda una **conclusión** se pudre; una que guarda el **motivo** envejece bien._
7.  **Antes de iniciar cualquier fase o sub-paso técnico, invocar TODOS los plugins/skills relevantes vía `Skill` tool.** Mapping: Zod/types → `vercel:ai-sdk` + `supabase:supabase`. SQL → `supabase:supabase-postgres-best-practices` + `supabase:supabase`. Inngest → `vercel:workflow` + `vercel:vercel-functions`. Tests → `superpowers:test-driven-development`. UI → `vercel:shadcn` + `frontend-design` + `vercel:nextjs`. AI SDK → `vercel:ai-sdk` + `vercel:ai-gateway`. Webhooks Meta → `vercel:vercel-functions` + `security-review`.
8.  **Pensar siempre como programador top 1% mundial. CERO condescendencia.** Si hay gap, falencia, error, anti-patrón, decisión cuestionable, dead code, abstraction prematura, dependency obsoleta, herramienta sub-óptima, estructura desordenada, regla rota, test ausente, doc inconsistente, falta de observabilidad, falta de seguridad, o cualquier desviación de práctica de élite — **decirlo claramente y sin filtros antes de proponer solución**. Aplica a TODO: arquitectura, stack, herramientas, lenguaje, configs, dependencies, naming, estructura carpetas, docs, tests, CI, performance, security, DX, observability. Patrón: **(1) listar falencias reales encontradas → (2) explicar impacto concreto → (3) proponer solución priorizada por ROI**. No suavizar. No callar gaps por evitar fricción. Decir "esto está mal porque X" > "esto se puede mejorar". El usuario quiere producto profesional perfecto — eso requiere honestidad técnica brutal.
9.  **Seguridad + Compliance Latam obligatorio.** No-negociable por LGPD Brasil + Ley 25.326 Argentina + LFPDPPP México + Ley 19.628 Chile + Ley 1581 Colombia. Aplicar SIEMPRE:
    - **PII redaction en logs.** Nunca loggear `telefono`, `mensaje.body`, `email`, `meta_user_ids` raw. Usar `redactPii()` util (`src/lib/observability/redact.ts`). ESLint rule custom o checklist en code review.
    - **Webhook entrante = HMAC verify primera línea.** Toda route `/api/webhooks/**` debe importar `verifyHmac()` antes de parsear payload. Sin verify = reject 401.
    - **Server Actions = Zod parse primera línea.** Toda `'use server'` action: `const input = Schema.parse(formData)` antes de cualquier lógica. Sin excepción.
    - **Secrets rotation 90d.** `META_APP_SECRET`, `OPENAI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `INNGEST_SIGNING_KEY` rotan cada 90 días. Runbook en `docs/runbooks/secrets-rotation.md`.
    - **`console.log` prohibido en `src/**`.** Solo `logger.info|warn|error|debug`. ESLint `no-console: error`. Razón: PII leak + logs sin structured fields.
10. **Reliability + Ops obligatorio.** Toda nueva integración debe cumplir: - **Cost-tracking en TODA llamada LLM.** `recordLlmUsage(tracker, result, { model, workflow, sessionId? })` post-call obligatorio. ESLint rule en `src/server/services/llm/**`. Razón: daily cap kill-switch no funciona si se bypassa. - **Idempotency-key explícito en `step.run()` Inngest + toda cron function.** Pattern: `${functionName}-${date.toISOString().slice(0,10)}-${entityId}`. No auto-gen. Replay tests obligatorios. - **`DomainError` jerarquía siempre.** Prohibido `throw new Error('msg')` en `src/server/**`. Clases reales (`src/lib/errors.ts`): `ValidationError`, `NotFoundError`, `ConflictError`, `PermissionDeniedError`, `IllegalStateError`, `BudgetExceededError`, `InfraError`, `RateLimitError`. `mapPostgrestError` usa `InfraError` como fallback. ESLint rule. Razón: retry semantics dependen de error type. - **`/api/health` endpoint live.** Verifica DB ping + Inngest reachability + OpenAI ping. Vercel monitor wire. Pre-Slice 4 obligatorio. - **Error tracking (Sentry o equivalente) pre-Slice 4 launch.** Uncaught exceptions + unhandled rejections → tracked. Razón: silent failures = lost revenue.
    11.5. **Eres orquestador, no ejecutor. Todo cambio va por subagente.** (Regla del dueño, 2026-08-30.)

        - **Prohibido implementar a mano.** Modificar código, crear componentes, implementar funciones o aplicar refactors se delega a subagentes vía `Agent`. El agente principal reparte, revisa y consolida — no escribe la implementación él mismo.
        - **Trabajo en paralelo.** Tareas independientes se despachan simultáneamente, no en fila.
        - **Lo que SÍ hace el agente principal:** leer para entender, diagnosticar, decidir el reparto, revisar lo que vuelve, consolidar y reportar.
        - **Excepción única:** ediciones de una línea sobre documentación o configuración que el dueño dictó textualmente. Ante la duda, se delega.

11.6. **Diseño: obligatorio usar TODAS las skills y plugins de diseño.** (Regla del dueño, 2026-08-30.)

    Cualquier trabajo que toque UI, componentes visuales, CSS, layout, motion o sistema de diseño **exige invocar las skills de diseño antes de escribir un estilo**. No es opcional ni queda a criterio.

    Inventario obligatorio a considerar en cada tarea de diseño:
    - `frontend-design` — dirección visual y decisiones estéticas.
    - `ui-ux-pro-max:design` · `ui-ux-pro-max:ui-styling` · `ui-ux-pro-max:design-system` — sistema, tokens y estilo.
    - `ecc:frontend-design-direction` — dirección de producto para UI.
    - `ecc:make-interfaces-feel-better` — el pulido que separa lo aceptable de lo bueno.
    - `emil-design-eng` — detalle de ingeniería de diseño.
    - `apple-design` — gesto, física y materiales cuando aplique.
    - `motion-foundations` + `motion-patterns` + `animate` — cualquier cosa que se mueva.
    - `dataviz` — antes de la primera línea de cualquier gráfico, métrica o tablero.
    - `ecc:accessibility` / `ecc:a11y-architect` — contraste, teclado y foco.
    - `vercel:shadcn` — antes de crear un componente que ya existe vendorizado.

    **El diseño también se delega** (regla 11.5): las skills las carga el subagente que ejecuta, y el principal consolida.

12. **Skill discipline workflow.** Invocar superpowers skills vía `Skill` tool en estos triggers:
    - **Feature nueva (crear componente/route/service/workflow)** → `superpowers:brainstorming` primero. Explora intent + requirements + diseño antes de tocar código.
    - **Bug / test fail / behavior inesperado** → `superpowers:systematic-debugging` antes de proponer fix. Evidence-based diagnosis.
    - **Claim "completo" / "fixed" / "passing"** → `superpowers:verification-before-completion` antes del claim. Run verification commands + confirm output.
    - **Business logic en services + repos** → `superpowers:test-driven-development`. Test antes que implementación. Red → green → refactor.

---

## 1. Resumen ejecutivo

CRM conversacional **single-org self-hosted white-label**, venta de **repuestos automotrices**. Target market: **Latam aftermarket parts** (Brasil, México, Argentina, Chile, Colombia, Perú). Modelo deployment: **1 instalación per cliente empresa** (no multi-tenant SaaS).

**Cohorte inicial de validación:** 3-4 usuarios internos y ~1000 leads/semana.

**Pilot tier objetivo de arquitectura (Slice 1-4):**

- 30 vendedores per cliente.
- Peak 50 msg/sec / sostenido 2-5 msg/sec per instancia.
- ~5K leads/mes per cliente.
- Conversaciones cortas (5-15 mensajes).
- Hosting cost ~$100-300 USD/mes per instancia (Supabase Pro + Inngest Free/Hobby + Vercel Hobby + OpenAI pay-as-you-go).

**Tiers escalables post-launch:**

- Mediana: 50-100 vendedores / peak 200 msg/sec → Supabase Pro/Team + Inngest Pro (~$500-1.5K/mes).
- Grande: 100-200 vendedores / peak 500 msg/sec → Supabase Team + read replicas + Inngest Pro (~$1.5-3K/mes).

**Features:**

- Multi-canal Meta: WhatsApp + Instagram + Facebook Messenger (caps por canal → `docs/meta-platform-limits.md`).
- Agente IA seller GPT-4 con catálogo + tool calling (Vercel AI SDK).
- Lead Twin estructurado, extractado por LLM.
- Motor intents + reglas IF/THEN pre-LLM (ahorra cost).
- Multi-sesiones históricas, purge automática >29 días.
- Workflows durables Inngest + outbox pattern para state consistency.

Diferenciadores: **sin kanban manual** (auto-stage), **Lead Twin**, **reglas IF/THEN** para reducir cost LLM, **reactivación predictiva**, **catálogo conectado al agente**.

**Revenue model (negocio):**

- Licencia setup: $5K-50K USD per cliente (one-time).
- Ops mensual: $1K-5K USD per cliente (hosting + SLA + soporte).
- Add-ons: training data custom, integración ERP, custom workflows.
- TAM/SAM/SOM análisis → `docs/business-plan.md`.

**Compliance Latam:**

- LGPD Brasil + Ley 25.326 Argentina + LFPDPPP México + Ley 19.628 Chile + Ley 1581 Colombia.
- Detalle + right-to-erasure design → `docs/data-retention.md`.

---

## 2. Estado actual

**Fase actual:** `Rama feat/workflows-difusion: 13 commits sobre master, y master lleva 27 commits sin pushear sobre origin/master (91de606). Nada de workflows ni difusión está en el remoto: falta push y PR. crm-dev ya tiene las 88 migraciones aplicadas; el código NO está desplegado. El catálogo sigue VACÍO A PROPÓSITO (espera el documento de siglas del dueño). Retomar: docs/next-session.md.`

Reproducir: `git log --oneline master..HEAD | wc -l` (13) · `git log --oneline origin/master..master | wc -l` (27) · `ls supabase/migrations/*.sql | wc -l` (88) · `supabase migration list` (88 local = 88 remoto). Medido el 2026-09-26.

**Última acción completada (2026-09-24 → 2026-09-26, workflows, difusión, Ajustes y stack local):** el motor de flujos pasó de "corre" a "se puede operar", la difusión existe de punta a punta y hay por fin una base aislada para probar. Resumen por frente; detalle en los commits `a0dc24e..d95c3cb` y en `docs/prd-workflows*.md` §Decisiones del dueño.

- **Workflows — editor:** errores sobre el nodo culpable con arreglos de un clic, "Después de esto", atajos ⌘K/Tab, cable soltado al vacío que crea el bloque conectado, Importar, Disparar ahora, Ejecutar hasta acá, variables como chips (no se puede escribir `{{ }}`), vista previa contra un lead real con aviso de ventana de 24 h, `SelectOpciones` compartido (Base UI mostraba el valor crudo sin `items`) y lienzo que sigue el tema.
- **Workflows — bloques nuevos que corren:** Botones, Lista, Imagen y Ubicación (con respuesta interactiva y salida `sin_respuesta`), Según el valor, Ir a, Actualizar campo del Twin, Avisar al equipo (notificación en el panel, no WhatsApp), Delegar al agente (5 salidas), y el disparador Difusión respondida. "Mensaje recibido" puede **interceptar al agente** (`turnos_interceptados`) y "Enviar mensaje" tiene categoría Servicio/Marketing.
- **Workflows — ejecución:** condición con campos vivos (intent, etiquetas, marca, precio…) y contador de leads que coinciden; cancelar corrida con CAS y `cancelOn`; intentos por corrida; corridas por nodo sobre el lienzo; topes de seguridad con motivo de salto; la BAJA corta al agente; tope de 5 disparos encadenados; round robin con tope.
- **Bugs de fondo que la suite no veía:** Probar **nunca funcionó** (RLS 42501; 0 corridas de prueba en crm-dev); Probar cancelaba la corrida de producción con la política "reiniciar"; el **auto-handoff por intents desconocidos nunca pausaba** con el umbral de fábrica 2, porque el pipeline mandaba siempre una sola clasificación; carrera `delivered`/`read` que dejaba mensajes en `entregado` (3 de 20 en la prueba concurrente); el intent del turno se leía del turno anterior; "Reactivar perdidos" tiraba `lead_session_id_ausente`; un interceptor con el tope lleno callaba al agente y el flujo no contestaba; lecturas y métricas cortadas en 1.000 filas.
- **Difusión:** bajas guardadas como HMAC del teléfono e irreversibles, motor por tandas con reserva CAS, estados por webhook, frenado por 368/131031/131048, canary, prueba a mi número (5 por hora), texto libre gratis a quien tiene la ventana abierta, audiencia dinámica re-evaluada antes de cada tanda, respuestas atribuidas y costo estimado.
- **Ajustes (`/ajustes`, deja de ser `PantallaPendiente`):** salud del número, escalera de sanciones desde `account_update`, uso del cupo en 7 días, rol por número, topes.
- **Stack local aislado** (lección 21): Supabase en Docker + app en 3002 + Inngest en 8298 + mock de la Graph API. Los integration tests vuelven a correr.

**Verificado:** E2E locales disparando el pipeline contra el stack local, con `SELECT` a la base y el log del mock (interceptar, delegar, auto-handoff, mensajería rica, texto libre, audiencia dinámica). QA visual medido con `getComputedStyle`/`getBoundingClientRect` (el QA de la sesión encontró 5 rotas, 30 feas y 25 detalles; las 5 rotas quedaron corregidas o, el 404 del historial, diagnosticado como caché del dev server). **No se hizo:** deploy, push, comparación visual humana, Realtime de la campanita en vivo, `test:integration:local` completo después del 2026-09-25, contrato Supabase de los repos nuevos (`delegacionesActivas`, `turnos-interceptados`, `notificaciones`, difusión con texto libre) dentro de la suite. Las decisiones de "Delegar al agente" y del auto-handoff **esperan confirmación del dueño**.

**Acción previa (sesión 2026-08-16, etiquetas):** las etiquetas dejaron de depender de que alguien se acuerde de ponerlas. **`lead_tags.source` admitía `'workflow'` desde la migración fundacional y ningún workflow escribió una fila jamás**, pese a que §3 lo declara decisión cerrada. Tres entregas: **(1)** la administración se mudó de la pantalla `/tags` —que se comía 1 de las 7 entradas de la barra y no tenía ni buscador— a un modal desde Leads, con buscador, edición en línea y el contador de uso clickeable que lleva a Leads filtrado; `/tags` se borró y la barra bajó a 6. **(2)** una regla puede colgar una etiqueta **sin contestar**, en tabla propia `reglas_etiqueta`: las dos clases de regla tienen semánticas opuestas —de las que contestan gana UNA y corta el LLM, de estas aplican TODAS y no cortan nada—, así que meterlas en la misma fila obligaba a aflojar `respuesta_contenido` a nullable en el camino que ahorra plata. El etiquetado es un step propio de Inngest, no vive adentro de `respond`. **(3)** la pantalla para configurarlas, en la pestaña Reglas de `/agente`. **Verificado contra Postgres real, no contra mocks:** se disparó un mensaje por el pipeline y quedó la **primera fila `source='workflow'` de la historia del proyecto**; después se sacó la etiqueta a mano, se volvió a disparar la misma regla y **no la revivió**. Se limpió además una divergencia repo↔ledger que generó el propio MCP: tres operaciones de datos de prueba habían quedado anotadas como migraciones sin archivo (51 = 51 ahora). **No se hizo: ninguna verificación visual** —el panel del navegador no está desplegado y no compone frames—, ni contract test contra Postgres del repo nuevo (siguen congelados). Decisión de diseño anotada para el futuro: **el dueño va a construir un motor de workflows con trigger de etiqueta**, y por eso `reglas_etiqueta` nace separable y todo pasa por `assignToLead`.

**Acción previa (sesión 2026-08-15, primera conversación real de WhatsApp y lo que destapó):** el dueño mandó mensajes reales desde WhatsApp y el pipeline entero corrió contra Meta + OpenAI + Supabase. Funcionó, y por eso se vieron los bugs que ningún test veía. **5 arreglados:** (1) **PostgREST cortaba en 1.000 filas** — el agente veía 1.000 de 19.731 productos ordenados alfabéticamente y respondía "no tenemos" sin un solo error en ningún log; la búsqueda se mudó a Postgres (`buscar_productos`, puntuada, con GIN trigram). (2) **`[].some()` es siempre `false`** — con `compatibilidad` vacía el catálogo entero desaparecía apenas el agente mencionaba una marca; vacío ahora significa "no sabemos", no "no sirve". (3) **el extractor cerraba ventas solo** — el LLM devolvía `resultado: perdido` tras un "no tenemos" y la conversación se iba del Inbox a la ventana de purga con una pérdida por stock que nunca ocurrió; ahora propone y cierra una persona. (4) **el lead salía sin nombre** teniendo el de WhatsApp guardado al lado (`nombre` vs `nombre_perfil`). (5) **el vehículo detectado no se guardaba**: `LeadTwinUpdateSchema` no tenía ningún campo de vehículo, así que el agente entendía el Aveo y el dato se tiraba en cada turno. **Además:** el catálogo importado se borró entero por decisión del dueño (el macheo estaba mal; él va a entregar el documento de siglas), y **la suite de contrato contra OpenAI estaba rota desde G1** —`makeLlmFactory` pasó a exigir `configProvider`— o sea que la única red que detecta incompatibilidades con Structured Outputs llevaba semanas sin correr. **No se hizo:** deploy, pen test, catálogo nuevo, ni QA visual de las pantallas que no se tocaron.

**Acción previa (sesión 2026-08-13, investigación Meta API):** reporte negocio+técnico y ledger oficial creados en `docs/research/`; `meta-platform-limits.md` y `meta-webhook-payloads.md` reconciliados contra pricing/capacidades vigentes y el código real. Se documentó que solo WhatsApp está configurado, salida es text-only, media WA no se descarga, IG/FB pierden contexto y `v21.0` necesita upgrade contractual. Se priorizaron M0 health/versionado, WhatsApp enriquecido y Flows sin catálogo. **No se hizo:** código, schema, campañas, activos/tokens ni mensajes reales. Sigue sin verificar: QA visual, RPC de Inbox/handoff como admin, `EXPLAIN` representativo e integration tests contra Postgres aislado.

**Lo que la sesión 2026-08-13 NO hizo y hay que decir en voz alta:** ninguna pantalla se revisó visualmente, `inbox_recent_messages` y `transition_handoff` siguen sin smoke admin y no existe benchmark representativo. El N+1/read model está corregido, pero rendimiento a escala sigue sin demostrarse. El merge sí tuvo smoke autenticado solo en el camino no destructivo `candidate_not_found`; el flujo completo contra Postgres espera una base aislada.

**Sub-paso previo:** **Fase 10 Leads COMPLETA (subagent-driven, commits `ddb7e05..b91b2e7`).** T1 `leads.list` orden determinístico (`updated_at DESC, id ASC`) + búsqueda literal `ilikeContains` cap 100 · T2 `listByLeadId`+`reassignLead` · T3 `leads.delete` (no-op non-UUID, probe RLS→PermissionDenied) + policy DELETE admin (migración `20260715140738`) + baja `mergeInto` · T4 `types/leads.ts` + `LeadsService` · T5 `MergeExecutorService` approve/reject/manual (audit-first replay-safe: audit → fill-nulls ganador → reassign sesiones/convs → delete perdedor CASCADE candidates; orden pinneado con `invocationCallOrder`) · T6 detector respeta `rejected` (`findAnyPair`) · T7 4 Server Actions + schemas (copys verbatim addendum §2.A; `merge_candidate` not-found → copy "par ya resuelto") · T8 UI `/leads` lista+búsqueda+banner duplicados · T9 UI `/leads/[id]` ficha+sesiones · T10 UI review duplicados + duplicado manual + policy INSERT `admin_actions` (migración `20260716001443`, gap del plan detectado por E2E). Validado: browser 7/7 + E2E merge 22/22 ×2 · integration leads 16/16 + lead-session 21/21 · final whole-branch review (fable): 0 Critical, 1 Important fixeado (`ec5ddfa`) + 2 plan-mandated (`b91b2e7`), re-verdict clean. Backlog fase 11 triageado → `docs/next-session.md`.
**Antes de eso:** **Slice 4a Hardening COMPLETO (2026-07-14).** 10.1 `PinoLogger`+`getLogger(env)` (paridad redactPii testeada; prod=Pino JSON, dev=Console; call sites swapeados). 10.2 Sentry env-gated (`SENTRY*DSN`opcional;`beforeSend`redacta + elimina`request.data`; traces 0). 10.3 OTel `@vercel/otel`en`instrumentation.ts`+`withSpan`(spans:`webhook.meta.post`, `llm.ai-agent`, `meta.sendText`; no-op local). 10.4 `/api/health`(ping DB anon + grant`server_now()`a anon migration`20260714182011`; checks externos `skipped`con placeholders; curl 200 degraded verificado). 10.5`UpstashCostTracker`(fix kill-switch roto en serverless: INCRBYFLOAT por día + TTL 48h; factory fallback InMemory+warn) swapeado en bootstrap. 10.6`LeadSessionRepository.delete`(contract+integration 17/17) + purge real (storage cleanup pre-delete, degrada con warn, replay-safe). 10.7 reactivación real (templates es por`motivo_perdida`; skips → `bounced`con template`skip*\*`= cooldown; idempotency`react-<sessionId>`; ValidationError→bounced, resto rethrow). **Slice 3 previo mismo día:** auth+RLS completo (43 policies, panel authed, 11/11 matriz). Usuario dev: `admin-dev@crm.local`. **Siguiente: Slice 4b launch** — checklist en next-session (creds reales META/OPENAI/INNGEST/UPSTASH + cuenta Sentry + deploy Vercel + webhook público + templates Meta + monitores + pen test).
**Acción previa (sesión 2026-08-09):** **Rediseño A y agente G1 mergeados a master y pusheados (`d84e9fb`). Sub-proyecto B — Bandeja unificada: las 6 tareas hechas, rama `rediseno-b-bandeja` sin mergear.** Task 1 shell de 3 paneles (`be78de4`) · Task 2 panel de lista (`f97b05f`) · Task 3 header e hilo (`87529c0`) · Task 4 burbujas y composer (`738fa31`) · Task 5 Twin con rail del embudo (`d396a9f`) · Task 6 verificación, que encontró y arregló un defecto de layout (`bc58de2`): por debajo de 1164px el Twin quedaba cortado sin barra de scroll porque el `<main>` del panel es `min-w-0 overflow-hidden` y clipeaba el shell antes de que el `overflow-x-auto` de la raíz viera el desborde. Plan: `docs/superpowers/plans/2026-08-09-rediseno-b-bandeja.md`. Ledger: `.superpowers/sdd/2026-08-09-rediseno-b-bandeja/progress.md`. **Pendiente de B:** el envío real desde el composer nunca se probó (`sendMessage` va derecho a Meta, sería un WhatsApp real) · comparación visual humana contra el prototipo · badge de no leídos y canal activo del avatar quedaron para D.

**G1 entregó:** el agente vendedor dejó de tener modelo y prompt hardcodeados — los lee de `agente_config` en cada turno. Consola en `/agente` con modelo, instrucciones de negocio en texto libre, tono/largo/emojis, descuento, límites técnicos, tope de gasto, política de kill switch y horario con timezone. Tabla append-only versionada, rollback que crea versión nueva sin revivir la vieja, auditoría que guarda nombres de campos y nunca valores, prompt en 4 bloques con las reglas inviolables al final. **Pendiente de G1: review de rama completa y E2E real de WhatsApp — ninguno se hizo.**

**Lecciones de proceso, aplicables a todo lo que siga:**

1. **Los defectos de layout no se encuentran leyendo diffs.** Los dos defectos de plan de A y el bug de la política `seguir` en G1 los encontró alguien midiendo anchos o clickeando. Un `<main className="flex ...">` que se leía correcto aplastaba las 7 pantallas a 236px de 1218 disponibles. Toda tarea de layout lleva verificación medida en navegador como criterio de aceptación.
2. **El review de rama completa encuentra lo que los reviews por tarea no pueden.** En A descubrió que `src/lib/ui/` estaba construido, testeado y sin un solo consumidor mientras las pantallas seguían pintando con la paleta vieja.
3. **Un mock que acepta cualquier schema esconde incompatibilidades con la API real.** `update-lead-twin` no completó una sola ejecución entre Slice 1 y el 2026-08-07 sin que nadie lo notara, porque los tests usan `MockLanguageModelV3`. Se arregló creando `tests/integration/llm-schemas.openai.test.ts`… **y esa suite se pudrió en silencio**: G1 le agregó un parámetro obligatorio a `makeLlmFactory` y nadie la volvió a correr hasta el 2026-08-15. Una red que nadie ejecuta no es una red. Todo cambio a un schema que viaja a Structured Outputs se verifica corriéndola, no leyéndola.
4. **No correr `npm run build` con el dev server levantado**: corrompe `.next/` y el navegador queda colgado con skeletons de `loading.tsx` en rutas no relacionadas. Se arregla matando el árbol de procesos y borrando `.next`.
5. **Los briefs no se regeneran solos.** Si se corrige el plan a mitad de ejecución, hay que volver a extraer el brief.
6. **Con el panel del navegador sin componer frames (`document.hidden`), React no revela los boundaries de Suspense**: `/inbox/[leadId]` se queda clavado en el skeleton de `loading.tsx` para siempre y las navegaciones soft no completan. Se confunde con `.next/` corrupto y no lo es. Se puede medir igual pidiendo el HTML del server por `fetch` e inyectando la raíz de la página en el slot del panel: el layout computa de verdad y los anchos dan los mismos números que el árbol real.
7. **Verificar por uso, no por existencia.** Un componente quedó escrito, testeado y sin un solo consumidor, y se reportó como terminado porque el archivo estaba ahí. El `grep` del nombre devolvía una sola línea: su propia definición. Un componente que no aparece importado en ninguna pantalla no está hecho. La verificación es "quién lo usa", no "existe".
8. **Un comentario con números tiene que ser reproducible.** Dos veces en esta sesión un comentario afirmó medidas —anchos, conteos— que no daban al volver a medirlas. Un número en un comentario es una afirmación de hecho que nadie va a re-chequear: o se deja el comando que lo produce, o no se escribe el número.
9. **Con un agente trabajando en el árbol, `git add` va con rutas explícitas, nunca `-A`.** Un `git add -A` se lleva los archivos a medio escribir del otro agente al índice; el hook `pre-commit` typechequea todo y frena el commit, y desenredar el índice cuesta más que haber listado las rutas. Vale también para `git commit -a` y `git stash` sin `--`.
10. **Los integration tests corren contra el stack local: `npm run test:integration:local`.** Estuvieron congelados meses porque `SUPABASE_TEST_URL` apuntaba al mismo proyecto que la app y la suite vacía 17 tablas: correrla era borrar crm-dev. La guarda fail-fast de `npm run test:integration` evitaba el TRUNCATE, pero no validaba nada. La salida no era un segundo proyecto en la nube sino `supabase start` (regla 6): `scripts/con-stack-local.mjs` apunta la suite a `127.0.0.1`, **aborta si alguna URL no es de loopback** y re-siembra al terminar. `npm run test:integration` a secas sigue prohibido (§6). Ojo: vacía también el stack que usan los demás agentes; no se corre mientras otro esté probando E2E ahí.
11. **Un wrapper de lock no prueba exclusión mutua.** La primera versión de la Task 7 envolvió el merge en `SessionLock`, pero producción inyectaba `NoopSessionLock`; tests y typecheck verdes no cerraban ninguna carrera. Una transición multi-tabla crítica debe compartir transacción y locks en Postgres, no solo una interfaz con nombre correcto.
12. **PostgREST corta en 1.000 filas y no avisa.** `productos.list({activo:true})` devolvía 1.000 de 19.731 ordenados alfabéticamente, así que para el agente Hyundai, KIA, Mazda, Nissan y Toyota no existían: respondía "no tenemos" sin un error en ningún log. Un `.list()` sin `.range()` explícito **miente sobre el total** en cuanto la tabla crece. Filtrar en memoria lo que la DB puede filtrar no es solo lento: cambia el resultado. Y el arreglo anterior había funcionado **por casualidad**, porque `CH AVEO` caía dentro de las primeras 1.000 filas — verificar con un caso que esté fuera del prefijo alfabético.
13. **Un fixture vacío puede tapar un bug que solo aparece con datos.** El test del vehículo pasaba con una sesión recién creada y falló contra la sesión real: el prompt decía "devolvé solo lo que cambia" y el vehículo no está en el snapshot que ve el modelo, así que no tenía con qué comparar y lo omitía. Los campos que viven **fuera** del snapshot necesitan instrucción explícita, y la prueba tiene que correr contra un estado ya poblado, no contra uno en blanco.
14. **La única prueba que vale de un cambio de comportamiento es dispararlo de verdad.** Los dos bugs de esta sesión los reportó el dueño usando la app, no los encontró la suite. `curl` al dev server de Inngest con el evento real (`POST /e/<key>`) + `SELECT` a Supabase cierra el lazo entero —Inngest, Next, OpenAI, Postgres— en dos comandos, sin tocar WhatsApp.
15. **El MCP `mcp__supabase__*` de esta máquina NO es crm-dev.** Apunta a otro proyecto (`fgqjwxpayndfeilzexid`, con migraciones de bodega y compras; comprobado con `get_project_url` y `list_migrations` el 2026-09-26). crm-dev (`emubzkouwvuzlrtsgorx`) se toca por el CLI enlazado (`supabase migration list`, `npm run db:push`) o se **lee** con `mcp__plugin_supabase_supabase__execute_sql` pasando ese `project_id`. Un `apply_migration` por el MCP equivocado escribe en la base de otro sistema.
16. **No se aplican migraciones mientras haya un agente que pueda estar escribiendo una.** Dos veces aparecieron archivos nuevos en `supabase/migrations/` entre el dry-run y el push: lo que se revisó no era lo que se iba a aplicar. Primero se frena a los agentes, después `supabase db push --dry-run`, se compara la lista y recién ahí se aplica.
17. **`npm run db:gen-types` falla con `Unauthorized` en esta máquina.** La versión vieja redirigía con `>` y la shell truncaba `types.gen.ts` antes de que el CLI fallara, rompiendo el typecheck de todo el proyecto. `scripts/gen-types.mjs` escribe a un temporal y solo reemplaza si el CLI salió con 0 y la salida contiene `export type Database`. Mientras el CLI no autentique, los tipos se generan con `generate_typescript_types` del MCP de solo lectura (`mcp__plugin_supabase_supabase__*`, `project_id` de crm-dev) y se copian a mano.
18. **Next 16 imprimía en el log de desarrollo los argumentos de las Server Actions, contraseñas del login incluidas.** Se apagó con `logging: { serverFunctions: false }` en `next.config.ts`, fijado por `tests/unit/next-config.test.ts`. Un log de dev también es un lugar donde vive PII (regla 9).
19. **El typecheck se volvía inestable con el dev server del stack local corriendo.** `next dev` reescribe `next-env.d.ts` (ignorado por git) apuntando a los tipos de su `distDir`, y el del stack local usa `.next-local`. `tsconfig.json` ya no incluye `next-env.d.ts`, excluye `.next-local`, y las dos referencias globales de Next que sí se usan viven en `src/types/next-globales.d.ts` (commit `3d8dcf4`). Si el typecheck da errores en tipos de `.next*`, el culpable es ese archivo, no el código.
20. **Un test que falla de a ratos por carga no se arregla subiendo el timeout a ciegas.** El `import()` del grafo del motor tarda 2,2 s solo y 14 s con la suite + `tsc` + eslint en paralelo (medido en `tests/helpers/carga-pesada.ts`, con los comandos para reproducirlo). `cargaPesada()` lo paga una vez por archivo en un `beforeAll` con `TIMEOUT_CARGA_PESADA_MS`. Un test lento por carga usa ese helper; uno lento por otra cosa se investiga.
21. **Stack local aislado: Supabase en Docker (API 55321, Postgres 55322), la app en 3002, Inngest en 8298 y un mock de la Graph API en 55390.** Sirve para todo lo que no debe tocar crm-dev, Meta ni OpenAI: E2E del pipeline, flujos, difusión y los integration tests. Nada de `.env.local` se cuela (el lanzador anula esas claves). `supabase db reset --local` falla siempre por una migración: se usa `npm run stack:reset`. Cómo levantarlo, sembrarlo y simular entrantes: `docs/runbooks/como-correr-el-crm.md` §4.1.

**Acción previa (sesión 2026-08-08):** **Rediseño "sala de control" — sub-proyecto A (base visual) COMPLETO**, rama `rediseno-a-base-visual` (11 commits, `88fd1cf..fd9319a`). Handoff de diseño descompuesto en 7 sub-proyectos A-G (`docs/superpowers/specs/2026-08-07-rediseno-a-base-visual-design.md` §1); **G se solapa con la fase 11 Intents+Reglas — tratar como un solo trabajo**. A entregó: tokens del handoff sobre los nombres semánticos de shadcn (los ~30 componentes vendorizados adoptan el diseño sin editarlos) + tokens propios en `@theme` · modo oscuro forzado · alias de íconos sobre lucide (`src/components/icons.ts`; se descartó Material Symbols para no abrir la CSP de B3) · lógica pura en `src/lib/ui/` con la regla del embudo (`perdido`/`requiere_humano` son desvíos, NO pasos 7 y 8) · 5 primitivas compartidas · SideNav de 222px · shell del panel · raíz redirige a `/inbox`. Ejecutado con subagent-driven-development: 9 tareas, cada una con revisión independiente. **2 defectos del plan detectados por el proceso:** (1) la secuencia Task 6→7 era incommiteable porque el hook `pre-commit` typechequea todo el proyecto — se fusionaron en un commit; (2) `<main className="flex ...">` convertía el main en contenedor flex y rompía las 7 pantallas del panel (medido: `/metricas` 236px de 1218 disponibles, `/inbox` recortado sin scrollbar) — lo encontró un revisor midiendo en el navegador, no leyendo el diff. **Pendiente de A:** comparación visual humana contra el prototipo `CRM Repuestos v2.dc.html` (los chequeos fueron programáticos sobre el DOM, sin capturas) · 5 SVG huérfanos en `public/` de la plantilla de Next. **Siguiente sub-proyecto: B — Bandeja unificada de 3 paneles.**

**Acción previa (sesión 2026-08-07):** **Slice 4b — cadena WhatsApp E2E real validada.** Creds cargadas (OpenAI org verificada con llamada real · app Meta `Crm Genuino` 1570589244491707 + número de prueba `+1 555 667-7618` phone_number_id `1278451868684287` + WABA `906018605389495` · token de usuario del sistema sin caducidad). Outbound OK (`scripts/smoke-meta-send.mjs`, plantilla `hello_world` entregada). Inbound OK vía túnel cloudflared: handshake 200 · HMAC rechaza 401 sin firma · `messages` suscrito a nivel app Y de WABA (faltaba el segundo — los mensajes iban a la consola de Meta). Pipeline completo verde: lead + conversación + 4 mensajes + sesión + 2 `tool_executions`, agente responde por WhatsApp. **3 bugs de fondo encontrados y arreglados:** (1) `inngest.send()` iba a Inngest Cloud con key dummy → 401 → webhook 500 → Meta reintentaba; fix `INNGEST_DEV` + var agregada a `env.ts`/example — `NODE_ENV=development` NO alcanza. (2) los 3 schemas LLM eran incompatibles con Structured Outputs strict (`format:uri` de `.url()` · `propertyNames` de `z.record()` · campos `.optional()` ausentes de `required`) → **`update-lead-twin` nunca completó una ejecución desde Slice 1**, invisible porque los tests usan `MockLanguageModelV3`; fix `strictJsonSchema:false` (`structured-output.ts`) + suite de contrato contra OpenAI real (`tests/integration/llm-schemas.openai.test.ts`). (3) vars opcionales declaradas vacías tumbaban el boot (`.optional()` de Zod no acepta `""`); fix `stripEmpty()` en `env.ts`. Además: modelo OpenAI configurable por workflow (`OPENAI_MODEL*` + `resolveLlmModels` con validación fail-fast contra `OPENAI_PRICING`), pricing actualizado con 5 modelos verificados, `inngest:dev` con `-u` (auto-discovery escanea 3000, la app corre en 3001). **Pendiente: catálogo vacío** (`productos`/`intents`/`reglas` en 0 — el agente no tiene qué vender). Detalle Slice 1 histórico → `docs/changelog.md`.

**Acción previa (sesión 2026-07-16):** cierre fase 10 Leads (T10 re-review clean + T11: CI verde tras 2 fixes de entorno [eslint ignore `.superpowers/**` + coverage exclude UI fases 9-10 por política browser/E2E] · final whole-branch review fable "ready with fixes" → 3 must-fix aplicados (`ec5ddfa`+`b91b2e7`) → re-verdict "Yes" · docs).

**PENDIENTE USUARIO antes del deploy de workflows y difusión** (detalle en `docs/next-session.md`): suscribir `account_update` en Meta · cargar `DIFUSION_BAJAS_HMAC_CLAVES` y `DIFUSION_BAJAS_HMAC_VERSION_ACTIVA` en `.env.local` y en Vercel (sin ellas las bajas no se pueden registrar ni consultar) · agregar `META_GRAPH_API_BASE_URL` a `.env.local.example` (un hook bloquea que lo edite un agente) · decidir qué hacer con los puertos de Inngest local expuestos en todas las interfaces · confirmar las decisiones de "Delegar al agente" y del auto-handoff. El segundo proyecto Supabase para tests **ya no hace falta**: lo reemplazó el stack local (lección 10). Pendiente manual de siempre: dashboard Supabase → Advisors (CLI 403 en free tier).

**Siguiente sub-paso:** **(1) push de `master` y de `feat/workflows-difusion`, y PR** — hoy nada de esto está en el remoto; **(2) deploy**: las migraciones ya están en crm-dev, falta el código. En paralelo: **(3) el documento de macheo del dueño** para volver a cargar el catálogo; **(4) los hallazgos abiertos** de `docs/next-session.md` (teléfono en claro en `difusion_envios`, tope de gasto diario sin aplicar, horas en la zona del navegador, reactivación fuera de ventana); **(5) comparación visual humana**, que nunca se hizo; **(6) `EXPLAIN`** con volumen representativo; **(7) `revert_lead_merge` nunca se ejecutó**.

### Tabla de progreso

| Fase                                                       | Estado                   | Notas                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0-6 — Foundation mock-first                                | 🟢 completo              | Bootstrap → workflows. 236/236 tests pre-REPAIR. Ver `docs/changelog.md`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| REPAIR R1-R12                                              | 🟢 completo              | 11 migrations, +135 tests, error taxonomy + idempotency + audit                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Pre-Slice docs (failure-modes/idempotency/cost-budget)     | 🟢 completo              | Brief design docs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Pre-Slice 1 hardening A1-A10 (Camino A+)**               | 🟢 completo              | 13 migrations + error taxonomy + CI + lefthook + zod env + tsconfig strict++ + ESLint boundaries + Prettier + docs split + dep audit                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Pre-Slice 1 Industrial Hardening B0-B6+B+R (Camino B+)** | 🟢 completo              | Business spec lock + migration timestamps + outbox B2 + security headers + Upstash rate limit + RLS CI gate + threat model + perf tuning + SLO + runbooks + backup strategy. 16 issues HIGH del audit profundo. 423/423 tests.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Slice 1 — Real DB + LLM + Meta sandbox**                 | 🟢 funcional             | 7.1-7.6 ✅. 7.7.A LLM factory ✅. 7.8 Inngest serve ✅. 7.9 webhook Meta ✅. 7.10 E2E smoke Path A ✅. 7.7.B Pino + 7.7.C OTel + 7.7.D Sentry pendientes (pre-Slice 4 launch).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Slice 2 — UI + Server Actions**                          | 🟡 funcional             | Core 8.x, Productos, Leads, Intents+Reglas y Tags+Métricas aplicados. Realtime en el Inbox **no existe**: usa `RefreshPoller` cada 5 s (sí hay Realtime en corridas y en la campanita de avisos). `/ajustes` construida (ver fila Workflows).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Rediseño "sala de control" A-G2**                        | 🟢 aplicado              | A base visual · B bandeja de 3 paneles · C ventana de 24 h y estados de entrega · D triage · E Twin con procedencia y edición · F métricas en 3 cortes · G1 config del agente · G2 motor de reglas y escalado. Handoff en `docs/handoff-rediseno-README.md` (entró tarde: varias pantallas se construyeron contra specs derivados y hubo que auditarlas después). **Sin revisión visual humana.**                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Slice 3 — Auth + RLS audited**                           | 🟢 completo              | 9.1 auth+login+proxy ✅ · 9.2 43 policies + suite RLS 11/11 ✅ · 9.3 panel authed client ✅ · 9.4 STRIDE + security review ✅. Spec+plan en `docs/superpowers/`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Slice 4a — Hardening pre-launch**                        | 🟢 completo              | 10.1 Pino ✅ 10.2 Sentry ✅ 10.3 OTel ✅ 10.4 /api/health ✅ 10.5 CostTracker Upstash ✅ 10.6 purge real ✅ 10.7 reactivación real ✅. Spec+plan en `docs/superpowers/`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Slice 4b — Deploy + soft launch**                        | 🟡 en progreso           | **Conversación real de WhatsApp completa 2026-08-15** (ida y vuelta con el agente, 21 mensajes, tool calls, costo persistido). Destapó 5 bugs de fondo, los 5 arreglados. **Desplegado 2026-08-25** en `https://crm-wine-one-38.vercel.app` con webhook público estable (se acabó el túnel efímero) y `/api/health` en `ok` — el deploy destapó 7 variables placeholder, cada una invisible hasta arreglar la anterior. **Sentry activo, verificado y con alerta por mail.** Falta: **catálogo** (vacío a propósito, espera el documento de macheo del dueño) · templates Meta · número real · pen test. **Sin rate limit ni tope de gasto**: las vars de Upstash se eliminaron por ser placeholders que tumbaban el webhook — requisito antes de publicar el número, no antes. **Upstash queda fuera por decisión del dueño: no quiere tope de gasto.** |
| **Etiquetas**                                              | 🟢 completo              | Administración en modal desde Leads (`/tags` borrada) · `reglas_etiqueta` + motor `etiquetasPara` · pantalla en la consola del agente. Probado end-to-end contra `crm-dev`: la regla cuelga la etiqueta y no revive la que sacó una persona. **Sin QA visual.** Diseño: `docs/superpowers/specs/2026-08-15-etiquetas-design.md`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Rendimiento**                                            | 🟡 read path aplicado    | Se eliminó el N+1 y el read model SQL acotado ya está en `crm-dev`; falta smoke autenticado, `EXPLAIN` y volumen representativo. Ver `docs/next-session.md`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Meta API research**                                      | 🟢 reporte completo      | Capacidades WA/IG/Messenger/Pages/Marketing/Business Management investigadas con fuentes oficiales; ledger y docs operativas reconciliados. Falta decisión del dueño; no hay implementación ni validación de activos IG/FB.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Workflows**                                              | 🟡 funcional, sin deploy | Editor, corridas en vivo, historial, diff de publicación y plantillas. Bloques que corren: disparadores (incluido Difusión respondida), mensajería (texto, plantilla, botones, lista, imagen, ubicación), CRM (etiqueta, etapa, escalar, vendedor, round robin, campo del Twin), lógica (condición, según el valor, ir a, esperas, detener), Avisar al equipo y Delegar al agente. Interceptar al agente y categoría Servicio/Marketing. **No corren:** Clasificar, Extraer, Sentimiento, Spam, Enviar documento y los 5 bloques de Difusión (el motor corre un flujo por lead y esos operan sobre un grupo). **Sin comparación visual humana.** PRD: `docs/prd-workflows.md`.                                                                                                                                                                           |
| **Difusión**                                               | 🟡 funcional, sin deploy | Audiencia con exclusiones tipadas, pre-vuelo, canary, prueba a mi número, motor por tandas con reserva CAS, estados por webhook, frenado por 368/131031/131048, bajas en HMAC irreversibles, texto libre a la ventana abierta y audiencia dinámica. Probado E2E contra el stack local y el mock de Meta; **nunca contra Meta real**. Falta cargar `DIFUSION_BAJAS_HMAC_*` antes del deploy. PRD: `docs/prd-workflows-difusion.md`.                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Stack local aislado**                                    | 🟢 aplicado              | `npm run stack:up` / `stack:seed` / `dev:local` / `mock:meta` / `inngest:local` / `test:integration:local`. Supabase en Docker + app 3002 + Inngest 8298 + mock de la Graph API 55390, todo en loopback salvo 3 puertos de Inngest que no tienen flag de bind. Runbook: `docs/runbooks/como-correr-el-crm.md` §4.1.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

**Métricas actuales (medidas 2026-09-26 en `feat/workflows-difusion`, con cambios sin commitear de otro agente en el árbol):** `npx vitest run` → **4394 tests pasan en 333 archivos**; fallan 3 tests de `tests/unit/_tmp/repro-reloj.test.ts`, un repro temporal sin trackear del agente que arregla un test inestable, no parte de la suite · `npm run typecheck` → exit 0 · `npm run lint` → exit 0 (solo los warnings deprecados de boundaries) · coverage **no se recalculó** desde el 2026-08-13 · suite de contrato contra OpenAI: no se corrió en esta etapa (según los reportes, ningún schema de Structured Outputs cambió) · **88 migraciones, las 88 en el ledger de `crm-dev`** (`ls supabase/migrations/*.sql | wc -l` y `supabase migration list`; la última es `20260926180000`). Remoto privado: `https://github.com/Leonardo-A1varez/crm.git`; `origin/master` = `91de606`, **27 commits sin pushear en `master` y 13 más en la rama**.

> **Los integration tests ya no están congelados: corren contra el stack local con `npm run test:integration:local`** (lección 10). Motivo del congelamiento: `SUPABASE_TEST_URL` apuntaba al proyecto de la app y la suite vacía 17 tablas. La solución fue una base local en Docker, no un segundo proyecto en la nube. **Última corrida registrada, 2026-09-25:** 473 pasan, 2 fallan, 4 saltados, sobre 479 tests en 30 archivos; las 2 fallas eran de `difusion-envios` porque la migración `20260925211000` todavía no estaba aplicada en local. **No se volvió a correr completa desde entonces.** Sin archivo de integración, es decir sin contrato contra Postgres dentro de la suite: `workflows`, `workflow-runs` (incluido `delegacionesActivas`), `turnos-interceptados`, `notificaciones` y `workflow-plantillas-sin-sesion`. Algunos se probaron a mano contra el stack local (por ejemplo, 18/18 chequeos de los repos de difusión con texto libre); eso no reemplaza el contrato. `npm run test:integration` **a secas** sigue apuntando a lo que diga `.env.local`: no se usa.
>
> **Excepción:** `tests/integration/llm-schemas.openai.test.ts` no toca la base —solo llama a OpenAI— y sí se corre, filtrando por archivo para que ningún test de DB se cargue: `npx vitest run -c vitest.integration.config.ts tests/integration/llm-schemas.openai.test.ts`. Cuesta centavos y es obligatoria ante cualquier cambio de schema que viaje a Structured Outputs.

> **Cuando completes una acción, actualiza la tabla + "Última acción completada".**

### 2.1 Plan re-shape post-REPAIR (decisión 2026-05-12)

Plan original (Fases 7-14) reemplazado por **4 slices verticales** + **Pre-Slice 1 hardening A1-A10**. Razón: gap-analysis detectó 25 carencias post-Fase 6; foundation enterprise-grade antes de wireup real evita rework Slice 2-4.

| Slice | Duración | Scope                                                                                                                 |
| ----- | -------- | --------------------------------------------------------------------------------------------------------------------- |
| 1     | 3 sem    | Supabase project + branch + migrations + repos + LLM impls + Meta sandbox + Inngest serve + E2E smoke + observability |
| 2     | 2 sem    | UI completa + Realtime + Server Actions                                                                               |
| 3     | 1 sem    | Auth + RLS audited + STRIDE walkthrough                                                                               |
| 4     | 1 sem    | Cron real wireup + soft launch 10 leads                                                                               |

### 2.2 Inventario técnico actual (post Pre-Slice 1 hardening)

Lo que está LISTO en repo, agrupado por capa:

**Migraciones SQL** (**88 en total al 2026-09-26, las 88 aplicadas a Supabase crm-dev**, `supabase/migrations/`. Abajo se listan las 51 primeras; las 37 posteriores —permisos explícitos, campañas y ventas, motor de workflows, difusión, candados, Ajustes, mensajería rica, intercepción y notificaciones— se ven con `ls supabase/migrations`. Formato timestamp `YYYYMMDDHHMMSS_<name>.sql`, standard de Supabase CLI v2+). Las 16 de foundation:

```
20260512000001_init.sql                       extensions + enums + empresas/usuarios/leads/productos/lead_session + COMMENT empresas single-org
20260512000002_intents_rules.sql              intents/reglas/tags/lead_tags + CHECK hex tags.color
20260512000003_messages.sql                   conversaciones/mensajes/rule_executions
20260512000004_users_roles.sql                trigger auth.users → public.usuarios + helpers RLS
20260512000005_storage_buckets.sql            3 buckets privados
20260512000006_outbound_dedup.sql        (R2) mensajes.idempotency_key UNIQUE partial
20260512000007_tool_executions.sql       (R8) audit tool calls agente
20260512000008_session_extras.sql        (R9) lead_session.extras jsonb
20260512000009_session_summary.sql       (R10) lead_session.context_summary
20260512000010_admin_audit.sql           (R11) admin_actions
20260512000011_merge_candidates.sql      (R12) merge_candidates + status enum
20260512000012_inbound_dedup.sql         (A1)  mensajes(meta_message_id) UNIQUE partial
20260512000013_reactivation_dispatches.sql (A2) tabla cooldown enforcement
20260512000014_event_outbox.sql          (B2)  transactional outbox at-least-once delivery
20260512000015_fix_function_search_path.sql    fix advisor WARN search_path 4 helpers públicas
20260514000016_repo_helpers.sql               server_now() RPC helper para timestamp server-side (fix clock skew JS↔PG)
```

Las 22 que agregaron los slices 3-4, el rediseño, el checkpoint QA y el cierre de brechas:

```
20260714124024_slice3_rls_policies.sql        43 policies RLS admin/vendedor
20260714182011_slice4_health_grant.sql        grant server_now() a anon para /api/health
20260715140738_leads_delete_admin.sql         policy DELETE de leads solo admin
20260716001443_admin_actions_insert_admin.sql policy INSERT de admin_actions
20260808213309_agente_config.sql         (G1) config del agente, append-only, una sola activa
20260810011500_mensajes_estado_entrega.sql (C) enum enviado/entregado/leido/fallido + error
20260810011600_lead_session_procedencia.sql (E) procedencia jsonb por campo del Twin
20260810143000_turn_classifications.sql       qué intent resolvió cada turno del LLM (UNIQUE por mensaje)
20260810143100_lead_session_updated_at.sql    updated_at de la sesión ("hace 40 s" del Twin)
20260810150000_procedencia_extractor_y_etapa_alcanzada.sql  mensaje_origen_id/valor_anterior + etapa_alcanzada (rail congelado en los desvíos)
20260810161500_agente_config_escalado.sql     umbral de intents, palabras que escalan, cotización desde, timeout de tool
20260810190000_llm_usage.sql                  costo de IA persistido por turno → por conversación y por lead
20260810200000_tags_delete_admin.sql          policy DELETE de tags solo admin
20260810210000_lead_tags_delete.sql           policy DELETE de lead_tags (sacar una etiqueta de un lead)
20260810230000_leads_nombre_perfil_y_datos_extra.sql  nombre_perfil de Meta + datos_extra jsonb del lead
20260811120000_session_recordatorios.sql      recordatorios de seguimiento con fecha + índice de vencidos
20260811160000_mensajes_contenido_trgm.sql    índice GIN trigram sobre mensajes.contenido (buscador del Inbox)
20260812170131_inbox_active_summary.sql       RPC acotada del Inbox + índice sesión/fecha
20260812222808_qa_handoff_metrics.sql         timestamps Meta + handoff auditable + perfil lead nullable
20260813090000_server_now_search_path.sql     search_path seguro del RPC de tiempo
20260813163957_approve_lead_merge_transaction.sql merge administrativo atómico y auditable
20260813172558_fix_approve_lead_merge_lint.sql elimina variable PL/pgSQL muerta sin reescribir historial
```

Las 13 de identidad, vehículos, búsqueda del catálogo, nombre del lead y etiquetado automático (2026-08-14/16):

```
20260814120000_merge_audit_reversible.sql     payload_version 2: la auditoría guarda cómo deshacer la fusión
20260814150000_revert_lead_merge.sql          revert_lead_merge(): deshace una fusión aprobada. NUNCA SE EJECUTÓ
20260814180000_lead_identificadores.sql       teléfono/email/RUC/cédula del lead + backfill (excluye placeholders ig:/fb:)
20260814190000_merge_acumula_identificadores.sql payload_version 3: fusionar acumula identidad en vez de descartarla
20260814210000_leads_que_comparten_identificador.sql RPC del detector: duplicados por identidad, no por nombre
20260814230000_lead_vehiculos.sql             el auto se separa de la persona: marca/modelo/año/motor + placa + VIN, varios por lead
20260814240000_identificador_tipo_cedula.sql  cédula como tipo propio, distinto de RUC
20260814250000_comparten_identificador_con_vehiculos.sql el detector compara también por placa y VIN
20260814260000_merge_mueve_vehiculos.sql      payload_version 4: la fusión mueve los autos del perdedor
20260815140000_buscar_productos.sql           plegar_texto() + productos.busqueda generada + GIN trigram + buscar_productos() puntuada
20260815222914_backfill_nombre_desde_perfil.sql leads sin nombre toman el de Meta (trigger updated_at desactivado)
20260816014036_reglas_etiqueta_y_lead_tags_descarte.sql reglas_etiqueta + lead_tags marca en vez de borrar (quitada_at/quitada_por)
20260816023108_limpiar_ledger_de_operaciones_de_datos.sql saca del ledger 3 anotaciones de datos de prueba sin archivo
```

> **Trampa recurrente de este MCP, ya vista dos veces.** El nombre de archivo **no** es el timestamp en que se escribió: el MCP de Supabase registra la migración con su propio número y el archivo se renombró para coincidir con el ledger (`supabase_migrations.schema_migrations`). Si divergen, un `db push` desde un clon limpio la reaplica.

**Repositorios** (`src/server/repositories/`, interface + InMemory impl + Supabase impl + contract tests reusables):

```
leads · lead-session · lead-merge (RPC transaccional) · lead-identificadores · lead-vehiculos
conversations · messages · productos · intents · rules · rule-executions · tags · users
tool-executions · admin-audit · merge-candidates · reactivation-dispatches · event-outbox (B2)
agente-config · turn-classifications · llm-usage · session-recordatorios · handoff-events · metrics
reglas-etiqueta
```

**Los 25 con Supabase impl** (`<name>.supabase.repo.ts`) + contract reusable (`tests/repositories/<name>.contract.ts`) con fixtures inyectables para FKs (default strings preserva InMemory tests). Pattern detalle → commits Slice 1 7.4 (`91e711d`..`73337f6`).

> Tener impl de Supabase **no** es lo mismo que estar verificado contra Postgres: los integration tests están congelados (ver aviso arriba). Los 11 repos posteriores a `agente-config` solo corrieron contra las impl in-memory.

**Servicios** (`src/server/services/`, interface + Default impl + DI):

```
catalog-matcher · intent-classifier · rule-engine · twin-extractor · handoff
meta-api · ai-agent · conversation-summarizer · admin-audit · lead-merge-detector
event-bus (B2) · intent-batch-detector (interface only — handler en inngest/)
```

**LLM real impls** (`src/server/services/llm/`, OpenAI vía AI SDK v6):

```
openai-intent-classifier        generateObject + IntentClassificationSchema
openai-twin-extractor           generateObject + LeadTwinUpdateSchema
openai-conversation-summarizer  generateText (texto libre, threshold 20 turns)
openai-intent-batch-detector    generateObject + wrapper schema array intents
openai-ai-agent                 generateText + tool calling buscar_repuesto
pricing.ts                      re-export de `@/lib/agente/modelos` (11 modelos USD/1M, gpt-4o-mini default)
cost-tracker-bridge.ts          extract usage + record CostTracker
structured-output.ts            NON_STRICT_JSON_SCHEMA — sin esto la API rechaza los schemas
```

Wireup DI factory (`makeLlmFactory`, env-based real vs mock). En modo `real` **exige `configProvider`**: desde G1 el agente lee modelo y prompt de `agente_config` en cada turno.

**Inngest functions** (`src/inngest/functions/`, 12 total):

```
on-message-received           pipeline 10-step granular
on-status-received            estados de entrega de Meta (enviado/entregado/leído/fallido)
update-lead-twin              triggered by turn.completed — también escribe el auto en lead_vehiculos
detect-intents.batch          cron weekly sun 03:00 + manual
auto-handoff                  evaluate consecutive null intents
handoff-notification          avisa el escalado a humano
recordatorio-seguimiento      recordatorios con fecha del Twin
purge-old-sessions.cron       daily 04:00, 29d window
reactivation-predictor.cron   weekly mon 09:00 + cooldown DB
detect-merge-candidates       per-lead (lead/created) + global (cron daily 05:00 + manual)
dispatch-outbox-events.cron   cron */1 * * * * + manual (B2 at-least-once)
```

**Infraestructura inyectable** (`src/lib/` + `src/server/lock/`):

```
errors.ts                         DomainError jerarquía (6 classes) + isNonRetriable()
env.ts                            zod schema fail-fast (NODE_ENV != test)
observability/logger.ts           Logger interface + Noop/Console + child bindings
observability/cost-tracker.ts     CostTracker + daily cap + InMemory impl
feature-flags.ts                  FeatureFlags + Static/AllEnabled + 3 flags catálogo
server/lock/session-lock.ts       SessionLock + InMemory impl
server/db/client.ts               DbClientFactory real (Slice 1 sub-paso 7.3) — service-role + authed
server/db/uuid.ts                 isUuid(v) helper para early-return en findById Supabase
server/db/server-time.ts          serverNowIso(db) RPC helper (Slice 1 7.4) — fix clock skew
server/db/postgrest-errors.ts     mapPostgrestError 23505/23503/23502/23514/42501/PGRST301 → DomainError
```

**Tooling + DX**:

```
.github/workflows/ci.yml          quality job + audit job
lefthook.yml                      pre-commit + commit-msg + pre-push
commitlint.config.cjs             Conventional Commits enforced
.lintstagedrc.cjs                 eslint --fix + prettier --write
.prettierrc.json                  + prettier-plugin-tailwindcss
eslint.config.mjs                 next + boundaries (12 architecture zones)
tsconfig.json                     strict + noUncheckedIndexedAccess + ES2022
tsconfig.tests.json               separado, relax indexedAccess para tests
vitest.config.ts                  coverage v8 threshold 80/75/80/80
package.json scripts              dev/build/lint/typecheck/test:coverage/format/db:*/inngest:dev/ci
```

**Docs vivos** (`docs/`):

```
architecture.md          capas + patterns + flujo webhook→reply
data-model.md            51 migraciones + enums + tablas + índices + RLS aplicadas
workflows.md             12 funciones Inngest + catálogo de eventos + retries
idempotency.md           keys por op + race tolerance
failure-modes.md         tabla workflow → modo falla → retry/skip
cost-budget.md           targets LLM + pricing + kill switch
dependency-audit.md      pins + overrides + accepted risks + re-audit cadence
changelog.md             histórico completo hasta el cierre de brechas 2026-08-13
```

---

## 3. Decisiones bloqueadas (no re-preguntar)

Lista cerrada. No re-abrir sin pedido explícito.

### Producto

- **Single-org self-hosted white-label**. NO multi-tenant SaaS.
- **Target market: Latam aftermarket parts mid-large** (Brasil/México/Argentina/Chile/Colombia/Perú).
- **Deployment model: 1 instalación per cliente empresa.** Cada empresa cliente paga licencia + setup + ops mensual.
- **Pilot tier:** 30 vendedores / peak 50 msg/sec / ~5K leads/mes per instancia. Tiers Mediana/Grande post-launch (`docs/business-plan.md`).
- Conversaciones cortas (5-15 mensajes), repuestos automotrices exclusivo.
- Sin pipeline kanban, sin deals, sin tareas.
- Multi-sesiones históricas por lead, **máximo 1 sesión activa simultánea por lead**.
- Purge cron diario: sesiones cerradas con `closed_at < now() - 29 días` se borran (CASCADE mensajes + cleanup Storage).
- Tags: auto vía workflows + manuales editables.
- Comprobante pago: solo URL imagen. Sin monto/verificación.
- Lead Twin = sólo campos dinámicos de la sesión actual (`lead_session`).
- Productos: `codigo_interno` único de la casa + `sku_proveedor` opcional.
- Foto-to-SKU **diferido a v2**.
- **Multi-canal restrictions:** WhatsApp + IG + FB Messenger tienen caps + windows distintos por plataforma. Detalle → `docs/meta-platform-limits.md`.
- **Compliance Latam:** LGPD Brasil + Ley 25.326 Argentina + LFPDPPP México + Ley 19.628 Chile + Ley 1581 Colombia. Right-to-erasure obligatorio. Detalle → `docs/data-retention.md`.

### Multi-canal

- Reconocimiento mismo lead via `leads.telefono` (WA) o `meta_user_ids` jsonb (IG/FB).
- Merge manual desde UI cuando IG/FB no exponen teléfono.
- UI estilo WhatsApp Web: ícono grande canal activo + íconos pequeños canales vinculados.

### Stack

- **Next.js 16 App Router** + RSC + Server Actions. **Sin NestJS.**
- Tailwind v4 + shadcn/ui.
- Supabase (DB + Auth + Storage + Realtime). Única DB.
- Inngest (workflows + cola + cron). Free → Hobby cuando topea.
- **Vercel AI SDK** (`ai` + `@ai-sdk/openai`) sobre GPT-4.x. AI Gateway diferido post-Slice 1.
- Meta Cloud API oficial. No BSP, no Baileys.
- Zod validación, Vitest tests, Prettier formato, ESLint + boundaries arquitectura.
- Hosting: Vercel.
- Pre-Slice 1 tooling: lefthook hooks, commitlint, @vitest/coverage-v8, GitHub Actions CI.

### Arquitectura

- Capas: API/Action → Service → Repository → DB. **Nunca saltar capas.**
- Repos: interface + impl (in-memory tests, Supabase prod).
- Services no tocan DB directo; DI repos.
- Inngest functions sólo orquestan, delegan a services.
- Webhook Meta responde 200 inmediato + emite event Inngest.
- Service-role vs authed clients separados. ESLint boundaries enforce.

### Integraciones reales

- Pre-Slice 1 = todo mock in-memory.
- Slice 1 = swap impl por reales (Supabase + AI SDK + Meta).
- Razón: validar lógica + UI sin depender de credenciales/cuotas.

### RLS (planificadas Slice 3)

- Admin: RW sobre TODO.
- Vendedor: RW sobre leads/sesiones/conversaciones/mensajes/lead_tags/comprobantes Storage.
- Vendedor: solo R sobre productos/intents/reglas/tags/usuarios.

---

## 4. Convenciones de código

### Idioma

- UI, comentarios, commits: **español**.
- Identificadores técnicos genéricos: inglés (`leadId`, `messageRepo`, `useEffect`).
- Identificadores de dominio: español (`lead_session`, `bloqueador`, `motivo_perdida`).

### TypeScript

- `strict: true` + `noUncheckedIndexedAccess` + `noFallthroughCasesInSwitch` + `noImplicitOverride` + `forceConsistentCasingInFileNames`.
- No `any`. Si imprescindible, comentar por qué.
- Tipos de dominio en `src/types/`. Generados Supabase en `src/server/db/types.gen.ts` (Slice 1 sub-paso 7.3).
- Inferir tipos donde sea posible.

### Validación

- Zod en TODOS los inputs HTTP (API routes + Server Actions).
- Schemas en `src/lib/validation/`.
- Tipos derivados via `z.infer<typeof Schema>`.
- Env validation via zod fail-fast (`src/lib/env.ts`).

### Componentes React

- Server Components por defecto. `'use client'` sólo cuando hay interactividad.
- Composición sobre herencia. Props tipadas con interfaces.
- shadcn como base; extender vía composición, no editar `src/components/ui/`.

### Tests

- Vitest. Coverage threshold 80/75/80/80 (statements/branches/functions/lines).
- Repos mockeados con impl in-memory.
- Contract tests `runXContract(makeRepo)` reusables in-memory ↔ Supabase.
- Sin mocks en código de producción.

### Commits

- Conventional Commits (enforced via commitlint).
- `feat:` `fix:` `chore:` `refactor:` `test:` `docs:` `perf:` `build:` `ci:` `revert:` `style:`.
- Subject ≤72 chars, español.
- Body sólo si el "por qué" no es obvio.

### Estructura de imports

1. Bibliotecas externas (react, next, zod…)
2. Imports absolutos `@/...`
3. Imports relativos `./...`
4. Imports de tipos al final con `import type`

### Architecture zones (eslint-plugin-boundaries)

- `app/**` puede importar: components, server-services, server-auth, lib, types, hooks, stores.
- `components/**`: components, lib, types, hooks, stores.
- `inngest/**`: server-services, server-repositories, server-db, server-lock, lib, types.
- `server-services/**`: server-repositories, server-lock, lib, types.
- `server-repositories/**`: server-db, lib, types.
- `lib/**`: lib, types.
- Resto: ver `eslint.config.mjs`.

---

## 5. Cómo trabajar paso a paso

1. **Anunciar** sub-paso a ejecutar.
2. **Ejecutar** acción mínima (un solo sub-paso).
3. **Validar** según criterio plan.
4. **Reportar** 2-3 líneas.
5. **Esperar** confirmación antes del siguiente. No encadenar varios sin pausa.

### Excepciones

- Sub-pasos triviales atómicamente relacionados (deps install).
- Usuario dice explícitamente "haz toda la fase X" o "no preguntes en cada paso".

### 5.1 Desarrollo pantalla por pantalla (decisión 2026-08-16)

**Se trabaja una pantalla a la vez, de punta a punta, y no se salta a otra hasta cerrarla.** Cada sesión tiene una sola pantalla como tema. Si aparece algo de otra pantalla, se anota y se deja — no se arregla de paso.

Motivo: las sesiones anteriores mezclaban repos, workflows, docs y tres pantallas a la vez. Todo avanzaba y nada quedaba terminado, y al retomar había que reconstruir de memoria en qué estado había quedado cada cosa.

**El ciclo:**

1. El dueño nombra la pantalla y qué quiere de ella.
2. Se trabaja solo en eso, con el paso a paso de §5.
3. **Cuando el dueño dice que la pantalla está terminada**, el agente prepara el cierre **en la respuesta siguiente**, sin que haya que pedirlo:
   - todo commiteado, árbol limpio;
   - `npm run typecheck`, `npm run lint`, `npm run test` corridos y **reportados con el número real**;
   - `npm run test:integration:local` si se tocaron repos o SQL;
   - lo que quedó **sin verificar** dicho en voz alta, sobre todo si no hubo revisión visual.
4. `/context` para arrancar la próxima pantalla con contexto limpio.

**Estado de las pantallas** (actualizar al cerrar cada una):

| Pantalla  | Estado                                                                                                                                                                                                                            |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inbox     | 🟢 cerrada 2026-08-16 — última entrega: filtro de Seguimiento con contador y orden por fecha                                                                                                                                      |
| Leads     | 🟢 cerrada — identidad, vehículos, fusión/deshacer, etiquetas en modal                                                                                                                                                            |
| Agente    | 🟢 cerrada — config del agente, reglas IF/THEN y reglas de etiquetado                                                                                                                                                             |
| Métricas  | 🟡 trabajada sin cierre formal — ventas, rango de fechas libre y campañas (`3aae184..cce1f2a` en master); no hay registro de que el dueño la diera por terminada                                                                  |
| Productos | ⚪ pendiente — filtrado del catálogo y parámetros de cuánta info se procesa. Bloqueada por el documento de macheo del dueño                                                                                                       |
| Ajustes   | 🟡 construida, sin cierre — 5 pestañas: salud del número (escalera de sanciones desde `account_update`, uso del cupo en 7 días, rol por número), empresa, usuarios y roles, horario, topes. Empresa y horario son de solo lectura |
| Workflows | 🟡 construida, sin cierre — listado, galería de plantillas, editor, diff de publicación, historial y corrida en vivo. Pendientes en `docs/next-session.md`                                                                        |
| Difusión  | 🟡 construida, sin cierre — listado, asistente (audiencia, mensaje, pre-vuelo) y envío en curso/cerrado. Los pasos 2 y 3 del asistente y una difusión «enviando» con Detener no se midieron en el QA visual                       |

**Sobre los datos de prueba:** se van borrando a medida que dejan de hacer falta. Al 2026-08-16 `crm-dev` tiene **un solo lead, el real** (Leonardo Alvarez, 20 mensajes de WhatsApp) más la etiqueta `Pide factura` con su intent y su regla, que se conservan porque son la única demostración funcionando del etiquetado automático.

### Cuando falla un sub-paso

- No avanzar.
- Diagnosticar causa raíz.
- Proponer fix al usuario.
- Aplicar tras confirmación si toca config global o instala algo nuevo.

---

## 6. Qué NO hacer

- ❌ Escribir código antes de confirmar scope/stack/estructura con usuario.
- ❌ Conectar Supabase/OpenAI/Meta/Inngest reales hasta Slice 1+.
- ❌ Proponer DBs alternativas a Supabase.
- ❌ Agregar deps sin justificación + aprobación.
- ❌ Crear docs adicionales sin pedir.
- ❌ Commitear sin que usuario lo pida.
- ❌ Saltar capas (API → DB directo).
- ❌ Emojis en código/commits salvo que usuario pida.
- ❌ Comentarios obvios. Sólo "por qué" no obvio.
- ❌ Backwards-compat shims, abstractions prematuras, handling de casos imposibles.
- ❌ **`npm run test:integration` mientras `SUPABASE_TEST_URL` apunte al proyecto de la app.** Vacía la base de dev. Se usa `npm run test:integration:local`.
- ❌ **`mcp__supabase__apply_migration` ni `execute_sql` para crm-dev.** Ese MCP apunta a otro proyecto (lección 15).
- ❌ **`npm run db:push` con un agente que pueda estar escribiendo migraciones** (lección 16).
- ❌ **`npm run build` con el dev server levantado.** Corrompe `.next/`.
- ❌ **`git add -A` / `git commit -a` con un agente trabajando en el árbol.** Rutas explícitas.
- ❌ Dar por hecho un componente porque el archivo existe. Verificar que alguien lo importe.
- ❌ Escribir un número en un comentario sin dejar cómo se reprodujo.

---

## 7. Cómo retomar sesión nueva

1. Lee `README.md` (product overview).
2. Lee este `AGENTS.md` completo (reglas + estado).
3. **Lee `docs/next-session.md` para resume instructions step-by-step + acción pendiente usuario.**
   - **Para levantar el proyecto y entender por qué cada proceso está ahí: `docs/runbooks/como-correr-el-crm.md`.** Explica qué llamada sale y cuál entra —que es lo único que decide si hace falta ngrok—, las variables obligatorias, las dos bases (la de la nube y la local de Docker que solo usan los tests), cómo disparar el pipeline sin mandar un WhatsApp real, y la tabla de síntomas.
4. `docs/changelog.md` para histórico detallado si necesitas contexto fases pasadas.
5. **`docs/handoff-rediseno-README.md` es la spec de las 4 pantallas del rediseño** (Bandeja, Leads, Métricas, Agente IA): tokens, tipografía, medidas y comportamiento con valores exactos. Si una pantalla no coincide con ese archivo, el que está mal es el código. Entró al repo tarde y por eso hubo que auditar contra él lo ya construido.
6. `docs/architecture.md`, `docs/data-model.md`, `docs/idempotency.md`, `docs/failure-modes.md`, `docs/cost-budget.md`, `docs/workflows.md`, `docs/security-threat-model.md`, `docs/database-tuning.md`, `docs/slo.md`, `docs/backup-strategy.md`, `docs/business-plan.md`, `docs/meta-platform-limits.md`, `docs/data-retention.md` para diseño + business + ops.
7. Si código no concuerda con doc, preguntar antes de actuar.
8. Continuar desde "Siguiente sub-paso" §2 o seguir guía `docs/next-session.md`.

---

## 8. Glosario rápido

- **Lead Twin** — Ficha estructurada de la sesión activa, mantenida por LLM extractor. Vive en `lead_session`.
- **Auto-stage** — `current_stage` clasificada por IA tras cada turno (sin kanban manual). Se puede corregir a mano clickeando un segmento del rail del Twin: eso deja `procedencia.current_stage` en `humano` y el extractor deja de tocarla en esa sesión (mismo trato que los campos de `CAMPOS_TWIN_EDITABLES`). La escalada a `requiere_humano` no pasa por ese filtro y sigue funcionando.
- **Sesión** — Conversación atómica con lead que termina en `exito` o `perdido`. Multi-sesiones históricas por lead.
- **Handoff** — Transferencia IA → humano. Manual (botón) o automática (regla).
- **Regla IF/THEN** — Mapping `intent + condiciones → respuesta fija`. Pre-LLM.
- **Intent** — Categoría semántica de mensaje del lead.
- **Conversación** — Hilo persistente por canal. Persiste; sesiones internas se purgan.
- **Reactivación predictiva** — Cron semanal sobre leads perdidos segmentados por `motivo_perdida`.

---

## 9. Preferencias del usuario

- Idioma interacción: español.
- Validación funcional (curl/tests) antes que UI manual.
- Backend lo arranca el usuario.
- Análisis formato: observación → causa raíz → fix.
- Preguntas explícitas si ambigüedad antes que asumir.

---

**Historial completo:** `docs/changelog.md`.
