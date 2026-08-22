# Workflows W1 — grafo, validador y versionado — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un workflow se pueda definir como grafo, validar antes de guardarse y versionar de forma inmutable — sin ejecutar nada todavía.

**Architecture:** Cuatro tablas nuevas (`workflows`, `workflow_versiones` append-only, `workflow_runs`, `workflow_run_pasos`). El grafo vive como `jsonb` y se valida con una función pura de siete reglas antes de publicar. Las aristas referencian **IDs de nodo**, nunca índices posicionales — ahí muere el `goto step: 3` de Kommo. El versionado copia el patrón de `agente_config`: guardar inserta, nunca actualiza, y un índice único parcial garantiza una sola versión publicada.

**Tech Stack:** Postgres/Supabase, TypeScript strict, Zod, Vitest.

## Global Constraints

- **Aristas por ID de nodo, jamás por índice.** Es la razón de ser del diseño.
- **Todo ciclo debe contener al menos un nodo `espera`** (regla `ciclo_sin_espera`). Es la capa 1 de las tres que hacen seguros los ciclos libres; sin ella las otras dos no alcanzan.
- **`workflow_versiones` es append-only.** Guardar inserta una fila nueva. Nunca `UPDATE` sobre el grafo de una versión existente.
- **`workflow_runs.workflow_version_id` es inmutable** y `on delete restrict`: las corridas en vuelo terminan con la versión con la que arrancaron.
- **W1 no ejecuta y no tiene UI.** Cualquier tarea que agregue una pantalla o un handler de Inngest está fuera de alcance.
- El validador devuelve **todos** los problemas, no el primero.
- Migración con timestamp `YYYYMMDDHHMMSS` mayor a `20260817194227`.
- RLS: lee `authenticated`, escribe admin. Más `revoke all ... from public, anon` + grants explícitos, como `20260817161503_campanias_y_ventas.sql`.
- Español en UI/comentarios/commits. Identificadores genéricos en inglés, de dominio en español.
- `DomainError` y subclases (`src/lib/errors.ts`); prohibido `throw new Error()` en `src/server/**`.
- `console.log` prohibido en `src/**`.
- Spec de referencia: `docs/superpowers/specs/2026-08-19-workflows-w1-grafo-design.md`.

---

## File Structure

**Nuevo:**

- `supabase/migrations/20260819120000_workflows_grafo.sql` — las 4 tablas, el enum, índices, RLS, grants.
- `src/types/workflows.ts` — `Grafo`, `Nodo`, `Arista`, `NodoTipo`, `Puerto`, `ProblemaGrafo`, `ReglaValidacion`.
- `src/lib/validation/workflows.schema.ts` — Zod del grafo (forma), separado del validador (semántica).
- `src/lib/workflows/validar-grafo.ts` — el validador puro, 7 reglas.
- `src/server/repositories/workflows.repo.ts` — interface + InMemory de las 4 tablas.
- `src/server/repositories/workflows.supabase.repo.ts` — impl Supabase.
- `src/server/services/workflows/workflows-admin.service.ts` — publicar versión aplicando el validador.
- `src/server/bootstrap/workflows-bootstrap.ts` — composición.
- `tests/unit/workflows/validar-grafo.test.ts`, `tests/unit/workflows/fixtures-grafo.ts`
- `tests/repositories/workflows.contract.ts`, `tests/unit/workflows-repo.test.ts`
- `tests/unit/workflows-admin-service.test.ts`

**Modificado:**

- `src/types/entities.ts` — entidades `Workflow`, `WorkflowVersion`, `WorkflowRun`, `WorkflowRunPaso`.

**Por qué el validador y el schema Zod van separados:** Zod verifica que el JSON tenga la forma correcta (que `nodos` sea un array, que `tipo` sea uno de los cinco). El validador verifica que el grafo tenga sentido (que sea alcanzable, que los ciclos tengan espera). Un grafo puede pasar Zod y ser inválido. Mezclarlos haría imposible testear las siete reglas sin construir JSON crudo.

---

## Task 1: Tipos del grafo y schema Zod

**Files:**

- Create: `src/types/workflows.ts`
- Create: `src/lib/validation/workflows.schema.ts`
- Test: `tests/unit/workflows/schema-grafo.test.ts`

**Interfaces:**

- Produces: `Grafo`, `Nodo`, `Arista`, `NodoTipo`, `Puerto`, `ProblemaGrafo`, `ReglaValidacion` desde `@/types/workflows`; `GrafoSchema` desde `@/lib/validation/workflows.schema`.

- [ ] **Step 1: Escribir el test que falla**

`tests/unit/workflows/schema-grafo.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { GrafoSchema } from "@/lib/validation/workflows.schema";

const nodoMinimo = {
  id: "n1",
  tipo: "disparador",
  config: {},
  posicion: { x: 0, y: 0 },
};

describe("GrafoSchema", () => {
  it("acepta un grafo con la forma correcta", () => {
    const r = GrafoSchema.safeParse({
      nodos: [nodoMinimo],
      aristas: [{ desde: "n1", hasta: "n2", puerto: "salida" }],
    });
    expect(r.success).toBe(true);
  });

  it("rechaza un tipo de nodo que no existe", () => {
    const r = GrafoSchema.safeParse({
      nodos: [{ ...nodoMinimo, tipo: "inventado" }],
      aristas: [],
    });
    expect(r.success).toBe(false);
  });

  it("rechaza un puerto que no existe", () => {
    const r = GrafoSchema.safeParse({
      nodos: [nodoMinimo],
      aristas: [{ desde: "n1", hasta: "n2", puerto: "quiza" }],
    });
    expect(r.success).toBe(false);
  });

  it("rechaza un id de nodo vacio: las aristas lo referencian y un id vacio los vuelve ambiguos", () => {
    const r = GrafoSchema.safeParse({ nodos: [{ ...nodoMinimo, id: "" }], aristas: [] });
    expect(r.success).toBe(false);
  });

  it("acepta config con cualquier forma: la validacion por tipo de nodo es de W3", () => {
    const r = GrafoSchema.safeParse({
      nodos: [{ ...nodoMinimo, config: { loQueSea: 1, anidado: { x: true } } }],
      aristas: [],
    });
    expect(r.success).toBe(true);
  });
});
```

- [ ] **Step 2: Correr y verificar que falla**

```bash
npx vitest run tests/unit/workflows/schema-grafo.test.ts
```

Expected: FAIL — `Cannot find module '@/lib/validation/workflows.schema'`.

- [ ] **Step 3: Escribir `src/types/workflows.ts`**

```ts
/**
 * El grafo de un workflow. Vive en `workflow_versiones.grafo` como jsonb.
 *
 * Las aristas referencian **IDs de nodo**, nunca índices posicionales. Es la
 * diferencia central con el Salesbot de Kommo, cuyo `goto: { step: 3 }` apunta
 * a una posición: insertar un paso al medio corre todos los índices y cada
 * salto queda apuntando al lugar equivocado, en silencio.
 */
export interface Grafo {
  nodos: Nodo[];
  aristas: Arista[];
}

export interface Nodo {
  /** Estable y único dentro del grafo. Las aristas apuntan acá. */
  id: string;
  tipo: NodoTipo;
  /**
   * Configuración específica del tipo. W1 la trata como objeto opaco: qué
   * disparadores y qué acciones existen lo define W3, y validarla ahora sería
   * inventar un catálogo que todavía no se diseñó.
   */
  config: Record<string, unknown>;
  /** Sólo para el canvas de W5. El motor la ignora. */
  posicion: { x: number; y: number };
}

export interface Arista {
  desde: string;
  hasta: string;
  /** Cuál salida del nodo origen. Un `condicion` tiene dos; el resto, una. */
  puerto: Puerto;
}

export const NODO_TIPOS = ["disparador", "accion", "condicion", "espera", "fin"] as const;
export type NodoTipo = (typeof NODO_TIPOS)[number];

export const PUERTOS = ["salida", "verdadero", "falso"] as const;
export type Puerto = (typeof PUERTOS)[number];

export const REGLAS_VALIDACION = [
  "disparador_unico",
  "disparador_sin_entrantes",
  "nodo_inalcanzable",
  "salida_sin_conectar",
  "arista_a_nodo_inexistente",
  "condicion_puertos",
  "ciclo_sin_espera",
] as const;
export type ReglaValidacion = (typeof REGLAS_VALIDACION)[number];

export interface ProblemaGrafo {
  regla: ReglaValidacion;
  /** Nodos involucrados, para que el canvas de W5 los pueda pintar en rojo. */
  nodos: string[];
  mensaje: string;
}
```

