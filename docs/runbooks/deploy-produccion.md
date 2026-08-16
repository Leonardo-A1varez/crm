# Runbook — Deploy a producción

> Estado al escribirlo (2026-08-14, verificado con comandos, no de memoria): `master` = `19c4f3a`, 0 commits sin pushear · 1617/1617 tests · typecheck + lint limpios · `npm run build` exit 0, 21 rutas · 38/38 migraciones aplicadas en **`crm-dev`**.
>
> **El código está listo. Lo que falta no es código.** Este runbook cubre lo que sí falta: base de producción, credenciales reales, webhook público y datos de negocio.

---

## Antes de empezar: las tres decisiones que nadie tomó todavía

Ninguna la puede tomar un agente. Sin respuesta a las tres, el resto del runbook no arranca.

| #   | Decisión                                                               | Por qué bloquea                                                                                                                                                                                                                                    | Recomendación                                                                              |
| --- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 1   | **¿Proyecto Supabase nuevo para producción, o se promueve `crm-dev`?** | `crm-dev` tiene 2 leads de prueba y usuarios de dev. Si producción apunta ahí, datos reales de clientes se mezclan con basura de desarrollo, y cualquier `db reset` futuro borra clientes reales.                                                  | **Proyecto nuevo.** `crm-dev` queda como desarrollo.                                       |
| 2   | **¿Se aplica el tope de gasto de LLM (Upstash)?**                      | `AGENTS.md` dice que el dueño **no quiere tope de gasto**, pero `LLM_DAILY_CAP_USD` es **requerida** por el schema. Sin Upstash, el kill-switch usa memoria y **no funciona en serverless** (cada invocación arranca en cero → el tope no existe). | Poner Upstash igual. Un bug en un loop de agente con OpenAI a pago por uso no tiene techo. |
| 3   | **¿Número de WhatsApp real o seguir con el de prueba?**                | El número de prueba de Meta (`+1 555 667-7618`) solo habla con números en lista blanca. Un soft launch con clientes reales necesita número propio + verificación de empresa.                                                                       | Soft launch con lista blanca primero (5-10 números conocidos), después número real.        |

---

## Fase A — Base de datos de producción

> Saltar entera si la decisión 1 fue "promover `crm-dev`" (no recomendado).

- [ ] **A1.** Crear proyecto Supabase nuevo. Región: la más cercana al cliente (Brasil → `sa-east-1`). Plan **Pro** (el free tier se auto-pausa por inactividad y mata el webhook).
- [ ] **A2.** Guardar la contraseña de la base en el gestor de contraseñas. No va a este chat ni a un archivo del repo.
- [ ] **A3.** Linkear y aplicar las 38 migraciones:

```bash
npx supabase link --project-ref <REF_DE_PRODUCCION>
```

```bash
npm run db:push
```

- [ ] **A4.** Verificar que quedaron las 38:

```bash
npx supabase migration list --linked
```

Esperado: 38 filas con `local` y `remote` iguales. Si alguna tiene `remote` vacío, **parar**: el esquema quedó a medias.

- [ ] **A5.** Advisors de seguridad. Los 4 conocidos y aceptados: `pg_trgm` en `public`, protección de contraseñas filtradas desactivada, y 2 INFO de RLS sin policy (`event_outbox`, `reactivation_dispatches` — tablas de sistema, sin acceso de cliente). **En producción, activar la protección de contraseñas filtradas** (Dashboard → Authentication → Policies): es un clic y cubre a los vendedores que se crean cuenta.
- [ ] **A6.** Backups: Dashboard → Database → Backups. Confirmar que el PITR del plan Pro está activo.

---

## Fase B — Credenciales

