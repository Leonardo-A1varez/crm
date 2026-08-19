# Tema claro/oscuro + rebrand a rojo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convertir la única paleta existente (oscura, hardcodeada) en dos temas conmutables por el usuario, y reemplazar el ámbar de marca por rojo.

**Architecture:** Los ~35 tokens custom de `@theme inline` en `globals.css` hoy tienen **valores hex literales**, no `var()`. Un token literal dentro de `@theme inline` es estático: ninguna clase (`.dark`) puede cambiarlo. Se convierten al patrón de indirección que shadcn ya usa en ese mismo archivo (`--color-x: var(--x)` en `@theme inline`, y `--x: <hex>` en `:root` y `.dark`). Encima de eso, `next-themes` (ya instalado) alterna la clase `dark` en `<html>`.

**Tech Stack:** Tailwind v4 (`@theme inline`, `@custom-variant`), `next-themes@0.4.6`, Next.js App Router, shadcn/ui, lucide-react.

## Global Constraints

- **Rojo de marca, mismo hex en los dos temas:** `--brand: #d61f1f` · `--brand-hover: #ff5c5c` · `--brand-deep: #b71414` · `--brand-ink: #fff5f4`.
- **Valores oscuros existentes no se retocan.** Se mueven tal cual de `@theme inline` a `.dark`. Cualquier cambio de valor oscuro que no esté en la tabla de la §4 del spec es un error.
- **Default oscuro.** `defaultTheme="dark"`, `enableSystem={false}`. El toggle es explícito, no sigue el SO.
- Comentarios/UI/commits en español. Identificadores genéricos en inglés.
- `console.log` prohibido en `src/**`.
- No agregar dependencias — `next-themes@^0.4.6` ya está en `package.json` y en `node_modules`.
- Spec de referencia: `docs/superpowers/specs/2026-08-17-tema-claro-oscuro-rojo-design.md`.
- Logo **fuera de alcance** — no tocar `SideNav`'s brand mark ni `public/branding/`.

---

## File Structure

**Modificado:**

- `src/app/globals.css` — los 35 tokens custom pasan a indirección; `:root` gana la paleta clara; `.dark` gana la oscura; shadcn genéricos se alinean al rojo.
- `src/app/layout.tsx` — saca `dark` hardcodeado, agrega `suppressHydrationWarning` y envuelve en `ThemeProvider`.
- `src/components/icons.ts` — alias `Sun`/`Moon`.
- `src/components/shared/SideNav.tsx` — monta `ThemeToggle` en el pie.

**Nuevo:**

- `src/components/shared/ThemeProvider.tsx` — wrapper cliente de `next-themes`.
- `src/components/shared/ThemeToggle.tsx` — botón sol/luna.

---

## Task 1: Tokens custom con indirección + paleta clara

**Files:**

- Modify: `src/app/globals.css`

**Interfaces:**

- Produces: variables CSS `--surface-*`, `--line-*`, `--ink-*`, `--brand*`, `--ok/warn/caution/danger/info/special`, `--surface-glow`, `--surface-warm`, `--ink-warm`, `--ink-warm-dim` definidas en `:root` (claro) y `.dark` (oscuro). Las utilidades Tailwind (`bg-surface-card`, `text-ink-primary`, `bg-brand`, …) siguen existiendo con los mismos nombres — ningún componente cambia.

- [ ] **Step 1: Reemplazar el bloque de tokens custom dentro de `@theme inline`**

En `src/app/globals.css`, reemplazar las líneas 14–71 (desde el comentario `/* Rediseño "sala de control" …` hasta `--color-special: #e879f9;` inclusive) por:

```css
/* Rediseño "sala de control" — tokens que shadcn no tiene.
     Indirección `var()` y no hex literal: un valor literal acá es estático y
     ninguna clase puede cambiarlo, así que el tema claro sería imposible. Los
     hex viven en `:root` (claro) y `.dark` (oscuro), igual que los de shadcn. */
--color-surface-root: var(--surface-root);
--color-surface-panel: var(--surface-panel);
--color-surface-chat: var(--surface-chat);
--color-surface-card: var(--surface-card);
--color-surface-elevated: var(--surface-elevated);
--color-surface-input: var(--surface-input);
--color-surface-hover: var(--surface-hover);
--color-surface-avatar: var(--surface-avatar);
--color-surface-bubble-in: var(--surface-bubble-in);
--color-surface-bubble-vend: var(--surface-bubble-vend);

--color-line-layout: var(--line-layout);
--color-line-card: var(--line-card);
--color-line-input: var(--line-input);
--color-line-control: var(--line-control);
/* Separador entre filas de una tabla o lista. Coincide en valor con
     `surface-input`, pero se declara aparte porque es una línea y no una
     superficie: usar el de superficie hacía que el rol no se leyera. */
--color-line-row: var(--line-row);
/* Separador `·` de las líneas de meta: más apagado que cualquier `ink-*`
     porque no es texto, es puntuación entre datos. */
--color-line-dot: var(--line-dot);

--color-ink-primary: var(--ink-primary);
--color-ink-body: var(--ink-body);
--color-ink-secondary: var(--ink-secondary);
--color-ink-muted: var(--ink-muted);
--color-ink-dim: var(--ink-dim);
--color-ink-faint: var(--ink-faint);
--color-ink-fainter: var(--ink-fainter);
--color-ink-ghost: var(--ink-ghost);

--color-brand: var(--brand);
--color-brand-hover: var(--brand-hover);
--color-brand-deep: var(--brand-deep);
--color-brand-ink: var(--brand-ink);
/* Blanco cálido de la respuesta en el bloque ENTONCES de una regla: es texto
     sobre fondo de marca, y los `ink-*` están calibrados contra el fondo. */
--color-ink-warm: var(--ink-warm);
/* Primer stop del gradiente de las tarjetas destacadas; el segundo es
     `surface-card`. No es una superficie plana, por eso no entra en esa escala. */
--color-surface-glow: var(--surface-glow);
/* Fondo de los bloques de aviso (ventana cerrada, cotización). Es el par de
     `ink-warm`, no una variante de `surface-*`. */
--color-surface-warm: var(--surface-warm);
/* Texto sobre el bloque de bloqueador: cálido y atenuado a la vez, cosa que
     ni `ink-warm` ni la escala `ink-*` cubren. */
--color-ink-warm-dim: var(--ink-warm-dim);

--color-ok: var(--ok);
--color-warn: var(--warn);
--color-caution: var(--caution);
--color-danger: var(--danger);
--color-info: var(--info);
--color-special: var(--special);
```

- [ ] **Step 2: Reemplazar el bloque `:root` entero (líneas 114–147) por la paleta clara**

