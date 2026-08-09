# Cómo retomar la sesión

> Última actualización: 2026-08-09. **Rediseño A y agente G1 mergeados a master (`3be7398`). Spec y plan del sub-proyecto B escritos y aprobados, sin ejecutar.** Users dev: `admin-dev@crm.local` / `dev-admin-2026!` · `vendedor-dev@crm.local` / `dev-vendedor-2026!`.

---

## ⚠️ Recordatorio crítico de seguridad

**JAMÁS pegar credenciales en chat con el asistente.** Secrets (`OPENAI_API_KEY`, `service_role`, `META_*`) → directo a `.env.local` con editor. Si el asistente "necesita ver" un secret, rechazar: que diagnostique por comportamiento.

---

## ⚠️ Footguns de entorno

**1. Las suites de integration borran los usuarios dev de `public.usuarios`.** Tras CUALQUIER `npm run test:integration`, correr `node .superpowers/sdd/scripts/seed-merge-e2e.js`.

> Excepción: `tests/integration/agente-config.supabase.test.ts` NO llama a `cleanupTestDb`, así que no toca `usuarios`. Limpia solo `agente_config` y restaura la config activa al terminar.

**2. `deleteUser` de Supabase Auth no cascadea a `public.usuarios`.** Verificado empíricamente el 2026-08-09: borrar de `auth.users` deja huérfana la fila que creó el trigger. Todo test que cree usuarios debe borrar de las dos tablas.

**3. `core.autocrlf=true` + `endOfLine: lf`.** Resuelto con `.gitattributes` (`a458811`). Si alguien clona en Windows y ve `format:check` en rojo sobre código que no tocó, ese era el motivo y ya está arreglado.

---

## Estado del trabajo

| Sub-paso                           | Estado                  | Notas                                                     |
| ---------------------------------- | ----------------------- | --------------------------------------------------------- |
| Pre-Slice 1 + Slice 1              | ✅                      | Foundation, repos, LLM factory, Meta, Inngest, webhook    |
| Slice 2 core 8.1-8.8               | ✅                      | Inbox + conversación + twin + actions + poller            |
| Slice 3 Auth + RLS                 | ✅                      | 43 policies + matriz 11/11                                |
| Slice 4a hardening                 | ✅                      | Pino · Sentry · OTel · /api/health · purge · reactivación |
| Slice 2 fase 9 Productos           | ✅                      | Lista + CRUD + import CSV                                 |
| Slice 2 fase 10 Leads              | ✅                      | Lista + detalle + merge                                   |
| **Slice 4b — cadena WhatsApp E2E** | ✅ **validada local**   | Ver §Slice 4b                                             |
| **Rediseño A — base visual**       | ✅ **en master**        | Tokens, dark, íconos, primitivas, SideNav, shell          |
| **Agente G1 — config runtime**     | ✅ **rama sin mergear** | Ver §G1                                                   |
| Rediseño B-G                       | ⚪                      | Ver §Rediseño                                             |
| Deploy Vercel + soft launch        | ⚪                      | Bloqueado por catálogo vacío                              |

---

## 🔴 Lo primero al retomar

**Ejecutar el sub-proyecto B — Bandeja unificada.** Spec y plan escritos, aprobados y commiteados:

- Spec: `docs/superpowers/specs/2026-08-09-rediseno-b-bandeja-design.md`
- Plan: `docs/superpowers/plans/2026-08-09-rediseno-b-bandeja.md` (6 tareas)

Ejecutar con `superpowers:subagent-driven-development`.

### ⚠️ Dos deudas de G1 que quedaron sin hacer

G1 se mergeó con las verificaciones por tarea completas, pero **sin dos cosas que sí se hicieron en el sub-proyecto A**:

1. **Review de rama completa.** En A, ese review encontró un defecto que los 9 reviews por tarea no vieron: `src/lib/ui/` estaba construido, testeado y sin consumidores mientras las pantallas seguían pintando con la paleta vieja. G1 no tuvo ese pase. Se puede hacer igual sobre master, revisando el rango `f5a12f6..3be7398`.
2. **E2E real de WhatsApp.** Cambiar el tono a formal desde `/agente`, mandar un mensaje real, y verificar que la respuesta trate de usted. **Nunca se hizo.** Es lo único que prueba que la config llega de verdad al agente en producción; la CI no lo cubre.

Ninguna bloquea B, pero conviene cerrarlas antes del soft launch.

---

## §G1 — Config del agente en runtime (MERGEADO en `3be7398`)

Spec: `docs/superpowers/specs/2026-08-08-agente-g1-configuracion-design.md`
Plan: `docs/superpowers/plans/2026-08-08-agente-g1-configuracion.md` (13 tareas)

**Qué hace:** el agente vendedor ya no tiene su modelo ni su prompt hardcodeados. Lee su configuración de la tabla `agente_config` **en cada turno**.

