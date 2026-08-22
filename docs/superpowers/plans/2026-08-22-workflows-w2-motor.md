# W2 — Motor de workflows: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un workflow publicado se dispare solo, recorra su grafo, ejecute acciones —incluido mandar WhatsApp al cliente—, espere cuando tiene que esperar, y termine sin poder descontrolarse.

**Architecture:** Segmentos entre esperas. Una ejecución de Inngest corre nodos inline hasta toparse con una `espera`; ahí persiste `nodo_actual` + `contexto` en Postgres y programa el evento del segmento siguiente. El subgrafo sin esperas es acíclico por construcción —lo demuestra el validador de W1— así que un segmento recorre un DAG y termina en a lo sumo 200 nodos.

**Tech Stack:** TypeScript strict, Next.js 16, Supabase (Postgres + PostgREST), Inngest, Zod, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-22-workflows-w2-motor-design.md`. Ante cualquier duda de comportamiento, manda el spec.

## Global Constraints

- **Idioma:** UI, comentarios y commits en español. Identificadores técnicos genéricos en inglés (`leadId`, `runId`); de dominio en español (`nodo_actual`, `pasos_ejecutados`).
- **Commits:** Conventional Commits, subject ≤72 chars, en español. El hook `commit-msg` los rechaza si no.
- **`git add` con rutas explícitas siempre.** Nunca `-A`, nunca `commit -a`. El hook `pre-commit` typechequea todo el proyecto.
- **Prohibido `throw new Error('msg')` en `src/server/**`.** Usar la jerarquía de `src/lib/errors.ts`: `ValidationError`, `NotFoundError`, `ConflictError`, `PermissionDeniedError`, `IllegalStateError`, `BudgetExceededError`, `InfraError`, `RateLimitError`.
- **Prohibido `console.log` en `src/**`.** Sólo `logger.info|warn|error|debug`.
- **Nunca loggear** `telefono`, `mensaje.body`, `email` ni `meta_user_ids` en crudo. Usar `redactPii()` de `src/lib/observability/redact.ts`.
- **NO correr `npm run test:integration`.** Está congelado a nivel proyecto: vacía la base de dev.
- **NO correr `npm run build`** con el dev server levantado. Corrompe `.next/`.
- **Migraciones:** aplicar con `mcp__plugin_supabase_supabase__apply_migration` sobre `project_id: emubzkouwvuzlrtsgorx`, después llamar `list_migrations` y **renombrar el archivo local al número que el MCP registró**. Esa divergencia ya se pagó seis veces.
- **Capas:** API/Action → Service → Repository → DB. Nunca saltar. ESLint `boundaries` lo hace cumplir.
- Tests con Vitest. Comando: `npx vitest run <ruta>`.

---

## File Structure

| Archivo                                                    | Responsabilidad                                                             |
| ---------------------------------------------------------- | --------------------------------------------------------------------------- |
| `supabase/migrations/<ts>_workflows_motor.sql`             | Columna de concurrencia, tope de salientes, RPC de arranque                 |
| `src/types/workflows.ts` (modificar)                       | Tipos del motor: `ResultadoSegmento`, `ContextoRun`, condición estructurada |
| `src/lib/workflows/recorrer.ts`                            | Lógica pura de navegación del grafo                                         |
| `src/lib/workflows/condiciones.ts`                         | Evaluación de condiciones estructuradas + lista blanca de campos            |
| `src/lib/validation/workflows.schema.ts` (modificar)       | Zod de `config` por tipo de nodo                                            |
| `src/server/repositories/workflow-runs.repo.ts`            | Interface + InMemory de corridas y pasos                                    |
| `src/server/repositories/workflow-runs.supabase.repo.ts`   | Impl Supabase, incluye el CAS y el RPC de arranque                          |
| `src/server/services/workflows/acciones/registro.ts`       | Interface `AccionHandler` + registro inyectable                             |
| `src/server/services/workflows/acciones/internas.ts`       | `poner_etiqueta`, `cambiar_etapa`, `escalar_a_humano`                       |
| `src/server/services/workflows/acciones/enviar-mensaje.ts` | El saliente. Capa 3 + ventana de 24 h                                       |
| `src/server/services/workflows/ejecutor.service.ts`        | Corre un segmento                                                           |
| `src/server/services/workflows/simulador.service.ts`       | Corre el grafo entero con reloj virtual                                     |
| `src/inngest/functions/workflow-disparar.ts`               | Decide si arranca una corrida y la crea                                     |
| `src/inngest/functions/workflow-segmento.ts`               | Corre un segmento, persiste, programa el siguiente                          |
| `scripts/simular-workflow.mjs`                             | Correr el simulador desde la terminal                                       |

---

## Task 1: Migración del motor

**Files:**

- Create: `supabase/migrations/<timestamp>_workflows_motor.sql`
- Modify: `src/types/entities.ts` (agregar `politica_concurrencia` a `WorkflowVersion`)
- Modify: `src/server/db/types.gen.ts` (regenerar)

**Interfaces:**

- Produces: enum `workflow_concurrencia`; columna `workflow_versiones.politica_concurrencia`; columna `agente_config.max_salientes_automaticos_24h`; función `arrancar_workflow_run(uuid, uuid, uuid, jsonb) returns table (run_id uuid, error_code text)`.

- [ ] **Step 1: Escribir la migración**

```sql
-- W2: lo que el motor necesita en la base. Tres cosas y ninguna mas.

create type workflow_concurrencia as enum ('ignorar','reiniciar','permitir');

-- Vive en la VERSION y no en el workflow: es comportamiento, no preferencia.
-- Cambiarlo genera version nueva, igual que max_pasos.
alter table public.workflow_versiones
  add column politica_concurrencia workflow_concurrencia not null default 'ignorar';

-- Capa 3. Vive en agente_config porque esa tabla ya ES la politica de la
-- organizacion, versionada y auditada (tope_gasto_diario_usd, horario).
alter table public.agente_config
  add column max_salientes_automaticos_24h integer not null default 3;
alter table public.agente_config
  add constraint agente_config_max_salientes_rango
  check (max_salientes_automaticos_24h between 1 and 20);

-- Consultar "hay corrida viva?" y despues insertar es una carrera: dos
-- disparos simultaneos ven cero y crean dos corridas, que con salientes
-- habilitados es el doble de mensajes. El advisory lock serializa por
-- (workflow, lead) y hace que decision e insert sean una sola cosa.
create or replace function public.arrancar_workflow_run(
  p_version_id uuid,
  p_lead_id    uuid,
  p_session_id uuid,
  p_contexto   jsonb
)
returns table (run_id uuid, error_code text)
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_workflow_id uuid;
  v_politica    public.workflow_concurrencia;
  v_viva        uuid;
begin
  select wv.workflow_id, wv.politica_concurrencia
    into v_workflow_id, v_politica
    from public.workflow_versiones as wv
   where wv.id = p_version_id;

  if not found then
    return query select null::uuid, 'version_not_found'::text;
    return;
  end if;

  -- hashtextextended da un bigint estable; el lock se suelta al commit.
  perform pg_advisory_xact_lock(
    hashtextextended(v_workflow_id::text || ':' || p_lead_id::text, 0)
  );

  select r.id into v_viva
    from public.workflow_runs as r
    join public.workflow_versiones as v on v.id = r.workflow_version_id
   where v.workflow_id = v_workflow_id
     and r.lead_id = p_lead_id
     and r.estado in ('corriendo','esperando')
   limit 1;

  if v_viva is not null then
    if v_politica = 'ignorar' then
      return query select null::uuid, 'ya_hay_corrida_viva'::text;
      return;
    elsif v_politica = 'reiniciar' then
      update public.workflow_runs
         set estado = 'cancelado',
             ended_at = now(),
             error = 'reiniciado por un disparo nuevo'
       where id = v_viva;
    end if;
  end if;

  return query
  insert into public.workflow_runs (workflow_version_id, lead_id, lead_session_id, contexto)
  values (p_version_id, p_lead_id, p_session_id, coalesce(p_contexto, '{}'::jsonb))
  returning public.workflow_runs.id, null::text;
end;
$function$;

revoke all on function public.arrancar_workflow_run(uuid, uuid, uuid, jsonb) from public, anon;
grant execute on function public.arrancar_workflow_run(uuid, uuid, uuid, jsonb) to service_role;

comment on function public.arrancar_workflow_run(uuid, uuid, uuid, jsonb) is
  'Arranca una corrida aplicando la politica de concurrencia de la version, con advisory lock por (workflow, lead) para que decision e insert sean atomicos.';
```

- [ ] **Step 2: Aplicar con el MCP y reconciliar el nombre**

Aplicar con `mcp__plugin_supabase_supabase__apply_migration` (`project_id: emubzkouwvuzlrtsgorx`, `name: workflows_motor`). Después llamar `mcp__plugin_supabase_supabase__list_migrations` y **renombrar el archivo local al `version` que devuelva**. Reportar ambos números.

- [ ] **Step 3: Regenerar tipos y agregar el campo a la entidad**

Correr `mcp__plugin_supabase_supabase__generate_typescript_types` y actualizar `src/server/db/types.gen.ts`. En `src/types/entities.ts`, dentro de `WorkflowVersion`:

```ts
/** Qué hacer si llega un disparo con una corrida viva de este workflow. */
politica_concurrencia: PoliticaConcurrencia;
```

Y arriba de `WorkflowVersion`:

```ts
export const POLITICAS_CONCURRENCIA = ["ignorar", "reiniciar", "permitir"] as const;
export type PoliticaConcurrencia = (typeof POLITICAS_CONCURRENCIA)[number];
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: falla en `workflows.repo.ts` y en los tests, porque `WorkflowVersionInsert` ahora exige `politica_concurrencia`. Darle default `"ignorar"` en la impl InMemory (`crearVersion`) y en `COLS_VERSION` de la impl Supabase agregar `politica_concurrencia`. Volver a correr hasta que dé limpio.

