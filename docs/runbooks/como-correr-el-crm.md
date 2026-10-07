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

**El stack local en Docker** es para los tests de integración y para el entorno aislado de la §4.1:

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

## 4.1 Entorno local aislado (stack local completo)

Para desarrollar y verificar **sin tocar crm-dev, Meta ni OpenAI**: Supabase en Docker, la app en el **3002**, Inngest en el **8298** y un mock de la Graph API en el **55390**. Todo es desechable.

| Pieza          | Dónde                                                           | Qué es                                                       |
| -------------- | --------------------------------------------------------------- | ------------------------------------------------------------ |
| Supabase local | `127.0.0.1:55321` (API) · `55322` (Postgres) · `55323` (Studio) | `supabase start`, con el `config.toml` del repo              |
| App            | `http://localhost:3002`                                         | `next dev` con `.env.stack-local`                            |
| Inngest dev    | `http://127.0.0.1:8298`                                         | puertos propios: no choca con `npm run inngest:dev` (8288)   |
| Mock de Meta   | `http://127.0.0.1:55390`                                        | `scripts/mock-meta-graph.mjs`, log en `logs/mock-meta.jsonl` |

### Levantar, sembrar, correr

```bash
npm run stack:up        # supabase start + migraciones pendientes + genera .env.stack-local
npm run stack:seed      # empresa, 2 usuarios, config del agente, 3 leads, etiquetas, 1 flujo
# cada uno en su terminal:
npm run mock:meta
npm run dev:local
npm run inngest:local
```

Abrí **`http://localhost:3002`**. Con el `next dev` anterior, escuchando en `0.0.0.0`, `127.0.0.1:3002` hacía fallar el websocket de HMR y la página se recargaba en bucle. Ahora `dev:local` escucha en `127.0.0.1` (`-H`) y Next suma ese host a sus orígenes permitidos: en una prueba de 10 s no recargó, pero no se verificó a fondo. `localhost` es el camino probado.

**Solo loopback.** `dev:local` (`-H 127.0.0.1`), `inngest:local` (`--host 127.0.0.1`) y el mock escuchan en `127.0.0.1`. **Excepción:** el Inngest CLI 1.45.1 no tiene flag para bindear el gateway de Connect (8299) ni sus gRPC (50062/50063): quedan en todas las interfaces. `--host` solo cubre la API (8298), y ni `--help` ni la documentación de Inngest traen otro flag. Si la red no es de confianza, bloquealos con el firewall de Windows.

**Convive con `npm run dev`.** Next 16 bloquea su `distDir` con un lockfile. Por eso el lanzador corre `dev:local` con `NEXT_DIST_DIR=.next-local` y le pasa `NEXT_TSCONFIG_PATH=tsconfig.stack-local.json`, un tsconfig propio que extiende el trackeado y que git ignora. Sin ese tsconfig, `next dev` reescribe `tsconfig.json` para sumarle los tipos del otro directorio. `next-env.d.ts`, que git también ignora, queda apuntando al `distDir` del último `next dev` que arrancó.

**Credenciales.** Todas viven en `.env.stack-local` (lo genera `npm run stack:env` y lo ignora git por la regla `.env*`). Los usuarios son `admin-local@crm.local` y `vendedor-local@crm.local`, y sus contraseñas están en `SEED_ADMIN_PASSWORD` y `SEED_VENDEDOR_PASSWORD`, generadas al azar. Volver a correr `stack:env` refresca las claves de Supabase y **conserva** las contraseñas y los secretos de prueba. Nada ahí sirve contra un servicio real.

**Datos del seed.** Todos inventados: nombres con «(prueba)» y teléfonos del rango ficticio de NANP `+1 202 555-01xx`, guardados como dígitos E.164 sin `+`, igual que los guarda el pipeline. El agente queda abierto todo el día en `America/Guayaquil`: con horario comercial no contesta de noche (`skipped: fuera_de_horario`). El flujo de ejemplo es un borrador sin publicar, así que no dispara nada. El seed es idempotente.

### Por qué `.env.local` no se cuela

Next carga `.env.local` siempre. Todos los comandos `*:local` pasan por `scripts/con-stack-local.mjs`, que hace dos cosas:

1. Pone cada variable de `.env.stack-local` en el proceso. En `@next/env`, una clave de archivo solo se carga si `process.env[k]` es `undefined`. En Vitest, `loadEnv` de Vite copia `process.env` encima de los archivos. En los dos casos gana el proceso.
2. Pone `""` en toda clave que aparezca en algún `.env*` y **no** esté en `.env.stack-local`. `env.ts` trata `""` como ausente, así que ninguna key real de OpenAI, Upstash, Sentry ni la URL de crm-dev llega a la app local. De esos archivos solo se leen los nombres, nunca los valores.

Además, aborta si la URL de Supabase, la de Meta o la de Inngest no son de loopback.

### Meta contra el mock

`META_GRAPH_API_BASE_URL` (en `env.ts`, por defecto `https://graph.facebook.com`) es lo que apunta los dos clientes de la Graph API al mock. Fuera de `localhost`/`127.0.0.1`/`[::1]` exige https, porque el token viaja en cada pedido. **Falta en `.env.local.example`**: un hook bloquea editar ese archivo («contiene secretos»), así que el dueño tiene que agregarla a mano como opcional.

```bash
# simular un WhatsApp entrante (webhook firmado con el META_APP_SECRET local)
curl -s -X POST http://127.0.0.1:55390/__mock/entrante -H 'content-type: application/json' \
  -d '{"from":"12025550104","texto":"Busco filtro de aceite","nombre":"Pedro Prueba"}'
# qué recibió el mock (envíos, plantillas, lecturas)
curl -s http://127.0.0.1:55390/__mock/log
# estados: sent | delivered | read | failed (con código)
curl -s -X POST http://127.0.0.1:55390/__mock/estado -H 'content-type: application/json' \
  -d '{"meta_message_id":"wamid.MOCK-…","status":"failed","codigo":131026}'
curl -s -X POST http://127.0.0.1:55390/__mock/reset
```

Dos `POST /__mock/estado` a la vez (`delivered` y `read` del mismo wamid) ejercitan la carrera de estados de entrega: con la guarda en el WHERE del UPDATE, el mensaje siempre termina en `leido`.

Opciones del mock: `MOCK_META_RECHAZAR_A=<teléfonos>` hace que el envío a esos números responda 400 con código 131026, y `MOCK_META_AUTO_ESTADOS=1` manda «entregado» y «leído» solos después de cada envío.

### Probar el copiloto

El copiloto (modo Copiloto de la bandeja) se prueba contra el stack local con el mock de Meta: lo que se mira es que se cree un borrador y que el mock **no** reciba ningún envío.

```bash
D='docker exec -i supabase_db_crm psql -U postgres -d postgres -qtA -c'
# 1. equipo abierto 24/7 (el default de fábrica es "sin equipo" = Automático). Aplica hasta 30 s
#    después: el provider de config cachea (TTL_CONFIG_MS). Con el LLM en mock el intent sale null y
#    el umbral de fábrica (2) escala a humano al segundo mensaje y manda un texto por la API aunque
#    sea Copiloto: subir escalar_umbral_intents a 5 para que no ensucie la medición.
$D "update public.agente_config set escalar_umbral_intents = 5, horario_equipo = '{\"lun\":[{\"desde\":\"00:00\",\"hasta\":\"23:59\"}],\"mar\":[{\"desde\":\"00:00\",\"hasta\":\"23:59\"}],\"mie\":[{\"desde\":\"00:00\",\"hasta\":\"23:59\"}],\"jue\":[{\"desde\":\"00:00\",\"hasta\":\"23:59\"}],\"vie\":[{\"desde\":\"00:00\",\"hasta\":\"23:59\"}],\"sab\":[{\"desde\":\"00:00\",\"hasta\":\"23:59\"}],\"dom\":[{\"desde\":\"00:00\",\"hasta\":\"23:59\"}]}'::jsonb where activa"
# 2. entrante simulado con un teléfono nuevo
curl -s -X POST http://127.0.0.1:55390/__mock/reset
curl -s -X POST http://127.0.0.1:55390/__mock/entrante -H 'content-type: application/json'   -d '{"from":"12025550122","texto":"Busco filtro de aceite","nombre":"Copiloto Prueba"}'
# 3. a los ~10 s: un borrador listo, sin leer su texto; y 0 envíos al mock
$D "select b.estado, b.origen, length(b.contenido) > 0 from public.borradores_ia b join public.conversaciones c on c.id = b.conversacion_id where c.canal_thread_id = '12025550122'"
curl -s http://127.0.0.1:55390/__mock/log | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log('envios a Meta:',JSON.parse(s).filter(e=>String(e.tipo).startsWith('graph.envio')).length))"
```

