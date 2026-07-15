# Slice 2 — Vistas 9-12 — Design Spec

> **Fecha:** 2026-07-14
> **Estado:** diseño aprobado por usuario (plan de implementación PENDIENTE — próxima sesión: writing-plans → ejecución fase por fase)
> **Fase padre:** Slice 2 vistas diferidas (spec core 8.x: `2026-05-17-slice2-ui-core-design.md` §7)

---

## 1. Decisiones (brainstorming 2026-07-14)

- **Orden por ROI pilot:** 9=Productos → 10=Leads → 11=Intents+Reglas → 12=Tags+Métricas+Ajustes. Razón: sin catálogo cargado el agente no cotiza (bloqueante de valor real); intents/reglas ahorran costo LLM; métricas/ajustes son lectura.
- **Profundidad:** CRUD real solo donde el pilot lo usa (productos, reglas, tags, intents aprobar); read-only v1 en métricas y ajustes.
- **Dep nueva aprobada:** `papaparse` (parse CSV robusto para import de catálogo).

## 2. Diseño por fase

### Fase 9 — Productos

- `/productos`: Table shadcn con búsqueda `?q=` (código/nombre), columnas codigo_interno (mono), nombre, categoría, precio, stock, badge activo. Rol-aware: acciones de escritura visibles solo admin (`getCurrentRol()`); RLS enforcea igual (productos W admin).
- CRUD vía Dialog + Server Actions (Zod línea 1): crear, editar, activar/desactivar. **Sin delete** — catálogo referenciado por sesiones históricas; baja = `activo=false`.
- Import CSV (stubs existentes `/productos/import` + `api/productos/import`): upload → parse server con papaparse → **preview con errores por fila** → confirmar → **upsert por `codigo_interno`** (existente: actualiza nombre/precio/stock/categoría; nuevo: inserta). Columnas: `codigo_interno,nombre,descripcion,categoria,precio,stock,sku_proveedor`.

### Fase 10 — Leads

- `/leads`: TODOS los leads (no solo sesión activa) + búsqueda nombre/teléfono + badge sesión activa + canal origen + vehículo. Link a detalle.
- `/leads/[id]`: ficha completa + sesiones históricas (resultado/motivo/fechas) + link a `/inbox/[id]` si sesión activa + **review de merge candidates** pendientes (aprobar/rechazar).
- **Verificación runtime plan:** ¿existe ejecutor de merge (reasignar conversaciones/sesiones del lead perdedor + status)? `DefaultLeadMergeDetectorService` solo detecta. Si falta → implementar `MergeExecutorService` (TDD) en 10.C.

### Fase 11 — Intents + Reglas

- `/intents-reglas/intents`: lista (nombre, descripción, badge aprobado, count ejemplos) + action aprobar/desaprobar + alta manual.
- `/intents-reglas/reglas`: CRUD reglas IF/THEN — intent (select de aprobados), respuesta_tipo `text|template|handoff`, cuerpo respuesta, toggle activa.
- Layout tabs compartido en el route group.

### Fase 12 — Tags + Métricas + Ajustes

- `/tags`: CRUD (nombre, color hex con validación CHECK existente, badge source manual/workflow) + delete con confirm (cascade lead_tags).
- `/metricas`: cards numéricas server-render: leads nuevos 7d, sesiones activas, cerradas por resultado (7d/30d), mensajes 7d, gasto LLM hoy (`CostTracker.getDailySpendUsd`; sin Upstash real → "—" con nota). `MetricsService` nuevo (TDD) con métodos count en repos existentes o queries agregadas. Sin charts v1.
- `/ajustes`: read-only v1 — empresa, usuario actual + rol, versión. Sin edición.

## 3. Transversal

- `getCurrentRol()` helper (JWT `app_metadata.rol` vía `getAuthenticatedUser`) en `src/server/auth/` para UI rol-aware.
- Patrón idéntico a 8.x: RSC fetch vía service per-request (authed client + RLS), Server Actions con `ActionResult` + toasts, client components reciben action como prop, validación browser Playwright por fase, commit por sub-paso.
- Sub-pasos: 9.A lista+search · 9.B CRUD · 9.C import CSV · 10.A lista · 10.B detalle+sesiones · 10.C merge review · 11.A intents · 11.B reglas · 12.A tags · 12.B métricas · 12.C ajustes.

## 4. Out of scope

Kanban, deals, export CSV, bulk actions, edición de leads (solo lectura + merge), charts en métricas, gestión de usuarios en ajustes (alta = dashboard Supabase per Slice 3), upload imágenes producto (bucket existe; UI diferida).

## 5. Proceso por fase (adoptado 2026-07-15, retro fase 9)

Este spec fija **decisiones de producto** (scope, orden, profundidad, out-of-scope) — sigue vigente. Lo que NO fija es **comportamiento observable** (semántica de filtros, efecto exacto de escrituras, errores por caso, invariantes): en fase 9, 3 de ~6 findings serios del review eran prevenibles con esos contratos.

**Flujo por fase (10, 11, 12):**

1. Brainstorming corto con el usuario → addendum `2026-XX-XX-faseN-<nombre>-contratos.md` usando `_TEMPLATE-contratos-fase.md` (assumptions verificadas + datos/orden/búsqueda + acciones con tabla de errores + estados + invariantes + criterios de aceptación ejecutables).
2. `superpowers:writing-plans` sobre spec §fase + addendum.
3. Ejecución subagent-driven con reviews por task + final whole-branch review.

Fase 9 se ejecutó sin addendum (pre-adopción): ✅ completa 2026-07-15, plan `../plans/2026-07-14-slice2-fase9-productos.md`.

---

**FIN SPEC.** Próximo paso al retomar: contratos fase 10 (paso 1 de §5) → `superpowers:writing-plans` → ejecutar fase 10.
