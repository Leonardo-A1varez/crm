# Security Threat Model — CRM Repuestos Latam

> STRIDE + OWASP Top 10 walkthrough. Baseline B3 (Pre-Slice 1). Re-audit obligatorio Slice 3 + Slice 4 pre-launch + quarterly post-launch.

> Cliente empresa = controller. Nosotros = processor. Para detalle compliance per país → `docs/data-retention.md`.

---

## 1. Threat actors

| Actor                        | Motivación                                | Capability                                   |
| ---------------------------- | ----------------------------------------- | -------------------------------------------- |
| Competidor                   | Robar leads / catálogo                    | Medio: requiere credential leak o RLS bypass |
| Empleado disgustado          | Exfiltrar data clientes                   | Alto: tiene acceso legítimo limitado por rol |
| Spam-bot                     | Saturar webhook Meta + LLM cost burn      | Bajo: bloqueable rate limit + cap            |
| Atacante externo oportunista | Webhook flood / SQL inj / XSS             | Bajo-medio: requiere skill básico            |
| Atacante targeted            | Supply chain compromise / state-sponsored | Alto pero baja probabilidad B2B Latam        |
| Lead malicioso               | Inyectar prompts adversarial al agente    | Medio: prompt injection vector               |

---

## 2. STRIDE per componente

### Webhook Meta endpoint (`/api/webhooks/meta`)

| Threat (STRIDE)                                | Mitigation                                                                            | Estado      |
| ---------------------------------------------- | ------------------------------------------------------------------------------------- | ----------- |
| **Spoofing** (fake webhook calls)              | HMAC-SHA256 signature verify + `timingSafeEqual`                                      | Slice 1 7.9 |
| **Tampering** (modificar payload)              | Signature cubre body completo                                                         | Slice 1 7.9 |
| **Repudiation** (deny envío)                   | Audit log inbound persistido `mensajes` + `meta_message_id`                           | ✅ Slice 1  |
| **Information disclosure** (leak)              | HTTPS forced (HSTS B3) + body no logged en error responses                            | ✅ B3       |
| **Denial of Service** (flood)                  | Rate limit per IP + per phone_number_id Upstash (B3) + Inngest 200 response inmediato | ✅ B3       |
| **Elevation of privilege** (admin via webhook) | Webhook NO ejecuta admin actions; solo emits events Inngest                           | ✅ design   |

### Inngest workflows

| Threat                              | Mitigation                                                             | Estado      |
| ----------------------------------- | ---------------------------------------------------------------------- | ----------- |
| Replay events                       | Outbox `event_id` deterministic + Inngest dedup window                 | ✅ B2       |
| Tampering event payload             | Inngest signed payloads + `INNGEST_SIGNING_KEY` env                    | Slice 1 7.8 |
| Information disclosure (logs PII)   | Logger structured + redaction patterns (Slice 1 7.7)                   | Slice 1 7.7 |
| Privilege escalation (service-role) | ESLint boundaries `inngest/**` puede `server-services/**` solo, no app | ✅ A7       |

### Database (Supabase Postgres)

| Threat                                                    | Mitigation                                                                                 | Estado          |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------ | --------------- |
| Direct DB access via leaked key                           | `SUPABASE_SERVICE_ROLE_KEY` env scoped prod-only Vercel + rotation 90d                     | Slice 1 7.7     |
| SQL injection                                             | Supabase client uses parameterized queries (PostgREST + RLS); Zod validation HTTP boundary | ✅ pattern      |
| RLS bypass                                                | service-role only en `inngest/**`/`server-services/**`. App `authed(jwt)` uses RLS         | ✅ A7 + Slice 3 |
| Backup leak                                               | Supabase backups encrypted at rest + S3 custom backup gpg encrypted                        | B6 + Slice 4    |
| Cross-tenant data leak (single-org → multi-tenant futuro) | Single-org locked B1. Multi-tenant defer Year 3+.                                          | ✅ B0 + B1      |

### LLM (OpenAI via Vercel AI SDK)

| Threat                             | Mitigation                                                                        | Estado      |
| ---------------------------------- | --------------------------------------------------------------------------------- | ----------- |
| Prompt injection (lead malicioso)  | Sistema prompt + `stopWhen` step limit + tool calls scoped (catalog only)         | Slice 1 7.5 |
| Cost burn (jailbreak loops)        | CostTracker daily cap kill switch `BudgetExceededError`                           | ✅ R6       |
| API key leak (`OPENAI_API_KEY`)    | Server-side only, never `NEXT_PUBLIC_*`. Vercel env scoped.                       | Slice 1 7.7 |
| Hallucination → wrong info al lead | Twin extractor re-parse Zod schema (defensa anti-alucinación)                     | ✅ R5       |
| Sensitive data leak via prompt     | Lead PII passa al LLM (necessary). Sub-processor disclosure → `data-retention.md` | ✅ B0       |

### Web app (Next.js)

| Threat            | Mitigation                                                            | Estado     |
| ----------------- | --------------------------------------------------------------------- | ---------- |
| XSS               | React escaping default + CSP strict (script-src 'self')               | ✅ B3      |
| CSRF              | Server Actions con built-in CSRF protection Next.js                   | ✅ Next.js |
| Clickjacking      | `X-Frame-Options: DENY` + `frame-ancestors 'none'` en CSP             | ✅ B3      |
| Open redirect     | No redirects from user input planeados; review Slice 2 UI             | Slice 2    |
| Session hijacking | Supabase Auth cookies httpOnly + secure + sameSite + JWT short expiry | Slice 3    |
| MITM              | HSTS preload max-age 2 años                                           | ✅ B3      |

### Storage (Supabase Storage)

