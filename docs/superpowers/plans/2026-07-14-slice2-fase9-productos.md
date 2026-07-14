# Slice 2 — Fase 9 Productos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vista `/productos` completa: lista con búsqueda (9.A), CRUD admin vía dialogs + Server Actions (9.B), import CSV con preview de errores por fila y upsert por `codigo_interno` (9.C).

**Architecture:** Patrón idéntico a Slice 2 8.x: RSC fetch vía service per-request (client authed + RLS) → `CatalogService` nuevo sobre `ProductsRepository` existente → Server Actions con Zod parse línea 1 y `ActionResult` → client components reciben la action como prop + toast sonner. Rol-aware UI vía `getCurrentRol()` nuevo (JWT `app_metadata.rol`); la authz real la enforcea RLS (productos: R ambos / W admin).

**Tech Stack:** Next.js 16 App Router (RSC + Server Actions), Tailwind v4 + shadcn/ui (Base UI: `DialogTrigger render={...}`), Supabase (RLS), Zod 4, Vitest, papaparse (dep nueva aprobada en spec).

**Spec:** `docs/superpowers/specs/2026-07-14-slice2-vistas-9-12-design.md` §Fase 9.

## Global Constraints

Copiadas de `AGENTS.md` (aplican a TODAS las tasks):

- **Server Actions = Zod parse primera línea.** Toda `'use server'` action: `Schema.safeParse` antes de cualquier lógica.
- **`console.log` prohibido en `src/**`.** Solo `logger.\*` (`getLogger`de`@/lib/observability/get-logger`).
- **`DomainError` jerarquía siempre** en `src/server/**`: `ValidationError`, `NotFoundError`, `ConflictError`, etc. Prohibido `throw new Error('msg')`.
- **Capas: Action → Service → Repository → DB. Nunca saltar capas.**
- **Idioma:** UI, comentarios y commits en español. Identificadores de dominio en español, técnicos genéricos en inglés.
- **Commits:** Conventional Commits, subject ≤72 chars, español. Pre-commit hooks lefthook corren eslint+prettier — no bypasear.
- **shadcn:** extender vía composición; NO editar `src/components/ui/`.
- **TypeScript:** strict + `noUncheckedIndexedAccess`. No `any`. (`tsconfig.tests.json` relaja indexedAccess en tests.)
- **Coverage threshold:** 80/75/80/80. UI se valida browser (Playwright), no unit.
- **PII:** productos NO es PII — sin restricciones extra de logging en esta fase.
- **Skill discipline (AGENTS regla 7/11):** antes de cada task invocar los skills listados en su campo "Skills".
- **Usuario dev panel local:** `admin-dev@crm.local` / `dev-admin-2026!` (solo crm-dev).

## File Structure

```
src/server/auth/guards.ts                                  MODIFY  reemplaza stub: rolFromUser + getCurrentRol
src/server/services/catalog/catalog.service.ts             CREATE  interface CatalogService + input types
src/server/services/catalog/default-catalog.service.ts     CREATE  impl DI sobre ProductsRepository
src/server/services/catalog/csv-import.ts                  CREATE  parseProductosCsv (papaparse + Zod por fila)
src/server/bootstrap/catalog-bootstrap.ts                  CREATE  makeCatalogService + getCatalogServiceForRequest
src/server/repositories/productos.repo.ts                  MODIFY  bulkUpsert firma CSV-safe (ProductoBulkUpsertItem)
src/server/repositories/productos.supabase.repo.ts         MODIFY  bulkUpsert defaultToNull:false, sin columnas no-CSV; list con order
src/lib/validation/productos.schema.ts                     CREATE  Create/Update/SetActivo/CsvRow schemas
src/types/productos.ts                                     CREATE  ImportPreview/ImportResult/CsvRowError + action results
src/app/(panel)/productos/page.tsx                         MODIFY  reemplaza stub: lista + búsqueda + header rol-aware
src/app/(panel)/productos/loading.tsx                      CREATE  skeleton
src/app/(panel)/productos/_actions/action-error.ts         CREATE  toActionError copy productos
src/app/(panel)/productos/_actions/create-producto.action.ts CREATE
src/app/(panel)/productos/_actions/update-producto.action.ts CREATE
src/app/(panel)/productos/_actions/set-producto-activo.action.ts CREATE
src/app/(panel)/productos/import/page.tsx                  MODIFY  reemplaza stub: gate admin + ImportCsv
src/app/(panel)/productos/import/_actions/import.actions.ts CREATE  preview + confirm actions
src/app/api/productos/import/route.ts                      DELETE  stub 501 muerto (Server Actions lo reemplazan)
src/components/productos/ProductosTable.tsx                CREATE  tabla shadcn
src/components/productos/ProductoFormDialog.tsx            CREATE  dialog create/edit
src/components/productos/ProductoRowActions.tsx            CREATE  editar + toggle activo por fila
src/components/productos/ImportCsv.tsx                     CREATE  upload → preview → confirm
tests/unit/auth-guards.test.ts                             CREATE
tests/unit/productos-schema.test.ts                        CREATE
tests/unit/services/catalog-service.test.ts                CREATE
tests/unit/services/csv-import.test.ts                     CREATE
tests/repositories/productos.contract.ts                   MODIFY  bulkUpsert shape nuevo + 2 tests + order list
tests/unit/errors-integration.test.ts                      MODIFY  item bulkUpsert sin campos no-CSV
```

Orden de ejecución = orden de tasks (9.A: T1-T4 · 9.B: T5-T6 · 9.C: T7-T9 · cierre: T10). Dependencias lineales.

---

### Task 1: `getCurrentRol()` helper rol-aware

**Skills:** `superpowers:test-driven-development`, `supabase:supabase` (claims JWT).

**Files:**

- Modify: `src/server/auth/guards.ts` (hoy stub vacío `export {}`)
- Test: `tests/unit/auth-guards.test.ts`

**Interfaces:**

- Consumes: `getAuthenticatedUser()` de `src/server/auth/supabase-ssr.ts` (existente), `RolUsuarioSchema` de `@/lib/validation/schemas`, `RolUsuario` de `@/types/domain` (`"admin" | "vendedor"`).
- Produces: `rolFromUser(user: User | null): RolUsuario` (pura, testeable) y `getCurrentRol(): Promise<RolUsuario>` — las consumen Tasks 4, 5 y 8.

- [ ] **Step 1: Write the failing test**

`tests/unit/auth-guards.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { rolFromUser } from "@/server/auth/guards";
import type { User } from "@supabase/supabase-js";

function fakeUser(appMetadata: Record<string, unknown>): User {
  return { app_metadata: appMetadata } as unknown as User;
}

describe("rolFromUser", () => {
  test("admin cuando app_metadata.rol = admin", () => {
    expect(rolFromUser(fakeUser({ rol: "admin" }))).toBe("admin");
  });

  test("vendedor cuando app_metadata.rol = vendedor", () => {
    expect(rolFromUser(fakeUser({ rol: "vendedor" }))).toBe("vendedor");
  });

  test("fallback vendedor cuando rol ausente", () => {
    expect(rolFromUser(fakeUser({}))).toBe("vendedor");
  });

  test("fallback vendedor cuando rol inválido", () => {
    expect(rolFromUser(fakeUser({ rol: "superuser" }))).toBe("vendedor");
  });

  test("fallback vendedor cuando user es null", () => {
    expect(rolFromUser(null)).toBe("vendedor");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/auth-guards.test.ts`
Expected: FAIL — `rolFromUser` no exportado (guards.ts es stub).

- [ ] **Step 3: Write minimal implementation**

Reemplazar contenido completo de `src/server/auth/guards.ts`:

```ts
import { RolUsuarioSchema } from "@/lib/validation/schemas";
import { getAuthenticatedUser } from "./supabase-ssr";
import type { RolUsuario } from "@/types/domain";
import type { User } from "@supabase/supabase-js";

/**
 * Rol desde app_metadata (solo seteable server-side; user_metadata es editable
 * por el cliente — nunca leer rol de ahí). Fallback vendedor = mínimo
 * privilegio. Solo para UI rol-aware — la authz real la enforcea RLS.
 */
export function rolFromUser(user: User | null): RolUsuario {
  const parsed = RolUsuarioSchema.safeParse(user?.app_metadata?.rol);
  return parsed.success ? parsed.data : "vendedor";
}

/** Rol del usuario autenticado del request actual (RSC / Server Action). */
export async function getCurrentRol(): Promise<RolUsuario> {
  return rolFromUser(await getAuthenticatedUser());
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/auth-guards.test.ts`
Expected: PASS 5/5.

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git add src/server/auth/guards.ts tests/unit/auth-guards.test.ts
git commit -m "feat(auth): rolFromUser + getCurrentRol para UI rol-aware"
```

---

### Task 2: Orden determinístico en `ProductsRepository.list`

Para que la lista pagine/corte de forma estable (cap 1000 en service, Task 3) el repo debe ordenar. Hoy `list()` no ordena (InMemory = insertion order, Supabase = undefined).

**Skills:** `superpowers:test-driven-development`, `supabase:supabase-postgres-best-practices`.

**Files:**

- Modify: `tests/repositories/productos.contract.ts` (agrega 1 test)
- Modify: `src/server/repositories/productos.repo.ts` (InMemory `list`)
- Modify: `src/server/repositories/productos.supabase.repo.ts` (`list` con `.order`)

**Interfaces:**

- Produces: `list(filter?)` ahora garantiza orden `nombre asc, codigo_interno asc` (tiebreak único → total order estable para limit/offset). Sin cambio de firma.

- [ ] **Step 1: Write the failing contract test**

En `tests/repositories/productos.contract.ts`, después del test `"list respeta limit + offset"` agregar:

```ts
test("list ordena por nombre asc con tiebreak codigo_interno", async () => {
  await repo.create(baseInsert({ codigo_interno: "Z-9", nombre: "Zapata" }));
  await repo.create(baseInsert({ codigo_interno: "A-2", nombre: "Amortiguador" }));
  await repo.create(baseInsert({ codigo_interno: "A-1", nombre: "Amortiguador" }));

  const all = await repo.list();
  expect(all.map((p) => p.codigo_interno)).toEqual(["A-1", "A-2", "Z-9"]);
});
```

Nota: evitar acentos/mayúsculas mezcladas en fixtures de orden — la collation de Postgres y `localeCompare` difieren en esos casos; el contract usa ASCII simple.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/repositories`
Expected: FAIL en el test nuevo (InMemory devuelve insertion order `Z-9, A-2, A-1`).

- [ ] **Step 3: Implement InMemory + Supabase**

En `src/server/repositories/productos.repo.ts`, método `list` de `InMemoryProductsRepository` — insertar el sort después de los filtros y antes del slice:

```ts
  async list(filter: ProductoListFilter = {}): Promise<Producto[]> {
    let rows = Array.from(this.store.values());
    if (filter.q) {
      const q = filter.q.toLowerCase();
      rows = rows.filter(
        (p) => p.nombre.toLowerCase().includes(q) || p.codigo_interno.toLowerCase().includes(q),
      );
    }
    if (filter.activo !== undefined) {
      rows = rows.filter((p) => p.activo === filter.activo);
    }
    // Orden estable nombre + codigo_interno (paridad con ORDER BY de Supabase impl).
    rows.sort(
      (a, b) =>
        a.nombre.localeCompare(b.nombre) || a.codigo_interno.localeCompare(b.codigo_interno),
    );
    const offset = filter.offset ?? 0;
    const limit = filter.limit ?? rows.length;
    return rows.slice(offset, offset + limit).map(cloneProducto);
  }
```

En `src/server/repositories/productos.supabase.repo.ts`, método `list` — reemplazar la primera línea del query:

```ts
let query = this.db
  .from("productos")
  .select()
  .order("nombre", { ascending: true })
  .order("codigo_interno", { ascending: true });
```

(el resto del método queda igual).

- [ ] **Step 4: Run unit suite**

Run: `npx vitest run tests/unit`
Expected: PASS (contract corre contra InMemory en unit).

- [ ] **Step 5: Commit**

```bash
git add tests/repositories/productos.contract.ts src/server/repositories/productos.repo.ts src/server/repositories/productos.supabase.repo.ts
git commit -m "feat(repo): productos.list ordena nombre + codigo_interno"
```

(La verificación contra Supabase real corre en Task 7 Step 6 junto con los cambios de bulkUpsert — un solo round de integration.)

---

### Task 3: `CatalogService.listProductos` + bootstrap per-request

**Skills:** `superpowers:test-driven-development`.

**Files:**

- Create: `src/server/services/catalog/catalog.service.ts`
- Create: `src/server/services/catalog/default-catalog.service.ts`
- Create: `src/server/bootstrap/catalog-bootstrap.ts`
- Test: `tests/unit/services/catalog-service.test.ts`

**Interfaces:**

- Consumes: `ProductsRepository` + `InMemoryProductsRepository` + `ProductoInsert` de `@/server/repositories/productos.repo`; `SupabaseProductsRepository` de `@/server/repositories/productos.supabase.repo`; `createSupabaseServerClient` de `@/server/auth/supabase-ssr`; `AppClient` de `@/server/db/client`.
- Produces:
  - `interface CatalogService { listProductos(input?: { q?: string }): Promise<Producto[]> }` (crece en Tasks 5 y 8).
  - `class DefaultCatalogService` con deps `{ productos: ProductsRepository }`.
  - `makeCatalogService(db: AppClient): CatalogService` y `getCatalogServiceForRequest(): Promise<CatalogService>` — los consumen todas las pages/actions de productos.

- [ ] **Step 1: Write the failing test**

`tests/unit/services/catalog-service.test.ts`:

```ts
import { beforeEach, describe, expect, test } from "vitest";
import { InMemoryProductsRepository } from "@/server/repositories/productos.repo";
import { DefaultCatalogService } from "@/server/services/catalog/default-catalog.service";
import type { ProductoInsert } from "@/server/repositories/productos.repo";

function baseInsert(overrides: Partial<ProductoInsert> = {}): ProductoInsert {
  return {
    codigo_interno: "PF-001",
    sku_proveedor: null,
    nombre: "Pastilla freno",
    descripcion: null,
    categoria: "frenos",
    compatibilidad: [],
    precio: 100,
    stock: 5,
    imagen_url: null,
    activo: true,
    ...overrides,
  };
}

describe("DefaultCatalogService.listProductos", () => {
  let repo: InMemoryProductsRepository;
  let svc: DefaultCatalogService;

  beforeEach(() => {
    repo = new InMemoryProductsRepository();
    svc = new DefaultCatalogService({ productos: repo });
  });

  test("delega al repo y devuelve orden del repo (nombre asc)", async () => {
    await repo.create(baseInsert({ codigo_interno: "B", nombre: "Zapata" }));
    await repo.create(baseInsert({ codigo_interno: "A", nombre: "Amortiguador" }));
    const r = await svc.listProductos();
    expect(r.map((p) => p.nombre)).toEqual(["Amortiguador", "Zapata"]);
  });

  test("filtra por q trimmeado (nombre o codigo)", async () => {
    await repo.create(baseInsert({ codigo_interno: "FA-99", nombre: "Filtro aire" }));
    await repo.create(baseInsert({ codigo_interno: "PA-01", nombre: "Pastilla" }));
    const r = await svc.listProductos({ q: "  filtro  " });
    expect(r).toHaveLength(1);
    expect(r[0]?.codigo_interno).toBe("FA-99");
  });

  test("q vacío o whitespace = sin filtro", async () => {
    await repo.create(baseInsert());
    const r = await svc.listProductos({ q: "   " });
    expect(r).toHaveLength(1);
  });

  test("incluye inactivos (baja lógica visible en catálogo)", async () => {
    await repo.create(baseInsert({ codigo_interno: "IN-1", activo: false }));
    const r = await svc.listProductos();
    expect(r).toHaveLength(1);
    expect(r[0]?.activo).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/services/catalog-service.test.ts`
Expected: FAIL — módulo `default-catalog.service` no existe.

- [ ] **Step 3: Write implementation**

`src/server/services/catalog/catalog.service.ts`:

```ts
import type { Producto } from "@/types/entities";

export interface CatalogListInput {
  q?: string;
}

export interface CatalogService {
  /**
   * Catálogo completo (activos + inactivos) ordenado por nombre asc (orden lo
   * garantiza el repo). `q` filtra por nombre o codigo_interno case-insensitive.
   * Cap 1000 filas — pilot ~5K SKUs, la búsqueda acota; paginación diferida.
   */
  listProductos(input?: CatalogListInput): Promise<Producto[]>;
}
```

`src/server/services/catalog/default-catalog.service.ts`:

```ts
import type { ProductsRepository } from "@/server/repositories/productos.repo";
import type { Producto } from "@/types/entities";
import type { CatalogListInput, CatalogService } from "./catalog.service";

// Cap defensivo de la lista (sin paginación v1; la búsqueda acota resultados).
const LIST_LIMIT = 1000;

export interface DefaultCatalogServiceDeps {
  productos: ProductsRepository;
}

export class DefaultCatalogService implements CatalogService {
  constructor(private readonly deps: DefaultCatalogServiceDeps) {}

  async listProductos(input: CatalogListInput = {}): Promise<Producto[]> {
    const q = input.q?.trim();
    return this.deps.productos.list({ q: q || undefined, limit: LIST_LIMIT });
  }
}
```

`src/server/bootstrap/catalog-bootstrap.ts`:

```ts
import { createSupabaseServerClient } from "@/server/auth/supabase-ssr";
import { SupabaseProductsRepository } from "@/server/repositories/productos.supabase.repo";
import { DefaultCatalogService } from "@/server/services/catalog/default-catalog.service";
import type { AppClient } from "@/server/db/client";
import type { CatalogService } from "@/server/services/catalog/catalog.service";

/** Composición pura del service sobre un client dado (authed o service-role en tests). */
export function makeCatalogService(db: AppClient): CatalogService {
  return new DefaultCatalogService({ productos: new SupabaseProductsRepository(db) });
}

/** Panel: service con el client authed del request (RLS real). Uno por request. */
export async function getCatalogServiceForRequest(): Promise<CatalogService> {
  const db = await createSupabaseServerClient();
  return makeCatalogService(db);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/services/catalog-service.test.ts`
Expected: PASS 4/4.

- [ ] **Step 5: Typecheck + lint + commit**

```bash
npm run typecheck && npm run lint
git add src/server/services/catalog/ src/server/bootstrap/catalog-bootstrap.ts tests/unit/services/catalog-service.test.ts
git commit -m "feat(catalog): CatalogService.listProductos + bootstrap per-request"
```

---

### Task 4: UI 9.A — página `/productos` lista + búsqueda

**Skills:** `vercel:nextjs`, `vercel:shadcn`, `frontend-design`, y `webapp-testing` para la validación browser.

**Files:**

- Modify: `src/app/(panel)/productos/page.tsx` (reemplaza stub TODO)
- Create: `src/app/(panel)/productos/loading.tsx`
- Create: `src/components/productos/ProductosTable.tsx`

**Interfaces:**

- Consumes: `getCatalogServiceForRequest()` (Task 3), `getCurrentRol()` (Task 1 — se usa recién en Task 5 para acciones; acá todavía no), `Table/*` + `Badge` de `@/components/ui`, `EmptyState` de `@/components/shared/EmptyState`, `Form` de `next/form`.
- Produces: `ProductosTable({ productos }: { productos: Producto[] })` — Task 5 le agrega props de acciones.

- [ ] **Step 1: Write `ProductosTable`**

`src/components/productos/ProductosTable.tsx` (server component — sin interactividad en 9.A):

```tsx
import { Package } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/shared/EmptyState";
import type { Producto } from "@/types/entities";

const precioFmt = new Intl.NumberFormat("es", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function ProductosTable({ productos }: { productos: Producto[] }) {
  if (productos.length === 0) {
    return (
      <EmptyState
        icon={<Package className="h-10 w-10" />}
        title="Sin productos"
        description="Cargá el catálogo a mano o importá un CSV para que el agente pueda cotizar."
      />
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Código</TableHead>
          <TableHead>Nombre</TableHead>
          <TableHead>Categoría</TableHead>
          <TableHead className="text-right">Precio</TableHead>
          <TableHead className="text-right">Stock</TableHead>
          <TableHead>Estado</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {productos.map((p) => (
          <TableRow key={p.id} className={p.activo ? undefined : "opacity-60"}>
            <TableCell className="font-mono text-xs">{p.codigo_interno}</TableCell>
            <TableCell>
              <span className="font-medium">{p.nombre}</span>
              {p.descripcion ? (
                <span className="text-muted-foreground block max-w-md truncate text-xs">
                  {p.descripcion}
                </span>
              ) : null}
            </TableCell>
            <TableCell className="text-muted-foreground">{p.categoria ?? "—"}</TableCell>
            <TableCell className="text-right tabular-nums">
              $ {precioFmt.format(p.precio)}
            </TableCell>
            <TableCell className="text-right tabular-nums">{p.stock}</TableCell>
            <TableCell>
              <Badge variant={p.activo ? "default" : "outline"}>
                {p.activo ? "Activo" : "Inactivo"}
              </Badge>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
```

- [ ] **Step 2: Write page + loading**

`src/app/(panel)/productos/page.tsx` (reemplaza stub completo):