```css
:root {
  /* Paleta clara. Los `ok/warn/...` no son los mismos tintes que en oscuro:
     los del oscuro están calibrados contra un fondo casi negro y sobre blanco
     no llegan a 4.5:1, así que acá se oscurecen manteniendo el matiz. */
  --surface-root: #f6f7f8;
  --surface-panel: #ffffff;
  --surface-chat: #f9fafb;
  --surface-card: #ffffff;
  --surface-elevated: #ffffff;
  --surface-input: #f1f2f4;
  --surface-hover: #eceef1;
  --surface-avatar: #e4e6ea;
  --surface-bubble-in: #eef0f2;
  --surface-bubble-vend: #20242c;

  --line-layout: #e6e8eb;
  --line-card: #dfe2e6;
  --line-input: #d5d9df;
  --line-control: #cdd2d9;
  --line-row: #eceef1;
  --line-dot: #b8bec7;

  --ink-primary: #14161b;
  --ink-body: #1c1f26;
  --ink-secondary: #383d47;
  --ink-muted: #565c68;
  --ink-dim: #6b7280;
  --ink-faint: #757b87;
  --ink-fainter: #8b909a;
  --ink-ghost: #9aa0ab;

  /* La marca no se invierte: mismo rojo en los dos temas. */
  --brand: #d61f1f;
  --brand-hover: #ff5c5c;
  --brand-deep: #b71414;
  --brand-ink: #fff5f4;
  --ink-warm: #f2ede4;
  --surface-glow: #fff0ee;
  --surface-warm: #fdf1f0;
  --ink-warm-dim: #6b2a26;

  --ok: #0f8f61;
  --warn: #c2540f;
  --caution: #a16207;
  --danger: #dc2626;
  --info: #2563a8;
  --special: #a21caf;

  /* shadcn genéricos, alineados a los tokens de arriba. */
  --background: #f6f7f8;
  --foreground: #14161b;
  --card: #ffffff;
  --card-foreground: #14161b;
  --popover: #ffffff;
  --popover-foreground: #14161b;
  --primary: #d61f1f;
  --primary-foreground: #fff5f4;
  --secondary: #f1f2f4;
  --secondary-foreground: #14161b;
  --muted: #eceef1;
  --muted-foreground: #6b7280;
  --accent: #eceef1;
  --accent-foreground: #14161b;
  --destructive: #dc2626;
  --border: #dfe2e6;
  --input: #d5d9df;
  --ring: #d61f1f;
  --chart-1: #d61f1f;
  --chart-2: #2563a8;
  --chart-3: #0f8f61;
  --chart-4: #a21caf;
  --chart-5: #c2540f;
  --radius: 0.5625rem;
  --sidebar: #f6f7f8;
  --sidebar-foreground: #14161b;
  --sidebar-primary: #d61f1f;
  --sidebar-primary-foreground: #fff5f4;
  --sidebar-accent: #eceef1;
  --sidebar-accent-foreground: #14161b;
  --sidebar-border: #e6e8eb;
  --sidebar-ring: #d61f1f;
}
```

- [ ] **Step 3: Reemplazar el bloque `.dark` entero (líneas 149–182) por la paleta oscura**

Los `surface/line/ink` son **exactamente** los valores que hoy están en `@theme inline` — se mueven, no se cambian. Lo único que cambia de valor es la familia `brand*` (ámbar → rojo) y los shadcn que la referencian.

```css
.dark {
  --surface-root: #08090b;
  --surface-panel: #0a0b0e;
  --surface-chat: #0d0e12;
  --surface-card: #0f1116;
  --surface-elevated: #101218;
  --surface-input: #14161b;
  --surface-hover: #15181e;
  --surface-avatar: #1a1d24;
  --surface-bubble-in: #191c22;
  --surface-bubble-vend: #e8eaee;

  --line-layout: #17191f;
  --line-card: #1c1f26;
  --line-input: #21242c;
  --line-control: #23262d;
  --line-row: #14161b;
  --line-dot: #2c3038;

  --ink-primary: #ecedef;
  --ink-body: #e4e6ea;
  --ink-secondary: #c8ccd3;
  --ink-muted: #a9aeb7;
  --ink-dim: #8b909a;
  --ink-faint: #7c838e;
  --ink-fainter: #6e7580;
  --ink-ghost: #5f6672;

  --brand: #d61f1f;
  --brand-hover: #ff5c5c;
  --brand-deep: #b71414;
  --brand-ink: #fff5f4;
  --ink-warm: #f2ede4;
  --surface-glow: #151116;
  --surface-warm: #141116;
  --ink-warm-dim: #e4d9cb;

  --ok: #34d399;
  --warn: #fb923c;
  --caution: #fbbf24;
  --danger: #f87171;
  --info: #7fb3f5;
  --special: #e879f9;

  --background: #08090b;
  --foreground: #ecedef;
  --card: #0f1116;
  --card-foreground: #ecedef;
  --popover: #0f1116;
  --popover-foreground: #ecedef;
  --primary: #d61f1f;
  --primary-foreground: #fff5f4;
  --secondary: #14161b;
  --secondary-foreground: #ecedef;
  --muted: #101218;
  --muted-foreground: #8b909a;
  --accent: #15181e;
  --accent-foreground: #ecedef;
  --destructive: #f87171;
  --border: #1c1f26;
  --input: #21242c;
  --ring: #d61f1f;
  --chart-1: #d61f1f;
  --chart-2: #7fb3f5;
  --chart-3: #34d399;
  --chart-4: #e879f9;
  --chart-5: #fb923c;
  --radius: 0.5625rem;
  --sidebar: #08090b;
  --sidebar-foreground: #ecedef;
  --sidebar-primary: #d61f1f;
  --sidebar-primary-foreground: #fff5f4;
  --sidebar-accent: #15181e;
  --sidebar-accent-foreground: #ecedef;
  --sidebar-border: #17191f;
  --sidebar-ring: #d61f1f;
}
```