- [ ] **Step 4: Escribir `src/lib/validation/workflows.schema.ts`**

```ts
import { z } from "zod";
import { NODO_TIPOS, PUERTOS } from "@/types/workflows";

/**
 * Forma del grafo, no su sentido.
 *
 * Zod verifica que el JSON tenga la estructura correcta; que el grafo sea
 * *coherente* (alcanzable, sin ciclos sin espera) lo decide
 * `validarGrafo()` en `src/lib/workflows/validar-grafo.ts`. Un grafo puede
 * pasar este schema y ser inválido: son dos preguntas distintas y separarlas
 * permite testear las siete reglas sin armar JSON crudo.
 */

/** Un id vacío rompe la referencia de las aristas, que es todo el diseño. */
const NodoIdSchema = z.string().min(1).max(64);

export const NodoSchema = z.object({
  id: NodoIdSchema,
  tipo: z.enum(NODO_TIPOS),
  config: z.record(z.string(), z.unknown()),
  posicion: z.object({ x: z.number(), y: z.number() }),
});

export const AristaSchema = z.object({
  desde: NodoIdSchema,
  hasta: NodoIdSchema,
  puerto: z.enum(PUERTOS),
});

export const GrafoSchema = z.object({
  nodos: z.array(NodoSchema),
  aristas: z.array(AristaSchema),
});
```

- [ ] **Step 5: Correr y verificar que pasa**

```bash
npx vitest run tests/unit/workflows/schema-grafo.test.ts
```

Expected: 5/5 PASS.

- [ ] **Step 6: `npm run typecheck` y `npm run lint`**

```bash
npm run typecheck && npm run lint
```

Expected: 0 errores en ambos.

- [ ] **Step 7: Commit**

```bash
git add src/types/workflows.ts src/lib/validation/workflows.schema.ts tests/unit/workflows/schema-grafo.test.ts
git commit -m "feat(workflows): tipos del grafo y schema de forma"
```

---

## Task 2: El validador — 7 reglas

**Files:**

- Create: `src/lib/workflows/validar-grafo.ts`
- Create: `tests/unit/workflows/fixtures-grafo.ts`
- Test: `tests/unit/workflows/validar-grafo.test.ts`

**Interfaces:**

- Consumes: `Grafo`, `Nodo`, `Arista`, `ProblemaGrafo`, `NodoTipo`, `Puerto` de `@/types/workflows` (Task 1).
- Produces: `validarGrafo(grafo: Grafo): ProblemaGrafo[]` y `puertosDe(tipo: NodoTipo): Puerto[]` desde `@/lib/workflows/validar-grafo`.

- [ ] **Step 1: Escribir los fixtures**

`tests/unit/workflows/fixtures-grafo.ts` — helpers para que cada test arme un grafo en dos líneas en vez de veinte:

```ts
import type { Arista, Grafo, Nodo, NodoTipo, Puerto } from "@/types/workflows";

export function nodo(id: string, tipo: NodoTipo): Nodo {
  return { id, tipo, config: {}, posicion: { x: 0, y: 0 } };
}

export function arista(desde: string, hasta: string, puerto: Puerto = "salida"): Arista {
  return { desde, hasta, puerto };
}

export function grafo(nodos: Nodo[], aristas: Arista[]): Grafo {
  return { nodos, aristas };
}

/**
 * Grafo mínimo válido: disparador → acción → fin.
 * Cada test parte de acá y rompe UNA cosa, para que el problema reportado
 * sea inequívocamente el de esa regla.
 */
export function grafoValido(): Grafo {
  return grafo(
    [nodo("d", "disparador"), nodo("a", "accion"), nodo("f", "fin")],
    [arista("d", "a"), arista("a", "f")],
  );
}
```

- [ ] **Step 2: Escribir los tests que fallan**

`tests/unit/workflows/validar-grafo.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { validarGrafo } from "@/lib/workflows/validar-grafo";
import { arista, grafo, grafoValido, nodo } from "./fixtures-grafo";
import type { ReglaValidacion } from "@/types/workflows";

const reglas = (g: Parameters<typeof validarGrafo>[0]): ReglaValidacion[] =>
  validarGrafo(g).map((p) => p.regla);

describe("validarGrafo — el caso sano", () => {
  it("un grafo valido no reporta nada", () => {
    expect(validarGrafo(grafoValido())).toEqual([]);
  });
});

describe("validarGrafo — una prueba por regla", () => {
  it("disparador_unico: cero disparadores", () => {
    const g = grafo([nodo("a", "accion"), nodo("f", "fin")], [arista("a", "f")]);
    expect(reglas(g)).toContain("disparador_unico");
  });

  it("disparador_unico: dos disparadores", () => {
    const g = grafo(
      [nodo("d1", "disparador"), nodo("d2", "disparador"), nodo("f", "fin")],
      [arista("d1", "f"), arista("d2", "f")],
    );
    expect(reglas(g)).toContain("disparador_unico");
  });

  it("disparador_sin_entrantes: una arista apunta al disparador", () => {
    const g = grafo(
      [nodo("d", "disparador"), nodo("a", "accion"), nodo("f", "fin")],
      [arista("d", "a"), arista("a", "d"), arista("a", "f")],
    );
    expect(reglas(g)).toContain("disparador_sin_entrantes");
  });

  it("nodo_inalcanzable: un nodo huerfano", () => {
    const g = grafo(
      [nodo("d", "disparador"), nodo("f", "fin"), nodo("huerfano", "accion"), nodo("f2", "fin")],
      [arista("d", "f"), arista("huerfano", "f2")],
    );
    const problemas = validarGrafo(g);
    expect(problemas.map((p) => p.regla)).toContain("nodo_inalcanzable");
    const inalcanzable = problemas.find((p) => p.regla === "nodo_inalcanzable");
    expect(inalcanzable?.nodos).toContain("huerfano");
  });

  it("salida_sin_conectar: una accion sin salida", () => {
    const g = grafo([nodo("d", "disparador"), nodo("a", "accion")], [arista("d", "a")]);
    expect(reglas(g)).toContain("salida_sin_conectar");
  });

  it("arista_a_nodo_inexistente", () => {
    const g = grafo(
      [nodo("d", "disparador"), nodo("f", "fin")],
      [arista("d", "f"), arista("f", "fantasma")],
    );
    expect(reglas(g)).toContain("arista_a_nodo_inexistente");
  });

  it("condicion_puertos: falta la rama falso", () => {
    const g = grafo(
      [nodo("d", "disparador"), nodo("c", "condicion"), nodo("f", "fin")],
      [arista("d", "c"), arista("c", "f", "verdadero")],
    );
    expect(reglas(g)).toContain("condicion_puertos");
  });

  it("condicion_puertos: dos aristas por el mismo puerto es indeterminista", () => {
    const g = grafo(
      [
        nodo("d", "disparador"),
        nodo("c", "condicion"),
        nodo("f1", "fin"),
        nodo("f2", "fin"),
        nodo("f3", "fin"),
      ],
      [
        arista("d", "c"),
        arista("c", "f1", "verdadero"),
        arista("c", "f2", "verdadero"),
        arista("c", "f3", "falso"),
      ],
    );
    expect(reglas(g)).toContain("condicion_puertos");
  });

  it("ciclo_sin_espera: dos acciones que se apuntan giran en milisegundos", () => {
    const g = grafo(
      [nodo("d", "disparador"), nodo("a1", "accion"), nodo("a2", "accion")],
      [arista("d", "a1"), arista("a1", "a2"), arista("a2", "a1")],
    );
    const problemas = validarGrafo(g);
    expect(problemas.map((p) => p.regla)).toContain("ciclo_sin_espera");
    const ciclo = problemas.find((p) => p.regla === "ciclo_sin_espera");
    expect(ciclo?.nodos).toEqual(expect.arrayContaining(["a1", "a2"]));
  });
});

describe("validarGrafo — validos que parecen invalidos", () => {
  it("un ciclo CON espera es valido: es el caso real de insistir cada 2 dias", () => {
    const g = grafo(
      [
        nodo("d", "disparador"),
        nodo("e", "espera"),
        nodo("a", "accion"),
        nodo("c", "condicion"),
        nodo("f", "fin"),
      ],
      [
        arista("d", "e"),
        arista("e", "a"),
        arista("a", "c"),
        arista("c", "f", "verdadero"),
        arista("c", "e", "falso"),
      ],
    );
    expect(validarGrafo(g)).toEqual([]);
  });

  it("dos ramas que se vuelven a unir no son un ciclo", () => {
    const g = grafo(
      [nodo("d", "disparador"), nodo("c", "condicion"), nodo("a", "accion"), nodo("f", "fin")],
      [
        arista("d", "c"),
        arista("c", "a", "verdadero"),
        arista("c", "f", "falso"),
        arista("a", "f"),
      ],
    );
    expect(validarGrafo(g)).toEqual([]);
  });

  it("varias aristas entrantes al mismo nodo son validas", () => {
    const g = grafo(
      [nodo("d", "disparador"), nodo("c", "condicion"), nodo("a1", "accion"), nodo("f", "fin")],
      [
        arista("d", "c"),
        arista("c", "a1", "verdadero"),
        arista("c", "a1", "falso"),
        arista("a1", "f"),
      ],
    );
    expect(validarGrafo(g)).toEqual([]);
  });
});

describe("validarGrafo — devuelve TODOS los problemas", () => {
  it("dos problemas distintos vienen los dos, no solo el primero", () => {
    // Sin disparador Y con una arista a un nodo que no existe.
    const g = grafo([nodo("a", "accion"), nodo("f", "fin")], [arista("a", "f"), arista("f", "x")]);
    const rs = reglas(g);
    expect(rs).toContain("disparador_unico");
    expect(rs).toContain("arista_a_nodo_inexistente");
  });
});
```

