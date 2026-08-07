# Rediseño A — Base visual: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Instalar el lenguaje visual del rediseño "sala de control" en toda la app — tokens, modo oscuro, íconos, primitivas, SideNav y shell — sin tocar datos, rutas ni migraciones.

**Architecture:** Los tokens semánticos de shadcn se redefinen con la paleta del handoff, de modo que los ~30 componentes vendorizados en `src/components/ui/**` adoptan el diseño sin ser editados. La lógica pura de presentación (colores de etapa y canal, iniciales) vive en `src/lib/ui/` con tests, porque `src/components/shared/**` está excluido de coverage. Los íconos son re-exports nombrados de `lucide-react` con el alias del handoff.

**Tech Stack:** Next.js 16.2.6 (App Router, middleware = `proxy`), React 19.2.6, Tailwind CSS v4, shadcn/ui, lucide-react 1.14.0, Vitest 4 + jsdom, TypeScript strict.

**Spec:** `docs/superpowers/specs/2026-08-07-rediseno-a-base-visual-design.md`

## Global Constraints

- **Idioma:** UI, comentarios y commits en **español**. Identificadores técnicos genéricos en inglés; identificadores de dominio en español.
- **Commits:** Conventional Commits (enforced por commitlint). Subject ≤72 chars, en español. Body solo si el "por qué" no es obvio.
- **Sin emojis** en código ni en commits.
- **Sin comentarios obvios.** Solo el "por qué" no evidente.
- **TypeScript:** `strict` + `noUncheckedIndexedAccess` + `noImplicitOverride`. Prohibido `any`.
- **Sin deps nuevas.** Todo lo necesario ya está instalado.
- **No tocar** `src/components/ui/**` (shadcn vendorizado — se extiende por composición, no editando).
- **Cero cambios** en repositorios, servicios, Server Actions, migraciones y rutas. Si un paso parece necesitarlo, parar: el alcance se desbordó.
- **Orden de imports:** externos → absolutos `@/...` → relativos `./...` → `import type` al final.
- **Valores de color en hex**, exactamente como los define el handoff. No convertir a oklch.
- **Verificación entre tareas:** `npm run ci` (typecheck + lint + format:check + coverage 80/75/80/80).

### Desvío respecto del spec, decidido en este plan

El spec §3.2 lista los colores de **etapa** y **canal** como tokens de `@theme`. Este plan los implementa como **constantes TypeScript en `src/lib/ui/`**, no como utilidades de Tailwind.

Razón: Tailwind no puede generar clases a partir de valores de runtime — `bg-stage-${stage}` no existe en el output porque el compilador nunca ve esa cadena. Un badge de etapa se pinta sí o sí con `style={{ … }}`. Mantener la fuente en TS deja **una** sola fuente de verdad, testeable, en lugar de duplicar la paleta entre CSS y TS. El resto de los tokens (superficies, líneas, texto, marca, semánticos) sí van a `@theme` porque se usan con clases estáticas.

---

## Estructura de archivos

| Archivo                                    | Responsabilidad                                                                                                    |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `src/app/globals.css`                      | **Modificar.** Tokens semánticos de shadcn en `.dark` + tokens propios en `@theme inline` + keyframes + scrollbars |
| `src/app/layout.tsx`                       | **Modificar.** Clase `dark` en `<html>`                                                                            |
| `src/lib/ui/stage.ts`                      | **Crear.** Color, label, fondo de badge, embudo y desvíos por `CurrentStage`                                       |
| `src/lib/ui/canal.ts`                      | **Crear.** Color y label por `Canal`                                                                               |
| `src/lib/ui/initials.ts`                   | **Crear.** Nombre → iniciales                                                                                      |
| `src/components/icons.ts`                  | **Crear.** Re-exports de lucide con alias del handoff                                                              |
| `src/components/shared/StageBadge.tsx`     | **Crear.** Badge de etapa                                                                                          |
| `src/components/shared/ChannelDot.tsx`     | **Crear.** Punto de canal                                                                                          |
| `src/components/shared/InitialsAvatar.tsx` | **Crear.** Avatar de iniciales                                                                                     |
| `src/components/shared/Eyebrow.tsx`        | **Crear.** Etiqueta mono uppercase                                                                                 |
| `src/components/shared/MonoMeta.tsx`       | **Crear.** Texto mono chico                                                                                        |
| `src/components/shared/SideNav.tsx`        | **Reescribir.** Sidebar completa del diseño                                                                        |
| `src/app/(panel)/layout.tsx`               | **Modificar.** Shell; el logo y el logout pasan a SideNav                                                          |
| `src/app/page.tsx`                         | **Reescribir.** Redirect a `/inbox`                                                                                |
| `tests/unit/ui/stage.test.ts`              | **Crear.**                                                                                                         |
| `tests/unit/ui/canal.test.ts`              | **Crear.**                                                                                                         |
| `tests/unit/ui/initials.test.ts`           | **Crear.**                                                                                                         |

---

## Task 1: Tokens y modo oscuro

**Files:**

- Modify: `src/app/globals.css`
- Modify: `src/app/layout.tsx:27`

**Interfaces:**

- Consumes: nada.
- Produces: utilidades Tailwind `bg-surface-*`, `text-ink-*`, `border-line-*`, `bg-brand`, `text-brand`, `text-ok|warn|caution|danger|info|special`; clases `animate-pulse-dot` y `animate-rise-in`.

- [ ] **Step 1: Agregar los tokens propios al bloque `@theme inline`**

En `src/app/globals.css`, dentro del `@theme inline` existente, después de la línea `--font-heading: …`, insertar:

