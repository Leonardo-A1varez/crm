# Meta webhook payloads + outbound shapes

Referencia compacta para Slice 1 7.6 (client) + 7.9 (webhook route). Golden samples reales para tests + integration smoke. Fuente: Graph API docs `v21.0+`.

> **Scope:** WhatsApp Business Cloud API + Instagram Messenger + Facebook Messenger. Text-only por ahora. Templates + media son backlog v2.

---

## 1. Inbound webhook payloads

Webhook único `/api/webhooks/meta` recibe los 3 canales. Distinguir vía `payload.object`:

| `object`                    | Canal        |
| --------------------------- | ------------ |
| `whatsapp_business_account` | WA           |
| `instagram`                 | IG           |
| `page`                      | FB Messenger |

Parser canónico: `src/lib/meta/parse-webhook.ts` → `ParsedMessage[]`.

### 1.1 WA inbound text

```json
{
  "object": "whatsapp_business_account",
  "entry": [
    {
      "id": "<WHATSAPP_BUSINESS_ACCOUNT_ID>",
      "changes": [
        {
          "field": "messages",
          "value": {
            "messaging_product": "whatsapp",
            "metadata": {
              "display_phone_number": "+15551234567",
              "phone_number_id": "<PHONE_NUMBER_ID>"
            },
            "contacts": [{ "profile": { "name": "Juan Perez" }, "wa_id": "5491155550000" }],
            "messages": [
              {
                "from": "5491155550000",
                "id": "wamid.HBgN...",
                "timestamp": "1700000000",
                "type": "text",
                "text": { "body": "Hola, tienen pastillas para Corolla 2015?" }
              }
            ]
          }
        }
      ]
    }
  ]
}
```

**Parsed:** `{ canal: "wa", canal_thread_id: "5491155550000", meta_user_id: "5491155550000", meta_message_id: "wamid.HBgN...", tipo: "text", contenido: "Hola...", media_url: null }`.

### 1.2 WA inbound image (con caption)

```json
{
  "object": "whatsapp_business_account",
  "entry": [
    {
      "id": "...",
      "changes": [
        {
          "field": "messages",
          "value": {
            "messages": [
              {
                "from": "5491155550000",
                "id": "wamid.HBgI...",
                "type": "image",
                "image": {
                  "id": "<MEDIA_ID>",
                  "mime_type": "image/jpeg",
                  "sha256": "...",
                  "caption": "Esta es la pieza que necesito"
                }
              }
            ]
          }
        }
      ]
    }
  ]
}
```

**Parsed:** `tipo: "image"`, `contenido: "Esta es la pieza..."` (caption), `media_url: null` (require segunda llamada Graph API `/{MEDIA_ID}` para resolver — diferido).

### 1.3 IG inbound text

```json
{
  "object": "instagram",
  "entry": [
    {
      "id": "<IG_BUSINESS_ACCOUNT_ID>",
      "time": 1700000000,
      "messaging": [
        {
          "sender": { "id": "<IG_USER_PSID>" },
          "recipient": { "id": "<IG_BUSINESS_ACCOUNT_ID>" },
          "timestamp": 1700000000,
          "message": {
            "mid": "mid.AAAA...",
            "text": "tienen filtro aceite Hilux"
          }
        }
      ]
    }
  ]
}
```

**Parsed:** `{ canal: "ig", canal_thread_id: "<IG_USER_PSID>", meta_user_id: "<IG_USER_PSID>", meta_message_id: "mid.AAAA...", tipo: "text", contenido: "tienen filtro aceite Hilux" }`.

### 1.4 FB Messenger inbound text

```json
{
  "object": "page",
  "entry": [
    {
      "id": "<FB_PAGE_ID>",
      "time": 1700000000,
      "messaging": [
        {
          "sender": { "id": "<FB_USER_PSID>" },
          "recipient": { "id": "<FB_PAGE_ID>" },
          "timestamp": 1700000000,
          "message": {
            "mid": "m_AAAA...",
            "text": "buenos dias, precio bujias"
          }
        }
      ]
    }
  ]
}
```

**Parsed:** `{ canal: "fb", canal_thread_id: "<FB_USER_PSID>", meta_user_id: "<FB_USER_PSID>", meta_message_id: "m_AAAA...", tipo: "text", contenido: "buenos dias, precio bujias" }`.

---

## 2. Webhook signature verify

Toda request entrante = HMAC SHA-256 con `META_APP_SECRET` sobre `rawBody`. Header `X-Hub-Signature-256: sha256=<hex>`.

Util: `src/lib/meta/verify-signature.ts` → `verifyMetaSignature(rawBody, header, appSecret) => boolean`. Timing-safe via `crypto.timingSafeEqual`. Reject 401 si false.

> **Webhook route (7.9):** consumir `rawBody` (no `req.json()`) antes de validar — `JSON.parse` cambia bytes y rompe HMAC.

---

## 3. Webhook GET verify challenge

Meta valida el endpoint vía GET handshake:

```
GET /api/webhooks/meta?hub.mode=subscribe&hub.verify_token=<token>&hub.challenge=<nonce>
```