- [ ] **Step 4: Arreglar el hover del scrollbar, que tiene un gris oscuro hardcodeado**

Al final del archivo, en el segundo `@layer base`, la regla `::-webkit-scrollbar-thumb:hover` usa `background: #343841` — un gris que solo se ve sobre fondo oscuro. Reemplazar esa declaración por el token:

```css
::-webkit-scrollbar-thumb:hover {
  background: var(--color-line-dot);
  border: 2px solid transparent;
  background-clip: content-box;
}
```

- [ ] **Step 5: Verificar que no quedó ningún token custom con hex literal en `@theme inline`**

```bash
sed -n '7,112p' src/app/globals.css | grep -n "#[0-9a-fA-F]\{6\}"
```

Expected: sin resultados. Si aparece alguna línea, es un token que quedó sin convertir a `var()`.

- [ ] **Step 6: Verificar que el build de CSS no rompió nada**

```bash
npm run typecheck && npm run lint
```

Expected: 0 errores en ambos.

- [ ] **Step 7: Commit**

```bash
git add src/app/globals.css
git commit -m "feat(tema): tokens con indireccion, paleta clara y rojo de marca"
```

---

## Task 2: `ThemeProvider` + wiring en el layout raíz

**Files:**

- Create: `src/components/shared/ThemeProvider.tsx`
- Modify: `src/app/layout.tsx`

**Interfaces:**

- Consumes: los tokens de Task 1 (la clase `.dark` ya tiene qué aplicar).
- Produces: `<ThemeProvider>{children}</ThemeProvider>` — contexto de `next-themes` disponible en todo el árbol; `useTheme()` funciona en cualquier componente cliente.

- [ ] **Step 1: Crear `src/components/shared/ThemeProvider.tsx`**

```tsx
"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * Contexto de tema para toda la app.
 *
 * `attribute="class"` porque `globals.css` discrimina con
 * `@custom-variant dark (&:is(.dark *))`, que es una clase y no un atributo.
 *
 * `enableSystem={false}` es deliberado: el panel nació oscuro y esa sigue
 * siendo la cara por defecto del producto. Seguir al sistema operativo le
 * cambiaría el tema a quien nunca lo pidió.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem={false}
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
```

- [ ] **Step 2: Modificar `src/app/layout.tsx`**

Reemplazar el cuerpo del componente `RootLayout` (líneas 21–37) por:

```tsx
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // suppressHydrationWarning: la clase de tema la escribe un script inline de
    // next-themes antes de que React hidrate, así que el HTML del server y el
    // del cliente difieren en `class` a propósito. Sin esto, React avisa de un
    // mismatch que no es un bug.
    <html
      lang="es"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <ThemeProvider>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
```

Y agregar el import junto a los demás de `@/components`:

```tsx
import { ThemeProvider } from "@/components/shared/ThemeProvider";
```

- [ ] **Step 3: Verificar que la clase `dark` ya no está hardcodeada**

```bash
grep -n "dark" src/app/layout.tsx
```

Expected: sin resultados (el `className` ya no la lleva y no hay otra mención).

- [ ] **Step 4: Verificar typecheck y lint**

```bash
npm run typecheck && npm run lint
```

Expected: 0 errores.

- [ ] **Step 5: Commit**

```bash
git add src/components/shared/ThemeProvider.tsx src/app/layout.tsx
git commit -m "feat(tema): ThemeProvider de next-themes en el layout raiz"
```

