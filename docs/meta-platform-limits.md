# Meta Platform — ventanas, pricing, permisos y límites

> Última verificación: **2026-08-13**. Este documento es operativo; el inventario de producto está en [`research/meta-api-capabilities-2026-08.md`](./research/meta-api-capabilities-2026-08.md) y cada afirmación tiene fuente en el [ledger](./research/meta-api-source-ledger-2026-08.md).
>
> Los valores cambian por versión, mercado, cuenta y rollout. Antes de producción se confirma el contrato oficial y la disponibilidad del activo concreto.

## Estado local

| Canal     | Activo configurado/verificado | Entrada actual                                                     | Salida actual                                       |
| --------- | ----------------------------- | ------------------------------------------------------------------ | --------------------------------------------------- |
| WhatsApp  | Sí; sandbox real probado      | text, image, audio, video, document, location; media no descargada | Solo text; un template de smoke se probó por script |
| Instagram | No                            | Solo eventos con `message.mid`; se persiste como text              | `sendText` existe, pero faltan activos/credenciales |
| Messenger | No                            | Solo eventos con `message.mid`; se persiste como text              | `sendText` existe, pero faltan activos/credenciales |

La configuración cae en `META_GRAPH_API_VERSION=v21.0`. El 2026-08-13 una lectura segura del phone number aceptó un request `v25.0` y respondió con header `facebook-api-version: v26.0`. Esto prueba esa lectura y ese activo; **no prueba compatibilidad de mensajes, webhooks ni management endpoints**. No cambiar el pin sin contract tests.

## WhatsApp Business Platform

### Pricing vigente

Meta cobra por **cada mensaje entregado**, según:

- mercado del destinatario;
- categoría: `marketing`, `utility`, `authentication` o `service`;
- volumen, cuando aplica un tier de volumen.

