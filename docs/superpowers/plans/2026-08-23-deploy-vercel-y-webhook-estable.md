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

### B2 — [DUEÑO] Decisión sobre el tope de gasto de IA

`AGENTS.md` registra que Upstash quedó afuera por decisión tuya. Consecuencia que ahora es real y no teórica: el `CostTracker` cae al fallback **InMemory**, y en serverless cada invocación arranca con memoria limpia. **El kill-switch de gasto diario no funciona en producción.**

Hasta hoy eso no importaba porque no había producción. Con una URL pública, cualquiera que consiga tu número puede generar llamadas a OpenAI sin techo.

Tres caminos, y hay que elegir uno antes del deploy: (a) Upstash (revierte la decisión, ~gratis en free tier), (b) desplegar igual y aceptar que no hay tope, (c) bajar `LLM_DAILY_CAP_USD` y aceptar que solo limita dentro de una misma invocación.

---

## Task 1 — Deploy a Vercel con URL estable

**Files:** ninguno de código. Es configuración y verificación.

**Depende de:** B1 y B2 resueltos.

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

- **No arregla que el tope de gasto de IA no funcione en serverless.** Depende de B2. Si el dueño elige (b) o (c), producción queda sin techo real de gasto de OpenAI y hay que decirlo al cerrar.
- **No pone Sentry.** `AGENTS.md` lo lista como obligatorio pre-launch y sigue pendiente. Sin él, una excepción no atrapada en producción no se entera nadie.
- **No hace pen test** ni revisión de seguridad del endpoint público. Es la primera vez que la app queda expuesta a internet; RLS está (43 policies, matriz 11/11) pero nunca se probó desde afuera.
- **No toca la IA del CRM.** Las herramientas de DevTools son de desarrollo y se quedan en desarrollo: el agente vendedor procesa texto de desconocidos, y darle una herramienta que escribe configuración de Meta es prompt injection con superficie abierta.
- **No corre los integration tests.** Siguen congelados esperando la base aislada.
