# Contratos fase 10 — Leads (addendum)

> **Padre:** `2026-07-14-slice2-vistas-9-12-design.md` §Fase 10 (decisiones de producto/scope) + §5 (proceso).
> **Estado:** aprobado por usuario 2026-07-15 (brainstorming 6 decisiones). Próximo paso: `superpowers:writing-plans`.
> **Transversales** (Zod línea 1, DomainError, PII, capas, RLS): AGENTS.md §0 manda — no se repiten acá.

---

## 0. Assumptions verificadas pre-plan (2026-07-15, contra repo)

| Assumption                                  | Verificación                            | Resultado                                                                                                                                                                                                                                   |
| ------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ¿Existe ejecutor de merge?                  | grep services/inngest                   | **NO.** Solo `DefaultLeadMergeDetectorService` (detecta + persiste candidates, score fijo 0.7). `LeadsRepository.mergeInto(src,dst)` existe pero SIN cascade (solo meta_user_ids + delete src) — el executor nuevo lo descompone/reemplaza. |
| ¿Se pueden reasignar sesiones entre leads?  | `lead-session.repo.ts` `update`         | **NO hoy** — `update` prohíbe cambiar `lead_id`. Se agrega método explícito `reassignLead` (contrato §2.A paso 4).                                                                                                                          |
| ¿Se pueden reasignar conversaciones?        | `conversations.repo.ts` `update`        | **SÍ** — `update(id, { lead_id })` permitido (prohíbe canal/thread).                                                                                                                                                                        |
| ¿Qué pasa con candidates al borrar un lead? | DDL `20260512000011` FKs                | `ON DELETE CASCADE` en src/dst → **borrar el perdedor auto-limpia TODOS sus candidates** (incluido el aprobado). Registro permanente del merge = `admin_actions`.                                                                           |
| ¿Detector re-propone un par rechazado?      | `recordCandidate` usa `findPendingPair` | **SÍ re-propondría** (bug). Fase 10 lo cambia a respetar `rejected` (vía `findAnyPair`). Contrato §2.B.                                                                                                                                     |
| RLS merge_candidates                        | migración `20260714124024`              | SELECT ambos roles · INSERT/UPDATE **admin only** → review/aprobar/rechazar/manual = admin.                                                                                                                                                 |
| RLS leads                                   | migración `20260714124024`              | SELECT/INSERT/UPDATE ambos roles. **⚠️ VERIFICAR EN PLAN: policy DELETE no aparece listada** — sin ella el delete del perdedor falla con client authed. Si falta → migración `leads_delete_admin` (DELETE solo admin).                      |
| Tags duplicados en merge                    | `tags.repo.ts` `assignToLead`           | Idempotente (retorna existente) → merge de tags sin conflicto.                                                                                                                                                                              |
| Mensajes: ¿referencian lead directo?        | entity `Mensaje`                        | NO — cuelgan de `conversacion_id` + `lead_session_id`. Se mueven gratis al reasignar convs/sesiones.                                                                                                                                        |
| Stubs API leads                             | `api/leads/*` 3 routes                  | 501 muertos. Fase 10 usa Server Actions (patrón 8.x/9); stubs se borran (como en 9.C).                                                                                                                                                      |
| `telefono` UNIQUE                           | DDL init leads                          | Sí — el teléfono del perdedor no puede convivir; desaparece con él (queda en snapshot audit).                                                                                                                                               |

## 1. Datos por vista

### `/leads`

- **Alcance:** TODOS los leads (no solo con sesión activa — diferencia clave vs inbox).
- **Orden:** `updated_at DESC`, tiebreak `id ASC` (orden total estable). Cap **1000** filas; la búsqueda acota (patrón fase 9).
- **Búsqueda `?q=`:** substring **literal** case-insensitive sobre `nombre` O `telefono`, vía `ilikeContains` (`src/server/db/postgrest-like.ts`). Chars `, ( ) % _` = literales. Trim + cap 100 chars. Vacío/whitespace/repetido (`?q=a&q=b`)/no-string → sin filtro, sin error.
- **Columnas:** nombre · teléfono (crudo, sin formatear) · canal: ícono `canal_origen` + dots por canal presente en `meta_user_ids` (reusa `ChannelIcons`) · vehículo `"{marca} {modelo} {anio}"` · badge "Sesión activa" si `findActiveByLeadId` ≠ null · actividad (`updated_at` relativo, reusa `RelativeTime`).
- **Banner duplicados (solo admin):** si hay candidates `pending` → "N pares duplicados pendientes" con link `?duplicados=1` que filtra la lista a los leads involucrados en pares pendientes. Sin pendientes → no se renderiza.
- **Fila → link** a `/leads/[id]`.

