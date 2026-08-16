# Cómo correr el CRM

Cómo levantarlo, por qué cada pieza está ahí, y qué revisar cuando algo no anda.

---

## 1. Lo primero: quién llama a quién

Casi toda la confusión de este proyecto sale de no tener esto claro. **La dirección de la llamada decide si hace falta un túnel.**

|                                    | Dirección | ¿Necesita túnel?                                                           |
| ---------------------------------- | --------- | -------------------------------------------------------------------------- |
| App → Supabase                     | sale      | **No.** Supabase ya es público: `https://<ref>.supabase.co`                |
| App → OpenAI                       | sale      | No                                                                         |
| App → Meta (mandar un WhatsApp)    | sale      | No                                                                         |
| **Meta → App** (entra un WhatsApp) | **entra** | **Sí**                                                                     |
| Inngest → App                      | entra     | No en local: el dev server corre en la misma máquina y llega a `localhost` |

Tu notebook no tiene dirección pública. Cuando el cliente escribe por WhatsApp, **Meta tiene que golpear tu puerta**, y sin una URL pública no hay puerta. Eso es todo lo que resuelve ngrok.

**Al desplegar a Vercel, ngrok desaparece**: la app pasa a tener URL propia y el webhook de Meta apunta ahí para siempre.

---

## 2. Levantar todo, en orden

### Sin WhatsApp (para tocar pantallas)

Alcanza con esto. La app lee y escribe en Supabase igual.

```bash
npm run dev
```

Queda en `http://localhost:3001`. Entrás con `admin-dev@crm.local`.

### Con WhatsApp (para probar el pipeline entero)

Tres procesos, cada uno en su terminal.

**1. La app**

```bash
npm run dev
```

**2. Inngest**, que ejecuta los workflows. El script ya apunta al endpoint correcto:

```bash
npm run inngest:dev
```

Consola en `http://localhost:8288`. Ahí se ven las corridas, los reintentos y el resultado de cada paso — es el primer lugar donde mirar cuando un mensaje entra y no pasa nada.

**3. El túnel**, que es la puerta de entrada:

```bash
ngrok http 3001
```

Devuelve una URL tipo `https://algo.ngrok-free.dev`. **Esa URL cambia cada vez que reiniciás ngrok**, y por eso hay un paso 4.

**4. Apuntar el webhook de Meta a la URL nueva.** En el panel de la app de Meta, el callback va a:

```
https://<lo-que-devolvio-ngrok>/api/webhooks/meta
```

con el `META_VERIFY_TOKEN` que está en `.env.local`. Meta hace un GET de verificación al guardarlo; si contesta 200, quedó.

> **La suscripción va en dos niveles.** El evento `messages` hay que suscribirlo **en la app Y en la WABA**. Con solo el primero los mensajes quedan en la consola de Meta y nunca llegan: pasó, y llevó un rato entender por qué el webhook estaba "bien" y no entraba nada.

---

## 3. Variables de entorno

Viven en `.env.local`, que **no se commitea**. `src/lib/env.ts` las valida al arrancar y falla de una si falta alguna obligatoria — mejor no arrancar que arrancar a medias.

**Obligatorias:**

```
NEXT_PUBLIC_SUPABASE_URL          NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY         OPENAI_API_KEY
LLM_MODE                          LLM_DAILY_CAP_USD
META_APP_SECRET                   META_VERIFY_TOKEN
META_WHATSAPP_ACCESS_TOKEN        META_WHATSAPP_PHONE_NUMBER_ID
META_GRAPH_API_VERSION            INNGEST_EVENT_KEY
INNGEST_SIGNING_KEY
```

**Opcionales:** las de Instagram y Facebook (`META_IG_*`, `META_FB_*`), las de modelo por workflow (`OPENAI_MODEL*`), Sentry (`SENTRY_DSN`) y Upstash.

