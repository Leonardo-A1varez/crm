# Slice 2 — Fase 10 Leads — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vista `/leads` (todos los leads + búsqueda), `/leads/[id]` (ficha + sesiones históricas + link inbox) y merge de duplicados end-to-end (review de candidates + candidate manual + ejecución replay-safe con audit), según contratos aprobados.

**Architecture:** Patrón fase 9: RSC → service per-request (authed + RLS) → repos. Dos services nuevos: `LeadsService` (lectura lista/detalle) y `MergeExecutorService` (approve/reject/manual — orden replay-safe: audit → convs → sesiones → tags → campos → delete). Server Actions con Zod línea 1 + `ActionResult` + toasts; UI rol-aware (`getCurrentRol`). El registro permanente del merge vive en `admin_actions` (los candidates se autodestruyen por FK CASCADE al borrar el perdedor).

**Tech Stack:** Next.js 16 App Router, Supabase (RLS + 1 migración nueva), Zod 4, Vitest, shadcn/ui (Base UI), Playwright para validación.

**Spec:** `docs/superpowers/specs/2026-07-14-slice2-vistas-9-12-design.md` §Fase 10 + **addendum de contratos** `docs/superpowers/specs/2026-07-15-fase10-leads-contratos.md` (fuente de verdad de comportamiento — leer ambos).

## Global Constraints

Copiadas de AGENTS.md + addendum (aplican a TODAS las tasks):

- **Server Actions = Zod safeParse primera línea.** Gate admin DESPUÉS del parse, antes de lógica.
- **DomainError jerarquía** (`ValidationError`, `NotFoundError`, `ConflictError`, `PermissionDeniedError`, `IllegalStateError`, `BudgetExceededError`) — prohibido `throw new Error`.
- **Capas: Action/Page → Service → Repository → DB.** Nunca saltar.
- **PII:** `telefono`/`nombre`/`email` NUNCA a logs (`redactPii` ya cubre logger). El snapshot del perdedor va a `admin_actions.payload` (DB, no log) — permitido y requerido por contrato.
- **Merge invariantes (addendum §4):** nunca borra/modifica mensajes-convs-sesiones (solo reasigna) · máx 1 sesión activa por lead · campos no-null del ganador intocables · audit ANTES de tocar datos · par rechazado no se re-propone · teléfono del perdedor solo en audit.
- **Búsqueda:** literal case-insensitive vía `ilikeContains` (`src/server/db/postgrest-like.ts`), trim + cap 100 chars, inválido → sin filtro.
- **Copys de error exactos:** tabla addendum §2.A (usarlos verbatim).
- Idioma: UI/comments/commits español. Conventional Commits ≤72 chars. No `any`. strict TS (tests tsconfig relaja indexedAccess). shadcn: no editar `src/components/ui/`. Pre-commit lefthook automático — no bypasear.
- Usuario dev panel: `admin-dev@crm.local` / `dev-admin-2026!` · dev server puerto 3001.

## File Structure

```
supabase/migrations/2026XXXXXXXXXX_leads_delete_admin.sql   CREATE  policy DELETE leads (admin) — T3
src/server/repositories/leads.repo.ts                       MODIFY  list orden+escape · delete() · baja mergeInto — T1/T3
src/server/repositories/leads.supabase.repo.ts              MODIFY  ídem — T1/T3
src/server/repositories/lead-session.repo.ts                MODIFY  listByLeadId + reassignLead — T2
src/server/repositories/lead-session.supabase.repo.ts       MODIFY  ídem — T2
src/server/services/lead-merge-detector.service.ts          MODIFY  respeta rejected — T6
src/server/services/leads/leads.service.ts                  CREATE  interface LeadsService — T4
src/server/services/leads/default-leads.service.ts          CREATE  impl — T4
src/server/services/leads/merge-executor.service.ts         CREATE  interface + Default impl — T5
src/server/bootstrap/leads-bootstrap.ts                     CREATE  make/get services per-request — T7
src/types/leads.ts                                          CREATE  LeadListItem/LeadDetail/etc — T4
src/lib/validation/leads.schema.ts                          CREATE  4 schemas actions — T7
src/app/(panel)/leads/_actions/action-error.ts              CREATE  copys leads — T7
src/app/(panel)/leads/_actions/approve-merge.action.ts      CREATE  — T7
src/app/(panel)/leads/_actions/reject-merge.action.ts       CREATE  — T7
src/app/(panel)/leads/_actions/create-manual-candidate.action.ts CREATE — T7
src/app/(panel)/leads/_actions/search-leads.action.ts       CREATE  buscador dialog — T7
src/app/(panel)/leads/page.tsx                              MODIFY  reemplaza stub — T8
src/app/(panel)/leads/loading.tsx                           CREATE  — T8
src/components/leads/LeadsTable.tsx                         CREATE  — T8
src/components/leads/DuplicadosBanner.tsx                   CREATE  — T8 (server, condicional)
src/app/(panel)/leads/[id]/page.tsx                         MODIFY  reemplaza stub — T9
src/app/(panel)/leads/[id]/loading.tsx                      CREATE  — T9
src/components/leads/LeadFicha.tsx                          CREATE  — T9
src/components/leads/SesionesHistorial.tsx                  CREATE  — T9
src/components/leads/DuplicadosSection.tsx                  CREATE  client review — T10
src/components/leads/MarcarDuplicadoDialog.tsx              CREATE  client buscador — T10
src/app/api/leads/route.ts                                  DELETE  stub 501 — T8
src/app/api/leads/[id]/route.ts                             DELETE  stub 501 — T9
src/app/api/leads/[id]/pause-ia/route.ts                    KEEP    (no es de esta fase)
src/app/api/leads/[id]/merge/route.ts                       DELETE  stub 501 — T10
tests/repositories/leads.contract.ts                        MODIFY  orden+escape+delete, baja mergeInto — T1/T3
tests/repositories/lead-session.contract.ts                 MODIFY  listByLeadId + reassignLead — T2
tests/unit/services/leads-service.test.ts                   CREATE  — T4
tests/unit/services/merge-executor.test.ts                  CREATE  — T5
tests/unit/services/ (detector tests existentes)            MODIFY  rejected — T6
tests/unit/leads-schema.test.ts                             CREATE  — T7
```

Nota ejecución: los nombres exactos de los archivos de contract/detector tests pueden variar levemente — el implementer los localiza con Glob (`tests/**/*lead*`) y lo reporta; si un archivo asumido no existe, NEEDS_CONTEXT.

Orden: T1→T2→T3 (repos+DB) → T4→T5→T6 (services) → T7 (actions) → T8→T9 (UI lectura + validación browser) → T10 (UI merge + validación E2E) → T11 (cierre).

---

### Task 1: `leads.list` — orden determinístico + búsqueda literal escapada

Contrato §1: orden `updated_at DESC, id ASC`; búsqueda literal (coma/`%`/`_` literales) sobre nombre|telefono. Hoy: sin ORDER, `.or(ilike)` crudo (mismo bug que fase 9 fixeó en productos).

**Skills:** `superpowers:test-driven-development`, `supabase:supabase-postgres-best-practices`.

**Files:**

- Modify: `tests/repositories/leads.contract.ts` (+3 tests)
- Modify: `src/server/repositories/leads.repo.ts` (InMemory `list`)
- Modify: `src/server/repositories/leads.supabase.repo.ts` (`list`)

**Interfaces:**

- Consumes: `ilikeContains(q: string): string` de `@/server/db/postgrest-like` (existente, fase 9).
- Produces: `list(filter?: LeadListFilter)` con orden garantizado `updated_at DESC, id ASC` y `q` literal. Sin cambio de firma.

- [ ] **Step 1: Failing contract tests**

En `tests/repositories/leads.contract.ts`, dentro del describe principal (localizar helper de insert existente — típicamente `baseInsert`/`makeLead` — y reusarlo con overrides; si el helper difiere, adaptar los overrides conservando la intención):

```ts
test("list ordena por updated_at desc con tiebreak id asc", async () => {
  const a = await repo.create(baseInsert({ telefono: "+5491100000001", nombre: "Ana" }));
  await new Promise((r) => setTimeout(r, 5));
  const b = await repo.create(baseInsert({ telefono: "+5491100000002", nombre: "Beto" }));
  await new Promise((r) => setTimeout(r, 5));
  await repo.update(a.id, { nombre: "Ana Actualizada" });

  const all = await repo.list();
  expect(all[0]?.id).toBe(a.id); // updated más reciente primero
  expect(all[1]?.id).toBe(b.id);
});

test("list q trata coma y paréntesis como literales", async () => {
  await repo.create(baseInsert({ telefono: "+5491100000003", nombre: "Pérez, Juan (taller)" }));
  await repo.create(baseInsert({ telefono: "+5491100000004", nombre: "Otra Persona" }));
  const r = await repo.list({ q: "pérez, juan (" });
  expect(r).toHaveLength(1);
  expect(r[0]?.telefono).toBe("+5491100000003");
});

test("list q matchea telefono parcial y % literal", async () => {
  await repo.create(baseInsert({ telefono: "+549115550001", nombre: "Tel Uno" }));
  await repo.create(baseInsert({ telefono: "+549116660002", nombre: "Tel 100% Dos" }));
  const porTel = await repo.list({ q: "115550" });
  expect(porTel).toHaveLength(1);
  expect(porTel[0]?.nombre).toBe("Tel Uno");
  const porPct = await repo.list({ q: "100%" });
  expect(porPct).toHaveLength(1);
  expect(porPct[0]?.nombre).toBe("Tel 100% Dos");
});
```

Nota acentos: si la collation de Postgres hace flakear el match `pérez` en integration, cambiar el fixture a `"Perez, Juan (taller)"` + query `"perez, juan ("` (ASCII) — la intención del test es coma/paréntesis literales, no folding de acentos.

- [ ] **Step 2: Run para ver fail**

Run: `npx vitest run tests/unit/repositories`
Expected: FAIL (orden = insertion order; coma rompe/matchea mal según impl).

- [ ] **Step 3: Implement**

InMemory `list` en `src/server/repositories/leads.repo.ts` — agregar sort tras filtros, antes del slice:

```ts
rows.sort((a, b) => b.updated_at.getTime() - a.updated_at.getTime() || a.id.localeCompare(b.id));
```

Supabase `list` en `leads.supabase.repo.ts` — reemplazar el arranque del query y el branch q:

```ts
let query = this.db
  .from("leads")
  .select()
  .order("updated_at", { ascending: false })
  .order("id", { ascending: true });

if (filter.q) {
  const pat = ilikeContains(filter.q);
  query = query.or(`nombre.ilike.${pat},telefono.ilike.${pat}`);
}
```

(+ `import { ilikeContains } from "@/server/db/postgrest-like";`).

- [ ] **Step 4: Unit verde**

Run: `npx vitest run tests/unit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/repositories/leads.contract.ts src/server/repositories/leads.repo.ts src/server/repositories/leads.supabase.repo.ts
git commit -m "feat(repo): leads.list orden estable + busqueda literal escapada"
```

---

### Task 2: `LeadSessionRepository.listByLeadId` + `reassignLead`

Contrato §0/§2.A paso 4: el detalle necesita sesiones históricas por lead (no existe) y el merge necesita reasignar sesiones (hoy `update` prohíbe `lead_id` — se agrega método EXPLÍCITO, no se relaja `update`).

**Skills:** `superpowers:test-driven-development`, `supabase:supabase`.

**Files:**

- Modify: `tests/repositories/lead-session.contract.ts` (+4 tests; el contract usa fixtures inyectables para FKs — seguir el patrón existente del archivo)
- Modify: `src/server/repositories/lead-session.repo.ts` (interface + InMemory)
- Modify: `src/server/repositories/lead-session.supabase.repo.ts` (impl)