Configurable desde `/agente`: modelo (11 opciones con precio), instrucciones de negocio en texto libre, tono/largo/emojis, descuento máximo, pasos de tool, ventana de contexto, umbral de resumen, tope de gasto, política de kill switch, horario semanal con timezone y plantilla fuera de horario.

**Garantías construidas:**

- Tabla append-only versionada. Índice único parcial `agente_config_una_activa (activa) where activa` — **verificado contra Postgres real**: insertar una segunda activa devuelve `23505`.
- Rollback crea versión NUEVA, nunca revive la vieja. La línea de tiempo no retrocede: el historial dice "v7 fue un rollback a v3" en vez de borrar que hubo un problema.
- Auditoría en `admin_actions` con `campos_cambiados` que guarda **nombres, nunca valores**. El audit dice qué cambió; la tabla de config dice a qué.
- Prompt en 4 bloques con las **reglas inviolables al final** y precedencia declarada. Los LLM ponderan más lo que aparece después: ponerlas primero las vuelve sobrescribibles por las instrucciones del admin.
- Fallback a `CONFIG_DE_FABRICA` si la config no se puede leer, y **el fallback no se cachea** (si no, quedaría en valores de fábrica 30s después de que la DB se recupere).
- Preview contra historial real que no persiste ni envía a Meta, pero **sí cuenta contra el tope de gasto**.

**Tests:** 956 unit + 22 integration contra Postgres real.

### Deudas registradas de G1

- **Guarda de descuento**: 5 rondas de fix. Terminó conservadora, con falsos negativos aceptados y documentados en tests (`"Podemos bajarlo un 15%"` no dispara). Un matcher léxico no puede separar "20% de descuento" de "20% menos de peso" en español. **El arreglo de fondo es que ofrecer un descuento requiera una llamada a tool**, con lo cual deja de ser parsing de texto. Va a G2 o después.
- **El horario no expresa cruce de medianoche** (22:00-02:00). El editor guía a partirlo en dos días, que funciona sin huecos. Aceptado a propósito.
- `TabLimites.tsx` 257 líneas, `EditorHorario.tsx` 217, `AgenteConsola.tsx` 187 — sobre la guía de ~150.
- `toActionError` duplicado ahora en 4 carpetas (inbox, leads, productos, agente).
- 5 `throw new Error` crudos preexistentes en `src/server` e `src/inngest`, prohibidos por la regla 10 de `AGENTS.md`.

---

## §Slice 4b — lo que funciona y lo que falta

**Validado local el 2026-08-07:** entra un WhatsApp real → webhook con HMAC → Inngest → pipeline → el agente responde. Con 3 bugs de fondo arreglados en el camino:

1. `inngest.send()` iba a Inngest Cloud con key dummy → 401 → el webhook devolvía 500 y Meta reintentaba. Fix: `INNGEST_DEV=1`. **`NODE_ENV=development` NO alcanza.**
2. Los 3 schemas LLM eran incompatibles con Structured Outputs strict → **`update-lead-twin` nunca completó una ejecución desde Slice 1**, invisible porque los tests usan `MockLanguageModelV3`, que acepta cualquier schema. Fix: `strictJsonSchema:false` + suite de contrato contra OpenAI real.
3. Vars opcionales declaradas vacías tumbaban el arranque (`.optional()` de Zod no acepta `""`). Fix: `stripEmpty()` en `env.ts`.

**Meta configurado:** app `Crm Genuino` (1570589244491707), número de prueba `+1 555 667-7618`, phone_number_id `1278451868684287`, WABA `906018605389495`, token de usuario del sistema sin caducidad.

**Falta:** el **túnel de cloudflared es efímero** — al reiniciarlo cambia la URL y hay que reconfigurar el webhook en Meta; el deploy a Vercel lo resuelve. Upstash y Sentry sin configurar. Número real de WhatsApp para el soft launch (el de prueba solo mensajea a 5 destinatarios verificados).

---

## §Decisiones tomadas 2026-08-09

**Upstash descartado por ahora.** En este código solo alimenta el contador del tope de gasto y el rate limit del webhook. El rate limit importa poco: **el HMAC ya rechaza con 401 todo lo no firmado antes de gastar nada**. Y el tope de $10/día estaba mal calibrado — son $300/mes, el presupuesto de hosting completo según `business-plan.md`, puesto como límite de un solo renglón.

> **Consecuencia a tener presente: sin Upstash el tope de gasto NO se aplica.** `InMemoryCostTracker` cuenta en un array del proceso; en serverless cada instancia tiene el suyo y se resetea en cada cold start. La pantalla `/agente` lo presenta como si funcionara. Cargar Upstash antes del soft launch, o asumir que no hay tope.

---

## 🔴 Lo que impide que el producto haga lo que promete