- [ ] **Step 3: Correr y verificar que fallan**

```bash
npx vitest run tests/unit/workflows/validar-grafo.test.ts
```

Expected: FAIL — `Cannot find module '@/lib/workflows/validar-grafo'`.

- [ ] **Step 4: Escribir el validador**

`src/lib/workflows/validar-grafo.ts`:

```ts
import type { Arista, Grafo, Nodo, NodoTipo, ProblemaGrafo, Puerto } from "@/types/workflows";

/**
 * Qué puertos de salida tiene cada tipo de nodo. El validador lo usa para la
 * regla `salida_sin_conectar` y el canvas de W5 para dibujar los conectores.
 *
 * `fin` no tiene ninguno: es el único nodo que puede cerrar un camino, y por
 * eso un flujo que se corta en cualquier otro lado es un error y no una
 * decisión de diseño.
 */
export function puertosDe(tipo: NodoTipo): Puerto[] {
  if (tipo === "condicion") return ["verdadero", "falso"];
  if (tipo === "fin") return [];
  return ["salida"];
}

/**
 * Valida la coherencia del grafo. Devuelve **todos** los problemas, no el
 * primero: quien está armando un flujo quiere ver de una vez todo lo que le
 * falta, no corregir de a uno y volver a guardar siete veces.
 *
 * Lista vacía = grafo válido.
 */
export function validarGrafo(grafo: Grafo): ProblemaGrafo[] {
  const problemas: ProblemaGrafo[] = [];
  const porId = new Map<string, Nodo>(grafo.nodos.map((n) => [n.id, n]));

  // --- regla: arista_a_nodo_inexistente ---------------------------------
  // Va primero porque el resto de las reglas recorre el grafo, y una arista
  // colgada haría que ese recorrido tropiece con un nodo que no existe.
  const aristasValidas: Arista[] = [];
  for (const a of grafo.aristas) {
    const faltan = [a.desde, a.hasta].filter((id) => !porId.has(id));
    if (faltan.length > 0) {
      problemas.push({
        regla: "arista_a_nodo_inexistente",
        nodos: faltan,
        mensaje: `La conexión apunta a un paso que no existe: ${faltan.join(", ")}.`,
      });
      continue;
    }
    aristasValidas.push(a);
  }

  // --- regla: disparador_unico ------------------------------------------
  const disparadores = grafo.nodos.filter((n) => n.tipo === "disparador");
  if (disparadores.length !== 1) {
    problemas.push({
      regla: "disparador_unico",
      nodos: disparadores.map((n) => n.id),
      mensaje:
        disparadores.length === 0
          ? "El flujo no tiene disparador: nada lo va a arrancar."
          : `El flujo tiene ${disparadores.length} disparadores y no se sabe por cuál empieza.`,
    });
  }
  const disparador = disparadores.length === 1 ? disparadores[0] : undefined;

  // --- regla: disparador_sin_entrantes ----------------------------------
  // Una arista hacia el disparador es reiniciar el flujo desde adentro: un
  // ciclo disfrazado, y sin la espera que exige `ciclo_sin_espera`.
  if (disparador) {
    const entrantes = aristasValidas.filter((a) => a.hasta === disparador.id);
    if (entrantes.length > 0) {
      problemas.push({
        regla: "disparador_sin_entrantes",
        nodos: [disparador.id, ...entrantes.map((a) => a.desde)],
        mensaje: "Nada puede volver al disparador: para repetir hay que usar una espera.",
      });
    }
  }

  // --- regla: salida_sin_conectar ---------------------------------------
  const salientesPorNodo = new Map<string, Arista[]>();
  for (const a of aristasValidas) {
    const previas = salientesPorNodo.get(a.desde);
    if (previas) previas.push(a);
    else salientesPorNodo.set(a.desde, [a]);
  }
  for (const n of grafo.nodos) {
    const salientes = salientesPorNodo.get(n.id) ?? [];
    for (const puerto of puertosDe(n.tipo)) {
      if (!salientes.some((a) => a.puerto === puerto)) {
        problemas.push({
          regla: "salida_sin_conectar",
          nodos: [n.id],
          mensaje: `El paso "${n.id}" deja la salida «${puerto}» sin conectar: el flujo se cortaría ahí sin decir nada.`,
        });
      }
    }
  }

  // --- regla: condicion_puertos -----------------------------------------
  // `salida_sin_conectar` ya cubre el puerto faltante; acá lo que importa es
  // el duplicado, que es indeterminismo: dos caminos por la misma respuesta.
  for (const n of grafo.nodos) {
    if (n.tipo !== "condicion") continue;
    const salientes = salientesPorNodo.get(n.id) ?? [];
    for (const puerto of ["verdadero", "falso"] as const) {
      const cuantas = salientes.filter((a) => a.puerto === puerto).length;
      if (cuantas > 1) {
        problemas.push({
          regla: "condicion_puertos",
          nodos: [n.id],
          mensaje: `La condición "${n.id}" tiene ${cuantas} caminos por «${puerto}» y no se sabe cuál tomar.`,
        });
      }
      if (cuantas === 0) {
        problemas.push({
          regla: "condicion_puertos",
          nodos: [n.id],
          mensaje: `La condición "${n.id}" no tiene camino por «${puerto}».`,
        });
      }
    }
  }

  // --- regla: nodo_inalcanzable -----------------------------------------
  if (disparador) {
    const alcanzables = new Set<string>();
    const pila = [disparador.id];
    while (pila.length > 0) {
      const actual = pila.pop();
      if (actual === undefined || alcanzables.has(actual)) continue;
      alcanzables.add(actual);
      for (const a of salientesPorNodo.get(actual) ?? []) pila.push(a.hasta);
    }
    const huerfanos = grafo.nodos.filter((n) => !alcanzables.has(n.id)).map((n) => n.id);
    if (huerfanos.length > 0) {
      problemas.push({
        regla: "nodo_inalcanzable",
        nodos: huerfanos,
        mensaje: `Estos pasos no se alcanzan nunca desde el disparador: ${huerfanos.join(", ")}.`,
      });
    }
  }

  // --- regla: ciclo_sin_espera ------------------------------------------
  problemas.push(...ciclosSinEspera(grafo.nodos, salientesPorNodo, porId));

  return problemas;
}

/**
 * Todo ciclo tiene que contener al menos una espera.
 *
 * Es la capa estática que hace seguros los ciclos libres. Un ciclo con espera
 * es el caso real de negocio ("insistir cada 2 días hasta que conteste"); un
 * ciclo sin espera gira en milisegundos, consume el tope de pasos de la
 * corrida en menos de un segundo y no hace nada útil. La diferencia se puede
 * probar sin ejecutar nada, así que se prueba acá y no en runtime.
 *
 * DFS de tres colores: blanco (sin visitar), gris (en la pila actual), negro
 * (cerrado). Una arista hacia un gris cierra un ciclo, que se reconstruye
 * desde la pila.
 */
function ciclosSinEspera(
  nodos: Nodo[],
  salientesPorNodo: Map<string, Arista[]>,
  porId: Map<string, Nodo>,
): ProblemaGrafo[] {
  const problemas: ProblemaGrafo[] = [];
  const negro = new Set<string>();
  const gris = new Set<string>();
  const pila: string[] = [];
  // Un mismo ciclo se puede alcanzar por varios caminos; sin esto el mismo
  // problema se reportaría repetido.
  const reportados = new Set<string>();

  function visitar(id: string): void {
    gris.add(id);
    pila.push(id);

    for (const a of salientesPorNodo.get(id) ?? []) {
      if (gris.has(a.hasta)) {
        const desde = pila.indexOf(a.hasta);
        const ciclo = pila.slice(desde);
        const clave = [...ciclo].sort().join(">");
        if (!reportados.has(clave)) {
          reportados.add(clave);
          const tieneEspera = ciclo.some((n) => porId.get(n)?.tipo === "espera");
          if (!tieneEspera) {
            problemas.push({
              regla: "ciclo_sin_espera",
              nodos: ciclo,
              mensaje: `Este ciclo no tiene ninguna espera (${ciclo.join(" → ")}): giraría sin freno. Agregá una espera adentro del ciclo.`,
            });
          }
        }
      } else if (!negro.has(a.hasta)) {
        visitar(a.hasta);
      }
    }

    pila.pop();
    gris.delete(id);
    negro.add(id);
  }

  // Desde todos los nodos y no sólo desde el disparador: un ciclo entre
  // nodos inalcanzables sigue siendo un ciclo mal formado, y reportarlo
  // ayuda a quien está armando el flujo por partes.
  for (const n of nodos) {
    if (!negro.has(n.id)) visitar(n.id);
  }

  return problemas;
}
```