| Threat                | Mitigation                                                            | Estado                |
| --------------------- | --------------------------------------------------------------------- | --------------------- |
| Direct bucket access  | Buckets privados (no public). Signed URLs short TTL.                  | ✅ 0005               |
| Unauthorized download | Storage policies RLS-like + role check                                | Slice 3               |
| Malicious upload      | MIME validation + size cap per bucket + virus scan opcional (Slice 4) | Slice 1 7.6 + Slice 4 |

---

## 3. OWASP Top 10 (2021) — Coverage

| ID  | Riesgo                             | Coverage CRM                                                                             |
| --- | ---------------------------------- | ---------------------------------------------------------------------------------------- |
| A01 | Broken Access Control              | RLS por rol admin/vendedor (Slice 3) + service-role bypass solo workflows (ESLint A7)    |
| A02 | Cryptographic Failures             | HTTPS forced HSTS + Supabase TLS + Postgres encryption at rest + S3 gpg backup           |
| A03 | Injection                          | Parameterized queries Supabase client + Zod validation HTTP boundary                     |
| A04 | Insecure Design                    | Threat model doc (este) + dev best practices AGENTS.md                                   |
| A05 | Security Misconfiguration          | Security headers B3 + CSP strict + ESLint boundaries                                     |
| A06 | Vulnerable Components              | npm audit CI gate (high+critical block) + Dependabot + dep audit doc                     |
| A07 | Identification + Auth Failures     | Supabase Auth 2FA TOTP admin (Slice 3) + JWT short expiry + session revoke               |
| A08 | Software + Data Integrity Failures | Outbox B2 + event_id idempotency + Inngest signed events                                 |
| A09 | Security Logging + Monitoring      | Logger structured + admin_actions audit + outbox audit + Vercel Log Drains (Slice 1 7.7) |
| A10 | SSRF (Server-Side Request Forgery) | No user-provided URLs fetched server-side (catálogo URLs son admin-controlled)           |

---

## 4. Top hardening pendientes post-B3

### Slice 1

- D.1: Webhook HMAC + timing-safe + replay window test suite.
- D.4: Rate limiter wireup Upstash production.
- Service-role key rotation procedure documented.

### Slice 3

- D.5: RLS policies completas + CI gate `MIN_RLS_POLICIES` subir umbral.
- D.6: 2FA TOTP admin obligatorio.
- D.7: Re-walkthrough STRIDE post-policies.

### Slice 4 (pre-launch)

- DAST scan (Burp / OWASP ZAP) en preview deploy.
- Penetration test third-party (idealmente).
- Data residency compliance verify per país cliente.
- Backup recovery drill (RTO/RPO real test).

---

## 4.1 Known security issues diferidos

### `pg_trgm` extension en schema `public` (Supabase advisor WARN)

**Issue:** Supabase Advisor lint `0014_extension_in_public` warna que `pg_trgm` extension está instalada en `public`. Best practice: extensions en schema dedicado (`extensions`).

**Riesgo actual:** Bajo. Atacante con SQL injection podría usar funciones `pg_trgm` para análisis fuzzy de strings sensibles. Pero injection ya implica bigger compromise.

**Fix futuro (Slice 4 hardening):**

```sql
-- Plan:
-- 1. DROP indexes que usan gin_trgm_ops
-- 2. CREATE SCHEMA extensions
-- 3. ALTER EXTENSION pg_trgm SET SCHEMA extensions
-- 4. CREATE indexes con gin_trgm_ops qualified (extensions.gin_trgm_ops)
-- 5. GRANT usage extensions schema a anon, authenticated
```

**Razón defer:** indexes existentes (5+ via trigram en leads + productos) referencian `gin_trgm_ops`. Mover extension sin recreate indexes rompe queries. Refactor seguro requiere window de mantenimiento.

## 5. CSP relaxations actuales — hardening futuro

Current CSP necesita `unsafe-inline` + `unsafe-eval` para Next.js 16 + React Server Components streaming. Hardening path:

1. **Migrar a CSP nonce-based** (requiere middleware Next.js + Layout refactor).
2. **Eliminar `unsafe-eval`** post Next.js 17+ (estable RSC sin eval runtime).
3. **Subresource integrity (SRI)** para third-party scripts (no usamos actualmente).

Tracked: Slice 4 hardening.

---

## 6. Incident response

Runbook por tipo de incident → `docs/runbooks/` (B5).

- Data breach → `runbooks/data-breach.md` (Slice 4).
- Credential leak → `runbooks/credential-leak.md` (Slice 4).
- LLM cost spike → `runbooks/cost-spike.md` (B5).
- Service degradation → `runbooks/service-degradation.md` (Slice 4).

---

## 7. Compliance checklist deploy

Pre-prod deploy checklist (cada client deployment self-hosted):

- [ ] `npm audit --audit-level=high` verde.
- [ ] `bash scripts/verify-rls-policies.sh` verde (post-Slice 3: `MIN_RLS_POLICIES >= N`).
- [ ] Security headers verified via `curl -I` (CSP/HSTS/X-Frame).
- [ ] Webhook HMAC signature test suite verde.
- [ ] Rate limiter wired (Upstash creds present prod env).
- [ ] Service role key scoped Vercel prod env only.
- [ ] Aviso privacidad publicado por cliente.
- [ ] DPO contact configurado por cliente.
- [ ] Backup strategy aplicada per `docs/backup-strategy.md` (B6).
- [ ] Incident response contacts updated.

---

## Re-audit cadence

- **Quarterly:** review este doc + STRIDE walkthrough.
- **Pre-Slice 3 merge:** policies + 2FA + RLS gate.
- **Pre-launch (Slice 4):** penetration test third-party + DAST scan.
- **Post-incident:** update este doc con learnings.
- **Post Meta/Supabase/OpenAI major API changes:** review threat coverage.
