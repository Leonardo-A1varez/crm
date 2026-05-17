# Slice 2 Sub-paso 8.1 — Inbox Read-Only List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render `/inbox` con lista de leads que tienen sesión activa, ordenados por última actividad, mostrando nombre + último mensaje + stage + canales vinculados. Sin acciones todavía (sub-pasos posteriores). Layout panel con SideNav real (7 items).

**Architecture:** RSC en `inbox/page.tsx` fetch datos vía `InboxService` (facade) que orquesta repos existentes (`leads`, `lead-session`, `conversations`, `messages`). Service-role DbClient pre-auth Slice 3. Componentes server (`InboxList`, `InboxListItem`, `EmptyState`) + 1 client (`SideNav` con `usePathname`). Sin Server Actions, sin Realtime, sin polling — solo read.

**Tech Stack:** Next.js 16 RSC, Tailwind v4, shadcn/ui (`scroll-area`, `card`, `badge`), Vitest (TDD), Supabase service-role (pre-Slice 3).

---

## Spec reference

Design spec: `docs/superpowers/specs/2026-05-17-slice2-ui-core-design.md` §7 sub-paso 8.1.

---

## File structure

### New files

```
src/components/shared/EmptyState.tsx
src/components/shared/SideNav.tsx
src/components/inbox/InboxListItem.tsx
src/app/(panel)/inbox/loading.tsx
src/server/services/inbox/inbox.service.ts
src/server/services/inbox/default-inbox.service.ts
src/server/bootstrap/inbox-bootstrap.ts
tests/unit/inbox-service.test.ts
tests/unit/lead-session-list-active.test.ts
```

### Modified files

```
src/server/repositories/lead-session.repo.ts         (+listActive method on interface + InMemory impl)
src/server/repositories/lead-session.supabase.repo.ts (+listActive Supabase impl)
src/components/inbox/InboxList.tsx                   (replace stub with real impl)
src/components/inbox/ChatList.tsx                    (DELETE - reemplazado por InboxList)
src/app/(panel)/layout.tsx                           (integrate SideNav)
src/app/(panel)/inbox/page.tsx                       (RSC fetch + render)
tests/repositories/lead-session.contract.ts          (+listActive contract test)
tests/integration/lead-session.supabase.test.ts      (+listActive integration test, only if applicable)
```

### Reasoning

- **Service facade** (`InboxService`) keeps Action/Page thin and centralizes orchestration + future error mapping; matches existing `HandoffService`/`IntentClassifierService` pattern.
- **`listActive` on `LeadSessionRepository`** avoids loading all sessions then filtering in JS (Supabase real impl will be a single indexed query `WHERE resultado IS NULL`).
- **Bootstrap factory** (`makeInboxService`) mirrors `src/inngest/bootstrap.ts` pattern — single wireup point reusable across RSC pages.
- **`EmptyState` + `SideNav`** in `components/shared/` because they will be reused outside inbox (every panel route shows the nav; multiple views will need EmptyState).

---

## Task 1: Add `listActive` to LeadSessionRepository interface + InMemory impl (TDD)

**Files:**

- Modify: `src/server/repositories/lead-session.repo.ts`
- Create: `tests/unit/lead-session-list-active.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/unit/lead-session-list-active.test.ts`:

```ts
import { beforeEach, describe, expect, test } from "vitest";
import { InMemoryLeadSessionRepository } from "@/server/repositories/lead-session.repo";

describe("LeadSessionRepository.listActive (InMemory)", () => {
  let repo: InMemoryLeadSessionRepository;

  beforeEach(() => {
    repo = new InMemoryLeadSessionRepository();
  });

  test("returns empty when no sessions", async () => {
    const out = await repo.listActive();
    expect(out).toEqual([]);
  });

  test("returns only sessions where resultado IS NULL", async () => {
    const leadA = crypto.randomUUID();
    const leadB = crypto.randomUUID();
    const leadC = crypto.randomUUID();

    const sActive = await repo.create({
      lead_id: leadA,
      current_stage: "nuevo",
      urgencia: "media",
      consulta: "A",
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
    });
    const sClosed = await repo.create({
      lead_id: leadB,
      current_stage: "nuevo",
      urgencia: "media",
      consulta: "B",
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
    });
    await repo.close(sClosed.id, { resultado: "exito" });
    const sActive2 = await repo.create({
      lead_id: leadC,
      current_stage: "negociando",
      urgencia: "alta",
      consulta: "C",
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
    });

    const out = await repo.listActive();
    const ids = out.map((s) => s.id).sort();
    expect(ids).toEqual([sActive.id, sActive2.id].sort());
  });

  test("returns deep cloned sessions (mutation safe)", async () => {
    const leadA = crypto.randomUUID();
    await repo.create({
      lead_id: leadA,
      current_stage: "nuevo",
      urgencia: "media",
      consulta: "A",
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
      extras: { foo: { bar: 1 } },
    });

    const out = await repo.listActive();
    expect(out).toHaveLength(1);
    const extras = out[0]!.extras as { foo: { bar: number } };
    extras.foo.bar = 999;

    const out2 = await repo.listActive();
    const extras2 = out2[0]!.extras as { foo: { bar: number } };
    expect(extras2.foo.bar).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd C:\Users\Tinki\Proyectos\crm && npm test -- lead-session-list-active`

Expected: FAIL with `repo.listActive is not a function`.

