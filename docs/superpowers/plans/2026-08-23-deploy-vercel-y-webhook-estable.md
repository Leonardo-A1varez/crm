# Deploy a Vercel y webhook estable — Implementation Plan

> **Para agentes:** este plan tiene pasos que **solo puede hacer el dueño** (crear cuentas, aprobar gastos, pegar URLs en el panel de Meta). Están marcados **[DUEÑO]**. No los saltees ni los simules.

**Goal:** que el CRM tenga una URL pública permanente, que Meta pueda entregar los webhooks siempre, y que los eventos de Inngest se procesen de verdad en producción.

**Por qué ahora:** el webhook de Meta apunta a `https://unlooted-emulatively-angelika.ngrok-free.dev/...`, un túnel muerto. Verificado hoy con `devtools_webhook_list`: la suscripción está sana, el destino no existe. Cada mensaje entrante se pierde en silencio — es la causa raíz del entrante que hubo que registrar a mano durante el E2E de W2.

**Alcance:** ítems 1-2-3 de la conversación. **No entra** el skill de Meta, la actualización de docs, ni la auditoría de reglas — eso es un segundo plan, después de que se destrabe el catálogo.

---

## Global Constraints

- Comentarios y commits en **español**. Conventional Commits, subject ≤72 chars.
- `git add` con rutas explícitas. Nunca `-A`, nunca `commit -a`.
- Prohibido `throw new Error()` en `src/server/**` — jerarquía de `src/lib/errors.ts`.
- Prohibido `console.log` en `src/**`. Nunca loggear `telefono`, `email` ni cuerpos de mensaje — `redactPii()`.
- **NO correr `npm run test:integration`** — congelado, vacía la base de dev.
- **NO correr `npm run build` con el dev server levantado** — corrompe `.next/`.
- **Ningún secreto entra a git.** Las variables van por `vercel env`, nunca a un archivo commiteado.

---

## Estado verificado hoy (2026-08-23), no supuesto

| Cosa                                | Estado                                                      | Cómo se verificó                     |
| ----------------------------------- | ----------------------------------------------------------- | ------------------------------------ |
| Vercel CLI                          | **59.1.3, instalado**                                       | `vercel --version`                   |
| Proyecto Vercel                     | **ya linkeado** — `crm`, `prj_7nAGu64jfqfEL5hjWxWQq2nwPcNU` | `.vercel/project.json`               |
| Compliance de la app Meta           | **compliant**, 0 acciones, 0 violaciones                    | `devtools_compliance`                |
| Deprecaciones de la app             | **ninguna abierta** (última plataforma: v26.0)              | `devtools_api_usage`                 |
| Suscripción del webhook             | `whatsapp_business_account`, 10 campos, **enabled**         | `devtools_webhook_list`              |
| Callback actual                     | **ngrok muerto**                                            | idem                                 |
| `INNGEST_EVENT_KEY` / `SIGNING_KEY` | **ambos `local-dev`** — placeholders                        | inspección de patrón en `.env.local` |

---

## Bloqueantes que resuelve el dueño antes de empezar

### B1 — [DUEÑO] Cuenta de Inngest Cloud y llaves reales

Las dos llaves de Inngest son `local-dev`. En producción eso hace que `inngest.send()` reciba **401**, el webhook responda **500**, y Meta reintente el mismo mensaje una y otra vez — está documentado en `docs/runbooks/como-correr-el-crm.md` y ya pasó una vez.

Hace falta: cuenta en inngest.com, una app, y de ahí el **Event Key** y el **Signing Key** de producción.

### B2 — Upstash: NO bloquea el deploy. Bloquea publicar el número.

> **Corregido el 2026-08-23 tras verificar el código.** La primera versión de este bloqueante decía que "cualquiera que consiga tu número puede generar llamadas a OpenAI sin techo". **Eso es falso** y sobredimensionaba el riesgo. Queda acá el análisis real.