```css
/* Rediseño "sala de control" — tokens que shadcn no tiene.
     Hex literal, no oklch: el handoff define valores exactos y la fidelidad
     solo es auditable si el token dice lo mismo que el documento. */
--color-surface-root: #08090b;
--color-surface-panel: #0a0b0e;
--color-surface-chat: #0d0e12;
--color-surface-card: #0f1116;
--color-surface-elevated: #101218;
--color-surface-input: #14161b;
--color-surface-hover: #15181e;
--color-surface-avatar: #1a1d24;
--color-surface-bubble-in: #191c22;
--color-surface-bubble-vend: #e8eaee;

--color-line-layout: #17191f;
--color-line-card: #1c1f26;
--color-line-input: #21242c;
--color-line-control: #23262d;

--color-ink-primary: #ecedef;
--color-ink-body: #e4e6ea;
--color-ink-secondary: #c8ccd3;
--color-ink-muted: #a9aeb7;
--color-ink-dim: #8b909a;
--color-ink-faint: #7c838e;
--color-ink-fainter: #6e7580;
--color-ink-ghost: #5f6672;

--color-brand: #ffaf3a;
--color-brand-hover: #ffc46b;
--color-brand-deep: #f08a1d;
--color-brand-ink: #231602;

--color-ok: #34d399;
--color-warn: #fb923c;
--color-caution: #fbbf24;
--color-danger: #f87171;
--color-info: #7fb3f5;
--color-special: #e879f9;

--animate-pulse-dot: pulse-dot 2s ease-in-out infinite;
--animate-rise-in: rise-in 0.3s ease-out;
```

> `ink-faint`, `ink-fainter` e `ink-ghost` fueron elevados en el diseño para llegar a ~3:1 sobre `surface-panel`. No bajarlos: es una herramienta de uso continuo.

- [ ] **Step 2: Redefinir el bloque `.dark` con la paleta del diseño**

Reemplazar el contenido completo del bloque `.dark { … }` (`src/app/globals.css:86-118`) por:

```css
.dark {
  --background: #08090b;
  --foreground: #ecedef;
  --card: #0f1116;
  --card-foreground: #ecedef;
  --popover: #0f1116;
  --popover-foreground: #ecedef;
  --primary: #ffaf3a;
  --primary-foreground: #231602;
  --secondary: #14161b;
  --secondary-foreground: #ecedef;
  --muted: #101218;
  --muted-foreground: #8b909a;
  --accent: #15181e;
  --accent-foreground: #ecedef;
  --destructive: #f87171;
  --border: #1c1f26;
  --input: #21242c;
  --ring: #ffaf3a;
  --chart-1: #ffaf3a;
  --chart-2: #7fb3f5;
  --chart-3: #34d399;
  --chart-4: #e879f9;
  --chart-5: #fb923c;
  --radius: 0.5625rem;
  --sidebar: #08090b;
  --sidebar-foreground: #ecedef;
  --sidebar-primary: #ffaf3a;
  --sidebar-primary-foreground: #231602;
  --sidebar-accent: #15181e;
  --sidebar-accent-foreground: #ecedef;
  --sidebar-border: #17191f;
  --sidebar-ring: #ffaf3a;
}
```

> `--radius` baja de `0.625rem` a `0.5625rem` (9px, el radio de botones del handoff). Los `--radius-sm/md/lg/xl` se derivan de ahí, así que el cambio alcanza a todos los componentes de shadcn a la vez. Es intencional.
>
> El bloque `:root` claro queda **intacto**: no estorba porque `.dark` lo pisa, mantiene el contrato que esperan los componentes de shadcn, y deja abierta una variante clara futura.

- [ ] **Step 3: Agregar keyframes, scrollbars y `text-wrap`**

Al final de `src/app/globals.css`, después del bloque `@layer base`:

```css
@keyframes pulse-dot {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.35;
    transform: scale(0.82);
  }
}

@keyframes rise-in {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@layer base {
  html {
    line-height: 1.45;
  }
  p {
    text-wrap: pretty;
  }
  ::-webkit-scrollbar {
    width: 9px;
    height: 9px;
  }
  ::-webkit-scrollbar-track {
    background: transparent;
  }
  ::-webkit-scrollbar-thumb {
    background: var(--color-line-control);
    border: 2px solid transparent;
    background-clip: content-box;
    border-radius: 20px;
  }
  ::-webkit-scrollbar-thumb:hover {
    background: #343841;
    border: 2px solid transparent;
    background-clip: content-box;
  }
}
```

- [ ] **Step 4: Forzar modo oscuro**

En `src/app/layout.tsx:27`, agregar `dark` a la lista de clases del `<html>`:

```tsx
<html
  lang="es"
  className={`${geistSans.variable} ${geistMono.variable} dark h-full antialiased`}
>
```

- [ ] **Step 5: Verificar que compila y que las utilidades existen**

Run: `npm run typecheck && npm run lint && npm run format:check`
Expected: los tres pasan.

Run: `npm run dev` y abrir `http://localhost:3001/login`
Expected: fondo casi negro (`#08090b`), no blanco. El botón "Ingresar" en ámbar `#FFAF3A` con texto oscuro.

- [ ] **Step 6: Commit**

```bash
git add src/app/globals.css src/app/layout.tsx
git commit -m "feat(ui): tokens del rediseno y modo oscuro forzado"
```

---

## Task 2: `src/lib/ui/stage.ts`

**Files:**

- Create: `src/lib/ui/stage.ts`
- Test: `tests/unit/ui/stage.test.ts`

**Interfaces:**