### `/leads/[id]`

- **Ficha completa read-only** (edición de leads OUT — spec padre §4): nombre, teléfono, email, dirección, vehículo completo, canal origen, canales vinculados, tags asignados. ~~created/updated~~ (enmienda 2026-07-16: la UI shipped no los renderiza — desviación aceptada en review T9; re-agregar si un caso de uso lo pide).
- **Sesiones históricas** (todas, `started_at DESC`): stage final · badge resultado (`exito`/`perdido`/activa) · motivo si perdido · fechas inicio/cierre. Sin count de mensajes v1 (query extra innecesaria).
- **Sesión activa** → link prominente "Abrir conversación" a `/inbox/[id]`.
- **Duplicados pendientes del lead:** por cada candidate `pending` que lo involucre: ficha resumida del otro lead (nombre, teléfono, canales, vehículo) + `reasons` + score + fecha + acciones admin (§2.A/B).
- **Botón admin "Marcar duplicado de…":** dialog con buscador (misma semántica literal de búsqueda) → selecciona otro lead → crea candidate manual (§2.C).
- Lead inexistente / id no-UUID → `notFound()`.

## 2. Acciones (todas: Server Action + Zod línea 1 + `ActionResult`/typed result + toast)

### 2.A `approveMergeAction { candidateId, keepLeadId }` — **admin only**

`keepLeadId` debe ser `src_lead_id` o `dst_lead_id` del candidate → ese es el **ganador**; el otro, el **perdedor**. La dirección la decide el admin, no el detector.

**Orden de ejecución replay-safe** (cada paso no-op/tolerante si re-corre tras crash; re-approve completa el merge):

1. **Validar:** candidate existe y está `pending` · ambos leads existen · **NO ambos con sesión activa** (invariante máx 1 activa/lead).
2. **Audit PRIMERO:** `admin_actions` action `"lead.merge" (ADMIN_ACTIONS.LEAD_MERGE)`, payload = `{ candidate_id, ganador_id, perdedor: snapshot completo del Lead + tags asignados }`. Registro permanente (los candidates se autodestruyen por CASCADE en paso 7).
3. **Conversaciones** del perdedor → `update(id, { lead_id: ganador })`. Colisión imposible por unique `(canal, canal_thread_id)`; si ocurriera → ConflictError aborta (re-ejecutable).
4. **Sesiones** del perdedor → `LeadSessionRepository.reassignLead(perdedorId, ganadorId)` (método nuevo; mueve todas, incluida una activa — el paso 1 garantiza que el ganador no tiene otra).
5. **Tags** del perdedor → `assignToLead(ganador, tagId, source original, assigned_by original)` por cada uno (idempotente; no hace falta remove — el perdedor se borra).
6. **Campos del ganador:** rellenar SOLO los huecos con los del perdedor. "Hueco" = `null` para nullables (`email`, `direccion`, `vehiculo_motor`, `empresa_id`) · `""` (string vacío post-trim) para `vehiculo_marca`/`vehiculo_modelo` (son NOT NULL string) · `0` para `vehiculo_anio` (NOT NULL number). + `meta_user_ids` = unión con **ganador primando** por canal. Campos con valor del ganador: intocables. `telefono` ganador: intocable.
7. **Delete perdedor** (candidates del perdedor —este y cualquier otro pending— se limpian solos por FK CASCADE).

**Qué NO toca jamás:** contenido de mensajes · resultado/motivo de sesiones cerradas · campos no-null del ganador · `telefono` del ganador.

**Errores:**

| Caso                              | Clase                             | Copy toast                                                                       |
| --------------------------------- | --------------------------------- | -------------------------------------------------------------------------------- |
| Candidate ya resuelto/inexistente | `ConflictError` / `NotFoundError` | "Este par ya fue resuelto o no existe. Refrescá la página."                      |
| Ambos con sesión activa           | `ValidationError`                 | "Ambos leads tienen sesión activa — cerrá una desde el inbox antes de fusionar." |
| Lead borrado entre medio          | `NotFoundError`                   | "Lead no encontrado. Refrescá la página."                                        |
| Vendedor ejecuta                  | `PermissionDeniedError`           | "Solo un admin puede fusionar leads."                                            |
| `keepLeadId` no pertenece al par  | `ValidationError`                 | "Datos inválidos. Refrescá la página."                                           |
| Resto (DB/infra)                  | vía `toActionError`               | mensaje curado genérico (detalle a logs)                                         |