**Interfaces:**

- Produces:

  ```ts
  // Todas las sesiones del lead (activa + cerradas), started_at DESC.
  listByLeadId(leadId: UUID): Promise<LeadSession[]>;
  // Merge: mueve TODAS las sesiones de un lead a otro. Devuelve count movidas.
  // 0 sesiones = no-op (replay-safe). Si el destino ya tiene sesión activa y se
  // mueve otra activa → ConflictError (unique parcial DB; el executor pre-valida).
  reassignLead(fromLeadId: UUID, toLeadId: UUID): Promise<number>;
  ```

- [ ] **Step 1: Failing contract tests**

En `tests/repositories/lead-session.contract.ts` (usar los helpers de fixture del archivo para lead ids válidos — en integration son FKs reales):

```ts
test("listByLeadId devuelve todas las sesiones del lead started_at desc", async () => {
  const s1 = await repo.create(baseInsert({ lead_id: leadA }));
  await repo.close(s1.id, { resultado: "perdido", motivo_perdida: "otro" });
  await new Promise((r) => setTimeout(r, 5));
  const s2 = await repo.create(baseInsert({ lead_id: leadA }));
  await repo.create(baseInsert({ lead_id: leadB })); // otro lead, no aparece

  const r = await repo.listByLeadId(leadA);
  expect(r.map((s) => s.id)).toEqual([s2.id, s1.id]);
});

test("listByLeadId lead sin sesiones → []", async () => {
  expect(await repo.listByLeadId(leadA)).toEqual([]);
});

test("reassignLead mueve todas las sesiones y devuelve count", async () => {
  const s1 = await repo.create(baseInsert({ lead_id: leadA }));
  await repo.close(s1.id, { resultado: "exito" });
  const s2 = await repo.create(baseInsert({ lead_id: leadA })); // activa

  const moved = await repo.reassignLead(leadA, leadB);
  expect(moved).toBe(2);
  expect(await repo.listByLeadId(leadA)).toEqual([]);
  const enB = await repo.listByLeadId(leadB);
  expect(enB.map((s) => s.id).sort()).toEqual([s1.id, s2.id].sort());
  // la activa sigue activa bajo el nuevo lead
  expect((await repo.findActiveByLeadId(leadB))?.id).toBe(s2.id);
});

test("reassignLead sin sesiones → 0 (replay-safe)", async () => {
  expect(await repo.reassignLead(leadA, leadB)).toBe(0);
});
```

(`leadA`/`leadB`: usar los ids de fixture que el contract ya define; si define uno solo, agregar un segundo siguiendo el mismo patrón.)

- [ ] **Step 2: Run fail** — `npx vitest run tests/unit/repositories` → FAIL (métodos no existen).

- [ ] **Step 3: Implement**

Interface (`lead-session.repo.ts`, dentro de `LeadSessionRepository`, después de `findActiveByLeadId`):

```ts
  // Todas las sesiones del lead (activa + cerradas), started_at DESC. Detalle /leads/[id].
  listByLeadId(leadId: UUID): Promise<LeadSession[]>;
```

y después de `delete`:

```ts
  // Merge de leads: mueve TODAS las sesiones de `fromLeadId` a `toLeadId`.
  // Devuelve count movidas; 0 = no-op (replay-safe). No usar fuera del merge —
  // `update` sigue prohibiendo lead_id a propósito.
  reassignLead(fromLeadId: UUID, toLeadId: UUID): Promise<number>;
```

InMemory:

```ts
  async listByLeadId(leadId: UUID): Promise<LeadSession[]> {
    return Array.from(this.store.values())
      .filter((s) => s.lead_id === leadId)
      .sort((a, b) => b.started_at.getTime() - a.started_at.getTime())
      .map(cloneSession);
  }

  async reassignLead(fromLeadId: UUID, toLeadId: UUID): Promise<number> {
    let moved = 0;
    for (const [id, s] of this.store) {
      if (s.lead_id !== fromLeadId) continue;
      this.store.set(id, { ...s, lead_id: toLeadId });
      moved += 1;
    }
    return moved;
  }
```

Supabase (`lead-session.supabase.repo.ts`, siguiendo el estilo del archivo — mapRow existente):

```ts
  async listByLeadId(leadId: UUID): Promise<LeadSession[]> {
    if (!isUuid(leadId)) return [];
    const { data, error } = await this.db
      .from("lead_session")
      .select()
      .eq("lead_id", leadId)
      .order("started_at", { ascending: false });
    if (error) throw mapPostgrestError(error, { resource: "lead_session" });
    return (data ?? []).map(mapRow);
  }

  async reassignLead(fromLeadId: UUID, toLeadId: UUID): Promise<number> {
    const { data, error } = await this.db
      .from("lead_session")
      .update({ lead_id: toLeadId })
      .eq("lead_id", fromLeadId)
      .select();
    if (error) throw mapPostgrestError(error, { resource: "lead_session" });
    return (data ?? []).length;
  }
```

(Imports `isUuid` ya presentes en el archivo; verificar y ajustar. Si el `update` interno del repo Supabase valida el patch contra campos prohibidos, `reassignLead` NO pasa por ese camino — es query directa, correcto por diseño.)

- [ ] **Step 4: Unit verde** — `npx vitest run tests/unit` → PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/repositories/lead-session.contract.ts src/server/repositories/lead-session.repo.ts src/server/repositories/lead-session.supabase.repo.ts
git commit -m "feat(repo): listByLeadId + reassignLead en lead-session"
```

---

### Task 3: `leads.delete` + migración policy DELETE + baja de `mergeInto`

Contrato §0: no hay policy DELETE en leads (verificado — el delete del perdedor fallaría silencioso con client authed). `mergeInto` queda obsoleto (el executor T5 lo descompone) → se elimina (anti dead-code).

**Skills:** `superpowers:test-driven-development`, `supabase:supabase`, `supabase:supabase-postgres-best-practices`.

**Files:**

- Create: `supabase/migrations/<timestamp>_leads_delete_admin.sql` (timestamp real `date +%Y%m%d%H%M%S`)
- Modify: `src/server/repositories/leads.repo.ts` + `leads.supabase.repo.ts` (delete; quitar mergeInto)
- Modify: `tests/repositories/leads.contract.ts` (tests delete; quitar tests mergeInto)
- Modify: quien importe `mergeInto` (verificar: `grep -rn "mergeInto" src/ tests/` — si aparece fuera de repos+contract, NEEDS_CONTEXT antes de borrar)

**Interfaces:**

- Produces: `delete(id: UUID): Promise<void>` — no-op si id inexistente (replay-safe); con client authed y RLS denegando → `PermissionDeniedError` (probe findById, patrón `update` de productos fase 9). `mergeInto` DEJA de existir.

- [ ] **Step 1: Failing contract tests**

```ts
test("delete borra y es no-op si no existe (replay-safe)", async () => {
  const l = await repo.create(baseInsert({ telefono: "+5491100000009" }));
  await repo.delete(l.id);
  expect(await repo.findById(l.id)).toBeNull();
  await expect(repo.delete(l.id)).resolves.toBeUndefined(); // replay
  await expect(repo.delete(crypto.randomUUID())).resolves.toBeUndefined();
});
```

Eliminar del contract los tests de `mergeInto` (localizar por nombre; suelen cubrir meta union + delete src — esa semántica pasa a `merge-executor.test.ts` en T5).

- [ ] **Step 2: Run fail** — `npx vitest run tests/unit/repositories` → FAIL.

- [ ] **Step 3: Implement + migración**

Interface: reemplazar la línea de `mergeInto` por:

```ts
  // Borra el lead (merge: perdedor post-reasignación). Id inexistente = no-op
  // (replay-safe). FK CASCADE limpia merge_candidates del lead.
  delete(id: UUID): Promise<void>;
```

InMemory:

```ts
  async delete(id: UUID): Promise<void> {
    this.store.delete(id);
  }
```

(borrar el método `mergeInto` completo de InMemory).

Supabase (borrar `mergeInto`; agregar):

```ts
  async delete(id: UUID): Promise<void> {
    if (!isUuid(id)) return;
    const { data, error } = await this.db.from("leads").delete().eq("id", id).select();
    if (error) throw mapPostgrestError(error, { resource: "lead" });
    if ((data ?? []).length === 0) {
      // 0 filas sin error: inexistente (ok, replay) O RLS DELETE filtró (vendedor).
      // SELECT es visible para ambos roles → si existe, fue RLS.
      const visible = await this.findById(id);
      if (visible) {
        throw new PermissionDeniedError(`delete de lead denegado por RLS: ${id}`);
      }
    }
  }
```

(import `PermissionDeniedError` de `@/lib/errors` si falta.)

Migración `supabase/migrations/<ts>_leads_delete_admin.sql`:

```sql
-- Merge de leads (fase 10): el executor borra el lead perdedor post-reasignación.
-- DELETE solo admin — vendedor no puede fusionar (backstop del gate de UI/action).
create policy leads_delete_admin on public.leads
  for delete to authenticated
  using ((select public.is_admin()));
```

Aplicar: `supabase db push --linked` (CLI ya linkeado; si pide confirmación usar `--yes`; si falla por red, reintentar 1 vez y si persiste reportar DONE_WITH_CONCERNS con el output).

- [ ] **Step 4: Verificaciones**

Run: `npx vitest run tests/unit && npm run typecheck` → PASS/0 errors.
Run: `supabase migration list --linked 2>&1 | tail -5` → la nueva migración figura aplicada.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/ tests/repositories/leads.contract.ts src/server/repositories/leads.repo.ts src/server/repositories/leads.supabase.repo.ts
git commit -m "feat(repo,db): leads.delete con policy admin y baja de mergeInto"
```

---

### Task 4: `types/leads.ts` + `LeadsService` (lista + detalle)

**Skills:** `superpowers:test-driven-development`.

**Files:**

- Create: `src/types/leads.ts`
- Create: `src/server/services/leads/leads.service.ts`
- Create: `src/server/services/leads/default-leads.service.ts`
- Test: `tests/unit/services/leads-service.test.ts`

**Interfaces:**

- Consumes: `LeadsRepository.list/findById` (T1), `LeadSessionRepository.listActive/listByLeadId` (T2), `TagsRepository.listByLead`, `MergeCandidatesRepository.list/findById`.
- Produces (`src/types/leads.ts` — types/ no importa de server/, interfaces manuales):

```ts
import type { Canal, TagSource } from "./domain";
import type { Lead, LeadSession, UUID } from "./entities";

export interface LeadListItem {
  leadId: UUID;
  nombre: string;
  telefono: string;
  canalOrigen: Canal;
  canales: Canal[]; // canal_origen + canales con meta_user_ids presentes (dedup)
  vehiculo: string; // "marca modelo anio" trim; "" si todo vacío
  sesionActiva: boolean;
  updatedAt: Date;
}

export interface LeadsPage {
  items: LeadListItem[];
  pendingPairs: number; // candidates pending totales (banner admin)
}

export interface LeadTagView {
  id: UUID;
  nombre: string;
  color: string;
  source: TagSource;
}

export interface DuplicadoPendiente {
  candidateId: UUID;
  otherLead: Lead;
  reasons: string[];
  score: number;
  createdAt: Date;
}

export interface LeadDetail {
  lead: Lead;
  tags: LeadTagView[];
  sesiones: LeadSession[]; // started_at DESC (orden del repo)
  sesionActiva: LeadSession | null;
  duplicados: DuplicadoPendiente[]; // pending que involucran al lead
}
```

- Service:

```ts
export interface LeadsListInput {
  q?: string;
  soloDuplicados?: boolean;
}

export interface LeadsService {
  /** Página /leads: todos los leads (cap 1000, orden repo updated_at DESC) + count pares pendientes. */
  listLeads(input?: LeadsListInput): Promise<LeadsPage>;
  /** Detalle /leads/[id]. NotFoundError si no existe. */
  getLeadDetail(leadId: UUID): Promise<LeadDetail>;
}
```

- [ ] **Step 1: Failing tests**

`tests/unit/services/leads-service.test.ts`:

```ts
import { beforeEach, describe, expect, test } from "vitest";
import { NotFoundError } from "@/lib/errors";
import { InMemoryLeadsRepository } from "@/server/repositories/leads.repo";
import { InMemoryLeadSessionRepository } from "@/server/repositories/lead-session.repo";
import { InMemoryMergeCandidatesRepository } from "@/server/repositories/merge-candidates.repo";
import { InMemoryTagsRepository } from "@/server/repositories/tags.repo";
import { DefaultLeadsService } from "@/server/services/leads/default-leads.service";
import type { LeadInsert } from "@/server/repositories/leads.repo";
import type { LeadSessionInsert } from "@/server/repositories/lead-session.repo";

let tel = 0;
function baseLead(overrides: Partial<LeadInsert> = {}): LeadInsert {
  tel += 1;
  return {
    nombre: "Lead Test",
    telefono: `+54911000${String(tel).padStart(4, "0")}`,
    email: null,
    direccion: null,
    vehiculo_marca: "Toyota",
    vehiculo_modelo: "Corolla",
    vehiculo_anio: 2018,
    vehiculo_motor: null,
    empresa_id: null,
    canal_origen: "wa",
    meta_user_ids: { wa: `wa-${tel}` },
    ...overrides,
  };
}

function baseSession(leadId: string): LeadSessionInsert {
  return {
    lead_id: leadId,
    current_stage: "consulta",
    urgencia: "media",
    consulta: "busca pastillas",
    producto_cotizado_id: null,
    codigo_interno: null,
    precio_cotizado: null,
    cantidad: null,
    bloqueador: null,
    comprobante_pago_url: null,
    metodo_pago: null,
    resultado: null,
    motivo_perdida: null,
    ia_pausada: false,
  };
}

describe("DefaultLeadsService", () => {
  let leads: InMemoryLeadsRepository;
  let sessions: InMemoryLeadSessionRepository;
  let candidates: InMemoryMergeCandidatesRepository;
  let tags: InMemoryTagsRepository;
  let svc: DefaultLeadsService;

  beforeEach(() => {
    leads = new InMemoryLeadsRepository();
    sessions = new InMemoryLeadSessionRepository();
    candidates = new InMemoryMergeCandidatesRepository();
    tags = new InMemoryTagsRepository();
    svc = new DefaultLeadsService({ leads, sessions, candidates, tags });
  });

  test("listLeads incluye TODOS los leads con badge sesionActiva y canales", async () => {
    const conActiva = await leads.create(baseLead({ meta_user_ids: { wa: "w1", ig: "i1" } }));
    const sinActiva = await leads.create(baseLead({ canal_origen: "ig", meta_user_ids: {} }));
    await sessions.create(baseSession(conActiva.id));

    const page = await svc.listLeads();
    expect(page.items).toHaveLength(2);
    const item = page.items.find((i) => i.leadId === conActiva.id);
    expect(item?.sesionActiva).toBe(true);
    expect(item?.canales.sort()).toEqual(["ig", "wa"]);
    expect(item?.vehiculo).toBe("Toyota Corolla 2018");
    const otro = page.items.find((i) => i.leadId === sinActiva.id);
    expect(otro?.sesionActiva).toBe(false);
    expect(otro?.canales).toEqual(["ig"]); // solo canal_origen
  });

  test("listLeads q delega al repo (trim + cap 100)", async () => {
    await leads.create(baseLead({ nombre: "Maria Fernanda" }));
    await leads.create(baseLead({ nombre: "Otro" }));
    const page = await svc.listLeads({ q: "  maria  " });
    expect(page.items).toHaveLength(1);
  });

  test("listLeads pendingPairs + soloDuplicados filtra a involucrados", async () => {
    const a = await leads.create(baseLead());
    const b = await leads.create(baseLead());
    await leads.create(baseLead()); // tercero, no involucrado
    await candidates.create({
      src_lead_id: a.id,
      dst_lead_id: b.id,
      similarity_score: 0.7,
      reasons: ["nombre_exacto"],
    });

    const page = await svc.listLeads({ soloDuplicados: true });
    expect(page.pendingPairs).toBe(1);
    expect(page.items.map((i) => i.leadId).sort()).toEqual([a.id, b.id].sort());
  });

  test("getLeadDetail arma ficha completa", async () => {
    const lead = await leads.create(baseLead());
    const other = await leads.create(baseLead({ nombre: "Duplicado Posible" }));
    const s1 = await sessions.create(baseSession(lead.id));
    await sessions.close(s1.id, { resultado: "perdido", motivo_perdida: "precio" });
    const s2 = await sessions.create(baseSession(lead.id)); // activa
    const tag = await tags.create({ nombre: "vip", color: "#ff0000", descripcion: null });
    await tags.assignToLead(lead.id, tag.id, "manual");
    const cand = await candidates.create({
      src_lead_id: lead.id,
      dst_lead_id: other.id,
      similarity_score: 1,
      reasons: ["manual"],
    });

    const d = await svc.getLeadDetail(lead.id);
    expect(d.lead.id).toBe(lead.id);
    expect(d.sesiones.map((s) => s.id)).toEqual([s2.id, s1.id]);
    expect(d.sesionActiva?.id).toBe(s2.id);
    expect(d.tags).toEqual([
      expect.objectContaining({ nombre: "vip", color: "#ff0000", source: "manual" }),
    ]);
    expect(d.duplicados).toHaveLength(1);
    expect(d.duplicados[0]?.candidateId).toBe(cand.id);
    expect(d.duplicados[0]?.otherLead.id).toBe(other.id);
  });

  test("getLeadDetail lead inexistente → NotFoundError", async () => {
    await expect(svc.getLeadDetail(crypto.randomUUID())).rejects.toBeInstanceOf(NotFoundError);
  });
});
```

- [ ] **Step 2: Run fail** — `npx vitest run tests/unit/services/leads-service.test.ts` → FAIL (módulo no existe).

- [ ] **Step 3: Implement**

`src/server/services/leads/leads.service.ts`:

```ts
import type { LeadDetail, LeadsPage } from "@/types/leads";
import type { UUID } from "@/types/entities";

export interface LeadsListInput {
  q?: string;
  soloDuplicados?: boolean;
}

export interface LeadsService {
  /**
   * Página /leads: TODOS los leads (cap 1000; orden updated_at DESC lo garantiza
   * el repo) + count de pares duplicados pendientes. `q` literal (trim, cap 100).
   * `soloDuplicados` filtra a leads involucrados en candidates pending.
   */
  listLeads(input?: LeadsListInput): Promise<LeadsPage>;

  /** Detalle /leads/[id]: ficha + tags + sesiones (DESC) + duplicados pendientes. NotFoundError si no existe. */
  getLeadDetail(leadId: UUID): Promise<LeadDetail>;
}
```

`src/server/services/leads/default-leads.service.ts`:

```ts
import { NotFoundError } from "@/lib/errors";
import type { LeadsRepository } from "@/server/repositories/leads.repo";
import type { LeadSessionRepository } from "@/server/repositories/lead-session.repo";
import type { MergeCandidatesRepository } from "@/server/repositories/merge-candidates.repo";
import type { TagsRepository } from "@/server/repositories/tags.repo";
import type { Canal } from "@/types/domain";
import type { Lead, UUID } from "@/types/entities";
import type { DuplicadoPendiente, LeadDetail, LeadListItem, LeadsPage } from "@/types/leads";
import type { LeadsListInput, LeadsService } from "./leads.service";

// Cap defensivo (patrón fase 9): sin paginación v1, la búsqueda acota.
const LIST_LIMIT = 1000;
const Q_MAX = 100;

export interface DefaultLeadsServiceDeps {
  leads: LeadsRepository;
  sessions: LeadSessionRepository;
  candidates: MergeCandidatesRepository;
  tags: TagsRepository;
}

function canalesDe(lead: Lead): Canal[] {
  const set = new Set<Canal>([lead.canal_origen]);
  for (const c of ["wa", "ig", "fb"] as const) {
    if (lead.meta_user_ids[c]) set.add(c);
  }
  return Array.from(set);
}

function vehiculoDe(lead: Lead): string {
  return [lead.vehiculo_marca, lead.vehiculo_modelo, lead.vehiculo_anio || ""]
    .map(String)
    .map((s) => s.trim())
    .filter(Boolean)
    .join(" ");
}

export class DefaultLeadsService implements LeadsService {
  constructor(private readonly deps: DefaultLeadsServiceDeps) {}

  async listLeads(input: LeadsListInput = {}): Promise<LeadsPage> {
    const q = input.q?.trim().slice(0, Q_MAX);
    const [rows, activas, pendientes] = await Promise.all([
      this.deps.leads.list({ q: q || undefined, limit: LIST_LIMIT }),
      this.deps.sessions.listActive(),
      this.deps.candidates.list({ status: "pending" }),
    ]);

    const activos = new Set(activas.map((s) => s.lead_id));
    const involucrados = new Set(pendientes.flatMap((c) => [c.src_lead_id, c.dst_lead_id]));

    let items: LeadListItem[] = rows.map((lead) => ({
      leadId: lead.id,
      nombre: lead.nombre,
      telefono: lead.telefono,
      canalOrigen: lead.canal_origen,
      canales: canalesDe(lead),
      vehiculo: vehiculoDe(lead),
      sesionActiva: activos.has(lead.id),
      updatedAt: lead.updated_at,
    }));

    if (input.soloDuplicados) {
      items = items.filter((i) => involucrados.has(i.leadId));
    }

    return { items, pendingPairs: pendientes.length };
  }

  async getLeadDetail(leadId: UUID): Promise<LeadDetail> {
    const lead = await this.deps.leads.findById(leadId);
    if (!lead) throw new NotFoundError(`lead no encontrado: ${leadId}`, "lead", leadId);

    const [tags, sesiones, pendientes] = await Promise.all([
      this.deps.tags.listByLead(leadId),
      this.deps.sessions.listByLeadId(leadId),
      this.deps.candidates.list({ status: "pending" }),
    ]);

    const propios = pendientes.filter((c) => c.src_lead_id === leadId || c.dst_lead_id === leadId);
    const duplicados: DuplicadoPendiente[] = [];
    for (const c of propios) {
      const otherId = c.src_lead_id === leadId ? c.dst_lead_id : c.src_lead_id;
      const otherLead = await this.deps.leads.findById(otherId);
      if (!otherLead) continue; // huérfano imposible por FK; defensa
      duplicados.push({
        candidateId: c.id,
        otherLead,
        reasons: c.reasons,
        score: c.similarity_score,
        createdAt: c.created_at,
      });
    }

    return {
      lead,
      tags: tags.map((t) => ({ id: t.id, nombre: t.nombre, color: t.color, source: t.source })),
      sesiones,
      sesionActiva: sesiones.find((s) => s.resultado === null) ?? null,
      duplicados,
    };
  }
}
```

- [ ] **Step 4: Verde** — `npx vitest run tests/unit/services/leads-service.test.ts && npm run typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/types/leads.ts src/server/services/leads/ tests/unit/services/leads-service.test.ts
git commit -m "feat(leads): LeadsService lista + detalle con duplicados"
```

---