| Tabla       | Filas | Impacto                                                                                                |
| ----------- | ----- | ------------------------------------------------------------------------------------------------------ |
| `productos` | **0** | El agente llama a `buscar_repuesto`, recibe cero resultados y responde "no lo tenemos" siempre         |
| `intents`   | **0** | El clasificador se saltea                                                                              |
| `reglas`    | **0** | **Cada turno pasa por el LLM**, incluidos saludos. Es exactamente el costo que el diseño quería evitar |
| `empresas`  | **0** | El schema declara single-org y no hay ninguna. Confirmar que nada dependa                              |

---

## §Rediseño "sala de control"

Handoff: `Rediseño UI sala de control.zip` → `design_handoff_crm_control_room/`, referencia `CRM Repuestos v2.dc.html`.

| #   | Sub-proyecto                                 | Estado                                                           |
| --- | -------------------------------------------- | ---------------------------------------------------------------- |
| A   | Base visual                                  | ✅ en master                                                     |
| B   | Bandeja unificada de 3 paneles               | ⚪ **siguiente por pedido del usuario**                          |
| C   | Ventana de 24 h + estados de entrega         | ⚪ requiere migración + persistir webhooks de status de Meta     |
| D   | Triage (motivo + prioridad)                  | ⚪ cálculo en server                                             |
| E   | Twin con procedencia y edición               | ⚪ requiere migración por campo                                  |
| F   | Métricas en 3 cortes                         | ⚪ `mensajes` ya tiene `direction` y `sender`: viable sin migrar |
| G1  | Config del agente                            | ✅ rama sin mergear                                              |
| G2  | Motor de reglas y escalado (absorbe fase 11) | ⚪                                                               |

### ⚠️ Lección para planear B

**Los dos defectos de plan del sub-proyecto A cayeron en layout y build**, la parte escrita con más confianza y menos verificación:

1. La secuencia de tareas 6→7 dejaba una rotura de tipos entre dos commits, en un repo cuyo hook `pre-commit` typechequea todo el proyecto. **El plan era incommiteable.**
2. `<main className="flex ...">` aplastaba las 7 pantallas del panel a 236px de 1218 disponibles y recortaba `/inbox` sin scrollbar. Lo encontró un revisor **midiendo anchos en el navegador**, no leyendo el diff.

Y en G1, el bug de la política `seguir` inalcanzable lo encontró alguien **clickeando la UI**: el código se leía correcto y la máquina de estados estaba rota solo en runtime.

**B es todo layout.** Sus tareas tienen que llevar verificación medida en navegador como criterio de aceptación, no revisión por lectura.

---

## §UI/UX — lo próximo pedido por el usuario (2026-08-09)

Ir pantalla por pantalla mejorando apariencia y utilidad, empezando por **Bandeja**.

**Naming.** El usuario pidió un nombre más profesional que "Bandeja". Recomendación: **"Conversaciones"** — dice exactamente qué hay, es el estándar en CRMs en español, y no evoca email. Alternativas: "Atención", "Mesa de trabajo". El cambio es una línea en `ITEMS` de `src/components/shared/SideNav.tsx`; la ruta `/inbox` puede quedar igual.

**Utilidad actual de `/inbox`:** lista de conversaciones activas, y `/inbox/[leadId]` una página aparte a pantalla completa con la conversación y el panel del twin. Sin triage, orden cronológico.

**El sub-proyecto B es exactamente su rediseño**: unifica ambas en un layout de 3 paneles fijos (lista 322px · conversación flex, mín 520px · twin 322px), conservando `/inbox/[leadId]` para deep-linking. Es decir: **mejorar Bandeja es hacer B**. Conviene tratarlo como tal —spec → plan → ejecución— y no como retoques sueltos.

---

## Comandos útiles

```powershell
npm run dev              # puerto 3001
npm run inngest:dev      # dev server Inngest (ya lleva -u al puerto 3001)
npx --yes cloudflared tunnel --url http://localhost:3001   # túnel público
npm run ci               # typecheck + lint + format + coverage
npm run test:integration # ⚠️ después: node .superpowers/sdd/scripts/seed-merge-e2e.js
supabase migration list --linked
```

---

## Conexión Supabase

- Proyecto `crm-dev`, ref `emubzkouwvuzlrtsgorx`, Postgres 17, plan Free.
- **21 migraciones aplicadas** (20 + `agente_config`).
- ⚠️ Free tier auto-pausa tras ~1 semana idle. Ya pasó una vez: el DNS deja de resolver y `/api/health` da `db: fail`. Se restaura desde el dashboard.
- Remoto: `https://github.com/Leonardo-A1varez/crm.git` (privado).

---

## Cómo dar contexto al asistente al volver

> Leé `AGENTS.md` y `docs/next-session.md`. Estado: rediseño A en master, G1 completo en la rama `agente-g1-configuracion` sin mergear. Quiero seguir con [merge de G1 / sub-proyecto B Bandeja / catálogo]. Para entrar al panel: `admin-dev@crm.local` / `dev-admin-2026!`.