- [ ] **Step 3: Add `listActive` to interface + InMemory impl**

In `src/server/repositories/lead-session.repo.ts`, modify the `LeadSessionRepository` interface to add a new method:

```ts
export interface LeadSessionRepository {
  create(input: LeadSessionInsert): Promise<LeadSession>;
  findById(id: UUID): Promise<LeadSession | null>;
  // Sesión activa = resultado IS NULL. Máx 1 por lead (partial unique).
  findActiveByLeadId(leadId: UUID): Promise<LeadSession | null>;
  // Todas sesiones activas (resultado IS NULL). Inbox listing.
  listActive(): Promise<LeadSession[]>;
  update(id: UUID, patch: LeadSessionUpdate): Promise<LeadSession>;
  close(id: UUID, input: CloseInput): Promise<LeadSession>;
  listClosedBefore(date: Date): Promise<LeadSession[]>;
}
```

Add the method to `InMemoryLeadSessionRepository` class (after `findActiveByLeadId`):

```ts
  async listActive(): Promise<LeadSession[]> {
    const out: LeadSession[] = [];
    for (const s of this.store.values()) {
      if (s.resultado === null) out.push(cloneSession(s));
    }
    return out;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd C:\Users\Tinki\Proyectos\crm && npm test -- lead-session-list-active`

Expected: PASS (3 tests).

- [ ] **Step 5: Run full suite to confirm no regression**

Run: `cd C:\Users\Tinki\Proyectos\crm && npm test`

Expected: all previous tests pass (587+ tests) plus the 3 new ones.

- [ ] **Step 6: Commit**

Run:

```powershell
cd C:\Users\Tinki\Proyectos\crm
git add src/server/repositories/lead-session.repo.ts tests/unit/lead-session-list-active.test.ts
git commit -m "feat(repo): LeadSessionRepository.listActive (InMemory) + 3 tests

Required by Slice 2 8.1 InboxService.listActiveLeads orchestration.
Supabase impl en Task 2 (commit separado).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2: Add `listActive` Supabase impl + contract test

**Files:**

- Modify: `src/server/repositories/lead-session.supabase.repo.ts`
- Modify: `tests/repositories/lead-session.contract.ts`

- [ ] **Step 1: Read existing Supabase impl to match style**

Run: `cd C:\Users\Tinki\Proyectos\crm && cat src/server/repositories/lead-session.supabase.repo.ts | head -80`

Note the patterns: PostgrestError mapping via `mapPostgrestError`, snake_case row → camelCase entity via `rowToSession` helper (or similar).

- [ ] **Step 2: Add contract test (runs against both InMemory + Supabase)**

Open `tests/repositories/lead-session.contract.ts` and add inside the existing `runLeadSessionContract` describe block (alongside other contract tests):

```ts
test("listActive returns only sessions where resultado IS NULL", async () => {
  const repo = makeRepo();
  const leadA = await fixtures.makeLeadId();
  const leadB = await fixtures.makeLeadId();

  await repo.create({
    lead_id: leadA,
    current_stage: "nuevo",
    urgencia: "media",
    consulta: "A",
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
  });
  const sB = await repo.create({
    lead_id: leadB,
    current_stage: "nuevo",
    urgencia: "media",
    consulta: "B",
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
  });
  await repo.close(sB.id, { resultado: "exito" });

  const out = await repo.listActive();
  const leads = out.map((s) => s.lead_id).sort();
  expect(leads).toContain(leadA);
  expect(leads).not.toContain(leadB);
});
```

Note: contract test signature uses `fixtures.makeLeadId()` to create FK rows. If the existing contract file uses a different fixture pattern, match what's already there (read the top of the file first).

- [ ] **Step 3: Run InMemory contract — should pass already (from Task 1)**

Run: `cd C:\Users\Tinki\Proyectos\crm && npm test -- lead-session`

Expected: InMemory passes, Supabase fails with `repo.listActive is not a function`.

- [ ] **Step 4: Add Supabase impl**

In `src/server/repositories/lead-session.supabase.repo.ts`, add the method to `SupabaseLeadSessionRepository` class (place alongside `findActiveByLeadId`):

```ts
  async listActive(): Promise<LeadSession[]> {
    const { data, error } = await this.db
      .from("lead_session")
      .select("*")
      .is("resultado", null)
      .order("started_at", { ascending: false });
    if (error) throw mapPostgrestError(error);
    return (data ?? []).map((row) => rowToSession(row));
  }
```

Note: replace `rowToSession` with the actual helper name used in the file (likely `mapRow` or `toEntity` — match what other methods use).

- [ ] **Step 5: Run integration tests against real Supabase**

Run: `cd C:\Users\Tinki\Proyectos\crm && npm run test:integration -- lead-session`

Expected: PASS (all existing tests + new listActive).

Requires `.env.local` with `SUPABASE_TEST_*` vars configured.

- [ ] **Step 6: Run full unit suite to confirm no regression**

Run: `cd C:\Users\Tinki\Proyectos\crm && npm test`

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
cd C:\Users\Tinki\Proyectos\crm
git add src/server/repositories/lead-session.supabase.repo.ts tests/repositories/lead-session.contract.ts
git commit -m "feat(repo): LeadSessionRepository.listActive Supabase impl + contract test

Index lead_session_resultado_partial cubre WHERE resultado IS NULL (B+).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3: Create InboxService interface + InboxItem type

**Files:**

- Create: `src/server/services/inbox/inbox.service.ts`

- [ ] **Step 1: Create dir + interface**

Create `src/server/services/inbox/inbox.service.ts`:

```ts
import type { Canal, CurrentStage, Direction } from "@/types/domain";
import type { UUID } from "@/types/entities";