- [ ] **Step 5: Correr la suite**

Run: `npx vitest run`
Expected: PASS. Reportar el número real.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/<archivo-renombrado>.sql src/types/entities.ts src/server/db/types.gen.ts src/server/repositories/workflows.repo.ts src/server/repositories/workflows.supabase.repo.ts
git commit -m "feat(workflows): schema del motor -- concurrencia, tope y arranque atomico"
```

---

## Task 2: `recorrer.ts` — navegación pura del grafo

**Files:**

- Create: `src/lib/workflows/recorrer.ts`
- Test: `tests/unit/workflows/recorrer.test.ts`

**Interfaces:**

- Consumes: `Grafo`, `Nodo`, `Puerto` de `@/types/workflows`.
- Produces: `nodoPorId(grafo, id): Nodo | undefined`, `siguienteNodo(grafo, nodoId, puerto): string | undefined`, `disparadorDe(grafo): Nodo | undefined`.

- [ ] **Step 1: Escribir el test que falla**

```ts
import { describe, expect, it } from "vitest";
import { disparadorDe, nodoPorId, siguienteNodo } from "@/lib/workflows/recorrer";
import type { Grafo } from "@/types/workflows";

const grafo: Grafo = {
  nodos: [
    { id: "d", tipo: "disparador", config: {}, posicion: { x: 0, y: 0 } },
    { id: "c", tipo: "condicion", config: {}, posicion: { x: 0, y: 0 } },
    { id: "si", tipo: "accion", config: {}, posicion: { x: 0, y: 0 } },
    { id: "no", tipo: "fin", config: {}, posicion: { x: 0, y: 0 } },
  ],
  aristas: [
    { desde: "d", hasta: "c", puerto: "salida" },
    { desde: "c", hasta: "si", puerto: "verdadero" },
    { desde: "c", hasta: "no", puerto: "falso" },
  ],
};

