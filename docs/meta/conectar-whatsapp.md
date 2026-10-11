# Conectar WhatsApp (registro insertado v4, coexistencia)

Botón en **Ajustes › Salud de WhatsApp** (solo admin) que conecta el número que el negocio ya usa en la app **WhatsApp Business**: el número sigue andando en el teléfono y además entra al CRM por Cloud API (Meta lo llama _coexistence_). Escrito el 2026-10-11.

**Estado:** probado contra el mock local de la Graph API (`scripts/mock-meta-graph.mjs`), en unit tests y contra la RLS del stack local. **Contra Meta real no se probó nunca:** hace falta que Meta apruebe la app como Tech Provider y que el dueño cree la configuración de Facebook Login for Business (`config_id`).

## 1. Qué dice la documentación de Meta (leída el 2026-10-11)

Fuentes:

- [A] Onboarding de usuarios de la app Business: <https://developers.facebook.com/docs/whatsapp/embedded-signup/custom-flows/onboarding-business-app-users> (redirige a `/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users`).
- [B] Implementación de Embedded Signup: <https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation>
- [C] Versión 4: <https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/version-4>
- [D] Versiones: <https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/versions>
- [E] Onboarding como Tech Provider: <https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-customers-as-a-tech-provider>

| Tema                | Lo que dice                                                                                                                                                                                                                                                                                         | Fuente    |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| SDK                 | `https://connect.facebook.net/en_US/sdk.js`, `async defer crossorigin="anonymous"`; `FB.init({ appId, autoLogAppEvents: true, xfbml: true, version })`                                                                                                                                              | [B]       |
| `FB.login`          | `config_id`, `response_type: 'code'`, `override_default_response_type: true`, `extras`                                                                                                                                                                                                              | [B]       |
| Coexistencia        | `extras: { setup: {}, featureType: 'whatsapp_business_app_onboarding', sessionInfoVersion: '3' }` (ejemplo del paso 2)                                                                                                                                                                              | [A]       |
| v4                  | Se elige creando una configuración de Facebook Login for Business con los productos; «Selecting the products will automatically set you to v4». El onboarding de la app Business «continues to be supported through the `feature_type` parameter»                                                   | [C]       |
| Contradicción       | [D] dice que en v4 `extras` va «purposely empty», y [C]/[A] piden `featureType`. Se manda el `extras` de [A]. **No confirmado** cuál gana con una configuración v4 real                                                                                                                             | [A][C][D] |
| Evento del popup    | `postMessage` con `type: 'WA_EMBEDDED_SIGNUP'`; éxito de coexistencia: `event: 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING'`, `data: { waba_id }`, `version: 3`. **No trae `phone_number_id`**                                                                                                         | [A]       |
| Otros eventos       | Éxito: `FINISH`, `FINISH_ONLY_WABA`, …(con `phone_number_id`, `waba_id`, `business_id`). Abandono: `CANCEL` con `current_step`. Error: `error_message`, `error_code`, `session_id` (el ejemplo viene con `event: 'CANCEL'`)                                                                         | [B]       |
| Origen              | La doc chequea `event.origin.endsWith('facebook.com')`                                                                                                                                                                                                                                              | [B]       |
| Código              | TTL de **30 s**                                                                                                                                                                                                                                                                                     | [B]       |
| Canje               | `GET /oauth/access_token?client_id&client_secret&code`, server-to-server. La doc muestra la respuesta como `<BUSINESS_TOKEN>` a secas; **no confirmado** si es texto plano o `{ "access_token": … }`                                                                                                | [E]       |
| Suscripción         | `POST /{waba_id}/subscribed_apps` → `{ "success": true }`                                                                                                                                                                                                                                           | [E]       |
| Registro            | En coexistencia **no** se registra el número (`/register`): ya está registrado                                                                                                                                                                                                                      | [A]       |
| Verificación        | `GET /{phone_number_id}?fields=is_on_biz_app,platform_type` → `is_on_biz_app: true`, `platform_type: "CLOUD_API"`                                                                                                                                                                                   | [A]       |
| Webhooks            | Suscribir `history`, `smb_app_state_sync`, `smb_message_echoes` (además de los de siempre)                                                                                                                                                                                                          | [A]       |
| Sincronización      | `POST /{phone_number_id}/smb_app_data` `{ messaging_product: "whatsapp", sync_type }` con `smb_app_state_sync` (contactos, paso 1) y después `history` (paso 2). Respuesta `{ messaging_product, request_id }`                                                                                      | [A]       |
| Límites             | Cada sync **una sola vez**; dentro de las **24 h** de conectar (si no, hay que desconectar y repetir). Historial de **180 días**, sin grupos. Media sólo de los últimos 14 días                                                                                                                     | [A]       |
| `history`           | `history[].metadata { phase, chunk_order, progress }`, `threads[].id` = teléfono del cliente, `messages[]` con `from`, `id`, `timestamp`, `type`, `history_context.status`; `media_placeholder` llega después en otro webhook. `phase` 0 = día 0-1, 1 = 1-90, 2 = 90-180; `progress` 100 = completo | [A]       |
| Historial rechazado | `history[].errors[].code = 2593109`                                                                                                                                                                                                                                                                 | [A]       |
| Contactos           | `state_sync[]` con `type: "contact"`, `contact { full_name, first_name, phone_number }`, `action` (`add` o `remove`)                                                                                                                                                                                | [A]       |
| Ecos                | `message_echoes[]` con `from` (negocio), `to` (cliente), `id`, `timestamp`, `type` y el contenido                                                                                                                                                                                                   | [A]       |
| Ventana             | Lo que se manda desde la app no abre ni afecta la ventana de 24 h de Cloud API                                                                                                                                                                                                                      | [A]       |

