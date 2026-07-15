# Contratos fase N — <nombre> (addendum)

> **Proceso:** llenar ANTES de `writing-plans`, en brainstorming corto con el usuario.
> **Padre:** las decisiones de producto/scope viven en el spec de la fase — acá SOLO comportamiento observable.
> **Transversales** (Zod línea 1, DomainError, PII, capas, RLS): NO copiar — AGENTS.md §0 manda.
> **Razón de existir:** retro fase 9 — 3 de ~6 findings serios (escape búsqueda PostgREST, semántica upsert implícita, presupuesto de errores) eran prevenibles con contratos explícitos. Ver final review fase 9.

## 0. Assumptions verificadas pre-plan

Verificar contra el repo ANTES de planear (patrón "¿existe MergeExecutor o solo detector?").

| Assumption | Cómo se verificó (archivo/comando) | Resultado |
| ---------- | ---------------------------------- | --------- |
|            |                                    |           |

## 1. Datos por vista

Por cada vista/route de la fase:

- **Entidades + campos visibles** (+ formato: moneda, fechas relativas, badges).
- **Orden default** (+ tiebreak único si hay cap/paginación — orden estable o no hay orden).
- **Filtros/búsqueda: semántica EXACTA** — literal vs wildcard, case-sensitivity, chars especiales (`, ( ) % _`), longitud máxima. Si busca texto libre contra Supabase: usar `ilikeContains()` (`src/server/db/postgrest-like.ts`).
- **Cap/paginación** + qué pasa al superarlo (mensaje, corte silencioso, etc.).

## 2. Acciones (escrituras)

Por cada acción:

- **Quién** (rol) — gate UI + backstop RLS (cuál policy).
- **Efecto exacto**: qué campos toca — y qué campos **NO toca jamás** (la omisión implícita fue el bug del bulkUpsert).
- **Validación**: rangos/formatos ALINEADOS al DDL real (abrir la migration, no asumir — bounds Zod < DB fue finding).
- **Errores por caso** — tabla:

| Caso | Clase DomainError | Copy exacto del toast |
| ---- | ----------------- | --------------------- |
|      |                   |                       |

- **Idempotencia/replay** si aplica (¿segunda ejecución = no-op, error, o duplica?).

## 3. Estados de UI

- Vacío real vs sin-resultados-de-búsqueda (copys distintos).
- Loading (skeleton) · Error (boundary vs toast — quién atrapa qué).

## 4. Invariantes (lo que NUNCA puede pasar)

Ej.: "merge nunca borra mensajes", "máximo 1 sesión activa por lead sobrevive a cualquier operación".

1.

## 5. Criterios de aceptación ejecutables

Lista numerada de checks browser/integration. Se traduce 1:1 al script Playwright de validación de la fase (patrón `validate-9ab.js`/`validate-9c.js` fase 9: login retry por hidratación, networkidle+delay).

1.