- Consumes: `CurrentStage` de `@/types/domain`.
- Produces:
  - `FUNNEL_STAGES: readonly ["nuevo","identificando","cotizado","negociando","esperando_pago","cerrado"]`
  - `FUNNEL_LENGTH: number`
  - `stageColor(stage: CurrentStage): string` — hex
  - `stageLabel(stage: CurrentStage): string`
  - `stageBadgeBackground(stage: CurrentStage): string` — hex con alpha
  - `isDetour(stage: CurrentStage): boolean`
  - `funnelStep(stage: CurrentStage): number | null`

- [ ] **Step 1: Escribir el test que falla**

Crear `tests/unit/ui/stage.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { CURRENT_STAGE } from "@/types/domain";
import {
  FUNNEL_LENGTH,
  FUNNEL_STAGES,
  funnelStep,
  isDetour,
  stageBadgeBackground,
  stageColor,
  stageLabel,
} from "@/lib/ui/stage";

describe("stageColor", () => {
  test("las 8 etapas tienen color hex de 6 digitos", () => {
    for (const stage of CURRENT_STAGE) {
      expect(stageColor(stage)).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  test("los colores del handoff son exactos", () => {
    expect(stageColor("nuevo")).toBe("#38BDF8");
    expect(stageColor("identificando")).toBe("#818CF8");
    expect(stageColor("cotizado")).toBe("#A78BFA");
    expect(stageColor("negociando")).toBe("#FBBF24");
    expect(stageColor("esperando_pago")).toBe("#FB923C");
    expect(stageColor("cerrado")).toBe("#34D399");
    expect(stageColor("perdido")).toBe("#F87171");
    expect(stageColor("requiere_humano")).toBe("#E879F9");
  });

  test("ninguna etapa comparte color con otra", () => {
    const colores = CURRENT_STAGE.map(stageColor);
    expect(new Set(colores).size).toBe(CURRENT_STAGE.length);
  });
});

describe("stageLabel", () => {
  test("las 8 etapas tienen label no vacio", () => {
    for (const stage of CURRENT_STAGE) {
      expect(stageLabel(stage).length).toBeGreaterThan(0);
    }
  });

  test("los slugs con guion bajo se muestran con espacio", () => {
    expect(stageLabel("esperando_pago")).toBe("Esperando pago");
    expect(stageLabel("requiere_humano")).toBe("Requiere humano");
  });
});

describe("stageBadgeBackground", () => {
  test("es el color de la etapa al 13% de alpha", () => {
    expect(stageBadgeBackground("cerrado")).toBe("#34D39921");
  });

  test("aplica a las 8 etapas", () => {
    for (const stage of CURRENT_STAGE) {
      expect(stageBadgeBackground(stage)).toBe(`${stageColor(stage)}21`);
    }
  });
});

describe("embudo", () => {
  test("el embudo son 6 etapas, no 8", () => {
    expect(FUNNEL_LENGTH).toBe(6);
    expect(FUNNEL_STAGES).toEqual([
      "nuevo",
      "identificando",
      "cotizado",
      "negociando",
      "esperando_pago",
      "cerrado",
    ]);
  });

  test("perdido y requiere_humano son desvios, no pasos 7 y 8", () => {
    expect(isDetour("perdido")).toBe(true);
    expect(isDetour("requiere_humano")).toBe(true);
    expect(funnelStep("perdido")).toBeNull();
    expect(funnelStep("requiere_humano")).toBeNull();
  });

  test("las 6 del embudo no son desvio y numeran 1..6 en orden", () => {
    expect(FUNNEL_STAGES.map(funnelStep)).toEqual([1, 2, 3, 4, 5, 6]);
    for (const stage of FUNNEL_STAGES) {
      expect(isDetour(stage)).toBe(false);
    }
  });

  test("toda etapa es o paso del embudo o desvio, nunca ambos ni ninguno", () => {
    for (const stage of CURRENT_STAGE) {
      expect(isDetour(stage)).toBe(funnelStep(stage) === null);
    }
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npx vitest run tests/unit/ui/stage.test.ts`
Expected: FAIL — no resuelve `@/lib/ui/stage`.

- [ ] **Step 3: Implementar**

Crear `src/lib/ui/stage.ts`:

```ts
import type { CurrentStage } from "@/types/domain";

/**
 * El embudo son estas 6 etapas y nada más. `perdido` y `requiere_humano` NO
 * son los pasos 7 y 8: son desvíos: la conversación se sale del embudo y el
 * progreso se congela en la última etapa alcanzada. Modelarlos como índices
 * consecutivos propaga el error a la barra de progreso del Twin y al embudo
 * de Métricas.
 */
export const FUNNEL_STAGES = [
  "nuevo",
  "identificando",
  "cotizado",
  "negociando",
  "esperando_pago",
  "cerrado",
] as const satisfies readonly CurrentStage[];

export const FUNNEL_LENGTH = FUNNEL_STAGES.length;

const COLOR: Record<CurrentStage, string> = {
  nuevo: "#38BDF8",
  identificando: "#818CF8",
  cotizado: "#A78BFA",
  negociando: "#FBBF24",
  esperando_pago: "#FB923C",
  cerrado: "#34D399",
  perdido: "#F87171",
  requiere_humano: "#E879F9",
};

const LABEL: Record<CurrentStage, string> = {
  nuevo: "Nuevo",
  identificando: "Identificando",
  cotizado: "Cotizado",
  negociando: "Negociando",
  esperando_pago: "Esperando pago",
  cerrado: "Cerrado",
  perdido: "Perdido",
  requiere_humano: "Requiere humano",
};

/** Alpha 13% del handoff = 0x21 sobre 0xFF. */
const BADGE_ALPHA = "21";

export function stageColor(stage: CurrentStage): string {
  return COLOR[stage];
}

export function stageLabel(stage: CurrentStage): string {
  return LABEL[stage];
}

export function stageBadgeBackground(stage: CurrentStage): string {
  return `${COLOR[stage]}${BADGE_ALPHA}`;
}

export function isDetour(stage: CurrentStage): boolean {
  return !(FUNNEL_STAGES as readonly string[]).includes(stage);
}

/** Posición 1..6 dentro del embudo. `null` en desvíos: no tienen posición. */
export function funnelStep(stage: CurrentStage): number | null {
  const index = (FUNNEL_STAGES as readonly string[]).indexOf(stage);
  return index === -1 ? null : index + 1;
}
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `npx vitest run tests/unit/ui/stage.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ui/stage.ts tests/unit/ui/stage.test.ts
git commit -m "feat(ui): colores de etapa y regla del embudo con desvios"
```

---

## Task 3: `src/lib/ui/canal.ts` y `src/lib/ui/initials.ts`

**Files:**

- Create: `src/lib/ui/canal.ts`, `src/lib/ui/initials.ts`
- Test: `tests/unit/ui/canal.test.ts`, `tests/unit/ui/initials.test.ts`

**Interfaces:**

- Consumes: `Canal` de `@/types/domain`.
- Produces:
  - `canalColor(canal: Canal): string` — hex
  - `canalLabel(canal: Canal): string`
  - `initials(nombre: string): string`

- [ ] **Step 1: Escribir los tests que fallan**

Crear `tests/unit/ui/canal.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { CANAL } from "@/types/domain";
import { canalColor, canalLabel } from "@/lib/ui/canal";

describe("canalColor", () => {
  test("los colores de marca del handoff son exactos", () => {
    expect(canalColor("wa")).toBe("#25D366");
    expect(canalColor("ig")).toBe("#E1306C");
    expect(canalColor("fb")).toBe("#1877F2");
  });

  test("los 3 canales tienen color distinto", () => {
    const colores = CANAL.map(canalColor);
    expect(new Set(colores).size).toBe(CANAL.length);
  });
});

describe("canalLabel", () => {
  test("usa el nombre publico de cada plataforma", () => {
    expect(canalLabel("wa")).toBe("WhatsApp");
    expect(canalLabel("ig")).toBe("Instagram");
    expect(canalLabel("fb")).toBe("Messenger");
  });
});
```

Crear `tests/unit/ui/initials.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { initials } from "@/lib/ui/initials";

describe("initials", () => {
  test("toma primera y ultima palabra", () => {
    expect(initials("Juan Perez")).toBe("JP");
  });

  test("con tres palabras usa primera y ultima, no las dos primeras", () => {
    expect(initials("Maria Jose Garcia")).toBe("MG");
  });

  test("una sola palabra devuelve una sola inicial", () => {
    expect(initials("Juan")).toBe("J");
  });

  test("normaliza a mayuscula", () => {
    expect(initials("juan perez")).toBe("JP");
  });

  test("respeta acentos al pasar a mayuscula", () => {
    expect(initials("angela ruiz")).toBe("AR");
    expect(initials("ángela ruiz")).toBe("ÁR");
  });

  test("tolera espacios de mas", () => {
    expect(initials("  Juan   Perez  ")).toBe("JP");
  });

  test("string vacio o solo espacios devuelve interrogacion", () => {
    expect(initials("")).toBe("?");
    expect(initials("   ")).toBe("?");
  });
});
```

- [ ] **Step 2: Correr los tests para verificar que fallan**

Run: `npx vitest run tests/unit/ui/canal.test.ts tests/unit/ui/initials.test.ts`
Expected: FAIL — no resuelven `@/lib/ui/canal` ni `@/lib/ui/initials`.

- [ ] **Step 3: Implementar**

Crear `src/lib/ui/canal.ts`:

```ts
import type { Canal } from "@/types/domain";

const COLOR: Record<Canal, string> = {
  wa: "#25D366",
  ig: "#E1306C",
  fb: "#1877F2",
};

const LABEL: Record<Canal, string> = {
  wa: "WhatsApp",
  ig: "Instagram",
  fb: "Messenger",
};

export function canalColor(canal: Canal): string {
  return COLOR[canal];
}

export function canalLabel(canal: Canal): string {
  return LABEL[canal];
}
```

Crear `src/lib/ui/initials.ts`:

```ts
/**
 * Iniciales para avatares: primera letra de la primera y de la última palabra.
 * Los nombres de lead llegan del perfil de Meta, así que pueden venir vacíos,
 * con espacios de más o con una sola palabra.
 */
export function initials(nombre: string): string {
  const partes = nombre.trim().split(/\s+/).filter(Boolean);
  const primera = partes.at(0)?.charAt(0) ?? "";
  const ultima = partes.length > 1 ? (partes.at(-1)?.charAt(0) ?? "") : "";
  const resultado = `${primera}${ultima}`.toLocaleUpperCase("es");
  return resultado === "" ? "?" : resultado;
}
```

- [ ] **Step 4: Correr los tests para verificar que pasan**

Run: `npx vitest run tests/unit/ui/canal.test.ts tests/unit/ui/initials.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ui/canal.ts src/lib/ui/initials.ts tests/unit/ui/canal.test.ts tests/unit/ui/initials.test.ts
git commit -m "feat(ui): colores de canal e iniciales de avatar"
```

---

## Task 4: Módulo de íconos

**Files:**

- Create: `src/components/icons.ts`

**Interfaces:**

- Consumes: `lucide-react` 1.14.0.
- Produces: los 30 alias listados abajo, cada uno un `LucideIcon` con props `{ className?, size?, strokeWidth?, "aria-hidden"? }`.

- [ ] **Step 1: Crear el módulo**

Crear `src/components/icons.ts`:

```ts
/**
 * Alias de íconos: nombre del handoff de diseño → componente de lucide-react.
 *
 * El handoff especifica Material Symbols Rounded. No se adopta: traerla desde
 * Google Fonts obligaría a abrir `font-src` y `style-src` en la CSP de
 * `next.config.ts`, que el hardening B3 cerró a propósito. Auto-hospedarla
 * exige subsetear a mano y rehacer el subset con cada ícono nuevo. A wght 300
 * el trazo de ambas familias es muy parecido.
 *
 * Son re-exports nombrados y no un `Record<string, LucideIcon>` porque un mapa
 * indexado por string obliga al bundler a incluir todos los íconos en cada
 * página que importe el módulo. Los re-exports preservan el tree-shaking; el
 * alias conserva la trazabilidad contra el handoff.
 */