Si `hub.mode === "subscribe"` && `hub.verify_token === env.META_VERIFY_TOKEN` → responder `200 <nonce>` plain text. Else `403`.

---

## 4. Outbound send shapes

Client: `src/server/services/meta/graph-api-client.ts` (`GraphApiMetaClient`).

### 4.1 WA send text

```http
POST https://graph.facebook.com/v21.0/<PHONE_NUMBER_ID>/messages
Authorization: Bearer <META_WHATSAPP_ACCESS_TOKEN>
Content-Type: application/json
```

```json
{
  "messaging_product": "whatsapp",
  "recipient_type": "individual",
  "to": "+5491155550000",
  "type": "text",
  "text": { "body": "Hola Juan, tenemos stock", "preview_url": false }
}
```

**Response 200:**

```json
{
  "messaging_product": "whatsapp",
  "contacts": [{ "input": "+5491155550000", "wa_id": "5491155550000" }],
  "messages": [{ "id": "wamid.HBg...", "message_status": "accepted" }]
}
```

Extract `meta_message_id = messages[0].id`.

### 4.2 IG send text (Messenger Platform)

```http
POST https://graph.facebook.com/v21.0/<IG_BUSINESS_ACCOUNT_ID>/messages
Authorization: Bearer <META_IG_ACCESS_TOKEN>
Content-Type: application/json
```

```json
{
  "recipient": { "id": "<IG_USER_PSID>" },
  "message": { "text": "Hola, tenemos esa pieza" }
}
```

**Response 200:**

```json
{
  "recipient_id": "<IG_USER_PSID>",
  "message_id": "mid.AAA..."
}
```

Extract `meta_message_id = message_id`.

> **24h messaging window:** IG/FB requieren que el lead haya escrito en las últimas 24h. Fuera de window → `400 code 10`. Workaround: tags `MESSAGE_TAG` (HUMAN_AGENT/etc) — NO implementado pilot.

### 4.3 FB Messenger send text

```http
POST https://graph.facebook.com/v21.0/<FB_PAGE_ID>/messages
Authorization: Bearer <META_FB_PAGE_ACCESS_TOKEN>
Content-Type: application/json
```

```json
{
  "recipient": { "id": "<FB_USER_PSID>" },
  "message": { "text": "Hola, precio bujías $X" }
}
```

**Response 200:** idem IG (`recipient_id`, `message_id`).

---

## 5. Error envelope Graph API

Todos los errores siguen este shape:

```json
{
  "error": {
    "message": "Recipient phone number not in allowed list",
    "type": "OAuthException",
    "code": 131030,
    "error_subcode": 131044,
    "fbtrace_id": "ABcd1234..."
  }
}
```

Mapping → DomainError en `GraphApiMetaClient.throwMappedGraphError`:

| Status    | DomainError       | conflictType        | Retryable                    |
| --------- | ----------------- | ------------------- | ---------------------------- |
| 429       | `ConflictError`   | `meta_rate_limited` | ✅ (Inngest retry)           |
| 401 / 403 | `ValidationError` | n/a                 | ❌ (token rota — humano)     |
| 400       | `ValidationError` | n/a                 | ❌ (caller bug o 24h window) |
| 5xx       | generic `Error`   | n/a                 | ✅ (Inngest retry)           |

`fbtrace_id` + `code` + `status` se preservan en `context` para debugging.

---

## 6. Codes comunes (referencia)

| Code   | Significado                             | Acción                     |
| ------ | --------------------------------------- | -------------------------- |
| 131030 | WA: número no en allowed list (sandbox) | Allowlist en App Dashboard |
| 131047 | WA: 24h window cerrada                  | Usar template aprobado     |
| 131051 | WA: tipo mensaje no soportado           | Revisar `type`             |
| 190    | Token expirado / invalid                | Refresh token              |
| 10     | IG/FB: outside 24h window               | MESSAGE_TAG o esperar lead |
| 4      | IG/FB: rate-limit aplicación            | Backoff + retry            |
| 80007  | WA: rate-limit business                 | Backoff + retry            |

---

## 7. Limits cross-platform

Detalle granular → `docs/meta-platform-limits.md`. Resumen:

| Canal | Rate limit                                                                  | Notas                    |
| ----- | --------------------------------------------------------------------------- | ------------------------ |
| WA    | 80 msg/sec por phone_number_id (tier MEDIUM); 1000 / 24h por user-initiated | Tier upgrade vía calidad |
| IG    | 200 calls/hour por user; 4800 / 24h por page                                | Webhook lag posible      |
| FB    | 200 calls/hour por user; 4800 / 24h por page                                | 24h window strict        |

---

## 8. Testing fixtures

`tests/unit/meta/graph-api-client.test.ts` usa golden mocks fetch (Response objects con JSON estos shapes). Integration `tests/integration/` (7.10) usa Meta sandbox real con allowlist.

Nunca commitear payloads con `phone_number_id` real, `access_token`, o user data productiva. Sample payloads documentation = números/IDs ficticios.