describe("recorrer", () => {
  it("sigue el puerto que se le pide, no el primero que encuentra", () => {
    expect(siguienteNodo(grafo, "c", "verdadero")).toBe("si");
    expect(siguienteNodo(grafo, "c", "falso")).toBe("no");
  });

  it("devuelve undefined cuando el puerto no tiene arista", () => {
    expect(siguienteNodo(grafo, "no", "salida")).toBeUndefined();
  });

  it("encuentra el nodo por id y el disparador", () => {
    expect(nodoPorId(grafo, "si")?.tipo).toBe("accion");
    expect(nodoPorId(grafo, "nope")).toBeUndefined();
    expect(disparadorDe(grafo)?.id).toBe("d");
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npx vitest run tests/unit/workflows/recorrer.test.ts`
Expected: FAIL — "Failed to resolve import @/lib/workflows/recorrer".

- [ ] **Step 3: Implementar**

```ts
import type { Grafo, Nodo, Puerto } from "@/types/workflows";

export function nodoPorId(grafo: Grafo, id: string): Nodo | undefined {
  return grafo.nodos.find((n) => n.id === id);
}

export function disparadorDe(grafo: Grafo): Nodo | undefined {
  return grafo.nodos.find((n) => n.tipo === "disparador");
}

/**
 * Cuál nodo sigue al salir de `nodoId` por `puerto`.
 *
 * `undefined` significa que el puerto no tiene arista. En un grafo que pasó el
 * validador eso sólo puede pasar en un `fin`, que no tiene puertos: el resto
 * los tiene todos conectados por la regla `salida_sin_conectar`.
 */
export function siguienteNodo(grafo: Grafo, nodoId: string, puerto: Puerto): string | undefined {
  return grafo.aristas.find((a) => a.desde === nodoId && a.puerto === puerto)?.hasta;
}
```

- [ ] **Step 4: Correr el test**

Run: `npx vitest run tests/unit/workflows/recorrer.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/workflows/recorrer.ts tests/unit/workflows/recorrer.test.ts
git commit -m "feat(workflows): navegacion pura del grafo"
```

---

## Task 3: Condiciones estructuradas, sin lenguaje

**Files:**

- Create: `src/lib/workflows/condiciones.ts`
- Modify: `src/lib/validation/workflows.schema.ts`
- Test: `tests/unit/workflows/condiciones.test.ts`

**Interfaces:**

- Produces: `CAMPOS_CONDICION` (lista blanca), `OPERADORES`, `type Condicion = { campo, operador, valor }`, `evaluarCondicion(cond, contexto): boolean`, `CondicionSchema` (Zod).

**Por qué así:** la queja concreta del dueño contra Kommo fue que inventaron su propio lenguaje y con flujos grandes no funciona. No se hace un lenguaje mejor: no se hace ninguno. Una condición es una comparación estructurada que Zod valida al guardar y que el canvas de W5 dibuja con dos selects.

- [ ] **Step 1: Escribir el test que falla**

```ts
import { describe, expect, it } from "vitest";
import { evaluarCondicion } from "@/lib/workflows/condiciones";

const contexto = { lead: { etapa: "cotizado", nombre: "Ana" }, sesion: { respondio: false } };

describe("evaluarCondicion", () => {
  it("compara igualdad por campo de la lista blanca", () => {
    expect(
      evaluarCondicion({ campo: "lead.etapa", operador: "es", valor: "cotizado" }, contexto),
    ).toBe(true);
    expect(
      evaluarCondicion({ campo: "lead.etapa", operador: "es", valor: "perdido" }, contexto),
    ).toBe(false);
  });

  it("no_es es la negacion exacta de es", () => {
    expect(
      evaluarCondicion({ campo: "lead.etapa", operador: "no_es", valor: "perdido" }, contexto),
    ).toBe(true);
  });

  it("contiene compara texto sin distinguir mayusculas", () => {
    expect(
      evaluarCondicion({ campo: "lead.nombre", operador: "contiene", valor: "AN" }, contexto),
    ).toBe(true);
  });

  it("un campo ausente del contexto es false, no una excepcion", () => {
    // Un flujo no se cae porque un dato todavia no exista: la rama falso es
    // una respuesta valida y el canvas siempre la tiene conectada.
    expect(evaluarCondicion({ campo: "lead.etapa", operador: "es", valor: "x" }, {})).toBe(false);
  });

  it("es_verdadero lee booleanos", () => {
    expect(
      evaluarCondicion(
        { campo: "sesion.respondio", operador: "es_verdadero", valor: null },
        contexto,
      ),
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npx vitest run tests/unit/workflows/condiciones.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar**

```ts
/**
 * Los campos que una condición puede mirar. Lista blanca a propósito: W3 la
 * amplía agregando entradas acá, y nadie amplía una gramática.
 */
export const CAMPOS_CONDICION = [
  "lead.etapa",
  "lead.nombre",
  "lead.canal",
  "sesion.respondio",
  "sesion.tiene_cotizacion",
] as const;
export type CampoCondicion = (typeof CAMPOS_CONDICION)[number];

export const OPERADORES = ["es", "no_es", "contiene", "es_verdadero", "es_falso"] as const;
export type Operador = (typeof OPERADORES)[number];

export interface Condicion {
  campo: CampoCondicion;
  operador: Operador;
  valor: string | null;
}

function leer(contexto: Record<string, unknown>, campo: string): unknown {
  return campo.split(".").reduce<unknown>((actual, parte) => {
    if (actual === null || typeof actual !== "object") return undefined;
    return (actual as Record<string, unknown>)[parte];
  }, contexto);
}

/**
 * Un campo ausente da `false`, nunca una excepción: que un dato todavía no
 * exista es información, no una falla. La rama `falso` de la condición siempre
 * está conectada porque el validador de W1 lo exige, así que el flujo tiene a
 * dónde ir.
 */
export function evaluarCondicion(cond: Condicion, contexto: Record<string, unknown>): boolean {
  const actual = leer(contexto, cond.campo);
  if (cond.operador === "es_verdadero") return actual === true;
  if (cond.operador === "es_falso") return actual === false;
  if (actual === undefined || actual === null) return false;
  const texto = String(actual);
  if (cond.operador === "es") return texto === cond.valor;
  if (cond.operador === "no_es") return texto !== cond.valor;
  return texto.toLowerCase().includes(String(cond.valor ?? "").toLowerCase());
}
```

- [ ] **Step 4: Agregar el schema Zod**

En `src/lib/validation/workflows.schema.ts`:

```ts
import { CAMPOS_CONDICION, OPERADORES } from "@/lib/workflows/condiciones";

export const CondicionSchema = z.object({
  campo: z.enum(CAMPOS_CONDICION),
  operador: z.enum(OPERADORES),
  valor: z.string().max(200).nullable(),
});
```

- [ ] **Step 5: Correr los tests**

Run: `npx vitest run tests/unit/workflows/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/workflows/condiciones.ts src/lib/validation/workflows.schema.ts tests/unit/workflows/condiciones.test.ts
git commit -m "feat(workflows): condiciones estructuradas, sin lenguaje de expresiones"
```

---

## Task 4: Registro de acciones y tipos del motor

**Files:**

- Create: `src/server/services/workflows/acciones/registro.ts`
- Modify: `src/types/workflows.ts`
- Test: `tests/unit/workflows/registro.test.ts`

**Interfaces:**

- Produces: `ResultadoSegmento`, `ContextoRun`, `AccionHandler`, `RegistroDeAcciones`, `crearRegistro(handlers)`, `ResultadoAccion`.

- [ ] **Step 1: Agregar los tipos del motor a `src/types/workflows.ts`**

```ts
/** Lo que el ejecutor le devuelve a quien lo llamó al terminar un segmento. */
export type ResultadoSegmento =
  | {
      tipo: "espera";
      /** El nodo donde se cortó. Para la observabilidad de W4. */
      nodoId: string;
      hasta: Date;
      /**
       * Con qué nodo arranca el segmento siguiente. NO siempre es el que sigue:
       * un nodo `espera` reanuda en el que le sigue, pero una acción diferida
       * (fuera de horario) reanuda en SÍ MISMA, porque todavía no se ejecutó.
       * Lo resuelve el ejecutor y no quien llama, así la regla vive en un solo
       * lado en vez de repetirse en el runtime y en el simulador.
       */
      reanudarEn: string;
    }
  | { tipo: "fin" }
  | { tipo: "fallado"; nodoId: string; error: string };

/** El estado que viaja entre nodos y se persiste en `workflow_runs.contexto`. */
export type ContextoRun = Record<string, unknown>;

/** Lo que devuelve una acción: por dónde seguir y qué agregar al contexto. */
export interface ResultadoAccion {
  /** Sólo `condicion` usa `verdadero`/`falso`. El resto devuelve `salida`. */
  puerto: Puerto;
  /** Se mergea sobre el contexto de la corrida. */
  contexto?: ContextoRun;
  /** Queda en `workflow_run_pasos.salida` para la observabilidad de W4. */
  salida?: Record<string, unknown>;
  /**
   * "Todavía no, volvé a intentarme a esta hora." La acción NO se ejecutó y el
   * ejecutor corta el segmento reanudando en este mismo nodo. Lo usa
   * `enviar_mensaje` fuera del horario de atención: el mensaje sale igual, a
   * una hora razonable, en vez de descartarse en silencio.
   */
  diferirHasta?: Date;
}
```

- [ ] **Step 2: Escribir el test que falla**

```ts
import { describe, expect, it } from "vitest";
import { crearRegistro } from "@/server/services/workflows/acciones/registro";
import { ValidationError } from "@/lib/errors";

describe("crearRegistro", () => {
  it("resuelve el handler por el tipo declarado en config", async () => {
    const registro = crearRegistro({
      poner_etiqueta: async () => ({ puerto: "salida", salida: { ok: true } }),
    });
    const r = await registro.ejecutar(
      { id: "a", tipo: "accion", config: { accion: "poner_etiqueta" }, posicion: { x: 0, y: 0 } },
      { leadId: "l1", runId: "r1", orden: 1, contexto: {} },
    );
    expect(r.puerto).toBe("salida");
    expect(r.salida).toEqual({ ok: true });
  });

  it("una accion desconocida es ValidationError, no un crash", async () => {
    const registro = crearRegistro({});
    await expect(
      registro.ejecutar(
        { id: "a", tipo: "accion", config: { accion: "inventada" }, posicion: { x: 0, y: 0 } },
        { leadId: "l1", runId: "r1", orden: 1, contexto: {} },
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
```

- [ ] **Step 3: Correr el test para verificar que falla**

Run: `npx vitest run tests/unit/workflows/registro.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 4: Implementar**

```ts
import { ValidationError } from "@/lib/errors";
import type { ContextoRun, Nodo, ResultadoAccion } from "@/types/workflows";
import type { UUID } from "@/types/entities";

/** Todo lo que una acción necesita saber de la corrida que la invoca. */
export interface EntornoAccion {
  leadId: UUID;
  leadSessionId?: UUID | null;
  runId: UUID;
  /** Posición del paso dentro de la corrida. Es la clave de idempotencia. */
  orden: number;
  contexto: ContextoRun;
}

export type AccionHandler = (nodo: Nodo, entorno: EntornoAccion) => Promise<ResultadoAccion>;

export interface RegistroDeAcciones {
  ejecutar(nodo: Nodo, entorno: EntornoAccion): Promise<ResultadoAccion>;
}

/**
 * Resuelve `config.accion` contra un mapa de handlers inyectado.
 *
 * Que el registro se inyecte es lo que hace posible el simulador: pasarle un
 * registro que anota en vez de hacer da una simulación con el MISMO ejecutor,
 * no una segunda implementación que se desincroniza.
 */
export function crearRegistro(handlers: Record<string, AccionHandler>): RegistroDeAcciones {
  return {
    async ejecutar(nodo, entorno) {
      const nombre = nodo.config["accion"];
      if (typeof nombre !== "string") {
        throw new ValidationError(`el nodo "${nodo.id}" no declara acción`, "accion_ausente");
      }
      const handler = handlers[nombre];
      if (!handler) {
        throw new ValidationError(`acción desconocida: ${nombre}`, "accion_desconocida");
      }
      return handler(nodo, entorno);
    },
  };
}
```

- [ ] **Step 5: Correr los tests y el typecheck**

Run: `npx vitest run tests/unit/workflows/ && npm run typecheck`
Expected: PASS y typecheck limpio.

- [ ] **Step 6: Commit**

```bash
git add src/types/workflows.ts src/server/services/workflows/acciones/registro.ts tests/unit/workflows/registro.test.ts
git commit -m "feat(workflows): registro inyectable de acciones y tipos del motor"
```

---

## Task 5: El ejecutor — corre un segmento

**Files:**

- Create: `src/server/services/workflows/ejecutor.service.ts`
- Test: `tests/unit/workflows/ejecutor.test.ts`

**Interfaces:**

- Consumes: `siguienteNodo`, `nodoPorId` (Task 2); `evaluarCondicion` (Task 3); `RegistroDeAcciones`, `EntornoAccion`, `ResultadoSegmento` (Task 4).
- Produces: `interface EjecutorDeps { registro; ahora: () => Date; onPaso: (p: PasoEjecutado) => Promise<void> }`, `ejecutarSegmento(input): Promise<ResultadoSegmento>`, `interface PasoEjecutado { nodoId; orden; salida; error }`.

**El corazón de W2.** Corre nodos inline hasta `espera`, `fin` o tope. No sabe que existe Inngest y no sabe persistir: `onPaso` es un callback inyectado. Eso es lo que lo hace testeable sin base y reusable por el simulador.

- [ ] **Step 1: Escribir el test que falla**

```ts
import { describe, expect, it, vi } from "vitest";
import { ejecutarSegmento } from "@/server/services/workflows/ejecutor.service";
import { crearRegistro } from "@/server/services/workflows/acciones/registro";
import type { Grafo } from "@/types/workflows";

const AHORA = new Date("2026-08-22T10:00:00Z");

function grafoLineal(): Grafo {
  return {
    nodos: [
      { id: "d", tipo: "disparador", config: {}, posicion: { x: 0, y: 0 } },
      { id: "a", tipo: "accion", config: { accion: "marcar" }, posicion: { x: 0, y: 0 } },
      { id: "w", tipo: "espera", config: { minutos: 60 }, posicion: { x: 0, y: 0 } },
      { id: "f", tipo: "fin", config: {}, posicion: { x: 0, y: 0 } },
    ],
    aristas: [
      { desde: "d", hasta: "a", puerto: "salida" },
      { desde: "a", hasta: "w", puerto: "salida" },
      { desde: "w", hasta: "f", puerto: "salida" },
    ],
  };
}

const deps = (
  registro = crearRegistro({ marcar: async () => ({ puerto: "salida" as const }) }),
) => ({
  registro,
  ahora: () => AHORA,
  onPaso: vi.fn(async () => {}),
});

describe("ejecutarSegmento", () => {
  it("corre inline hasta la espera y devuelve cuando reanudar", async () => {
    const d = deps();
    const r = await ejecutarSegmento(
      {
        grafo: grafoLineal(),
        desdeNodo: "d",
        contexto: {},
        leadId: "l1",
        runId: "r1",
        pasosPrevios: 0,
        maxPasos: 500,
      },
      d,
    );
    expect(r).toEqual({
      tipo: "espera",
      nodoId: "w",
      hasta: new Date("2026-08-22T11:00:00Z"),
      reanudarEn: "f",
    });
    // d, a, w: la espera tambien es un paso.
    expect(d.onPaso).toHaveBeenCalledTimes(3);
  });

  it("reanudar despues de la espera llega al fin", async () => {
    const d = deps();
    const r = await ejecutarSegmento(
      {
        grafo: grafoLineal(),
        desdeNodo: "f",
        contexto: {},
        leadId: "l1",
        runId: "r1",
        pasosPrevios: 3,
        maxPasos: 500,
      },
      d,
    );
    expect(r).toEqual({ tipo: "fin" });
  });

  it("el tope de pasos se chequea ANTES de ejecutar el nodo", async () => {
    const marcar = vi.fn(async () => ({ puerto: "salida" as const }));
    const d = deps(crearRegistro({ marcar }));
    const r = await ejecutarSegmento(
      {
        grafo: grafoLineal(),
        desdeNodo: "a",
        contexto: {},
        leadId: "l1",
        runId: "r1",
        pasosPrevios: 500,
        maxPasos: 500,
      },
      d,
    );
    expect(r.tipo).toBe("fallado");
    // Lo que importa: la accion NO se ejecuto. Chequear despues manda el
    // mensaje 501 y recien ahi se entera.
    expect(marcar).not.toHaveBeenCalled();
  });

  it("una condicion mal configurada falla con motivo, no explota", async () => {
    const conCondicionRota: Grafo = {
      nodos: [
        { id: "c", tipo: "condicion", config: { campo: "inventado" }, posicion: { x: 0, y: 0 } },
        { id: "f", tipo: "fin", config: {}, posicion: { x: 0, y: 0 } },
      ],
      aristas: [
        { desde: "c", hasta: "f", puerto: "verdadero" },
        { desde: "c", hasta: "f", puerto: "falso" },
      ],
    };
    const r = await ejecutarSegmento(
      {
        grafo: conCondicionRota,
        desdeNodo: "c",
        contexto: {},
        leadId: "l1",
        runId: "r1",
        pasosPrevios: 0,
        maxPasos: 500,
      },
      deps(),
    );
    expect(r).toMatchObject({ tipo: "fallado", nodoId: "c" });
    expect((r as { error: string }).error).toContain("mal configurada");
  });

  it("una accion que tira deja la corrida fallada con el nodo", async () => {
    const d = deps(
      crearRegistro({
        marcar: async () => {
          throw new Error("boom");
        },
      }),
    );
    const r = await ejecutarSegmento(
      {
        grafo: grafoLineal(),
        desdeNodo: "a",
        contexto: {},
        leadId: "l1",
        runId: "r1",
        pasosPrevios: 0,
        maxPasos: 500,
      },
      d,
    );
    expect(r).toMatchObject({ tipo: "fallado", nodoId: "a" });
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npx vitest run tests/unit/workflows/ejecutor.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar**

```ts
import { CondicionSchema } from "@/lib/validation/workflows.schema";
import { evaluarCondicion } from "@/lib/workflows/condiciones";
import { nodoPorId, siguienteNodo } from "@/lib/workflows/recorrer";
import type { UUID } from "@/types/entities";
import type { ContextoRun, Grafo, ResultadoSegmento } from "@/types/workflows";
import type { RegistroDeAcciones } from "./acciones/registro";

export interface PasoEjecutado {
  nodoId: string;
  orden: number;
  salida: Record<string, unknown> | null;
  error: string | null;
}

export interface EjecutorDeps {
  registro: RegistroDeAcciones;
  /** Inyectado para que el simulador pueda adelantar un reloj virtual. */
  ahora: () => Date;
  /** Persistir el paso. El ejecutor no sabe de base: esto lo resuelve quien llama. */
  onPaso: (paso: PasoEjecutado) => Promise<void>;
}

export interface EjecutarSegmentoInput {
  grafo: Grafo;
  desdeNodo: string;
  contexto: ContextoRun;
  leadId: UUID;
  leadSessionId?: UUID | null;
  runId: UUID;
  /** Pasos que la corrida ya gastó en segmentos anteriores. */
  pasosPrevios: number;
  maxPasos: number;
}

function minutosDeEspera(config: Record<string, unknown>): number {
  const m = config["minutos"];
  return typeof m === "number" && m > 0 ? m : 60;
}

/**
 * Corre nodos inline hasta toparse con una espera, un fin, o el tope.
 *
 * No cicla nunca, y no por disciplina: el subgrafo sin esperas es acíclico por
 * construcción —es la propiedad que el validador de W1 demuestra— así que el
 * recorrido de un segmento es sobre un DAG y termina en a lo sumo N nodos.
 */
export async function ejecutarSegmento(
  input: EjecutarSegmentoInput,
  deps: EjecutorDeps,
): Promise<ResultadoSegmento> {
  let actual: string | undefined = input.desdeNodo;
  let contexto: ContextoRun = { ...input.contexto };
  let orden = input.pasosPrevios;

  while (actual !== undefined) {
    const nodo = nodoPorId(input.grafo, actual);
    if (!nodo) {
      return {
        tipo: "fallado",
        nodoId: actual,
        error: `el nodo "${actual}" no existe en el grafo`,
      };
    }

    // ANTES de ejecutar, no después: chequear después manda el mensaje 501 y
    // recién ahí se entera de que se había pasado.
    if (orden >= input.maxPasos) {
      return {
        tipo: "fallado",
        nodoId: nodo.id,
        error: `tope de ${input.maxPasos} pasos alcanzado en "${nodo.id}"`,
      };
    }
    orden += 1;

    if (nodo.tipo === "fin") {
      await deps.onPaso({ nodoId: nodo.id, orden, salida: null, error: null });
      return { tipo: "fin" };
    }

    if (nodo.tipo === "espera") {
      const siguiente = siguienteNodo(input.grafo, nodo.id, "salida");
      if (siguiente === undefined) {
        return {
          tipo: "fallado",
          nodoId: nodo.id,
          error: `la espera "${nodo.id}" no tiene salida conectada`,
        };
      }
      const hasta = new Date(deps.ahora().getTime() + minutosDeEspera(nodo.config) * 60_000);
      await deps.onPaso({
        nodoId: nodo.id,
        orden,
        salida: { hasta: hasta.toISOString() },
        error: null,
      });
      return { tipo: "espera", nodoId: nodo.id, hasta, reanudarEn: siguiente };
    }

    if (nodo.tipo === "disparador") {
      await deps.onPaso({ nodoId: nodo.id, orden, salida: null, error: null });
      actual = siguienteNodo(input.grafo, nodo.id, "salida");
      continue;
    }

    if (nodo.tipo === "condicion") {
      // Validar y no castear: `config` es `Record<string, unknown>` y un
      // `as Condicion` haría que una condición mal guardada explotara en
      // runtime, a mitad de una corrida, en vez de acá con un motivo legible.
      const forma = CondicionSchema.safeParse(nodo.config);
      if (!forma.success) {
        const mensaje = `la condición "${nodo.id}" está mal configurada: ${forma.error.issues[0]?.message ?? "forma inválida"}`;
        await deps.onPaso({ nodoId: nodo.id, orden, salida: null, error: mensaje });
        return { tipo: "fallado", nodoId: nodo.id, error: mensaje };
      }
      const cumple = evaluarCondicion(forma.data, contexto);
      await deps.onPaso({ nodoId: nodo.id, orden, salida: { cumple }, error: null });
      actual = siguienteNodo(input.grafo, nodo.id, cumple ? "verdadero" : "falso");
      continue;
    }

    try {
      const r = await deps.registro.ejecutar(nodo, {
        leadId: input.leadId,
        leadSessionId: input.leadSessionId ?? null,
        runId: input.runId,
        orden,
        contexto,
      });
      // La acción pidió posponerse (fuera de horario). NO se ejecutó: el
      // segmento corta acá y el siguiente reanuda en ESTE mismo nodo.
      if (r.diferirHasta) {
        await deps.onPaso({
          nodoId: nodo.id,
          orden,
          salida: { diferido_hasta: r.diferirHasta.toISOString() },
          error: null,
        });
        return { tipo: "espera", nodoId: nodo.id, hasta: r.diferirHasta, reanudarEn: nodo.id };
      }
      if (r.contexto) contexto = { ...contexto, ...r.contexto };
      await deps.onPaso({ nodoId: nodo.id, orden, salida: r.salida ?? null, error: null });
      actual = siguienteNodo(input.grafo, nodo.id, r.puerto);
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : String(error);
      await deps.onPaso({ nodoId: nodo.id, orden, salida: null, error: mensaje });
      return { tipo: "fallado", nodoId: nodo.id, error: mensaje };
    }
  }

  // Un puerto sin arista en un grafo validado sólo puede ser un `fin`; llegar
  // acá significa que el grafo se guardó sin pasar por el validador.
  return { tipo: "fin" };
}
```

- [ ] **Step 4: Correr los tests**

Run: `npx vitest run tests/unit/workflows/ejecutor.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Probar que el test del tope tiene dientes**

Comentar la guarda `if (orden >= input.maxPasos)` y volver a correr. Debe fallar el test "el tope de pasos se chequea ANTES". Restaurar y confirmar verde. **Reportar la salida de ambas corridas.** Un test que pasa con y sin la lógica no prueba nada.

- [ ] **Step 6: Commit**

```bash
git add src/server/services/workflows/ejecutor.service.ts tests/unit/workflows/ejecutor.test.ts
git commit -m "feat(workflows): ejecutor de un segmento"
```

---

## Task 6: Simulador con reloj virtual

**Files:**

- Create: `src/server/services/workflows/simulador.service.ts`
- Create: `scripts/simular-workflow.mjs`
- Test: `tests/unit/workflows/simulador.test.ts`

**Interfaces:**

- Consumes: `ejecutarSegmento`, `EjecutorDeps` (Task 5); `crearRegistro` (Task 4).
- Produces: `simular(grafo, opciones): ResultadoSimulacion`, `interface PasoSimulado { nodoId; orden; reloj: Date; accion: string | null; salida }`, `interface ResultadoSimulacion { pasos: PasoSimulado[]; desenlace: "fin" | "fallado" | "tope"; error?: string; salientes: number }`.

**Lo que hace valioso a W2.** Un flujo que espera 2 días y cicla 40 veces se simula entero en milisegundos. Un flujo que **pasa el validador** pero cicla para siempre se ve acá, antes de que exista un lead.

- [ ] **Step 1: Escribir el test que falla**

```ts
import { describe, expect, it } from "vitest";
import { simular } from "@/server/services/workflows/simulador.service";
import type { Grafo } from "@/types/workflows";

/** Ciclo legitimo segun el validador: tiene una espera adentro. Y aun asi no termina nunca. */
const cicloInfinito: Grafo = {
  nodos: [
    { id: "d", tipo: "disparador", config: {}, posicion: { x: 0, y: 0 } },
    { id: "env", tipo: "accion", config: { accion: "enviar_mensaje" }, posicion: { x: 0, y: 0 } },
    { id: "w", tipo: "espera", config: { minutos: 2880 }, posicion: { x: 0, y: 0 } },
  ],
  aristas: [
    { desde: "d", hasta: "env", puerto: "salida" },
    { desde: "env", hasta: "w", puerto: "salida" },
    { desde: "w", hasta: "env", puerto: "salida" },
  ],
};

describe("simular", () => {
  it("detecta el flujo que pasa el validador y no termina nunca", async () => {
    const r = await simular(cicloInfinito, {
      maxPasos: 50,
      desde: new Date("2026-01-01T00:00:00Z"),
    });
    expect(r.desenlace).toBe("tope");
    expect(r.pasos).toHaveLength(50);
    // Lo que el dueño necesita ver antes de prenderlo.
    expect(r.salientes).toBeGreaterThan(20);
  });

  it("el reloj virtual avanza con cada espera", async () => {
    const r = await simular(cicloInfinito, {
      maxPasos: 6,
      desde: new Date("2026-01-01T00:00:00Z"),
    });
    const relojes = r.pasos.map((p) => p.reloj.toISOString());
    expect(relojes[0]).toBe("2026-01-01T00:00:00.000Z");
    // Tras la primera espera de 2880 min (2 dias).
    expect(relojes.at(-1)).not.toBe(relojes[0]);
  });

  it("un flujo sano termina en fin", async () => {
    const sano: Grafo = {
      nodos: [
        { id: "d", tipo: "disparador", config: {}, posicion: { x: 0, y: 0 } },
        { id: "f", tipo: "fin", config: {}, posicion: { x: 0, y: 0 } },
      ],
      aristas: [{ desde: "d", hasta: "f", puerto: "salida" }],
    };
    const r = await simular(sano, { maxPasos: 10, desde: new Date() });
    expect(r.desenlace).toBe("fin");
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npx vitest run tests/unit/workflows/simulador.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar**

```ts
import { crearRegistro, type AccionHandler } from "./acciones/registro";
import { ejecutarSegmento, type PasoEjecutado } from "./ejecutor.service";
import { disparadorDe } from "@/lib/workflows/recorrer";
import type { Grafo } from "@/types/workflows";

export interface PasoSimulado {
  nodoId: string;
  orden: number;
  reloj: Date;
  accion: string | null;
  salida: Record<string, unknown> | null;
}

export interface ResultadoSimulacion {
  pasos: PasoSimulado[];
  desenlace: "fin" | "fallado" | "tope";
  error?: string;
  /** Cuántos mensajes le habría mandado al lead. El número que importa. */
  salientes: number;
}

export interface OpcionesSimulacion {
  maxPasos: number;
  desde: Date;
  contexto?: Record<string, unknown>;
}

/**
 * Corre el grafo entero sin tocar nada, adelantando un reloj virtual en cada
 * espera. Usa el MISMO `ejecutarSegmento` que producción — sólo cambia el
 * registro de acciones (anotan en vez de hacer) y el reloj. Una segunda
 * implementación se desincronizaría, que es cómo mueren los simuladores.
 *
 * Siempre termina: corre hasta `fin`, `fallado` o `maxPasos`.
 */
export function simular(grafo: Grafo, opciones: OpcionesSimulacion): ResultadoSimulacion {
  const pasos: PasoSimulado[] = [];
  let reloj = new Date(opciones.desde);
  let salientes = 0;

  const anotar: AccionHandler = async (nodo) => {
    const accion = String(nodo.config["accion"] ?? "");
    if (accion === "enviar_mensaje") salientes += 1;
    return { puerto: "salida", salida: { simulado: accion } };
  };
  const registro = crearRegistro(
    new Proxy({} as Record<string, AccionHandler>, {
      get: () => anotar,
      has: () => true,
    }),
  );

  let nodoActual = disparadorDe(grafo)?.id;
  let pasosPrevios = 0;
  let desenlace: ResultadoSimulacion["desenlace"] = "fin";
  let error: string | undefined;

  const onPaso = async (p: PasoEjecutado) => {
    const nodo = grafo.nodos.find((n) => n.id === p.nodoId);
    pasos.push({
      nodoId: p.nodoId,
      orden: p.orden,
      reloj: new Date(reloj),
      accion: (nodo?.config["accion"] as string | undefined) ?? null,
      salida: p.salida,
    });
    pasosPrevios = p.orden;
  };

  // Cada vuelta del while es un segmento: el arranque, o reanudar tras una
  // espera. El reloj no duerme, salta.
  while (nodoActual !== undefined) {
    const resultado = await ejecutarSegmento(
      {
        grafo,
        desdeNodo: nodoActual,
        contexto: opciones.contexto ?? {},
        leadId: "simulacion",
        runId: "simulacion",
        pasosPrevios,
        maxPasos: opciones.maxPasos,
      },
      { registro, ahora: () => reloj, onPaso },
    );

    if (resultado.tipo === "fin") {
      desenlace = "fin";
      break;
    }
    if (resultado.tipo === "fallado") {
      desenlace = resultado.error.includes("tope de") ? "tope" : "fallado";
      error = resultado.error;
      break;
    }
    reloj = resultado.hasta;
    // reanudarEn y no siguienteNodo: el ejecutor ya decidio si se vuelve al
    // nodo siguiente (espera) o al mismo (accion diferida fuera de horario).
    nodoActual = resultado.reanudarEn;
  }

  return { pasos, desenlace, error, salientes };
}
```

La firma es `export async function simular(...): Promise<ResultadoSimulacion>`. Importar también `siguienteNodo` de `@/lib/workflows/recorrer`, junto a `disparadorDe`.

- [ ] **Step 4: Correr los tests**

Run: `npx vitest run tests/unit/workflows/simulador.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Escribir el script**

`scripts/simular-workflow.mjs` — lee un JSON de grafo por argumento y tabula el recorrido:

```js
#!/usr/bin/env node
// Simula un workflow sin tocar nada. Uso:
//   node scripts/simular-workflow.mjs ruta/al/grafo.json [maxPasos]
import { readFileSync } from "node:fs";

const [, , ruta, maxArg] = process.argv;
if (!ruta) {
  console.error("uso: node scripts/simular-workflow.mjs <grafo.json> [maxPasos]");
  process.exit(1);
}
const grafo = JSON.parse(readFileSync(ruta, "utf8"));
const maxPasos = Number(maxArg ?? 500);

const { simular } = await import("../src/server/services/workflows/simulador.service.ts");
const r = await simular(grafo, { maxPasos, desde: new Date("2026-01-01T00:00:00Z") });

for (const p of r.pasos) {
  const dia = Math.round((p.reloj - new Date("2026-01-01T00:00:00Z")) / 86400000);
  console.log(`dia ${String(dia).padStart(4)}  ${p.nodoId.padEnd(16)} ${p.accion ?? ""}`);
}
console.log(`\ndesenlace: ${r.desenlace}${r.error ? ` -- ${r.error}` : ""}`);
console.log(`salientes al lead: ${r.salientes}`);
```

Correr contra el grafo del ciclo infinito del test para ver la salida real. **Pegar esa salida en el reporte.**

- [ ] **Step 6: Commit**

```bash
git add src/server/services/workflows/simulador.service.ts scripts/simular-workflow.mjs tests/unit/workflows/simulador.test.ts
git commit -m "feat(workflows): simulador con reloj virtual"
```

---

## Task 7: Repositorio de corridas

**Files:**

- Create: `src/server/repositories/workflow-runs.repo.ts`
- Create: `src/server/repositories/workflow-runs.supabase.repo.ts`
- Create: `tests/repositories/workflow-runs.contract.ts`
- Test: `tests/unit/workflow-runs-repo.test.ts`

**Interfaces:**

- Produces: `WorkflowRunsRepository` con `arrancar(input): Promise<{ run: WorkflowRun | null; motivo?: "version_not_found" | "ya_hay_corrida_viva" }>`, `tomarSegmento(runId, desdePaso): Promise<WorkflowRun | null>`, `registrarPaso(runId, paso): Promise<void>`, `avanzar(runId, nodoActual, contexto, pasos): Promise<void>`, `esperar(runId, nodoActual, contexto, pasos): Promise<void>`, `terminar(runId, pasos): Promise<void>`, `fallar(runId, error, pasos): Promise<void>`, `findRun(id): Promise<WorkflowRun | null>`.

- [ ] **Step 1: Escribir el contract test que falla**

`tests/repositories/workflow-runs.contract.ts` — reusable in-memory ↔ Supabase, mismo patrón que el resto del repo:

```ts
import { describe, expect, it } from "vitest";
import type { WorkflowRunsRepository } from "@/server/repositories/workflow-runs.repo";

export function runWorkflowRunsContract(
  makeRepo: () => Promise<{ repo: WorkflowRunsRepository; versionId: string; leadId: string }>,
) {
  describe("WorkflowRunsRepository", () => {
    it("tomarSegmento es un compare-and-swap: el segundo intento no matchea", async () => {
      const { repo, versionId, leadId } = await makeRepo();
      const { run } = await repo.arrancar({ versionId, leadId, sessionId: null, contexto: {} });
      expect(run).not.toBeNull();

      const primero = await repo.tomarSegmento(run!.id, 0);
      expect(primero).not.toBeNull();

      await repo.avanzar(run!.id, "a", {}, 3);

      // El evento reentregado trae desdePaso 0 y ya no matchea: no reejecuta.
      const reentregado = await repo.tomarSegmento(run!.id, 0);
      expect(reentregado).toBeNull();
    });

    it("una corrida cancelada no se puede tomar", async () => {
      const { repo, versionId, leadId } = await makeRepo();
      const { run } = await repo.arrancar({ versionId, leadId, sessionId: null, contexto: {} });
      await repo.fallar(run!.id, "cancelada a mano", 0);
      expect(await repo.tomarSegmento(run!.id, 0)).toBeNull();
    });

    it("terminar deja ended_at y estado coherentes", async () => {
      const { repo, versionId, leadId } = await makeRepo();
      const { run } = await repo.arrancar({ versionId, leadId, sessionId: null, contexto: {} });
      await repo.terminar(run!.id, 5);
      const final = await repo.findRun(run!.id);
      expect(final?.estado).toBe("terminado");
      expect(final?.ended_at).not.toBeNull();
      expect(final?.pasos_ejecutados).toBe(5);
    });
  });
}
```

- [ ] **Step 2: Correr para verificar que falla**

Run: `npx vitest run tests/unit/workflow-runs-repo.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar la interface + InMemory**

En `workflow-runs.repo.ts`, la interface completa listada arriba en **Interfaces**, más `InMemoryWorkflowRunsRepository`. El CAS en memoria:

```ts
  async tomarSegmento(runId: UUID, desdePaso: number): Promise<WorkflowRun | null> {
    const run = this.runs.get(runId);
    // Mismo predicado que el UPDATE de Postgres: id + pasos + estado vivo.
    if (!run) return null;
    if (run.pasos_ejecutados !== desdePaso) return null;
    if (run.estado !== "corriendo" && run.estado !== "esperando") return null;
    run.estado = "corriendo";
    return { ...run };
  }
```

- [ ] **Step 4: Implementar la impl Supabase**

El CAS va tal cual el spec §6.1:

```ts
  async tomarSegmento(runId: UUID, desdePaso: number): Promise<WorkflowRun | null> {
    const { data, error } = await this.db
      .from("workflow_runs")
      .update({ estado: "corriendo" })
      .eq("id", runId)
      .eq("pasos_ejecutados", desdePaso)
      .in("estado", ["corriendo", "esperando"])
      .select(COLS_RUN)
      .maybeSingle();
    if (error) throw mapPostgrestError(error, { resource: "workflow_runs" });
    return data ? mapRun(data) : null;
  }
```

`arrancar` llama al RPC `arrancar_workflow_run` de la Task 1 y mapea `error_code` a `motivo`.

- [ ] **Step 5: Correr los tests + typecheck**

Run: `npx vitest run tests/unit/workflow-runs-repo.test.ts && npm run typecheck`
Expected: PASS y typecheck limpio. **Los contract tests contra Postgres NO se corren** (congelados).

- [ ] **Step 6: Commit**

```bash
git add src/server/repositories/workflow-runs.repo.ts src/server/repositories/workflow-runs.supabase.repo.ts tests/repositories/workflow-runs.contract.ts tests/unit/workflow-runs-repo.test.ts
git commit -m "feat(workflows): repositorio de corridas con compare-and-swap"
```

---

## Task 8: Las tres acciones internas

**Files:**

- Create: `src/server/services/workflows/acciones/internas.ts`
- Test: `tests/unit/workflows/acciones-internas.test.ts`

**Interfaces:**

- Consumes: `AccionHandler`, `EntornoAccion` (Task 4); `TagsRepository.assignToLead(leadId, tagId, source, assignedBy?)`; `LeadSessionRepository`; `HandoffService`.
- Produces: `crearAccionesInternas(deps): Record<string, AccionHandler>` con las claves `poner_etiqueta`, `cambiar_etapa`, `escalar_a_humano`.

- [ ] **Step 1: Escribir el test que falla**

```ts
import { describe, expect, it, vi } from "vitest";
import { crearAccionesInternas } from "@/server/services/workflows/acciones/internas";
import { ValidationError } from "@/lib/errors";

const entorno = { leadId: "l1", leadSessionId: "s1", runId: "r1", orden: 1, contexto: {} };
const nodo = (config: Record<string, unknown>) => ({
  id: "n",
  tipo: "accion" as const,
  config,
  posicion: { x: 0, y: 0 },
});

describe("acciones internas", () => {
  it("poner_etiqueta escribe con source workflow", async () => {
    const tags = { assignToLead: vi.fn(async () => ({})) };
    const acciones = crearAccionesInternas({ tags, sessions: {}, handoff: {} } as never);
    const r = await acciones["poner_etiqueta"]!(
      nodo({ accion: "poner_etiqueta", tagId: "t1" }),
      entorno,
    );
    // `workflow` es lo que hace que no reviva una etiqueta que una persona saco.
    expect(tags.assignToLead).toHaveBeenCalledWith("l1", "t1", "workflow", null);
    expect(r.puerto).toBe("salida");
  });

  it("poner_etiqueta sin tagId es ValidationError", async () => {
    const acciones = crearAccionesInternas({ tags: {}, sessions: {}, handoff: {} } as never);
    await expect(
      acciones["poner_etiqueta"]!(nodo({ accion: "poner_etiqueta" }), entorno),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
```

- [ ] **Step 2: Correr para verificar que falla**

Run: `npx vitest run tests/unit/workflows/acciones-internas.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar**

Las tres acciones. `poner_etiqueta` usa `source: "workflow"` (que ya escribió filas reales contra Postgres en la sesión de etiquetas y **no revive** lo que una persona sacó). `cambiar_etapa` actualiza `lead_session.current_stage`. `escalar_a_humano` delega en el `HandoffService` existente. Config faltante o de tipo equivocado → `ValidationError` (no retriable, mata la corrida de una).

- [ ] **Step 4: Correr los tests**

Run: `npx vitest run tests/unit/workflows/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/services/workflows/acciones/internas.ts tests/unit/workflows/acciones-internas.test.ts
git commit -m "feat(workflows): acciones de etiqueta, etapa y escalado"
```

---

## Task 9: `enviar_mensaje` y la capa 3

**Files:**

- Create: `src/server/services/workflows/acciones/enviar-mensaje.ts`
- Modify: `src/server/repositories/messages.repo.ts` (+ impl Supabase)
- Test: `tests/unit/workflows/enviar-mensaje.test.ts`

**Interfaces:**

- Consumes: `MetaApiService.sendOutbound(input: SendOutboundInput): Promise<Mensaje>` — acepta `idempotencyKey` y devuelve el mensaje existente sin llamar a Meta si ya hay uno con esa key. `AgentConfigProvider` para leer `max_salientes_automaticos_24h`.
- Produces: `MessagesRepository.contarSalientesAutomaticos(leadId: UUID, desde: Date): Promise<number>`; `crearAccionEnviarMensaje(deps): AccionHandler`.

**La acción de riesgo.** Es la que puede quemar un número de WhatsApp. Va sola en su tarea para que tenga su propia revisión.

- [ ] **Step 1: Escribir el test que falla**

```ts
import { describe, expect, it, vi } from "vitest";
import { crearAccionEnviarMensaje } from "@/server/services/workflows/acciones/enviar-mensaje";
import { BudgetExceededError } from "@/lib/errors";

const entorno = { leadId: "l1", leadSessionId: "s1", runId: "r1", orden: 7, contexto: {} };
const nodo = {
  id: "env",
  tipo: "accion" as const,
  config: { accion: "enviar_mensaje", texto: "hola" },
  posicion: { x: 0, y: 0 },
};

function deps(salientesPrevios: number) {
  return {
    messages: { contarSalientesAutomaticos: vi.fn(async () => salientesPrevios) },
    metaApi: { sendOutbound: vi.fn(async () => ({ id: "m1" })) },
    conversations: {
      findActivaByLead: vi.fn(async () => ({
        id: "c1",
        canal: "whatsapp",
        ultimo_entrante_at: new Date(),
      })),
    },
    leads: { findById: vi.fn(async () => ({ id: "l1", telefono: "+5215550001111" })) },
    configProvider: { activa: vi.fn(async () => ({ max_salientes_automaticos_24h: 3 })) },
  } as never;
}

describe("enviar_mensaje", () => {
  it("manda cuando esta bajo el tope, con idempotency key derivada del paso", async () => {
    const d = deps(1);
    const r = await crearAccionEnviarMensaje(d)(nodo, entorno);
    expect(r.puerto).toBe("salida");
    // La key es lo que evita el duplicado si Inngest reentrega el step.
    expect(
      (d as never as { metaApi: { sendOutbound: { mock: { calls: unknown[][] } } } }).metaApi
        .sendOutbound.mock.calls[0]![0],
    ).toMatchObject({ idempotencyKey: "wf:r1:7", sender: "sistema" });
  });

  it("al topar NO manda, y falla en voz alta", async () => {
    const d = deps(3);
    await expect(crearAccionEnviarMensaje(d)(nodo, entorno)).rejects.toBeInstanceOf(
      BudgetExceededError,
    );
    expect(
      (d as never as { metaApi: { sendOutbound: { mock: { calls: unknown[][] } } } }).metaApi
        .sendOutbound.mock.calls,
    ).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Correr para verificar que falla**

Run: `npx vitest run tests/unit/workflows/enviar-mensaje.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Agregar el contador al repo de mensajes**

En `messages.repo.ts` (interface + InMemory) y `messages.supabase.repo.ts`:

```ts
  /**
   * Salientes automáticos a este lead desde `desde`. Cuenta `ia` y `sistema`;
   * NO cuenta `humano`, porque un vendedor tipeando a mano no gasta el
   * presupuesto automático. Ventana móvil, no día calendario: 3 mensajes a las
   * 23:00 y 3 a las 00:05 serían 6 en 65 minutos con un corte por día.
   */
  contarSalientesAutomaticos(leadId: UUID, desde: Date): Promise<number>;
```

Impl Supabase: `select count` sobre `mensajes` con join a `conversaciones` por `lead_id`, `direction = 'out'`, `sender in ('ia','sistema')`, `created_at >= desde`.

- [ ] **Step 3b: Agregar `proximaApertura` a `src/lib/agente/horario.ts`**

Decisión del dueño: un workflow **respeta el horario de atención y difiere hasta la hora hábil siguiente**. El mensaje sale igual, a una hora razonable. Ya existe `estaAbierto(horario, timezone, ahora)`; falta "cuándo vuelve a abrir".

Test primero, en `tests/unit/agente/horario.test.ts`:

```ts
import { proximaApertura } from "@/lib/agente/horario";

const lunesAViernes = {
  lunes: [{ desde: "09:00", hasta: "18:00" }],
  martes: [{ desde: "09:00", hasta: "18:00" }],
  miercoles: [{ desde: "09:00", hasta: "18:00" }],
  jueves: [{ desde: "09:00", hasta: "18:00" }],
  viernes: [{ desde: "09:00", hasta: "18:00" }],
  sabado: [],
  domingo: [],
};

it("un sabado a la madrugada difiere al lunes 09:00", () => {
  // Sabado 2026-08-22 03:00 en Guayaquil (UTC-5) = 08:00Z.
  const r = proximaApertura(lunesAViernes, "America/Guayaquil", new Date("2026-08-22T08:00:00Z"));
  // Lunes 2026-08-24 09:00 local = 14:00Z.
  expect(r?.toISOString()).toBe("2026-08-24T14:00:00.000Z");
});

it("dentro del horario devuelve el mismo instante", () => {
  const dentro = new Date("2026-08-24T15:00:00Z"); // lunes 10:00 local
  expect(proximaApertura(lunesAViernes, "America/Guayaquil", dentro)?.toISOString()).toBe(
    dentro.toISOString(),
  );
});

it("sin ningun rango devuelve null", () => {
  const vacio = {
    lunes: [],
    martes: [],
    miercoles: [],
    jueves: [],
    viernes: [],
    sabado: [],
    domingo: [],
  };
  expect(proximaApertura(vacio, "America/Guayaquil", new Date())).toBeNull();
});
```

Implementación: **sondear hacia adelante en pasos de 15 minutos, hasta 8 días, devolviendo el primer instante en que `estaAbierto` da `true`.**

```ts
const PASO_MS = 15 * 60_000;
const HORIZONTE_MS = 8 * 24 * 60 * 60_000;

/**
 * El próximo instante en que el negocio está abierto, o `ahora` si ya lo está.
 * `null` si el horario no tiene un solo rango válido — ahí no hay hora hábil a
 * la que diferir y quien llama decide qué hacer.
 *
 * Sondea con `estaAbierto` en vez de calcular el borde del rango a mano. Es
 * más trabajo de CPU (a lo sumo 768 evaluaciones, y sólo cuando hay un mensaje
 * que diferir) a cambio de que las dos funciones no puedan discrepar nunca:
 * un cálculo propio de bordes tendría que reimplementar el manejo de zona
 * horaria y de días sin rangos, y ahí es donde aparecen los desacuerdos.
 */
export function proximaApertura(horario: Horario, timezone: string, ahora: Date): Date | null {
  if (!tieneAlgunRango(horario)) return null;
  for (let t = 0; t <= HORIZONTE_MS; t += PASO_MS) {
    const candidato = new Date(ahora.getTime() + t);
    if (estaAbierto(horario, timezone, candidato)) return candidato;
  }
  return null;
}
```

Nota: `estaAbierto` devuelve `true` ante timezone inválida (fail-open deliberado, ya documentado ahí). `proximaApertura` hereda eso y devuelve `ahora` — coherente: si no sabemos la zona, no diferimos.

- [ ] **Step 4: Implementar la acción**

Orden obligatorio: **primero el tope, después la ventana, después mandar.** Chequear después de mandar es mandar el mensaje 4 y recién ahí enterarse.

```ts
const limite = (await deps.configProvider.activa()).max_salientes_automaticos_24h;
const usados = await deps.messages.contarSalientesAutomaticos(
  entorno.leadId,
  new Date(Date.now() - 24 * 60 * 60 * 1000),
);
if (usados >= limite) {
  throw new BudgetExceededError(
    `tope de ${limite} salientes automáticos en 24 h alcanzado para este lead`,
    "salientes_24h",
  );
}
```

**Horario, después del tope y antes de mandar.** Si está cerrado, la acción **no manda y se pospone** — devuelve `{ puerto: "salida", diferirHasta }` y el ejecutor corta el segmento reanudando en este mismo nodo (ver Task 5). El orden importa: chequear el tope primero evita que un mensaje diferido consuma presupuesto que no va a usar.

```ts
const cfg = await deps.configProvider.activa();
if (!estaAbierto(cfg.horario, cfg.horario_timezone, ahora)) {
  const cuando = proximaApertura(cfg.horario, cfg.horario_timezone, ahora);
  // Sin un solo rango válido no hay hora hábil a la que diferir. Mandar igual
  // sería ignorar la decisión; diferir para siempre sería un flujo mudo.
  if (!cuando) {
    throw new ValidationError(
      "el horario de atención no tiene ningún rango: no hay hora hábil a la que diferir",
      "horario_vacio",
    );
  }
  return { puerto: "salida", diferirHasta: cuando, salida: { diferido: true } };
}
```

Ventana de 24 h de Meta: si `ultimo_entrante_at` es más viejo que 24 h, Meta rechaza texto libre. **Fallar con `ValidationError` en voz alta**, no degradar a plantilla: elegir qué plantilla se le manda a un cliente no es decisión del motor.

`idempotencyKey: \`wf:${entorno.runId}:${entorno.orden}\``—`sendOutbound` ya deduplica contra esa key, así que un reintento del step no manda dos WhatsApps.

- [ ] **Step 5: Correr los tests**

Run: `npx vitest run tests/unit/workflows/ && npm run typecheck`
Expected: PASS y typecheck limpio.

- [ ] **Step 6: Probar que el tope tiene dientes**

Comentar el `throw new BudgetExceededError` y correr: debe fallar "al topar NO manda". Restaurar, confirmar verde. **Reportar ambas salidas.**

- [ ] **Step 7: Verificar la pregunta abierta del spec §15**

Revisar `reactivation-predictor.cron.ts`: ¿graba en `mensajes` con `sender: 'sistema'`? Si **no** graba, la capa 3 no la cuenta y el tope miente. Reportar qué se encontró. Si no graba, **no arreglarlo en esta tarea** — anotarlo y seguir.

- [ ] **Step 8: Commit**

```bash
git add src/server/services/workflows/acciones/enviar-mensaje.ts src/server/repositories/messages.repo.ts src/server/repositories/messages.supabase.repo.ts tests/unit/workflows/enviar-mensaje.test.ts
git commit -m "feat(workflows): enviar mensaje con tope por lead y ventana de 24h"
```

---

## Task 10: Las dos funciones de Inngest y el wiring

**Files:**

- Modify: `src/inngest/events.ts`
- Create: `src/inngest/functions/workflow-disparar.ts`
- Create: `src/inngest/functions/workflow-segmento.ts`
- Modify: `src/inngest/functions/index.ts`
- Modify: `src/server/bootstrap/*` (donde se arman las deps de Inngest)
- Test: `tests/unit/workflows/inngest-workflow.test.ts`

**Interfaces:**

- Consumes: todo lo anterior.
- Produces: eventos `workflow/disparo.recibido` (`{ disparador, leadId, leadSessionId?, contexto }`) y `workflow/segmento.pendiente` (`{ runId, desdePaso }`).

- [ ] **Step 1: Declarar los eventos**

```ts
export const workflowDisparoRecibido = eventType("workflow/disparo.recibido", {
  schema: staticSchema<{
    disparador: "etiqueta_asignada" | "mensaje_recibido" | "etapa_cambiada";
    leadId: UUID;
    leadSessionId?: UUID;
    contexto: Record<string, unknown>;
  }>(),
});

// `desdePaso` es el compare-and-swap: si no coincide con pasos_ejecutados, este
// segmento ya corrio y la reentrega no lo reejecuta.
export const workflowSegmentoPendiente = eventType("workflow/segmento.pendiente", {
  schema: staticSchema<{ runId: UUID; desdePaso: number }>(),
});
```

- [ ] **Step 2: Escribir el test del handler de disparo**

```ts
import { describe, expect, it, vi } from "vitest";
import { dispararHandler } from "@/inngest/functions/workflow-disparar";

describe("dispararHandler", () => {
  it("no arranca nada cuando la politica dice ignorar y ya hay una corrida viva", async () => {
    const runs = {
      arrancar: vi.fn(async () => ({ run: null, motivo: "ya_hay_corrida_viva" as const })),
    };
    const workflows = {
      listarPublicadasPorDisparador: vi.fn(async () => [{ id: "v1", max_pasos: 500 }]),
    };
    const emitir = vi.fn(async () => {});
    const r = await dispararHandler(
      { disparador: "etiqueta_asignada", leadId: "l1", contexto: {} },
      { runs, workflows, emitir } as never,
    );
    expect(emitir).not.toHaveBeenCalled();
    expect(r.arrancadas).toBe(0);
  });
});
```

- [ ] **Step 3: Correr para verificar que falla**

Run: `npx vitest run tests/unit/workflows/inngest-workflow.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 4: Implementar las dos funciones**

`workflow-disparar`: busca versiones publicadas de workflows `activo` cuyo disparador matchee, llama `runs.arrancar` (que aplica la política dentro del RPC), y por cada corrida creada emite `workflow/segmento.pendiente` con `desdePaso: 0`.

`workflow-segmento`: `runs.tomarSegmento(runId, desdePaso)` → si `null`, sale sin ruido (ya corrió o lo cancelaron). Lee la versión **pinneada** (`workflow_version_id` del run), no la publicada. Corre `ejecutarSegmento` con `onPaso` = `runs.registrarPaso`. Según el resultado: `espera` → `runs.esperar` + emitir el evento con `{ delay: hasta }`; `fin` → `runs.terminar`; `fallado` → `runs.fallar`.

Envolver como el resto del proyecto: `isNonRetriable(error)` → `NonRetriableError`.

- [ ] **Step 5: Registrar en `index.ts` y wirear las deps**

Agregar ambas al array de funciones servidas y armar las deps reales en el bootstrap, incluido el registro con las 4 acciones (`crearRegistro({ ...crearAccionesInternas(deps), enviar_mensaje: crearAccionEnviarMensaje(deps) })`).

- [ ] **Step 6: Correr la suite completa + typecheck + lint**

Run: `npx vitest run && npm run typecheck && npm run lint`
Expected: todo PASS. Reportar el número real de tests.

- [ ] **Step 7: Commit**

```bash
git add src/inngest/events.ts src/inngest/functions/workflow-disparar.ts src/inngest/functions/workflow-segmento.ts src/inngest/functions/index.ts src/server/bootstrap tests/unit/workflows/inngest-workflow.test.ts
git commit -m "feat(workflows): disparo y ejecucion por segmentos sobre Inngest"
```

---

## Task 11: Un E2E real, deliberado, una sola vez

**Files:** ninguno. Es verificación, no código.

**Requiere al dueño presente.** Manda un WhatsApp de verdad.

- [ ] **Step 1: Confirmar con el dueño antes de disparar nada**

Preguntar explícitamente. No asumir que "seguí" de una tarea anterior autoriza mandar un mensaje real.

- [ ] **Step 2: Crear el flujo mínimo**

Dos nodos: `disparador (etiqueta_asignada)` → `accion (enviar_mensaje)` → `fin`. Guardarlo por el servicio admin (pasa por el validador) y publicarlo.

- [ ] **Step 3: Simular primero**

Run: `node scripts/simular-workflow.mjs <grafo.json>`
Expected: `desenlace: fin`, `salientes al lead: 1`. **Si el simulador dice otra cosa, parar y no disparar.**

- [ ] **Step 4: Disparar**

Poner la etiqueta al lead de prueba y verificar en Supabase: una fila en `workflow_runs` con `estado='terminado'`, tres en `workflow_run_pasos`, y el mensaje en `mensajes` con `sender='sistema'` e `idempotency_key` `wf:<runId>:2`.

- [ ] **Step 5: Reportar**

Qué llegó al WhatsApp, qué quedó en las tres tablas, y cuánto tardó de punta a punta.

---

## Self-Review

**Cobertura del spec:** §3 arquitectura → Tasks 5 y 10. §4 piezas → todas. §6.1 CAS → Task 7. §6.2 concurrencia → Task 1 (RPC) + Task 10. §7 capa 2 → Task 5. §7 capa 3 → Task 9. §8 errores → Tasks 5, 8, 9, 10. §9 condiciones → Task 3. §10 catálogo → Tasks 8 y 9. §11 simulación → Task 6. §12 schema → Task 1. §13 pruebas → cada tarea + Task 11. §15 pregunta abierta de reactivación → Task 9 step 7.

**Sin cubrir a propósito:** la pregunta abierta del horario (§15) — no hay tarea porque la decisión no está tomada. **Preguntarle al dueño antes de la Task 9**; si dice que sí, es un paso más en esa tarea.

**Consistencia de tipos:** `ResultadoSegmento` (Task 4) lo devuelve `ejecutarSegmento` (Task 5) y lo consume `workflow-segmento` (Task 10). `AccionHandler` (Task 4) lo implementan las Tasks 8 y 9. `PasoEjecutado.onPaso` (Task 5) lo satisface `runs.registrarPaso` (Task 7) — verificar que las firmas coincidan al llegar a la Task 10.

**Deuda conocida que se arrastra:** los contract tests del repo nuevo corren sólo in-memory. Contra Postgres siguen congelados hasta que exista la base aislada. Decirlo al cerrar, no al final.
