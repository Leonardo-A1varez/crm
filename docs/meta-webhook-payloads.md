# Meta webhooks y contratos de mensajes

> Última reconciliación: **2026-08-13**. Describe lo que el CRM procesa hoy y lo que Meta puede enviar según fuentes oficiales. No es una promesa de soporte futuro.

## Endpoint actual

`GET|POST /api/webhooks/meta`

### Orden de seguridad del POST

1. Leer body crudo.
2. Verificar `X-Hub-Signature-256` con app secret.
3. Rechazar `401` antes de parsear o tocar dependencias.
4. Rate limit del origen autenticado.
5. Parsear JSON.
6. Normalizar mensajes/status conocidos.
7. Emitir eventos Inngest.
8. Responder rápido.

El contrato actual cumple HMAC-first. La documentación oficial de Messenger pide responder `200` en cinco segundos o menos; toda descarga de media, búsqueda de perfil o lógica de negocio debe ocurrir fuera del request.

## Objetos de entrada

| `object`                    | Canal     | Estado local                                                   |
| --------------------------- | --------- | -------------------------------------------------------------- |
| `whatsapp_business_account` | WhatsApp  | Mensajes + status conocidos                                    |
| `instagram`                 | Instagram | Solo `entry[].messaging[].message` con `mid`; se reduce a text |
| `page`                      | Messenger | Solo `entry[].messaging[].message` con `mid`; se reduce a text |

Objetos/eventos desconocidos producen cero mensajes y se confirman con `200`; no deben reintentarse indefinidamente. Antes de ampliar subscriptions se deben agregar fixtures y observabilidad de eventos ignorados sin guardar PII.

## Contrato normalizado actual

```ts
interface ParsedMessage {
  canal: "wa" | "ig" | "fb";
  canal_thread_id: string;
  meta_user_id: string;
  meta_message_id: string;
  tipo: "text" | "image" | "audio" | "video" | "doc" | "location" | "template";
  contenido: string | null;
  media_url: string | null;
  nombre_perfil: string | null;
  platform_created_at?: Date | null;
  raw: Record<string, unknown>;
}
```

Problema: `raw` permite inspección inmediata, pero el modelo canónico no representa reply, reaction, interactive, postback, referral, comment, policy o account event. No se debe expandir con flags opcionales; el próximo contrato debe ser una unión discriminada.

## WhatsApp actual

### Mensajes reconocidos

| Meta `messages[].type` | Tipo local | Contenido persistido | Media funcional         |
| ---------------------- | ---------- | -------------------- | ----------------------- |
| `text`                 | `text`     | `text.body`          | n/a                     |
| `image`                | `image`    | caption              | No                      |
| `audio`                | `audio`    | `null`               | No                      |
| `video`                | `video`    | caption              | No                      |
| `document`             | `doc`      | caption              | No                      |
| `location`             | `location` | `null`               | No hay lat/lng canónico |

Se cruza `contacts[].wa_id` con `messages[].from` para obtener `profile.name`. El timestamp Meta viene en segundos Unix; inválido o ausente queda `null` para métricas de entrada.

### Tipos que Meta soporta y hoy se ignoran

- sticker;
- contacts;
- reaction;
- interactive/button/list replies;
- order y otros objetos comerciales —catálogo queda fuera de alcance—;
- system/identity/unsupported;
- reply context (`context.id`, etc.).

Ignorarlos silenciosamente causa pérdida de intención. Antes de suscribir/usar cada tipo se crea un fixture y se define si genera mensaje, interacción o evento operativo.

### Media

Los webhooks entregan IDs/metadata, no una URL privada permanente lista para UI. Pipeline futuro:

1. Evento durable con media ID y canal.
2. Obtener URL/metadata autorizada desde Meta.
3. Descargar con límites de bytes/tiempo.
4. Verificar MIME real, extensión, hash y malware cuando aplique.
5. Guardar en Supabase Storage privado.
6. Persistir referencia interna y metadata mínima.
7. Servir con signed URL corta.

No loggear nombre de archivo, caption, teléfono ni URL firmada.

### Estados de entrega

`parseMetaStatuses` acepta:

| Meta        | Local       |
| ----------- | ----------- |
| `sent`      | `enviado`   |
| `delivered` | `entregado` |
| `read`      | `leido`     |
| `failed`    | `fallido`   |

El timestamp se toma del evento. En el código actual, si el timestamp de status es inválido se usa la hora de recepción para no dejar el estado detenido; esta excepción no debe reutilizarse para métricas de primera respuesta.

### Eventos operativos no procesados

La documentación oficial expone, entre otros:

- `phone_number_name_update`;
- `phone_number_quality_update`;
- `account_update`;
- `account_review_update`;
- `message_template_status_update`.

Estos eventos deben ir a un contrato `MetaOperationalEvent`, no fingirse como mensajes de conversación.

## Instagram actual

El parser actual exige:

- `entry[].messaging[].sender.id`;
- `message.mid`;
- `message.text` opcional.

Todo se persiste con `tipo: "text"`, `media_url: null` y `nombre_perfil: null`.

### Información oficial que hoy se pierde

- attachment: audio, file, image, video, share, reel/story context y story mention;
- quick reply payload;
- postback/ice breaker/persistent menu;
- reactions y deleted/echo/unsupported;
- `reply_to`;
- `messaging_referral`, incluidos ads/links;
- read/seen;
- comments, Live comments, mentions;
- private-reply origin;
- handover/standby.

La Conversations API puede servir para reconciliar conversaciones y mensajes, pero no reemplaza webhooks. Requests inactivas durante 30 días pueden no aparecer según la documentación actual.

## Messenger actual

Usa el mismo parser estrecho de Instagram: sender + message.mid + text.

### Información oficial que hoy se pierde

- attachments/media;
- delivery/read/echo/edit/reaction;
- postbacks, Get Started y menu;
- referrals desde `m.me` o ads;
- Handover Protocol/standby;
- policy enforcement;
- utility template status;
- feedback y cart/order events.

Los receipts de Messenger/Instagram pueden ser marcas de agua del hilo sin message ID. El código actual no los asigna a una fila para evitar inventar correspondencia. La solución futura debe guardar un cursor/read watermark por conversación o definir una reconciliación explícita.

## Salida actual

`GraphApiMetaClient.sendText` soporta:

- WA: `POST /{phone-number-id}/messages`, `type=text`, sin preview URL.
- IG/FB: `POST /{page-or-account-id}/messages`, `recipient.id` + `message.text`.

No soporta media, reply, reaction, interactive, template general, read ni typing. IG/FB fallan rápido si faltan sus variables opcionales.

El mapping de errores es hoy por HTTP:

- `429` → `RateLimitError`;
- `400`, `401`, `403` → `ValidationError`;
- red, `5xx` y otros → `InfraError`.

Esto es insuficiente para policy/window/template/permission: varios errores `400` necesitan códigos de dominio distintos y decisiones de retry/UX diferentes. No hardcodear una lista vieja de códigos sin fixtures de la versión soportada.

## Contrato futuro recomendado

```ts
type MetaInboundEvent =
  | MetaMessageEvent
  | MetaMessageStatusEvent
  | MetaReactionEvent
  | MetaPostbackEvent
  | MetaReferralEvent
  | MetaCommentEvent
  | MetaPolicyEvent
  | MetaAccountEvent
  | MetaTemplateStatusEvent;

type MetaOutboundCommand =
  | SendText
  | SendMedia
  | SendReply
  | SendReaction
  | SendInteractive
  | SendTemplate
  | MarkRead
  | SetTyping;
```

Invariantes:

- `eventId`/idempotency key explícito por evento.
- `platformCreatedAt` nullable; nunca sustituir con recepción para analytics.
- `raw` con retención corta y acceso restringido, o hash/referencia cuando sea suficiente.
- referral/touchpoint append-only y separado del estado mutable del lead.
- evento desconocido observable con tipo/hash, sin body ni PII en logs.
- salida reservada en DB antes de llamar a Meta.
- policy engine decide elegibilidad antes del adapter del canal.

## Fixtures mínimos antes de ampliar soporte

### WhatsApp

- text, media por cada tipo, reply context, reaction, interactive reply, location, contacts y unknown;
- sent/delivered/read/failed, error permanente y timestamp inválido;
- quality/name/account/template status;
- replay exacto y batch con múltiples messages/statuses.

### Instagram

- text, cada attachment, quick reply, reaction, delete, echo, reply, story/reel/share;
- comment → private reply, ad referral, seen, postback e ice breaker;
- payload sin `mid` que no debe convertirse en mensaje vacío.

### Messenger

- text/media, delivery/read watermark, echo/edit/reaction;
- postback/referral, handover/standby, policy enforcement y unknown.

## Checklist de revisión de webhook

- Firma HMAC antes de parse.
- ACK ≤ 5 s.
- Idempotencia por event/message ID.
- Orden por timestamp de plataforma sin asumir entrega ordenada.
- Batch parcial: un evento inválido no descarta otros válidos.
- No PII en logs/errors/traces.
- No descargas remotas dentro del request.
- Tipo desconocido visible en métricas, no en logs crudos.
- Fixtures tomados de documentación oficial de la versión soportada.
- Subscription y permiso anotados en el capability registry.

## Fuentes