---

## Task 3: `ThemeToggle` en el pie del sidebar

**Files:**

- Modify: `src/components/icons.ts`
- Create: `src/components/shared/ThemeToggle.tsx`
- Modify: `src/components/shared/SideNav.tsx`

**Interfaces:**

- Consumes: `ThemeProvider` (Task 2) — sin él `useTheme()` devuelve un contexto vacío.
- Produces: `<ThemeToggle />` — componente sin props, se monta donde haga falta.

- [ ] **Step 1: Agregar los alias de íconos en `src/components/icons.ts`**

Dentro del bloque `export { ... } from "lucide-react";`, agregar dos líneas manteniendo el orden alfabético por nombre de lucide (`Moon` va después de `Minus`, `Sun` después de `SlidersHorizontal`):

```ts
  Moon as DarkMode,
```

```ts
  Sun as LightMode,
```

- [ ] **Step 2: Crear `src/components/shared/ThemeToggle.tsx`**

```tsx
"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { DarkMode, LightMode } from "@/components/icons";
import { Button } from "@/components/ui/button";

/**
 * Alterna claro/oscuro. Vive en el pie del SideNav, al lado del logout.
 *
 * El `montado` no es ceremonia: en el render del server no existe `document`,
 * así que `resolvedTheme` viene `undefined` y pintar un ícono ahí adivina el
 * tema. Adivinar mal muestra el sol cuando corresponde la luna hasta que
 * hidrata. Se reserva el espacio y el ícono aparece cuando el dato es real.
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [montado, setMontado] = useState(false);

  useEffect(() => setMontado(true), []);

  const esOscuro = resolvedTheme === "dark";

  if (!montado) {
    return <span aria-hidden className="h-7 w-7 shrink-0" />;
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={esOscuro ? "Cambiar a tema claro" : "Cambiar a tema oscuro"}
      title={esOscuro ? "Tema claro" : "Tema oscuro"}
      className="text-ink-dim hover:text-ink-primary h-7 w-7 shrink-0"
      onClick={() => setTheme(esOscuro ? "light" : "dark")}
    >
      {esOscuro ? <LightMode size={16} /> : <DarkMode size={16} />}
    </Button>
  );
}
```

- [ ] **Step 3: Montar el toggle en `src/components/shared/SideNav.tsx`**

En el `<div>` del pie (el que tiene `border-line-layout flex items-center gap-2.5 border-t px-3 py-3`, líneas 117–126), insertar `<ThemeToggle />` justo antes de `<LogoutButton .../>`:

```tsx
        <ThemeToggle />
        <LogoutButton onLogout={onLogout} />
```

Y agregar el import junto a los otros de `@/components`:

```tsx
import { ThemeToggle } from "@/components/shared/ThemeToggle";
```

- [ ] **Step 4: Verificar typecheck, lint y la suite completa**

```bash
npm run typecheck && npm run lint && npm run test
```

Expected: 0 errores de typecheck, 0 de lint, y la suite en su número actual (1832/1832 al momento de escribir este plan — reportar el número real). Esta tarea no agrega tests: es un componente de presentación sin lógica de negocio, y el proyecto no tiene tests de UI (política browser/E2E, ver `AGENTS.md`).

- [ ] **Step 5: Commit**

```bash
git add src/components/icons.ts src/components/shared/ThemeToggle.tsx src/components/shared/SideNav.tsx
git commit -m "feat(tema): boton para alternar claro y oscuro en el sidebar"
```

---

## Task 4: Verificación visual de las dos paletas

**Files:** ninguno — solo navegación y comandos. Si aparece un defecto, se arregla acá y se commitea.

**Interfaces:**

- Consumes: todo lo anterior.

- [ ] **Step 1: Levantar el dev server**

```bash
npm run dev
```

Queda en `http://localhost:3001`. **No correr `npm run build` con el dev server levantado** — corrompe `.next/` (AGENTS.md, lección 4).

- [ ] **Step 2: Confirmar que arranca en oscuro y que el toggle funciona**