```tsx
import Form from "next/form";
import { ProductosTable } from "@/components/productos/ProductosTable";
import { Input } from "@/components/ui/input";
import { getCatalogServiceForRequest } from "@/server/bootstrap/catalog-bootstrap";

export const dynamic = "force-dynamic";

export default async function ProductosPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const svc = await getCatalogServiceForRequest();
  const productos = await svc.listProductos({ q });

  return (
    <div className="flex h-screen flex-col">
      <header className="border-border flex items-center justify-between gap-3 border-b px-4 py-3">
        <h1 className="text-lg font-semibold">Productos</h1>
      </header>
      <div className="border-border border-b px-4 py-2">
        <Form action="/productos">
          <Input
            type="search"
            name="q"
            defaultValue={q ?? ""}
            placeholder="Buscar por código o nombre…"
            className="max-w-sm"
            aria-label="Buscar productos"
          />
        </Form>
      </div>
      <div className="flex-1 overflow-y-auto">
        <ProductosTable productos={productos} />
      </div>
    </div>
  );
}
```

(Búsqueda: `next/form` con method GET → submit con Enter navega a `/productos?q=…`, cero JS custom.)

`src/app/(panel)/productos/loading.tsx`:

```tsx
export default function ProductosLoading() {
  return (
    <div role="status" aria-label="Cargando productos" className="divide-y">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3">
          <div className="bg-muted h-4 w-24 animate-pulse rounded" />
          <div className="bg-muted h-4 w-1/3 animate-pulse rounded" />
          <div className="bg-muted h-4 w-16 animate-pulse rounded" />
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: 0 errors.

- [ ] **Step 4: Validación browser (Playwright vía webapp-testing)**

1. `npm run dev` (usuario o background) — login `admin-dev@crm.local` / `dev-admin-2026!`.
2. Navegar `/productos`: si DB vacía → EmptyState "Sin productos"; si hay filas → tabla con columnas Código/Nombre/Categoría/Precio/Stock/Estado.
3. Crear producto de prueba vía SQL editor o esperar a Task 5 y validar búsqueda: `/productos?q=<substring>` filtra; `?q=zzzznope` → EmptyState.
4. Screenshot como evidencia.

Expected: render correcto sin errores console/digest.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(panel\)/productos/page.tsx src/app/\(panel\)/productos/loading.tsx src/components/productos/ProductosTable.tsx
git commit -m "feat(ui): fase 9.A lista productos con busqueda"
```

---

### Task 5: Backend 9.B — schemas Zod + CRUD en `CatalogService` + Server Actions

**Skills:** `superpowers:test-driven-development`, `supabase:supabase` (RLS write admin).

**Files:**

- Create: `src/lib/validation/productos.schema.ts`
- Modify: `src/server/services/catalog/catalog.service.ts` (agrega 3 métodos + tipos)
- Modify: `src/server/services/catalog/default-catalog.service.ts` (impl)
- Create: `src/app/(panel)/productos/_actions/action-error.ts`
- Create: `src/app/(panel)/productos/_actions/create-producto.action.ts`
- Create: `src/app/(panel)/productos/_actions/update-producto.action.ts`
- Create: `src/app/(panel)/productos/_actions/set-producto-activo.action.ts`
- Test: `tests/unit/productos-schema.test.ts`, ampliar `tests/unit/services/catalog-service.test.ts`

**Interfaces:**

- Consumes: `ProductsRepository.create/update` (existentes), `UUIDSchema` de `@/lib/validation/schemas`, `ActionResult` de `@/types/inbox`, `getLogger` de `@/lib/observability/get-logger`, errores de `@/lib/errors`.
- Produces:
  - Schemas: `CreateProductoSchema`, `UpdateProductoSchema` (= create sin `codigo_interno` + `id`), `SetProductoActivoSchema`; tipos `CreateProductoInput`, `UpdateProductoInput`, `SetProductoActivoInput` (via `z.infer`). Helper exportado `emptyToNull(max)` (lo reusa el schema CSV en Task 8).
  - Service: `createProducto(input: CreateProductoServiceInput): Promise<Producto>`, `updateProducto(id: UUID, patch: UpdateProductoServiceInput): Promise<Producto>`, `setProductoActivo(id: UUID, activo: boolean): Promise<Producto>` donde:
    ```ts
    interface CreateProductoServiceInput {
      codigo_interno: string;
      nombre: string;
      descripcion: string | null;
      categoria: string | null;
      sku_proveedor: string | null;
      precio: number;
      stock: number;
    }
    type UpdateProductoServiceInput = Omit<CreateProductoServiceInput, "codigo_interno">;
    ```
  - Actions: `createProductoAction(raw: unknown): Promise<ActionResult>`, `updateProductoAction(raw: unknown): Promise<ActionResult>`, `setProductoActivoAction(raw: unknown): Promise<ActionResult>` — las consume la UI Task 6.
  - `toActionError(e: unknown, accion: string): { ok: false; error: string }` (retorno estrechado a la rama failure — reutilizable por los action results tipados del import en Task 9).

- [ ] **Step 1: Write failing schema tests**

`tests/unit/productos-schema.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import {
  CreateProductoSchema,
  SetProductoActivoSchema,
  UpdateProductoSchema,
} from "@/lib/validation/productos.schema";

const base = {
  codigo_interno: "PF-001",
  nombre: "Pastilla freno",
  descripcion: "",
  categoria: "frenos",
  sku_proveedor: "  ",
  precio: 100.5,
  stock: 3,
};

describe("CreateProductoSchema", () => {
  test("acepta input válido y normaliza '' / whitespace a null", () => {
    const r = CreateProductoSchema.parse(base);
    expect(r.descripcion).toBeNull();
    expect(r.sku_proveedor).toBeNull();
    expect(r.categoria).toBe("frenos");
  });

  test("rechaza precio negativo", () => {
    expect(CreateProductoSchema.safeParse({ ...base, precio: -1 }).success).toBe(false);
  });

  test("rechaza stock no entero", () => {
    expect(CreateProductoSchema.safeParse({ ...base, stock: 1.5 }).success).toBe(false);
  });

  test("rechaza codigo_interno vacío", () => {
    expect(CreateProductoSchema.safeParse({ ...base, codigo_interno: " " }).success).toBe(false);
  });

  test("rechaza NaN en precio", () => {
    expect(CreateProductoSchema.safeParse({ ...base, precio: Number.NaN }).success).toBe(false);
  });
});

describe("UpdateProductoSchema", () => {
  test("requiere id uuid y no acepta codigo_interno", () => {
    const { codigo_interno: _omit, ...rest } = base;
    const r = UpdateProductoSchema.parse({
      ...rest,
      id: "6f9619ff-8b86-4d01-b42d-00cf4fc964ff",
    });
    expect(r).not.toHaveProperty("codigo_interno");
    expect(UpdateProductoSchema.safeParse({ ...rest, id: "not-uuid" }).success).toBe(false);
  });
});

describe("SetProductoActivoSchema", () => {
  test("requiere id uuid + activo boolean", () => {
    const ok = SetProductoActivoSchema.safeParse({
      id: "6f9619ff-8b86-4d01-b42d-00cf4fc964ff",
      activo: false,
    });
    expect(ok.success).toBe(true);
    expect(SetProductoActivoSchema.safeParse({ id: "x", activo: "si" }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run tests/unit/productos-schema.test.ts`
Expected: FAIL — módulo no existe.

- [ ] **Step 3: Write schemas**

`src/lib/validation/productos.schema.ts`:

```ts
import { z } from "zod";
import { UUIDSchema } from "@/lib/validation/schemas";

// Inputs Server Actions productos (Slice 2 fase 9). Regla §0.9.3: parse línea 1.

/**
 * Texto opcional de forms/CSV: "" o whitespace → null. undefined también → null
 * (columna opcional ausente en CSV).
 */
export const emptyToNull = (max: number) =>
  z.preprocess(
    (v) => (v === undefined || (typeof v === "string" && v.trim() === "") ? null : v),
    z.string().trim().min(1).max(max).nullable(),
  );

export const CreateProductoSchema = z.object({
  codigo_interno: z.string().trim().min(1).max(64),
  nombre: z.string().trim().min(1).max(200),
  descripcion: emptyToNull(1000),
  categoria: emptyToNull(100),
  sku_proveedor: emptyToNull(100),
  precio: z.number().nonnegative().finite(),
  stock: z.number().int().nonnegative(),
});
export type CreateProductoInput = z.infer<typeof CreateProductoSchema>;

export const UpdateProductoSchema = CreateProductoSchema.omit({ codigo_interno: true }).extend({
  id: UUIDSchema,
});
export type UpdateProductoInput = z.infer<typeof UpdateProductoSchema>;

export const SetProductoActivoSchema = z.object({
  id: UUIDSchema,
  activo: z.boolean(),
});
export type SetProductoActivoInput = z.infer<typeof SetProductoActivoSchema>;
```

Run: `npx vitest run tests/unit/productos-schema.test.ts` → PASS.

- [ ] **Step 4: Write failing service tests**

Agregar a `tests/unit/services/catalog-service.test.ts` (mismo archivo, nuevos describe):

```ts
import { ConflictError, NotFoundError } from "@/lib/errors";

describe("DefaultCatalogService CRUD", () => {
  let repo: InMemoryProductsRepository;
  let svc: DefaultCatalogService;

  beforeEach(() => {
    repo = new InMemoryProductsRepository();
    svc = new DefaultCatalogService({ productos: repo });
  });

  test("createProducto aplica defaults no-form (activo true, compatibilidad [], imagen null)", async () => {
    const p = await svc.createProducto({
      codigo_interno: "N-1",
      nombre: "Nuevo",
      descripcion: null,
      categoria: null,
      sku_proveedor: null,
      precio: 10,
      stock: 1,
    });
    expect(p.activo).toBe(true);
    expect(p.compatibilidad).toEqual([]);
    expect(p.imagen_url).toBeNull();
  });

  test("createProducto propaga ConflictError por codigo duplicado", async () => {
    await repo.create(baseInsert({ codigo_interno: "DUP-1" }));
    await expect(
      svc.createProducto({
        codigo_interno: "DUP-1",
        nombre: "Otro",
        descripcion: null,
        categoria: null,
        sku_proveedor: null,
        precio: 1,
        stock: 0,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  test("updateProducto parchea sin tocar codigo_interno ni activo", async () => {
    const p = await repo.create(baseInsert({ codigo_interno: "U-1", activo: false }));
    const r = await svc.updateProducto(p.id, {
      nombre: "Editado",
      descripcion: "desc",
      categoria: null,
      sku_proveedor: null,
      precio: 999,
      stock: 7,
    });
    expect(r.nombre).toBe("Editado");
    expect(r.precio).toBe(999);
    expect(r.codigo_interno).toBe("U-1");
    expect(r.activo).toBe(false);
  });

  test("updateProducto id inexistente → NotFoundError", async () => {
    await expect(
      svc.updateProducto(crypto.randomUUID(), {
        nombre: "x",
        descripcion: null,
        categoria: null,
        sku_proveedor: null,
        precio: 1,
        stock: 0,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  test("setProductoActivo togglea", async () => {
    const p = await repo.create(baseInsert({ codigo_interno: "T-1", activo: true }));
    const r = await svc.setProductoActivo(p.id, false);
    expect(r.activo).toBe(false);
  });
});
```