export {
  BarChart3 as BarChartIcon,
  Bot as SmartToy,
  Car as DirectionsCar,
  Check as Done,
  CheckCheck as DoneAll,
  CircleAlert as ErrorIcon,
  CircleCheckBig as TaskAlt,
  Clock as Schedule,
  ContactRound as ContactEmergency,
  DatabaseZap as DatabaseSearch,
  Ellipsis as MoreHoriz,
  Hand as PanTool,
  Inbox as InboxIcon,
  LockKeyhole as LockClock,
  LogOut as Logout,
  Package as Inventory2,
  Paperclip as AttachFile,
  Pencil as Edit,
  ReceiptText as ReceiptLong,
  Search as SearchIcon,
  Settings as SettingsIcon,
  Settings2 as SettingsSuggest,
  ShieldCheck as VerifiedUser,
  Sparkles as AutoAwesome,
  Split as AltRoute,
  Tag as Sell,
  TriangleAlert as Warning,
  Users as Group,
  X as Close,
  Zap as Bolt,
} from "lucide-react";
```

> `BarChart3`, `Inbox`, `Search`, `Settings` y `X` colisionan con nombres de dominio o de globals, así que llevan sufijo `Icon` o equivalente. El resto conserva el nombre del handoff en PascalCase.

- [ ] **Step 2: Verificar que los 30 nombres existen en la versión instalada**

Run: `npm run typecheck`
Expected: pasa. Si falla con "has no exported member", ese nombre cambió en lucide — buscar el actual en `node_modules/lucide-react/dist/lucide-react.d.ts` y mantener el alias del handoff.

- [ ] **Step 3: Verificar que lint no marca el módulo como no usado**

Run: `npm run lint`
Expected: pasa sin errores.

- [ ] **Step 4: Commit**

```bash
git add src/components/icons.ts
git commit -m "feat(ui): alias de iconos del handoff sobre lucide-react"
```

---

## Task 5: Primitivas compartidas

**Files:**

- Create: `src/components/shared/StageBadge.tsx`, `src/components/shared/ChannelDot.tsx`, `src/components/shared/InitialsAvatar.tsx`, `src/components/shared/Eyebrow.tsx`, `src/components/shared/MonoMeta.tsx`

**Interfaces:**

- Consumes: `stageColor`, `stageLabel`, `stageBadgeBackground` de `@/lib/ui/stage`; `canalColor`, `canalLabel` de `@/lib/ui/canal`; `initials` de `@/lib/ui/initials`; `cn` de `@/lib/utils`.
- Produces:
  - `<StageBadge stage={CurrentStage} className?={string} />`
  - `<ChannelDot canal={Canal} size?={number} ringColor?={string} className?={string} />`
  - `<InitialsAvatar nombre={string} size?={26|28|36|38} className?={string} />`
  - `<Eyebrow className?={string}>{children}</Eyebrow>`
  - `<MonoMeta className?={string}>{children}</MonoMeta>`

> Estos archivos viven bajo `src/components/shared/**`, que `vitest.config.ts:35` excluye de coverage por política del proyecto (se validan con browser/Playwright, no con RTL). Por eso no llevan tests unitarios: la lógica que sí merece test ya está en `src/lib/ui/`, cubierta en las tareas 2 y 3.

- [ ] **Step 1: Crear `StageBadge`**

```tsx
import { stageBadgeBackground, stageColor, stageLabel } from "@/lib/ui/stage";
import { cn } from "@/lib/utils";
import type { CurrentStage } from "@/types/domain";

/** Color de la etapa sobre ese mismo color al 13% de alpha. */
export function StageBadge({ stage, className }: { stage: CurrentStage; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-[7px] py-[2.5px] text-[10px] font-semibold",
        className,
      )}
      style={{ color: stageColor(stage), backgroundColor: stageBadgeBackground(stage) }}
    >
      {stageLabel(stage)}
    </span>
  );
}
```

- [ ] **Step 2: Crear `ChannelDot`**

```tsx
import { canalColor, canalLabel } from "@/lib/ui/canal";
import { cn } from "@/lib/utils";
import type { Canal } from "@/types/domain";

/**
 * `ringColor` dibuja el borde del color de la superficie de fondo: es lo que
 * despega el punto cuando se superpone a un avatar.
 */
export function ChannelDot({
  canal,
  size = 6,
  ringColor,
  className,
}: {
  canal: Canal;
  size?: number;
  ringColor?: string;
  className?: string;
}) {
  return (
    <span
      role="img"
      aria-label={canalLabel(canal)}
      className={cn("inline-block shrink-0 rounded-full", className)}
      style={{
        width: size,
        height: size,
        backgroundColor: canalColor(canal),
        ...(ringColor ? { border: `2.5px solid ${ringColor}` } : {}),
      }}
    />
  );
}
```

- [ ] **Step 3: Crear `InitialsAvatar`**

```tsx
import { initials } from "@/lib/ui/initials";
import { cn } from "@/lib/utils";