**No confirmado / no está en la doc:** la lista exacta de orígenes que necesita el SDK (CSP), si `action` puede valer `edit`, el formato del `phone_number` de los contactos (se normaliza a dígitos), y si `chunk_order` es único dentro de una fase.

## 2. Diseño

```
Navegador (admin, /ajustes)                 Servidor                                   Inngest / webhook
──────────────────────────                  ────────                                   ─────────────────
SDK FB (solo en /ajustes, CSP propia)
FB.login(config_id, featureType) ──popup──► Meta
  callback: code ─┐
  postMessage: waba_id ─┤ (origen https://*.facebook.com, exacto)
                  └──► conectarWhatsAppAction (Server Action, Zod primero, admin)
                         1. resuelve la clave de cifrado (antes de gastar el código)
                         2. canjea el código → token de negocio
                         3. GET /{waba}/phone_numbers con ese token: el número es de esa WABA
                         4. POST /{waba}/subscribed_apps
                         5. RPC whatsapp_numero_conectar (security definer, exige admin)
                            guarda el token cifrado (AES-256-GCM, AAD = phone_number_id)
                         6. emite whatsapp/numero.conectado ───────────────────────► sincronizar-coexistencia
                                                                                     verifica is_on_biz_app
                                                                                     pide contactos, luego historial
                                                                                     (reserva en la base, 1 vez, < 24 h)
Meta ── webhook firmado ──► /api/webhooks/meta (HMAC primero)
                             history            → meta/coexistencia.historial(-error) → importa al hilo
                             smb_app_state_sync → meta/coexistencia.contactos         → leads
                             smb_message_echoes → meta/coexistencia.eco               → saliente humano
                             messages (como siempre) + anota el phone_number_id en la conversación
```

Decisiones:

- **Server Action y no ruta**: Next compara `Origin` con el host en cada Server Action (CSRF); el código y el token no pasan nunca por el navegador después del popup.
- **Cifrado en la app (AES-256-GCM) y no Vault/pgsodium**: la clave vive en el entorno, separada de los datos (un dump de la base no alcanza para mandar como el negocio), y lo que se prueba en unit es lo que corre en producción. El `phone_number_id` va como dato asociado: un cifrado no sirve en otra fila. Formato `v1.<kid>.<iv>.<tag>.<cifrado>`; `kid` permite rotar con `META_TOKENS_CLAVE_ANTERIOR`. Tag fijo de 16 bytes (sin eso Node acepta un tag recortado; lo marcó semgrep y hay test).
- **Token en tabla aparte** (`whatsapp_numeros_credenciales`): sin grant para `authenticated`/`anon`; la RLS no filtra columnas, así que una columna al lado habría salido en cualquier `select *` del admin.
- **Por qué número sale cada mensaje**: `conversaciones.whatsapp_phone_number_id` se anota con el `metadata.phone_number_id` del entrante. Texto, plantilla, ricos y «escribiendo…» salen por ese número con su token si está conectado; si no, por el de env (`META_WHATSAPP_PHONE_NUMBER_ID`), como hoy. Un número conectado cuyo token no se puede descifrar **falla** en vez de caer al de env (saldría desde otro WhatsApp). Un trigger impide que el panel cambie esa columna.
- **Nada de coexistencia pasa por el agente**: historial y ecos se escriben directo en el hilo (`sender` `lead` o `humano`, `metadata.origen` `historial_app_business` / `eco_app_business`), idempotentes por wamid, con su hora real.
- **Contactos**: crean el lead si no existe; a uno existente sólo le llenan el nombre vacío (nunca pisan uno editado). `remove` se ignora: no se borra un lead.
- **Sin `lead/created`** para los leads que nacen de contactos o del historial: ese evento dispara los flujos «Lead creado» (bienvenidas) y mandaría mensajes a contactos viejos.