/**
 * Item de inbox: lead con sesión activa + último mensaje + canales vinculados.
 * Forma derivada — no es entity DB. La orquestación vive en `DefaultInboxService`.
 */
export interface InboxItem {
  leadId: UUID;
  sessionId: UUID;
  nombre: string;
  currentStage: CurrentStage;
  iaPausada: boolean;
  ultimaActividad: Date;
  ultimoMensaje: {
    body: string;
    direction: Direction;
    createdAt: Date;
  } | null;
  canales: Canal[];
}

export interface InboxService {
  /**
   * Lista leads con sesión activa (resultado IS NULL), ordenados por última
   * actividad DESC. Enriquece con último mensaje de cualquier conversación del
   * lead y canales vinculados.
   */
  listActiveLeads(): Promise<InboxItem[]>;
}
```

- [ ] **Step 2: typecheck**

Run: `cd C:\Users\Tinki\Proyectos\crm && npm run typecheck`

Expected: 0 errors.

- [ ] **Step 3: Commit**

```powershell
cd C:\Users\Tinki\Proyectos\crm
git add src/server/services/inbox/inbox.service.ts
git commit -m "feat(svc): InboxService interface + InboxItem type

Facade orquestador para Inbox UI Slice 2 8.1.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4: DefaultInboxService.listActiveLeads (TDD)

**Files:**

- Create: `src/server/services/inbox/default-inbox.service.ts`
- Create: `tests/unit/inbox-service.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/unit/inbox-service.test.ts`:

```ts
import { beforeEach, describe, expect, test } from "vitest";
import { InMemoryLeadsRepository } from "@/server/repositories/leads.repo";
import { InMemoryLeadSessionRepository } from "@/server/repositories/lead-session.repo";
import { InMemoryConversationsRepository } from "@/server/repositories/conversations.repo";
import { InMemoryMessagesRepository } from "@/server/repositories/messages.repo";
import { DefaultInboxService } from "@/server/services/inbox/default-inbox.service";
import type { Lead } from "@/types/entities";

async function makeLead(
  repo: InMemoryLeadsRepository,
  overrides: Partial<Lead> = {},
): Promise<Lead> {
  return repo.create({
    nombre: overrides.nombre ?? "Lead Test",
    telefono: overrides.telefono ?? `+595981${Math.floor(Math.random() * 1_000_000)}`,
    email: null,
    direccion: null,
    vehiculo_marca: "Toyota",
    vehiculo_modelo: "Corolla",
    vehiculo_anio: 2018,
    vehiculo_motor: null,
    empresa_id: null,
    canal_origen: overrides.canal_origen ?? "wa",
    meta_user_ids: overrides.meta_user_ids ?? {},
  });
}

describe("DefaultInboxService.listActiveLeads", () => {
  let leads: InMemoryLeadsRepository;
  let sessions: InMemoryLeadSessionRepository;
  let convs: InMemoryConversationsRepository;
  let messages: InMemoryMessagesRepository;
  let svc: DefaultInboxService;

  beforeEach(() => {
    leads = new InMemoryLeadsRepository();
    sessions = new InMemoryLeadSessionRepository();
    convs = new InMemoryConversationsRepository();
    messages = new InMemoryMessagesRepository();
    svc = new DefaultInboxService({ leads, sessions, convs, messages });
  });

  test("returns empty array when no active sessions", async () => {
    const out = await svc.listActiveLeads();
    expect(out).toEqual([]);
  });

  test("returns 1 item per active session, enriched with lead + last msg + canales", async () => {
    const lead = await makeLead(leads, { nombre: "Juan Pérez" });
    const session = await sessions.create({
      lead_id: lead.id,
      current_stage: "cotizado",
      urgencia: "alta",
      consulta: "filtro de aceite Corolla 2018",
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
    });
    const conv = await convs.create({
      lead_id: lead.id,
      canal: "wa",
      canal_thread_id: "+595981000000",
    });
    const msg = await messages.create({
      conversacion_id: conv.id,
      lead_session_id: session.id,
      direction: "in",
      sender: "lead",
      sender_user_id: null,
      tipo: "text",
      contenido: "Hola, tienen el filtro?",
      media_url: null,
      meta_message_id: null,
      idempotency_key: null,
      metadata: {},
    });

    const out = await svc.listActiveLeads();
    expect(out).toHaveLength(1);
    const item = out[0]!;
    expect(item.leadId).toBe(lead.id);
    expect(item.sessionId).toBe(session.id);
    expect(item.nombre).toBe("Juan Pérez");
    expect(item.currentStage).toBe("cotizado");
    expect(item.iaPausada).toBe(false);
    expect(item.canales).toEqual(["wa"]);
    expect(item.ultimoMensaje?.body).toBe("Hola, tienen el filtro?");
    expect(item.ultimoMensaje?.direction).toBe("in");
    expect(item.ultimoMensaje?.createdAt.getTime()).toBe(msg.created_at.getTime());
  });

  test("sorts items by ultimaActividad DESC", async () => {
    const leadOld = await makeLead(leads, { nombre: "Old" });
    const leadNew = await makeLead(leads, { nombre: "New" });

    const sOld = await sessions.create({
      lead_id: leadOld.id,
      current_stage: "nuevo",
      urgencia: "media",
      consulta: "",
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
    });
    const cOld = await convs.create({
      lead_id: leadOld.id,
      canal: "wa",
      canal_thread_id: "old",
    });
    await messages.create({
      conversacion_id: cOld.id,
      lead_session_id: sOld.id,
      direction: "in",
      sender: "lead",
      sender_user_id: null,
      tipo: "text",
      contenido: "msg vieja",
      media_url: null,
      meta_message_id: null,
      idempotency_key: null,
      metadata: {},
    });
    // Tick clock para asegurar created_at orden estable
    await new Promise((r) => setTimeout(r, 5));

    const sNew = await sessions.create({
      lead_id: leadNew.id,
      current_stage: "nuevo",
      urgencia: "media",
      consulta: "",
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
    });
    const cNew = await convs.create({
      lead_id: leadNew.id,
      canal: "wa",
      canal_thread_id: "new",
    });
    await messages.create({
      conversacion_id: cNew.id,
      lead_session_id: sNew.id,
      direction: "in",
      sender: "lead",
      sender_user_id: null,
      tipo: "text",
      contenido: "msg nueva",
      media_url: null,
      meta_message_id: null,
      idempotency_key: null,
      metadata: {},
    });

    const out = await svc.listActiveLeads();
    expect(out.map((i) => i.nombre)).toEqual(["New", "Old"]);
  });

  test("merges canales when lead has multiple conversations", async () => {
    const lead = await makeLead(leads);
    const session = await sessions.create({
      lead_id: lead.id,
      current_stage: "nuevo",
      urgencia: "media",
      consulta: "",
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
    });
    await convs.create({ lead_id: lead.id, canal: "wa", canal_thread_id: "wa-1" });
    await convs.create({ lead_id: lead.id, canal: "ig", canal_thread_id: "ig-1" });

    const out = await svc.listActiveLeads();
    expect(out).toHaveLength(1);
    expect([...out[0]!.canales].sort()).toEqual(["ig", "wa"]);
    expect(out[0]!.sessionId).toBe(session.id);
  });

  test("ultimoMensaje is null when lead has no messages", async () => {
    const lead = await makeLead(leads);
    await sessions.create({
      lead_id: lead.id,
      current_stage: "nuevo",
      urgencia: "media",
      consulta: "",
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
    });
    await convs.create({ lead_id: lead.id, canal: "wa", canal_thread_id: "wa-1" });

    const out = await svc.listActiveLeads();
    expect(out).toHaveLength(1);
    expect(out[0]!.ultimoMensaje).toBeNull();
  });

  test("skips sessions whose lead row was deleted (defensive)", async () => {
    // Edge: en InMemory podemos forzar inconsistencia creando session sin lead
    // (Supabase tiene FK, pero defensive en service evita crash).
    const orphanLeadId = crypto.randomUUID();
    await sessions.create({
      lead_id: orphanLeadId,
      current_stage: "nuevo",
      urgencia: "media",
      consulta: "",
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
    });

    const out = await svc.listActiveLeads();
    expect(out).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd C:\Users\Tinki\Proyectos\crm && npm test -- inbox-service`

