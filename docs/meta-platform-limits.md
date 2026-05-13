# Meta Platform Limits — WhatsApp + Instagram + Facebook Messenger

> Caps + windows + restrictions por canal Meta. Re-audit cadence: trimestral (Meta cambia políticas frecuente). Última verificación: 2026-05-13.

> **Source primario:** [developers.facebook.com/docs](https://developers.facebook.com/docs). Confirmar siempre antes de production deploy.

---

## 1. WhatsApp Cloud API

### Rate limits throughput (oficial Meta)

| Tier              | Msg/seg por phone_number_id | Requisito                                                            |
| ----------------- | --------------------------- | -------------------------------------------------------------------- |
| Standard          | 80                          | Default todos los números nuevos.                                    |
| High              | 1,000                       | Approval Meta + 90d con 99.9% delivery + criterios calidad mensajes. |
| Cloud API Premium | Bursts >1,000               | Contact Meta sales + Enterprise tier + NDA.                          |

### Messaging tiers (msgs únicos a clientes nuevos / 24h)

| Tier   | Conversaciones business-initiated / 24h | Trigger upgrade                                                      |
| ------ | --------------------------------------- | -------------------------------------------------------------------- |
| Tier 1 | 1,000                                   | Default nuevo número.                                                |
| Tier 2 | 10,000                                  | Send 1K conversations únicas en 7 días + quality "high".             |
| Tier 3 | 100,000                                 | Send 10K conversations únicas en 7 días + quality "high".            |
| Tier 4 | Unlimited                               | Send 100K conversations únicas en 7 días + quality "high" sostenido. |

### Quality rating

| Estado  | Comportamiento                                                        |
| ------- | --------------------------------------------------------------------- |
| Green   | OK. Throughput full.                                                  |
| Yellow  | Warning. Quality issues. Recomienda revisar block rate / report rate. |
| Red     | Throttled. Throughput limitado. Si persiste 7 días → tier downgrade.  |
| Flagged | Account flagged. Posibles violations política. Manual review Meta.    |

**Triggers downgrade quality:**

- Block rate alto (>2-3% lo que llega).
- Report rate alto.
- Mensajes spam-like (no relevant a usuario, sin opt-in).
- Templates rejected repetidamente.

### 24-hour window

- Lead puede recibir mensajes **libres** dentro **24h tras último mensaje del lead a la empresa**.
- Fuera de 24h window: solo **HSM templates aprobados** (Highly Structured Messages).
- Conversación tracking: empieza cuando lead inicia o cuando business envía HSM aprobado.

### HSM templates

- **Approval flow**: submit en Meta Business Manager → review 24-48h → approved/rejected.
- **Categorías**: Marketing, Utility, Authentication. Pricing distinto por categoría.
- **Variables**: `{{1}}, {{2}}, ...` placeholders.
- **Restrictions**: no promotional content en Utility, no URLs no-verified, etc.
- **Localization**: per template per idioma.

### Pricing modelo conversation-based (2024-2025)

| Categoría               | Brasil | México | Argentina | Chile  | Colombia |
| ----------------------- | ------ | ------ | --------- | ------ | -------- |
| User-initiated          | $0.005 | $0.005 | $0.005    | $0.005 | $0.005   |
| Business Utility        | $0.020 | $0.030 | $0.030    | $0.030 | $0.020   |
| Business Marketing      | $0.072 | $0.045 | $0.045    | $0.045 | $0.040   |
| Business Authentication | $0.030 | $0.020 | $0.020    | $0.020 | $0.015   |

Source: [Meta WhatsApp Business Pricing](https://developers.facebook.com/docs/whatsapp/pricing). Actualizar quarterly.

### Free tier window

- **1,000 service conversations gratis/mes per WhatsApp Business Account** (WABA).
- Customer service-initiated (user envía primero, business responde dentro 24h) suelen ser libres.

### CTWA (Click-to-WhatsApp Ads) — free entry points

- Mensajes iniciados desde CTWA Ads = **gratis** + **72h window** (no 24h).
- Bot opcional para automatizar reply.

### Media restrictions

| Tipo     | Max size                                 |
| -------- | ---------------------------------------- |
| Image    | 5 MB (jpeg/png)                          |
| Audio    | 16 MB (aac/mp4/amr/mpeg/ogg)             |
| Video    | 16 MB (mp4/3gpp)                         |
| Document | 100 MB (pdf/doc/xls/ppt/txt)             |
| Sticker  | 100 KB (static) / 500 KB (animated webp) |

### Phone number caps

- 1 phone_number_id puede registrar **máximo 1 WhatsApp Business Account**.
- 1 WABA puede tener **máximo 25 phone numbers**.
- Multi-number setup requiere load balancing custom.

### Implicaciones para CRM pilot tier (peak 50 msg/sec)

- **1 phone_number_id Standard tier = 80 msg/sec cap.** Cubre pilot tier holgado.
- **Quality "Green" obligatorio.** Monitor block/report rate + abort si Yellow.
- **24h window enforcement crítico.** Si vendedor responde >24h tras último msg lead → fallará silently. Service debe pre-check window y forzar HSM template si fuera.

---

## 2. Instagram Direct Messages API (Graph API)

### Acceso

- Requiere **Instagram Business Account** (no Personal).
- Linked a **Facebook Page**.
- Permissions: `instagram_manage_messages`, `instagram_basic`, `pages_messaging`.

### 24-hour messaging window

- Mismo que WhatsApp: 24h ventana libre tras último msg del usuario.
- Fuera de 24h: solo **message tags** específicos (limitados).

### Message tags (Instagram DM)

| Tag                      | Uso permitido                                      |
| ------------------------ | -------------------------------------------------- |
| `HUMAN_AGENT`            | Manual human reply dentro 7d tras último user msg. |
| `ACCOUNT_UPDATE`         | Notificación cambios account/order user.           |
| `POST_PURCHASE_UPDATE`   | Notificación post-purchase orden user.             |
| `CONFIRMED_EVENT_UPDATE` | Recordatorio event confirmado user.                |

**NO existe equivalente Marketing tag IG DM.** Promo/broadcast OFF window = prohibido.

### Rate limits

- Mensajes/seg: limite no público explícito Meta, pero **infiere ~250 msg/min per IG Business Account** según docs comunidad.
- API calls Graph API: 200/hour per user token (default).

### Restrictions

- **No bulk messaging.** Mass DM = ban.
- **No template approval system.** Texto libre dentro window OK.
- **Media:** image/video/audio OK. Stickers/voice notes limited.
- **Stories reply context:** msgs auto-include story reference.

### Implicaciones para CRM

- IG users no exponen teléfono. Reconocimiento via `meta_user_ids` jsonb (handled by CRM).
- Merge manual cross-channel necesario.
- 24h window stricter (sin HSM alternative).

---

## 3. Facebook Messenger API

### Acceso

- Requiere **Facebook Page**.
- Permissions: `pages_messaging`, `pages_messaging_subscriptions`, `pages_show_list`.

### 24-hour + 1 messaging window

- 24h libre tras último msg user.
- **+1 mensaje fuera de window** permitido con `MESSAGE_TAG` válido.

### Message tags (Messenger)

Más opciones que Instagram:

| Tag                              | Uso                                 |
| -------------------------------- | ----------------------------------- |
| `CONFIRMED_EVENT_UPDATE`         | Recordatorio evento confirmado.     |
| `POST_PURCHASE_UPDATE`           | Update post-compra (shipping, etc). |
| `ACCOUNT_UPDATE`                 | Cambios cuenta usuario.             |
| `HUMAN_AGENT`                    | Manual human reply dentro 7d.       |
| `NEWS_SUBSCRIPTION` (deprecated) | News content. Deprecated 2020.      |

### Subscription messaging (deprecated)

Antes existía broadcast. Deprecated 2020. **No broadcast Messenger** actual.

### One-Time Notifications (OTN)

- User puede opt-in a recibir **1 notification** fuera de window.
- Token válido **1 año** o single-use.
- Útil para "te avisamos cuando llegue stock".

### Rate limits

- ~600 msgs/min per Page (no oficial pero observado).
- Webhook deliveries: retries Meta hasta 24h si endpoint down.

### Media

| Tipo  | Max size |
| ----- | -------- |
| Image | 25 MB    |
| Audio | 25 MB    |
| Video | 25 MB    |
| File  | 25 MB    |

### Implicaciones para CRM

- Messenger menos relevante Latam (uso baja vs WA + IG). Mantener canal pero priorizar WA + IG.
- Tags message útiles para reactivación. OTN viable para "te avisamos cuando llegue stock".

---

## 4. Cross-platform unified considerations

### Identidad cross-channel

| Canal     | ID disponible                 | Teléfono accesible | Reconocimiento mismo lead |
| --------- | ----------------------------- | ------------------ | ------------------------- |
| WhatsApp  | `wa_id` (= teléfono)          | Sí                 | Trivial (telefono UNIQUE) |
| Instagram | `ig-id` (Page-scoped ID PSID) | No                 | Merge manual / heurística |
| Messenger | `psid` (Page-scoped ID)       | No                 | Merge manual / heurística |

**Solución CRM:** `leads.meta_user_ids` jsonb mapa `{canal → id}`. Merge candidates table (R12) heurística cross-channel.

### Webhook signature verification

Todas plataformas Meta usan **HMAC-SHA256**:

```typescript
const signature = req.headers["x-hub-signature-256"]; // sha256=...
const expected = "sha256=" + crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
const ok = crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
```

**Critical:** `timingSafeEqual` no string compare. Replay attack window: validar `timestamp` payload dentro 5min.

### Common error codes

| Code   | Meaning                                                | Acción CRM                                     |
| ------ | ------------------------------------------------------ | ---------------------------------------------- |
| 131000 | WhatsApp generic error                                 | Retry con backoff.                             |
| 131005 | Re-engagement message (out of 24h, no HSM)             | Forzar template HSM. Mark `requires_template`. |
| 131008 | Required parameter missing                             | Validation error pre-send.                     |
| 131009 | Parameter value invalid                                | Validation error pre-send.                     |
| 131016 | Service unavailable                                    | Retry exponencial.                             |
| 131021 | Recipient incapable receiving (blocked / not opted-in) | Mark lead `blocked`. Stop sending.             |
| 131026 | Receiver incapable                                     | Mark lead `unreachable`.                       |
| 131031 | Account is locked                                      | Alert admin. Pause sending.                    |
| 131047 | Re-engagement message (60d limit Marketing template)   | Use Utility template fallback.                 |
| 131056 | (Business Account) restricted                          | Manual Meta review needed.                     |
| 132000 | Template name does not exist                           | Re-sync templates Meta.                        |
| 132001 | Template language not exist                            | Add language version Meta Business Manager.    |
| 132005 | Translated content same as original                    | Submit translation correctly.                  |
| 132007 | Template format character policy violated              | Sanitize content.                              |
| 132012 | Param format mismatch                                  | Schema mismatch HSM vars.                      |
| 132015 | Template paused                                        | Wait / switch template.                        |
| 132016 | Template disabled                                      | Use alternative.                               |
| 132068 | Flow blocked / disabled                                | Manual review Meta.                            |

---

## 5. Compliance + opt-in

### WhatsApp Business Policy

- **Explicit opt-in mandatory** antes de business-initiated.
- Opt-in via website/checkout/Facebook page/QR code/etc.
- Audit trail opt-in obligatorio (log timestamp + source).

### CTWA conversation entry

- Click-to-WhatsApp Ads inicia conversación = implícit opt-in within 72h window.

### Spam reporting consequences

- Block rate alto → quality drop.
- Quality red sostenido → tier downgrade → throughput cap → eventual ban WABA.

---

## 6. Implications para arquitectura CRM

### Service `meta-api.service.ts`

Pre-send checks obligatorios:

1. **Lead opt-in flag check.** Si lead no opted-in → reject.
2. **24h window check.** Si fuera window + sin template HSM → reject o forzar template.
3. **Quality check.** Si WABA quality "Red" → pause sending non-critical.
4. **Tier check.** Si tier 1 + conversaciones únicas día > 1K → throttle.
5. **Error code mapping.** Map Meta error codes → DomainError taxonomy.

### Lead `opted_in_at` column (post-Slice 1)

Agregar `leads.opted_in_at timestamptz nullable` + `opt_in_source text`. Sin opt-in = no enviable.

### Reactivation cron (`reactivation-predictor.cron`)

Solo template HSM aprobado. Pre-check window. Skip si no template aprobado para idioma + canal.

### Cost tracking (`docs/cost-budget.md`)

Conversation-based pricing actualizar quarterly por país. Track per template category.

---

## 7. Re-audit cadence

- **Quarterly:** Verificar caps + pricing + tier requirements actualizado en docs Meta.
- **Pre-major-release CRM:** Re-confirmar error codes + permissions vigentes.
- **Tras incident producción:** Re-verificar limit relevante al incident.

---

## Referencias

- [WhatsApp Cloud API Docs](https://developers.facebook.com/docs/whatsapp/cloud-api/overview)
- [WhatsApp Business Pricing](https://developers.facebook.com/docs/whatsapp/pricing)
- [Messenger Platform Docs](https://developers.facebook.com/docs/messenger-platform/)
- [Instagram Messaging API Docs](https://developers.facebook.com/docs/messenger-platform/instagram/overview)
- [Meta Business Policy](https://www.whatsapp.com/legal/business-policy/)
- [WABA Quality Rating](https://developers.facebook.com/docs/whatsapp/api/quality-ratings)