/** Radio y tamaño de fuente por tamaño, según el handoff. */
const ESTILOS = {
  26: { radius: 8, font: 10 },
  28: { radius: 9, font: 10.5 },
  36: { radius: 11, font: 12 },
  38: { radius: 12, font: 12.5 },
} as const;

export type AvatarSize = keyof typeof ESTILOS;

export function InitialsAvatar({
  nombre,
  size = 38,
  className,
}: {
  nombre: string;
  size?: AvatarSize;
  className?: string;
}) {
  const { radius, font } = ESTILOS[size];
  return (
    <span
      aria-hidden
      className={cn(
        "bg-surface-avatar text-ink-secondary inline-flex shrink-0 items-center justify-center font-semibold",
        className,
      )}
      style={{ width: size, height: size, borderRadius: radius, fontSize: font }}
    >
      {initials(nombre)}
    </span>
  );
}
```

- [ ] **Step 4: Crear `Eyebrow` y `MonoMeta`**

`src/components/shared/Eyebrow.tsx`:

```tsx
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

/** Etiqueta de sección: mono 9px uppercase con tracking ancho. */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "text-ink-faint font-mono text-[9px] font-semibold tracking-[0.13em] uppercase",
        className,
      )}
    >
      {children}
    </span>
  );
}
```

`src/components/shared/MonoMeta.tsx`:

```tsx
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

/**
 * Texto mono chico para timestamps, IDs, SKUs y meta técnica. Regla
 * tipográfica del handoff: todo dato que se compara o se escanea va en mono.
 */
export function MonoMeta({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("text-ink-faint font-mono text-[10px]", className)}>{children}</span>;
}
```

- [ ] **Step 5: Verificar**

Run: `npm run typecheck && npm run lint && npm run format:check`
Expected: los tres pasan.

- [ ] **Step 6: Commit**

```bash
git add src/components/shared/StageBadge.tsx src/components/shared/ChannelDot.tsx src/components/shared/InitialsAvatar.tsx src/components/shared/Eyebrow.tsx src/components/shared/MonoMeta.tsx
git commit -m "feat(ui): primitivas compartidas del rediseno"
```

---

## Task 6: SideNav

**Files:**

- Rewrite: `src/components/shared/SideNav.tsx`

**Interfaces:**

- Consumes: alias de `@/components/icons`; `InitialsAvatar` de `@/components/shared/InitialsAvatar`; `LogoutButton` de `@/components/auth/LogoutButton`; `cn` de `@/lib/utils`.
- Produces: `<SideNav user={{ nombre: string; rol: string }} onLogout={() => Promise<ActionResult>} bandejaCount?={number} />`

- [ ] **Step 1: Reescribir el componente**

Reemplazar el contenido completo de `src/components/shared/SideNav.tsx`:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogoutButton } from "@/components/auth/LogoutButton";
import {
  BarChartIcon,
  Group,
  InboxIcon,
  Inventory2,
  SearchIcon,
  Sell,
  SettingsIcon,
  SettingsSuggest,
  SmartToy,
} from "@/components/icons";
import { InitialsAvatar } from "@/components/shared/InitialsAvatar";
import { cn } from "@/lib/utils";
import type { ActionResult } from "@/types/inbox";
import type { ComponentType } from "react";

interface NavItem {
  href: string;
  label: string;
  Icon: ComponentType<{ className?: string; size?: number; strokeWidth?: number }>;
}

// Las rutas NO cambian en este sub-proyecto. El handoff llama "Agente IA" a
// /intents-reglas, pero esa consola no existe hasta el sub-proyecto G: un ítem
// que promete una pantalla inexistente es peor que un label viejo.
const ITEMS: readonly NavItem[] = [
  { href: "/inbox", label: "Bandeja", Icon: InboxIcon },
  { href: "/leads", label: "Leads", Icon: Group },
  { href: "/productos", label: "Productos", Icon: Inventory2 },
  { href: "/intents-reglas", label: "Intents y reglas", Icon: SmartToy },
  { href: "/tags", label: "Tags", Icon: Sell },
  { href: "/metricas", label: "Métricas", Icon: BarChartIcon },
  { href: "/ajustes", label: "Ajustes", Icon: SettingsIcon },
];

export function SideNav({
  user,
  onLogout,
  bandejaCount,
}: {
  user: { nombre: string; rol: string };
  onLogout: () => Promise<ActionResult>;
  bandejaCount?: number;
}) {
  const pathname = usePathname();

  return (
    <aside className="bg-surface-root border-line-layout flex h-full w-[222px] shrink-0 flex-col border-r">
      <div className="flex items-center gap-2.5 px-3.5 py-3.5">
        <span
          className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px]"
          style={{
            background: "linear-gradient(145deg,#FFC46B,#F08A1D)",
            boxShadow: "0 4px 14px rgba(240,138,29,.28)",
          }}
        >
          <SettingsSuggest className="text-brand-ink" size={19} strokeWidth={1.75} />
        </span>
        <span className="min-w-0">
          <span className="text-ink-primary block truncate text-[13.5px] leading-tight font-semibold tracking-[-0.01em]">
            Repuestos
          </span>
          <span className="text-ink-faint block font-mono text-[9.5px] tracking-[0.13em] uppercase">
            CRM · single-org
          </span>
        </span>
      </div>

      {/* Decorativo: el buscador global y su atajo se cablean en el sub-proyecto B,
          que es el que trae la query de conversaciones. */}
      <div className="px-3 pb-2.5">
        <div className="bg-surface-elevated border-line-card flex items-center gap-2 rounded-[9px] border px-2.5 py-[7px]">
          <SearchIcon className="text-ink-ghost shrink-0" size={15} />
          <span className="text-ink-faint flex-1 truncate text-[12px]">Buscar…</span>
          <span className="text-ink-ghost border-line-control rounded-[4px] border px-1 font-mono text-[9.5px]">
            ⌘K
          </span>
        </div>
      </div>

      {/* min-h-0 es obligatorio: sin él, el flex-1 del nav empuja el footer
          fuera del viewport en pantallas bajas. */}
      <nav
        aria-label="Navegación principal"
        className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-3"
      >
        {ITEMS.map(({ href, label, Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex items-center gap-[11px] rounded-[9px] px-2.5 py-2 text-[12.5px] transition-colors",
                active
                  ? "bg-surface-hover text-ink-primary font-semibold"
                  : "text-ink-dim hover:bg-surface-elevated hover:text-ink-primary font-medium",
              )}
            >
              {active ? (
                <span
                  aria-hidden
                  className="bg-brand absolute top-1/2 left-[-10px] h-[18px] w-[2.5px] -translate-y-1/2 rounded-r-[3px]"
                  style={{ boxShadow: "0 0 10px rgba(255,175,58,.7)" }}
                />
              ) : null}
              <Icon className="shrink-0" size={18} strokeWidth={1.5} />
              <span className="flex-1 truncate">{label}</span>
              {/* Decorativo: el contador se alimenta en el sub-proyecto B. */}
              {href === "/inbox" && bandejaCount !== undefined ? (
                <span className="bg-brand text-brand-ink rounded-full px-1.5 py-px font-mono text-[10px] font-semibold">
                  {bandejaCount}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>

      <div className="border-line-layout flex items-center gap-2.5 border-t px-3 py-3">
        <InitialsAvatar nombre={user.nombre} size={26} />
        <span className="min-w-0 flex-1">
          <span className="text-ink-primary block truncate text-[11.5px] font-medium">
            {user.nombre}
          </span>
          <span className="text-ink-faint block truncate text-[10px]">{user.rol}</span>
        </span>
        <LogoutButton onLogout={onLogout} />
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: Adaptar `LogoutButton` a ícono**

En el footer del diseño el logout es un ícono de 17px, no un botón con texto. Reemplazar el contenido de `src/components/auth/LogoutButton.tsx`:

```tsx
"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Logout } from "@/components/icons";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/types/inbox";