- [ ] **Step 5: Correr y verificar que pasan**

```bash
npx vitest run tests/unit/workflows/validar-grafo.test.ts
```

Expected: todos PASS (14 casos).

- [ ] **Step 6: Prueba de mutación — confirmar que el test de ciclos discrimina**

Un test que pasa igual con y sin la lógica no prueba nada. Comentar temporalmente el `problemas.push(...ciclosSinEspera(...))` de `validarGrafo` y volver a correr:

```bash
npx vitest run tests/unit/workflows/validar-grafo.test.ts
```

Expected: FALLA el caso `ciclo_sin_espera: dos acciones que se apuntan`. Descomentar y confirmar que vuelve a pasar. Reportar en el informe si falló como se esperaba — si pasó igual, el test no sirve y hay que arreglarlo.

- [ ] **Step 7: `npm run typecheck` y `npm run lint`**

```bash
npm run typecheck && npm run lint
```

Expected: 0 errores en ambos.

- [ ] **Step 8: Commit**

```bash
git add src/lib/workflows/validar-grafo.ts tests/unit/workflows/validar-grafo.test.ts tests/unit/workflows/fixtures-grafo.ts
git commit -m "feat(workflows): validador del grafo con las 7 reglas"
```

---

## Task 3: Migración — las cuatro tablas

**Files:**

- Create: `supabase/migrations/20260819120000_workflows_grafo.sql`

**Interfaces:**

- Produces: tablas `workflows`, `workflow_versiones`, `workflow_runs`, `workflow_run_pasos`; enum `workflow_run_estado`.

- [ ] **Step 1: Escribir la migración**

```sql
-- Workflows W1: definir un flujo como grafo, validarlo antes de guardarlo y
-- versionarlo de forma inmutable. NO ejecuta nada — eso es W2.
-- Diseño completo en docs/superpowers/specs/2026-08-19-workflows-w1-grafo-design.md
--
-- El motor de ejecución ya existe (Inngest). Lo que falta es poder definir un
-- flujo sin escribir TypeScript, y eso arranca por poder guardarlo.

create table public.workflows (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null,
  descripcion text,
  -- Apagar un workflow no toca sus corridas en vuelo: acá sólo significa
  -- "no aceptar disparos nuevos". Qué hacer con las vivas lo decide W2.
  activo      boolean not null default false,
  created_at  timestamptz not null default now(),
  constraint workflows_nombre_len check (char_length(nombre) between 2 and 80)
);

comment on table public.workflows is
  'Identidad de un flujo automatico. El grafo vive en workflow_versiones.';

alter table public.workflows enable row level security;

create policy workflows_select on public.workflows
  for select to authenticated
  using ((select public.is_admin()) or (select public.is_vendedor()));
create policy workflows_insert_admin on public.workflows
  for insert to authenticated
  with check ((select public.is_admin()));
create policy workflows_update_admin on public.workflows
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
create policy workflows_delete_admin on public.workflows
  for delete to authenticated
  using ((select public.is_admin()));

revoke all on table public.workflows from public, anon;
grant select, insert, update, delete on table public.workflows to authenticated;
grant all on table public.workflows to service_role;

-- =========================================================================
-- Versiones: append-only, mismo patrón que agente_config
-- =========================================================================
-- Guardar inserta una fila nueva, nunca actualiza una existente. Es lo que
-- permite editar un workflow con corridas en vuelo sin romperlas: cada
-- corrida sigue apuntando a la versión con la que arrancó.

create table public.workflow_versiones (
  id           uuid primary key default gen_random_uuid(),
  workflow_id  uuid not null references public.workflows(id) on delete cascade,
  version      integer not null,
  -- { nodos: [...], aristas: [...] }. Validado por validarGrafo() antes de
  -- publicarse: acá llega sano o no llega.
  grafo        jsonb not null,
  -- Tope de pasos por corrida. Vive en la versión y no en el workflow para que
  -- cambiarlo también genere versión nueva: es comportamiento, no preferencia.
  max_pasos    integer not null default 500,
  publicada    boolean not null default false,
  created_at   timestamptz not null default now(),
  created_by   uuid references public.usuarios(id) on delete set null,
  constraint workflow_versiones_max_pasos_rango check (max_pasos between 1 and 10000)
);

comment on column public.workflow_versiones.max_pasos is
  'Tope duro de pasos por corrida. Capa 2 de las tres que hacen seguros los ciclos libres; W2 lo hace cumplir.';

create unique index workflow_versiones_version_unica
  on public.workflow_versiones (workflow_id, version);

-- Una sola publicada por workflow. Mismo mecanismo que agente_config_una_activa.
create unique index workflow_versiones_una_publicada
  on public.workflow_versiones (workflow_id) where publicada;

create index workflow_versiones_recientes
  on public.workflow_versiones (workflow_id, created_at desc);

alter table public.workflow_versiones enable row level security;

create policy workflow_versiones_select on public.workflow_versiones
  for select to authenticated
  using ((select public.is_admin()) or (select public.is_vendedor()));
create policy workflow_versiones_insert_admin on public.workflow_versiones
  for insert to authenticated
  with check ((select public.is_admin()));
-- Sin policy de UPDATE del grafo: la tabla es append-only por diseño. La de
-- update existe sólo para poder despublicar (marcar publicada = false).
create policy workflow_versiones_update_admin on public.workflow_versiones
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

revoke all on table public.workflow_versiones from public, anon;
grant select, insert, update on table public.workflow_versiones to authenticated;
grant all on table public.workflow_versiones to service_role;

-- =========================================================================
-- Corridas
-- =========================================================================

create type workflow_run_estado as enum ('corriendo','esperando','terminado','fallado','cancelado');

create table public.workflow_runs (
  id                  uuid primary key default gen_random_uuid(),
  -- La versión exacta con la que arrancó. `restrict` y no `cascade`: borrar una
  -- versión que alguien está ejecutando dejaría corridas sin definición.
  workflow_version_id uuid not null references public.workflow_versiones(id) on delete restrict,
  lead_id             uuid not null references public.leads(id) on delete cascade,
  -- Nullable: hay disparadores que no nacen de una sesión (ej. cron por lead).
  lead_session_id     uuid references public.lead_session(id) on delete set null,
  estado              workflow_run_estado not null default 'corriendo',
  -- Un id DENTRO del grafo de la versión, no una FK: los nodos no son filas.
  nodo_actual         text,
  contexto            jsonb not null default '{}'::jsonb,
  pasos_ejecutados    integer not null default 0,
  -- Texto y no enum: W2 todavía no existe y fijar la taxonomía ahora sería
  -- adivinar sin haber ejecutado un flujo.
  error               text,
  started_at          timestamptz not null default now(),
  ended_at            timestamptz,
  constraint workflow_runs_pasos_no_negativo check (pasos_ejecutados >= 0),
  -- Una corrida terminada tiene fin; una viva no. Sin esto quedan corridas
  -- "corriendo" con ended_at, que rompen cualquier consulta de duración.
  constraint workflow_runs_fin_coherente check (
    (estado in ('terminado','fallado','cancelado')) = (ended_at is not null)
  )
);

create index workflow_runs_vivas
  on public.workflow_runs (lead_id)
  where estado in ('corriendo','esperando');

create index workflow_runs_por_version
  on public.workflow_runs (workflow_version_id, started_at desc);

alter table public.workflow_runs enable row level security;

create policy workflow_runs_select on public.workflow_runs
  for select to authenticated
  using ((select public.is_admin()) or (select public.is_vendedor()));
-- Las escribe el motor con service-role, que no pasa por RLS. La policy de
-- update admin existe para poder cancelar una corrida a mano desde la UI.
create policy workflow_runs_update_admin on public.workflow_runs
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

revoke all on table public.workflow_runs from public, anon;
grant select, update on table public.workflow_runs to authenticated;
grant all on table public.workflow_runs to service_role;

-- =========================================================================
-- Pasos de cada corrida
-- =========================================================================
-- Alimenta la observabilidad de W4 y es lo que permite responder "por qué este
-- lead recibió este mensaje".

create table public.workflow_run_pasos (
  id         uuid primary key default gen_random_uuid(),
  run_id     uuid not null references public.workflow_runs(id) on delete cascade,
  nodo_id    text not null,
  -- Con ciclos, un mismo nodo_id aparece varias veces en la misma corrida:
  -- el orden es lo único que reconstruye el recorrido.
  orden      integer not null,
  entrada    jsonb,
  salida     jsonb,
  error      text,
  created_at timestamptz not null default now(),
  constraint workflow_run_pasos_orden_unico unique (run_id, orden)
);

create index workflow_run_pasos_recorrido
  on public.workflow_run_pasos (run_id, orden);

alter table public.workflow_run_pasos enable row level security;

create policy workflow_run_pasos_select on public.workflow_run_pasos
  for select to authenticated
  using ((select public.is_admin()) or (select public.is_vendedor()));

revoke all on table public.workflow_run_pasos from public, anon;
grant select on table public.workflow_run_pasos to authenticated;
grant all on table public.workflow_run_pasos to service_role;
```