> ⚠️ **Ningún secreto va por el chat del asistente.** Se cargan con `vercel env add` (pide el valor por stdin, no queda en el historial de comandos) o pegándolos en Vercel Dashboard → Settings → Environment Variables.
>
> Rotación cada 90 días: `META_APP_SECRET`, `OPENAI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `INNGEST_SIGNING_KEY`. Ver `docs/runbooks/secrets-rotation.md`.

- [ ] **B1. Vercel CLI** (no está instalado):

```bash
npm i -g vercel
```

```bash
vercel login
```

- [ ] **B2. Inngest Cloud.** Crear cuenta y app en <https://app.inngest.com>. Sacar `INNGEST_EVENT_KEY` y `INNGEST_SIGNING_KEY` de producción.

  **`INNGEST_DEV` NO se setea en Vercel.** Existe solo para local. Si queda seteada en producción, los eventos van al dev server que no existe y **el pipeline entero muere en silencio**.

- [ ] **B3. OpenAI.** Key de producción con límite de gasto mensual configurado en el dashboard de OpenAI (segunda barrera, independiente de `LLM_DAILY_CAP_USD`).

- [ ] **B4. Upstash Redis** (ver decisión 2). Free tier alcanza para el piloto: 10K comandos/día.

- [ ] **B5. Sentry.** Proyecto nuevo → DSN. Sin DSN el código no falla, solo queda sin captura de errores.

- [ ] **B6. Meta.** Del panel de la app en <https://developers.facebook.com>: `META_APP_SECRET`, `META_WHATSAPP_PHONE_NUMBER_ID`, `META_WHATSAPP_ACCESS_TOKEN` (token de usuario del sistema, **sin caducidad**). `META_VERIFY_TOKEN` lo inventás vos: una cadena aleatoria larga, la misma que pondrás en el panel de Meta en la fase D.

---

## Fase C — Variables de entorno en Vercel

Lista extraída de `src/lib/env.ts` (schema Zod, es la autoridad). **La app hace fail-fast al arrancar**: si falta una requerida, no levanta y el error dice cuál.

### Requeridas — sin estas la app no arranca

| Variable                        | Origen                    | Nota                                                     |
| ------------------------------- | ------------------------- | -------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | Supabase → Settings → API | URL del proyecto de **producción**                       |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | idem                      | Pública, va al browser                                   |
| `SUPABASE_SERVICE_ROLE_KEY`     | idem                      | **Secreta.** Nunca con prefijo `NEXT_PUBLIC_`            |
| `INNGEST_EVENT_KEY`             | Inngest Cloud             |                                                          |
| `INNGEST_SIGNING_KEY`           | Inngest Cloud             |                                                          |
| `OPENAI_API_KEY`                | OpenAI                    |                                                          |
| `META_APP_SECRET`               | Meta                      | Verifica el HMAC de cada webhook entrante                |
| `META_VERIFY_TOKEN`             | lo inventás vos           | Debe coincidir con el panel de Meta                      |
| `META_WHATSAPP_PHONE_NUMBER_ID` | Meta                      |                                                          |
| `META_WHATSAPP_ACCESS_TOKEN`    | Meta                      | Token de sistema sin caducidad                           |
| `META_GRAPH_API_VERSION`        | fijo                      | Formato `v<major>.<minor>`. Hoy `v21.0` — ver nota abajo |
| `LLM_DAILY_CAP_USD`             | decisión                  | Sugerido prod: `100`                                     |

### Opcionales — pero recomendadas en producción

| Variable                                              | Si falta                                                                                |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` | Rate limit del webhook **desactivado** y el tope de gasto **no funciona en serverless** |
| `SENTRY_DSN` + `NEXT_PUBLIC_SENTRY_DSN`               | Sin captura de errores                                                                  |
| `LLM_MODE`                                            | Default `real`. Dejar sin setear                                                        |
| `OPENAI_MODEL`                                        | Default `gpt-4o-mini` para los 4 LLM auxiliares                                         |
| `META_IG_*` / `META_FB_*`                             | IG y FB tiran `ValidationError` al enviar. WA-only funciona igual                       |

### No setear en producción

| Variable                                          | Por qué                                                                               |
| ------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `INNGEST_DEV`                                     | Rutea los eventos al dev server local. **Mata el pipeline en producción**             |
| `SUPABASE_TEST_URL` / `SUPABASE_TEST_SERVICE_KEY` | Solo tests. La suite hace TRUNCATE de 17 tablas                                       |
| `OPENAI_MODEL_AGENT`                              | Deprecada. El modelo del agente sale de la tabla `agente_config` (pantalla `/agente`) |