Esperado: `listo|ia|t` y `envios a Meta: 0`. Control: con `horario_equipo` sin rangos (cada día `[]`), esperar 30 s y repetir con otro teléfono: aparece una entrada `graph.envio.text` y ningún borrador. Para forzar el modo en una conversación sin tocar el horario: `update public.conversaciones set modo_respuesta_override = 'copiloto' where canal_thread_id = '…'`.

Regenerar sin la pantalla: emitir el mismo evento que la Server Action, `curl -s -X POST http://127.0.0.1:8298/e/dev_key -H 'content-type: application/json' -d '{"name":"copiloto/borrador.solicitado","data":{"borradorId":"<id del listo>","conversacionId":"<conversacion_id>","solicitadoPor":null}}'`. Queda el viejo en `descartado`, uno nuevo en `listo` y el mock sin envíos; repetir con el mismo `borradorId` no hace nada (log `copiloto-omitido` / `borrador_no_vigente`). No contar `mensajes` con `direction = 'out'` en toda la base: el seed ya trae salientes.

### Integration tests

```bash
npm run test:integration:local
```

Apunta `SUPABASE_TEST_URL` al stack local, deja `OPENAI_API_KEY` vacía (la suite de contrato contra OpenAI se saltea) y deja `NEXT_PUBLIC_SUPABASE_URL` vacía (en ese proceso no hay app). La protección contra un TRUNCATE a crm-dev pasa a ser el chequeo de loopback del lanzador. **Los tests vacían 17 tablas del stack local, seed incluido**, así que al terminar se re-siembra solo, pasen o fallen.

### Migraciones: `db reset` no alcanza

`supabase db reset --local` (CLI 2.111.0) falla **siempre** en `20260925040000_difusion_supresiones_telefono_hash.sql` con `LOCK TABLE can only be used in transaction blocks (25P01)`: manda la primera sentencia fuera de una transacción. `supabase start` sobre un volumen nuevo y `supabase migration up --local` la aplican bien. El archivo no se toca porque ya está aplicado en crm-dev. Por eso:

```bash
npm run stack:reset     # base vacía + todas las migraciones + seed
npm run stack:verify    # ledger local == archivos de supabase/migrations
```

**Nunca** `npm run db:reset` ni `db:push`: esos van con `--linked` y apuntan a crm-dev.

### Destruir

```bash
npm run stack:down      # supabase stop --no-backup: borra los volúmenes locales
```

Después hay que parar a mano los tres procesos (mock, app, Inngest). `.env.stack-local` queda, y el próximo `stack:up` lo regenera.

### Realtime en local

La CSP de `next.config.ts` suma el origen de Supabase (`http://` y `ws://`) a `connect-src` **solo** cuando `NEXT_PUBLIC_SUPABASE_URL` es de loopback. Con una URL de Supabase Cloud el header queda idéntico al de producción, y `tests/unit/next-config.test.ts` lo fija. Verificado el 2026-09-25 desde una página de `localhost:3002`: el canal `postgres_changes` sobre `workflow_runs` se suscribe con el JWT de la sesión y recibe el UPDATE. Un origen de control fuera de la CSP queda bloqueado. **Sin verificar:** el componente de corrida en vivo montado, porque el panel del navegador estaba oculto.

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

**Producción: el registro de Inngest es automático.** `.github/workflows/inngest-sync.yml` hace `PUT /api/webhooks/inngest` después de cada deploy exitoso a Production (3 intentos, 10 s entre uno y otro) y falla si la respuesta no es 200 con "Successfully registered". Ya no hace falta el `curl` a mano. Usa la URL del deploy o, si falta, la variable de repo `PRODUCTION_URL` (por defecto `https://crm-wine-one-38.vercel.app`). Si el job queda rojo, repetí el `curl -X PUT` a mano y mirá el log del job.

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