Sin las dos variables de Upstash caen **dos** protecciones, no una, y las dos en silencio:

| Fábrica                                                                | Sin vars devuelve            | Efecto                                       |
| ---------------------------------------------------------------------- | ---------------------------- | -------------------------------------------- |
| `makeRateLimiterFromEnv` (`src/lib/rate-limit/index.ts:118`)           | `NoopRateLimiter`            | **cero rate limit** en el webhook público    |
| `makeCostTracker` (`src/lib/observability/upstash-cost-tracker.ts:77`) | `InMemoryCostTracker` + warn | el tope diario se resetea en cada cold start |

**Lo que NO es un problema:** el webhook tiene el orden correcto (`src/app/api/webhooks/meta/route.ts`): HMAC en el paso 2, **antes** del rate limit, del parser y de Inngest. Sin `META_APP_SECRET` un atacante se come un 401 antes de que se toque nada caro. **No puede disparar ni una llamada al LLM.**

**El riesgo real:** alguien que **conozca el número de WhatsApp** puede sostener conversación con el agente sin techo diario de gasto y sin throttle en nuestro borde. Es exposición acotada a quien tenga el número, no a internet.

**Además el gasto sigue siendo observable**: `persisting-cost-tracker` envuelve al tracker y escribe en `llm_usage` independientemente de Upstash. Se pierde el corte automático, no la visibilidad.

**Decisión:** con número de prueba sin publicar y 3-4 usuarios internos, la exposición es baja. **El deploy procede sin Upstash.**

**Pero las dos variables entran antes de poner el número real** — y no por el tope de gasto, que fue decisión del dueño y se respeta, sino por el **rate limit del webhook**, que es otra cosa y que hoy está en `Noop` sin que nadie lo haya decidido. Eso queda como entrada del checklist de "publicar el número", no de este plan.

---

## Task 1 — Deploy a Vercel con URL estable

**Files:** ninguno de código. Es configuración y verificación.

**Depende de:** B1 resuelto. B2 NO bloquea (ver arriba).

- [ ] **Paso 1: Cargar las variables de entorno en Vercel**

Trece variables **obligatorias** según `src/lib/env.ts`:

```
NEXT_PUBLIC_SUPABASE_URL          NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY         OPENAI_API_KEY
INNGEST_EVENT_KEY                 INNGEST_SIGNING_KEY
META_APP_SECRET                   META_VERIFY_TOKEN
META_WHATSAPP_ACCESS_TOKEN        META_WHATSAPP_PHONE_NUMBER_ID
META_GRAPH_API_VERSION            LLM_MODE
LLM_DAILY_CAP_USD
```

Las de Inngest son las **nuevas de B1**, no las de `.env.local`.

**`INNGEST_DEV` NO se carga.** Es `.optional()` en el schema, así que ausente es correcto. Si se copia, `inngest.send()` intenta hablarle a un dev server que en Vercel no existe, y no se procesa nada. Este es el error más fácil de cometer en todo el plan, porque el instinto es copiar el `.env.local` entero.

Opcionales, se cargan solo si aplican: `OPENAI_MODEL*`, `META_IG_*`, `META_FB_*`, `UPSTASH_*` (según B2), `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN`.

- [ ] **Paso 2: Deploy a producción**

`vercel --prod`. Reportar la URL que devuelve.

**No correr `npm run build` local antes** con el dev server arriba.

- [ ] **Paso 3: Verificar que arrancó**

`GET https://<url>/api/health`. Debe responder 200. Se espera `degraded` mientras los checks externos estén en placeholder — eso es correcto, no una falla.

Si responde 500, el motivo más probable es una variable obligatoria faltante: `env.ts` valida con Zod y falla al boot a propósito. El log de Vercel dice cuál.

- [ ] **Paso 4: Registrar las funciones en Inngest Cloud**