Expected: FAIL with `Cannot find module '@/server/services/inbox/default-inbox.service'`.

- [ ] **Step 3: Implement DefaultInboxService**

Create `src/server/services/inbox/default-inbox.service.ts`:

```ts
import type { ConversationsRepository } from "@/server/repositories/conversations.repo";
import type { LeadSessionRepository } from "@/server/repositories/lead-session.repo";
import type { LeadsRepository } from "@/server/repositories/leads.repo";
import type { MessagesRepository } from "@/server/repositories/messages.repo";
import type { Canal } from "@/types/domain";
import type { Mensaje } from "@/types/entities";
import type { InboxItem, InboxService } from "./inbox.service";

export interface DefaultInboxServiceDeps {
  leads: LeadsRepository;
  sessions: LeadSessionRepository;
  convs: ConversationsRepository;
  messages: MessagesRepository;
}

export class DefaultInboxService implements InboxService {
  constructor(private readonly deps: DefaultInboxServiceDeps) {}

  async listActiveLeads(): Promise<InboxItem[]> {
    const activeSessions = await this.deps.sessions.listActive();

    const items: InboxItem[] = [];
    for (const session of activeSessions) {
      const lead = await this.deps.leads.findById(session.lead_id);
      if (!lead) continue; // defensive: lead borrado pero session viva (edge)

      const convs = await this.deps.convs.findByLeadId(session.lead_id);
      const canales: Canal[] = Array.from(new Set(convs.map((c) => c.canal)));

      let lastMsg: Mensaje | null = null;
      for (const conv of convs) {
        const msgs = await this.deps.messages.listByConversacion(conv.id, { limit: 1 });
        const candidate = msgs[0];
        if (!candidate) continue;
        if (!lastMsg || candidate.created_at.getTime() > lastMsg.created_at.getTime()) {
          lastMsg = candidate;
        }
      }

      const ultimaActividad =
        lastMsg?.created_at ?? convs[0]?.ultima_actividad_at ?? session.started_at;

      items.push({
        leadId: lead.id,
        sessionId: session.id,
        nombre: lead.nombre,
        currentStage: session.current_stage,
        iaPausada: session.ia_pausada,
        ultimaActividad,
        ultimoMensaje: lastMsg
          ? {
              body: lastMsg.contenido ?? "",
              direction: lastMsg.direction,
              createdAt: lastMsg.created_at,
            }
          : null,
        canales,
      });
    }

    items.sort((a, b) => b.ultimaActividad.getTime() - a.ultimaActividad.getTime());
    return items;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd C:\Users\Tinki\Proyectos\crm && npm test -- inbox-service`