Run: `npx vitest run tests/unit/services/catalog-service.test.ts` → FAIL (métodos no existen).

- [ ] **Step 5: Implement service methods**

En `src/server/services/catalog/catalog.service.ts` agregar (debajo de `CatalogListInput`):

```ts
import type { Producto, UUID } from "@/types/entities";

export interface CreateProductoServiceInput {
  codigo_interno: string;
  nombre: string;
  descripcion: string | null;
  categoria: string | null;
  sku_proveedor: string | null;
  precio: number;
  stock: number;
}

export type UpdateProductoServiceInput = Omit<CreateProductoServiceInput, "codigo_interno">;
```

y en la interface `CatalogService`:

```ts
  /** Alta manual. Defaults no-form: activo=true, compatibilidad=[], imagen_url=null. */
  createProducto(input: CreateProductoServiceInput): Promise<Producto>;

  /** Edición manual. No toca codigo_interno (inmutable) ni activo (usar setProductoActivo). */
  updateProducto(id: UUID, patch: UpdateProductoServiceInput): Promise<Producto>;

  /** Baja/alta lógica — catálogo referenciado por sesiones históricas, sin delete físico. */
  setProductoActivo(id: UUID, activo: boolean): Promise<Producto>;
```

En `src/server/services/catalog/default-catalog.service.ts` agregar métodos:

```ts
  async createProducto(input: CreateProductoServiceInput): Promise<Producto> {
    return this.deps.productos.create({
      ...input,
      compatibilidad: [],
      imagen_url: null,
      activo: true,
    });
  }

  async updateProducto(id: UUID, patch: UpdateProductoServiceInput): Promise<Producto> {
    return this.deps.productos.update(id, patch);
  }

  async setProductoActivo(id: UUID, activo: boolean): Promise<Producto> {
    return this.deps.productos.update(id, { activo });
  }
```

(imports nuevos: `CreateProductoServiceInput`, `UpdateProductoServiceInput` de `./catalog.service`; `UUID` de `@/types/entities`).

Run: `npx vitest run tests/unit/services/catalog-service.test.ts` → PASS.

- [ ] **Step 6: Write the actions**

`src/app/(panel)/productos/_actions/action-error.ts`:

```ts
import {
  ConflictError,
  DomainError,
  NotFoundError,
  PermissionDeniedError,
  ValidationError,
} from "@/lib/errors";
import { getLogger } from "@/lib/observability/get-logger";

const logger = getLogger({ scope: "productos-actions" });

/**
 * Mapea errores de service a mensaje user-friendly para toast. Detalle técnico
 * queda en logs server-side; al cliente solo mensajes curados. Retorna la rama
 * failure para poder usarse en action results tipados (import CSV).
 */
export function toActionError(e: unknown, accion: string): { ok: false; error: string } {
  if (e instanceof ConflictError) {
    return { ok: false, error: "Ya existe un producto con ese código interno." };
  }
  if (e instanceof NotFoundError) {
    return { ok: false, error: "Producto no encontrado. Refrescá la página." };
  }
  if (e instanceof ValidationError) {
    // Accionable para el operador. Sin secrets.
    return { ok: false, error: e.message };
  }
  if (e instanceof PermissionDeniedError) {
    logger.warn("permiso denegado en action productos", { accion, code: e.code });
    return { ok: false, error: "No tenés permisos para modificar el catálogo (solo admin)." };
  }
  if (e instanceof DomainError) {
    logger.warn("domain error en action productos", { accion, code: e.code, error: e.message });
    return { ok: false, error: "No se pudo completar la acción. Reintentá en unos segundos." };
  }
  logger.error("action productos inesperada falló", {
    accion,
    error: e instanceof Error ? e.message : String(e),
  });
  return { ok: false, error: "Error inesperado. Reintentá en unos segundos." };
}
```

`src/app/(panel)/productos/_actions/create-producto.action.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { CreateProductoSchema } from "@/lib/validation/productos.schema";
import { getCatalogServiceForRequest } from "@/server/bootstrap/catalog-bootstrap";
import { toActionError } from "./action-error";
import type { ActionResult } from "@/types/inbox";

export async function createProductoAction(raw: unknown): Promise<ActionResult> {
  const parsed = CreateProductoSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Datos inválidos: revisá código, nombre, precio y stock." };
  }

  try {
    const svc = await getCatalogServiceForRequest();
    await svc.createProducto(parsed.data);
  } catch (e) {
    return toActionError(e, "create-producto");
  }

  revalidatePath("/productos");
  return { ok: true };
}
```

`src/app/(panel)/productos/_actions/update-producto.action.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { UpdateProductoSchema } from "@/lib/validation/productos.schema";
import { getCatalogServiceForRequest } from "@/server/bootstrap/catalog-bootstrap";
import { toActionError } from "./action-error";
import type { ActionResult } from "@/types/inbox";

export async function updateProductoAction(raw: unknown): Promise<ActionResult> {
  const parsed = UpdateProductoSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Datos inválidos: revisá nombre, precio y stock." };
  }

  try {
    const svc = await getCatalogServiceForRequest();
    const { id, ...patch } = parsed.data;
    await svc.updateProducto(id, patch);
  } catch (e) {
    return toActionError(e, "update-producto");
  }

  revalidatePath("/productos");
  return { ok: true };
}
```

`src/app/(panel)/productos/_actions/set-producto-activo.action.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { SetProductoActivoSchema } from "@/lib/validation/productos.schema";
import { getCatalogServiceForRequest } from "@/server/bootstrap/catalog-bootstrap";
import { toActionError } from "./action-error";
import type { ActionResult } from "@/types/inbox";

export async function setProductoActivoAction(raw: unknown): Promise<ActionResult> {
  const parsed = SetProductoActivoSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Datos inválidos. Refrescá la página." };
  }

  try {
    const svc = await getCatalogServiceForRequest();
    await svc.setProductoActivo(parsed.data.id, parsed.data.activo);
  } catch (e) {
    return toActionError(e, "set-producto-activo");
  }

  revalidatePath("/productos");
  return { ok: true };
}
```

- [ ] **Step 7: Full unit + typecheck + lint + commit**

```bash
npm run typecheck && npm run lint && npx vitest run tests/unit
git add src/lib/validation/productos.schema.ts src/server/services/catalog/ src/app/\(panel\)/productos/_actions/ tests/unit/productos-schema.test.ts tests/unit/services/catalog-service.test.ts
git commit -m "feat(catalog): CRUD productos schemas + service + server actions"
```

---

### Task 6: UI 9.B — dialogs create/edit + toggle activo (admin only)

**Skills:** `vercel:nextjs`, `vercel:shadcn`, `frontend-design`, `webapp-testing`.

**Files:**

- Create: `src/components/productos/ProductoFormDialog.tsx`
- Create: `src/components/productos/ProductoRowActions.tsx`
- Modify: `src/components/productos/ProductosTable.tsx` (props acciones + columna admin)
- Modify: `src/app/(panel)/productos/page.tsx` (rol + wiring actions + botón Nuevo)

**Interfaces:**

- Consumes: `getCurrentRol()` (Task 1), las 3 actions (Task 5), `CreateProductoInput`/`UpdateProductoInput` de `@/lib/validation/productos.schema` (type-only — precedente: `CloseSessionButton` importa de `inbox.schema`), `ActionResult` de `@/types/inbox`, `Dialog/*`, `Button`, `Input`, `Textarea` de `@/components/ui`, `toast` de sonner. Dialog es Base UI: trigger vía `<DialogTrigger render={<Button …/>}>label</DialogTrigger>`.
- Produces:
  - `ProductoFormDialog({ title, triggerLabel, triggerVariant?, initial?, onSubmit })` con `onSubmit: (values: ProductoFormValues) => Promise<ActionResult>` y

    ```ts
    interface ProductoFormValues {
      codigo_interno: string;
      nombre: string;
      descripcion: string | null;
      categoria: string | null;
      sku_proveedor: string | null;
      precio: number;
      stock: number;
    }
    ```

  - `ProductoRowActions({ producto, onUpdate, onToggleActivo })`.
  - `ProductosTable({ productos, isAdmin, onUpdate, onToggleActivo })` (props nuevas; `isAdmin=false` oculta acciones).

- [ ] **Step 1: Write `ProductoFormDialog`**

`src/components/productos/ProductoFormDialog.tsx`:

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
import { Textarea } from "@/components/ui/textarea";
import type { ComponentProps } from "react";
import type { Producto } from "@/types/entities";
import type { ActionResult } from "@/types/inbox";

export interface ProductoFormValues {
  codigo_interno: string;
  nombre: string;
  descripcion: string | null;
  categoria: string | null;
  sku_proveedor: string | null;
  precio: number;
  stock: number;
}

function textOrNull(formData: FormData, key: string): string | null {
  const v = formData.get(key);
  const s = typeof v === "string" ? v.trim() : "";
  return s === "" ? null : s;
}