- [ ] **Step 2: Aplicar a `crm-dev` con el MCP de Supabase**

Usar `mcp__plugin_supabase_supabase__apply_migration` con `project_id: "emubzkouwvuzlrtsgorx"`, `name: "workflows_grafo"` y el SQL de arriba.

- [ ] **Step 3: Verificar que quedó todo**

Con `mcp__plugin_supabase_supabase__execute_sql`:

```sql
select table_name from information_schema.tables
where table_schema = 'public' and table_name like 'workflow%'
order by table_name;

select indexname from pg_indexes
where schemaname = 'public' and indexname in
  ('workflow_versiones_una_publicada','workflow_runs_vivas','workflow_run_pasos_recorrido');

select unnest(enum_range(null::workflow_run_estado))::text as estado;
```

Expected: 4 tablas (`workflow_run_pasos`, `workflow_runs`, `workflow_versiones`, `workflows`), los 3 índices, y 5 valores del enum.

- [ ] **Step 4: Confirmar que el nombre del archivo coincide con el ledger**

Trampa documentada del MCP (`AGENTS.md §2.2`): el MCP registra la migración con **su propio** timestamp, no con el del nombre del archivo. Si divergen, un `db push` desde un clon limpio la reaplica y falla.

```bash

```

Listar las migraciones con `mcp__plugin_supabase_supabase__list_migrations` y comparar la última `version` contra el nombre del archivo. Si difieren, **renombrar el archivo** para que coincida con lo que quedó registrado.

- [ ] **Step 5: Regenerar tipos y commitear**

```bash
npm run db:gen-types
git add supabase/migrations/ src/server/db/types.gen.ts
git commit -m "feat(db): tablas de workflows, versiones y corridas"
```

---

## Task 4: Entidades y repositorios

**Files:**

- Modify: `src/types/entities.ts`
- Create: `src/server/repositories/workflows.repo.ts`
- Create: `src/server/repositories/workflows.supabase.repo.ts`
- Create: `tests/repositories/workflows.contract.ts`
- Create: `tests/unit/workflows-repo.test.ts`

**Interfaces:**

- Consumes: `Grafo` de `@/types/workflows` (Task 1); tablas de Task 3.
- Produces: `Workflow`, `WorkflowVersion`, `WorkflowRun`, `WorkflowRunPaso` en `@/types/entities`; `WorkflowsRepository` con `crearWorkflow`, `listarWorkflows`, `findWorkflow`, `crearVersion`, `listarVersiones`, `findVersionPublicada`, `publicarVersion`, `proximaVersion`; `InMemoryWorkflowsRepository`; `SupabaseWorkflowsRepository`.

- [ ] **Step 1: Agregar las entidades a `src/types/entities.ts`**

Junto a las demás entidades del archivo:

```ts
export interface Workflow {
  id: UUID;
  nombre: string;
  descripcion: string | null;
  activo: boolean;
  created_at: Date;
}

export interface WorkflowVersion {
  id: UUID;
  workflow_id: UUID;
  version: number;
  /** El grafo. Se guarda validado: `validarGrafo()` corre antes de insertar. */
  grafo: Grafo;
  max_pasos: number;
  publicada: boolean;
  created_at: Date;
  created_by: UUID | null;
}

export type WorkflowRunEstado = "corriendo" | "esperando" | "terminado" | "fallado" | "cancelado";

export interface WorkflowRun {
  id: UUID;
  /** Inmutable: la corrida termina con la versión con la que arrancó. */
  workflow_version_id: UUID;
  lead_id: UUID;
  lead_session_id: UUID | null;
  estado: WorkflowRunEstado;
  nodo_actual: string | null;
  contexto: Record<string, unknown>;
  pasos_ejecutados: number;
  error: string | null;
  started_at: Date;
  ended_at: Date | null;
}

export interface WorkflowRunPaso {
  id: UUID;
  run_id: UUID;
  nodo_id: string;
  orden: number;
  entrada: Record<string, unknown> | null;
  salida: Record<string, unknown> | null;
  error: string | null;
  created_at: Date;
}
```

Y arriba, con los demás imports de tipo:

```ts
import type { Grafo } from "@/types/workflows";
```

- [ ] **Step 2: Escribir el contract test**

`tests/repositories/workflows.contract.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import type { WorkflowsRepository } from "@/server/repositories/workflows.repo";
import type { Grafo } from "@/types/workflows";

const GRAFO: Grafo = {
  nodos: [
    { id: "d", tipo: "disparador", config: {}, posicion: { x: 0, y: 0 } },
    { id: "f", tipo: "fin", config: {}, posicion: { x: 1, y: 0 } },
  ],
  aristas: [{ desde: "d", hasta: "f", puerto: "salida" }],
};

export function runWorkflowsContract(makeRepo: () => WorkflowsRepository) {
  describe("WorkflowsRepository", () => {
    let repo: WorkflowsRepository;
    beforeEach(() => {
      repo = makeRepo();
    });

    it("crea y lista workflows", async () => {
      await repo.crearWorkflow({ nombre: "Seguimiento", descripcion: null, activo: false });
      const todos = await repo.listarWorkflows();
      expect(todos).toHaveLength(1);
      expect(todos[0]?.nombre).toBe("Seguimiento");
    });

    it("la primera version de un workflow es la 1", async () => {
      const w = await repo.crearWorkflow({ nombre: "W", descripcion: null, activo: false });
      expect(await repo.proximaVersion(w.id)).toBe(1);
    });

    it("proximaVersion avanza con cada version creada", async () => {
      const w = await repo.crearWorkflow({ nombre: "W", descripcion: null, activo: false });
      await repo.crearVersion({
        workflow_id: w.id,
        version: 1,
        grafo: GRAFO,
        max_pasos: 500,
        publicada: false,
        created_by: null,
      });
      expect(await repo.proximaVersion(w.id)).toBe(2);
    });

    it("publicar despublica la anterior: solo puede haber una publicada", async () => {
      const w = await repo.crearWorkflow({ nombre: "W", descripcion: null, activo: false });
      const v1 = await repo.crearVersion({
        workflow_id: w.id,
        version: 1,
        grafo: GRAFO,
        max_pasos: 500,
        publicada: false,
        created_by: null,
      });
      const v2 = await repo.crearVersion({
        workflow_id: w.id,
        version: 2,
        grafo: GRAFO,
        max_pasos: 500,
        publicada: false,
        created_by: null,
      });

      await repo.publicarVersion(v1.id);
      expect((await repo.findVersionPublicada(w.id))?.id).toBe(v1.id);

      await repo.publicarVersion(v2.id);
      const publicada = await repo.findVersionPublicada(w.id);
      expect(publicada?.id).toBe(v2.id);

      // La v1 sigue existiendo: las corridas que la estaban ejecutando la necesitan.
      const versiones = await repo.listarVersiones(w.id);
      expect(versiones.map((v) => v.version).sort()).toEqual([1, 2]);
    });

    it("un workflow sin version publicada devuelve null", async () => {
      const w = await repo.crearWorkflow({ nombre: "W", descripcion: null, activo: false });
      expect(await repo.findVersionPublicada(w.id)).toBeNull();
    });

    it("el grafo sobrevive el viaje de ida y vuelta", async () => {
      const w = await repo.crearWorkflow({ nombre: "W", descripcion: null, activo: false });
      const v = await repo.crearVersion({
        workflow_id: w.id,
        version: 1,
        grafo: GRAFO,
        max_pasos: 500,
        publicada: false,
        created_by: null,
      });
      const leida = await repo.listarVersiones(w.id);
      expect(leida[0]?.grafo).toEqual(GRAFO);
      expect(leida[0]?.id).toBe(v.id);
    });
  });
}
```

