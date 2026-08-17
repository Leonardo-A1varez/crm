# Métricas: ventas, demanda de catálogo y campañas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cerrar los KPIs bloqueados de la pantalla Métricas (ventas realizadas, ticket promedio, códigos más vendidos, repuestos más preguntados, tiempo en cerrar, por qué se escaló a humano) y preparar el schema de campañas para atribución futura de Meta.

**Architecture:** Capas existentes sin romper el patrón: `metrics.repo.ts` trae filas flacas de `lead_session`/`tool_executions`, `default-metricas.service.ts` agrega en TypeScript (no en SQL), los paneles de React consumen el resultado. `campanias` es un subsistema chico y paralelo al de Tags (repo + service + Server Actions + modal), sin tocar el pipeline de mensajes.

**Tech Stack:** Next.js App Router (Server Components + Server Actions), Supabase/Postgres, Zod, Vitest.

## Global Constraints

- `precio_cotizado` es el **monto total** de la cotización, no unitario. `montoTotalUsd = sum(precio_cotizado)`, nunca `* cantidad`.
- "Venta realizada" = `lead_session.resultado = 'exito'`. Ninguna tabla de orden/factura nueva.
- `leads.campania_id` queda **nullable y sin ningún código que lo escriba** en este plan — es preparación de schema, no atribución real. El filtro por campaña en Métricas usa `leads.created_at` dentro de `[desde, hasta]` como proxy y la UI lo declara así.
- `lead_session` es 1 producto cotizado por sesión (sin carrito). "Códigos más vendidos" refleja "producto principal por venta", con nota visible en la UI.
- Español en UI/comentarios/commits. Identificadores de dominio en español (`ventas`, `codigosMasVendidos`), genéricos en inglés.
- `console.log` prohibido en `src/**` — usar `getLogger`.
- Server Actions: `Schema.parse`/`safeParse` como primera línea, siempre.
- No saltar capas: Action → Service → Repository → DB.
- Migraciones nuevas van con timestamp `YYYYMMDDHHMMSS_<nombre>.sql`, mayor al último (`20260816023108`).
- `npm run test:integration` sigue congelado (AGENTS.md lección 10) — los contract tests nuevos corren contra InMemory, no contra Postgres real. Decirlo en el cierre de pantalla.

---

## File Structure

**Nuevo:**

- `supabase/migrations/20260817120000_campanias_y_ventas.sql` — tabla `campanias`, columna `leads.campania_id`, RLS.
- `src/lib/validation/campanias.schema.ts` — Zod de las 3 Server Actions de campaña.
- `src/server/repositories/campanias.repo.ts` — interface + `InMemoryCampaniasRepository`.
- `src/server/repositories/campanias.supabase.repo.ts` — impl Supabase.
- `src/server/services/campanias/campanias-admin.service.ts` — CRUD con validación de negocio (rango de fechas).
- `src/server/bootstrap/campanias-bootstrap.ts` — composición del service.
- `src/app/(panel)/metricas/_actions/action-error.ts` — mapeo de errores, copiado del patrón de `/leads`.
- `src/app/(panel)/metricas/_actions/crear-campania.action.ts`
- `src/app/(panel)/metricas/_actions/editar-campania.action.ts`
- `src/app/(panel)/metricas/_actions/borrar-campania.action.ts`
- `src/components/metricas/TopLista.tsx` — lista genérica label/meta/valor, reusada por 3 secciones nuevas.
- `src/components/metricas/CampaniaFormDialog.tsx` — alta/edición, mismo patrón que `TagFormDialog`.
- `src/components/metricas/GestionCampanias.tsx` — modal con tabla de campañas + trigger de alta/edición/baja.
- `src/components/metricas/SelectorRango.tsx` — reemplaza los 3 `Link` fijos de `page.tsx`: atajos + rango libre + dropdown de campaña.
- `tests/repositories/campanias.contract.ts`
- `tests/unit/campanias-admin-service.test.ts`

**Modificado:**

- `src/types/metricas.ts` — `Ventas`, `ConteoCodigo`, campos nuevos en `Metricas`.
- `src/types/entities.ts` — entidad `Campania`.
- `src/server/repositories/metrics.repo.ts` — campos nuevos en `FilaSesionMetrica`/`FilaToolExecutionMetrica`, `listCampanias`.
- `src/server/repositories/metrics.supabase.repo.ts` — columnas nuevas en los `select()`, `listCampanias`.
- `src/server/services/metricas/metricas.service.ts` — `obtener(desde, hasta)` en vez de `obtener(dias, ahora?)`.
- `src/server/services/metricas/default-metricas.service.ts` — cálculo de `ventas`, `codigosMasVendidos`, `repuestosMasPreguntados`, `tiempoCierre`.
- `src/app/(panel)/metricas/page.tsx` — parseo de `desde`/`hasta`/`campania`, usa `SelectorRango`.
- `src/components/metricas/PanelTotal.tsx` — KPIs de ventas, secciones de códigos/repuestos.
- `src/components/metricas/PanelVendedores.tsx` — `razonesEscalado` real, ticket promedio real, tiempo en cerrar, fix de la tarjeta con dos fuentes.
- `tests/repositories/metrics.contract.ts` — casos nuevos.
- `tests/unit/metricas-service.test.ts` — casos nuevos.

---

## Task 1: Migración — `campanias` + `leads.campania_id`

**Files:**

- Create: `supabase/migrations/20260817120000_campanias_y_ventas.sql`

**Interfaces:**

- Produces: tabla `public.campanias(id, nombre, desde, hasta, created_at)`, columna `public.leads.campania_id uuid null`.

- [ ] **Step 1: Escribir la migración**

```sql
-- Campañas de marketing: ventana de fechas propia para filtrar Métricas.
-- `leads.campania_id` nace nullable y sin escritor: es el schema listo para
-- atribución real (ctwa_clid de Meta u otra) cuando se conecte ese lado.
-- Mientras tanto, Métricas filtra por campaña usando leads.created_at dentro
-- de [desde, hasta] como proxy — la UI lo declara así, no finge precisión.

create table public.campanias (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  desde timestamptz not null,
  hasta timestamptz not null,
  created_at timestamptz not null default now(),
  constraint campanias_nombre_len check (char_length(nombre) between 2 and 60),
  constraint campanias_rango_valido check (hasta > desde)
);

alter table public.campanias enable row level security;

-- R ambos / W admin, mismo patrón que tags (20260714124024_slice3_rls_policies.sql).
create policy campanias_select on public.campanias
  for select to authenticated
  using ((select public.is_admin()) or (select public.is_vendedor()));
create policy campanias_insert_admin on public.campanias
  for insert to authenticated
  with check ((select public.is_admin()));
create policy campanias_update_admin on public.campanias
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
create policy campanias_delete_admin on public.campanias
  for delete to authenticated
  using ((select public.is_admin()));

revoke all on table public.campanias from public, anon;
grant select, insert, update, delete on table public.campanias to authenticated;
grant all on table public.campanias to service_role;

alter table public.leads
  add column campania_id uuid references public.campanias(id) on delete set null;

comment on column public.leads.campania_id is
  'Atribución real de campaña (ctwa_clid u otro), poblada cuando el webhook de Meta la capture. NULL hoy: ningún código la escribe todavía.';
```

- [ ] **Step 2: Aplicar contra `crm-dev` con el MCP de Supabase**

Usar `apply_migration` (project ref del `.env.local`, `NEXT_PUBLIC_SUPABASE_URL`) con el contenido de arriba y `name: "campanias_y_ventas"`.

- [ ] **Step 3: Verificar que la tabla y la columna existen**

```sql
select column_name, is_nullable from information_schema.columns
where table_name = 'campanias' order by ordinal_position;

select column_name from information_schema.columns
where table_name = 'leads' and column_name = 'campania_id';
```

Expected: 5 columnas en `campanias` (`id, nombre, desde, hasta, created_at`), y `campania_id` presente en `leads`.

- [ ] **Step 4: Regenerar tipos y commitear**

```bash
npm run db:gen-types
git add supabase/migrations/20260817120000_campanias_y_ventas.sql src/server/db/types.gen.ts
git commit -m "feat(db): tabla campanias y leads.campania_id nullable"
```

---

## Task 2: `metrics.repo.ts` — campos nuevos + `listCampanias`

**Files:**

- Modify: `src/server/repositories/metrics.repo.ts`
- Test: `tests/repositories/metrics.contract.ts`

**Interfaces:**

- Consumes: nada nuevo (tipos propios).
- Produces: `FilaSesionMetrica.precio_cotizado: number | null`, `.codigo_interno: string | null`, `.closed_at: Date | null`; `FilaToolExecutionMetrica.args: { query?: string; marca?: string; modelo?: string } | null`; `FilaCampaniaMetrica { id: string; nombre: string; desde: Date; hasta: Date }`; `MetricsRepository.listCampanias(): Promise<FilaCampaniaMetrica[]>`.

- [ ] **Step 1: Extender los tipos de fila**

En `src/server/repositories/metrics.repo.ts`, modificar `FilaSesionMetrica` (después de `started_at`):

```ts
export interface FilaSesionMetrica {
  id: string;
  current_stage: CurrentStage;
  resultado: "exito" | "perdido" | null;
  motivo_perdida: string | null;
  started_at: Date;
  /** Monto TOTAL de la cotización, no unitario. null si no se cotizó nada. */
  precio_cotizado: number | null;
  codigo_interno: string | null;
  /** null mientras la sesión sigue abierta. */
  closed_at: Date | null;
}
```

Modificar `FilaToolExecutionMetrica`:

```ts
export interface FilaToolExecutionMetrica {
  tool_name: string;
  created_at: Date;
  error: string | null;
  /** Solo se usa para tool_name === 'buscar_repuesto'; null en el resto. */
  args: { query?: string; marca?: string; modelo?: string } | null;
}
```

Agregar después de `FilaLlmUsageMetrica`:

```ts
/** Campaña de marketing, solo lo que Métricas necesita para el filtro por fecha. */
export interface FilaCampaniaMetrica {
  id: string;
  nombre: string;
  desde: Date;
  hasta: Date;
}
```

Agregar a la interface `MetricsRepository` (junto a `listUsuarios`):

```ts
  /** Sin ventana: catálogo de campañas para el selector, no un evento del período. */
  listCampanias(): Promise<FilaCampaniaMetrica[]>;
```

Agregar `campanias?: FilaCampaniaMetrica[];` a `MetricsFixture`.

- [ ] **Step 2: Implementar en `InMemoryMetricsRepository`**

Agregar el campo privado `private readonly campanias: FilaCampaniaMetrica[];`, inicializarlo en el constructor (`this.campanias = fixture.campanias ?? [];`), y agregar el método:

```ts
  async listCampanias(): Promise<FilaCampaniaMetrica[]> {
    return this.campanias;
  }
```

Actualizar las fixtures de `sesiones`/`tools` existentes en los tests que construyan `FilaSesionMetrica`/`FilaToolExecutionMetrica` a mano si TypeScript se queja de campos faltantes — completar con `precio_cotizado: null, codigo_interno: null, closed_at: null` / `args: null` donde no aplique.

- [ ] **Step 3: `npm run typecheck` para encontrar todos los call sites rotos**