Expected: PASS (6 tests).

- [ ] **Step 5: Run full suite**

Run: `cd C:\Users\Tinki\Proyectos\crm && npm test`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
cd C:\Users\Tinki\Proyectos\crm
git add src/server/services/inbox/default-inbox.service.ts tests/unit/inbox-service.test.ts
git commit -m "feat(svc): DefaultInboxService.listActiveLeads + 6 tests

Orquesta leads + lead-session + conversations + messages para inbox UI.
Defensive skip leads borrados. Merge canales multi-conv. Sort ultima_actividad DESC.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 5: Bootstrap factory for runtime wireup

**Files:**

- Create: `src/server/bootstrap/inbox-bootstrap.ts`

- [ ] **Step 1: Inspect existing bootstrap pattern**

Run: `cd C:\Users\Tinki\Proyectos\crm && cat src/inngest/bootstrap.ts | head -60`

Note how Supabase repos are constructed from `dbFactory.serviceRole()`.

- [ ] **Step 2: Create bootstrap file**

Create `src/server/bootstrap/inbox-bootstrap.ts`:

```ts
import { SupabaseConversationsRepository } from "@/server/repositories/conversations.supabase.repo";
import { SupabaseLeadSessionRepository } from "@/server/repositories/lead-session.supabase.repo";
import { SupabaseLeadsRepository } from "@/server/repositories/leads.supabase.repo";
import { SupabaseMessagesRepository } from "@/server/repositories/messages.supabase.repo";
import { defaultDbClientFactory } from "@/server/db/client";
import { DefaultInboxService } from "@/server/services/inbox/default-inbox.service";
import type { InboxService } from "@/server/services/inbox/inbox.service";

/**
 * Construye InboxService real con repos Supabase service-role.
 *
 * Pre-Slice 3 (sin auth) usa service-role; cuando Slice 3 introduzca authed
 * client, swap a `dbFactory.authed(token)` aquí (1 línea).
 *
 * Singleton module-scope: 1 InboxService reusado entre requests RSC (Supabase
 * client maneja pool de conexiones).
 */
let cached: InboxService | null = null;

export function getInboxService(): InboxService {
  if (cached) return cached;
  const db = defaultDbClientFactory().serviceRole();
  cached = new DefaultInboxService({
    leads: new SupabaseLeadsRepository(db),
    sessions: new SupabaseLeadSessionRepository(db),
    convs: new SupabaseConversationsRepository(db),
    messages: new SupabaseMessagesRepository(db),
  });
  return cached;
}
```

- [ ] **Step 3: typecheck**

Run: `cd C:\Users\Tinki\Proyectos\crm && npm run typecheck`

Expected: 0 errors. If a Supabase repo constructor takes a different argument shape than `db`, check the actual signature: `cat src/server/repositories/leads.supabase.repo.ts | head -20` and adjust.

- [ ] **Step 4: Commit**

```powershell
cd C:\Users\Tinki\Proyectos\crm
git add src/server/bootstrap/inbox-bootstrap.ts
git commit -m "feat(bootstrap): getInboxService factory (Supabase service-role)

Singleton module-scope reusado entre RSC requests. Swap a authed client
en Slice 3.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 6: EmptyState shared component

**Files:**

- Create: `src/components/shared/EmptyState.tsx`

- [ ] **Step 1: Create component**

Create `src/components/shared/EmptyState.tsx`:

```tsx
import type { ReactNode } from "react";

export interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ title, description, icon, action }: EmptyStateProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      {icon ? <div className="text-muted-foreground">{icon}</div> : null}
      <h3 className="text-lg font-medium">{title}</h3>
      {description ? <p className="text-muted-foreground max-w-sm text-sm">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
```

- [ ] **Step 2: typecheck + lint**

Run: `cd C:\Users\Tinki\Proyectos\crm && npm run typecheck && npm run lint`

Expected: 0 errors.

- [ ] **Step 3: Commit**

```powershell
cd C:\Users\Tinki\Proyectos\crm
git add src/components/shared/EmptyState.tsx
git commit -m "feat(ui): EmptyState shared component

Reusable empty UI con title + description + icon + action opcionales.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 7: SideNav client component

**Files:**

- Create: `src/components/shared/SideNav.tsx`

- [ ] **Step 1: Verify lucide-react available**

Run: `cd C:\Users\Tinki\Proyectos\crm && node -e "console.log(require('./package.json').dependencies['lucide-react'])"`

Expected: prints a version string. If empty: install with `npm install lucide-react`.

- [ ] **Step 2: Create component**

Create `src/components/shared/SideNav.tsx`:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Inbox, Users, Package, Tag, Workflow, BarChart3, Settings } from "lucide-react";
import type { ComponentType } from "react";

interface NavItem {
  href: string;
  label: string;
  Icon: ComponentType<{ className?: string }>;
}