Navegar a `http://localhost:3001/metricas`. El panel tiene que verse oscuro (igual que antes de este trabajo, salvo que todo lo que era ámbar ahora es rojo). Clickear el botón sol del pie del sidebar: la pantalla pasa a clara. Clickear de nuevo: vuelve a oscura. Recargar la página con el tema claro activo: tiene que seguir claro y **sin parpadeo** de oscuro al cargar.

- [ ] **Step 3: Recorrer las pantallas en los dos temas**

Con cada tema activo, visitar: `/inbox`, `/leads`, `/productos`, `/agente`, `/metricas`, `/ajustes`. Buscar específicamente:

- Texto que no se lee (gris claro sobre blanco, o gris oscuro sobre negro).
- Bordes invisibles.
- Cualquier resto de ámbar (`#ffaf3a`, `#ffc46b`, `#f08a1d`) — si aparece, es un hex hardcodeado en un componente que hay que pasar al token.

- [ ] **Step 4: Buscar hex de marca hardcodeados fuera de `globals.css`**

```bash
grep -rn "ffaf3a\|ffc46b\|f08a1d\|231602" src/ --include=*.tsx --include=*.ts
```

Expected: sin resultados. Si aparece alguno, reemplazarlo por el token correspondiente (`var(--color-brand)`, `var(--color-brand-hover)`, `var(--color-brand-deep)`, `text-brand-ink`) y volver al Step 3.

- [ ] **Step 5: Capturar el estado y reportar lo no verificado**

Este proyecto arrastra una limitación conocida: el panel del navegador no compone frames y las capturas fallan (AGENTS.md, lección 6). Si las capturas no salen, decirlo explícitamente en el reporte en vez de afirmar una verificación visual que no ocurrió. Lo que sí se puede afirmar es lo que se leyó del DOM/HTML.

- [ ] **Step 6: Commit de cualquier arreglo que haya salido de la revisión**

```bash
git status --short
```

Si hay cambios, commitearlos con rutas explícitas (nunca `git add -A`) y un mensaje que diga qué defecto visual se arregló. Si no hay cambios, este paso no produce commit.

---

## Self-Review

**Cobertura del spec:**

- §3 (mecanismo del toggle: `next-themes`, `attribute="class"`, `defaultTheme="dark"`, `enableSystem={false}`, `suppressHydrationWarning`, `ThemeToggle` en `SideNav`) → Tasks 2 y 3.
- §4 (paleta clara token por token: superficies, líneas, ink, marca, estados, tokens de aviso, shadcn genéricos) → Task 1, Steps 2 y 3. Las cuatro tablas del spec están transcritas completas.
- §5 (fuera de alcance: logo, Inbox a fondo) → respetado; ninguna tarea toca `public/branding/` ni la marca del `SideNav`.
- §6 (verificación visual, sin TDD por no haber lógica de negocio) → Task 4, y el Step 4 de la Task 3 corre la suite igual.

**Hallazgo que el spec no anticipaba, resuelto en el plan:** el spec decía "los tokens pasan a vivir en dos bloques", pero no que hoy son **hex literales dentro de `@theme inline`** — un token literal ahí es estático y ninguna clase puede cambiarlo. Sin el paso de indirección (`--color-x: var(--x)`) el tema claro no funcionaría aunque `:root` y `.dark` estuvieran perfectos. Es la Task 1, Step 1.

**Segundo hallazgo:** `::-webkit-scrollbar-thumb:hover` tiene `#343841` hardcodeado, invisible en claro. Cubierto en Task 1, Step 4.

**Placeholders:** ninguno — cada step tiene el CSS/TSX completo o un comando exacto.

**Consistencia de nombres:** `ThemeProvider` y `ThemeToggle` se definen en Tasks 2 y 3 y se consumen con esos mismos nombres; los alias `LightMode`/`DarkMode` se declaran en Task 3 Step 1 y se usan en Step 2; los nombres de variable CSS (`--surface-root`, `--brand`, …) coinciden entre los Steps 1, 2 y 3 de la Task 1.