Inngest tiene que descubrir las **14 funciones** en `https://<url>/api/webhooks/inngest`. En el panel de Inngest se agrega ese endpoint como app.

Verificar que aparezcan las 14, incluidas `workflow-disparar` y `workflow-segmento` de W2.

- [ ] **Paso 5: [DUEÑO] Apuntar el webhook de Meta a la URL nueva**

Callback: `https://<url>/api/webhooks/meta`, con el `META_VERIFY_TOKEN` que ya existe (48 chars, real).

> **La suscripción va en dos niveles: la app Y la WABA.** Con solo el primero los mensajes quedan en la consola de Meta y nunca llegan. Ya pasó y costó una sesión entenderlo.

Alternativa: puedo hacerlo yo con `devtools_webhook_manage` — hay scope **manage** concedido. Requiere que el callback ya pase la verificación de Meta, o sea después del paso 3.

- [ ] **Paso 6: Verificar la entrada de verdad**

Dos comprobaciones, en orden:

1. `devtools_webhook_test` sobre el campo `messages` del topic — confirma que el endpoint es alcanzable y contesta.
2. **[DUEÑO]** Mandar un WhatsApp real al número de prueba. Después verificar en Supabase que la fila aparece en `mensajes` con `direction='in'` y **sin** `metadata.origen = 'carga_manual'` — o sea que entró por el webhook y no a mano.

El segundo es el que cierra el lazo. El primero solo prueba alcanzabilidad.

- [ ] **Paso 7: Reportar**

URL de producción, las 14 funciones registradas, y el `id` de la fila que entró por webhook.

---

## Task 2 — Los campos del webhook que hoy se tiran

**Files:**

- Modify: `src/lib/meta/parse-webhook.ts`
- Modify: `src/inngest/functions/on-status-received.ts` o función nueva (decidir al implementar)
- Test: `tests/unit/meta/parse-webhook.test.ts`

**Contexto:** `parse-webhook.ts:61` hace `if (change.field !== "messages") continue`. De los 10 campos suscritos, **9 se descartan**. No rompe nada — el webhook responde 200 igual — pero dos de esos eventos son cosas que el dueño querría saber.

- [ ] **Paso 1: Manejar `message_template_status_update`**

Meta avisa cuando aprueba o rechaza una plantilla. Hoy ese evento llega y se tira. Sin él, una plantilla rechazada se descubre cuando falla un envío.

Test primero: un payload real de ese campo produce un evento parseado. La forma exacta del payload está en `docs/meta-webhook-payloads.md`; si no está documentada, **verificarla con `devtools_discovery`** antes de escribir el parser — no inventarla.

- [ ] **Paso 2: Manejar `phone_number_quality_update`**

Meta avisa cuando la calidad del número baja. Es la señal temprana de que se viene una restricción. Con salientes automáticos habilitados desde W2, enterarse tarde es caro.

- [ ] **Paso 3: Decidir qué hacer con los 7 restantes**

`account_alerts`, `account_review_update`, `account_update`, `calls`, `security`, `message_template_quality_update`, `phone_number_name_update`.

Dos opciones honestas: desuscribirlos con `devtools_webhook_manage` (menos tráfico que se tira), o dejarlos suscritos y documentar en `docs/meta-webhook-payloads.md` que se ignoran a propósito. **Lo que no vale es dejarlos sin decidir** — hoy no están documentados como ignorados, así que el próximo que lea el código no sabe si es olvido o decisión.

- [ ] **Paso 4: Tests y commit**

`npx vitest run tests/unit/meta/` y typecheck. Commit con rutas explícitas.

---

## Task 3 — Subir de `v21.0` a `v26.0`

**Files:**

- Modify: `src/lib/env.ts:118` (el default)
- Modify: variable `META_GRAPH_API_VERSION` en Vercel y en `.env.local`

