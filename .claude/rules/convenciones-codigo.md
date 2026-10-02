---
paths:
  - "src/**/*.{ts,tsx}"
  - "tests/**/*.{ts,tsx}"
---

# Convenciones de código

Movido desde `AGENTS.md` §4 para que sólo cargue cuando se toca código, no en cada sesión.

## Idioma

- UI, comentarios, commits: español.
- Identificadores técnicos genéricos: inglés (`leadId`, `messageRepo`, `useEffect`).
- Identificadores de dominio: español (`lead_session`, `bloqueador`, `motivo_perdida`).

## TypeScript

- `strict: true` + `noUncheckedIndexedAccess` + `noFallthroughCasesInSwitch` +
  `noImplicitOverride` + `forceConsistentCasingInFileNames`.
- Nada de `any`; si es imprescindible, comentar por qué.
- Tipos de dominio en `src/types/`. Generados de Supabase en
  `src/server/db/types.gen.ts` (Slice 1 sub-paso 7.3).
- Inferir tipos donde sea posible.

## Validación

- Zod en todos los inputs HTTP (API routes + Server Actions).
- Schemas en `src/lib/validation/`.
- Tipos derivados vía `z.infer<typeof Schema>`.
- Validación de env vía zod fail-fast (`src/lib/env.ts`).

## Componentes React

- Server Components por defecto; `'use client'` sólo cuando hay interactividad.
- Composición sobre herencia. Props tipadas con interfaces.
- shadcn como base; extender vía composición, no editar `src/components/ui/`.

## Tests

- Vitest. Coverage threshold 80/75/80/80 (statements/branches/functions/lines).
- Repos mockeados con impl in-memory.
- Contract tests `runXContract(makeRepo)` reusables in-memory ↔ Supabase.
- Sin mocks en código de producción.

## Commits

- Conventional Commits (enforced vía commitlint): `feat:` `fix:` `chore:` `refactor:`
  `test:` `docs:` `perf:` `build:` `ci:` `revert:` `style:`.
- Subject ≤72 caracteres, español.
- Body sólo si el "por qué" no es obvio.

## Estructura de imports

1. Bibliotecas externas (react, next, zod…)
2. Imports absolutos `@/...`
3. Imports relativos `./...`
4. Imports de tipos al final con `import type`

## Errores

- Nunca `throw new Error('msg')` en `src/server/**`. Usar la jerarquía `DomainError`
  (`src/lib/errors.ts`): `NotFoundError`, `ConflictError`, `ValidationError`,
  `PermissionDeniedError`, `IllegalStateError`, `BudgetExceededError`, `InfraError`,
  `RateLimitError`. `mapPostgrestError` usa `InfraError` (retriable) como fallback para
  códigos Postgres no mapeados. El tipo de error decide la semántica de reintento.

## Architecture zones (eslint-plugin-boundaries)

- `app/**` puede importar: components, server-services, server-auth, lib, types, hooks, stores.
- `components/**`: components, lib, types, hooks, stores.
- `inngest/**`: server-services, server-repositories, server-db, server-lock, lib, types.
- `server-services/**`: server-repositories, server-lock, lib, types.
- `server-repositories/**`: server-db, lib, types.
- `lib/**`: lib, types.
- Resto: ver `eslint.config.mjs`.