### Task 5: `MergeExecutorService` — approve/reject/manual replay-safe

El corazón de la fase. Contrato addendum §2 completo (leerlo antes de codear).

**Skills:** `superpowers:test-driven-development`.

**Files:**

- Create: `src/server/services/leads/merge-executor.service.ts`
- Test: `tests/unit/services/merge-executor.test.ts`

**Interfaces:**

- Consumes: `LeadsRepository` (findById/update/delete — T1/T3), `LeadSessionRepository` (findActiveByLeadId/reassignLead — T2), `ConversationsRepository` (findByLeadId/update), `TagsRepository` (listByLead/assignToLead), `MergeCandidatesRepository` (findById/resolve/create), `AdminAuditService` (recordAction) + `ADMIN_ACTIONS.LEAD_MERGE` de `@/server/services/admin-audit.service`.
- Produces:

```ts
export interface ApproveMergeInput {
  candidateId: UUID;
  keepLeadId: UUID; // ganador; debe ser src o dst del candidate
  actorUserId: UUID | null;
}

export interface MergeExecutorService {
  approveMerge(input: ApproveMergeInput): Promise<{ ganadorId: UUID }>;
  rejectMerge(input: { candidateId: UUID; actorUserId: UUID | null }): Promise<void>;
  createManualCandidate(input: { leadId: UUID; otherLeadId: UUID }): Promise<MergeCandidate>;
}
```

- [ ] **Step 1: Failing tests**

`tests/unit/services/merge-executor.test.ts` (reusar helpers `baseLead`/`baseSession` con la misma forma que en `leads-service.test.ts` — copiar los helpers al archivo, cada test file es autónomo):

```ts
import { beforeEach, describe, expect, test } from "vitest";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { InMemoryAdminAuditRepository } from "@/server/repositories/admin-audit.repo";
import { InMemoryConversationsRepository } from "@/server/repositories/conversations.repo";
import { InMemoryLeadsRepository } from "@/server/repositories/leads.repo";
import { InMemoryLeadSessionRepository } from "@/server/repositories/lead-session.repo";
import { InMemoryMergeCandidatesRepository } from "@/server/repositories/merge-candidates.repo";
import { InMemoryTagsRepository } from "@/server/repositories/tags.repo";
import { DefaultAdminAuditService } from "@/server/services/admin-audit.service";
import { DefaultMergeExecutorService } from "@/server/services/leads/merge-executor.service";
// + helpers baseLead/baseSession (copiar de leads-service.test.ts)

describe("DefaultMergeExecutorService.approveMerge", () => {
  let leads: InMemoryLeadsRepository;
  let sessions: InMemoryLeadSessionRepository;
  let convs: InMemoryConversationsRepository;
  let tags: InMemoryTagsRepository;
  let candidates: InMemoryMergeCandidatesRepository;
  let auditRepo: InMemoryAdminAuditRepository;
  let svc: DefaultMergeExecutorService;

  beforeEach(() => {
    leads = new InMemoryLeadsRepository();
    sessions = new InMemoryLeadSessionRepository();
    convs = new InMemoryConversationsRepository();
    tags = new InMemoryTagsRepository();
    candidates = new InMemoryMergeCandidatesRepository();
    auditRepo = new InMemoryAdminAuditRepository();
    svc = new DefaultMergeExecutorService({
      leads,
      sessions,
      convs,
      tags,
      candidates,
      audit: new DefaultAdminAuditService(auditRepo),
    });
  });

  async function seedPair() {
    const ganador = await leads.create(
      baseLead({ nombre: "Juan", email: null, meta_user_ids: { wa: "w-ganador" } }),
    );
    const perdedor = await leads.create(
      baseLead({
        nombre: "Juan",
        email: "juan@mail.com",
        canal_origen: "ig",
        meta_user_ids: { ig: "i-perdedor", wa: "w-perdedor" },
      }),
    );
    const cand = await candidates.create({
      src_lead_id: perdedor.id,
      dst_lead_id: ganador.id,
      similarity_score: 0.7,
      reasons: ["nombre_exacto"],
    });
    return { ganador, perdedor, cand };
  }

  test("happy path: reasigna todo, rellena huecos, borra perdedor, audita primero", async () => {
    const { ganador, perdedor, cand } = await seedPair();
    const conv = await convs.upsertByCanalThread("ig", "thread-p", perdedor.id);
    const s = await sessions.create(baseSession(perdedor.id));
    await sessions.close(s.id, { resultado: "exito" });
    const tag = await tags.create({ nombre: "vip", color: "#ff0000", descripcion: null });
    await tags.assignToLead(perdedor.id, tag.id, "workflow");

    const r = await svc.approveMerge({
      candidateId: cand.id,
      keepLeadId: ganador.id,
      actorUserId: crypto.randomUUID(),
    });
    expect(r.ganadorId).toBe(ganador.id);

    // perdedor borrado
    expect(await leads.findById(perdedor.id)).toBeNull();
    // conv + sesión + tag reasignados
    expect((await convs.findById(conv.id))?.lead_id).toBe(ganador.id);
    expect((await sessions.listByLeadId(ganador.id)).map((x) => x.id)).toContain(s.id);
    expect((await tags.listByLead(ganador.id)).map((t) => t.nombre)).toContain("vip");
    // source preservado
    expect((await tags.listByLead(ganador.id))[0]?.source).toBe("workflow");
    // fill-nulls + meta union ganador prima
    const g = await leads.findById(ganador.id);
    expect(g?.email).toBe("juan@mail.com");
    expect(g?.meta_user_ids).toEqual({ wa: "w-ganador", ig: "i-perdedor" });
    // audit con snapshot
    const acciones = await auditRepo.list();
    expect(acciones).toHaveLength(1);
    expect(acciones[0]?.action).toBe("lead.merge");
    expect(acciones[0]?.payload).toMatchObject({
      ganador_id: ganador.id,
      perdedor: expect.objectContaining({ id: perdedor.id, telefono: perdedor.telefono }),
    });
  });

  test("campos no-null del ganador intocables", async () => {
    const ganador = await leads.create(baseLead({ nombre: "G", email: "g@mail.com" }));
    const perdedor = await leads.create(baseLead({ nombre: "G", email: "p@mail.com" }));
    const cand = await candidates.create({
      src_lead_id: perdedor.id,
      dst_lead_id: ganador.id,
      similarity_score: 1,
      reasons: ["manual"],
    });
    await svc.approveMerge({ candidateId: cand.id, keepLeadId: ganador.id, actorUserId: null });
    expect((await leads.findById(ganador.id))?.email).toBe("g@mail.com");
  });

  test("keepLeadId puede ser el src del candidate (admin elige dirección)", async () => {
    const { ganador, perdedor, cand } = await seedPair();
    // ojo: en seedPair el candidate es src=perdedor, dst=ganador. Acá elegimos al SRC como ganador.
    await svc.approveMerge({ candidateId: cand.id, keepLeadId: perdedor.id, actorUserId: null });
    expect(await leads.findById(ganador.id)).toBeNull();
    expect(await leads.findById(perdedor.id)).not.toBeNull();
  });

  test("ambas sesiones activas → ValidationError con copy exacto y CERO cambios", async () => {
    const { ganador, perdedor, cand } = await seedPair();
    await sessions.create(baseSession(ganador.id));
    await sessions.create(baseSession(perdedor.id));

    await expect(
      svc.approveMerge({ candidateId: cand.id, keepLeadId: ganador.id, actorUserId: null }),
    ).rejects.toThrow(
      "Ambos leads tienen sesión activa — cerrá una desde el inbox antes de fusionar.",
    );
    expect(await leads.findById(perdedor.id)).not.toBeNull();
    expect(await auditRepo.list()).toHaveLength(0); // validación corta ANTES del audit
  });

  test("solo el perdedor con activa → se mueve y sigue activa bajo el ganador", async () => {
    const { ganador, perdedor, cand } = await seedPair();
    const activa = await sessions.create(baseSession(perdedor.id));
    await svc.approveMerge({ candidateId: cand.id, keepLeadId: ganador.id, actorUserId: null });
    expect((await sessions.findActiveByLeadId(ganador.id))?.id).toBe(activa.id);
  });

  test("candidate ya resuelto → ConflictError; inexistente → NotFoundError", async () => {
    const { ganador, cand } = await seedPair();
    await candidates.resolve(cand.id, "rejected", null);
    await expect(
      svc.approveMerge({ candidateId: cand.id, keepLeadId: ganador.id, actorUserId: null }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      svc.approveMerge({
        candidateId: crypto.randomUUID(),
        keepLeadId: ganador.id,
        actorUserId: null,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  test("keepLeadId fuera del par → ValidationError", async () => {
    const { cand } = await seedPair();
    await expect(
      svc.approveMerge({
        candidateId: cand.id,
        keepLeadId: crypto.randomUUID(),
        actorUserId: null,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("DefaultMergeExecutorService.rejectMerge / createManualCandidate", () => {
  // mismo beforeEach que arriba (repetir setup)

  test("rejectMerge resuelve rejected; replay → ConflictError", async () => {
    const a = await leads.create(baseLead());
    const b = await leads.create(baseLead());
    const cand = await candidates.create({
      src_lead_id: a.id,
      dst_lead_id: b.id,
      similarity_score: 0.7,
      reasons: ["nombre_exacto"],
    });
    await svc.rejectMerge({ candidateId: cand.id, actorUserId: null });
    expect((await candidates.findById(cand.id))?.status).toBe("rejected");
    await expect(
      svc.rejectMerge({ candidateId: cand.id, actorUserId: null }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  test("createManualCandidate crea score 1 reasons manual; par pending duplicado → ConflictError; lead inexistente → NotFoundError", async () => {
    const a = await leads.create(baseLead());
    const b = await leads.create(baseLead());
    const c = await svc.createManualCandidate({ leadId: a.id, otherLeadId: b.id });
    expect(c.similarity_score).toBe(1);
    expect(c.reasons).toEqual(["manual"]);
    await expect(
      svc.createManualCandidate({ leadId: a.id, otherLeadId: b.id }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      svc.createManualCandidate({ leadId: a.id, otherLeadId: crypto.randomUUID() }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
```

(Verificar el nombre real de `InMemoryAdminAuditRepository` y su método de listado — Glob `src/server/repositories/admin-audit.repo.ts`; si la API difiere (p.ej. `list()` no existe), adaptar la aserción de audit al método real reportándolo en el report.)

- [ ] **Step 2: Run fail** — `npx vitest run tests/unit/services/merge-executor.test.ts` → FAIL.

- [ ] **Step 3: Implement**

`src/server/services/leads/merge-executor.service.ts`:

```ts
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { ADMIN_ACTIONS } from "@/server/services/admin-audit.service";
import type { AdminAuditService } from "@/server/services/admin-audit.service";
import type { ConversationsRepository } from "@/server/repositories/conversations.repo";
import type { LeadsRepository, LeadUpdate } from "@/server/repositories/leads.repo";
import type { LeadSessionRepository } from "@/server/repositories/lead-session.repo";
import type { MergeCandidatesRepository } from "@/server/repositories/merge-candidates.repo";
import type { TagsRepository } from "@/server/repositories/tags.repo";
import type { Lead, MergeCandidate, UUID } from "@/types/entities";

export interface ApproveMergeInput {
  candidateId: UUID;
  keepLeadId: UUID;
  actorUserId: UUID | null;
}

export interface MergeExecutorService {
  /**
   * Ejecuta el merge (contrato addendum §2.A). Orden replay-safe: valida →
   * audit → convs → sesiones → tags → campos → delete perdedor. Cada paso es
   * no-op/tolerante en re-ejecución; el registro permanente es admin_actions
   * (los candidates se autodestruyen por FK CASCADE al borrar el perdedor).
   */
  approveMerge(input: ApproveMergeInput): Promise<{ ganadorId: UUID }>;
  /** Rechaza el par — no se vuelve a proponer (detector respeta rejected, T6). */
  rejectMerge(input: { candidateId: UUID; actorUserId: UUID | null }): Promise<void>;
  /** Candidate manual (score 1, reasons ["manual"]) — mismo flujo de review. */
  createManualCandidate(input: { leadId: UUID; otherLeadId: UUID }): Promise<MergeCandidate>;
}

export interface DefaultMergeExecutorServiceDeps {
  leads: LeadsRepository;
  sessions: LeadSessionRepository;
  convs: ConversationsRepository;
  tags: TagsRepository;
  candidates: MergeCandidatesRepository;
  audit: AdminAuditService;
}

/** Huecos del ganador que el perdedor puede rellenar. NUNCA sobrescribe valores. */
function buildFillPatch(ganador: Lead, perdedor: Lead): LeadUpdate {
  const patch: LeadUpdate = {};
  if (ganador.email === null && perdedor.email !== null) patch.email = perdedor.email;
  if (ganador.direccion === null && perdedor.direccion !== null) {
    patch.direccion = perdedor.direccion;
  }
  if (ganador.vehiculo_motor === null && perdedor.vehiculo_motor !== null) {
    patch.vehiculo_motor = perdedor.vehiculo_motor;
  }
  if (ganador.empresa_id === null && perdedor.empresa_id !== null) {
    patch.empresa_id = perdedor.empresa_id;
  }
  if (ganador.vehiculo_marca.trim() === "" && perdedor.vehiculo_marca.trim() !== "") {
    patch.vehiculo_marca = perdedor.vehiculo_marca;
  }
  if (ganador.vehiculo_modelo.trim() === "" && perdedor.vehiculo_modelo.trim() !== "") {
    patch.vehiculo_modelo = perdedor.vehiculo_modelo;
  }
  if (ganador.vehiculo_anio === 0 && perdedor.vehiculo_anio !== 0) {
    patch.vehiculo_anio = perdedor.vehiculo_anio;
  }
  // Unión de identidades Meta: el ganador prima por canal.
  patch.meta_user_ids = { ...perdedor.meta_user_ids, ...ganador.meta_user_ids };
  return patch;
}

export class DefaultMergeExecutorService implements MergeExecutorService {
  constructor(private readonly deps: DefaultMergeExecutorServiceDeps) {}

  async approveMerge(input: ApproveMergeInput): Promise<{ ganadorId: UUID }> {
    // 1. Validaciones (todas ANTES de cualquier escritura)
    const candidate = await this.deps.candidates.findById(input.candidateId);
    if (!candidate) {
      throw new NotFoundError(
        `merge_candidate no encontrado: ${input.candidateId}`,
        "merge_candidate",
        input.candidateId,
      );
    }
    if (candidate.status !== "pending") {
      throw new ConflictError(`merge_candidate ya resuelto: ${candidate.id}`, "already_resolved");
    }
    if (input.keepLeadId !== candidate.src_lead_id && input.keepLeadId !== candidate.dst_lead_id) {
      throw new ValidationError("keepLeadId no pertenece al par del candidate");
    }
    const perdedorId =
      input.keepLeadId === candidate.src_lead_id ? candidate.dst_lead_id : candidate.src_lead_id;

    const [ganador, perdedor] = await Promise.all([
      this.deps.leads.findById(input.keepLeadId),
      this.deps.leads.findById(perdedorId),
    ]);
    if (!ganador || !perdedor) {
      throw new NotFoundError("lead del par no encontrado", "lead", perdedorId);
    }

    const [activaGanador, activaPerdedor] = await Promise.all([
      this.deps.sessions.findActiveByLeadId(ganador.id),
      this.deps.sessions.findActiveByLeadId(perdedor.id),
    ]);
    if (activaGanador && activaPerdedor) {
      throw new ValidationError(
        "Ambos leads tienen sesión activa — cerrá una desde el inbox antes de fusionar.",
      );
    }

    const tagsPerdedor = await this.deps.tags.listByLead(perdedor.id);

    // 2. Audit PRIMERO — registro permanente (candidates mueren por CASCADE en paso 7).
    await this.deps.audit.recordAction({
      actorUserId: input.actorUserId,
      action: ADMIN_ACTIONS.LEAD_MERGE,
      entityType: "lead",
      entityId: ganador.id,
      payload: {
        candidate_id: candidate.id,
        ganador_id: ganador.id,
        perdedor: { ...perdedor },
        perdedor_tags: tagsPerdedor.map((t) => ({ id: t.id, nombre: t.nombre, source: t.source })),
      },
    });

    // 3. Conversaciones → ganador (idempotente: re-run no encuentra nada del perdedor).
    const conversaciones = await this.deps.convs.findByLeadId(perdedor.id);
    for (const conv of conversaciones) {
      await this.deps.convs.update(conv.id, { lead_id: ganador.id });
    }

    // 4. Sesiones → ganador (0 movidas = no-op).
    await this.deps.sessions.reassignLead(perdedor.id, ganador.id);

    // 5. Tags → ganador (assignToLead idempotente; el perdedor se borra, sin remove).
    for (const t of tagsPerdedor) {
      await this.deps.tags.assignToLead(ganador.id, t.id, t.source, t.assigned_by ?? undefined);
    }

    // 6. Campos: rellenar huecos + unión meta_user_ids (re-run: huecos ya llenos = no-op).
    await this.deps.leads.update(ganador.id, buildFillPatch(ganador, perdedor));

    // 7. Delete perdedor (no-op si ya borrado; CASCADE limpia candidates del par).
    await this.deps.leads.delete(perdedor.id);

    return { ganadorId: ganador.id };
  }

  async rejectMerge(input: { candidateId: UUID; actorUserId: UUID | null }): Promise<void> {
    const candidate = await this.deps.candidates.findById(input.candidateId);
    if (!candidate) {
      throw new NotFoundError(
        `merge_candidate no encontrado: ${input.candidateId}`,
        "merge_candidate",
        input.candidateId,
      );
    }
    await this.deps.candidates.resolve(candidate.id, "rejected", input.actorUserId);
  }

  async createManualCandidate(input: { leadId: UUID; otherLeadId: UUID }): Promise<MergeCandidate> {
    const [a, b] = await Promise.all([
      this.deps.leads.findById(input.leadId),
      this.deps.leads.findById(input.otherLeadId),
    ]);
    if (!a || !b) {
      throw new NotFoundError(
        "lead no encontrado para candidate manual",
        "lead",
        input.otherLeadId,
      );
    }
    return this.deps.candidates.create({
      src_lead_id: input.leadId,
      dst_lead_id: input.otherLeadId,
      similarity_score: 1,
      reasons: ["manual"],
    });
  }
}
```

- [ ] **Step 4: Verde** — `npx vitest run tests/unit/services/merge-executor.test.ts && npx vitest run tests/unit && npm run typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/services/leads/merge-executor.service.ts tests/unit/services/merge-executor.test.ts
git commit -m "feat(leads): MergeExecutorService replay-safe con audit primero"
```

---

### Task 6: Detector respeta `rejected`

Contrato §2.B/invariante 5: hoy `recordCandidate` chequea solo `findPendingPair` → re-propondría un par rechazado. `approved` no puede sobrevivir (CASCADE) y `superseded` es re-proponible by design.

**Skills:** `superpowers:test-driven-development`.

**Files:**

- Modify: `src/server/services/lead-merge-detector.service.ts` (`recordCandidate`)
- Modify: test del detector (localizar con `Glob tests/**/*merge-detector*` o `*lead-merge*`; agregar 2 tests)

- [ ] **Step 1: Failing tests** (adaptar imports/helpers al archivo de test existente del detector):

```ts
test("recordCandidate no re-propone par rechazado", async () => {
  const created = await detector.recordCandidate(proposal);
  expect(created).not.toBeNull();
  await candidates.resolve(created!.id, "rejected", null);
  expect(await detector.recordCandidate(proposal)).toBeNull();
});

test("recordCandidate sí re-propone par superseded", async () => {
  const created = await detector.recordCandidate(proposal);
  await candidates.resolve(created!.id, "superseded", null);
  expect(await detector.recordCandidate(proposal)).not.toBeNull();
});
```

- [ ] **Step 2: Run fail** — el test `rejected` falla (hoy re-crea).

- [ ] **Step 3: Implement** — en `recordCandidate`, reemplazar el chequeo:

```ts
  async recordCandidate(proposal: CandidateProposal): Promise<MergeCandidate | null> {
    const existing = await this.candidates.findAnyPair(
      proposal.src_lead_id,
      proposal.dst_lead_id,
    );
    // pending = dedup; rejected = decisión humana, no insistir. approved no
    // sobrevive (CASCADE al borrar el perdedor); superseded es re-proponible.
    if (existing && (existing.status === "pending" || existing.status === "rejected")) {
      return null;
    }
    return this.candidates.create({
      src_lead_id: proposal.src_lead_id,
      dst_lead_id: proposal.dst_lead_id,
      similarity_score: proposal.similarity_score,
      reasons: proposal.reasons,
    });
  }
```

Nota: `findAnyPair` retorna UN registro del par — si existieran múltiples históricos (rejected viejo + superseded), la semántica del InMemory/Supabase actual devuelve el primero que matchee. Aceptado: post-CASCADE solo puede quedar a lo sumo un resuelto por par en la práctica; si el reviewer detecta un caso real donde esto muerde, escalar.

- [ ] **Step 4: Verde** — `npx vitest run tests/unit` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/services/lead-merge-detector.service.ts tests/
git commit -m "fix(leads): detector no re-propone pares rechazados"
```

---

### Task 7: Schemas + bootstrap + 4 Server Actions

**Skills:** `superpowers:test-driven-development`, `supabase:supabase`.

**Files:**

- Create: `src/lib/validation/leads.schema.ts`
- Create: `src/server/bootstrap/leads-bootstrap.ts`
- Create: `src/app/(panel)/leads/_actions/action-error.ts`
- Create: `src/app/(panel)/leads/_actions/approve-merge.action.ts`
- Create: `src/app/(panel)/leads/_actions/reject-merge.action.ts`
- Create: `src/app/(panel)/leads/_actions/create-manual-candidate.action.ts`
- Create: `src/app/(panel)/leads/_actions/search-leads.action.ts`
- Test: `tests/unit/leads-schema.test.ts`

**Interfaces:**

- Consumes: services T4/T5, `getCurrentRol`+`getAuthenticatedUser` (`@/server/auth/guards`, `@/server/auth/supabase-ssr`), `UUIDSchema`, `ActionResult` (`@/types/inbox`), repos Supabase (leads/lead-session/conversations/tags/merge-candidates/admin-audit — clases `Supabase*Repository` existentes), `DefaultAdminAuditService`.
- Produces:

```ts
// schemas
export const ApproveMergeSchema = z.object({ candidateId: UUIDSchema, keepLeadId: UUIDSchema });
export const RejectMergeSchema = z.object({ candidateId: UUIDSchema });
export const CreateManualCandidateSchema = z
  .object({ leadId: UUIDSchema, otherLeadId: UUIDSchema })
  .refine((d) => d.leadId !== d.otherLeadId, {
    message: "No podés marcar un lead como duplicado de sí mismo.",
  });
export const SearchLeadsSchema = z.object({ q: z.string().trim().min(1).max(100) });

