# Dependency Audit Baseline

> A10 — establecido 2026-05-12. Re-correr `npm audit` semanal + post-Slice cada uno.

## Pinned versions críticas

| Pkg                     | Version           | Razón                                                                              |
| ----------------------- | ----------------- | ---------------------------------------------------------------------------------- |
| `inngest`               | **exact 4.4.0**   | API cambios entre v3/v4. Pin manual hasta verify v5+ compat.                       |
| `zod`                   | **exact 4.4.3**   | v4 introdujo breaking changes API. Vercel AI SDK confirma compat.                  |
| `@upstash/ratelimit`    | **exact 2.0.8**   | B3 rate limiter webhook Meta. v2 estable. Pin para reproducibilidad CI.            |
| `@upstash/redis`        | **exact 1.38.0**  | B3 Redis REST client. Pin para evitar breaking changes en upgrade major futuro.    |
| `@supabase/supabase-js` | **exact 2.105.4** | Slice 1 7.3 DB client. Pin para reproducibilidad CI + estabilidad type generation. |

## Overrides

| Pkg override          | Razón                                                                                                                                                                          | Linked vuln                                                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `protobufjs` `^8.2.0` | Inngest 4.4.0 trae `@opentelemetry/sdk-node@0.217.0` que depende protobufjs 8.0.0-8.0.1 (vuln high: DoS + code injection + prototype pollution). Override forza 8.2.0 patched. | GHSA-q6x5-8v7m-xcrf, GHSA-2pr8-phx7-x9h3, GHSA-66ff-xgx4-vchm, GHSA-fx83-v9x8-x52w, GHSA-75px-5xx7-5xc7, GHSA-jvwf-75h9-cwgg, GHSA-685m-2w69-288q |

## Vulnerabilidades aceptadas

| Pkg                             | Severity | Razón aceptación                                                                                                                             |
| ------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `postcss <8.5.10` (via Next 16) | moderate | Fix requiere downgrade Next a v9.3.3 (breaking). Next 16 mantenedor debe actualizar postcss internal. Re-check post cada Next minor release. |

## Latest verified (2026-05-13)

```
inngest                4.4.0    (current = latest)
zod                    4.4.3    (current = latest)
@upstash/ratelimit     2.0.8    (current = latest, B3 added)
@upstash/redis         1.38.0   (current = latest, B3 added)
@supabase/supabase-js  2.105.4  (current = latest, Slice 1 7.3 added)
lucide-react           1.14.0   (current = latest)
ai                     6.0.180  (no instalado todavía — Slice 1 7.5)
@ai-sdk/openai         3.0.63   (no instalado todavía — Slice 1 7.5)
react                  19.2.6   (patched 19.2.4 → 19.2.6)
react-dom              19.2.6   (patched 19.2.4 → 19.2.6)
@types/node            20.19.41 (Node 20 LTS — no upgrade a 25.x)
typescript             5.9.3    (5.x — defer v6 hasta Slice 4 cleanup)
eslint                 9.39.4   (defer v10 hasta Slice 4 cleanup — boundaries plugin compat verify)
```

## CI policy

`.github/workflows/ci.yml` job `audit`:

- `npm audit --audit-level=high` → falla pipeline si high+critical.
- moderate informational solo. Review weekly.

## Re-audit cadence

- **Diario:** Dependabot/Renovate PRs auto.
- **Pre-Slice merge:** `npm audit --audit-level=high` + this doc revisar.
- **Quarterly:** review major upgrades (typescript v6, eslint v10, etc).