export function ProductoFormDialog({
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
  // Presente = modo edición (codigo_interno inmutable, precargado).
  initial?: Producto;
  onSubmit: (values: ProductoFormValues) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const submit = (formData: FormData) => {
    const values: ProductoFormValues = {
      codigo_interno: initial
        ? initial.codigo_interno
        : String(formData.get("codigo_interno") ?? "").trim(),
      nombre: String(formData.get("nombre") ?? "").trim(),
      descripcion: textOrNull(formData, "descripcion"),
      categoria: textOrNull(formData, "categoria"),
      sku_proveedor: textOrNull(formData, "sku_proveedor"),
      precio: Number(formData.get("precio")),
      stock: Number(formData.get("stock")),
    };
    startTransition(async () => {
      const result = await onSubmit(values);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(initial ? "Producto actualizado" : "Producto creado");
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant={triggerVariant} size="sm" />}>
        {triggerLabel}
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form action={submit} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground text-xs">Código interno *</span>
            <Input
              name="codigo_interno"
              required
              maxLength={64}
              defaultValue={initial?.codigo_interno ?? ""}
              disabled={Boolean(initial) || isPending}
              className="font-mono"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground text-xs">Nombre *</span>
            <Input
              name="nombre"
              required
              maxLength={200}
              defaultValue={initial?.nombre ?? ""}
              disabled={isPending}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground text-xs">Descripción</span>
            <Textarea
              name="descripcion"
              maxLength={1000}
              rows={2}
              defaultValue={initial?.descripcion ?? ""}
              disabled={isPending}
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground text-xs">Categoría</span>
              <Input
                name="categoria"
                maxLength={100}
                defaultValue={initial?.categoria ?? ""}
                disabled={isPending}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground text-xs">SKU proveedor</span>
              <Input
                name="sku_proveedor"
                maxLength={100}
                defaultValue={initial?.sku_proveedor ?? ""}
                disabled={isPending}
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground text-xs">Precio *</span>
              <Input
                name="precio"
                type="number"
                required
                min="0"
                step="0.01"
                defaultValue={initial?.precio ?? ""}
                disabled={isPending}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground text-xs">Stock *</span>
              <Input
                name="stock"
                type="number"
                required
                min="0"
                step="1"
                defaultValue={initial?.stock ?? ""}
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

- [ ] **Step 2: Write `ProductoRowActions`**

`src/components/productos/ProductoRowActions.tsx`:

```tsx
"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ProductoFormDialog } from "./ProductoFormDialog";
import type { ProductoFormValues } from "./ProductoFormDialog";
import type { Producto } from "@/types/entities";
import type { UpdateProductoInput } from "@/lib/validation/productos.schema";
import type { SetProductoActivoInput } from "@/lib/validation/productos.schema";
import type { ActionResult } from "@/types/inbox";

export function ProductoRowActions({
  producto,
  onUpdate,
  onToggleActivo,
}: {
  producto: Producto;
  onUpdate: (input: UpdateProductoInput) => Promise<ActionResult>;
  onToggleActivo: (input: SetProductoActivoInput) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const update = (values: ProductoFormValues): Promise<ActionResult> =>
    onUpdate({
      id: producto.id,
      nombre: values.nombre,
      descripcion: values.descripcion,
      categoria: values.categoria,
      sku_proveedor: values.sku_proveedor,
      precio: values.precio,
      stock: values.stock,
    });

  const toggle = () => {
    startTransition(async () => {
      const result = await onToggleActivo({ id: producto.id, activo: !producto.activo });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(producto.activo ? "Producto desactivado" : "Producto activado");
      router.refresh();
    });
  };

  return (
    <div className="flex items-center justify-end gap-2">
      <ProductoFormDialog
        title={`Editar ${producto.codigo_interno}`}
        description="El código interno no se puede cambiar."
        triggerLabel="Editar"
        triggerVariant="outline"
        initial={producto}
        onSubmit={update}
      />
      <Button variant="ghost" size="sm" onClick={toggle} disabled={isPending}>
        {producto.activo ? "Desactivar" : "Activar"}
      </Button>
    </div>
  );
}
```

- [ ] **Step 3: Wire table + page**

`src/components/productos/ProductosTable.tsx` — cambiar firma y agregar columna acciones:

```tsx
import { ProductoRowActions } from "./ProductoRowActions";
import type {
  SetProductoActivoInput,
  UpdateProductoInput,
} from "@/lib/validation/productos.schema";
import type { ActionResult } from "@/types/inbox";
```

```tsx
export function ProductosTable({
  productos,
  isAdmin,
  onUpdate,
  onToggleActivo,
}: {
  productos: Producto[];
  isAdmin: boolean;
  onUpdate: (input: UpdateProductoInput) => Promise<ActionResult>;
  onToggleActivo: (input: SetProductoActivoInput) => Promise<ActionResult>;
}) {
```

En `TableHeader`, después de `<TableHead>Estado</TableHead>`:

```tsx
{
  isAdmin ? <TableHead className="w-44 text-right">Acciones</TableHead> : null;
}
```

En `TableBody`, después de la celda Estado:

```tsx
{
  isAdmin ? (
    <TableCell>
      <ProductoRowActions producto={p} onUpdate={onUpdate} onToggleActivo={onToggleActivo} />
    </TableCell>
  ) : null;
}
```

`src/app/(panel)/productos/page.tsx` — versión final Task 6:

```tsx
import Form from "next/form";
import { ProductoFormDialog } from "@/components/productos/ProductoFormDialog";
import { ProductosTable } from "@/components/productos/ProductosTable";
import { Input } from "@/components/ui/input";
import { getCurrentRol } from "@/server/auth/guards";
import { getCatalogServiceForRequest } from "@/server/bootstrap/catalog-bootstrap";
import { createProductoAction } from "./_actions/create-producto.action";
import { setProductoActivoAction } from "./_actions/set-producto-activo.action";
import { updateProductoAction } from "./_actions/update-producto.action";

export const dynamic = "force-dynamic";

export default async function ProductosPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const svc = await getCatalogServiceForRequest();
  const [rol, productos] = await Promise.all([getCurrentRol(), svc.listProductos({ q })]);
  const isAdmin = rol === "admin";

  return (
    <div className="flex h-screen flex-col">
      <header className="border-border flex items-center justify-between gap-3 border-b px-4 py-3">
        <h1 className="text-lg font-semibold">Productos</h1>
        {isAdmin ? (
          <ProductoFormDialog
            title="Nuevo producto"
            description="Alta manual de catálogo. Para volumen usá Importar CSV."
            triggerLabel="Nuevo producto"
            onSubmit={createProductoAction}
          />
        ) : null}
      </header>
      <div className="border-border border-b px-4 py-2">
        <Form action="/productos">
          <Input
            type="search"
            name="q"
            defaultValue={q ?? ""}
            placeholder="Buscar por código o nombre…"
            className="max-w-sm"
            aria-label="Buscar productos"
          />
        </Form>
      </div>
      <div className="flex-1 overflow-y-auto">
        <ProductosTable
          productos={productos}
          isAdmin={isAdmin}
          onUpdate={updateProductoAction}
          onToggleActivo={setProductoActivoAction}
        />
      </div>
    </div>
  );
}
```

Nota tipos: `createProductoAction` acepta `raw: unknown` → asignable a `(values: ProductoFormValues) => Promise<ActionResult>` (contravarianza OK).

- [ ] **Step 4: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: 0 errors.

- [ ] **Step 5: Validación browser (webapp-testing)**

Con dev server + login admin:

1. `/productos` → botón "Nuevo producto" visible. Crear producto (código `TEST-9B-1`, nombre "Pastilla test", precio 150.50, stock 10) → toast "Producto creado" + fila aparece.
2. Crear de nuevo con mismo código → toast error "Ya existe un producto con ese código interno."
3. Editar `TEST-9B-1`: cambiar precio a 200 → toast "Producto actualizado" + tabla refleja. Verificar campo código disabled.
4. Desactivar → badge "Inactivo" + fila opaca. Reactivar → "Activo".
5. Búsqueda `?q=TEST-9B` filtra a 1.
6. Screenshot evidencia.

- [ ] **Step 6: Commit**

```bash
git add src/components/productos/ src/app/\(panel\)/productos/page.tsx
git commit -m "feat(ui): fase 9.B dialogs CRUD productos admin"
```

---

### Task 7: Repo — `bulkUpsert` CSV-safe (no pisa campos fuera del CSV)

**Problema:** `bulkUpsert` actual recibe `ProductoInsert` completo → un import CSV pisaría `compatibilidad`/`imagen_url`/`activo` de productos existentes (CSV solo trae 7 columnas). Fix: estrechar la firma al scope CSV; update preserva esos 3 campos, insert usa defaults DB.

**Skills:** `superpowers:test-driven-development`, `supabase:supabase-postgres-best-practices`, `supabase:supabase`.

**Files:**

- Modify: `tests/repositories/productos.contract.ts`
- Modify: `src/server/repositories/productos.repo.ts`
- Modify: `src/server/repositories/productos.supabase.repo.ts`
- Modify: `tests/unit/errors-integration.test.ts` (test `"productos.bulkUpsert dup en input → ValidationError"`: borrar del item literal las keys `compatibilidad`, `imagen_url`, `activo`)

**Interfaces:**

- Produces:

  ```ts
  export type ProductoBulkUpsertItem = Omit<
    ProductoInsert,
    "compatibilidad" | "imagen_url" | "activo"
  >;
  // bulkUpsert(items: ProductoBulkUpsertItem[]): Promise<Producto[]>
  ```

  Task 8 (confirmImport) consume esta firma.

- [ ] **Step 1: Update contract tests (failing)**

En `tests/repositories/productos.contract.ts`:

a) Agregar helper después de `baseInsert` (import `ProductoBulkUpsertItem` junto a los demás types del repo):

```ts
function bulkItem(overrides: Partial<ProductoBulkUpsertItem> = {}): ProductoBulkUpsertItem {
  return {
    codigo_interno: "B-1",
    sku_proveedor: null,
    nombre: "Bulk item",
    descripcion: null,
    categoria: null,
    precio: 100,
    stock: 1,
    ...overrides,
  };
}
```

b) En los 5 tests bulkUpsert existentes, reemplazar cada `baseInsert({...})` por `bulkItem({...})` (mismos overrides; los overrides usados — `codigo_interno`, `nombre`, `precio`, `stock` — existen en ambos shapes).

c) Agregar 2 tests nuevos al final del bloque bulk:

```ts
test("bulkUpsert insert aplica defaults (activo true, compatibilidad [], imagen null)", async () => {
  const result = await repo.bulkUpsert([bulkItem({ codigo_interno: "DEF-1" })]);
  expect(result[0]?.activo).toBe(true);
  expect(result[0]?.compatibilidad).toEqual([]);
  expect(result[0]?.imagen_url).toBeNull();
});

test("bulkUpsert update preserva compatibilidad + imagen_url + activo", async () => {
  const original = await repo.create(
    baseInsert({
      codigo_interno: "PRES-1",
      compatibilidad: [{ marca: "Toyota", modelo: "Hilux", anio_desde: 2016, anio_hasta: 2020 }],
      imagen_url: "https://example.com/p.jpg",
      activo: false,
    }),
  );
  const result = await repo.bulkUpsert([bulkItem({ codigo_interno: "PRES-1", precio: 777 })]);
  expect(result[0]?.id).toBe(original.id);
  expect(result[0]?.precio).toBe(777);
  expect(result[0]?.compatibilidad).toEqual(original.compatibilidad);
  expect(result[0]?.imagen_url).toBe("https://example.com/p.jpg");
  expect(result[0]?.activo).toBe(false);
});
```

- [ ] **Step 2: Run to verify fails**

Run: `npx vitest run tests/unit/repositories`
Expected: FAIL — typecheck del contract (shape) y/o el test "preserva" (impl actual pisa los campos).

- [ ] **Step 3: Implement InMemory + interface**

`src/server/repositories/productos.repo.ts`:

```ts
// Item de upsert masivo con scope CSV import: solo las columnas del archivo.
// Update NO toca compatibilidad / imagen_url / activo (se preservan); insert
// usa defaults (compatibilidad [], imagen_url null, activo true).
export type ProductoBulkUpsertItem = Omit<
  ProductoInsert,
  "compatibilidad" | "imagen_url" | "activo"
>;
```

Interface: cambiar la firma a

```ts
  // Upsert masivo por codigo_interno (import CSV). Throws si hay codigo_interno
  // duplicado en el input. Preserva orden del input en el array de retorno.
  bulkUpsert(items: ProductoBulkUpsertItem[]): Promise<Producto[]>;
```

InMemory `bulkUpsert` — mismo cuerpo, solo cambia el branch create:

```ts
  async bulkUpsert(items: ProductoBulkUpsertItem[]): Promise<Producto[]> {
    if (items.length === 0) return [];

    const seen = new Set<string>();
    for (const item of items) {
      if (seen.has(item.codigo_interno)) {
        throw new ValidationError(`codigo_interno duplicado en input bulk: ${item.codigo_interno}`);
      }
      seen.add(item.codigo_interno);
    }

    const result: Producto[] = [];
    for (const item of items) {
      const existing = await this.findByCodigoInterno(item.codigo_interno);
      if (existing) {
        const { codigo_interno: _ignore, ...rest } = item;
        const updated = await this.update(existing.id, rest);
        result.push(updated);
      } else {
        const created = await this.create({
          ...item,
          compatibilidad: [],
          imagen_url: null,
          activo: true,
        });
        result.push(created);
      }
    }
    return result;
  }
```

- [ ] **Step 4: Implement Supabase**

`src/server/repositories/productos.supabase.repo.ts` — reemplazar el bloque de armado de rows en `bulkUpsert` (import `ProductoBulkUpsertItem` del repo interface):

```ts
  async bulkUpsert(items: ProductoBulkUpsertItem[]): Promise<Producto[]> {
    if (items.length === 0) return [];

    // Dedup input (throws antes de tocar DB — fail-fast, mismo contract que InMemory).
    const seen = new Set<string>();
    for (const item of items) {
      if (seen.has(item.codigo_interno)) {
        throw new ValidationError(`codigo_interno duplicado en input bulk: ${item.codigo_interno}`);
      }
      seen.add(item.codigo_interno);
    }

    const now = await serverNowIso(this.db);
    // Solo columnas CSV: el SET del ON CONFLICT se arma con las keys del payload,
    // así compatibilidad/imagen_url/activo quedan intactas en updates.
    const rows = items.map((item) => ({
      codigo_interno: item.codigo_interno,
      sku_proveedor: item.sku_proveedor,
      nombre: item.nombre,
      descripcion: item.descripcion,
      categoria: item.categoria,
      precio: item.precio,
      stock: item.stock,
      updated_at: now,
    }));

    // defaultToNull:false → columnas omitidas toman DEFAULT en el INSERT
    // (compatibilidad '[]', activo true) en vez de null (violaría NOT NULL).
    const { data, error } = await this.db
      .from("productos")
      .upsert(rows, { onConflict: "codigo_interno", defaultToNull: false })
      .select();

    if (error) throw mapPostgrestError(error, { resource: "producto" });

    // Postgres ORDER BY no garantizado en upsert — re-ordenar al orden del input
    // por codigo_interno (contract test "bulkUpsert mezcla creates + updates preservando orden").
    const byCodigo = new Map<string, (typeof data)[number]>();
    for (const row of data ?? []) byCodigo.set(row.codigo_interno, row);

    return items.map((item) => {
      const row = byCodigo.get(item.codigo_interno);
      if (!row) {
        throw new InfraError(
          `bulkUpsert: row missing en respuesta para codigo_interno=${item.codigo_interno}`,
        );
      }
      return mapRow(row);
    });
  }
```

Nota: el `throw new Error(...)` pre-existente del row-missing viola la regla DomainError — al tocar el método, cambiarlo a `InfraError` (agregar al import de `@/lib/errors`; verificar nombre exacto de la clase en `src/lib/errors.ts` — si el constructor requiere otros args, ajustar).

- [ ] **Step 5: Fix `errors-integration.test.ts` + run unit**

En el item literal del test `"productos.bulkUpsert dup en input → ValidationError"` eliminar las líneas `compatibilidad: [],`, `imagen_url: null,` (si existe) y `activo: true,`.

Run: `npx vitest run tests/unit`
Expected: PASS todo.

- [ ] **Step 6: Integration contra Supabase real (si `SUPABASE_TEST_*` en `.env.local`)**

Run: `npm run test:integration -- productos`
Expected: PASS suite productos (cubre Task 2 order + bulkUpsert nuevo; latencia residencial 0.4-1s/req, timeouts 120s configurados). Si falla 1 test por flake de red, re-run.

- [ ] **Step 7: Commit**

```bash
git add tests/repositories/productos.contract.ts src/server/repositories/productos.repo.ts src/server/repositories/productos.supabase.repo.ts tests/unit/errors-integration.test.ts
git commit -m "refactor(repo): bulkUpsert scope CSV preserva campos no importados"
```

---

### Task 8: Service 9.C — parse CSV (papaparse) + preview/confirm

**Skills:** `superpowers:test-driven-development`.

**Files:**

- Modify: `package.json` (dep nueva)
- Create: `src/types/productos.ts`
- Modify: `src/lib/validation/productos.schema.ts` (agrega `CsvProductoRowSchema`)
- Create: `src/server/services/catalog/csv-import.ts`
- Modify: `src/server/services/catalog/catalog.service.ts` + `default-catalog.service.ts` (2 métodos)
- Test: `tests/unit/services/csv-import.test.ts` + ampliar `tests/unit/services/catalog-service.test.ts`

**Interfaces:**

- Consumes: `bulkUpsert(items: ProductoBulkUpsertItem[])` (Task 7), `emptyToNull` (Task 5), `ValidationError` de `@/lib/errors`.
- Produces:
  - `src/types/productos.ts` (types/ no importa de lib/ — interfaces manuales; compat estructural con `z.infer` la verifica el compilador):

    ```ts
    export interface CsvProductoRow {
      codigo_interno: string;
      nombre: string;
      descripcion: string | null;
      categoria: string | null;
      sku_proveedor: string | null;
      precio: number;
      stock: number;
    }
    export interface CsvRowError {
      fila: number; // número de línea del archivo (header = línea 1, primera fila de datos = 2)
      errores: string[];
    }
    export interface ImportPreview {
      total: number;
      validos: CsvProductoRow[];
      errores: CsvRowError[];
    }
    export interface ImportResult {
      importados: number;
      omitidos: number;
    }
    export type ImportPreviewActionResult =
      | { ok: true; preview: ImportPreview }
      | { ok: false; error: string };
    export type ImportConfirmActionResult =
      | { ok: true; result: ImportResult }
      | { ok: false; error: string };
    ```

  - `parseProductosCsv(csvText: string): ImportPreview` — ValidationError si estructura inválida (vacío / faltan headers requeridos `codigo_interno,nombre,precio,stock`).
  - Service: `previewImport(csvText: string): ImportPreview` (sync) y `confirmImport(csvText: string): Promise<ImportResult>` — importa solo filas válidas, omite las con error.

- [ ] **Step 1: Install papaparse (dep aprobada en spec §1)**

```bash
npm install papaparse && npm install -D @types/papaparse
```

Expected: sin vulnerabilities nuevas high/critical (`npm audit` lo reporta el hook CI después).

- [ ] **Step 2: Write failing tests**

`tests/unit/services/csv-import.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { ValidationError } from "@/lib/errors";
import { parseProductosCsv } from "@/server/services/catalog/csv-import";

const HEADER = "codigo_interno,nombre,descripcion,categoria,precio,stock,sku_proveedor";

describe("parseProductosCsv", () => {
  test("parsea filas válidas y normaliza opcionales vacíos a null", () => {
    const csv = [
      HEADER,
      "PF-001,Pastilla freno,Juego delantero,frenos,120000.50,12,BR-123",
      "FA-002,Filtro aire,,, 8500,3,",
    ].join("\n");

    const r = parseProductosCsv(csv);
    expect(r.total).toBe(2);
    expect(r.errores).toEqual([]);
    expect(r.validos).toHaveLength(2);
    expect(r.validos[0]).toEqual({
      codigo_interno: "PF-001",
      nombre: "Pastilla freno",
      descripcion: "Juego delantero",
      categoria: "frenos",
      precio: 120000.5,
      stock: 12,
      sku_proveedor: "BR-123",
    });
    expect(r.validos[1]?.descripcion).toBeNull();
    expect(r.validos[1]?.categoria).toBeNull();
    expect(r.validos[1]?.sku_proveedor).toBeNull();
    expect(r.validos[1]?.precio).toBe(8500);
  });

  test("tolera BOM y headers con mayúsculas/espacios", () => {
    const csv = "﻿Codigo_Interno, Nombre ,precio,stock\nX-1,Prod,10,1";
    const r = parseProductosCsv(csv);
    expect(r.validos).toHaveLength(1);
    expect(r.validos[0]?.codigo_interno).toBe("X-1");
  });

  test("columnas desconocidas se ignoran", () => {
    const csv = "codigo_interno,nombre,precio,stock,color\nX-1,Prod,10,1,rojo";
    const r = parseProductosCsv(csv);
    expect(r.validos).toHaveLength(1);
    expect(r.validos[0]).not.toHaveProperty("color");
  });

  test("precio no numérico → error por fila con número de línea", () => {
    const csv = [HEADER, "OK-1,Prod,,,100,1,", "BAD-1,Prod,,,caro,1,"].join("\n");
    const r = parseProductosCsv(csv);
    expect(r.validos).toHaveLength(1);
    expect(r.errores).toHaveLength(1);
    expect(r.errores[0]?.fila).toBe(3);
    expect(r.errores[0]?.errores.join(" ")).toMatch(/precio/);
  });

  test("precio vacío → error (no 0 silencioso)", () => {
    const csv = [HEADER, "BAD-2,Prod,,,,1,"].join("\n");
    const r = parseProductosCsv(csv);
    expect(r.validos).toHaveLength(0);
    expect(r.errores[0]?.errores.join(" ")).toMatch(/precio/);
  });

  test("stock decimal o negativo → error por fila", () => {
    const csv = [HEADER, "BAD-3,Prod,,,10,1.5,", "BAD-4,Prod,,,10,-2,"].join("\n");
    const r = parseProductosCsv(csv);
    expect(r.validos).toHaveLength(0);
    expect(r.errores.map((e) => e.fila)).toEqual([2, 3]);
  });

  test("codigo_interno duplicado en archivo → segunda ocurrencia a errores", () => {
    const csv = [HEADER, "DUP-1,Prod A,,,10,1,", "DUP-1,Prod B,,,20,2,"].join("\n");
    const r = parseProductosCsv(csv);
    expect(r.validos).toHaveLength(1);
    expect(r.validos[0]?.nombre).toBe("Prod A");
    expect(r.errores[0]?.fila).toBe(3);
    expect(r.errores[0]?.errores.join(" ")).toMatch(/duplicado/);
  });

  test("faltan headers requeridos → ValidationError", () => {
    expect(() => parseProductosCsv("codigo_interno,nombre\nX,Y")).toThrow(ValidationError);
    expect(() => parseProductosCsv("codigo_interno,nombre\nX,Y")).toThrow(
      /precio.*stock|stock.*precio/,
    );
  });

  test("CSV sin filas de datos → ValidationError", () => {
    expect(() => parseProductosCsv(HEADER)).toThrow(ValidationError);
    expect(() => parseProductosCsv("")).toThrow(ValidationError);
  });
});
```

Ampliar `tests/unit/services/catalog-service.test.ts`:

```ts
describe("DefaultCatalogService import CSV", () => {
  let repo: InMemoryProductsRepository;
  let svc: DefaultCatalogService;

  beforeEach(() => {
    repo = new InMemoryProductsRepository();
    svc = new DefaultCatalogService({ productos: repo });
  });

  const HEADER = "codigo_interno,nombre,descripcion,categoria,precio,stock,sku_proveedor";

  test("previewImport no toca la DB", () => {
    const preview = svc.previewImport([HEADER, "P-1,Prod,,,10,1,"].join("\n"));
    expect(preview.validos).toHaveLength(1);
    // ninguna escritura ocurrió
    return expect(repo.list()).resolves.toHaveLength(0);
  });

  test("confirmImport upserta válidos y omite filas con error", async () => {
    await repo.create(baseInsert({ codigo_interno: "EX-1", precio: 100, activo: false }));
    const csv = [
      HEADER,
      "EX-1,Existente actualizado,,,250,9,",
      "NEW-1,Nuevo,,,50,2,",
      "BAD-1,Malo,,,gratis,1,",
    ].join("\n");

    const result = await svc.confirmImport(csv);
    expect(result).toEqual({ importados: 2, omitidos: 1 });

    const ex = await repo.findByCodigoInterno("EX-1");
    expect(ex?.precio).toBe(250);
    expect(ex?.activo).toBe(false); // preservado (Task 7)
    expect(await repo.findByCodigoInterno("NEW-1")).not.toBeNull();
    expect(await repo.findByCodigoInterno("BAD-1")).toBeNull();
  });

  test("confirmImport con 0 válidos no llama bulkUpsert y reporta 0", async () => {
    const result = await svc.confirmImport([HEADER, "B-1,Prod,,,x,1,"].join("\n"));
    expect(result).toEqual({ importados: 0, omitidos: 1 });
    expect(await repo.list()).toHaveLength(0);
  });

  test("confirmImport CSV estructuralmente inválido propaga ValidationError", async () => {
    await expect(svc.confirmImport("nope")).rejects.toBeInstanceOf(ValidationError);
  });
});
```

(agregar `import { ValidationError } from "@/lib/errors";` al archivo si no está).

- [ ] **Step 3: Run to verify fail**

Run: `npx vitest run tests/unit/services`
Expected: FAIL — módulos/métodos no existen.

- [ ] **Step 4: Implement**

a) `src/types/productos.ts` — contenido exacto del bloque "Produces" de esta task.