- [ ] **Step 3: Escribir el archivo que corre el contract contra InMemory**

`tests/unit/workflows-repo.test.ts`:

```ts
import { InMemoryWorkflowsRepository } from "@/server/repositories/workflows.repo";
import { runWorkflowsContract } from "../repositories/workflows.contract";

runWorkflowsContract(() => new InMemoryWorkflowsRepository());
```

- [ ] **Step 4: Correr y verificar que falla**

```bash
npx vitest run tests/unit/workflows-repo.test.ts
```

Expected: FAIL — `Cannot find module '@/server/repositories/workflows.repo'`.

- [ ] **Step 5: Escribir `src/server/repositories/workflows.repo.ts`**

```ts
import { NotFoundError } from "@/lib/errors";
import type { UUID, Workflow, WorkflowVersion } from "@/types/entities";
import type { Insert } from "./_types";

export type WorkflowInsert = Insert<Workflow, "id" | "created_at">;
export type WorkflowVersionInsert = Insert<WorkflowVersion, "id" | "created_at">;

/**
 * Lectura y escritura de la definición de workflows.
 *
 * No expone `update` del grafo a propósito: `workflow_versiones` es
 * append-only. Cambiar un flujo es crear una versión nueva, porque puede
 * haber corridas ejecutando la anterior.
 */
export interface WorkflowsRepository {
  crearWorkflow(input: WorkflowInsert): Promise<Workflow>;
  listarWorkflows(): Promise<Workflow[]>;
  findWorkflow(id: UUID): Promise<Workflow | null>;

  crearVersion(input: WorkflowVersionInsert): Promise<WorkflowVersion>;
  listarVersiones(workflowId: UUID): Promise<WorkflowVersion[]>;
  findVersionPublicada(workflowId: UUID): Promise<WorkflowVersion | null>;
  /** Publica una y despublica la que estuviera publicada de ese workflow. */
  publicarVersion(versionId: UUID): Promise<WorkflowVersion>;
  /** Qué número le toca a la próxima versión. 1 si no hay ninguna. */
  proximaVersion(workflowId: UUID): Promise<number>;
}

export class InMemoryWorkflowsRepository implements WorkflowsRepository {
  private readonly workflows = new Map<UUID, Workflow>();
  private readonly versiones = new Map<UUID, WorkflowVersion>();

  async crearWorkflow(input: WorkflowInsert): Promise<Workflow> {
    const w: Workflow = { ...input, id: crypto.randomUUID(), created_at: new Date() };
    this.workflows.set(w.id, w);
    return { ...w };
  }

  async listarWorkflows(): Promise<Workflow[]> {
    return [...this.workflows.values()].map((w) => ({ ...w }));
  }

  async findWorkflow(id: UUID): Promise<Workflow | null> {
    const w = this.workflows.get(id);
    return w ? { ...w } : null;
  }

  async crearVersion(input: WorkflowVersionInsert): Promise<WorkflowVersion> {
    const v: WorkflowVersion = { ...input, id: crypto.randomUUID(), created_at: new Date() };
    this.versiones.set(v.id, v);
    return { ...v };
  }

  async listarVersiones(workflowId: UUID): Promise<WorkflowVersion[]> {
    return [...this.versiones.values()]
      .filter((v) => v.workflow_id === workflowId)
      .map((v) => ({ ...v }));
  }

  async findVersionPublicada(workflowId: UUID): Promise<WorkflowVersion | null> {
    const v = [...this.versiones.values()].find((x) => x.workflow_id === workflowId && x.publicada);
    return v ? { ...v } : null;
  }

  async publicarVersion(versionId: UUID): Promise<WorkflowVersion> {
    const v = this.versiones.get(versionId);
    if (!v)
      throw new NotFoundError(`versión no encontrada: ${versionId}`, "workflow_version", versionId);
    // Despublicar la anterior antes de publicar esta: el índice único parcial
    // de Postgres rechazaría dos publicadas del mismo workflow.
    for (const otra of this.versiones.values()) {
      if (otra.workflow_id === v.workflow_id && otra.publicada) {
        this.versiones.set(otra.id, { ...otra, publicada: false });
      }
    }
    const next: WorkflowVersion = { ...v, publicada: true };
    this.versiones.set(versionId, next);
    return { ...next };
  }

  async proximaVersion(workflowId: UUID): Promise<number> {
    const versiones = [...this.versiones.values()].filter((v) => v.workflow_id === workflowId);
    return versiones.reduce((max, v) => Math.max(max, v.version), 0) + 1;
  }
}
```

- [ ] **Step 6: Correr y verificar que pasa**

```bash
npx vitest run tests/unit/workflows-repo.test.ts
```

Expected: 6/6 PASS.

- [ ] **Step 7: Escribir `src/server/repositories/workflows.supabase.repo.ts`**