```bash
npm run typecheck
```

Expected: errores en `tests/unit/metricas-service.test.ts` y `tests/repositories/metrics.contract.ts` por los campos faltantes en los fixtures existentes — es esperado, se corrigen en el Task 8.

- [ ] **Step 4: Extender el contract test con `listCampanias`**

En `tests/repositories/metrics.contract.ts`, agregar un bloque (ubicar junto a los demás `describe` de listado simple, siguiendo el patrón de `listUsuarios`):

```ts
describe("listCampanias", () => {
  it("devuelve las campañas del fixture", async () => {
    const repo = makeRepo({
      campanias: [
        {
          id: "c1",
          nombre: "Lanzamiento verano",
          desde: new Date("2026-01-01"),
          hasta: new Date("2026-01-31"),
        },
      ],
    });
    const campanias = await repo.listCampanias();
    expect(campanias).toHaveLength(1);
    expect(campanias[0]?.nombre).toBe("Lanzamiento verano");
  });
});
```

- [ ] **Step 5: Correr el contract test contra InMemory**

```bash
npx vitest run tests/repositories/metrics.contract.ts -t "listCampanias"
```

Expected: PASS (una vez que Task 8 corrija los demás fixtures — si falla por otros casos, seguir a Task 8 antes de commitear este paso solo).

- [ ] **Step 6: Commit**

```bash
git add src/server/repositories/metrics.repo.ts tests/repositories/metrics.contract.ts
git commit -m "feat(metricas): campos de venta en FilaSesionMetrica y listCampanias"
```

---

## Task 3: `metrics.supabase.repo.ts` — columnas nuevas + `listCampanias`

**Files:**

- Modify: `src/server/repositories/metrics.supabase.repo.ts`

**Interfaces:**

- Consumes: `FilaSesionMetrica`, `FilaToolExecutionMetrica`, `FilaCampaniaMetrica`, `MetricsRepository` (Task 2).

- [ ] **Step 1: Extender `listSesionesDesde`**

En `src/server/repositories/metrics.supabase.repo.ts:30-43`, cambiar el `.select()` y el `.map()`:

```ts
  async listSesionesDesde(desde: Date): Promise<FilaSesionMetrica[]> {
    const { data, error } = await this.db
      .from("lead_session")
      .select(
        "id, current_stage, resultado, motivo_perdida, started_at, precio_cotizado, codigo_interno, closed_at",
      )
      .gte("started_at", desde.toISOString());
    if (error) throw mapPostgrestError(error, { resource: "lead_session" });
    return (data ?? []).map((r) => ({
      id: r.id,
      current_stage: r.current_stage as CurrentStage,
      resultado: r.resultado as "exito" | "perdido" | null,
      motivo_perdida: r.motivo_perdida,
      started_at: new Date(r.started_at),
      precio_cotizado:
        typeof r.precio_cotizado === "string" ? Number(r.precio_cotizado) : r.precio_cotizado,
      codigo_interno: r.codigo_interno,
      closed_at: r.closed_at ? new Date(r.closed_at) : null,
    }));
  }
```

`precio_cotizado` es `numeric` en Postgres — mismo riesgo de serialización como string que `costo_usd` (ya resuelto en `listLlmUsageDesde:127`), se normaliza igual acá.

- [ ] **Step 2: Extender `listToolExecutionsDesde`**

En `src/server/repositories/metrics.supabase.repo.ts:97-108`:

```ts
  async listToolExecutionsDesde(desde: Date): Promise<FilaToolExecutionMetrica[]> {
    const { data, error } = await this.db
      .from("tool_executions")
      .select("tool_name, created_at, error, args")
      .gte("created_at", desde.toISOString());
    if (error) throw mapPostgrestError(error, { resource: "tool_executions" });
    return (data ?? []).map((r) => ({
      tool_name: r.tool_name,
      created_at: new Date(r.created_at),
      error: r.error,
      args:
        r.tool_name === "buscar_repuesto" && r.args && typeof r.args === "object"
          ? (r.args as { query?: string; marca?: string; modelo?: string })
          : null,
    }));
  }
```

- [ ] **Step 3: Agregar `listCampanias`**

Al final de la clase, antes del cierre:

```ts
  async listCampanias(): Promise<FilaCampaniaMetrica[]> {
    const { data, error } = await this.db
      .from("campanias")
      .select("id, nombre, desde, hasta")
      .order("desde", { ascending: false });
    if (error) throw mapPostgrestError(error, { resource: "campanias" });
    return (data ?? []).map((r) => ({
      id: r.id,
      nombre: r.nombre,
      desde: new Date(r.desde),
      hasta: new Date(r.hasta),
    }));
  }
```

Agregar `FilaCampaniaMetrica` al bloque de imports de tipos al inicio del archivo.

- [ ] **Step 4: `npm run typecheck`**

```bash
npm run typecheck
```

Expected: 0 errores en este archivo.

- [ ] **Step 5: Commit**

```bash
git add src/server/repositories/metrics.supabase.repo.ts
git commit -m "feat(metricas): SupabaseMetricsRepository lee venta y args de tool_executions"
```

---

## Task 4: `campanias.repo.ts` — interface + InMemory

**Files:**

- Create: `src/server/repositories/campanias.repo.ts`
- Test: `tests/repositories/campanias.contract.ts`

**Interfaces:**

- Consumes: `Campania` (Task 5), `Insert`/`Update` de `./_types`.
- Produces: `CampaniasRepository { create, update, delete, list, findById }`, `InMemoryCampaniasRepository`.

- [ ] **Step 1: Escribir el archivo**

```ts
import { NotFoundError } from "@/lib/errors";
import type { Campania, UUID } from "@/types/entities";
import type { Insert, Update } from "./_types";

export type CampaniaInsert = Insert<Campania, "id" | "created_at">;
export type CampaniaUpdate = Update<Campania, "id" | "created_at">;

export interface CampaniasRepository {
  create(input: CampaniaInsert): Promise<Campania>;
  findById(id: UUID): Promise<Campania | null>;
  update(id: UUID, patch: CampaniaUpdate): Promise<Campania>;
  list(): Promise<Campania[]>;
  /** Idempotente: borrar una inexistente no es error. `leads.campania_id` cae a null por la FK. */
  delete(id: UUID): Promise<void>;
}

export class InMemoryCampaniasRepository implements CampaniasRepository {
  private readonly campanias = new Map<UUID, Campania>();

  async create(input: CampaniaInsert): Promise<Campania> {
    const campania: Campania = { ...input, id: crypto.randomUUID(), created_at: new Date() };
    this.campanias.set(campania.id, campania);
    return { ...campania };
  }

  async findById(id: UUID): Promise<Campania | null> {
    const c = this.campanias.get(id);
    return c ? { ...c } : null;
  }

  async update(id: UUID, patch: CampaniaUpdate): Promise<Campania> {
    const current = this.campanias.get(id);
    if (!current) throw new NotFoundError(`campaña no encontrada: ${id}`, "campania", id);
    const next: Campania = { ...current, ...patch, id: current.id };
    this.campanias.set(id, next);
    return { ...next };
  }

  async list(): Promise<Campania[]> {
    return Array.from(this.campanias.values()).map((c) => ({ ...c }));
  }

  async delete(id: UUID): Promise<void> {
    this.campanias.delete(id);
  }
}
```

- [ ] **Step 2: Agregar `Campania` a `src/types/entities.ts`**

Ubicar junto a `Tag` (línea 340), agregar antes de `LeadTag`:

```ts
export interface Campania {
  id: UUID;
  nombre: string;
  desde: Date;
  hasta: Date;
  created_at: Date;
}
```

- [ ] **Step 3: Escribir el contract test**

```ts
import { describe, expect, it } from "vitest";
import type { CampaniasRepository } from "@/server/repositories/campanias.repo";

export function runCampaniasContract(makeRepo: () => CampaniasRepository) {
  describe("CampaniasRepository", () => {
    it("crea y lista", async () => {
      const repo = makeRepo();
      await repo.create({
        nombre: "Lanzamiento verano",
        desde: new Date("2026-01-01"),
        hasta: new Date("2026-01-31"),
      });
      const campanias = await repo.list();
      expect(campanias).toHaveLength(1);
      expect(campanias[0]?.nombre).toBe("Lanzamiento verano");
    });

    it("edita una existente", async () => {
      const repo = makeRepo();
      const creada = await repo.create({
        nombre: "Original",
        desde: new Date("2026-01-01"),
        hasta: new Date("2026-01-31"),
      });
      const editada = await repo.update(creada.id, { nombre: "Renombrada" });
      expect(editada.nombre).toBe("Renombrada");
    });

    it("update de una inexistente lanza NotFoundError", async () => {
      const repo = makeRepo();
      await expect(repo.update(crypto.randomUUID(), { nombre: "x" })).rejects.toThrow();
    });

    it("delete es idempotente", async () => {
      const repo = makeRepo();
      await expect(repo.delete(crypto.randomUUID())).resolves.toBeUndefined();
    });
  });
}
```

- [ ] **Step 4: Test file que ejecuta el contract contra InMemory**

Crear `tests/unit/campanias-repo.test.ts`:

```ts
import { InMemoryCampaniasRepository } from "@/server/repositories/campanias.repo";
import { runCampaniasContract } from "../repositories/campanias.contract";

runCampaniasContract(() => new InMemoryCampaniasRepository());
```

- [ ] **Step 5: Correr y verificar**

```bash
npx vitest run tests/unit/campanias-repo.test.ts
```

Expected: 4/4 PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/repositories/campanias.repo.ts src/types/entities.ts tests/repositories/campanias.contract.ts tests/unit/campanias-repo.test.ts
git commit -m "feat(campanias): CampaniasRepository con contract test"
```

---

## Task 5: `campanias.supabase.repo.ts`

**Files:**

- Create: `src/server/repositories/campanias.supabase.repo.ts`
- Modify: `tests/repositories/campanias.contract.ts` (ningún cambio de código, solo se referencia)

**Interfaces:**

- Consumes: `CampaniasRepository`, `AppClient`, `mapPostgrestError` (patrón de `metrics.supabase.repo.ts`).

- [ ] **Step 1: Escribir el archivo**

```ts
import { mapPostgrestError } from "@/server/db/postgrest-errors";
import type { AppClient } from "@/server/db/client";
import type { Campania, UUID } from "@/types/entities";
import type { CampaniaInsert, CampaniaUpdate, CampaniasRepository } from "./campanias.repo";

export class SupabaseCampaniasRepository implements CampaniasRepository {
  constructor(private readonly db: AppClient) {}

  async create(input: CampaniaInsert): Promise<Campania> {
    const { data, error } = await this.db
      .from("campanias")
      .insert({
        nombre: input.nombre,
        desde: input.desde.toISOString(),
        hasta: input.hasta.toISOString(),
      })
      .select("id, nombre, desde, hasta, created_at")
      .single();
    if (error) throw mapPostgrestError(error, { resource: "campanias" });
    return mapRow(data);
  }

  async findById(id: UUID): Promise<Campania | null> {
    const { data, error } = await this.db
      .from("campanias")
      .select("id, nombre, desde, hasta, created_at")
      .eq("id", id)
      .maybeSingle();
    if (error) throw mapPostgrestError(error, { resource: "campanias" });
    return data ? mapRow(data) : null;
  }