Gate: `getCurrentRol() !== "admin"` corta en la action; backstop RLS (resolve/insert admin-only en merge_candidates + delete leads admin si migración).
Post-éxito: `revalidatePath("/leads")` + `revalidatePath(\`/leads/${ganadorId}\`)`. Toast: "Leads fusionados — historia completa bajo {nombre ganador}."

### 2.B `rejectMergeAction { candidateId }` — **admin only**

- `resolve(candidateId, "rejected", userId)`. Ya resuelto → ConflictError (mismo copy que arriba).
- **Contrato detector (cambio en fase 10):** `recordCandidate` pasa de chequear `findPendingPair` a `findAnyPair` — un par con status `rejected` **no se vuelve a proponer jamás** (ni per-lead ni cron global).
- Toast: "Par descartado — no se volverá a proponer."

### 2.C `createManualCandidateAction { leadId, otherLeadId }` — **admin only**

- Zod: ambos UUID, distintos (`mismo lead → ValidationError "No podés marcar un lead como duplicado de sí mismo."`).
- Crea candidate `{ score: 1.0, reasons: ["manual"] }`. Par pending ya existe → ConflictError "Ya hay un duplicado pendiente para este par."
- Par `rejected` previo: la creación manual SÍ procede (el humano sabe más que el rechazo previo) — `create` solo bloquea pending (verificado en repo).
- Toast: "Duplicado marcado — aparece en la lista de pendientes."

## 3. Estados de UI

- `/leads` vacío real: "Sin leads todavía" + descripción (llegan por webhook o se crean al escribir un cliente). Sin resultados de búsqueda: "Sin resultados para «{q}»".
- Skeletons `loading.tsx` en ambas rutas (patrón fase 9).
- Errores de render → `(panel)/error.tsx` existente; errores de action → toast.

## 4. Invariantes (lo que NUNCA puede pasar)

1. Un merge **nunca borra ni modifica mensajes, conversaciones ni sesiones** — solo los reasigna de lead.
2. **Máx 1 sesión activa por lead** sobrevive a cualquier merge (bloqueo pre-merge lo garantiza).
3. Campos **no-null del ganador nunca se sobrescriben**.
4. Todo merge deja **registro permanente en `admin_actions` ANTES de tocar datos** (snapshot del perdedor incluido).
5. Un par **rechazado no se re-propone** por el detector (manual sí puede recrearlo).
6. `telefono` del perdedor desaparece de leads con él; **queda solo en el payload de audit**.

## 5. Criterios de aceptación ejecutables

Browser (Playwright, patrón `validate-9*.js`: login retry, networkidle+delay) salvo (8) integration:

1. `/leads` lista todos (incluye leads sin sesión activa que el inbox no muestra), orden actividad DESC.
2. Búsqueda literal: `?q=` con substring de nombre encuentra; con parcial de teléfono encuentra; con coma/paréntesis no crashea; `?q=a&q=b` degrada sin filtro.
3. `/leads/[id]` muestra ficha + sesiones históricas con resultado/motivo + link "Abrir conversación" solo si hay activa.
4. "Marcar duplicado de…" (admin) → candidate aparece en pendientes del detalle + banner en `/leads`.
5. Aprobar merge (par sin doble-activa) eligiendo ganador → perdedor 404 · ganador tiene conversaciones+sesiones+tags del perdedor · campos null rellenados · `meta_user_ids` unión · candidate desaparecido · row `admin_actions` con snapshot.
6. `/inbox/[ganador]`: mensajes que eran del perdedor visibles e intactos.
7. Merge con ambos leads con sesión activa → toast exacto "Ambos leads tienen sesión activa…" y CERO cambios en DB.
8. (Integration) Par rechazado: `recordCandidate` del detector retorna null / no crea nuevo candidate para ese par.
9. Vendedor logueado: ve `/leads` y detalle, NO ve botones de merge ni "Marcar duplicado"; invocación directa de action → toast "Solo un admin…".
10. Re-aprobar un merge ya ejecutado (replay) → error informativo ("ya resuelto"), sin efectos secundarios.

## Sub-pasos sugeridos (para writing-plans)

- **10.A** `/leads` lista + búsqueda + banner duplicados
- **10.B** `/leads/[id]` detalle + sesiones + link inbox
- **10.C** Merge backend: `reassignLead` (repo, TDD contract) + `MergeExecutorService` (TDD, orden replay-safe) + detector respeta `rejected` + verificación/migración policy DELETE leads + actions
- **10.D** Merge UI: sección review en detalle + "Marcar duplicado de…" + validación browser completa

---

**FIN ADDENDUM.** Próximo paso: `superpowers:writing-plans` sobre spec padre §Fase 10 + este addendum → plan fase 10.