// bootstrap
export function makeLeadsService(db: AppClient): LeadsService;
export function makeMergeExecutorService(db: AppClient): MergeExecutorService;
export async function getLeadsServiceForRequest(): Promise<LeadsService>;
export async function getMergeExecutorForRequest(): Promise<MergeExecutorService>;

// actions
approveMergeAction(raw: unknown): Promise<ActionResult>
rejectMergeAction(raw: unknown): Promise<ActionResult>
createManualCandidateAction(raw: unknown): Promise<ActionResult>
searchLeadsAction(raw: unknown): Promise<{ ok: true; items: LeadListItem[] } | { ok: false; error: string }>
```

- [ ] **Step 1: Failing schema tests** (`tests/unit/leads-schema.test.ts`):

```ts
import { describe, expect, test } from "vitest";
import {
  ApproveMergeSchema,
  CreateManualCandidateSchema,
  SearchLeadsSchema,
} from "@/lib/validation/leads.schema";

const uuidA = "6f9619ff-8b86-4d01-b42d-00cf4fc964ff";
const uuidB = "7f9619ff-8b86-4d01-b42d-00cf4fc964ff";

describe("leads schemas", () => {
  test("ApproveMergeSchema exige 2 uuids", () => {
    expect(ApproveMergeSchema.safeParse({ candidateId: uuidA, keepLeadId: uuidB }).success).toBe(
      true,
    );
    expect(ApproveMergeSchema.safeParse({ candidateId: "x", keepLeadId: uuidB }).success).toBe(
      false,
    );
  });

  test("CreateManualCandidateSchema rechaza self-pair", () => {
    expect(
      CreateManualCandidateSchema.safeParse({ leadId: uuidA, otherLeadId: uuidA }).success,
    ).toBe(false);
    expect(
      CreateManualCandidateSchema.safeParse({ leadId: uuidA, otherLeadId: uuidB }).success,
    ).toBe(true);
  });

  test("SearchLeadsSchema exige 1-100 chars trim", () => {
    expect(SearchLeadsSchema.safeParse({ q: "  " }).success).toBe(false);
    expect(SearchLeadsSchema.safeParse({ q: "a".repeat(101) }).success).toBe(false);
    expect(SearchLeadsSchema.parse({ q: "  ana " }).q).toBe("ana");
  });
});
```

- [ ] **Step 2: Run fail**, luego **Step 3: Implement**

`src/lib/validation/leads.schema.ts`: el bloque "Produces" (+ header comment "Inputs Server Actions leads (fase 10). Regla §0.9.3: parse línea 1." + types `z.infer` exportados: `ApproveMergeInput`… nombrarlos `ApproveMergeFormInput` para no colisionar con el input del service que agrega actorUserId).

`src/server/bootstrap/leads-bootstrap.ts`:

```ts
import { createSupabaseServerClient } from "@/server/auth/supabase-ssr";
import { SupabaseAdminAuditRepository } from "@/server/repositories/admin-audit.supabase.repo";
import { SupabaseConversationsRepository } from "@/server/repositories/conversations.supabase.repo";
import { SupabaseLeadSessionRepository } from "@/server/repositories/lead-session.supabase.repo";
import { SupabaseLeadsRepository } from "@/server/repositories/leads.supabase.repo";
import { SupabaseMergeCandidatesRepository } from "@/server/repositories/merge-candidates.supabase.repo";
import { SupabaseTagsRepository } from "@/server/repositories/tags.supabase.repo";
import { DefaultAdminAuditService } from "@/server/services/admin-audit.service";
import { DefaultLeadsService } from "@/server/services/leads/default-leads.service";
import { DefaultMergeExecutorService } from "@/server/services/leads/merge-executor.service";
import type { AppClient } from "@/server/db/client";
import type { LeadsService } from "@/server/services/leads/leads.service";
import type { MergeExecutorService } from "@/server/services/leads/merge-executor.service";

/** Composición pura (authed o service-role en tests). */
export function makeLeadsService(db: AppClient): LeadsService {
  return new DefaultLeadsService({
    leads: new SupabaseLeadsRepository(db),
    sessions: new SupabaseLeadSessionRepository(db),
    candidates: new SupabaseMergeCandidatesRepository(db),
    tags: new SupabaseTagsRepository(db),
  });
}

export function makeMergeExecutorService(db: AppClient): MergeExecutorService {
  return new DefaultMergeExecutorService({
    leads: new SupabaseLeadsRepository(db),
    sessions: new SupabaseLeadSessionRepository(db),
    convs: new SupabaseConversationsRepository(db),
    tags: new SupabaseTagsRepository(db),
    candidates: new SupabaseMergeCandidatesRepository(db),
    audit: new DefaultAdminAuditService(new SupabaseAdminAuditRepository(db)),
  });
}

/** Panel: client authed del request (RLS real). Uno por request. */
export async function getLeadsServiceForRequest(): Promise<LeadsService> {
  return makeLeadsService(await createSupabaseServerClient());
}

export async function getMergeExecutorForRequest(): Promise<MergeExecutorService> {
  return makeMergeExecutorService(await createSupabaseServerClient());
}
```

(Verificar nombres exactos de las clases `Supabase*Repository` con Glob — si alguno difiere, usar el real.)

`src/app/(panel)/leads/_actions/action-error.ts` (patrón fase 9, retorno estrechado):

```ts
import {
  ConflictError,
  DomainError,
  NotFoundError,
  PermissionDeniedError,
  ValidationError,
} from "@/lib/errors";
import { getLogger } from "@/lib/observability/get-logger";

const logger = getLogger({ scope: "leads-actions" });

/** Mapea errores de service a mensaje curado para toast (detalle técnico solo a logs). */
export function toActionError(e: unknown, accion: string): { ok: false; error: string } {
  if (e instanceof ConflictError) {
    return { ok: false, error: "Este par ya fue resuelto o ya existe. Refrescá la página." };
  }
  if (e instanceof NotFoundError) {
    return { ok: false, error: "Lead no encontrado. Refrescá la página." };
  }
  if (e instanceof ValidationError) {
    if (e.cause !== undefined) {
      logger.warn("validacion DB rechazo accion leads", { accion, code: e.code });
      return { ok: false, error: "Datos inválidos. Refrescá la página." };
    }
    return { ok: false, error: e.message };
  }
  if (e instanceof PermissionDeniedError) {
    logger.warn("permiso denegado en action leads", { accion, code: e.code });
    return { ok: false, error: "Solo un admin puede fusionar leads." };
  }
  if (e instanceof DomainError) {
    logger.warn("domain error en action leads", { accion, code: e.code, error: e.message });
    return { ok: false, error: "No se pudo completar la acción. Reintentá en unos segundos." };
  }
  logger.error("action leads inesperada falló", {
    accion,
    error: e instanceof Error ? e.message : String(e),
  });
  return { ok: false, error: "Error inesperado. Reintentá en unos segundos." };
}
```

`approve-merge.action.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { ApproveMergeSchema } from "@/lib/validation/leads.schema";
import { getCurrentRol } from "@/server/auth/guards";
import { getAuthenticatedUser } from "@/server/auth/supabase-ssr";
import { getMergeExecutorForRequest } from "@/server/bootstrap/leads-bootstrap";
import { toActionError } from "./action-error";
import type { ActionResult } from "@/types/inbox";

export async function approveMergeAction(raw: unknown): Promise<ActionResult> {
  const parsed = ApproveMergeSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Datos inválidos. Refrescá la página." };
  }
  if ((await getCurrentRol()) !== "admin") {
    return { ok: false, error: "Solo un admin puede fusionar leads." };
  }

  let ganadorId: string;
  try {
    const user = await getAuthenticatedUser();
    const svc = await getMergeExecutorForRequest();
    const r = await svc.approveMerge({
      candidateId: parsed.data.candidateId,
      keepLeadId: parsed.data.keepLeadId,
      actorUserId: user?.id ?? null,
    });
    ganadorId = r.ganadorId;
  } catch (e) {
    return toActionError(e, "approve-merge");
  }

  revalidatePath("/leads");
  revalidatePath(`/leads/${ganadorId}`);
  return { ok: true };
}
```

`reject-merge.action.ts` (mismo esqueleto: `RejectMergeSchema` → gate admin → `svc.rejectMerge({ candidateId, actorUserId })` → `revalidatePath("/leads")` — sin path de detalle porque ambos leads siguen existiendo; agregar también `revalidatePath` no es necesario por lead: el poller no existe acá, alcanza refresh del client).

`create-manual-candidate.action.ts` (esqueleto: `CreateManualCandidateSchema` → gate admin → `svc.createManualCandidate` → `revalidatePath(\`/leads/${parsed.data.leadId}\`)`).

`search-leads.action.ts`:

```ts
"use server";

import { SearchLeadsSchema } from "@/lib/validation/leads.schema";
import { getLeadsServiceForRequest } from "@/server/bootstrap/leads-bootstrap";
import { toActionError } from "./action-error";
import type { LeadListItem } from "@/types/leads";

export async function searchLeadsAction(
  raw: unknown,
): Promise<{ ok: true; items: LeadListItem[] } | { ok: false; error: string }> {
  const parsed = SearchLeadsSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Escribí al menos 1 carácter para buscar." };
  }
  try {
    const svc = await getLeadsServiceForRequest();
    const page = await svc.listLeads({ q: parsed.data.q });
    return { ok: true, items: page.items.slice(0, 10) };
  } catch (e) {
    return toActionError(e, "search-leads");
  }
}
```

- [ ] **Step 4: Gate** — `npx vitest run tests/unit && npm run typecheck && npm run lint` → verde.

- [ ] **Step 5: Commit**

```bash
git add src/lib/validation/leads.schema.ts src/server/bootstrap/leads-bootstrap.ts src/app/\(panel\)/leads/_actions/ tests/unit/leads-schema.test.ts
git commit -m "feat(leads): schemas + bootstrap + actions merge y busqueda"
```

---

### Task 8: UI 10.A — `/leads` lista + búsqueda + banner

**Skills:** `vercel:nextjs`, `vercel:shadcn`, `frontend-design`.
**DEVIATION:** browser validation la corre el controller después de T9 (una sesión valida 10.A+10.B).

**Files:**

- Modify: `src/app/(panel)/leads/page.tsx` (reemplaza stub TODO)
- Create: `src/app/(panel)/leads/loading.tsx`
- Create: `src/components/leads/LeadsTable.tsx`
- Create: `src/components/leads/DuplicadosBanner.tsx`
- Delete: `src/app/api/leads/route.ts` (stub 501; verificar `grep -rn "api/leads" src/ tests/` sin refs externas a los stubs)

**Interfaces:**

- Consumes: `getLeadsServiceForRequest` (T7), `getCurrentRol` (existente), `LeadListItem`/`LeadsPage` (T4), `ChannelIcons` (`@/components/inbox/ChannelIcons` — props `{ activos: Canal[]; activoActual?: Canal }`), `Badge`, `Table/*`, `Input`, `EmptyState`, `RelativeTime` (`@/components/shared/RelativeTime` — verificar props con Read), `Form` de `next/form`.

- [ ] **Step 1: `LeadsTable`** (`src/components/leads/LeadsTable.tsx`, server component):