export function LogoutButton({ onLogout }: { onLogout: () => Promise<ActionResult> }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Cerrar sesión"
      title="Cerrar sesión"
      disabled={isPending}
      className="text-ink-dim hover:text-ink-primary h-7 w-7 shrink-0"
      onClick={() =>
        startTransition(async () => {
          await onLogout();
          router.push("/login");
          router.refresh();
        })
      }
    >
      <Logout size={17} />
    </Button>
  );
}
```

> Pasa de botón con texto a botón icónico. `aria-label` y `title` mantienen el nombre accesible, que era lo único que aportaba el texto visible.

- [ ] **Step 3: Verificar**

Run: `npm run typecheck && npm run lint`
Expected: pasan. `SideNav` va a dar error de props faltantes en `(panel)/layout.tsx` — se resuelve en la Task 7. Si el typecheck falla **solo** por eso, seguir.

- [ ] **Step 4: Commit**

```bash
git add src/components/shared/SideNav.tsx src/components/auth/LogoutButton.tsx
git commit -m "feat(ui): SideNav del rediseno con logo, buscador y footer"
```

---

## Task 7: Shell del panel

**Files:**

- Modify: `src/app/(panel)/layout.tsx`

**Interfaces:**

- Consumes: `<SideNav user onLogout bandejaCount? />` de la Task 6; `getAuthenticatedUser` de `@/server/auth/supabase-ssr`; `rolFromUser` de `@/server/auth/guards`; `logoutAction` de `./_actions/logout.action`.
- Produces: el shell que envuelve a las 7 pantallas del panel.

- [ ] **Step 1: Reescribir el layout**

Reemplazar el contenido completo de `src/app/(panel)/layout.tsx`:

```tsx
import { SideNav } from "@/components/shared/SideNav";
import { rolFromUser } from "@/server/auth/guards";
import { getAuthenticatedUser } from "@/server/auth/supabase-ssr";
import { logoutAction } from "./_actions/logout.action";

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const user = await getAuthenticatedUser();
  const email = user?.email ?? "";
  const nombre = email.split("@")[0] ?? "Usuario";

  return (
    // overflow-x-auto: por debajo de ~1164px el layout scrollea horizontal en
    // vez de aplastarse. El diseño asume escritorio; no hay layout móvil.
    <div className="bg-surface-root flex h-screen overflow-x-auto overflow-y-hidden">
      <SideNav user={{ nombre, rol: rolFromUser(user) }} onLogout={logoutAction} />
      <main className="flex min-w-0 flex-1 overflow-hidden">{children}</main>
    </div>
  );
}
```

> El logo pasó a la SideNav, así que `next/image` y `/logo.png` ya no se usan acá. `bandejaCount` se omite a propósito: el contador es decorativo hasta el sub-proyecto B.

- [ ] **Step 2: Verificar que compila**

Run: `npm run typecheck && npm run lint && npm run format:check`
Expected: los tres pasan, ahora sí sin errores de props.

- [ ] **Step 3: Verificar en el navegador**

Run: `npm run dev`, entrar en `http://localhost:3001/login` con `admin-dev@crm.local` / `dev-admin-2026!`
Expected: sidebar de 222px con logo ámbar, buscador, 7 ítems, barra ámbar con glow en "Bandeja", footer con avatar de iniciales y botón de logout icónico. Fondo general casi negro.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(panel)/layout.tsx"
git commit -m "feat(ui): shell del panel con sidebar fija de 222px"
```

---

## Task 8: Reemplazar la plantilla de inicio de Next

**Files:**

- Rewrite: `src/app/page.tsx`

**Interfaces:**

- Consumes: `redirect` de `next/navigation`.
- Produces: nada que otras tareas consuman.

- [ ] **Step 1: Reemplazar el archivo**

`src/app/page.tsx` es la plantilla de inicio de Next sin modificar — links a nextjs.org, logos de Vercel, `dark:invert`. Es la raíz del sitio para un usuario autenticado. Reemplazar su contenido completo por:

```tsx
import { redirect } from "next/navigation";