b) Agregar a `src/lib/validation/productos.schema.ts`:

```ts
// Celdas numéricas CSV llegan como string. "" → undefined para que el campo
// requerido falle claro (Number("") === 0 sería un 0 silencioso — bug de datos).
const csvNumberCell = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

/** Fila CSV import catálogo. Headers ya normalizados (trim + lowercase). */
export const CsvProductoRowSchema = z.object({
  codigo_interno: z.string().trim().min(1).max(64),
  nombre: z.string().trim().min(1).max(200),
  descripcion: emptyToNull(1000),
  categoria: emptyToNull(100),
  sku_proveedor: emptyToNull(100),
  precio: z.preprocess(csvNumberCell, z.coerce.number().nonnegative().finite()),
  stock: z.preprocess(csvNumberCell, z.coerce.number().int().nonnegative()),
});
```

c) `src/server/services/catalog/csv-import.ts`:

```ts
import Papa from "papaparse";
import { ValidationError } from "@/lib/errors";
import { CsvProductoRowSchema } from "@/lib/validation/productos.schema";
import type { CsvProductoRow, CsvRowError, ImportPreview } from "@/types/productos";

export const CSV_HEADERS_REQUERIDOS = ["codigo_interno", "nombre", "precio", "stock"] as const;

/**
 * Parsea CSV de catálogo. Columnas: codigo_interno,nombre,descripcion,categoria,
 * precio,stock,sku_proveedor (headers case-insensitive; extras se ignoran).
 * Estructura inválida (vacío / faltan headers requeridos) → ValidationError.
 * Errores por fila → `errores` con número de línea real (header = línea 1).
 */
export function parseProductosCsv(csvText: string): ImportPreview {
  const parsed = Papa.parse<Record<string, string>>(csvText.replace(/^﻿/, ""), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase(),
  });

  const fields = parsed.meta.fields ?? [];
  const faltantes = CSV_HEADERS_REQUERIDOS.filter((h) => !fields.includes(h));
  if (faltantes.length > 0) {
    throw new ValidationError(`CSV inválido: faltan columnas requeridas (${faltantes.join(", ")})`);
  }
  if (parsed.data.length === 0) {
    throw new ValidationError("CSV vacío: no hay filas de datos.");
  }

  // Errores estructurales de papaparse (comillas rotas, etc.), indexados por fila de datos.
  const papaErroresPorFila = new Map<number, string[]>();
  for (const err of parsed.errors) {
    if (typeof err.row !== "number") continue;
    const list = papaErroresPorFila.get(err.row) ?? [];
    list.push(err.message);
    papaErroresPorFila.set(err.row, list);
  }

  const validos: CsvProductoRow[] = [];
  const errores: CsvRowError[] = [];
  const vistos = new Set<string>();

  parsed.data.forEach((raw, i) => {
    const fila = i + 2; // header ocupa la línea 1

    const papaErrs = papaErroresPorFila.get(i);
    if (papaErrs) {
      errores.push({ fila, errores: papaErrs });
      return;
    }

    const row = CsvProductoRowSchema.safeParse(raw);
    if (!row.success) {
      errores.push({
        fila,
        errores: row.error.issues.map((iss) => `${iss.path.join(".")}: ${iss.message}`),
      });
      return;
    }

    if (vistos.has(row.data.codigo_interno)) {
      errores.push({
        fila,
        errores: [`codigo_interno duplicado en el archivo: ${row.data.codigo_interno}`],
      });
      return;
    }

    vistos.add(row.data.codigo_interno);
    validos.push(row.data);
  });

  return { total: parsed.data.length, validos, errores };
}
```