## 3. Lo que el dueño tiene que configurar

En Vercel (Production) y en `.env.local`:

| Variable                         | Qué es                                                                                                      | Secreta                        |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `META_APP_ID`                    | Id de la app de Meta                                                                                        | No (va al SDK en el navegador) |
| `META_EMBEDDED_SIGNUP_CONFIG_ID` | Id de la configuración de Facebook Login for Business (v4, con WhatsApp y el onboarding de la app Business) | No                             |
| `META_TOKENS_CLAVE`              | `openssl rand -base64 32`. Cifra los tokens. Rota cada 90 días (`docs/runbooks/secrets-rotation.md`)        | **Sí**                         |
| `META_TOKENS_CLAVE_ANTERIOR`     | Sólo durante una rotación: la clave anterior, para descifrar                                                | **Sí**                         |

`META_APP_SECRET` ya existe (firma de webhooks) y se usa también para el canje del código.

En Meta (App Dashboard):

1. Que la app esté aprobada como **Tech Provider** (requisito de [A]).
2. **Facebook Login for Business › Configurations**: crear una de Embedded Signup con los productos de WhatsApp; copiar el id a `META_EMBEDDED_SIGNUP_CONFIG_ID`.
3. **Facebook Login for Business › Settings › Client OAuth settings**: en Sí Client OAuth login, Web OAuth login, Enforce HTTPS, Embedded Browser OAuth Login, Strict Mode y Login with the JavaScript SDK; agregar `crm-wine-one-38.vercel.app` (o el dominio final) a **Allowed domains** y **Valid OAuth redirect URIs** ([B]: sin eso el popup no devuelve datos).
4. **WhatsApp › Configuration › Webhooks**: suscribir `history`, `smb_app_state_sync` y `smb_message_echoes` además de `messages` y `account_update`.
5. Aplicar la migración `20261011120000_whatsapp_numeros.sql` en crm-dev/producción (no se aplicó: sólo en el stack local).

## 4. Cómo probarlo sin Meta

```bash
# unit + E2E (levanta el mock en un puerto libre, sin Supabase)
npx vitest run tests/unit/meta tests/unit/ajustes/vista-conectados.test.ts tests/e2e/conectar-whatsapp.mock-meta.test.ts

# RLS y token contra el stack local (vacía 17 tablas y re-siembra al terminar)
node scripts/con-stack-local.mjs --perfil test --resembrar -- \
  npx vitest run -c vitest.integration.config.ts tests/integration/whatsapp-numeros.supabase.test.ts
```

A mano contra el stack completo (`docs/runbooks/como-correr-el-crm.md` §4.1), con el mock corriendo:

```bash
curl -s -X POST http://127.0.0.1:55390/__mock/coex/contactos -H 'content-type: application/json' \
  -d '{"contactos":[{"telefono":"12025550190","nombre":"Rita Agenda"}]}'
curl -s -X POST http://127.0.0.1:55390/__mock/coex/historial -H 'content-type: application/json' \
  -d '{"hilos":[{"telefono":"12025550190","mensajes":[{"de":"cliente","texto":"Hola"},{"de":"negocio","texto":"Buen día"}]}],"progreso":100}'
curl -s -X POST http://127.0.0.1:55390/__mock/coex/eco -H 'content-type: application/json' \
  -d '{"to":"12025550190","texto":"Mandado desde el teléfono"}'
curl -s -X POST http://127.0.0.1:55390/__mock/coex/historial-rechazado
curl -s -X POST http://127.0.0.1:55390/__mock/coex/entrante -H 'content-type: application/json' \
  -d '{"from":"12025550190","texto":"Busco pastillas"}'
```