- [WhatsApp Messages](https://www.postman.com/meta/whatsapp-business-platform/folder/o48mro7/messages)
- [WhatsApp operational webhooks](https://www.postman.com/meta/whatsapp-business-platform/request/j09tht8/components)
- [Instagram API](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api)
- [Instagram Conversations API](https://www.postman.com/meta/instagram/folder/23987686-6a91368f-1fa8-4614-9ed6-7d1e08c21e62)
- [Messenger Webhooks](https://www.postman.com/meta/messenger-platform-api/folder/22794852-b5d97624-14d8-4e67-a2e4-529add49ca58)

---

## Eventos operativos — RESUELTO 2026-08-25

La sección "Eventos operativos no procesados" de arriba describía el problema. Esto es lo que se hizo.

### Qué se construyó

`parseMetaOperationalEvents()` en `src/lib/meta/parse-webhook.ts` captura **cualquier** `change.field` que no sea `messages` y lo persiste en la tabla `meta_operational_events` vía el evento de Inngest `meta/operational.received`.

Antes el parser hacía `if (change.field !== "messages") continue` y los descartaba en silencio. No rompía nada —el webhook devolvía 200— pero si Meta rechazaba una plantilla nadie se enteraba hasta que fallaba un envío.

**Por qué tabla y no sólo log:** los logs de Vercel rotan en minutos. Se comprobó el 2026-08-25 depurando el deploy: los logs del webhook desaparecieron antes de poder leerlos. Un evento que avisa "te rechazaron una plantilla" no sirve si dura menos que el tiempo en que alguien lo mira.

**Por qué captura campos desconocidos:** un allowlist de campos conocidos se queda viejo en silencio, que es exactamente el problema que este código viene a resolver. Si Meta inventa un campo mañana, se persiste igual y el crudo queda para inspeccionarlo.

### Suscripción actual — exactamente 3 campos

Se desuscribieron 7 campos que estaban activos y cuyo tráfico se descartaba: `account_alerts`, `account_review_update`, `account_update`, `calls`, `security`, `message_template_quality_update`, `phone_number_name_update`.

Quedan suscritos sólo los que el código maneja:

| Campo                            | Para qué                                               |
| -------------------------------- | ------------------------------------------------------ |
| `messages`                       | Mensajes entrantes y estados de entrega                |
| `message_template_status_update` | Plantilla aprobada, rechazada, pausada o deshabilitada |
| `phone_number_quality_update`    | Cambios de límite de mensajería del número             |

Volver a suscribir alguno se hace con `devtools_webhook_manage` del MCP oficial de Meta (requiere scope `manage`).

### Formas verificadas contra la doc oficial

Obtenidas con `devtools_discovery` el 2026-08-25, de la referencia actualizada el 2025-11-14. **No inventadas** — los tests de `tests/unit/meta-parse-operational.test.ts` usan estos payloads verbatim.

`message_template_status_update` → `value`:

```
event                      APPROVED | REJECTED | DISABLED | PAUSED | FLAGGED |
                           ARCHIVED | DELETED | IN_APPEAL | LIMIT_EXCEEDED |
                           LOCKED | PENDING | REINSTATED | PENDING_DELETION
message_template_id        entero
message_template_name      string
message_template_language  string
reason                     ABUSIVE_CONTENT | INCORRECT_CATEGORY | INVALID_FORMAT |
                           NONE | PROMOTIONAL | SCAM | TAG_CONTENT_MISMATCH | null
message_template_category  string
disable_info               sólo si la plantilla fue deshabilitada
other_info                 sólo si fue bloqueada o desbloqueada
rejection_info             sólo si el rechazo fue INVALID_FORMAT
```

`phone_number_quality_update` → `value`:

```
display_phone_number                  string
event                                 ONBOARDING | THROUGHPUT_UPGRADE
old_limit                             DEPRECADO (ver abajo)
current_limit                         DEPRECADO (ver abajo)
max_daily_conversations_per_business  TIER_50 | TIER_250 | TIER_2K | TIER_10K |
                                      TIER_100K | TIER_NOT_SET | TIER_UNLIMITED
```

### Dos trampas encontradas en la doc de Meta

**1. `current_limit` y `old_limit` ya deberían no existir.** La doc dice textual _"This field will be removed in February, 2026"_ y sin embargo su propio ejemplo los sigue mostrando. Estamos en agosto de 2026: la doc quedó atrasada respecto de su propio aviso. Un parser que dependa de esos campos puede recibir `undefined` hoy. Por eso el parser guarda el `value` crudo y no depende de campos puntuales.

**2. `rejection_info` aparece en dos lugares distintos.** La sección _Syntax_ lo muestra como hermano de `value`; el _Example_ lo muestra adentro de `value`. La doc se contradice sola. Como el parser conserva el `value` entero, el dato sobrevive en el caso del ejemplo, que es el que se observó en la práctica.

### Corrección de un error previo de este documento

En una sesión anterior se dijo que `phone_number_quality_update` avisa cuando **baja la calidad o reputación** del número. **Es falso.** La doc oficial dice que notifica _"changes to a business phone number's throughput level"_ — cambios de **límite de mensajería**, y sus únicos eventos son `ONBOARDING` y `THROUGHPUT_UPGRADE`. Lo de la reputación vive en `account_alerts` y `message_template_quality_update`, dos campos que hoy están **desuscritos**.