**Urgencia real: ninguna.** Verificado hoy: Meta no tiene **ninguna deprecación abierta** contra la app. `AGENTS.md` dice _"`v21.0` necesita upgrade contractual"_ sin fecha, y eso generaba más ansiedad de la que corresponde. Son 5 versiones de atraso, que es higiene, no incendio.

- [ ] **Paso 1: Revisar el changelog antes de tocar nada**

`devtools_api_changelog` para la URL del changelog de business messaging, y revisar qué cambió entre v21 y v26 en los endpoints que el CRM usa: envío de mensajes, plantillas, y la forma de los payloads de webhook.

**Si hay un breaking change en el envío, este task se frena y se replantea.** Subir la versión a ciegas sobre el camino que manda WhatsApps reales no vale el riesgo por algo que no urge.

- [ ] **Paso 2: Cambiar el default y la variable**

Un solo lugar en código (`env.ts:118`) más la variable en los dos entornos.

- [ ] **Paso 3: Verificar con un envío real**

**[DUEÑO] presente.** Un mensaje al número de prueba, dentro de la ventana de 24 h. Verificar que devuelve `wamid.` y que la fila queda en `mensajes`.

- [ ] **Paso 4: Actualizar `AGENTS.md`**

Reemplazar la línea del upgrade contractual por lo verificado: versión en uso, última disponible, y que no hay deprecaciones abiertas — con la fecha de la verificación, porque ese dato caduca.

---

## Lo que este plan NO hace, dicho en voz alta

- **No pone Upstash.** Producción queda con en el webhook y sin tope diario de gasto persistente. Decidido a proposito (ver B2): la exposicion es baja mientras el numero no se publique, y el gasto sigue siendo visible en . **Entra al checklist de publicar el numero, no a este plan.**
- **No pone Sentry.** `AGENTS.md` lo lista como obligatorio pre-launch y sigue pendiente. Sin él, una excepción no atrapada en producción no se entera nadie.
- **No hace pen test** ni revisión de seguridad del endpoint público. Es la primera vez que la app queda expuesta a internet; RLS está (43 policies, matriz 11/11) pero nunca se probó desde afuera.
- **No toca la IA del CRM.** Las herramientas de DevTools son de desarrollo y se quedan en desarrollo: el agente vendedor procesa texto de desconocidos, y darle una herramienta que escribe configuración de Meta es prompt injection con superficie abierta.
- **No corre los integration tests.** Siguen congelados esperando la base aislada.

---

## ESTADO AL PARAR — 2026-08-23

**El CRM está desplegado y la entrada funciona de punta a punta contra produccion.**

URL estable: `https://crm-wine-one-38.vercel.app` (alias de produccion, no cambia entre deploys).

### Lo que quedo funcionando y verificado

| Cosa                      | Evidencia                                                                                      |
| ------------------------- | ---------------------------------------------------------------------------------------------- |
| Deploy en produccion      | `readyState: READY`                                                                            |
| `/api/health`             | 200 · `db: ok` · `inngest: ok` · `openai: skipped`                                             |
| Handshake de Meta         | 200, devolvio el challenge exacto                                                              |
| Suscripcion del webhook   | apunta a Vercel (antes: ngrok muerto)                                                          |
| Sync con Inngest Cloud    | `Successfully registered`, y el cron `dispatch-outbox-events` corre cada minuto                |
| **Mensaje entrante real** | fila en `mensajes` con `direction='in'`, **por webhook**, sin `metadata.origen='carga_manual'` |

### Los 5 bloqueantes que se encontraron y arreglaron, en orden

Cada uno era invisible hasta que el anterior estaba resuelto. El pipeline falla en capas.