El canje del mock (`GET /v26.0/oauth/access_token`) exige `client_secret = META_APP_SECRET` y acepta cada código una sola vez; el popup de Facebook no tiene mock, así que el botón no se puede completar en local (se probó el servicio de punta a punta en el E2E).

## 5. Pendiente y riesgos conocidos

- **Contra Meta real, nada probado.** En particular: `extras` en v4 (§1, contradicción), la forma de la respuesta del canje y la CSP del SDK (`next.config.ts`, sólo `/ajustes`: `connect.facebook.net` en `script-src`; `www`, `web` y `staticxx.facebook.com` en `frame-src`). En local el SDK cargó con esa CSP (`window.FB` presente, sin violaciones en la consola); el popup no se abrió.
- **El historial importado vive en una sesión cerrada por lead** (decisión del dueño, 2026-10-11): no aparece en el Inbox, sí en la ficha del lead. Como `mensajes` exige sesión y el esquema sólo admite `resultado` `exito` o `perdido`, se cierra como `perdido` sin motivo, con `extras.importado_historial = true` y las fechas reales (`started_at` = primer mensaje del primer lote, `closed_at` = el último; los lotes siguientes reusan la sesión y no mueven `closed_at`). Esa marca saca a estas sesiones de la **purga de 29 días** y de la **reactivación predictiva**. **No** las saca de: Métricas (cuenta sesiones `perdido` y mensajes por fecha), el filtro "Perdidos" y la etapa/resultado que muestra la lista de Leads. Si el cliente vuelve a escribir, el pipeline abre una sesión activa nueva.
- **Retención del historial importado: decisión pendiente del dueño.** La purga (`purge-old-sessions`, 04:00) borra con CASCADE toda sesión cerrada hace más de 29 días, y el historial trae hasta 180 días. Sin la excepción, se perdía la misma noche de la importación. La excepción hace que ese historial **no se borre nunca** mientras no se decida (contradice `docs/data-retention.md` si ahí manda 29 días para todo).
- **Si el negocio contesta desde el teléfono, la IA se pausa 2 horas** (decisión del dueño, 2026-10-11): `on-coexistencia-eco` registra el eco, pausa la sesión activa del cliente por el mecanismo de handoff (`reason_code` `respuesta_desde_telefono`, `source` `sistema`, sin avisar al cliente) y emite `meta/coexistencia.reanudar-ia`; esa función duerme hasta el vencimiento (`PAUSA_POR_RESPUESTA_HUMANA_MIN`, constante en `src/lib/coexistencia/pausa.ts`, no editable desde la UI) y reanuda (`reanudacion_automatica`) sólo si la última transición sigue siendo esa pausa y ningún eco posterior extendió la ventana. "Reactivar IA" en el Inbox reanuda al instante y el vencimiento ya no hace nada. Los entrantes durante la pausa se guardan y se ven, pero el agente no contesta. Una sesión pausada por otra causa (pausa manual, descuento excedido) no la adopta ni la levanta este mecanismo. Un eco que llega con más de 2 horas de atraso no pausa. Requiere aplicar `20261011150000_handoff_respuesta_telefono.sql` (amplía los CHECK de `handoff_events`; sin ella el `insert` falla).
- **Teléfonos de AR/MX**: el lead se busca por teléfono exacto (dígitos). Si el `threads[].id` o el `phone_number` del contacto no coincide con el `wa_id` normalizado que guardó el pipeline (el 9 de AR, el 1 de MX), aparece un lead duplicado; el detector de duplicados lo propone en su corrida global.
- **Desconexión**: no hay botón «Quitar». Cuando el negocio desconecta desde la app, Meta manda `account_update` `PARTNER_REMOVED`; hoy queda en `meta_operational_events` y el número sigue `conectado` (los envíos van a fallar con error de Meta, visibles en el hilo).
- **Difusión y plantillas sin sesión** siguen saliendo por el número de env (no tienen conversación de la cual sacar el número).
- **Número nuevo (`FINISH`, no coexistencia)**: se guarda en modo `cloud` pero el registro con PIN (`/register`) no está implementado.
- **Envío desde el Inbox**: el resolver de tokens usa service role del lado del panel (`whatsapp-credenciales-bootstrap.ts`), acotado a una operación (`para(phoneNumberId)`), con el id de una conversación que la RLS ya dejó leer y el token sólo hacia la Graph API.
