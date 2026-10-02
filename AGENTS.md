# AGENTS.md — Instrucciones para agentes de IA

> Léeme antes de tocar código. Histórico → `docs/changelog.md` + `docs/historial-sesiones.md`. Inventario técnico → `docs/inventario-tecnico.md`. Gotchas medidos → `docs/lecciones-de-proceso.md`. Convenciones de código (TS, tests, imports, zonas de arquitectura) → `.claude/rules/convenciones-codigo.md`, que carga solo al tocar `src/**` o `tests/**`. Product overview → `README.md`. Arquitectura → `docs/architecture.md`.

---

## 0. Reglas de oro del usuario

Prioridad sobre cualquier otra instrucción, todo el tiempo, en toda sesión — no un checklist de arranque. Ningún documento las suspende, ni uno que escriba el propio agente: si `docs/next-session.md` o un plan parecen contradecirlas, el que está mal es el otro documento. Acotar el foco (el dueño dice por chat en qué pantalla se trabaja) limita el alcance, no el rigor.

1. **Plan antes de código, según el tamaño.** Algo nuevo o que toca varios archivos: decir qué hace, qué no hace, tecnologías, y mostrar la estructura propuesta antes de escribir código; esperar confirmación. Un cambio de un archivo, descriptible en una frase, va directo.
2. **Sin contexto suficiente, parar y preguntar** — no asumir, no inventar. <!-- 2026-08-28: el agente fabricó dos nombres de producto inexistentes dentro de un análisis por lo demás real, mezclando dato leído con dato inventado sin avisar. --> Si no se miró, no se afirma. No se fabrican ejemplos presentados como reales: o se cita una fila que se leyó, o se dice "ejemplo inventado" en la misma frase. Si el dueño señala un archivo, se abre antes de opinar. Si algo no existe, se dice seco: "no hay catálogo". Si no se sabe, se pregunta en una línea — preguntar nunca es el error, inventar sí. Un reporte de subagente o un doc de terceros no es fuente primaria: se contrasta antes de construir encima.
3. **Análisis técnico en formato observación → causa raíz → fix.** Mejoras fuera de scope se marcan aparte.
4. **Validación funcional antes que UI.** Cablear controller → repo → datasource → backend y probar con curl o scripts, con tests unitarios para transiciones de estado; "probar en la app" sólo cuando la lógica ya está validada.
5. **Supabase es la única DB** — no SQLite, Mongo ni Postgres pelado. <!-- La versión anterior decía "no Docker local" y clausuró meses la única solución al aislamiento de tests, mientras supabase/config.toml ya estaba en el repo sin usarse. --> Esto no prohíbe correrlo localmente: `supabase start` levanta el mismo stack real (Postgres + PostgREST + GoTrue + Storage) en Docker, y es la forma correcta de correr los integration tests (borran 17 tablas, por eso no pueden apuntar a una base con datos).
6. **Cargar los plugins/skills relevantes antes de cada fase**, vía `Skill`: Zod/types → `vercel:ai-sdk` + `supabase:supabase` · SQL → `supabase:supabase-postgres-best-practices` + `supabase:supabase` · Inngest → `vercel:workflow` + `vercel:vercel-functions` · tests → `superpowers:test-driven-development` · UI → `vercel:shadcn` + `frontend-design` + `vercel:nextjs` · AI SDK → `vercel:ai-sdk` + `vercel:ai-gateway` · webhooks Meta → `vercel:vercel-functions` + `security-review`.
7. **Honestidad técnica sin filtro, antes de proponer solución.** Ante un gap, error, anti-patrón, dead code, dependencia obsoleta o desviación de práctica de élite: decirlo primero con (1) falencia real → (2) impacto concreto → (3) solución priorizada por ROI — "esto está mal porque X", no "esto se puede mejorar".
8. **Seguridad y compliance Latam siempre** (LGPD Brasil, Ley 25.326 Argentina, LFPDPPP México, Ley 19.628 Chile, Ley 1581 Colombia): PII redaction en logs con `redactPii()` — nunca loggear `telefono`/`mensaje.body`/`email`/`meta_user_ids` crudos · webhook entrante con `verifyHmac()` como primera línea, sin verify 401 · Server Action con `Schema.parse(formData)` como primera línea · secrets (`META_APP_SECRET`, `OPENAI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `INNGEST_SIGNING_KEY`) rotan cada 90 días (`docs/runbooks/secrets-rotation.md`) · `console.log` prohibido en `src/**`, sólo `logger.info|warn|error|debug`.
9. **Reliability y ops en toda integración nueva:** `recordLlmUsage(...)` tras cada llamada LLM (si no, el daily cap no funciona) · idempotency-key explícito en `step.run()` de Inngest y en cron, sin auto-generar, patrón `${functionName}-${date.toISOString().slice(0,10)}-${entityId}`, con replay tests obligatorios · jerarquía `DomainError`, nunca `throw new Error('msg')` en `src/server/**` (`src/lib/errors.ts`, detalle de clases → `.claude/rules/convenciones-codigo.md`) · `/api/health` con DB ping + Inngest + OpenAI · Sentry antes de Slice 4 launch. Todo cambio a un schema Zod que viaja a Structured Outputs corre `npx vitest run -c vitest.integration.config.ts tests/integration/llm-schemas.openai.test.ts` (no toca DB, cuesta centavos) — es la única red que detecta incompatibilidades con la API real de OpenAI, y ya se pudrió en silencio una vez.
10. **Orquestación según el criterio global.** El agente principal (Opus) decide por cada tarea si hace falta un subagente: si no, la resuelve directo sin preguntar; si sí, despacha el worker del esfuerzo que corresponda (`worker-low`/`-medium`/`-high`), con las tareas independientes en paralelo. Lo que vuelve se verifica contra la fuente primaria, nunca contra el reporte solo.
11. **Diseño: al menos una skill de diseño antes de escribir un estilo.** Aplica a UI, CSS, layout, motion, sistema de diseño. Inventario: `frontend-design` · `ui-ux-pro-max:design`/`:ui-styling`/`:design-system` · `ecc:frontend-design-direction` · `ecc:make-interfaces-feel-better` / `emil-design-eng` · `apple-design` · `motion-foundations` + `motion-patterns` + `animate` · `dataviz` (antes de cualquier gráfico) · `ecc:accessibility` / `ecc:a11y-architect` · `vercel:shadcn` (antes de crear un componente ya vendorizado). También se delega: la skill la carga el subagente que ejecuta.
12. **Triggers de skill discipline** vía `Skill`: feature nueva → `superpowers:brainstorming` primero · bug o test que falla → `superpowers:systematic-debugging` antes del fix · antes de decir "completo" o "passing" → `superpowers:verification-before-completion`, correr los comandos y confirmar la salida real · lógica de negocio en services/repos → `superpowers:test-driven-development`, test antes que implementación.

---

## 1. Resumen ejecutivo

CRM conversacional single-org self-hosted white-label, venta de repuestos automotrices. Target: Latam aftermarket parts (Brasil, México, Argentina, Chile, Colombia, Perú). 1 instalación por cliente empresa, no multi-tenant SaaS.

Pilot tier (Slice 1-4): 30 vendedores por cliente, peak 50 msg/sec, ~5K leads/mes, conversaciones cortas (5-15 mensajes), hosting ~$100-300 USD/mes. Tiers escalables y TAM/SAM/SOM → `docs/business-plan.md`.

Features: multi-canal Meta (WhatsApp + IG + FB Messenger, caps en `docs/meta-platform-limits.md`) · agente IA GPT-4 con catálogo + tool calling (Vercel AI SDK) · Lead Twin extractado por LLM · reglas IF/THEN pre-LLM · multi-sesiones, purge >29 días · workflows durables Inngest + outbox. Diferenciadores: sin kanban manual (auto-stage), Lead Twin, reglas IF/THEN, reactivación predictiva.

Revenue: licencia setup $5K-50K USD one-time + ops mensual $1K-5K USD + add-ons. Compliance Latam: ver regla de oro 8; detalle → `docs/data-retention.md`.

---

## 2. Estado actual

**Fase actual:** `master` = `origin/master` = `7173f87`, desplegada en producción `https://crm-wine-one-38.vercel.app` (Vercel success; `/api/health` ok en db/inngest/openai). El catálogo ya no está vacío: `productos` en crm-dev tiene 21.009 filas y el agente las busca con `buscar_productos`; la relevancia de la búsqueda sigue floja y mejorarla espera el documento de siglas del dueño. Ramas sin mergear: `feat/costos-meta-oct` (migración `20260927180000_costos_meta.sql` **no aplicada** en crm-dev) y `workflows-fundacion` (sin revisar). Los checks de Vercel Preview fallan en todo PR porque el entorno Preview no tiene variables (producción compila bien). Meta: app nueva en el portfolio real "El Genuino repuestos", token de usuario del sistema, webhook público y suscrito; el número real sigue bloqueado por la verificación de empresa (el dueño no tiene los documentos a mano), y Coexistence/Embedded Signup también. Los precios incluyen IVA (confirmado por el dueño el 2026-10-01); la regla del prompt "Informa siempre los precios con IVA incluido" es correcta. Retomar desde `docs/next-session.md`.

Reproducir: `git rev-parse master origin/master` · `ls supabase/migrations/*.sql | wc -l` (91) · `select count(*) from supabase_migrations.schema_migrations` (91; última `20261001130000`) · `select count(*) from productos` (21.009). Medido el 2026-10-02.

**Última acción completada (2026-10-01 → 2026-10-02):** PR #2 (rediseño de Productos: catálogo virtualizado, filtros por columna estilo Excel con incluir/excluir, orden acumulativo hasta 3 niveles, `productos_listar`/`productos_faceta`) y PR #3 (el agente recibe los vehículos guardados del lead, `vehiculos_del_cliente`, con regla inviolable nueva: buscar con el vehículo actual y nunca inventar el año, lo que arregla un Aveo 2005 buscado como 2020/2023; más la vista de admin "Sin resultado" en Productos, `busquedas_sin_resultado()` sobre `tool_executions`, últimos 30 días). Ambos desplegados; migraciones aplicadas en crm-dev. **Desde el 2026-09-26 entraron además y están desplegados:** workflows + difusión; app de escritorio en el Inbox (Electron en `desktop/`, WhatsApp Web recortado al chat abierto, selector "WhatsApp Web | Hilo del CRM"); páginas legales `/privacidad`, `/condiciones`, `/eliminacion-de-datos`; Copiloto (PR #1: modos Según horario/Copiloto/Automático, `borradores_ia`, `agente_config.horario_equipo`).

**En curso:** suite de evals de comportamiento del agente contra OpenAI real (`tests/evals/agente/`, `npm run test:eval:agente`); sin mergear.

**Verificado:** suite unitaria completa en el pre-push del 2026-10-02 (5091 tests pasan); `/api/health` ok. **No se hizo:** revisión visual humana de Productos en producción, comparación visual humana en general, contrato Supabase de los repos nuevos dentro de la suite, aplicar la migración de costos Meta en crm-dev. "Delegar al agente" y el auto-handoff esperan confirmación del dueño.

### Tabla de progreso

| Fase                                          | Estado                | Notas                                                                                                           |
| --------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------- |
| 0-6 Foundation, REPAIR, Pre-Slice 1 hardening | 🟢 completo           | Ver `docs/changelog.md`.                                                                                        |
| Slice 1 — Real DB + LLM + Meta sandbox        | 🟢 funcional          | Pino + OTel + Sentry pendientes (pre-Slice 4).                                                                  |
| Slice 2 — UI + Server Actions                 | 🟡 funcional          | Realtime en el Inbox no existe (usa `RefreshPoller` 5 s).                                                       |
| Rediseño "sala de control" A-G2               | 🟢 aplicado           | `docs/handoff-rediseno-README.md`. Sin revisión visual humana.                                                  |
| Slice 3 — Auth + RLS audited                  | 🟢 completo           | 43 policies + suite RLS 11/11 + STRIDE.                                                                         |
| Slice 4a — Hardening pre-launch               | 🟢 completo           | Logging, Sentry, OTel, health check, cost tracker.                                                              |
| Slice 4b — Deploy + soft launch               | 🟡 en progreso        | Producción en `https://crm-wine-one-38.vercel.app`. Falta número real (verificación Meta), templates, pen test. |
| Etiquetas                                     | 🟢 completo           | Modal desde Leads + `reglas_etiqueta`. Sin QA visual.                                                           |
| Rendimiento                                   | 🟡 read path aplicado | Falta smoke autenticado, `EXPLAIN`, volumen representativo.                                                     |
| Workflows                                     | 🟡 desplegado         | `docs/prd-workflows.md`. Sin comparación visual humana.                                                         |
| Difusión                                      | 🟡 desplegada         | Nunca probada contra Meta real. `docs/prd-workflows-difusion.md`.                                               |
| Stack local aislado                           | 🟢 aplicado           | `docs/runbooks/como-correr-el-crm.md` §4.1.                                                                     |

**Pantallas:** Inbox 🟢 · Leads 🟢 · Agente 🟢 · Métricas 🟡 sin cierre formal · Productos 🟡 desplegada, sin cierre formal ni revisión visual en producción · Ajustes 🟡 sin cierre · Workflows 🟡 sin cierre · Difusión 🟡 sin cierre.

**Métricas (medidas 2026-10-02):** suite unitaria completa en el pre-push → 5091 tests pasan; un test inestable por carga, `tests/unit/select-opciones.test.tsx` (su guard test excede 5 s con la suite completa en paralelo; solo, pasa) · 91 migraciones, las 91 en el ledger de `crm-dev`. Integration tests contra el stack local (`npm run test:integration:local`): la última corrida completa sigue siendo la del 2026-09-25 (473 pasan / 2 fallan por una migración pendiente en local / 4 saltados); no se repitió.

**Pendiente del usuario** (detalle en `docs/next-session.md`): verificación de empresa en Meta · verificar si se cargó el método de pago en WhatsApp Business · suscribir `account_update` en Meta · cargar `DIFUSION_BAJAS_HMAC_*` en Vercel · confirmar "Delegar al agente" y el auto-handoff · revisar Advisors en el dashboard de Supabase (CLI 403 en free tier).

**Siguiente sub-paso:** (1) mergear la suite de evals y correrla antes de cada cambio al agente o al prompt; (2) dueño: verificación de empresa en Meta; (3) instalador `.exe` de escritorio con auto-update; (4) proceso de borrado de datos que prometen las páginas legales + `difusion_envios.telefono` guardado en claro; (5) variables del entorno Preview de Vercel, o apagar Preview; (6) mergear o decidir `feat/costos-meta-oct`; (7) documento de siglas del dueño para la relevancia de la búsqueda; (8) comparación visual humana; (9) pen test.

> Al completar una acción, actualizar la tabla + "Última acción completada".

---

## 3. Decisiones bloqueadas (no re-preguntar)

Lista cerrada; no se reabre sin pedido explícito del dueño.

**Producto:** single-org self-hosted white-label · target Latam aftermarket parts mid-large · 1 instalación por cliente · sin kanban, sin deals, sin tareas · máximo 1 sesión activa por lead, purge diario a los 29 días · tags automáticas + manuales · comprobante de pago sólo URL de imagen, sin monto ni verificación · Lead Twin sólo campos de la sesión actual · productos con `codigo_interno` único + `sku_proveedor` opcional · foto-to-SKU diferido a v2.

**Multi-canal:** mismo lead reconocido vía `leads.telefono` (WA) o `meta_user_ids` jsonb (IG/FB) · merge manual desde UI cuando IG/FB no exponen teléfono · UI estilo WhatsApp Web.

**Stack:** Next.js 16 App Router + RSC + Server Actions, sin NestJS · Tailwind v4 + shadcn/ui · Supabase única DB · Inngest (workflows + cola + cron) · Vercel AI SDK sobre GPT-4.x · Meta Cloud API oficial, no BSP ni Baileys · Zod, Vitest, Prettier, ESLint + boundaries · hosting Vercel.

**Arquitectura:** capas API/Action → Service → Repository → DB, nunca saltar capas · repos interface + impl (in-memory tests, Supabase prod) · services no tocan DB directo · Inngest functions sólo orquestan · webhook Meta responde 200 inmediato + emite evento · service-role vs authed separados, enforced por ESLint boundaries.

**RLS (Slice 3):** admin RW sobre todo · vendedor RW sobre leads/sesiones/conversaciones/mensajes/lead_tags/comprobantes Storage · vendedor sólo R sobre productos/intents/reglas/tags/usuarios.

**Integraciones reales:** mock in-memory en tests y en local; impl reales (Supabase, AI SDK, Meta) en producción. Razón: valida la lógica y la UI sin depender de credenciales ni cuotas.

---

## 4. Cómo trabajar

1. Anunciar el sub-paso a ejecutar.
2. Ejecutar la acción mínima.
3. Validar según el criterio del plan.
4. Reportar en 2-3 líneas.
5. Esperar confirmación antes del siguiente — salvo sub-pasos triviales atómicamente relacionados, o si el dueño ya dijo "hacé toda la fase X" o "no preguntes en cada paso".

**Una pantalla a la vez, de punta a punta** (decisión 2026-08-16): no se salta a otra hasta cerrar la que está en curso; si aparece algo de otra, se anota y se deja. Al cerrarla, en la respuesta siguiente y sin que haga falta pedirlo: árbol limpio y commiteado · `typecheck`, `lint` y `test` corridos y reportados con el número real · `test:integration:local` si se tocaron repos o SQL · lo que quedó sin verificar dicho en voz alta · `/context` para arrancar la próxima pantalla limpio.

Si falla un sub-paso: no avanzar, diagnosticar la causa raíz, proponer el fix, y aplicarlo tras confirmación si toca config global o instala algo nuevo.

---

## 5. Qué no hacer

- Escribir código antes de confirmar scope/stack/estructura (salvo el cambio chico de la regla de oro 1).
- Conectar Supabase/OpenAI/Meta/Inngest reales antes de Slice 1+.
- Proponer DBs alternativas a Supabase, o agregar dependencias sin justificar.
- Crear docs adicionales o commitear sin que el dueño lo pida.
- Saltar capas (API → DB directo). Emojis en código o commits salvo pedido explícito.
- Comentarios obvios: sólo el "por qué" no obvio. Backwards-compat shims, abstracciones prematuras, manejo de casos imposibles.
- `npm run test:integration` a secas, `npm run db:push` con un agente escribiendo migraciones, `mcp__supabase__apply_migration`/`execute_sql` para crm-dev, `npm run build` con el dev server levantado, `git add -A`/`git commit -a` con un agente en el árbol — motivo de cada uno en `docs/lecciones-de-proceso.md`.
- Dar por hecho un componente porque el archivo existe: verificar que alguien lo importe.
- Escribir un número en un comentario sin dejar cómo se reprodujo.

---

## 6. Cómo retomar sesión nueva

1. `README.md`, luego este `AGENTS.md` completo.
2. `docs/next-session.md`: resume paso a paso y acción pendiente del usuario. Para levantar el proyecto: `docs/runbooks/como-correr-el-crm.md`.
3. `docs/changelog.md` + `docs/historial-sesiones.md` si hace falta contexto de fases pasadas.
4. `docs/handoff-rediseno-README.md`: spec de Bandeja/Leads/Métricas/Agente IA con valores exactos — si una pantalla no coincide, el código está mal, no el doc.
5. Diseño, negocio y ops: `docs/architecture.md`, `docs/data-model.md`, `docs/idempotency.md`, `docs/failure-modes.md`, `docs/cost-budget.md`, `docs/workflows.md`, `docs/security-threat-model.md`, `docs/database-tuning.md`, `docs/slo.md`, `docs/backup-strategy.md`, `docs/business-plan.md`, `docs/meta-platform-limits.md`, `docs/data-retention.md`.
6. Si el código no concuerda con un doc, preguntar antes de actuar.
7. Continuar desde "Siguiente sub-paso" (§2) o `docs/next-session.md`.

---

## 7. Glosario rápido

- **Lead Twin** — Ficha estructurada de la sesión activa, mantenida por el LLM extractor. Vive en `lead_session`.
- **Auto-stage** — `current_stage` clasificada por IA tras cada turno. Corregible a mano clickeando el rail del Twin: eso deja `procedencia.current_stage` en `humano` y el extractor deja de tocarla en esa sesión. La escalada a `requiere_humano` no pasa por ese filtro.
- **Sesión** — Conversación atómica que termina en `exito` o `perdido`. Multi-sesiones históricas por lead.
- **Handoff** — Transferencia IA → humano, manual o automática.
- **Regla IF/THEN** — `intent + condiciones → respuesta fija`, pre-LLM.
- **Intent** — Categoría semántica de un mensaje del lead.
- **Conversación** — Hilo persistente por canal; las sesiones internas se purgan.
- **Reactivación predictiva** — Cron semanal sobre leads perdidos por `motivo_perdida`.

---

## 8. Preferencias del usuario

Idioma de interacción español · validación funcional antes que UI manual · backend lo arranca el usuario · análisis en formato observación → causa raíz → fix · preguntas explícitas si hay ambigüedad, antes que asumir.

---

**Historial completo:** `docs/changelog.md` · `docs/historial-sesiones.md` · `docs/lecciones-de-proceso.md` · `docs/inventario-tecnico.md`.