```tsx
import Link from "next/link";
import { Users } from "lucide-react";
import { ChannelIcons } from "@/components/inbox/ChannelIcons";
import { EmptyState } from "@/components/shared/EmptyState";
import { RelativeTime } from "@/components/shared/RelativeTime";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { LeadListItem } from "@/types/leads";

export function LeadsTable({ items, q }: { items: LeadListItem[]; q?: string }) {
  if (items.length === 0) {
    return q ? (
      <EmptyState
        title={`Sin resultados para «${q}»`}
        description="Probá con otro nombre o teléfono."
      />
    ) : (
      <EmptyState
        icon={<Users className="h-10 w-10" />}
        title="Sin leads todavía"
        description="Los leads se crean solos cuando un cliente escribe por WhatsApp, Instagram o Messenger."
      />
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Nombre</TableHead>
          <TableHead>Teléfono</TableHead>
          <TableHead>Canales</TableHead>
          <TableHead>Vehículo</TableHead>
          <TableHead>Estado</TableHead>
          <TableHead className="text-right">Actividad</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((l) => (
          <TableRow key={l.leadId}>
            <TableCell>
              <Link href={`/leads/${l.leadId}`} className="font-medium hover:underline">
                {l.nombre}
              </Link>
            </TableCell>
            <TableCell className="font-mono text-xs">{l.telefono}</TableCell>
            <TableCell>
              <ChannelIcons activos={l.canales} activoActual={l.canalOrigen} />
            </TableCell>
            <TableCell className="text-muted-foreground">{l.vehiculo || "—"}</TableCell>
            <TableCell>
              {l.sesionActiva ? (
                <Badge>Sesión activa</Badge>
              ) : (
                <span className="text-muted-foreground text-xs">—</span>
              )}
            </TableCell>
            <TableCell className="text-muted-foreground text-right text-xs">
              <RelativeTime date={l.updatedAt} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
```

(Verificar la prop real de `RelativeTime` con Read — si es `value`/`at` en lugar de `date`, usar la real.)

- [ ] **Step 2: `DuplicadosBanner`** (server):

```tsx
import Link from "next/link";
import { AlertTriangle } from "lucide-react";

export function DuplicadosBanner({ count, activo }: { count: number; activo: boolean }) {
  if (count === 0) return null;
  return (
    <div className="border-border flex items-center gap-2 border-b bg-amber-50 px-4 py-2 text-sm dark:bg-amber-950/30">
      <AlertTriangle className="h-4 w-4 text-amber-600" />
      <span>
        {count} {count === 1 ? "par duplicado pendiente" : "pares duplicados pendientes"}
      </span>
      <Link
        href={activo ? "/leads" : "/leads?duplicados=1"}
        className="text-amber-700 hover:underline dark:text-amber-400"
      >
        {activo ? "Ver todos los leads" : "Ver involucrados"}
      </Link>
    </div>
  );
}
```

- [ ] **Step 3: page + loading + delete stub**

`src/app/(panel)/leads/page.tsx`:

```tsx
import Form from "next/form";
import { DuplicadosBanner } from "@/components/leads/DuplicadosBanner";
import { LeadsTable } from "@/components/leads/LeadsTable";
import { Input } from "@/components/ui/input";
import { getCurrentRol } from "@/server/auth/guards";
import { getLeadsServiceForRequest } from "@/server/bootstrap/leads-bootstrap";

export const dynamic = "force-dynamic";

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[]; duplicados?: string | string[] }>;
}) {
  const params = await searchParams;
  // Param repetido o inválido → sin filtro, no error (patrón inbox/productos).
  const q = typeof params.q === "string" ? params.q : undefined;
  const soloDuplicados = typeof params.duplicados === "string" && params.duplicados === "1";

  const svc = await getLeadsServiceForRequest();
  const [rol, page] = await Promise.all([getCurrentRol(), svc.listLeads({ q, soloDuplicados })]);

  return (
    <div className="flex h-screen flex-col">
      <header className="border-border flex items-center justify-between gap-3 border-b px-4 py-3">
        <h1 className="text-lg font-semibold">Leads</h1>
        <span className="text-muted-foreground text-xs">{page.items.length} leads</span>
      </header>
      {rol === "admin" ? (
        <DuplicadosBanner count={page.pendingPairs} activo={soloDuplicados} />
      ) : null}
      <div className="border-border border-b px-4 py-2">
        <Form action="/leads">
          <Input
            type="search"
            name="q"
            defaultValue={q ?? ""}
            placeholder="Buscar por nombre o teléfono…"
            className="max-w-sm"
            aria-label="Buscar leads"
          />
        </Form>
      </div>
      <div className="flex-1 overflow-y-auto">
        <LeadsTable items={page.items} q={q?.trim() || undefined} />
      </div>
    </div>
  );
}
```

`loading.tsx`: skeleton 8 filas (copiar patrón `productos/loading.tsx` cambiando aria-label a "Cargando leads").

Delete stub: `grep -rn "api/leads/route\|api/leads\"" src/ tests/ --include='*.ts' --include='*.tsx'` → sin refs → `git rm src/app/api/leads/route.ts`.

- [ ] **Step 4: Gate** — `npm run typecheck && npm run lint && npx vitest run tests/unit` → verde.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(panel\)/leads/ src/components/leads/ && git rm -q src/app/api/leads/route.ts 2>/dev/null || true
git commit -m "feat(ui): fase 10.A lista leads con busqueda y banner duplicados"
```

---

### Task 9: UI 10.B — `/leads/[id]` detalle

**Skills:** `vercel:nextjs`, `vercel:shadcn`, `frontend-design`.
**DEVIATION:** browser validation del controller post-commit (10.A+10.B juntas).

**Files:**

- Modify: `src/app/(panel)/leads/[id]/page.tsx` (reemplaza stub)
- Create: `src/app/(panel)/leads/[id]/loading.tsx`
- Create: `src/components/leads/LeadFicha.tsx`
- Create: `src/components/leads/SesionesHistorial.tsx`
- Delete: `src/app/api/leads/[id]/route.ts` (stub 501; `pause-ia` NO se toca — no es de esta fase)

**Interfaces:**

- Consumes: `getLeadsServiceForRequest` (T7), `LeadDetail` (T4), `StageBadge` (`@/components/lead-twin/StageBadge` — verificar props), `ChannelIcons`, `Badge`, `RelativeTime`, `notFound` de `next/navigation`.
- Produces: `LeadFicha({ lead, tags })`, `SesionesHistorial({ sesiones })` — T10 agrega la sección duplicados a esta page.

- [ ] **Step 1: `LeadFicha`** (server):

```tsx
import { ChannelIcons } from "@/components/inbox/ChannelIcons";
import { Badge } from "@/components/ui/badge";
import type { Lead } from "@/types/entities";
import type { LeadTagView } from "@/types/leads";

function Campo({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="text-sm">{value?.trim() ? value : "—"}</span>
    </div>
  );
}

export function LeadFicha({ lead, tags }: { lead: Lead; tags: LeadTagView[] }) {
  const vehiculo = [lead.vehiculo_marca, lead.vehiculo_modelo, lead.vehiculo_anio || ""]
    .map(String)
    .map((s) => s.trim())
    .filter(Boolean)
    .join(" ");
  return (
    <section className="flex flex-col gap-4 p-4">
      <div className="flex items-center gap-3">
        <h2 className="text-xl font-semibold">{lead.nombre}</h2>
        <ChannelIcons activos={[]} activoActual={lead.canal_origen} />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Campo label="Teléfono" value={lead.telefono} />
        <Campo label="Email" value={lead.email} />
        <Campo label="Dirección" value={lead.direccion} />
        <Campo label="Vehículo" value={vehiculo || null} />
        <Campo label="Motor" value={lead.vehiculo_motor} />
      </div>
      {tags.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {tags.map((t) => (
            <Badge key={t.id} variant="outline" style={{ borderColor: t.color, color: t.color }}>
              {t.nombre}
            </Badge>
          ))}
        </div>
      ) : null}
    </section>
  );
}
```

- [ ] **Step 2: `SesionesHistorial`** (server):

```tsx
import { StageBadge } from "@/components/lead-twin/StageBadge";
import { RelativeTime } from "@/components/shared/RelativeTime";
import { Badge } from "@/components/ui/badge";
import type { LeadSession } from "@/types/entities";

const MOTIVO_LABEL: Record<string, string> = {
  precio: "Precio",
  stock: "Sin stock",
  tiempo: "Tiempos de entrega",
  no_responde: "No responde",
  otro: "Otro",
};