> **Nota sobre `META_GRAPH_API_VERSION`:** `v21.0` está documentada en `docs/meta-platform-limits.md` como pendiente de actualización. Antes del launch, confirmar en el changelog de Meta que sigue soportada; las versiones de Graph API se dan de baja a los ~2 años.

Cargar con:

```bash
vercel env add NEXT_PUBLIC_SUPABASE_URL production
```

- [ ] **C1.** Cargar las 12 requeridas en el scope `production`.
- [ ] **C2.** Cargar las opcionales elegidas.
- [ ] **C3.** Verificar que están todas (muestra nombres, no valores):

```bash
vercel env ls production
```

---

## Fase D — Deploy y webhook

- [ ] **D1. Deploy a preview primero.** Nunca directo a producción:

```bash
vercel deploy
```

- [ ] **D2. Health check del preview.** Reemplazar `<URL_PREVIEW>`:

```bash
curl -s https://<URL_PREVIEW>/api/health
```

Esperado: `{"status":"ok","checks":{"db":"ok","inngest":"ok","openai":"ok"}}`

Cómo leerlo (de `src/app/api/health/route.ts`):

- `"db":"fail"` → **503**. Supabase mal configurado o el grant de `server_now()` a `anon` no se aplicó. **Parar acá.**
- `"skipped"` → la key parece placeholder (vacía, o empieza con `test-`). Falta cargarla de verdad.
- `"degraded"` → la DB anda pero un servicio externo no responde. Investigar antes de seguir.

- [ ] **D3. Promover a producción** (solo si D2 dio `ok`):

```bash
vercel deploy --prod
```

- [ ] **D4. Registrar las funciones en Inngest.** En Inngest Cloud → Apps → agregar la URL:

```
https://<DOMINIO_PROD>/api/webhooks/inngest
```

Confirmar que aparecen **12 funciones**. Si aparecen menos, el deploy no tomó las deps.

- [ ] **D5. Webhook de Meta.** En el panel de la app → WhatsApp → Configuration:
  - Callback URL: `https://<DOMINIO_PROD>/api/webhooks/meta`
  - Verify token: el mismo valor de `META_VERIFY_TOKEN`
  - Meta hace un GET de handshake; si el token coincide, devuelve el `hub.challenge` y queda verificado.

- [ ] **D6. Suscribir el campo `messages` en DOS lugares.** Este es el error que ya costó una sesión entera:
  1. Nivel **app** → Webhooks → WhatsApp Business Account → campo `messages`.
  2. Nivel **WABA** → la cuenta de WhatsApp Business específica.

  Faltando el segundo, los mensajes llegan a la consola de Meta y **nunca al webhook**, sin ningún error visible.

- [ ] **D7. Verificar el rechazo de HMAC.** Un POST sin firma debe dar **401**:

```bash
curl -s -o /dev/null -w "%{http_code}" -X POST https://<DOMINIO_PROD>/api/webhooks/meta -H "Content-Type: application/json" -d '{"test":1}'
```

Esperado: `401`. **Si devuelve 200, parar todo**: el endpoint acepta payloads falsos de cualquiera.

---

## Fase E — Datos de negocio

> Medido en `crm-dev` el 2026-08-14: **0 empresas · 0 productos · 0 intents · 0 reglas**. Sin esto el agente no tiene qué vender.