> **`INNGEST_DEV=1` es obligatoria en local** aunque figure como opcional. Sin ella `inngest.send()` sale hacia Inngest Cloud con una key falsa, devuelve 401, el webhook responde 500 y Meta reintenta el mismo mensaje una y otra vez. **`NODE_ENV=development` no alcanza.**

> Las opcionales **se omiten, no se dejan vacías**: `.optional()` de Zod no acepta `""` y el boot se cae.

---

## 4. La base de datos

Hay dos, y no son intercambiables.

**`crm-dev` en la nube** es donde vive la app. Ahí están tus leads y tus conversaciones.

```bash
npm run db:push        # aplica las migraciones nuevas
npm run db:gen-types   # regenera los tipos de TypeScript
```

**El stack local en Docker** es solo para los tests de integración:

```bash
npx supabase start     # levanta Postgres + PostgREST + Auth
npx supabase stop      # lo baja
```

Corre en el rango de puertos **553xx** y no en el 543xx habitual, porque ese lo ocupa otro proyecto en esta máquina.

> **Por qué existe.** Los tests de integración borran 17 tablas antes de cada test. Apuntados a `crm-dev` te vacían la base de trabajo. Hay una guarda que aborta si las dos URLs coinciden, pero la guarda evita el desastre, no habilita los tests: para eso está la base local.

```bash
npm run test:integration
```

---

## 5. Probar sin usar WhatsApp

El camino corto para verificar un cambio de comportamiento sin mandarse un mensaje real: se le tira el evento directo a Inngest y se mira qué quedó en la base.

```bash
curl -s -X POST http://localhost:8288/e/dev_key -H "Content-Type: application/json" -d '{
  "name": "meta/message.received",
  "data": { "parsed": {
    "canal": "wa",
    "canal_thread_id": "593979932363",
    "meta_user_id": "593979932363",
    "meta_message_id": "wamid.PRUEBA-1",
    "tipo": "text",
    "contenido": "Necesito factura con RUC",
    "media_url": null,
    "nombre_perfil": "Leonardo Alvarez",
    "platform_created_at": null,
    "raw": { "type": "text" }
  }}
}'
```

Cierra el lazo entero —Inngest, Next, OpenAI, Postgres— sin tocar Meta. **`meta_message_id` tiene que ser distinto cada vez**: hay deduplicación por ese campo y repetirlo hace que el pipeline lo ignore, que es lo correcto pero confunde si uno no se acuerda.

---

## 6. Cuando algo no anda

| Síntoma                                                    | Qué pasa                                                                                                                    |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Mandás un WhatsApp y no llega nada                         | El túnel se cayó o cambió de URL. `ngrok http 3001` y volvé a apuntar el webhook.                                           |
| El webhook devuelve 500 y Meta reintenta                   | Falta `INNGEST_DEV=1`.                                                                                                      |
| Los mensajes salen en la consola de Meta pero no en la app | `messages` está suscrito en la app pero no en la WABA.                                                                      |
| La app no arranca y se queja de una variable               | `env.ts` está haciendo su trabajo. Una opcional declarada vacía cuenta como falta.                                          |
| Un mensaje entra pero el agente no contesta                | Mirá la corrida en `localhost:8288`: dice en qué paso se cortó.                                                             |
| El agente dice "no tenemos" de todo                        | El catálogo está vacío a propósito hasta que exista el documento de macheo.                                                 |
| Las pantallas quedan en el esqueleto de carga              | Corriste `npm run build` con el dev server vivo y se corrompió `.next/`. Matá el proceso, borrá `.next` y arrancá de nuevo. |

---

## 7. Antes de dar algo por terminado

```bash
npm run typecheck
npm run lint
npm run test
```

Y si tocaste repositorios o SQL, con el stack local arriba:

```bash
npm run test:integration
```

Si tocaste un schema que viaja a Structured Outputs de OpenAI, esta cuesta centavos y es obligatoria:

```bash
npx vitest run -c vitest.integration.config.ts tests/integration/llm-schemas.openai.test.ts
```

---

**Para desplegar a producción** el runbook es otro: `docs/runbooks/deploy-produccion.md`.