Reglas verificadas en [pricing oficial](https://whatsappbusiness.com/products/platform-pricing/):

- Se cobra cuando el mensaje se entrega, no al intentar enviarlo.
- Los mensajes `service` enviados dentro de la customer service window no tienen cargo.
- Meta declara gratuitas las respuestas `utility` a usuarios en las condiciones publicadas.
- Un mensaje del cliente desde Click-to-WhatsApp o CTA de una Facebook Page abre **72 horas** durante las cuales Meta declara gratuitos todos los mensajes.
- Las tarifas exactas se consultan en la rate card por mercado/categoría. No hardcodearlas en el CRM ni en este documento.

El modelo anterior de “conversation-based pricing”, las “1.000 conversaciones gratis/mes” y el término HSM fueron retirados de esta documentación porque no describen el contrato vigente.

### Ventana de servicio

- Un mensaje del usuario abre o reinicia una ventana de **24 horas**.
- Dentro de ella se pueden enviar mensajes de servicio libres conforme a la política.
- Fuera de ella, el envío iniciado por negocio requiere un **message template aprobado** y elegible.
- La categoría final y el precio los determina Meta. El nombre local de un template no garantiza su categoría.

El servicio debe decidir antes de enviar:

1. canal y activo;
2. timestamp válido del último entrante;
3. origen de entrada gratuita, si existe;
4. ventana aplicable;
5. tipo permitido: free-form, interactive o template;
6. consentimiento/opt-out;
7. estado de calidad/policy/template.

### Mensajes y media

La colección oficial incluye:

- text, preview URLs y replies;
- image, audio, video, document y sticker por ID o URL;
- reactions;
- templates e interactivos;
- read receipt y typing indicator;
- status webhooks por message ID.

Las URLs/handles de media de Meta pueden ser efímeros. El diseño correcto es descargar con autorización, validar y mover a Supabase Storage privado. Nunca exponer el token en una URL ni almacenar una URL temporal como fuente permanente.

### Flows

WhatsApp Flows permite crear, administrar, publicar y enviar interacciones estructuradas. La colección oficial incluye categorías como:

- `LEAD_GENERATION`;
- `CONTACT_US`;
- `CUSTOMER_SUPPORT`;
- `SURVEY`;
- `APPOINTMENT_BOOKING`.

Un Flow puede capturar datos de solicitud sin catálogo. Debe versionarse, validarse server-side y tratar toda respuesta como input no confiable. Dispositivos/versiones no compatibles pueden no recibir el Flow; se necesita fallback.

### Calidad y operación

Meta documenta webhooks para:

- `phone_number_name_update`;
- `phone_number_quality_update`;
- `account_update`;
- `account_review_update`;
- `message_template_status_update`.

Los estados incluyen upgrades/downgrades/flagging de calidad, cambios de cuenta y aprobación/rechazo/flagging/disable de templates. La integración debe alertar; no esperar a que los envíos fallen.

Analytics de WABA permite consultar al menos enviados/entregados por rango, granularidad, teléfono y país. Debe reconciliarse con métricas propias, no reemplazarlas.

### Activos y permisos

Mínimo para messaging:

- Meta Business Portfolio;
- WABA;
- business phone number / phone number ID;
- app Meta;
- token con `whatsapp_business_messaging`.

Management y onboarding pueden requerir:

- `whatsapp_business_management`;
- `business_management`;
- system user/token;
- App Review y Advanced Access para activos de terceros/Embedded Signup.

Separar tokens de messaging, management y marketing.

### Capacidad y rate limiting

No se fija aquí un throughput universal. Meta expone calidad, throughput/capacidad y headers de uso que dependen de activo y producto. El cliente debe:

- aplicar backoff con jitter a `429` y fallos transitorios;
- registrar request/trace IDs sin PII;
- observar headers de uso;
- limitar concurrencia por activo;
- no reintentar errores permanentes de auth/policy/schema;
- preservar la reserva idempotente antes de llamar a Meta.

### Capacidades restringidas

| Capacidad                  | Estado de planificación                                                     |
| -------------------------- | --------------------------------------------------------------------------- |
| Calling/voice/video        | Rollout por cuenta/región/partner. Verificar antes de diseñar.              |
| Payments                   | Las colecciones oficiales visibles son SG/IN. Fuera del scope Latam actual. |
| Groups                     | No se verificó una Cloud API general productiva. No prometer.               |
| Coexistence App + Platform | Anunciada/extendida en mercados concretos; validar por país/activo.         |

## Instagram

### Modelos de acceso

**Instagram Login:**

- no necesita Facebook Page vinculada;
- scopes actuales: `instagram_business_basic`, `instagram_business_manage_messages`, `instagram_business_manage_comments`, `instagram_business_content_publish`;
- no accede a ads ni tagging.

**Facebook Login:**

- requiere cuenta profesional vinculada a Page;
- usa permisos Instagram clásicos y permisos de Pages;
- es necesario para algunas superficies conectadas con Pages/ads.

Advanced Access aplica cuando la app sirve cuentas profesionales ajenas.

### Inicio y ventanas

- La conversación normal empieza cuando la persona escribe a la cuenta profesional.
- Quick replies, ice breakers, postbacks y referrals tienen eventos propios.
- Private Replies permite un primer mensaje privado por comentario dentro de siete días; en Live solo durante la emisión. Los seguimientos dependen de respuesta del usuario y reglas posteriores.
- `HUMAN_AGENT` y otras excepciones no son una licencia para marketing. Deben validarse por caso y versión.

### Capacidades relevantes

- text, photo/GIF, audio, video, sticker y assets;
- reactions/unreactions, replies, deletes y echoes;
- quick replies: hasta 13; títulos textuales de hasta 20 caracteres según la documentación consultada;
- hasta cuatro ice breakers;
- persistent menu y welcome message flows;
- comments, Live comments y private replies;
- story/reel/share/mention/ad referral context;
- Conversations API;
- publicación de posts/reels/stories con restricciones;
- account/media insights.

Limitaciones de insights cambian por métrica. Ejemplos oficiales: algunas métricas no están disponibles con menos de 100 seguidores; ciertos datos de usuario se conservan hasta 90 días; un dataset vacío no equivale a cero.

## Messenger y Facebook Pages

Messenger Platform ofrece:

- text/media, templates, buttons y quick replies;
- `mark_seen`, `typing_on` y `typing_off`;
- delivery/read/echo/edit/reaction webhooks;
- postbacks, referrals, Get Started y persistent menu;
- Handover Protocol y `standby`;
- policy enforcement y template status.

El webhook de Messenger debe responder `200` en **cinco segundos o menos** según la documentación oficial consultada. El trabajo pesado debe salir a Inngest/outbox.

Las Utility Messages aparecen con disponibilidad regional limitada en la documentación actual; no son una estrategia de reapertura para Latam hasta verificar país/cuenta.

## Marketing API

Superficies verificadas:

- CRUD de campaigns, ad sets, ads y creatives;
- Ads Insights: spend, reach, clicks, actions y valores, según campos/permisos;
- Custom/Lookalike Audiences;
- Offline Conversions/custom conversions;
- relaciones con cuentas Instagram y Business assets.

Requisitos representativos:

- ad account y Business Portfolio;
- app Meta;
- user o system user token;
- `ads_read` para lectura o `ads_management` para mutaciones, además de permisos específicos;
- App Review/Advanced Access según uso y activos.

Política de producto: primero atribución read-only; después conversiones; CRUD de campañas al final y con RBAC, approval, audit log y límites de gasto. Nunca permitir que el agente conversacional cambie presupuesto/audiencia directamente.

## Seguridad y compliance

- Webhook: HMAC sobre raw body antes de JSON parse.
- ACK rápido; procesamiento idempotente y durable.
- PII redaction en logs y traces.
- Tokens en secretos, mínimo privilegio y rotación.
- Consentimiento y opt-out por canal y finalidad.
- Audiencias/conversiones requieren base legal separada del servicio conversacional.
- Retención limitada del raw payload y media privada.
- Alertas por token, permisos, calidad, policy y templates.
- Derechos de acceso/borrado/exportación según regulación Latam aplicable.

## Checklist antes de activar un canal o capability

1. Fuente oficial y versión verificadas en el ledger.
2. Activo, país y disponibilidad confirmados.
3. Permisos mínimos y App Review identificados.
4. Policy/window engine con motivo de rechazo visible.
5. Fixtures/webhook contracts y replay tests.
6. Idempotencia de entrada y salida.
7. PII/media/retención aprobadas.
8. Rate limit, retry y circuit breaker definidos.
9. Health/alerts/runbook disponibles.
10. Smoke controlado autorizado por el dueño; nunca mensajes reales implícitos.

## Fuentes rápidas

- [Meta Official API Network](https://www.postman.com/meta/)
- [WhatsApp Business Platform](https://www.postman.com/meta/whatsapp-business-platform/overview)
- [WhatsApp pricing](https://whatsappbusiness.com/products/platform-pricing/)
- [Instagram API](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api)
- [Messenger Platform](https://www.postman.com/meta/messenger-platform-api/documentation/iyp204x/messenger-platform-api)
- [Facebook Marketing API](https://www.postman.com/meta/facebook-marketing-api/overview)