export function SesionesHistorial({ sesiones }: { sesiones: LeadSession[] }) {
  if (sesiones.length === 0) {
    return <p className="text-muted-foreground px-4 py-6 text-sm">Sin sesiones registradas.</p>;
  }
  return (
    <ul className="divide-border divide-y">
      {sesiones.map((s) => (
        <li key={s.id} className="flex items-center gap-3 px-4 py-3">
          <StageBadge stage={s.current_stage} />
          {s.resultado === null ? (
            <Badge>Activa</Badge>
          ) : (
            <Badge variant={s.resultado === "exito" ? "default" : "outline"}>
              {s.resultado === "exito" ? "Éxito" : "Perdido"}
            </Badge>
          )}
          {s.motivo_perdida ? (
            <span className="text-muted-foreground text-xs">
              {MOTIVO_LABEL[s.motivo_perdida] ?? s.motivo_perdida}
            </span>
          ) : null}
          <span className="text-muted-foreground ml-auto text-xs">
            <RelativeTime date={s.started_at} />
            {s.closed_at ? (
              <>
                {" "}
                · cerrada <RelativeTime date={s.closed_at} />
              </>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}
```

(Verificar props reales de `StageBadge`/`RelativeTime` con Read y ajustar.)

- [ ] **Step 3: page + loading + delete stub**

`src/app/(panel)/leads/[id]/page.tsx`:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { NotFoundError } from "@/lib/errors";
import { LeadFicha } from "@/components/leads/LeadFicha";
import { SesionesHistorial } from "@/components/leads/SesionesHistorial";
import { Button } from "@/components/ui/button";
import { getLeadsServiceForRequest } from "@/server/bootstrap/leads-bootstrap";
import type { LeadDetail } from "@/types/leads";

export const dynamic = "force-dynamic";

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let detail: LeadDetail;
  try {
    const svc = await getLeadsServiceForRequest();
    detail = await svc.getLeadDetail(id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }

  return (
    <div className="flex h-screen flex-col">
      <header className="border-border flex items-center gap-3 border-b px-4 py-3">
        <Link href="/leads" className="text-muted-foreground text-sm hover:underline">
          ← Leads
        </Link>
        <h1 className="text-lg font-semibold">{detail.lead.nombre}</h1>
        {detail.sesionActiva ? (
          <Button size="sm" render={<Link href={`/inbox/${detail.lead.id}`} />}>
            Abrir conversación
          </Button>
        ) : null}
      </header>
      <div className="flex-1 overflow-y-auto">
        <LeadFicha lead={detail.lead} tags={detail.tags} />
        <h3 className="border-border border-t px-4 pt-4 text-sm font-medium">
          Sesiones ({detail.sesiones.length})
        </h3>
        <SesionesHistorial sesiones={detail.sesiones} />
      </div>
    </div>
  );
}
```

Nota `Button render`: verificar que el Button del repo (Base UI) soporte `render` prop como DialogTrigger; si no, usar `<Link className={buttonVariants({ size: "sm" })}>` — mirar cómo lo resuelven components existentes (grep `buttonVariants` en src/components/).

`getLeadDetail` con id no-UUID: `LeadsRepository.findById` hace early-return null con `isUuid` → NotFoundError → notFound() ✓ sin crash.

`loading.tsx`: skeleton simple (header + 3 bloques pulse).

Delete stub: `git rm src/app/api/leads/[id]/route.ts` (verificar grep refs primero; `pause-ia/route.ts` queda).

- [ ] **Step 4: Gate** — `npm run typecheck && npm run lint && npx vitest run tests/unit` → verde.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(panel\)/leads/ src/components/leads/
git rm -q "src/app/api/leads/[id]/route.ts"
git commit -m "feat(ui): fase 10.B detalle lead con sesiones e inbox link"
```

**Post-T9 (controller):** validación browser 10.A+10.B (criterios addendum §5 items 1-3 + q hostil).

---

### Task 10: UI 10.C/D — review de duplicados + duplicado manual

**Skills:** `vercel:nextjs`, `vercel:shadcn`, `frontend-design`.
**DEVIATION:** validación E2E completa la corre el controller post-commit (con seed).

**Files:**

- Create: `src/components/leads/DuplicadosSection.tsx` (client)
- Create: `src/components/leads/MarcarDuplicadoDialog.tsx` (client)
- Modify: `src/app/(panel)/leads/[id]/page.tsx` (wire sección + botón, rol-aware)
- Delete: `src/app/api/leads/[id]/merge/route.ts` (stub 501)

**Interfaces:**

- Consumes: actions T7 (`approveMergeAction`, `rejectMergeAction`, `createManualCandidateAction`, `searchLeadsAction`), `DuplicadoPendiente`/`LeadListItem` (T4), `Dialog/*` Base UI (`DialogTrigger render={...}`), `Button`, `Input`, `toast`, `getCurrentRol` (page).

- [ ] **Step 1: `DuplicadosSection`**

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { Lead, UUID } from "@/types/entities";
import type { DuplicadoPendiente } from "@/types/leads";
import type { ActionResult } from "@/types/inbox";

function ResumenLead({
  lead,
  titulo,
}: {
  lead: Pick<Lead, "nombre" | "telefono">;
  titulo: string;
}) {
  return (
    <div className="flex flex-col gap-0.5 text-sm">
      <span className="text-muted-foreground text-xs">{titulo}</span>
      <span className="font-medium">{lead.nombre}</span>
      <span className="text-muted-foreground font-mono text-xs">{lead.telefono}</span>
    </div>
  );
}

export function DuplicadosSection({
  leadActual,
  duplicados,
  onApprove,
  onReject,
}: {
  leadActual: Pick<Lead, "id" | "nombre" | "telefono">;
  duplicados: DuplicadoPendiente[];
  onApprove: (input: { candidateId: UUID; keepLeadId: UUID }) => Promise<ActionResult>;
  onReject: (input: { candidateId: UUID }) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  // keep por candidate: default = lead actual.
  const [keepPorCandidate, setKeepPorCandidate] = useState<Record<string, UUID>>({});

  if (duplicados.length === 0) return null;

  const approve = (d: DuplicadoPendiente) => {
    const keepLeadId = keepPorCandidate[d.candidateId] ?? leadActual.id;
    startTransition(async () => {
      const r = await onApprove({ candidateId: d.candidateId, keepLeadId });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success("Leads fusionados — historia completa bajo el lead conservado.");
      if (keepLeadId === leadActual.id) router.refresh();
      else router.push(`/leads/${keepLeadId}`);
    });
  };

  const reject = (d: DuplicadoPendiente) => {
    startTransition(async () => {
      const r = await onReject({ candidateId: d.candidateId });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success("Par descartado — no se volverá a proponer.");
      router.refresh();
    });
  };

  return (
    <section className="border-border border-t px-4 py-4">
      <h3 className="text-sm font-medium">Posibles duplicados ({duplicados.length})</h3>
      <ul className="mt-2 flex flex-col gap-3">
        {duplicados.map((d) => {
          const keep = keepPorCandidate[d.candidateId] ?? leadActual.id;
          return (
            <li key={d.candidateId} className="border-border rounded-md border p-3">
              <div className="grid grid-cols-2 gap-3">
                <ResumenLead lead={leadActual} titulo="Este lead" />
                <ResumenLead lead={d.otherLead} titulo="Posible duplicado" />
              </div>
              <p className="text-muted-foreground mt-2 text-xs">
                Motivos: {d.reasons.join(", ")} · score {d.score}
              </p>
              <fieldset className="mt-2 flex flex-col gap-1 text-sm" disabled={isPending}>
                <legend className="text-muted-foreground text-xs">Conservar</legend>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name={`keep-${d.candidateId}`}
                    checked={keep === leadActual.id}
                    onChange={() =>
                      setKeepPorCandidate((m) => ({ ...m, [d.candidateId]: leadActual.id }))
                    }
                  />
                  {leadActual.nombre} (este)
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name={`keep-${d.candidateId}`}
                    checked={keep === d.otherLead.id}
                    onChange={() =>
                      setKeepPorCandidate((m) => ({ ...m, [d.candidateId]: d.otherLead.id }))
                    }
                  />
                  {d.otherLead.nombre}
                </label>
              </fieldset>
              <div className="mt-3 flex items-center gap-2">
                <Dialog>
                  <DialogTrigger render={<Button size="sm" disabled={isPending} />}>
                    Fusionar
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Fusionar leads</DialogTitle>
                      <DialogDescription>
                        Irreversible: el lead NO conservado se elimina y toda su historia
                        (conversaciones, sesiones, tags) pasa al conservado.
                      </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                      <Button variant="destructive" onClick={() => approve(d)} disabled={isPending}>
                        {isPending ? "Fusionando…" : "Confirmar fusión"}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
                <Button variant="outline" size="sm" onClick={() => reject(d)} disabled={isPending}>
                  Descartar
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
```

- [ ] **Step 2: `MarcarDuplicadoDialog`**

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { UUID } from "@/types/entities";
import type { LeadListItem } from "@/types/leads";
import type { ActionResult } from "@/types/inbox";

export function MarcarDuplicadoDialog({
  leadId,
  onSearch,
  onCreate,
}: {
  leadId: UUID;
  onSearch: (input: {
    q: string;
  }) => Promise<{ ok: true; items: LeadListItem[] } | { ok: false; error: string }>;
  onCreate: (input: { leadId: UUID; otherLeadId: UUID }) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [items, setItems] = useState<LeadListItem[]>([]);
  const [isPending, startTransition] = useTransition();

  const buscar = () => {
    startTransition(async () => {
      const r = await onSearch({ q });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      setItems(r.items.filter((i) => i.leadId !== leadId));
    });
  };

  const marcar = (otherLeadId: UUID) => {
    startTransition(async () => {
      const r = await onCreate({ leadId, otherLeadId });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success("Duplicado marcado — aparece en la lista de pendientes.");
      setOpen(false);
      setQ("");
      setItems([]);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        Marcar duplicado de…
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Marcar duplicado</DialogTitle>
          <DialogDescription>
            Buscá el otro lead que es la misma persona. El par queda pendiente de revisión.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && q.trim() && buscar()}
            placeholder="Nombre o teléfono…"
            disabled={isPending}
            aria-label="Buscar lead duplicado"
          />
          <Button onClick={buscar} disabled={isPending || q.trim() === ""} variant="outline">
            Buscar
          </Button>
        </div>
        {items.length > 0 ? (
          <ul className="divide-border max-h-60 divide-y overflow-y-auto">
            {items.map((i) => (
              <li key={i.leadId} className="flex items-center gap-2 py-2 text-sm">
                <div className="flex flex-col">
                  <span className="font-medium">{i.nombre}</span>
                  <span className="text-muted-foreground font-mono text-xs">{i.telefono}</span>
                </div>
                <Button
                  size="sm"
                  className="ml-auto"
                  onClick={() => marcar(i.leadId)}
                  disabled={isPending}
                >
                  Marcar
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Wire en detalle + delete stub**

En `src/app/(panel)/leads/[id]/page.tsx`: agregar `getCurrentRol` al Promise/await, imports de los 2 components + 4 actions, y:

- En el header, tras el botón inbox: `{isAdmin ? <MarcarDuplicadoDialog leadId={detail.lead.id} onSearch={searchLeadsAction} onCreate={createManualCandidateAction} /> : null}`
- Tras `<SesionesHistorial …/>`: `{isAdmin ? <DuplicadosSection leadActual={detail.lead} duplicados={detail.duplicados} onApprove={approveMergeAction} onReject={rejectMergeAction} /> : null}`

(Vendedor no ve nada de merge — criterio §5.9.)

Delete stub: `git rm "src/app/api/leads/[id]/merge/route.ts"` (grep refs antes).

- [ ] **Step 4: Gate** — `npm run typecheck && npm run lint && npx vitest run tests/unit` → verde.

- [ ] **Step 5: Commit**

```bash
git add src/components/leads/ src/app/\(panel\)/leads/
git rm -q "src/app/api/leads/[id]/merge/route.ts"
git commit -m "feat(ui): fase 10.D review merge + duplicado manual"
```

**Post-T10 (controller):** seed 2 leads duplicados con historia (script node service-role en scratchpad, lee keys de `.env.local` local — jamás al chat) + validación E2E completa criterios §5.4-5.10 + integration `npm run test:integration -- leads` y `-- lead-session` (cubre T1/T2/T3 contra Supabase real).

---

### Task 11: Cierre fase 10 — CI + docs + final review

**Skills:** `superpowers:verification-before-completion`.

- [ ] **Step 1:** `npm run ci` → verde (thresholds intactos).
- [ ] **Step 2:** Final whole-branch review (controller: review-package desde el commit previo al plan + dispatch modelo top con Minors acumulados del ledger).
- [ ] **Step 3:** Docs: AGENTS.md (§2 estado + tabla Slice 2 "vistas: 9-10 ✅" + métricas) + next-session.md (fase 10 ✅, próximo: contratos fase 11 → plan; backlog remanente). Commit `docs(agents,next-session): fase 10 leads completa`.
- [ ] **Step 4:** Push si el usuario lo aprueba.

---

## Self-review (ejecutado al escribir el plan)

1. **Cobertura addendum:** §0 assumptions → T1 (escape/orden), T2 (reassign/listBy), T3 (delete+policy+mergeInto), T6 (rejected) ✓ · §1 `/leads` → T4+T8 (orden repo, literal, cap, banner, columnas, estados) ✓ · §1 detalle → T4+T9 ✓ · §2.A approve → T5 (orden 1-7 exacto, copys verbatim) + T7 action ✓ · §2.B reject → T5+T6+T7 ✓ · §2.C manual → T5+T7+T10 ✓ · §3 estados → T8/T9 ✓ · §4 invariantes → tests T5 (no-borra: reasigna en happy path; audit-first: test doble-activa asserta 0 audit + orden código; rejected: T6) ✓ · §5 criterios → validaciones controller post-T9/T10 ✓.
2. **Placeholders:** cero TBD. Verificaciones delegadas marcadas explícitas (nombres de contract tests, props RelativeTime/StageBadge, clases Supabase\*, API InMemoryAdminAuditRepository, Button render) — cada una con instrucción de verificación + fallback NEEDS_CONTEXT.
3. **Consistencia de tipos:** `reassignLead(from,to): Promise<number>` idéntico T2/T5 · `LeadListItem`/`LeadDetail`/`DuplicadoPendiente` idénticos T4/T7/T8/T10 · firmas actions = props components (contravarianza raw:unknown OK, patrón fase 9 verificado) · `delete(id): Promise<void>` T3 = uso T5 ✓ · copys de error tabla addendum = action-error/executor verbatim ✓.

## Riesgos conocidos (aceptados)

- **Merge no transaccional** — orden replay-safe elegido por el usuario (addendum); crash intermedio deja perdedor vivo con menos historia y re-approve completa. Audit puede duplicarse en replay (append-only, aceptado).
- **`soloDuplicados` filtra post-fetch** sobre cap 1000 — si un involucrado quedara fuera del cap no aparece en el filtro; marginal con volúmenes pilot.
- **`findAnyPair` retorna un solo registro histórico por par** — suficiente post-CASCADE; documentado en T6.
- **Policy DELETE leads nueva** — vendedor pierde nada (nunca tuvo delete); admin gana delete solo vía merge (UI no expone delete directo).