  async update(id: UUID, patch: CampaniaUpdate): Promise<Campania> {
    const { data, error } = await this.db
      .from("campanias")
      .update({
        ...(patch.nombre !== undefined ? { nombre: patch.nombre } : {}),
        ...(patch.desde !== undefined ? { desde: patch.desde.toISOString() } : {}),
        ...(patch.hasta !== undefined ? { hasta: patch.hasta.toISOString() } : {}),
      })
      .eq("id", id)
      .select("id, nombre, desde, hasta, created_at")
      .single();
    if (error) throw mapPostgrestError(error, { resource: "campanias" });
    return mapRow(data);
  }

  async list(): Promise<Campania[]> {
    const { data, error } = await this.db
      .from("campanias")
      .select("id, nombre, desde, hasta, created_at")
      .order("desde", { ascending: false });
    if (error) throw mapPostgrestError(error, { resource: "campanias" });
    return (data ?? []).map(mapRow);
  }

  async delete(id: UUID): Promise<void> {
    const { error } = await this.db.from("campanias").delete().eq("id", id);
    if (error) throw mapPostgrestError(error, { resource: "campanias" });
  }
}

function mapRow(r: {
  id: string;
  nombre: string;
  desde: string;
  hasta: string;
  created_at: string;
}): Campania {
  return {
    id: r.id,
    nombre: r.nombre,
    desde: new Date(r.desde),
    hasta: new Date(r.hasta),
    created_at: new Date(r.created_at),
  };
}
```

- [ ] **Step 2: `npm run typecheck`**

```bash
npm run typecheck
```

Expected: 0 errores.

- [ ] **Step 3: Commit**

```bash
git add src/server/repositories/campanias.supabase.repo.ts
git commit -m "feat(campanias): SupabaseCampaniasRepository"
```

> Nota: no se corre contra Postgres real en este plan — `test:integration` sigue congelado (AGENTS.md lección 10). Queda para cuando exista la base de test aislada.

---

## Task 6: `campanias-admin.service.ts`

**Files:**

- Create: `src/server/services/campanias/campanias-admin.service.ts`
- Test: `tests/unit/campanias-admin-service.test.ts`

**Interfaces:**

- Consumes: `CampaniasRepository` (Task 4).
- Produces: `CampaniasAdminService { listar, crear, editar, borrar }`.

- [ ] **Step 1: Escribir el failing test**

```ts
import { describe, expect, it } from "vitest";
import { InMemoryCampaniasRepository } from "@/server/repositories/campanias.repo";
import { DefaultCampaniasAdminService } from "@/server/services/campanias/campanias-admin.service";
import { ValidationError } from "@/lib/errors";

function build() {
  const repo = new InMemoryCampaniasRepository();
  const service = new DefaultCampaniasAdminService({ campanias: repo });
  return { repo, service };
}