const ITEMS: readonly NavItem[] = [
  { href: "/inbox", label: "Inbox", Icon: Inbox },
  { href: "/leads", label: "Leads", Icon: Users },
  { href: "/productos", label: "Productos", Icon: Package },
  { href: "/intents-reglas", label: "Intents y reglas", Icon: Workflow },
  { href: "/tags", label: "Tags", Icon: Tag },
  { href: "/metricas", label: "Métricas", Icon: BarChart3 },
  { href: "/ajustes", label: "Ajustes", Icon: Settings },
];

export function SideNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Navegación principal" className="flex flex-col gap-1 p-2">
      {ITEMS.map(({ href, label, Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors " +
              (active
                ? "bg-accent text-accent-foreground font-medium"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground")
            }
          >
            <Icon className="h-4 w-4" />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 3: typecheck + lint**

Run: `cd C:\Users\Tinki\Proyectos\crm && npm run typecheck && npm run lint`

Expected: 0 errors.

- [ ] **Step 4: Commit**

```powershell
cd C:\Users\Tinki\Proyectos\crm
git add src/components/shared/SideNav.tsx
git commit -m "feat(ui): SideNav client component (7 nav items + active highlight)

usePathname para active state. lucide-react iconos.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 8: PanelLayout integrate SideNav

**Files:**

- Modify: `src/app/(panel)/layout.tsx`

- [ ] **Step 1: Modify layout**

Replace contents of `src/app/(panel)/layout.tsx`:

```tsx
import { SideNav } from "@/components/shared/SideNav";

export default function PanelLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <aside className="w-56 border-r">
        <div className="border-b p-4">
          <span className="text-base font-semibold">CRM Repuestos</span>
        </div>
        <SideNav />
      </aside>
      <main className="flex-1 overflow-hidden">{children}</main>
    </div>
  );
}
```

- [ ] **Step 2: typecheck + lint**

Run: `cd C:\Users\Tinki\Proyectos\crm && npm run typecheck && npm run lint`

Expected: 0 errors.

- [ ] **Step 3: Commit**

```powershell
cd C:\Users\Tinki\Proyectos\crm
git add "src/app/(panel)/layout.tsx"
git commit -m "feat(ui): PanelLayout integra SideNav + brand header

Sidebar 224px fijo + main scroll. Reemplaza stub TODO.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 9: InboxListItem component

**Files:**

- Create: `src/components/inbox/InboxListItem.tsx`

- [ ] **Step 1: Create component**

Create `src/components/inbox/InboxListItem.tsx`:

```tsx
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { InboxItem } from "@/server/services/inbox/inbox.service";

const STAGE_LABEL: Record<InboxItem["currentStage"], string> = {
  nuevo: "Nuevo",
  identificando: "Identificando",
  cotizado: "Cotizado",
  negociando: "Negociando",
  esperando_pago: "Esperando pago",
  cerrado: "Cerrado",
  perdido: "Perdido",
  requiere_humano: "Requiere humano",
};

const CANAL_DOT_CLASS: Record<"wa" | "ig" | "fb", string> = {
  wa: "bg-green-500",
  ig: "bg-pink-500",
  fb: "bg-blue-500",
};

function formatRelative(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "ahora";
  if (diffMin < 60) return `${diffMin}m`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h`;
  const diffD = Math.floor(diffH / 24);
  return `${diffD}d`;
}

export function InboxListItem({ item }: { item: InboxItem }) {
  return (
    <Link
      href={`/inbox/${item.leadId}`}
      className="hover:bg-accent block border-b px-4 py-3 transition-colors"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="truncate font-medium">{item.nombre}</span>
        <span className="text-muted-foreground shrink-0 text-xs">
          {formatRelative(item.ultimaActividad)}
        </span>
      </div>
      <div className="mt-1 flex items-center gap-2">
        <p className="text-muted-foreground flex-1 truncate text-sm">
          {item.ultimoMensaje
            ? `${item.ultimoMensaje.direction === "out" ? "Vos: " : ""}${item.ultimoMensaje.body}`
            : "Sin mensajes"}
        </p>
        <div className="flex items-center gap-1">
          {item.canales.map((c) => (
            <span
              key={c}
              aria-label={`Canal ${c}`}
              className={`h-2 w-2 rounded-full ${CANAL_DOT_CLASS[c]}`}
            />
          ))}
        </div>
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <Badge variant="secondary" className="text-xs">
          {STAGE_LABEL[item.currentStage]}
        </Badge>
        {item.iaPausada ? (
          <Badge variant="outline" className="text-xs">
            IA pausada
          </Badge>
        ) : null}
      </div>
    </Link>
  );
}
```

- [ ] **Step 2: typecheck + lint**

Run: `cd C:\Users\Tinki\Proyectos\crm && npm run typecheck && npm run lint`

Expected: 0 errors.

- [ ] **Step 3: Commit**

```powershell
cd C:\Users\Tinki\Proyectos\crm
git add src/components/inbox/InboxListItem.tsx
git commit -m "feat(ui): InboxListItem server component

Lead nombre + ultima_actividad relativa + ultimo_mensaje preview +
canales dots + stage badge + IA pausada badge.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 10: InboxList component (replace stub)

**Files:**

- Modify: `src/components/inbox/InboxList.tsx`

- [ ] **Step 1: Replace stub**

Replace contents of `src/components/inbox/InboxList.tsx`:

```tsx
import { ScrollArea } from "@/components/ui/scroll-area";
import { EmptyState } from "@/components/shared/EmptyState";
import { InboxListItem } from "./InboxListItem";
import { Inbox } from "lucide-react";
import type { InboxItem } from "@/server/services/inbox/inbox.service";

export function InboxList({ items }: { items: InboxItem[] }) {
  if (items.length === 0) {
    return (
      <EmptyState
        title="Esperando primer mensaje"
        description="Cuando llegue un mensaje vía WhatsApp, Instagram o Facebook, aparecerá acá. Verificá que el webhook Meta esté configurado."
        icon={<Inbox className="h-10 w-10" />}
      />
    );
  }
  return (
    <ScrollArea className="h-full">
      <ul aria-label="Bandeja de conversaciones">
        {items.map((item) => (
          <li key={item.leadId}>
            <InboxListItem item={item} />
          </li>
        ))}
      </ul>
    </ScrollArea>
  );
}
```

- [ ] **Step 2: typecheck + lint**

Run: `cd C:\Users\Tinki\Proyectos\crm && npm run typecheck && npm run lint`

Expected: 0 errors.

- [ ] **Step 3: Commit**

```powershell
cd C:\Users\Tinki\Proyectos\crm
git add src/components/inbox/InboxList.tsx
git commit -m "feat(ui): InboxList server component reemplaza stub

ScrollArea + ul + InboxListItem[]. EmptyState cuando 0 items.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 11: Delete ChatList stub (reemplazado por InboxList)

**Files:**

- Delete: `src/components/inbox/ChatList.tsx`

- [ ] **Step 1: Verify no remaining references**

Run: `cd C:\Users\Tinki\Proyectos\crm && npx tsc --noEmit 2>&1 | grep -i chatlist ; grep -r "ChatList" src --include="*.ts" --include="*.tsx"`

Expected: only the file itself defines `ChatList` (no consumers).

- [ ] **Step 2: Delete file**

```powershell
cd C:\Users\Tinki\Proyectos\crm
Remove-Item src/components/inbox/ChatList.tsx
```

- [ ] **Step 3: typecheck + lint**

Run: `cd C:\Users\Tinki\Proyectos\crm && npm run typecheck && npm run lint`

Expected: 0 errors.

- [ ] **Step 4: Commit**

```powershell
cd C:\Users\Tinki\Proyectos\crm
git add -u src/components/inbox/ChatList.tsx
git commit -m "chore(ui): delete ChatList stub (reemplazado por InboxList)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 12: loading.tsx skeleton

**Files:**

- Create: `src/app/(panel)/inbox/loading.tsx`

- [ ] **Step 1: Create**

Create `src/app/(panel)/inbox/loading.tsx`:

```tsx
export default function InboxLoading() {
  return (
    <div role="status" aria-label="Cargando inbox" className="divide-y">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="px-4 py-3">
          <div className="bg-muted h-4 w-1/3 animate-pulse rounded" />
          <div className="bg-muted mt-2 h-3 w-2/3 animate-pulse rounded" />
          <div className="bg-muted mt-2 h-3 w-16 animate-pulse rounded" />
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: typecheck + lint**

Run: `cd C:\Users\Tinki\Proyectos\crm && npm run typecheck && npm run lint`

Expected: 0 errors.

- [ ] **Step 3: Commit**

```powershell
cd C:\Users\Tinki\Proyectos\crm
git add "src/app/(panel)/inbox/loading.tsx"
git commit -m "feat(ui): inbox loading.tsx skeleton (6 placeholder rows)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 13: inbox/page.tsx RSC integration

**Files:**

- Modify: `src/app/(panel)/inbox/page.tsx`

- [ ] **Step 1: Replace stub with real impl**

Replace contents of `src/app/(panel)/inbox/page.tsx`:

```tsx
import { InboxList } from "@/components/inbox/InboxList";
import { getInboxService } from "@/server/bootstrap/inbox-bootstrap";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const items = await getInboxService().listActiveLeads();
  return (
    <div className="flex h-screen flex-col">
      <header className="border-b px-4 py-3">
        <h1 className="text-lg font-semibold">Bandeja</h1>
      </header>
      <div className="flex-1 overflow-hidden">
        <InboxList items={items} />
      </div>
    </div>
  );
}
```

`force-dynamic` evita prerender estático (pre-auth Slice 3 + datos transaccionales — siempre fresh).

- [ ] **Step 2: typecheck + lint**

Run: `cd C:\Users\Tinki\Proyectos\crm && npm run typecheck && npm run lint`

Expected: 0 errors.

- [ ] **Step 3: Run full unit test suite**

Run: `cd C:\Users\Tinki\Proyectos\crm && npm test`

Expected: PASS.

- [ ] **Step 4: Commit**

```powershell
cd C:\Users\Tinki\Proyectos\crm
git add "src/app/(panel)/inbox/page.tsx"
git commit -m "feat(ui): Slice 2 8.1 inbox/page RSC fetch + render

force-dynamic pre-auth Slice 3. Llama getInboxService().listActiveLeads()
y monta InboxList.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 14: Manual verification + final commit roll-up

**Files:** none code; validation only.

- [ ] **Step 1: Start dev servers**

In one terminal:

```powershell
cd C:\Users\Tinki\Proyectos\crm
npm run dev
```

Wait for `Ready in Xs` on port 3001 (or whatever shown).

In another terminal (optional, for webhook testing — not strictly required for 8.1 read-only):

```powershell
cd C:\Users\Tinki\Proyectos\crm
npm run inngest:dev
```

- [ ] **Step 2: Manual browser check — empty state**

If your `crm-dev` Supabase has zero active sessions, open `http://localhost:3001/inbox` and confirm:

- SideNav muestra 7 items, "Inbox" con highlight `bg-accent`.
- Brand "CRM Repuestos" en sidebar header.
- Centro de la página muestra `EmptyState` con título "Esperando primer mensaje" e ícono Inbox.

If your DB already has active sessions, skip this step (you'll see the populated state instead — that's fine).

- [ ] **Step 3: Manual browser check — populated state**

If DB has zero active sessions, insert a fixture via Supabase Studio (or any psql client) on `crm-dev`:

```sql
-- Lead
INSERT INTO leads (
  id, nombre, telefono, email, direccion,
  vehiculo_marca, vehiculo_modelo, vehiculo_anio, vehiculo_motor,
  empresa_id, canal_origen, meta_user_ids, created_at, updated_at
) VALUES (
  gen_random_uuid(),
  'Lead Demo 8.1',
  '+595981111111',
  NULL,
  NULL,
  'Toyota', 'Corolla', 2018, NULL,
  NULL, 'wa', '{}'::jsonb, now(), now()
) RETURNING id;
-- copia el UUID retornado para los siguientes inserts (reemplaza <LEAD_ID>)

-- Sesión activa
INSERT INTO lead_session (
  id, lead_id, current_stage, urgencia, consulta,
  producto_cotizado_id, codigo_interno, precio_cotizado, cantidad,
  bloqueador, comprobante_pago_url, metodo_pago, resultado, motivo_perdida,
  ia_pausada, extras, context_summary, started_at, closed_at
) VALUES (
  gen_random_uuid(),
  '<LEAD_ID>',
  'cotizado', 'media', 'filtro de aceite',
  NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
  false, '{}'::jsonb, NULL, now(), NULL
);

-- Conversación
INSERT INTO conversaciones (id, lead_id, canal, canal_thread_id, ultima_actividad_at)
VALUES (gen_random_uuid(), '<LEAD_ID>', 'wa', '+595981111111', now())
RETURNING id;
-- copia el UUID de la conversación (reemplaza <CONV_ID>) y de la sesión (<SESSION_ID>)

-- Mensaje inbound
INSERT INTO mensajes (
  id, conversacion_id, lead_session_id, direction, sender, sender_user_id,
  tipo, contenido, media_url, meta_message_id, idempotency_key, metadata, created_at
) VALUES (
  gen_random_uuid(),
  '<CONV_ID>',
  '<SESSION_ID>',
  'in', 'lead', NULL,
  'text', 'Hola, necesito filtro de aceite Corolla 2018',
  NULL, NULL, NULL, '{}'::jsonb, now()
);
```

Refresh `http://localhost:3001/inbox` and confirm:

- 1 item con nombre "Lead Demo 8.1".
- Stage badge "Cotizado".
- Preview "Hola, necesito filtro de aceite Corolla 2018".
- Dot verde (canal WA).
- "Inbox" highlight en SideNav.
- Click → navega a `/inbox/<LEAD_ID>` (mostrará el stub viejo TODO; eso es esperado, sub-paso 8.2 reemplaza).

- [ ] **Step 4: Run full CI locally**

Run: `cd C:\Users\Tinki\Proyectos\crm && npm run ci`

Expected: typecheck + lint + format:check + test:coverage todos PASS. Coverage threshold 80/75/80/80 cumplido.

- [ ] **Step 5: Verify clean working tree**

Run: `cd C:\Users\Tinki\Proyectos\crm && git status`

Expected: `nothing to commit, working tree clean`.

- [ ] **Step 6: Push (only if user explicitly authorizes)**

Per regla §0.6, no push automático. Pedir confirmación user antes de:

```powershell
cd C:\Users\Tinki\Proyectos\crm
git push
```

---

## Self-review checklist (writing-plans skill internal step)

- ✅ Spec §7 sub-paso 8.1 coverage: layout, SideNav, InboxService.listActiveLeads, inbox/page RSC, InboxList, InboxListItem, loading.tsx, EmptyState, tests service → todos cubiertos en Tasks 1-14.
- ✅ No placeholders ("TBD", "TODO" en plan, "implement later"): código completo en cada step.
- ✅ Type consistency: `InboxItem` shape consistente entre `inbox.service.ts`, `default-inbox.service.ts`, tests, `InboxListItem.tsx`.
- ✅ TDD aplicado: Tasks 1, 4 (red → green → commit).
- ✅ Frequent commits: 13 commits incrementales (1 por task) + manual verify task (sin código).
- ✅ Exact file paths + exact commands.

---

## Out of scope (explícito — NO incluir en 8.1)

- Conversation view `/inbox/[leadId]` real (sub-paso 8.2).
- TwinPanel render (sub-paso 8.3).
- MessageInput + send-message Server Action (sub-paso 8.4).
- HandoffToggle + CloseSessionButton (sub-paso 8.5).
- ConversationPoller polling 5s (sub-paso 8.6).
- ChannelTabs filter (sub-paso 8.7).
- Sentry/observability hooks UI (Slice 1 7.7.B+).
- Auth middleware (Slice 3).
- Realtime Supabase (Slice 3).
- Tests UI con RTL + axe (decisión diferible Slice 2 final).

---

**FIN PLAN 8.1.**