// La raíz no tiene contenido propio: el panel arranca en la bandeja.
// `proxy.ts` ya manda a /login a quien no tenga sesión.
export default function Home() {
  redirect("/inbox");
}
```

- [ ] **Step 2: Verificar**

Run: `npm run typecheck && npm run lint`
Expected: pasan.

Con `npm run dev` corriendo y sesión iniciada, abrir `http://localhost:3001/`
Expected: redirige a `/inbox`. Sin sesión, redirige a `/login`.

- [ ] **Step 3: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat(ui): la raiz redirige a la bandeja"
```

---

## Task 9: Verificación completa

**Files:** ninguno — solo verificación.

**Interfaces:**

- Consumes: todo lo anterior.
- Produces: la evidencia que exige el criterio de aceptación del spec §12.

- [ ] **Step 1: CI completa**

Run: `npm run ci`
Expected: typecheck, lint, format:check y coverage pasan. Coverage por encima de 80/75/80/80. El total de tests sube en 21 respecto de la línea base de 758 (11 de `stage`, 3 de `canal`, 7 de `initials`), quedando en 779.

- [ ] **Step 2: Recorrida de las 7 pantallas**

Con `npm run dev` y sesión de `admin-dev@crm.local`, abrir cada una y contrastar contra `CRM Repuestos v2.dc.html`:

| Ruta                             | Qué mirar                                                                                                                                            |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/login`                         | Fuera del grupo `(panel)`: no hereda el shell, es la ruta mas facil de olvidar. Formulario, inputs y boton legibles                                  |
| `/inbox`                         | Lista legible sobre fondo oscuro; sin texto negro sobre negro                                                                                        |
| `/inbox/[leadId]`                | Burbujas y panel del twin legibles                                                                                                                   |
| `/leads`                         | **Tabla**: encabezados, filas y hover con contraste suficiente                                                                                       |
| `/leads/[id]`                    | Ficha, secciones y **diálogos de merge de la fase 10** — abrir el de confirmar merge y verificar que el `Dialog` de shadcn tomó la superficie oscura |
| `/productos`                     | **Tabla** e inputs de búsqueda                                                                                                                       |
| `/productos/import`              | Formulario de subida y estados de error                                                                                                              |
| `/metricas`, `/tags`, `/ajustes` | Stubs — que no queden en blanco sobre blanco                                                                                                         |

Este paso es criterio de aceptación, no una cortesía: el riesgo real de esta tarea no es que la SideNav quede mal, sino romper contraste en pantallas que nadie está mirando durante el trabajo.

- [ ] **Step 3: Anotar y corregir lo que aparezca**

Cualquier componente ilegible se corrige **componiendo** (clases en el sitio de uso o un wrapper en `src/components/shared/`), nunca editando `src/components/ui/**`. Si un arreglo parece exigir tocar shadcn, es señal de que falta un token en `globals.css`: agregarlo ahí.

- [ ] **Step 4: Actualizar el estado del proyecto**

En `AGENTS.md` §2, actualizar "Última acción completada" y la tabla de progreso con el sub-proyecto A completo. En el spec `2026-08-07-rediseno-a-base-visual-design.md`, cambiar el encabezado de estado a `implementado`.

- [ ] **Step 5: Commit final**

```bash
git add AGENTS.md docs/superpowers/specs/2026-08-07-rediseno-a-base-visual-design.md
git commit -m "docs(ui): cierra sub-proyecto A del rediseno"
```

---

## Cobertura del spec

| Sección del spec                        | Tarea                                                                                              |
| --------------------------------------- | -------------------------------------------------------------------------------------------------- |
| §3.1 tokens semánticos de shadcn        | Task 1                                                                                             |
| §3.2 tokens propios                     | Task 1 (superficies/líneas/texto/marca/semánticos) · Tasks 2-3 (etapas/canales, ver desvío arriba) |
| §3.3 hex, no oklch                      | Task 1                                                                                             |
| §3.4 keyframes, scrollbars, `text-wrap` | Task 1                                                                                             |
| §4 modo oscuro                          | Task 1                                                                                             |
| §5 íconos                               | Task 4                                                                                             |
| §6 lógica pura                          | Tasks 2, 3                                                                                         |
| §7 primitivas                           | Task 5                                                                                             |
| §8 SideNav                              | Task 6                                                                                             |
| §8.1 elementos decorativos declarados   | Task 6 (comentarios en buscador y contador)                                                        |
| §9 shell                                | Task 7                                                                                             |
| §10 limpieza                            | Task 8                                                                                             |
| §11 verificación                        | Task 9                                                                                             |
| §12 criterios de aceptación             | Task 9                                                                                             |