1. **Callback en ngrok muerto** → reapuntado a Vercel con `devtools_webhook_manage`.
2. **`INNGEST_SIGNING_KEY` invalida** (`401 Your signing key is invalid` en el `PUT` de sync) → rotada y recargada.
3. **`META_APP_SECRET` viejo** (`meta.webhook.hmac.invalid`, Meta entregaba y se rechazaba) → actualizado.
4. **`UPSTASH_REDIS_REST_URL` = `https://placeholder.upstash.io`** (`ENOTFOUND`, el webhook devolvia 500 y Meta reintentaba) → variables placeholder eliminadas.
5. **`INNGEST_EVENT_KEY` invalida** (`401 Event key not found`, el mensaje se parseaba y moria al pasar a Inngest) → reemplazada.

Todas eran variables de Vercel de hace 39 dias, de una preparacion que nunca se llego a desplegar.

### Lo ultimo que falta — un solo paso

Se cargo `LLM_MODE=real` y el `META_WHATSAPP_ACCESS_TOKEN` bueno (el de `.env.local`, que funciona), y se redesplego. **Falta mandar un WhatsApp y confirmar que el agente responde.**

Los dos ultimos errores vistos, ya corregidos pero sin verificar:

- `[mock agent — LLM_MODE=mock activo]` → arreglado con `LLM_MODE=real`.
- `Meta auth error (wa.sendText): Invalid OAuth access token` (code 190) → arreglado con el token nuevo.

Si el proximo mensaje entra Y el agente contesta por WhatsApp, la cadena esta cerrada en las dos direcciones.

### DEFECTO DE CODIGO ENCONTRADO — pendiente de arreglar con test

`makeRateLimiterFromEnv` (`src/lib/rate-limit/index.ts:118`) chequea solo `if (!options.url || !options.token)`. Un placeholder **es** una URL valida, asi que pasa el filtro, construye un cliente Redis contra un host inexistente, y **tumba el webhook con 500** — haciendo que Meta reintente en loop.

`makeCostTracker` (`src/lib/observability/upstash-cost-tracker.ts:77`) hace lo correcto: usa `isPlaceholder()` y degrada limpio a InMemory con un warn.

**Dos fabricas, el mismo escenario, comportamientos opuestos.** La del rate limiter tiene que usar el mismo `isPlaceholder()`. Es exactamente el patron que este proyecto viene cazando: una guarda que parece estar y no esta.

### B2 confirmado con evidencia

Los logs de produccion dicen `cost-tracker in-memory: daily cap NO persistente entre cold starts`. **Los valores de Upstash eran placeholders**, y ahora las variables estan directamente eliminadas. En produccion no hay tope de gasto persistente ni rate limit en el webhook (`NoopRateLimiter`).

No bloquea hoy: el numero de prueba no esta publicado y el HMAC cubre el borde. **Entra al checklist de publicar el numero.**

### Tareas 2 y 3 del plan: sin empezar

- Task 2 (los 9 campos de webhook que se descartan) — sin tocar.
- Task 3 (`v21.0` → `v26.0`) — sin tocar, y sin urgencia: Meta no tiene deprecaciones abiertas contra la app.

### MCP nuevos, sin commitear

`.mcp.json` esta **untracked**. Tiene dos servidores, ninguno con secretos:

- `meta_developer_tools` → `https://mcp.facebook.com/devtools` (OAuth, ya autenticado, scope read+manage sobre `Crm Genuino`)
- `inngest-dev` → `http://127.0.0.1:8288/mcp` (sin auth, solo sirve con el dev server local levantado)

**Decision pendiente del dueño:** commitearlo (toda sesion futura sobre el repo los levanta sola) o dejarlo local.

Opcional para la proxima: una API key de Inngest (`sk-inn-api-...`) habilita el MCP de Inngest **Cloud**, con `list_runs`, `get_run_trace` y demas. Convierte "creo que funciono" en "aca esta la corrida".

---

## PLAN COMPLETO — 2026-08-25

Las tres tareas cerradas y verificadas contra producción real.

### Task 1 — Deploy con URL estable ✅

`https://crm-wine-one-38.vercel.app`. Cadena entera funcionando en las dos direcciones: WhatsApp → Meta → Vercel → HMAC → Inngest → Postgres → OpenAI → Meta → teléfono, en 7-8 segundos.