d) Interface `CatalogService` — agregar:

```ts
import type { ImportPreview, ImportResult } from "@/types/productos";
```

```ts
  /** Parse + validación por fila del CSV. Puro (no toca DB). ValidationError si estructura inválida. */
  previewImport(csvText: string): ImportPreview;

  /** Re-parsea y upserta solo filas válidas por codigo_interno; omite filas con error. */
  confirmImport(csvText: string): Promise<ImportResult>;
```

e) `DefaultCatalogService` — agregar:

```ts
import { parseProductosCsv } from "./csv-import";
import type { ImportPreview, ImportResult } from "@/types/productos";
```

```ts
  previewImport(csvText: string): ImportPreview {
    return parseProductosCsv(csvText);
  }

  async confirmImport(csvText: string): Promise<ImportResult> {
    const preview = parseProductosCsv(csvText);
    if (preview.validos.length > 0) {
      await this.deps.productos.bulkUpsert(preview.validos);
    }
    return { importados: preview.validos.length, omitidos: preview.errores.length };
  }
```

(`CsvProductoRow` es estructuralmente idéntico a `ProductoBulkUpsertItem` — el compilador lo verifica en la llamada a `bulkUpsert`.)

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/unit/services && npm run typecheck`
Expected: PASS todo.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/types/productos.ts src/lib/validation/productos.schema.ts src/server/services/catalog/ tests/unit/services/
git commit -m "feat(catalog): import CSV parse + preview + confirm con papaparse"
```

---

### Task 9: UI 9.C — página import + actions + baja del stub API

**Skills:** `vercel:nextjs`, `vercel:shadcn`, `frontend-design`, `webapp-testing`.

**Files:**

- Create: `src/app/(panel)/productos/import/_actions/import.actions.ts`
- Modify: `src/app/(panel)/productos/import/page.tsx` (reemplaza stub)
- Create: `src/components/productos/ImportCsv.tsx`
- Modify: `src/app/(panel)/productos/page.tsx` (link "Importar CSV" en header admin)
- Delete: `src/app/api/productos/import/route.ts`

**Interfaces:**

- Consumes: `previewImport`/`confirmImport` (Task 8), `getCurrentRol` (Task 1), `toActionError` (Task 5), types de `@/types/productos` (Task 8).
- Produces: `previewImportCsvAction(formData: FormData): Promise<ImportPreviewActionResult>`, `confirmImportCsvAction(formData: FormData): Promise<ImportConfirmActionResult>`.

- [ ] **Step 1: Write actions**

`src/app/(panel)/productos/import/_actions/import.actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ValidationError } from "@/lib/errors";
import { getCatalogServiceForRequest } from "@/server/bootstrap/catalog-bootstrap";
import { toActionError } from "../../_actions/action-error";
import type { ImportConfirmActionResult, ImportPreviewActionResult } from "@/types/productos";

// Server Actions body limit default 1MB — cap alineado. Catálogos más grandes
// se parten en varios archivos (pilot ~5K SKUs ≈ 400KB, entra holgado).
const MAX_CSV_BYTES = 1_000_000;

const ImportCsvFormSchema = z.object({ file: z.instanceof(File) });

async function readCsvFile(formData: FormData): Promise<string | { error: string }> {
  const parsed = ImportCsvFormSchema.safeParse({ file: formData.get("file") });
  if (!parsed.success || parsed.data.file.size === 0) {
    return { error: "Seleccioná un archivo CSV." };
  }
  if (parsed.data.file.size > MAX_CSV_BYTES) {
    return { error: "Archivo muy grande (máx 1 MB). Partí el catálogo en varios CSV." };
  }
  return parsed.data.file.text();
}

export async function previewImportCsvAction(
  formData: FormData,
): Promise<ImportPreviewActionResult> {
  const csv = await readCsvFile(formData);
  if (typeof csv !== "string") return { ok: false, error: csv.error };

  try {
    const svc = await getCatalogServiceForRequest();
    return { ok: true, preview: svc.previewImport(csv) };
  } catch (e) {
    if (e instanceof ValidationError) return { ok: false, error: e.message };
    return toActionError(e, "preview-import-csv");
  }
}

export async function confirmImportCsvAction(
  formData: FormData,
): Promise<ImportConfirmActionResult> {
  const csv = await readCsvFile(formData);
  if (typeof csv !== "string") return { ok: false, error: csv.error };

  try {
    const svc = await getCatalogServiceForRequest();
    const result = await svc.confirmImport(csv);
    revalidatePath("/productos");
    return { ok: true, result };
  } catch (e) {
    if (e instanceof ValidationError) return { ok: false, error: e.message };
    return toActionError(e, "confirm-import-csv");
  }
}
```