```ts
import { mapPostgrestError } from "@/server/db/postgrest-errors";
import type { AppClient } from "@/server/db/client";
import type { UUID, Workflow, WorkflowVersion } from "@/types/entities";
import type { Grafo } from "@/types/workflows";
import type { WorkflowInsert, WorkflowVersionInsert, WorkflowsRepository } from "./workflows.repo";

const COLS_WORKFLOW = "id, nombre, descripcion, activo, created_at";
const COLS_VERSION =
  "id, workflow_id, version, grafo, max_pasos, publicada, created_at, created_by";

export class SupabaseWorkflowsRepository implements WorkflowsRepository {
  constructor(private readonly db: AppClient) {}

  async crearWorkflow(input: WorkflowInsert): Promise<Workflow> {
    const { data, error } = await this.db
      .from("workflows")
      .insert({ nombre: input.nombre, descripcion: input.descripcion, activo: input.activo })
      .select(COLS_WORKFLOW)
      .single();
    if (error) throw mapPostgrestError(error, { resource: "workflows" });
    return mapWorkflow(data);
  }

  async listarWorkflows(): Promise<Workflow[]> {
    const { data, error } = await this.db
      .from("workflows")
      .select(COLS_WORKFLOW)
      .order("created_at", { ascending: false });
    if (error) throw mapPostgrestError(error, { resource: "workflows" });
    return (data ?? []).map(mapWorkflow);
  }

  async findWorkflow(id: UUID): Promise<Workflow | null> {
    const { data, error } = await this.db
      .from("workflows")
      .select(COLS_WORKFLOW)
      .eq("id", id)
      .maybeSingle();
    if (error) throw mapPostgrestError(error, { resource: "workflows" });
    return data ? mapWorkflow(data) : null;
  }

  async crearVersion(input: WorkflowVersionInsert): Promise<WorkflowVersion> {
    const { data, error } = await this.db
      .from("workflow_versiones")
      .insert({
        workflow_id: input.workflow_id,
        version: input.version,
        grafo: input.grafo,
        max_pasos: input.max_pasos,
        publicada: input.publicada,
        created_by: input.created_by,
      })
      .select(COLS_VERSION)
      .single();
    if (error) throw mapPostgrestError(error, { resource: "workflow_versiones" });
    return mapVersion(data);
  }

  async listarVersiones(workflowId: UUID): Promise<WorkflowVersion[]> {
    const { data, error } = await this.db
      .from("workflow_versiones")
      .select(COLS_VERSION)
      .eq("workflow_id", workflowId)
      .order("version", { ascending: false });
    if (error) throw mapPostgrestError(error, { resource: "workflow_versiones" });
    return (data ?? []).map(mapVersion);
  }

  async findVersionPublicada(workflowId: UUID): Promise<WorkflowVersion | null> {
    const { data, error } = await this.db
      .from("workflow_versiones")
      .select(COLS_VERSION)
      .eq("workflow_id", workflowId)
      .eq("publicada", true)
      .maybeSingle();
    if (error) throw mapPostgrestError(error, { resource: "workflow_versiones" });
    return data ? mapVersion(data) : null;
  }

  async publicarVersion(versionId: UUID): Promise<WorkflowVersion> {
    const actual = await this.db
      .from("workflow_versiones")
      .select("workflow_id")
      .eq("id", versionId)
      .maybeSingle();
    if (actual.error) throw mapPostgrestError(actual.error, { resource: "workflow_versiones" });
    if (!actual.data) {
      const { NotFoundError } = await import("@/lib/errors");
      throw new NotFoundError(`versión no encontrada: ${versionId}`, "workflow_version", versionId);
    }

    // Despublicar primero: el índice único parcial rechaza dos publicadas del
    // mismo workflow, así que el orden inverso fallaría con 23505.
    const baja = await this.db
      .from("workflow_versiones")
      .update({ publicada: false })
      .eq("workflow_id", actual.data.workflow_id)
      .eq("publicada", true);
    if (baja.error) throw mapPostgrestError(baja.error, { resource: "workflow_versiones" });

    const { data, error } = await this.db
      .from("workflow_versiones")
      .update({ publicada: true })
      .eq("id", versionId)
      .select(COLS_VERSION)
      .single();
    if (error) throw mapPostgrestError(error, { resource: "workflow_versiones" });
    return mapVersion(data);
  }

  async proximaVersion(workflowId: UUID): Promise<number> {
    const { data, error } = await this.db
      .from("workflow_versiones")
      .select("version")
      .eq("workflow_id", workflowId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw mapPostgrestError(error, { resource: "workflow_versiones" });
    return (data?.version ?? 0) + 1;
  }
}

function mapWorkflow(r: {
  id: string;
  nombre: string;
  descripcion: string | null;
  activo: boolean;
  created_at: string;
}): Workflow {
  return {
    id: r.id,
    nombre: r.nombre,
    descripcion: r.descripcion,
    activo: r.activo,
    created_at: new Date(r.created_at),
  };
}

function mapVersion(r: {
  id: string;
  workflow_id: string;
  version: number;
  grafo: unknown;
  max_pasos: number;
  publicada: boolean;
  created_at: string;
  created_by: string | null;
}): WorkflowVersion {
  return {
    id: r.id,
    workflow_id: r.workflow_id,
    version: r.version,
    // El grafo se validó antes de insertarse; acá vuelve tal cual salió.
    grafo: r.grafo as Grafo,
    max_pasos: r.max_pasos,
    publicada: r.publicada,
    created_at: new Date(r.created_at),
    created_by: r.created_by,
  };
}
```

- [ ] **Step 8: `npm run typecheck`, `npm run lint` y la suite**

```bash
npm run typecheck && npm run lint && npx vitest run
```

Expected: 0 errores, y la suite en su número actual más los 6 casos nuevos. El número base al escribir este plan era 1834 — reportar el número real observado.

> `workflows.supabase.repo.ts` no corre contra Postgres: `test:integration` está congelado (`AGENTS.md` lección 10). Decirlo en el informe, no darlo por probado.

- [ ] **Step 9: Commit**

```bash
git add src/types/entities.ts src/server/repositories/workflows.repo.ts src/server/repositories/workflows.supabase.repo.ts tests/repositories/workflows.contract.ts tests/unit/workflows-repo.test.ts
git commit -m "feat(workflows): entidades y repositorio de definicion"
```

---

## Task 5: Service que publica aplicando el validador

**Files:**

- Create: `src/server/services/workflows/workflows-admin.service.ts`
- Create: `src/server/bootstrap/workflows-bootstrap.ts`
- Test: `tests/unit/workflows-admin-service.test.ts`

**Interfaces:**

- Consumes: `WorkflowsRepository` (Task 4), `validarGrafo` (Task 2), `GrafoSchema` (Task 1).
- Produces: `WorkflowsAdminService` con `crear`, `listar`, `guardarVersion`, `publicar`, `versionPublicada`; `DefaultWorkflowsAdminService`; `makeWorkflowsAdminService(db)` y `getWorkflowsAdminServiceForRequest()`.

- [ ] **Step 1: Escribir los tests que fallan**

`tests/unit/workflows-admin-service.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ValidationError } from "@/lib/errors";
import { InMemoryWorkflowsRepository } from "@/server/repositories/workflows.repo";
import { DefaultWorkflowsAdminService } from "@/server/services/workflows/workflows-admin.service";
import type { Grafo } from "@/types/workflows";

const VALIDO: Grafo = {
  nodos: [
    { id: "d", tipo: "disparador", config: {}, posicion: { x: 0, y: 0 } },
    { id: "f", tipo: "fin", config: {}, posicion: { x: 1, y: 0 } },
  ],
  aristas: [{ desde: "d", hasta: "f", puerto: "salida" }],
};

/** Dos acciones que se apuntan: ciclo sin espera. */
const CICLO_SIN_ESPERA: Grafo = {
  nodos: [
    { id: "d", tipo: "disparador", config: {}, posicion: { x: 0, y: 0 } },
    { id: "a1", tipo: "accion", config: {}, posicion: { x: 1, y: 0 } },
    { id: "a2", tipo: "accion", config: {}, posicion: { x: 2, y: 0 } },
  ],
  aristas: [
    { desde: "d", hasta: "a1", puerto: "salida" },
    { desde: "a1", hasta: "a2", puerto: "salida" },
    { desde: "a2", hasta: "a1", puerto: "salida" },
  ],
};

function build() {
  const repo = new InMemoryWorkflowsRepository();
  return { repo, service: new DefaultWorkflowsAdminService({ workflows: repo }) };
}

describe("DefaultWorkflowsAdminService", () => {
  it("guarda una version con un grafo valido", async () => {
    const { service } = build();
    const w = await service.crear({ nombre: "Seguimiento", descripcion: null });
    const v = await service.guardarVersion({
      workflowId: w.id,
      grafo: VALIDO,
      maxPasos: 500,
      userId: null,
    });
    expect(v.version).toBe(1);
    expect(v.publicada).toBe(false);
  });

  it("numera las versiones de forma creciente", async () => {
    const { service } = build();
    const w = await service.crear({ nombre: "W", descripcion: null });
    await service.guardarVersion({ workflowId: w.id, grafo: VALIDO, maxPasos: 500, userId: null });
    const v2 = await service.guardarVersion({
      workflowId: w.id,
      grafo: VALIDO,
      maxPasos: 500,
      userId: null,
    });
    expect(v2.version).toBe(2);
  });

  it("rechaza un grafo con un ciclo sin espera", async () => {
    const { service } = build();
    const w = await service.crear({ nombre: "W", descripcion: null });
    await expect(
      service.guardarVersion({
        workflowId: w.id,
        grafo: CICLO_SIN_ESPERA,
        maxPasos: 500,
        userId: null,
      }),
    ).rejects.toThrow(ValidationError);
  });

  it("el error de un grafo invalido nombra la regla que se rompio", async () => {
    const { service } = build();
    const w = await service.crear({ nombre: "W", descripcion: null });
    await expect(
      service.guardarVersion({
        workflowId: w.id,
        grafo: CICLO_SIN_ESPERA,
        maxPasos: 500,
        userId: null,
      }),
    ).rejects.toThrow(/ciclo_sin_espera/);
  });

  it("un grafo invalido no deja version guardada", async () => {
    const { repo, service } = build();
    const w = await service.crear({ nombre: "W", descripcion: null });
    await expect(
      service.guardarVersion({
        workflowId: w.id,
        grafo: CICLO_SIN_ESPERA,
        maxPasos: 500,
        userId: null,
      }),
    ).rejects.toThrow();
    expect(await repo.listarVersiones(w.id)).toHaveLength(0);
  });

  it("rechaza un grafo con la forma rota antes de validar la semantica", async () => {
    const { service } = build();
    const w = await service.crear({ nombre: "W", descripcion: null });
    await expect(
      service.guardarVersion({
        workflowId: w.id,
        // tipo inexistente: no pasa el schema Zod
        grafo: {
          nodos: [{ id: "x", tipo: "inventado", config: {}, posicion: { x: 0, y: 0 } }],
          aristas: [],
        } as unknown as Grafo,
        maxPasos: 500,
        userId: null,
      }),
    ).rejects.toThrow(ValidationError);
  });

  it("publicar deja esa version como la publicada", async () => {
    const { service } = build();
    const w = await service.crear({ nombre: "W", descripcion: null });
    const v = await service.guardarVersion({
      workflowId: w.id,
      grafo: VALIDO,
      maxPasos: 500,
      userId: null,
    });
    await service.publicar(v.id);
    expect((await service.versionPublicada(w.id))?.id).toBe(v.id);
  });
});
```