- [ ] **E1. La empresa.** El modelo es single-org: una fila en `empresas`. Sin ella, el white-label queda sin configurar.
- [ ] **E2. Usuarios reales.** Crear los vendedores desde Supabase Auth. El trigger de `20260512000004` los replica a `public.usuarios`. Asignar rol `admin` o `vendedor`.
- [ ] **E3. Catálogo de productos.** Es el bloqueador más grande: **el agente IA busca en `productos` y con 0 filas no puede cotizar nada.** Hay importador en `/productos/import`.
- [ ] **E4. Intents y reglas** (opcional al inicio). Sin reglas IF/THEN todo va al LLM: funciona, pero sale más caro. El cron `detect-intents.batch` propone intents solo los domingos y con conversaciones ya acumuladas.
- [ ] **E5. Configuración del agente.** En `/agente`: modelo, instrucciones de negocio, tono, política de escalado, horario. Ya hay 1 config activa; revisarla antes del launch.
- [ ] **E6. Plantillas de Meta.** Para reactivación hacen falta plantillas **aprobadas por Meta** (fuera de la ventana de 24 h no pasa texto libre). Aprobación: 24-48 h. Empezar temprano.

---

## Fase F — Prueba controlada antes de clientes reales

- [ ] **F1.** Poner 2-3 números propios en la lista blanca de Meta.
- [ ] **F2.** Mandar un mensaje real y confirmar la cadena completa:
  - Se creó el lead, la conversación y la sesión.
  - El agente respondió por WhatsApp.
  - En Inngest Cloud se ve la ejecución de `on-message-received` con sus steps.
  - En `/inbox` aparece la conversación con el Twin poblado.
- [ ] **F3. Verificar la corrección del doble envío** (el arreglo central de este ciclo): en la tabla `mensajes`, los salientes deben tener `meta_message_id` no nulo y `estado_entrega` nulo o avanzando. Una fila con `estado_entrega='fallido'` y su `error_entrega` es el comportamiento correcto ante un fallo — no un bug.
- [ ] **F4.** Probar el escalado a humano: pausar la IA desde el Inbox y confirmar que deja de responder.
- [ ] **F5.** Confirmar que el costo se registra: consultar `llm_usage` y ver filas con costo por turno.

---

## Fase G — Monitoreo

- [ ] **G1.** Monitor externo sobre `/api/health` cada 5 min (Vercel Monitoring, UptimeRobot o similar). Alertar en 503.
- [ ] **G2.** Confirmar que Sentry recibe eventos: forzar un error controlado y verlo aparecer.
- [ ] **G3.** Revisar el dashboard de Inngest: que no haya funciones en estado failed.
- [ ] **G4.** Panel de gasto de OpenAI: confirmar que el consumo real coincide con lo que registra `llm_usage`.

---

## Si algo sale mal

| Síntoma                                       | Causa probable                                               | Qué hacer                                             |
| --------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------- |
| La app no arranca, error de env               | Falta una var requerida                                      | El mensaje dice cuál. Cargarla y redeploy             |
| `/api/health` da 503                          | DB inalcanzable, o falta el grant de `server_now()` a `anon` | Verificar que la migración `20260714182011` se aplicó |
| Meta no entrega mensajes                      | Falta la suscripción a `messages` a nivel WABA (D6)          | Suscribir en los dos niveles                          |
| El webhook responde 500 y Meta reintenta      | `INNGEST_DEV` quedó seteada en producción                    | Borrarla de Vercel y redeploy                         |
| El agente responde "no encuentro el producto" | Catálogo vacío (E3)                                          | Cargar productos                                      |
| Gasto de OpenAI disparado                     | El tope no aplica sin Upstash en serverless                  | Cargar Upstash (decisión 2)                           |

**Rollback:** Vercel Dashboard → Deployments → el deployment anterior → _Promote to Production_. Es instantáneo. **Las migraciones de base no se revierten solas** — por eso la Fase A va sobre un proyecto nuevo, no sobre datos vivos.

---

## Qué queda pendiente después del launch

No bloquean, pero siguen abiertos:

- **QA visual humana** — ninguna de las pantallas se comparó contra el prototipo de diseño.
- **Tests de integración congelados** — necesitan un segundo proyecto Supabase (`SUPABASE_TEST_URL` apunta al mismo que la app; la guarda de la Tarea 5 evita el desastre pero no descongela la suite).
- **Rendimiento sin medir a escala** — falta `EXPLAIN ANALYZE` con volumen representativo.
- **`/ajustes`** — pantalla sin construir.
- **Realtime** — el Inbox usa un poller de 5 s, no suscripción.