`/api/health` pasó de `degraded` a **`ok`**: `db`, `inngest` y `openai` los tres verdes. Antes `openai` daba `skipped` porque la key era un placeholder — el endpoint de salud recién ahora dice la verdad.

**Se encontraron 7 variables placeholder**, todas de una tanda de 39 días atrás de una preparación que nunca se desplegó. Cada una era invisible hasta arreglar la anterior:

| #   | Variable                        | Sintoma                                                |
| --- | ------------------------------- | ------------------------------------------------------ |
| 1   | callback en ngrok muerto        | mensajes perdidos sin error                            |
| 2   | `INNGEST_SIGNING_KEY`           | `401 signing key is invalid` en el sync                |
| 3   | `META_APP_SECRET`               | `hmac.invalid` — Meta entregaba y se rechazaba         |
| 4   | `UPSTASH_REDIS_REST_URL`        | `ENOTFOUND placeholder.upstash.io`, 500 y Meta en loop |
| 5   | `INNGEST_EVENT_KEY`             | `401 Event key not found`                              |
| 6   | `OPENAI_API_KEY`                | `Incorrect API key: dev-plac***lder`                   |
| 7   | `META_WHATSAPP_PHONE_NUMBER_ID` | `Object with ID '000000000000000'`                     |

**Lección para el runbook:** un deploy que levanta y responde 200 no prueba nada. `/api/health` daba 200 con `inngest: ok` mientras el pipeline no procesaba un solo mensaje. Lo unico que valida es disparar tráfico real y leer los logs.

### Task 2 — Campos operativos del webhook ✅

`parseMetaOperationalEvents()` + tabla `meta_operational_events` + función de Inngest. Captura cualquier campo que no sea `messages`, incluidos los que Meta invente después. Detalle y formas verificadas en `docs/meta-webhook-payloads.md`.

Suscripción reducida de 10 campos a los 3 que el código maneja.

### Task 3 — `v21.0` → `v26.0` ✅

Sin urgencia real: cero deprecaciones abiertas contra la app, y el changelog no trae cambios que rompan el envío de texto. Verificado disparándolo — mensaje y respuesta con `wamid` de Meta.

### Bug de código encontrado y arreglado en el camino

`makeRateLimiterFromEnv` chequeaba solo si la URL estaba vacía; un placeholder **es** una URL válida, así que construía un cliente Redis contra un host inexistente y tumbaba el webhook. `makeCostTracker` nunca tuvo el bug porque usaba `isPlaceholder()` — que vivía **privada** en su módulo, y esa era la causa raíz: la regla no se podía compartir. Ahora es `esPlaceholder()` en `src/lib/config-placeholder.ts` y las dos fábricas la usan.

### Divergencia repo↔ledger cerrada

El CLI de Supabase se negaba a aplicar por dos entradas fantasma (`seed_seguimiento_carlos`, `limpiar_leads_de_prueba`) que se arrastraban desde la sesión de Métricas. Reparadas: **64 archivos = 64 en el ledger** por primera vez en semanas.

### Lo que sigue pendiente, sin adornos

- **Sin rate limit ni tope de gasto en producción.** Las variables de Upstash quedaron eliminadas porque eran placeholders que reventaban. `NoopRateLimiter` y cost tracker en memoria. **No urge con el número sin publicar; es requisito antes de publicarlo.**
- **Sin Sentry.** `AGENTS.md` lo lista como obligatorio pre-launch. Una excepción no atrapada en producción no la ve nadie.
- **Sin pen test.** Es la primera vez que la app está expuesta a internet. RLS está (43 policies, matriz 11/11) pero nunca se probó desde afuera.
- **Nada emite el evento que dispara un workflow.** El motor de W2 está completo y sólo arranca a mano. Queda para W3.
- **Integration tests congelados**, esperando la base aislada.