- [ ] **Step 2: Correr y verificar que fallan**

```bash
npx vitest run tests/unit/workflows-admin-service.test.ts
```

Expected: FAIL — `Cannot find module '@/server/services/workflows/workflows-admin.service'`.

- [ ] **Step 3: Escribir el service**

```ts
import { ValidationError } from "@/lib/errors";
import { GrafoSchema } from "@/lib/validation/workflows.schema";
import { validarGrafo } from "@/lib/workflows/validar-grafo";
import type { WorkflowsRepository } from "@/server/repositories/workflows.repo";
import type { UUID, Workflow, WorkflowVersion } from "@/types/entities";
import type { Grafo } from "@/types/workflows";

export interface GuardarVersionInput {
  workflowId: UUID;
  grafo: Grafo;
  maxPasos: number;
  userId: UUID | null;
}

export interface WorkflowsAdminService {
  crear(input: { nombre: string; descripcion: string | null }): Promise<Workflow>;
  listar(): Promise<Workflow[]>;
  /** Valida el grafo y, sólo si está sano, lo guarda como versión nueva. */
  guardarVersion(input: GuardarVersionInput): Promise<WorkflowVersion>;
  publicar(versionId: UUID): Promise<WorkflowVersion>;
  versionPublicada(workflowId: UUID): Promise<WorkflowVersion | null>;
}

export class DefaultWorkflowsAdminService implements WorkflowsAdminService {
  constructor(private readonly deps: { workflows: WorkflowsRepository }) {}

  async crear(input: { nombre: string; descripcion: string | null }): Promise<Workflow> {
    return this.deps.workflows.crearWorkflow({
      nombre: input.nombre,
      descripcion: input.descripcion,
      // Nace apagado: activarlo es un acto deliberado, no el default de crear.
      activo: false,
    });
  }

  async listar(): Promise<Workflow[]> {
    return this.deps.workflows.listarWorkflows();
  }

  /**
   * La única puerta por la que un grafo entra a la base.
   *
   * Valida en dos etapas porque son dos preguntas distintas: primero la forma
   * (Zod), después el sentido (`validarGrafo`). Un grafo con un `tipo`
   * inexistente ni siquiera se puede recorrer, así que la forma va primero.
   *
   * Nada se guarda si algo falla: que la base sólo contenga grafos sanos es lo
   * que le permite a W2 ejecutar sin volver a validar en cada paso.
   */
  async guardarVersion(input: GuardarVersionInput): Promise<WorkflowVersion> {
    const forma = GrafoSchema.safeParse(input.grafo);
    if (!forma.success) {
      throw new ValidationError(
        `el grafo no tiene la forma esperada: ${forma.error.issues[0]?.message ?? "estructura inválida"}`,
        "grafo_forma_invalida",
      );
    }

    const problemas = validarGrafo(forma.data);
    if (problemas.length > 0) {
      // Todos los problemas en el mensaje, no el primero: quien está armando
      // el flujo quiere ver de una vez todo lo que le falta.
      const detalle = problemas.map((p) => `${p.regla}: ${p.mensaje}`).join(" | ");
      throw new ValidationError(`el flujo tiene problemas — ${detalle}`, "grafo_invalido");
    }

    const version = await this.deps.workflows.proximaVersion(input.workflowId);
    return this.deps.workflows.crearVersion({
      workflow_id: input.workflowId,
      version,
      grafo: forma.data,
      max_pasos: input.maxPasos,
      // Guardar no publica: son dos actos distintos.
      publicada: false,
      created_by: input.userId,
    });
  }

  async publicar(versionId: UUID): Promise<WorkflowVersion> {
    return this.deps.workflows.publicarVersion(versionId);
  }

  async versionPublicada(workflowId: UUID): Promise<WorkflowVersion | null> {
    return this.deps.workflows.findVersionPublicada(workflowId);
  }
}
```

- [ ] **Step 4: Correr y verificar que pasan**

```bash
npx vitest run tests/unit/workflows-admin-service.test.ts
```

Expected: 7/7 PASS.

- [ ] **Step 5: Escribir el bootstrap**

`src/server/bootstrap/workflows-bootstrap.ts`:

```ts
import { createSupabaseServerClient } from "@/server/auth/supabase-ssr";
import { SupabaseWorkflowsRepository } from "@/server/repositories/workflows.supabase.repo";
import { DefaultWorkflowsAdminService } from "@/server/services/workflows/workflows-admin.service";
import type { AppClient } from "@/server/db/client";
import type { WorkflowsAdminService } from "@/server/services/workflows/workflows-admin.service";

export function makeWorkflowsAdminService(db: AppClient): WorkflowsAdminService {
  return new DefaultWorkflowsAdminService({ workflows: new SupabaseWorkflowsRepository(db) });
}

export async function getWorkflowsAdminServiceForRequest(): Promise<WorkflowsAdminService> {
  const db = await createSupabaseServerClient();
  return makeWorkflowsAdminService(db);
}
```

- [ ] **Step 6: Verificación final**

```bash
npm run typecheck && npm run lint && npm run test
```

Expected: 0 errores de typecheck, 0 de lint, y la suite completa verde — reportar el número real.

- [ ] **Step 7: Commit**

```bash
git add src/server/services/workflows/workflows-admin.service.ts src/server/bootstrap/workflows-bootstrap.ts tests/unit/workflows-admin-service.test.ts
git commit -m "feat(workflows): publicar una version pasa por el validador"
```

---

## Self-Review

**Cobertura del spec:**

- §6.1–6.4 (las 4 tablas) → Task 3. §6.5 (RLS + grants) → Task 3, incluido en la misma migración.
- §7 (el grafo: tipos, puertos por tipo de nodo) → Task 1 (tipos + Zod) y Task 2 (`puertosDe`).
- §8 (validador, las 7 reglas, DFS de 3 colores) → Task 2, una prueba por regla.
- §9 (alcance: sin UI, sin ejecución) → respetado; ninguna tarea crea pantallas ni handlers de Inngest.
- §10 (testing: una prueba por regla, válidos que parecen inválidos, todos los problemas) → Task 2 Steps 2 y 5, más el paso de mutación del Step 6.
- §11 (lo que queda sin resolver) → no requiere tarea; `workflow_runs.error` queda como texto y `config` como objeto opaco, tal cual el spec pide.

**Un hueco del spec que el plan cierra:** §6 no menciona el paso de reconciliar el nombre del archivo de migración contra el ledger del MCP de Supabase. Es una trampa ya documentada en `AGENTS.md §2.2` y que mordió dos veces en este repo, así que va como Task 3 Step 4.

**Decisión que el spec dejaba abierta:** el spec no dice si `crearWorkflow` nace activo o apagado. El plan elige **apagado** (Task 5 Step 3) y lo comenta: activar es un acto deliberado, no el default de crear.

**Placeholders:** ninguno — cada step tiene el código completo o el comando exacto.

**Consistencia de nombres:** `validarGrafo`, `puertosDe`, `GrafoSchema`, `WorkflowsRepository`, `DefaultWorkflowsAdminService`, `guardarVersion`, `proximaVersion`, `findVersionPublicada`, `publicarVersion` se definen una vez y se usan con el mismo nombre en las tareas que los consumen. Los campos de `WorkflowVersion` (`workflow_id`, `max_pasos`, `publicada`, `created_by`) coinciden entre la entidad (Task 4 Step 1), el contract test (Task 4 Step 2) y el service (Task 5 Step 3).