- [ ] **Step 2: Write `ImportCsv` client component**

`src/components/productos/ImportCsv.tsx`:

```tsx
"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type {
  ImportConfirmActionResult,
  ImportPreview,
  ImportPreviewActionResult,
} from "@/types/productos";

const COLUMNAS = "codigo_interno,nombre,descripcion,categoria,precio,stock,sku_proveedor";

export function ImportCsv({
  onPreview,
  onConfirm,
}: {
  onPreview: (formData: FormData) => Promise<ImportPreviewActionResult>;
  onConfirm: (formData: FormData) => Promise<ImportConfirmActionResult>;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [isPending, startTransition] = useTransition();

  const buildFormData = (): FormData | null => {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      toast.error("Seleccioná un archivo CSV.");
      return null;
    }
    const fd = new FormData();
    fd.set("file", file);
    return fd;
  };

  const analizar = () => {
    const fd = buildFormData();
    if (!fd) return;
    startTransition(async () => {
      const r = await onPreview(fd);
      if (!r.ok) {
        toast.error(r.error);
        setPreview(null);
        return;
      }
      setPreview(r.preview);
    });
  };

  const confirmar = () => {
    const fd = buildFormData();
    if (!fd) return;
    startTransition(async () => {
      const r = await onConfirm(fd);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(
        `${r.result.importados} productos importados` +
          (r.result.omitidos > 0 ? ` (${r.result.omitidos} filas omitidas)` : ""),
      );
      router.push("/productos");
    });
  };

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <div className="text-muted-foreground text-sm">
        <p>
          Columnas esperadas (header obligatorio): <code className="font-mono">{COLUMNAS}</code>
        </p>
        <p className="mt-1">
          Requeridas: codigo_interno, nombre, precio, stock. Existentes se actualizan por código;
          nuevos se crean. Filas con error se omiten.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <Input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          disabled={isPending}
          aria-label="Archivo CSV"
          onChange={() => setPreview(null)}
          className="max-w-sm"
        />
        <Button onClick={analizar} disabled={isPending} variant="outline">
          {isPending ? "Procesando…" : "Analizar"}
        </Button>
      </div>

      {preview ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm">
            <span className="font-medium">{preview.total}</span> filas ·{" "}
            <span className="font-medium text-green-700 dark:text-green-400">
              {preview.validos.length} válidas
            </span>{" "}
            ·{" "}
            <span className="font-medium text-red-700 dark:text-red-400">
              {preview.errores.length} con errores
            </span>
          </p>

          {preview.errores.length > 0 ? (
            <div className="border-border max-h-72 overflow-y-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-20">Fila</TableHead>
                    <TableHead>Errores</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.errores.map((e) => (
                    <TableRow key={e.fila}>
                      <TableCell className="tabular-nums">{e.fila}</TableCell>
                      <TableCell className="text-sm">{e.errores.join("; ")}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : null}

          <div>
            <Button onClick={confirmar} disabled={isPending || preview.validos.length === 0}>
              {isPending ? "Importando…" : `Confirmar import (${preview.validos.length} productos)`}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 3: Write import page + link en /productos + delete stub**

`src/app/(panel)/productos/import/page.tsx` (reemplaza stub completo):

```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { ImportCsv } from "@/components/productos/ImportCsv";
import { getCurrentRol } from "@/server/auth/guards";
import { confirmImportCsvAction, previewImportCsvAction } from "./_actions/import.actions";

export const dynamic = "force-dynamic";

export default async function ProductosImportPage() {
  // Gate UI server-side; RLS enforcea igual si alguien llega a la action.
  const rol = await getCurrentRol();
  if (rol !== "admin") redirect("/productos");

  return (
    <div className="flex h-screen flex-col">
      <header className="border-border flex items-center gap-3 border-b px-4 py-3">
        <h1 className="text-lg font-semibold">Importar catálogo (CSV)</h1>
        <Link href="/productos" className="text-muted-foreground text-sm hover:underline">
          ← Volver a productos
        </Link>
      </header>
      <div className="flex-1 overflow-y-auto p-4">
        <ImportCsv onPreview={previewImportCsvAction} onConfirm={confirmImportCsvAction} />
      </div>
    </div>
  );
}
```

En `src/app/(panel)/productos/page.tsx`, header admin — envolver el dialog existente:

```tsx
{
  isAdmin ? (
    <div className="flex items-center gap-2">
      <Link
        href="/productos/import"
        className="border-border hover:bg-accent inline-flex h-8 items-center rounded-md border px-3 text-sm"
      >
        Importar CSV
      </Link>
      <ProductoFormDialog
        title="Nuevo producto"
        description="Alta manual de catálogo. Para volumen usá Importar CSV."
        triggerLabel="Nuevo producto"
        onSubmit={createProductoAction}
      />
    </div>
  ) : null;
}
```

(agregar `import Link from "next/link";` al archivo).

Borrar stub muerto (verificar antes que nadie lo referencia):

```bash
grep -rn "api/productos/import" src/ tests/ --include='*.ts' --include='*.tsx'
git rm src/app/api/productos/import/route.ts
```

Expected grep: sin matches fuera del propio route.

- [ ] **Step 4: Typecheck + lint + unit**

Run: `npm run typecheck && npm run lint && npx vitest run tests/unit`
Expected: 0 errors, tests PASS.

- [ ] **Step 5: Validación browser (webapp-testing)**

Fixture CSV (crear en scratchpad, NO en el repo):

```csv
codigo_interno,nombre,descripcion,categoria,precio,stock,sku_proveedor
CSV-001,Pastilla freno CSV,Juego delantero,frenos,99000,4,BR-999
CSV-002,Filtro aceite CSV,,filtros,15500,20,
TEST-9B-1,Pastilla test renombrada,,frenos,175,8,
CSV-BAD,Sin precio,,,,-3,
```

1. Login admin → `/productos` → click "Importar CSV" → `/productos/import` carga.
2. Subir fixture → "Analizar" → preview: 4 filas, 3 válidas, 1 con errores (fila 5: precio + stock).
3. "Confirmar import (3 productos)" → toast "3 productos importados (1 filas omitidas)" → redirect `/productos`.
4. Verificar: `CSV-001` y `CSV-002` nuevos; `TEST-9B-1` (de Task 6) actualizado con nombre/precio nuevos y estado preservado; `CSV-BAD` no existe.
5. Subir archivo no-CSV (ej. .txt renombrado con contenido basura) → toast error ValidationError legible.
6. Screenshot evidencia.

- [ ] **Step 6: Commit**

```bash
git add src/app/\(panel\)/productos/ src/components/productos/ImportCsv.tsx
git commit -m "feat(ui): fase 9.C import CSV productos + baja stub API route"
```

---

### Task 10: Cierre fase 9 — CI + docs

**Skills:** `superpowers:verification-before-completion`.

**Files:**

- Modify: `AGENTS.md` (§2 estado + tabla progreso + métricas)
- Modify: `docs/next-session.md` (tabla + "Cómo continuar")

- [ ] **Step 1: Full gate local**

Run: `npm run ci`
Expected: lint 0 errors + typecheck 0 + unit suite completa verde + coverage ≥ 80/75/80/80. Si coverage de branches cae por los components nuevos, verificar que `vitest.config.ts` los excluya igual que los 8.x (components se validan browser) — NO bajar thresholds.

- [ ] **Step 2: Update docs**

`AGENTS.md`:

- §2 "Sub-paso actual": fase 9 Productos completa (9.A lista+search · 9.B CRUD · 9.C import CSV) con resumen 1 línea por sub-paso + hashes de commits.
- Tabla progreso fila Slice 2: agregar "vistas: 9 ✅ (10-12 pendientes)".
- "Siguiente sub-paso": fase 10 Leads (plan pendiente sobre el mismo spec).
- Métricas: actualizar count de tests.

`docs/next-session.md`:

- Tabla: fila "Slice 2 vistas 9-12" → "9 ✅ · 10-12 pendientes (plan `docs/superpowers/plans/2026-07-14-slice2-fase9-productos.md` completado; próximo: plan fase 10)".
- Historial commits: refrescar últimos 10.

- [ ] **Step 3: Commit docs**

```bash
git add AGENTS.md docs/next-session.md
git commit -m "docs(agents,next-session): fase 9 productos completa"
```

(Push a remoto solo si el usuario lo pide — regla repo.)

---

## Self-review (ejecutado al escribir el plan)

1. **Spec coverage §Fase 9:** Table shadcn + búsqueda `?q=` ✓ T4 · columnas exactas (código mono, nombre, categoría, precio, stock, badge activo) ✓ T4 · rol-aware `getCurrentRol()` ✓ T1+T6 · CRUD Dialog + Server Actions Zod línea 1 ✓ T5-T6 · sin delete, baja = `activo=false` ✓ T5 (`setProductoActivo`) · import CSV stubs → upload/parse papaparse/preview errores por fila/confirmar/upsert por `codigo_interno` ✓ T7-T9 · columnas CSV exactas del spec ✓ T8 · transversal: service per-request + ActionResult + toasts + Playwright + commit por sub-paso ✓.
2. **Placeholder scan:** cero TBD/TODO; todo step con código o comando completo. Única verificación delegada a ejecución: nombre exacto/constructor de `InfraError` (T7 Step 4, marcado inline).
3. **Type consistency:** `ProductoBulkUpsertItem` (T7) == shape `CsvProductoRow` (T8) == 7 columnas CSV ✓ · `toActionError` retorna `{ ok: false; error: string }` asignable a `ActionResult` y a los action results del import ✓ · `ProductoFormValues` == `CreateProductoInput` shape ✓ · firmas `onUpdate`/`onToggleActivo` idénticas en `ProductosTable`, `ProductoRowActions` y actions ✓.

## Riesgos conocidos (aceptados)

- **Cap 1000 filas sin paginación** — documentado en service; búsqueda acota; paginación diferida (fase 12+ si duele).
- **`defaultToNull: false`** en upsert: soportado por `@supabase/supabase-js@2.110.4` (verificado en package.json). Integration test T7 Step 6 lo confirma contra Postgres real.
- **Coverage:** components UI sin unit tests (patrón 8.x: browser validation). Gate real en T10 Step 1.