describe("DefaultCampaniasAdminService", () => {
  it("crea una campaña válida", async () => {
    const { service } = build();
    const c = await service.crear({
      nombre: "Lanzamiento verano",
      desde: new Date("2026-01-01"),
      hasta: new Date("2026-01-31"),
    });
    expect(c.nombre).toBe("Lanzamiento verano");
  });

  it("rechaza hasta <= desde", async () => {
    const { service } = build();
    await expect(
      service.crear({
        nombre: "Rango invertido",
        desde: new Date("2026-01-31"),
        hasta: new Date("2026-01-01"),
      }),
    ).rejects.toThrow(ValidationError);
  });

  it("lista ordenadas de la más nueva a la más vieja por desde", async () => {
    const { service } = build();
    await service.crear({
      nombre: "A",
      desde: new Date("2026-01-01"),
      hasta: new Date("2026-01-31"),
    });
    await service.crear({
      nombre: "B",
      desde: new Date("2026-02-01"),
      hasta: new Date("2026-02-28"),
    });
    const listadas = await service.listar();
    expect(listadas.map((c) => c.nombre)).toEqual(["B", "A"]);
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

```bash
npx vitest run tests/unit/campanias-admin-service.test.ts
```

Expected: FAIL — `Cannot find module '@/server/services/campanias/campanias-admin.service'`.

- [ ] **Step 3: Implementar**

```ts
import { ValidationError } from "@/lib/errors";
import type {
  CampaniaInsert,
  CampaniaUpdate,
  CampaniasRepository,
} from "@/server/repositories/campanias.repo";
import type { Campania, UUID } from "@/types/entities";

export interface CampaniasAdminService {
  listar(): Promise<Campania[]>;
  crear(input: CampaniaInsert): Promise<Campania>;
  editar(id: UUID, patch: CampaniaUpdate): Promise<Campania>;
  borrar(id: UUID): Promise<void>;
}

/** Rango inválido es error de negocio, no solo del formulario: la API se llama también desde fuera del form. */
function validarRango(desde: Date, hasta: Date): void {
  if (hasta <= desde) {
    throw new ValidationError(
      "la fecha de fin tiene que ser posterior a la de inicio",
      "campania_rango_invalido",
    );
  }
}

export class DefaultCampaniasAdminService implements CampaniasAdminService {
  constructor(private readonly deps: { campanias: CampaniasRepository }) {}

  async listar(): Promise<Campania[]> {
    const campanias = await this.deps.campanias.list();
    return [...campanias].sort((a, b) => b.desde.getTime() - a.desde.getTime());
  }

  async crear(input: CampaniaInsert): Promise<Campania> {
    validarRango(input.desde, input.hasta);
    return this.deps.campanias.create(input);
  }

  async editar(id: UUID, patch: CampaniaUpdate): Promise<Campania> {
    if (patch.desde !== undefined && patch.hasta !== undefined) {
      validarRango(patch.desde, patch.hasta);
    } else if (patch.desde !== undefined || patch.hasta !== undefined) {
      const actual = await this.deps.campanias.findById(id);
      if (!actual) throw new ValidationError("campaña no encontrada", "campania_no_encontrada");
      validarRango(patch.desde ?? actual.desde, patch.hasta ?? actual.hasta);
    }
    return this.deps.campanias.update(id, patch);
  }

  async borrar(id: UUID): Promise<void> {
    await this.deps.campanias.delete(id);
  }
}
```

- [ ] **Step 4: Correr y verificar que pasa**

```bash
npx vitest run tests/unit/campanias-admin-service.test.ts
```

Expected: 3/3 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/services/campanias/campanias-admin.service.ts tests/unit/campanias-admin-service.test.ts
git commit -m "feat(campanias): DefaultCampaniasAdminService con validacion de rango"
```

---

## Task 7: `campanias-bootstrap.ts`

**Files:**

- Create: `src/server/bootstrap/campanias-bootstrap.ts`

**Interfaces:**

- Consumes: `DefaultCampaniasAdminService`, `SupabaseCampaniasRepository`, `createSupabaseServerClient`.

- [ ] **Step 1: Escribir el archivo**

```ts
import { createSupabaseServerClient } from "@/server/auth/supabase-ssr";
import { SupabaseCampaniasRepository } from "@/server/repositories/campanias.supabase.repo";
import { DefaultCampaniasAdminService } from "@/server/services/campanias/campanias-admin.service";
import type { AppClient } from "@/server/db/client";
import type { CampaniasAdminService } from "@/server/services/campanias/campanias-admin.service";

export function makeCampaniasAdminService(db: AppClient): CampaniasAdminService {
  return new DefaultCampaniasAdminService({ campanias: new SupabaseCampaniasRepository(db) });
}

export async function getCampaniasAdminServiceForRequest(): Promise<CampaniasAdminService> {
  const db = await createSupabaseServerClient();
  return makeCampaniasAdminService(db);
}
```

- [ ] **Step 2: `npm run typecheck`**

```bash
npm run typecheck
```

Expected: 0 errores.

- [ ] **Step 3: Commit**

```bash
git add src/server/bootstrap/campanias-bootstrap.ts
git commit -m "feat(campanias): bootstrap del service"
```

---

## Task 8: Servicio de métricas — `obtener(desde, hasta)` + `ventas` + `codigosMasVendidos` + `tiempoCierre`

**Files:**

- Modify: `src/server/services/metricas/metricas.service.ts`
- Modify: `src/server/services/metricas/default-metricas.service.ts`
- Modify: `src/types/metricas.ts`
- Test: `tests/unit/metricas-service.test.ts`

**Interfaces:**

- Consumes: `FilaSesionMetrica` extendida (Task 2).
- Produces: `Metricas.ventas: Ventas`, `Metricas.codigosMasVendidos: ConteoCodigo[]`, `Metricas.tiempoCierre: TiempoRespuestaMedible`, `MetricsService.obtener(desde: Date, hasta: Date): Promise<Metricas>`.

- [ ] **Step 1: Agregar los tipos nuevos a `src/types/metricas.ts`**

Agregar antes de la interface `Metricas`:

```ts
/** Ventas realizadas del período: resultado = 'exito' en lead_session. */
export interface Ventas {
  /** Todas las resultado=exito, tengan o no precio_cotizado registrado. */
  conteo: number;
  /** De esas, cuántas tienen precio_cotizado no nulo — denominador real de monto/ticket. */
  conPrecio: number;
  /** sum(precio_cotizado), monto TOTAL (no unitario). null si conPrecio = 0. */
  montoTotalUsd: number | null;
  /** montoTotalUsd / conPrecio. null si conPrecio = 0. */
  ticketPromedioUsd: number | null;
}

/**
 * Un código de producto entre las ventas del período. `lead_session` es 1
 * producto por sesión (sin carrito): "apariciones" es la métrica primaria y
 * siempre disponible; "unidades" depende de que `cantidad` se haya registrado.
 */
export interface ConteoCodigo {
  codigoInterno: string;
  apariciones: number;
  unidades: number;
  /** Denominador de `unidades` — cuántas de las `apariciones` tienen `cantidad` registrada. */
  unidadesConDato: number;
}
```

Modificar la interface `Metricas`: reemplazar el comentario de cabecera para no mencionar `dias` sueltos, y agregar después de `intentsSinRegla`:

```ts
  ventas: Ventas;
  /** De más a menos apariciones entre las ventas del período. */
  codigosMasVendidos: ConteoCodigo[];
  repuestosMasPreguntados: {
    /** args.marca de buscar_repuesto — dato categórico limpio. */
    porMarca: ConteoMotivo[];
    /** args.query normalizado (trim + lowercase) — texto libre, puede fragmentar variantes de la misma pieza. */
    porTermino: ConteoMotivo[];
  };
  /** Mediana de closed_at - started_at sobre CUALQUIER sesión resuelta (exito o perdido) con closed_at registrado. */
  tiempoCierre: TiempoRespuestaMedible;
```

- [ ] **Step 2: Cambiar la interface del service**

En `src/server/services/metricas/metricas.service.ts`:

```ts
import type { Metricas } from "@/types/metricas";

export interface MetricsService {
  /** Métricas del rango [desde, hasta). El delta contra el período anterior compara con el rango de igual duración inmediatamente previo a `desde`. */
  obtener(desde: Date, hasta: Date): Promise<Metricas>;
}
```

- [ ] **Step 3: Escribir los tests que fallan (agregar a `tests/unit/metricas-service.test.ts`)**

Ubicar el helper que arma el fixture base de sesiones existente en el archivo (buscar cómo los tests actuales llaman a `service.obtener`) y adaptar las llamadas existentes de `obtener(dias, ahora)` a `obtener(desde, hasta)` — con `desde = new Date(ahora.getTime() - dias*DIA_MS)`. Agregar:

```ts
describe("ventas", () => {
  it("cuenta exito con y sin precio, y promedia solo sobre las que tienen precio", async () => {
    const ahora = new Date("2026-08-17T12:00:00Z");
    const desde = new Date("2026-07-18T12:00:00Z");
    const repo = new InMemoryMetricsRepository({
      sesiones: [
        {
          id: "s1",
          current_stage: "cerrado",
          resultado: "exito",
          motivo_perdida: null,
          started_at: desde,
          precio_cotizado: 100,
          codigo_interno: "COD1",
          closed_at: ahora,
        },
        {
          id: "s2",
          current_stage: "cerrado",
          resultado: "exito",
          motivo_perdida: null,
          started_at: desde,
          precio_cotizado: null,
          codigo_interno: null,
          closed_at: ahora,
        },
        {
          id: "s3",
          current_stage: "cerrado",
          resultado: "perdido",
          motivo_perdida: "precio",
          started_at: desde,
          precio_cotizado: 50,
          codigo_interno: "COD2",
          closed_at: ahora,
        },
      ],
    });
    const service = new DefaultMetricsService({ metrics: repo });
    const m = await service.obtener(desde, ahora);
    expect(m.ventas).toEqual({
      conteo: 2,
      conPrecio: 1,
      montoTotalUsd: 100,
      ticketPromedioUsd: 100,
    });
  });

  it("con cero ventas, montoTotalUsd y ticketPromedioUsd son null", async () => {
    const ahora = new Date("2026-08-17T12:00:00Z");
    const desde = new Date("2026-07-18T12:00:00Z");
    const service = new DefaultMetricsService({ metrics: new InMemoryMetricsRepository() });
    const m = await service.obtener(desde, ahora);
    expect(m.ventas).toEqual({
      conteo: 0,
      conPrecio: 0,
      montoTotalUsd: null,
      ticketPromedioUsd: null,
    });
  });
});

describe("codigosMasVendidos", () => {
  it("agrupa por codigo_interno entre las ventas, ordenado por apariciones", async () => {
    const ahora = new Date("2026-08-17T12:00:00Z");
    const desde = new Date("2026-07-18T12:00:00Z");
    const repo = new InMemoryMetricsRepository({
      sesiones: [
        {
          id: "s1",
          current_stage: "cerrado",
          resultado: "exito",
          motivo_perdida: null,
          started_at: desde,
          precio_cotizado: 100,
          codigo_interno: "COD1",
          closed_at: ahora,
        },
        {
          id: "s2",
          current_stage: "cerrado",
          resultado: "exito",
          motivo_perdida: null,
          started_at: desde,
          precio_cotizado: 80,
          codigo_interno: "COD1",
          closed_at: ahora,
          cantidad: 3,
        } as never,
        {
          id: "s3",
          current_stage: "cerrado",
          resultado: "exito",
          motivo_perdida: null,
          started_at: desde,
          precio_cotizado: 20,
          codigo_interno: "COD2",
          closed_at: ahora,
        },
      ],
    });
    const service = new DefaultMetricsService({ metrics: repo });
    const m = await service.obtener(desde, ahora);
    expect(m.codigosMasVendidos[0]).toEqual({
      codigoInterno: "COD1",
      apariciones: 2,
      unidades: 3,
      unidadesConDato: 1,
    });
    expect(m.codigosMasVendidos[1]?.codigoInterno).toBe("COD2");
  });
});

describe("tiempoCierre", () => {
  it("mediana sobre sesiones resueltas con closed_at, exito y perdido", async () => {
    const ahora = new Date("2026-08-17T12:00:00Z");
    const desde = new Date("2026-07-18T12:00:00Z");
    const inicio = desde;
    const repo = new InMemoryMetricsRepository({
      sesiones: [
        {
          id: "s1",
          current_stage: "cerrado",
          resultado: "exito",
          motivo_perdida: null,
          started_at: inicio,
          precio_cotizado: null,
          codigo_interno: null,
          closed_at: new Date(inicio.getTime() + 60_000),
        },
        {
          id: "s2",
          current_stage: "cerrado",
          resultado: "perdido",
          motivo_perdida: "precio",
          started_at: inicio,
          precio_cotizado: null,
          codigo_interno: null,
          closed_at: new Date(inicio.getTime() + 120_000),
        },
      ],
    });
    const service = new DefaultMetricsService({ metrics: repo });
    const m = await service.obtener(desde, ahora);
    expect(m.tiempoCierre.muestras).toBe(2);
    expect(m.tiempoCierre.medianaSegundos).toBe(90);
  });
});
```

> Nota: `FilaSesionMetrica` no tiene `cantidad` — la fixture del segundo test de `codigosMasVendidos` necesita ese campo agregado a `FilaSesionMetrica` (Task 2 no lo incluyó porque el spec original no lo pedía como columna de servicio; corregir acá: agregar `cantidad: number | null` a `FilaSesionMetrica` en `metrics.repo.ts`, al `select` de `metrics.supabase.repo.ts`, y sacar el `as never` del test una vez agregado).

- [ ] **Step 4: Agregar `cantidad` a `FilaSesionMetrica` (corrección sobre Task 2)**

En `src/server/repositories/metrics.repo.ts`, agregar `cantidad: number | null;` a `FilaSesionMetrica`. En `src/server/repositories/metrics.supabase.repo.ts`, agregar `cantidad` al `.select()` de `listSesionesDesde` y al `.map()` (`cantidad: r.cantidad`). Actualizar el test del Step 3 sacando el `as never`.

- [ ] **Step 5: Correr los tests nuevos y verificar que fallan**

```bash
npx vitest run tests/unit/metricas-service.test.ts -t "ventas|codigosMasVendidos|tiempoCierre"
```

Expected: FAIL — `obtener` todavía toma `dias`, no `desde/hasta`, y `m.ventas`/`m.codigosMasVendidos`/`m.tiempoCierre` no existen.

- [ ] **Step 6: Reescribir la firma y el cuerpo de `obtener` en `default-metricas.service.ts`**

Reemplazar el método completo (líneas 55-263 del archivo original):

```ts
  async obtener(desde: Date, hasta: Date): Promise<Metricas> {
    const ventana = hasta.getTime() - desde.getTime();
    const desdeAnterior = new Date(desde.getTime() - ventana);

    const [
      sesionesAmbas,
      mensajes,
      leadsAmbos,
      reglas,
      tools,
      intents,
      reglasActivas,
      clasificaciones,
      usuarios,
      gastos,
      handoffs,
    ] = await Promise.all([
      this.deps.metrics.listSesionesDesde(desdeAnterior),
      this.deps.metrics.listMensajesDesde(desde),
      this.deps.metrics.listLeadsDesde(desdeAnterior),
      this.deps.metrics.listRuleExecutionsDesde(desde),
      this.deps.metrics.listToolExecutionsDesde(desde),
      this.deps.metrics.listIntentsActivos(),
      this.deps.metrics.listReglasActivas(),
      this.deps.metrics.listTurnClassificationsDesde(desde),
      this.deps.metrics.listUsuarios(),
      this.deps.metrics.listLlmUsageDesde(desde),
      this.deps.metrics.listHandoffsDesde(desde),
    ]);

    const corte = desde.getTime();
    const dias = Math.round(ventana / DIA_MS);
    const sesiones = sesionesAmbas.filter((s) => s.started_at.getTime() >= corte);
    const sesionesAnteriores = sesionesAmbas.filter((s) => s.started_at.getTime() < corte);
    const leadsNuevos = leadsAmbos.filter((l) => l.created_at.getTime() >= corte).length;
    const leadsAnteriores = leadsAmbos.length - leadsNuevos;

    const porEtapa = new Map<CurrentStage, number>();
    const motivos = new Map<string, number>();
    const codigosMap = new Map<string, { apariciones: number; unidades: number; unidadesConDato: number }>();
    const tiemposCierre: number[] = [];
    let exito = 0;
    let perdido = 0;
    let ventasConPrecio = 0;
    let ventasMontoTotal = 0;

    for (const s of sesiones) {
      porEtapa.set(s.current_stage, (porEtapa.get(s.current_stage) ?? 0) + 1);

      if (s.closed_at !== null && s.resultado !== null) {
        tiemposCierre.push((s.closed_at.getTime() - s.started_at.getTime()) / 1000);
      }

      if (s.resultado === "exito") {
        exito++;
        if (s.precio_cotizado !== null) {
          ventasConPrecio++;
          ventasMontoTotal += s.precio_cotizado;
        }
        if (s.codigo_interno !== null) {
          const fila = codigosMap.get(s.codigo_interno) ?? { apariciones: 0, unidades: 0, unidadesConDato: 0 };
          fila.apariciones++;
          if (s.cantidad !== null) {
            fila.unidades += s.cantidad;
            fila.unidadesConDato++;
          }
          codigosMap.set(s.codigo_interno, fila);
        }
      } else if (s.resultado === "perdido") {
        perdido++;
        const clave = s.motivo_perdida ?? "sin_motivo";
        motivos.set(clave, (motivos.get(clave) ?? 0) + 1);
      }
    }

    const ventas: Ventas = {
      conteo: exito,
      conPrecio: ventasConPrecio,
      montoTotalUsd: ventasConPrecio > 0 ? ventasMontoTotal : null,
      ticketPromedioUsd: ventasConPrecio > 0 ? ventasMontoTotal / ventasConPrecio : null,
    };

    const codigosMasVendidos: ConteoCodigo[] = [...codigosMap.entries()]
      .map(([codigoInterno, v]) => ({ codigoInterno, ...v }))
      .sort((a, b) => b.apariciones - a.apariciones || a.codigoInterno.localeCompare(b.codigoInterno));

    const tiempoCierre = {
      medianaSegundos: medianaSegundos(tiemposCierre),
      muestras: tiemposCierre.length,
    };

    const porMotivo: ConteoMotivo[] = [...motivos.entries()]
      .map(([motivo, cantidad]) => ({
        motivo: motivo === "sin_motivo" ? "Sin motivo registrado" : (MOTIVO_LABEL[motivo] ?? motivo),
        cantidad,
      }))
      .sort((a, b) => b.cantidad - a.cantidad || a.motivo.localeCompare(b.motivo));

    const autoria = Object.fromEntries(SENDER.map((s) => [s, 0])) as Record<Sender, number>;
    const porCanalConteo = new Map<Canal, number>();
    const sesionesConHumano = new Set<string>();
    const hilos = new Map<string, FilaMensajeMetrica[]>();
    for (const m of mensajes) {
      autoria[m.sender]++;
      porCanalConteo.set(m.canal, (porCanalConteo.get(m.canal) ?? 0) + 1);
      if (m.sender === "humano") sesionesConHumano.add(m.lead_session_id);
      const hilo = hilos.get(m.lead_session_id);
      if (hilo) hilo.push(m);
      else hilos.set(m.lead_session_id, [m]);
    }
    for (const hilo of hilos.values()) {
      hilo.sort((a, b) => a.created_at.getTime() - b.created_at.getTime());
    }

    const porCanal: ConteoCanal[] = CANAL.map((canal) => ({
      canal,
      cantidad: porCanalConteo.get(canal) ?? 0,
    })).filter((c) => c.cantidad > 0);

    let escaladas = 0;
    let tomadas = 0;
    let resueltasPorIa = 0;
    let cierresIa = 0;
    let cierresVendedor = 0;
    for (const s of sesiones) {
      const escribioHumano = sesionesConHumano.has(s.id);
      if (escribioHumano) tomadas++;
      if (escribioHumano || s.current_stage === "requiere_humano") escaladas++;
      if (!escribioHumano && s.resultado !== null) resueltasPorIa++;
      if (s.resultado === "exito") {
        if (escribioHumano) cierresVendedor++;
        else cierresIa++;
      }
    }

    const turnosRegla = Math.min(reglas.length, autoria.ia);
    const herramientas: ConteoHerramienta[] = agruparHerramientas(tools);
    const repuestosMasPreguntados = medirDemandaCatalogo(tools);

    const usosPorIntent = new Map<string, number>();
    for (const c of clasificaciones) {
      if (c.intent_id === null) continue;
      usosPorIntent.set(c.intent_id, (usosPorIntent.get(c.intent_id) ?? 0) + 1);
    }

    const conRegla = new Set(reglasActivas.map((r) => r.intent_id));
    const intentsSinRegla: IntentSinRegla[] = intents
      .filter((i) => !conRegla.has(i.id))
      .map((i) => ({
        id: i.id,
        nombre: i.nombre,
        descripcion: i.descripcion,
        autoDetectado: i.auto_detectado,
        detectadoEl: i.created_at,
        usos: usosPorIntent.get(i.id) ?? 0,
      }))
      .sort(
        (a, b) =>
          b.usos - a.usos || b.detectadoEl.getTime() - a.detectadoEl.getTime() || a.nombre.localeCompare(b.nombre),
      );

    const vendedores = repartirPorVendedor(sesiones, hilos, usuarios);
    const tiempoPrimeraRespuesta = medirPrimerasRespuestas(hilos);
    const etiquetasHandoff: Record<string, string> = {
      unknown_intents: "Intents desconocidos",
      sensitive_keyword: "Palabra sensible",
      quote_limit: "Límite de cotización",
      discount_limit: "Límite de descuento",
      rule_handoff: "Regla de revisión",
      manual_pause: "Pausa manual",
      manual_resume: "Reanudación manual",
      other: "Otro",
    };
    const razonConteo = new Map<string, number>();
    for (const event of handoffs) {
      if (event.action !== "pause") continue;
      const label = etiquetasHandoff[event.reason_code] ?? "Sin motivo registrado";
      razonConteo.set(label, (razonConteo.get(label) ?? 0) + 1);
    }

    return {
      desde,
      dias,
      totalSesiones: sesiones.length,
      leadsNuevos: { valor: leadsNuevos, anterior: leadsAnteriores },
      tasaCierre: { valor: tasaCierreDe(sesiones), anterior: tasaCierreDe(sesionesAnteriores) },
      embudo: FUNNEL_STAGES.map((stage) => ({ stage, cantidad: porEtapa.get(stage) ?? 0 })),
      desvios: DESVIOS.map((stage) => ({ stage, cantidad: porEtapa.get(stage) ?? 0 })),
      porCanal,
      resultado: { abiertas: sesiones.length - exito - perdido, exito, perdido, porMotivo },
      autoria,
      agente: { sinIntervencionHumana: sesiones.length - tomadas, resueltasPorIa, escaladas },
      tomadasPorHumano: tomadas,
      tiempoPrimeraRespuesta,
      razonesEscalado: [...razonConteo.entries()]
        .map(([motivo, cantidad]) => ({ motivo, cantidad }))
        .sort((a, b) => b.cantidad - a.cantidad || a.motivo.localeCompare(b.motivo, "es")),
      vendedores,
      cierres: { ia: cierresIa, vendedor: cierresVendedor },
      turnos: { regla: turnosRegla, llm: autoria.ia - turnosRegla, escalado: autoria.humano },
      gasto: resumirGasto(gastos, hasta, leadsNuevos, turnosRegla),
      herramientas,
      intentsSinRegla,
      ventas,
      codigosMasVendidos,
      repuestosMasPreguntados,
      tiempoCierre,
    };
  }
```

Notas sobre esta reescritura:

- `dias` se sigue exponiendo en `Metricas` (lo usa `PageHeader`/UI) pero ahora se deriva de `hasta - desde` en vez de venir como parámetro — un rango custom o de campaña también muestra "N días" correctamente.
- `resumirGasto` pasa a recibir `hasta` en vez de `ahora` (incluye el rename en la firma de esa función — buscar `function resumirGasto(gastos, ahora: Date, ...)` y renombrar el parámetro a `hasta`, y dentro de ella `ahora.toISOString()` pasa a `hasta.toISOString()`).
- El delta contra el período anterior ahora se calcula para **cualquier rango**, no solo los 3 atajos fijos — es "período de igual duración inmediatamente anterior a `desde`", que está bien definido para un rango custom o una campaña también. Esto es una simplificación respecto al spec (que decía "solo atajos fijos") descubierta al escribir el código: la fórmula generaliza sola, no hace falta la restricción.

- [ ] **Step 7: Agregar `medirDemandaCatalogo`**

Agregar la función nueva junto a `agruparHerramientas` (después de su definición):

```ts
/**
 * Demanda de catálogo desde `buscar_repuesto`, sin depender de que haya
 * productos cargados. `porTermino` es texto libre y se capea a 15 para que una
 * cola larga de variantes de la misma pieza no ahogue la lista; `porMarca` es
 * categórico y acotado (un puñado de marcas de auto), no necesita cap.
 */
function medirDemandaCatalogo(
  tools: FilaToolExecutionMetrica[],
): Metricas["repuestosMasPreguntados"] {
  const marcas = new Map<string, number>();
  const terminos = new Map<string, number>();
  for (const t of tools) {
    if (t.tool_name !== "buscar_repuesto" || !t.args) continue;
    if (t.args.marca) {
      const clave = t.args.marca.trim().toLowerCase();
      if (clave) marcas.set(clave, (marcas.get(clave) ?? 0) + 1);
    }
    if (t.args.query) {
      const clave = t.args.query.trim().toLowerCase();
      if (clave) terminos.set(clave, (terminos.get(clave) ?? 0) + 1);
    }
  }
  const aConteo = (mapa: Map<string, number>) =>
    [...mapa.entries()]
      .map(([motivo, cantidad]) => ({ motivo, cantidad }))
      .sort((a, b) => b.cantidad - a.cantidad || a.motivo.localeCompare(b.motivo));
  return {
    porMarca: aConteo(marcas),
    porTermino: aConteo(terminos).slice(0, 15),
  };
}
```

- [ ] **Step 8: Ajustar imports**

En `default-metricas.service.ts`, agregar `ConteoCodigo`, `Ventas` a los imports de tipos desde `@/types/metricas`.

- [ ] **Step 9: Correr los tests nuevos y confirmar que pasan**

```bash
npx vitest run tests/unit/metricas-service.test.ts
```

Expected: todos PASS, incluidos los preexistentes (ya migrados a `desde/hasta` en el Step 3).

- [ ] **Step 10: `npm run typecheck` completo**

```bash
npm run typecheck
```

Expected: 0 errores — esto va a mostrar cualquier consumidor de `MetricsService.obtener` que siga pasando `dias` (el `page.tsx`, corregido en Task 9).

- [ ] **Step 11: Commit**

```bash
git add src/types/metricas.ts src/server/services/metricas/metricas.service.ts src/server/services/metricas/default-metricas.service.ts src/server/repositories/metrics.repo.ts src/server/repositories/metrics.supabase.repo.ts tests/unit/metricas-service.test.ts tests/repositories/metrics.contract.ts
git commit -m "feat(metricas): ventas, codigosMasVendidos, repuestosMasPreguntados y tiempoCierre"
```

---

## Task 9: Zod schemas + Server Actions de campaña

**Files:**

- Create: `src/lib/validation/campanias.schema.ts`
- Create: `src/app/(panel)/metricas/_actions/action-error.ts`
- Create: `src/app/(panel)/metricas/_actions/crear-campania.action.ts`
- Create: `src/app/(panel)/metricas/_actions/editar-campania.action.ts`
- Create: `src/app/(panel)/metricas/_actions/borrar-campania.action.ts`

**Interfaces:**

- Consumes: `getCampaniasAdminServiceForRequest` (Task 7), `ActionResult` (`@/types/inbox`).

- [ ] **Step 1: Escribir el schema**

```ts
import { z } from "zod";
import { UUIDSchema } from "@/lib/validation/schemas";

const FechaSchema = z.coerce.date();

export const CrearCampaniaSchema = z
  .object({
    nombre: z.string().trim().min(2, "Al menos 2 caracteres.").max(60, "Máximo 60 caracteres."),
    desde: FechaSchema,
    hasta: FechaSchema,
  })
  .refine((v) => v.hasta > v.desde, {
    message: "La fecha de fin tiene que ser posterior a la de inicio.",
    path: ["hasta"],
  });
export type CrearCampaniaInput = z.infer<typeof CrearCampaniaSchema>;

export const EditarCampaniaSchema = CrearCampaniaSchema.and(z.object({ id: UUIDSchema }));
export type EditarCampaniaInput = z.infer<typeof EditarCampaniaSchema>;

export const BorrarCampaniaSchema = z.object({ id: UUIDSchema });
export type BorrarCampaniaInput = z.infer<typeof BorrarCampaniaSchema>;
```

- [ ] **Step 2: Escribir `action-error.ts`**

Copiar `src/app/(panel)/leads/_actions/action-error.ts` completo, cambiando el `scope` del logger y los copys por defecto:

```ts
import {
  ConflictError,
  DomainError,
  NotFoundError,
  PermissionDeniedError,
  ValidationError,
} from "@/lib/errors";
import { getLogger } from "@/lib/observability/get-logger";

const logger = getLogger({ scope: "metricas-actions" });

export function toActionError(
  e: unknown,
  accion: string,
  opciones: { permisoDenegado?: string; conflicto?: string; noEncontrado?: string } = {},
): { ok: false; error: string } {
  if (e instanceof ConflictError) {
    return { ok: false, error: opciones.conflicto ?? "Ya existe una campaña con esos datos." };
  }
  if (e instanceof NotFoundError) {
    return {
      ok: false,
      error: opciones.noEncontrado ?? "Campaña no encontrada. Refrescá la página.",
    };
  }
  if (e instanceof ValidationError) {
    return { ok: false, error: e.message };
  }
  if (e instanceof PermissionDeniedError) {
    logger.warn("permiso denegado en action metricas", { accion, code: e.code });
    return {
      ok: false,
      error: opciones.permisoDenegado ?? "Solo un administrador puede gestionar campañas.",
    };
  }
  if (e instanceof DomainError) {
    logger.warn("domain error en action metricas", { accion, code: e.code, error: e.message });
    return { ok: false, error: "No se pudo completar la acción. Reintentá en unos segundos." };
  }
  logger.error("action metricas inesperada falló", {
    accion,
    error: e instanceof Error ? e.message : String(e),
  });
  return { ok: false, error: "Error inesperado. Reintentá en unos segundos." };
}
```

- [ ] **Step 3: `crear-campania.action.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { CrearCampaniaSchema } from "@/lib/validation/campanias.schema";
import { getCampaniasAdminServiceForRequest } from "@/server/bootstrap/campanias-bootstrap";
import { toActionError } from "./action-error";
import type { ActionResult } from "@/types/inbox";

export async function crearCampaniaAction(raw: unknown): Promise<ActionResult> {
  const parsed = CrearCampaniaSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }
  try {
    const svc = await getCampaniasAdminServiceForRequest();
    await svc.crear(parsed.data);
  } catch (e) {
    return toActionError(e, "crear-campania");
  }
  revalidatePath("/metricas");
  return { ok: true };
}
```

- [ ] **Step 4: `editar-campania.action.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { EditarCampaniaSchema } from "@/lib/validation/campanias.schema";
import { getCampaniasAdminServiceForRequest } from "@/server/bootstrap/campanias-bootstrap";
import { toActionError } from "./action-error";
import type { ActionResult } from "@/types/inbox";

export async function editarCampaniaAction(raw: unknown): Promise<ActionResult> {
  const parsed = EditarCampaniaSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }
  try {
    const { id, ...patch } = parsed.data;
    const svc = await getCampaniasAdminServiceForRequest();
    await svc.editar(id, patch);
  } catch (e) {
    return toActionError(e, "editar-campania");
  }
  revalidatePath("/metricas");
  return { ok: true };
}
```

- [ ] **Step 5: `borrar-campania.action.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { BorrarCampaniaSchema } from "@/lib/validation/campanias.schema";
import { getCampaniasAdminServiceForRequest } from "@/server/bootstrap/campanias-bootstrap";
import { toActionError } from "./action-error";
import type { ActionResult } from "@/types/inbox";

export async function borrarCampaniaAction(raw: unknown): Promise<ActionResult> {
  const parsed = BorrarCampaniaSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Campaña inválida." };
  }
  try {
    const svc = await getCampaniasAdminServiceForRequest();
    await svc.borrar(parsed.data.id);
  } catch (e) {
    return toActionError(e, "borrar-campania");
  }
  revalidatePath("/metricas");
  return { ok: true };
}
```

- [ ] **Step 6: `npm run typecheck`**

```bash
npm run typecheck
```

Expected: 0 errores.

- [ ] **Step 7: Commit**

```bash
git add src/lib/validation/campanias.schema.ts src/app/\(panel\)/metricas/_actions/
git commit -m "feat(campanias): server actions de alta, edicion y baja"
```

---

## Task 10: `TopLista.tsx` — componente compartido

**Files:**

- Create: `src/components/metricas/TopLista.tsx`

**Interfaces:**

- Consumes: `formatearEntero` (`@/lib/ui/metricas`).
- Produces: `TopLista({ filas, vacio }: { filas: Array<{ label: string; meta?: string; valor: number }>; vacio: string })`.

- [ ] **Step 1: Escribir el componente**

Modelado sobre la lista de herramientas de `PanelAgente.tsx:106-129` — mismo patrón visual, generalizado a 3 usos (códigos más vendidos, marcas y términos más preguntados):

```tsx
import { formatearEntero } from "@/lib/ui/metricas";

export interface FilaTopLista {
  label: string;
  /** Texto secundario opcional, en Geist Mono chico (ej: "3 unidades"). */
  meta?: string;
  valor: number;
}

/** Lista compacta label + meta opcional + conteo, para los "top N" de Métricas. */
export function TopLista({ filas, vacio }: { filas: FilaTopLista[]; vacio: string }) {
  if (filas.length === 0) {
    return <p className="text-ink-faint text-[11.5px]">{vacio}</p>;
  }
  return (
    <ul className="flex flex-col gap-2.5">
      {filas.map((f) => (
        <li key={f.label} className="flex items-center gap-2">
          <span className="text-ink-dim min-w-0 flex-1 truncate font-mono text-[11px]">
            {f.label}
          </span>
          {f.meta ? (
            <span className="text-ink-ghost shrink-0 font-mono text-[9.5px]">{f.meta}</span>
          ) : null}
          <span className="text-ink-secondary w-14 shrink-0 text-right font-mono text-[11.5px] tabular-nums">
            {formatearEntero(f.valor)}
          </span>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 2: `npm run typecheck` + `npm run lint`**

```bash
npm run typecheck && npm run lint
```

Expected: 0 errores en ambos.

- [ ] **Step 3: Commit**

```bash
git add src/components/metricas/TopLista.tsx
git commit -m "feat(metricas): TopLista compartida por codigos y demanda de catalogo"
```

---

## Task 11: `PanelTotal.tsx` — KPIs de venta y secciones nuevas

**Files:**

- Modify: `src/components/metricas/PanelTotal.tsx`

**Interfaces:**

- Consumes: `Metricas.ventas`, `.codigosMasVendidos`, `.repuestosMasPreguntados` (Task 8), `TopLista` (Task 10).

- [ ] **Step 1: Reemplazar el `KpiFaltante` de "1ra respuesta"**

Este hueco ya no aplica al scope de este plan (era el de `platform_created_at`, resuelto en trabajo previo de la sesión) — si sigue como `KpiFaltante` en el código actual, dejarlo intacto: no es parte de este plan. Foco acá es solo agregar, no tocarlo.

- [ ] **Step 2: Agregar los 3 KPIs de venta al grid de KPIs (después de "Costo IA / lead")**

En `src/components/metricas/PanelTotal.tsx`, dentro del `<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">` (líneas 24-56), agregar después del bloque de "Costo IA / lead":

```tsx
<TarjetaKpi
  label="Ventas realizadas"
  valor={formatearEntero(m.ventas.conteo)}
  subtitulo="sesiones cerradas con éxito en el período"
  icono={ReceiptLong}
/>;
{
  m.ventas.montoTotalUsd === null ? (
    <KpiFaltante
      label="Ticket promedio"
      falta="ninguna de las ventas del período tiene precio_cotizado registrado."
    />
  ) : (
    <TarjetaKpi
      label="Ticket promedio"
      valor={formatearUsd(m.ventas.ticketPromedioUsd ?? 0)}
      subtitulo={`${formatearUsd(m.ventas.montoTotalUsd)} sobre ${formatearEntero(m.ventas.conPrecio)} de ${formatearEntero(m.ventas.conteo)} ventas con precio`}
      icono={Savings}
    />
  );
}
```

Agregar el import `ReceiptLong` a `@/components/icons` en la cabecera del archivo (ya están `ContactEmergency, Savings, TaskAlt`, agregar `ReceiptLong` a esa misma línea de import).

- [ ] **Step 3: Agregar las dos secciones nuevas, después de "Resultado de las sesiones"**

```tsx
<div className="grid gap-4 lg:grid-cols-2">
  <Seccion
    titulo="Códigos más vendidos"
    extra={cantidad(m.codigosMasVendidos.length, "código")}
    nota="lead_session guarda 1 producto por sesión: si una conversación negoció varios repuestos, solo el último queda registrado. «Apariciones» es la métrica primaria; «unidades» solo suma las ventas que registraron cantidad."
  >
    <TopLista
      vacio="Ninguna venta con código de producto en el período."
      filas={m.codigosMasVendidos.map((c) => ({
        label: c.codigoInterno,
        meta: c.unidadesConDato > 0 ? `${formatearEntero(c.unidades)} unid.` : undefined,
        valor: c.apariciones,
      }))}
    />
  </Seccion>

  <Seccion
    titulo="Repuestos más preguntados"
    extra="por marca"
    nota="De las llamadas del agente a buscar_repuesto — no depende de tener catálogo cargado, es demanda pura."
  >
    <TopLista
      vacio="El agente no buscó ninguna marca en el período."
      filas={m.repuestosMasPreguntados.porMarca.map((r) => ({
        label: r.motivo,
        valor: r.cantidad,
      }))}
    />
  </Seccion>
</div>
```

Agregar el import `TopLista` desde `@/components/metricas/TopLista`.

- [ ] **Step 4: Verificar en el navegador**

```bash
npm run dev
```

Navegar a `http://localhost:3001/metricas` y confirmar que las 2 tarjetas nuevas y las 2 secciones nuevas aparecen sin romper el layout existente (usar `get_page_text`, capturas si el panel está desplegado).

- [ ] **Step 5: `npm run typecheck` + `npm run lint`**

```bash
npm run typecheck && npm run lint
```

Expected: 0 errores en ambos.

- [ ] **Step 6: Commit**

```bash
git add src/components/metricas/PanelTotal.tsx
git commit -m "feat(metricas): ventas realizadas, ticket promedio y demanda de catalogo en Total"
```

---

## Task 12: `PanelVendedores.tsx` — handoff real, ticket promedio, tiempo en cerrar, fix de la tarjeta con dos fuentes

**Files:**

- Modify: `src/components/metricas/PanelVendedores.tsx`

**Interfaces:**

- Consumes: `Metricas.razonesEscalado` (ya existía), `.ventas`, `.tiempoCierre` (Task 8), `BarraReparto` (ya existe).

- [ ] **Step 1: Reemplazar el `BloqueFaltante` de "Por qué se escaló a humano" por `BarraReparto`**

En `src/components/metricas/PanelVendedores.tsx:150-154`, reemplazar:

```tsx
<BloqueFaltante
  label="Por qué se escaló a humano"
  descripcion="El desglose del handoff por motivo: pidió humano, intent desconocido, pausa manual, bloqueador sin resolver."
  falta="registrar el motivo del handoff. La sesión termina en requiere_humano sin guardar qué lo disparó, así que los cuatro motivos no se pueden separar: hoy solo se sabe el total."
/>
```

por:

```tsx
<Seccion
  titulo="Por qué se escaló a humano"
  extra={cantidad(
    m.razonesEscalado.reduce((acc, r) => acc + r.cantidad, 0),
    "escalado",
  )}
  nota="Cada pausa registrada en handoff_events, con su motivo."
>
  <BarraReparto
    vacio="Ninguna conversación se escaló a humano en el período."
    partes={m.razonesEscalado.map((r, i) => ({
      label: r.motivo,
      cantidad: r.cantidad,
      color: COLORES_RAZON[i % COLORES_RAZON.length],
    }))}
  />
</Seccion>
```

Agregar arriba del componente `PanelVendedores`, junto a las demás constantes del módulo:

```ts
const COLORES_RAZON = [
  "var(--color-brand)",
  "var(--color-info)",
  "var(--color-danger)",
  "var(--color-ok)",
  "#E879F9",
  "#FB923C",
];
```

`BarraReparto` ya resuelve el estado vacío con texto plano sin borde punteado (`BarraReparto.tsx:19-21`) — es exactamente el patrón que la sesión de brainstorming había decidido para "mide bien pero 0 filas", sin necesidad de un componente nuevo.

Quitar el import de `BloqueFaltante` si ya no se usa en el archivo (verificar con `grep -n "BloqueFaltante" src/components/metricas/PanelVendedores.tsx`); dejar `KpiFaltante` si sigue usándose (lo usa "Ticket promedio", que este mismo task resuelve — ver Step 2).

- [ ] **Step 2: Resolver el `KpiFaltante` de "Ticket promedio"**

En `src/components/metricas/PanelVendedores.tsx:101-104`, reemplazar:

```tsx
<KpiFaltante
  label="Ticket promedio"
  falta="un monto por sesión cerrada. lead_session.precio_cotizado es lo que se cotizó, no lo que se facturó, y no hay tabla de venta ni de orden."
/>
```

por (mismo patrón condicional que en `PanelTotal.tsx`):

```tsx
{
  m.ventas.montoTotalUsd === null ? (
    <KpiFaltante
      label="Ticket promedio"
      falta="ninguna de las ventas tomadas por humano tiene precio_cotizado registrado."
    />
  ) : (
    <TarjetaKpi
      label="Ticket promedio"
      valor={formatearUsd(m.ventas.ticketPromedioUsd ?? 0)}
      subtitulo={`sobre ${formatearEntero(m.ventas.conPrecio)} ventas con precio (todas las fuentes)`}
      icono={TaskAlt}
    />
  );
}
```

Nota honesta a dejar en el commit: esta tarjeta vive en el corte "Vendedores" pero `m.ventas` es del total del período, no solo de las tomadas por humano — separar ticket promedio por IA/vendedor es trabajo nuevo fuera de este plan (no hay campo que distinga qué ventas cerró un humano vs la IA con este detalle, más allá de `cierres.vendedor`/`cierres.ia` que son conteos, no montos). El subtítulo lo dice explícito para no insinuar un corte que no existe.

- [ ] **Step 3: Corregir la tarjeta "Tiempo hasta tomar" con dos fuentes distintas**

En `src/components/metricas/PanelVendedores.tsx:107-116`, el valor sale de `m.vendedores.tomaEnSegundos` pero el subtítulo cuenta muestras de `m.tiempoPrimeraRespuesta.personas.muestras` — dos cálculos distintos. Reemplazar el subtítulo para que cuente sobre la misma población que el valor: la cantidad de filas de `vendedores.filas` con `tomaEnSegundos` no nulo, sumado a las esperas ya contadas en el cálculo global. La forma más simple y correcta es agregar `muestras` a `Metricas["vendedores"]` en el servicio en vez de parchear en la UI — pero eso es scope-creep de esta pantalla puntual. Fix mínimo correcto en la UI: usar el mismo array de esperas que ya construye `m.vendedores.tomaEnSegundos` no es accesible desde acá (está agregado en el servicio). Optar por el fix de servicio, mínimo:

En `src/types/metricas.ts`, agregar a `Metricas["vendedores"]`:

```ts
/** Cuántas esperas entraron en la mediana global — mismo denominador que `tomaEnSegundos`. */
muestras: number;
```

En `src/server/services/metricas/default-metricas.service.ts`, función `repartirPorVendedor` (línea ~415-484), en el `return` final:

```ts
return {
  filas,
  sinAtribuir,
  tomaEnSegundos: medianaSegundos(esperasGlobales),
  muestras: esperasGlobales.length,
};
```

En `PanelVendedores.tsx`, cambiar el subtítulo de la tarjeta:

```tsx
<TarjetaKpi
  label="Tiempo hasta tomar"
  valor={formatearEspera(m.vendedores.tomaEnSegundos)}
  subtitulo={
    m.vendedores.muestras === 0
      ? "Sin datos medibles"
      : `${formatearEntero(m.vendedores.muestras)} muestras con timestamp de Meta`
  }
  icono={Schedule}
/>
```

- [ ] **Step 4: Agregar el KPI "Tiempo promedio en cerrar"**

En el mismo grid de KPIs, después de "Tiempo hasta tomar":

```tsx
<TarjetaKpi
  label="Tiempo en cerrar"
  valor={formatearEspera(m.tiempoCierre.medianaSegundos)}
  subtitulo={
    m.tiempoCierre.muestras === 0
      ? "Sin sesiones resueltas"
      : `mediana sobre ${formatearEntero(m.tiempoCierre.muestras)} sesiones resueltas`
  }
  icono={DoneAll}
/>
```

Va a quedar un grid de 5 KPIs en vez de 4 — cambiar el `className` del contenedor de `sm:grid-cols-2 xl:grid-cols-4` a `sm:grid-cols-2 xl:grid-cols-5` para que no se acumulen en una fila de 4+1 descolgado.

Agregar el import `DoneAll` a `@/components/icons` en la cabecera del archivo.

- [ ] **Step 5: Actualizar el test unitario de `metricas-service.test.ts` para `vendedores.muestras`**

Buscar los tests existentes que arman `expect(m.vendedores)...` o similar y agregar la propiedad `muestras` esperada donde corresponda (si no hay ningún assert exacto sobre el objeto completo, no hace falta tocar nada — TypeScript ya obliga a que el fixture/expectativa compile).

```bash
npm run typecheck
```

Expected: si algún test compara `m.vendedores` con `toEqual` de un objeto literal sin `muestras`, el test falla en runtime (no en typecheck, porque `toEqual` no es tipado estricto) — correr también:

```bash
npx vitest run tests/unit/metricas-service.test.ts
```

Si hay un `toEqual` roto por el campo nuevo, agregar `muestras: <N>` al objeto esperado con el valor real que imprime el test al fallar.

- [ ] **Step 6: Verificar en el navegador**

```bash
npm run dev
```

Navegar a `http://localhost:3001/metricas?tab=vendedores` y confirmar: "Por qué se escaló a humano" muestra la barra o el texto de vacío (no más el bloque punteado), "Ticket promedio" muestra el KPI real o su faltante actualizado, aparece "Tiempo en cerrar".

- [ ] **Step 7: `npm run typecheck` + `npm run lint` + `npm run test`**

```bash
npm run typecheck && npm run lint && npm run test
```

Expected: 0 errores, 0 warnings nuevos, todos los tests PASS con el número real reportado.

- [ ] **Step 8: Commit**

```bash
git add src/components/metricas/PanelVendedores.tsx src/types/metricas.ts src/server/services/metricas/default-metricas.service.ts tests/unit/metricas-service.test.ts
git commit -m "fix(metricas): handoff real, ticket promedio y tiempo en cerrar en Vendedores"
```

---

## Task 13: `CampaniaFormDialog.tsx` + `GestionCampanias.tsx`

**Files:**

- Create: `src/components/metricas/CampaniaFormDialog.tsx`
- Create: `src/components/metricas/GestionCampanias.tsx`

**Interfaces:**

- Consumes: `crearCampaniaAction`, `editarCampaniaAction`, `borrarCampaniaAction` (Task 9), `Campania` (Task 4).

- [ ] **Step 1: `CampaniaFormDialog.tsx`, modelado sobre `TagFormDialog.tsx`**

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
import { Input } from "@/components/ui/input";
import type { ComponentProps } from "react";
import type { ActionResult } from "@/types/inbox";
import type { Campania } from "@/types/entities";

function aInputDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export interface CampaniaFormValues {
  nombre: string;
  desde: string;
  hasta: string;
}

export function CampaniaFormDialog({
  title,
  description,
  triggerLabel,
  triggerVariant = "default",
  initial,
  onSubmit,
}: {
  title: string;
  description: string;
  triggerLabel: string;
  triggerVariant?: ComponentProps<typeof Button>["variant"];
  initial?: Campania;
  onSubmit: (values: CampaniaFormValues) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const submit = (formData: FormData) => {
    const values: CampaniaFormValues = {
      nombre: String(formData.get("nombre") ?? "").trim(),
      desde: String(formData.get("desde") ?? ""),
      hasta: String(formData.get("hasta") ?? ""),
    };
    startTransition(async () => {
      const result = await onSubmit(values);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(initial ? "Campaña actualizada" : "Campaña creada");
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant={triggerVariant} size="sm" />}>
        {triggerLabel}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form action={submit} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground text-xs">Nombre *</span>
            <Input
              name="nombre"
              required
              minLength={2}
              maxLength={60}
              defaultValue={initial?.nombre ?? ""}
              disabled={isPending}
              autoComplete="off"
            />
          </label>
          <div className="flex gap-3">
            <label className="flex flex-1 flex-col gap-1 text-sm">
              <span className="text-muted-foreground text-xs">Desde *</span>
              <Input
                type="date"
                name="desde"
                required
                defaultValue={initial ? aInputDate(initial.desde) : ""}
                disabled={isPending}
              />
            </label>
            <label className="flex flex-1 flex-col gap-1 text-sm">
              <span className="text-muted-foreground text-xs">Hasta *</span>
              <Input
                type="date"
                name="hasta"
                required
                defaultValue={initial ? aInputDate(initial.hasta) : ""}
                disabled={isPending}
              />
            </label>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={isPending}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Guardando…" : "Guardar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: `GestionCampanias.tsx`**

```tsx
"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { borrarCampaniaAction } from "@/app/(panel)/metricas/_actions/borrar-campania.action";
import { crearCampaniaAction } from "@/app/(panel)/metricas/_actions/crear-campania.action";
import { editarCampaniaAction } from "@/app/(panel)/metricas/_actions/editar-campania.action";
import { CampaniaFormDialog } from "@/components/metricas/CampaniaFormDialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { Campania } from "@/types/entities";

function fmt(d: Date): string {
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function GestionCampanias({ campanias }: { campanias: Campania[] }) {
  const router = useRouter();

  const borrar = async (id: string) => {
    const result = await borrarCampaniaAction({ id });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Campaña borrada");
    router.refresh();
  };

  return (
    <Dialog>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>Campañas</DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Campañas</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <CampaniaFormDialog
            title="Nueva campaña"
            description="Nombre y ventana de fechas. Filtra Métricas por leads.created_at dentro del rango — todavía sin atribución real."
            triggerLabel="Nueva campaña"
            onSubmit={(v) => crearCampaniaAction(v)}
          />
          {campanias.length === 0 ? (
            <p className="text-muted-foreground text-sm">Todavía no hay campañas creadas.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {campanias.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">
                    {c.nombre}{" "}
                    <span className="text-muted-foreground text-xs">
                      {fmt(c.desde)} – {fmt(c.hasta)}
                    </span>
                  </span>
                  <div className="flex shrink-0 gap-1">
                    <CampaniaFormDialog
                      title="Editar campaña"
                      description="Cambiar nombre o ventana de fechas."
                      triggerLabel="Editar"
                      triggerVariant="outline"
                      initial={c}
                      onSubmit={(v) => editarCampaniaAction({ ...v, id: c.id })}
                    />
                    <Button variant="destructive" size="sm" onClick={() => borrar(c.id)}>
                      Borrar
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: `npm run typecheck` + `npm run lint`**

```bash
npm run typecheck && npm run lint
```

Expected: 0 errores.

- [ ] **Step 4: Commit**

```bash
git add src/components/metricas/CampaniaFormDialog.tsx src/components/metricas/GestionCampanias.tsx
git commit -m "feat(campanias): modal de gestion desde Metricas"
```

---

## Task 14: `SelectorRango.tsx` + wiring en `page.tsx`

**Files:**

- Create: `src/components/metricas/SelectorRango.tsx`
- Modify: `src/app/(panel)/metricas/page.tsx`

**Interfaces:**

- Consumes: `GestionCampanias` (Task 13), `getCampaniasAdminServiceForRequest` (Task 7), `getMetricsServiceForRequest` (existente).

- [ ] **Step 1: `SelectorRango.tsx`**

```tsx
"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { GestionCampanias } from "@/components/metricas/GestionCampanias";
import { cn } from "@/lib/utils";
import type { Campania } from "@/types/entities";

const ATAJOS = [7, 30, 90] as const;

function aInputDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function rangoDeAtajo(dias: number): { desde: string; hasta: string } {
  const hasta = new Date();
  const desde = new Date(hasta.getTime() - dias * 24 * 60 * 60 * 1000);
  return { desde: aInputDate(desde), hasta: aInputDate(hasta) };
}

export function SelectorRango({
  tab,
  desde,
  hasta,
  campaniaId,
  campanias,
}: {
  tab: string;
  desde: string;
  hasta: string;
  campaniaId: string | null;
  campanias: Campania[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const irA = (params: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(params)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    router.replace(`${pathname}?${next.toString()}`);
  };

  const atajoActivo = ATAJOS.find((n) => {
    const r = rangoDeAtajo(n);
    return r.desde === desde && r.hasta === hasta && campaniaId === null;
  });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1">
        {ATAJOS.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => irA({ ...rangoDeAtajo(n), tab, campania: null })}
            className={cn(
              "rounded-[20px] border px-2.5 py-[4.5px] text-[11.5px] font-medium transition-colors",
              atajoActivo === n
                ? "bg-surface-avatar border-line-control text-ink-primary"
                : "border-line-card text-ink-dim hover:bg-surface-hover",
            )}
          >
            {n} días
          </button>
        ))}
      </div>

      <input
        type="date"
        value={desde}
        onChange={(e) => irA({ desde: e.target.value, tab, campania: null })}
        className="border-line-card bg-surface-card text-ink-dim rounded-[8px] border px-2 py-1 text-[11.5px]"
        aria-label="Desde"
      />
      <span className="text-ink-ghost text-[11px]">–</span>
      <input
        type="date"
        value={hasta}
        onChange={(e) => irA({ hasta: e.target.value, tab, campania: null })}
        className="border-line-card bg-surface-card text-ink-dim rounded-[8px] border px-2 py-1 text-[11.5px]"
        aria-label="Hasta"
      />

      {campanias.length > 0 ? (
        <select
          value={campaniaId ?? ""}
          onChange={(e) => {
            const id = e.target.value;
            if (!id) return;
            const c = campanias.find((x) => x.id === id);
            if (!c) return;
            irA({ desde: aInputDate(c.desde), hasta: aInputDate(c.hasta), campania: id, tab });
          }}
          className="border-line-card bg-surface-card text-ink-dim rounded-[8px] border px-2 py-1 text-[11.5px]"
          aria-label="Campaña"
        >
          <option value="">Campaña…</option>
          {campanias.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre}
            </option>
          ))}
        </select>
      ) : null}

      <GestionCampanias campanias={campanias} />
    </div>
  );
}
```

Nota: si `campaniaId` está seteado, la ventana usa `leads.created_at` como proxy — la atribución real no existe todavía (Global Constraints). No hay texto adicional en este componente porque el proxy no cambia el cálculo del service, que ya opera sobre `desde/hasta`; la aclaración de "por fecha, sin atribución" queda para cuando se muestre el nombre de la campaña activa en el header, fuera del alcance mínimo de este task — anotarlo en el spec de deuda si no se hace acá.

- [ ] **Step 2: Reescribir `page.tsx`**

Reemplazar el archivo completo:

```tsx
import { PanelMetricas } from "@/components/metricas/PanelMetricas";
import { PestanasMetricas } from "@/components/metricas/PestanasMetricas";
import { SelectorRango } from "@/components/metricas/SelectorRango";
import { PageHeader } from "@/components/shared/PageHeader";
import { getCampaniasAdminServiceForRequest } from "@/server/bootstrap/campanias-bootstrap";
import { getMetricsServiceForRequest } from "@/server/bootstrap/metricas-bootstrap";
import { TABS_METRICAS } from "@/types/metricas";
import type { TabMetricas } from "@/types/metricas";

export const dynamic = "force-dynamic";

const TAB_POR_DEFECTO: TabMetricas = "total";
const DIA_MS = 24 * 60 * 60 * 1000;

function leerTab(valor: string | string[] | undefined): TabMetricas {
  return typeof valor === "string" && (TABS_METRICAS as readonly string[]).includes(valor)
    ? (valor as TabMetricas)
    : TAB_POR_DEFECTO;
}

function leerFecha(valor: string | string[] | undefined, porDefecto: Date): Date {
  if (typeof valor !== "string") return porDefecto;
  const parsed = new Date(`${valor}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? porDefecto : parsed;
}

export default async function MetricasPage({
  searchParams,
}: {
  searchParams: Promise<{
    desde?: string | string[];
    hasta?: string | string[];
    tab?: string | string[];
    campania?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const tab = leerTab(params.tab);
  const hastaPorDefecto = new Date();
  const desdePorDefecto = new Date(hastaPorDefecto.getTime() - 30 * DIA_MS);
  const desde = leerFecha(params.desde, desdePorDefecto);
  const hasta = leerFecha(params.hasta, hastaPorDefecto);
  const campaniaId = typeof params.campania === "string" ? params.campania : null;

  const [svc, campaniasSvc] = await Promise.all([
    getMetricsServiceForRequest(),
    getCampaniasAdminServiceForRequest(),
  ]);
  const [m, campanias] = await Promise.all([svc.obtener(desde, hasta), campaniasSvc.listar()]);

  return (
    <div className="bg-surface-root flex h-full flex-col overflow-hidden">
      <PageHeader
        title="Métricas"
        subtitle={`últimos ${m.dias} días`}
        actions={
          <SelectorRango
            tab={tab}
            desde={desde.toISOString().slice(0, 10)}
            hasta={hasta.toISOString().slice(0, 10)}
            campaniaId={campaniaId}
            campanias={campanias}
          />
        }
      />
      <PestanasMetricas activa={tab} dias={m.dias} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <PanelMetricas m={m} tab={tab} />
      </div>
    </div>
  );
}
```

`PestanasMetricas` recibe `dias` para armar sus propios links (`?dias=${v}&tab=${tab}` internamente, hay que revisar su implementación) — verificar `src/components/metricas/PestanasMetricas.tsx` y actualizar sus `href` para preservar `desde`/`hasta`/`campania` en vez de `dias` si construye URLs propias.

- [ ] **Step 3: Revisar y ajustar `PestanasMetricas.tsx`**

```bash
cat "src/components/metricas/PestanasMetricas.tsx"
```

Si construye `href={`/metricas?dias=${dias}&tab=${t}`}`, cambiarlo a recibir `desde`/`hasta` como props y armar `href={`/metricas?desde=${desde}&hasta=${hasta}&tab=${t}`}`, pasando esos props desde `page.tsx` igual que a `SelectorRango`.

- [ ] **Step 4: Verificar en el navegador**

```bash
npm run dev
```

Navegar a `http://localhost:3001/metricas`, confirmar que los atajos 7/30/90 siguen funcionando, que los inputs de fecha cambian la URL y el contenido, y que el selector de campaña (si hay alguna creada) también.

- [ ] **Step 5: `npm run typecheck` + `npm run lint`**

```bash
npm run typecheck && npm run lint
```

Expected: 0 errores en ambos.

- [ ] **Step 6: Commit**

```bash
git add src/components/metricas/SelectorRango.tsx src/components/metricas/PestanasMetricas.tsx "src/app/(panel)/metricas/page.tsx"
git commit -m "feat(metricas): rango de fechas libre y selector de campana"
```

---

## Task 15: Verificación final de pantalla

**Files:** ninguno — solo comandos.

- [ ] **Step 1: Suite completa**

```bash
npm run typecheck
npm run lint
npm run test
```

Expected: 0 errores de typecheck, 0 errores de lint, todos los tests unitarios PASS — reportar el número real (`X/X`).

- [ ] **Step 2: Contract tests nuevos contra InMemory**

```bash
npx vitest run tests/unit/campanias-repo.test.ts tests/unit/campanias-admin-service.test.ts tests/repositories/metrics.contract.ts
```

Expected: todos PASS.

- [ ] **Step 3: Decir en voz alta lo que queda sin verificar**

No forma parte de un "step" ejecutable — es contenido del reporte de cierre de pantalla (AGENTS.md §5.1):

- `test:integration` sigue congelado — `campanias.supabase.repo.ts` y las columnas nuevas de `metrics.supabase.repo.ts` nunca corrieron contra Postgres real.
- Sin revisión visual humana — el panel del navegador no compone frames sin estar desplegado (misma limitación de siempre).
- La atribución real de campaña (Meta `ctwa_clid`) no se implementó — el filtro por campaña sigue siendo proxy por fecha.
- El ticket promedio de "Vendedores" mezcla todas las ventas del período, no solo las cerradas por humano — señalado explícitamente en el subtítulo de esa tarjeta.

- [ ] **Step 4: Commit final si quedó algo suelto**

```bash
git status --short
```

Si hay cambios sin commitear (por ejemplo ajustes de lint automáticos), commitearlos con mensaje descriptivo antes de cerrar.

---

## Self-Review (completado antes de guardar el plan)

**Cobertura del spec:**

- §4 Schema → Task 1. §5 Repo → Tasks 2-3. §6 Servicio → Task 8. §7 UI Total/Vendedores → Tasks 11-12. §7 Campañas → Tasks 4-7, 9, 13-14. §2 decisión "estado vacío de handoff" → Task 12 Step 1 (reutiliza `BarraReparto`, no un componente nuevo). §3 limitación de carrito → nota visible en Task 11 Step 3. §8 fuera de alcance → respetado, ningún task lo toca.
- Todos los ítems de la tabla de decisiones (§2) están reflejados en algún task.

**Placeholders:** ninguno — cada step tiene código completo o comando ejecutable exacto.

**Consistencia de tipos:** `Ventas`, `ConteoCodigo`, `FilaCampaniaMetrica`, `CampaniasRepository`, `CampaniasAdminService` usan los mismos nombres de campo en todos los tasks que los consumen (verificado: `montoTotalUsd`, `ticketPromedioUsd`, `conPrecio`, `codigoInterno`, `apariciones`, `unidades`, `unidadesConDato` idénticos en Task 8 y Task 11-12).

**Corrección hecha en el propio plan:** Task 2 no incluyó `cantidad` en `FilaSesionMetrica` (el spec no lo pedía explícitamente como columna de repo), pero Task 8 lo necesita para `codigosMasVendidos.unidades` — corregido inline en Task 8 Step 4 en vez de dejarlo como gap silencioso.
