# Rediseño B — Bandeja unificada: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unificar `/inbox` y `/inbox/[leadId]` en un layout de 3 paneles fijos —lista 322px, conversación flex, Twin 322px— y llevar los tres al lenguaje visual del handoff.

**Architecture:** Un `layout.tsx` compartido aloja el panel de lista; `page.tsx` y `[leadId]/page.tsx` son sus hijos. Next preserva el layout entre rutas hermanas, así que seleccionar una conversación actualiza los paneles 2 y 3 sin remontar la lista, con routing normal y sin estado en cliente. Los componentes de `src/components/inbox/` ya existen: esta tarea los reviste, no los reescribe.

**Tech Stack:** Next.js 16.2.6 App Router, React 19, Tailwind v4, shadcn, TypeScript strict.

**Spec:** `docs/superpowers/specs/2026-08-09-rediseno-b-bandeja-design.md`

## Global Constraints

- **Idioma:** UI, comentarios y commits en **español**. Conventional Commits, subject ≤72 chars, sin emojis.
- **Sin comentarios obvios** — solo el "por qué" no evidente.
- **Sin deps nuevas.** No `any`. TypeScript `strict` + `noUncheckedIndexedAccess`.
- **No tocar `src/components/ui/**`\*\* (shadcn vendorizado) — extender por composición.
- **CERO cambios** en repositorios, servicios, Server Actions y migraciones. Si algo parece necesitarlo, pertenece a C, D o E: parar y reportar.
- **Tokens del sub-proyecto A**: `bg-surface-*`, `text-ink-*`, `border-line-*`, `bg-brand`, `text-brand-ink`, `animate-pulse-dot`. Colores de etapa y canal desde `src/lib/ui/`. Primitivas desde `src/components/shared/`. Íconos desde `@/components/icons`. **Nunca hardcodear hex** — todo token que se necesita ya existe.
- **Sin tests unitarios**: `src/components/**` y `src/app/**` están excluidos de coverage por política del proyecto. Se validan en navegador.
- **Verificación entre tareas:** `npm run ci`.

### La regla que gobierna este plan

**Toda tarea de layout se verifica midiendo en el navegador, no leyendo el diff.** Los dos defectos de plan del sub-proyecto A cayeron en layout y los encontró un revisor midiendo anchos; el bug de G1 lo encontró alguien clickeando. Un diff que se lee correcto no prueba nada acá.

---

## Estructura de archivos

| Archivo                                       | Responsabilidad                                    |
| --------------------------------------------- | -------------------------------------------------- |
| `src/app/(panel)/inbox/layout.tsx`            | **Crear.** Shell de 3 paneles + panel de lista     |
| `src/app/(panel)/inbox/page.tsx`              | **Reescribir.** Estado vacío                       |
| `src/app/(panel)/inbox/[leadId]/page.tsx`     | **Modificar.** Deja de ser pantalla completa       |
| `src/components/inbox/PanelLista.tsx`         | **Crear.** Encabezado + filtros + lista            |
| `src/components/inbox/FiltrosCanal.tsx`       | **Crear.** Chips de canal (client)                 |
| `src/components/inbox/InboxListItem.tsx`      | **Reescribir.** Fila al diseño                     |
| `src/components/inbox/ConversationHeader.tsx` | **Modificar.** Header al diseño                    |
| `src/components/inbox/HandoffToggle.tsx`      | **Modificar.** Toggle IA al diseño                 |
| `src/components/inbox/ChatThread.tsx`         | **Modificar.** `column-reverse` + patrón de puntos |
| `src/components/inbox/MessageBubble.tsx`      | **Reescribir.** Las 4 burbujas                     |
| `src/components/inbox/MessageInput.tsx`       | **Modificar.** Composer al diseño                  |
| `src/components/lead-twin/TwinPanel.tsx`      | **Modificar.** Revestido + rail del embudo         |

---

## Task 1: Shell de 3 paneles

El cambio estructural. Todo lo demás es revestimiento.

**Files:**

- Create: `src/app/(panel)/inbox/layout.tsx`
- Rewrite: `src/app/(panel)/inbox/page.tsx`
- Modify: `src/app/(panel)/inbox/[leadId]/page.tsx`

**Interfaces:**

- Consumes: `getInboxServiceForRequest` de `@/server/bootstrap/inbox-bootstrap`, `InboxItem` de `@/types/inbox`.
- Produces: el shell que alojan `page.tsx` y `[leadId]/page.tsx`.

- [ ] **Step 1: Leer antes de tocar**

Leer los tres archivos actuales completos. `[leadId]/page.tsx` ya tiene conversación + Twin dentro de un `flex h-screen flex-col`; hay que sacarle esa envoltura de pantalla completa porque ahora vive dentro del layout.

- [ ] **Step 2: Crear el layout**

```tsx
import { PanelLista } from "@/components/inbox/PanelLista";
import { RefreshPoller } from "@/components/shared/RefreshPoller";
import { getInboxServiceForRequest } from "@/server/bootstrap/inbox-bootstrap";

export const dynamic = "force-dynamic";

/**
 * Shell de 3 paneles. La lista vive acá y no en las páginas porque Next
 * preserva el layout al navegar entre rutas hermanas: seleccionar una
 * conversación actualiza los paneles 2 y 3 sin remontar la lista ni perder su
 * scroll. Es lo que el handoff pide ("seleccionar no navega") logrado con
 * routing normal, sin estado en cliente y sin romper el deep-linking.
 */
export default async function InboxLayout({ children }: { children: React.ReactNode }) {
  const svc = await getInboxServiceForRequest();
  const items = await svc.listActiveLeads();

  return (
    <div className="flex h-full min-w-[1164px] flex-1 overflow-hidden">
      <PanelLista items={items} />
      <div className="flex min-w-[520px] flex-1 overflow-hidden">{children}</div>
      <RefreshPoller intervalMs={5000} />
    </div>
  );
}
```

> El poller se mueve acá desde las páginas: uno solo para todo el shell en vez de uno por ruta.

- [ ] **Step 3: Estado vacío**

`page.tsx` completo:

```tsx
import { EmptyState } from "@/components/shared/EmptyState";

export default function InboxPage() {
  return (
    <div className="bg-surface-chat flex flex-1 items-center justify-center">
      <EmptyState
        title="Elegí una conversación"
        description="Seleccioná una de la lista para ver el hilo y la ficha del lead."
      />
    </div>
  );
}
```

- [ ] **Step 4: Adaptar la página de conversación**

En `[leadId]/page.tsx`: quitar el `<div className="flex h-screen flex-col">` exterior y el `<RefreshPoller>` (ahora viven en el layout). El contenido pasa a ser directamente el header + el `flex` con conversación y Twin, dentro de un contenedor `flex flex-1 flex-col overflow-hidden`.

El `<aside>` del Twin: cambiar `w-80` por `w-[322px]`, y `border-border` por `border-line-layout`. Quitar `max-lg:hidden` — el layout ya scrollea horizontal por debajo de 1164px, ocultar el panel duplicaría la estrategia.

- [ ] **Step 5: Verificar en navegador, midiendo**

`npm run dev`, entrar con `admin-dev@crm.local` / `dev-admin-2026!`, viewport 1440×900.

Medir con `getComputedStyle` o el inspector y reportar los números:

1. En `/inbox`: la lista mide **322px** y el resto muestra el estado vacío.
2. Click en una conversación: la URL pasa a `/inbox/<uuid>` y aparecen los 3 paneles.
3. **Scrollear la lista, seleccionar otra conversación, y confirmar que el scroll se mantiene.** Es la prueba de que el layout no se remonta — el objetivo entero de la tarea.
4. Entrar directo por URL a `/inbox/<uuid>`: los 3 paneles igual.
5. Ningún panel recortado, sin scroll horizontal a 1440px.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(panel)/inbox/"
git commit -m "feat(inbox): shell de 3 paneles con lista en el layout"
```

---

## Task 2: Panel de lista

**Files:**

- Create: `src/components/inbox/PanelLista.tsx`, `src/components/inbox/FiltrosCanal.tsx`
- Rewrite: `src/components/inbox/InboxListItem.tsx`
- Delete: `src/components/inbox/ChannelTabs.tsx` una vez sin importadores

**Interfaces:**

- Consumes: `InboxItem`; `InitialsAvatar`, `ChannelDot`, `StageBadge`, `MonoMeta` de `@/components/shared/`; `canalLabel` de `@/lib/ui/canal`; íconos de `@/components/icons`.
- Produces: `<PanelLista items={InboxItem[]} />`, `<FiltrosCanal />`.

- [ ] **Step 1: Leer `InboxItem` y el `InboxListItem` actual**

Los campos disponibles mandan sobre lo que se puede renderizar. Si el diseño pide algo que `InboxItem` no trae —por ejemplo no leídos—, **no lo inventes ni cambies el service**: reportalo y omití ese elemento. Agregar campos es sub-proyecto D.

- [ ] **Step 2: `FiltrosCanal` — client component**

Los layouts de Next **no reciben `searchParams`**, así que el filtro lee la URL en cliente:

```tsx
"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChannelDot } from "@/components/shared/ChannelDot";
import { CANAL, type Canal } from "@/types/agente";
import { canalLabel } from "@/lib/ui/canal";
import { cn } from "@/lib/utils";
```

> `CANAL` vive en `@/types/domain`, no en `@/types/agente` — verificar el import correcto al escribir.

Chips: Todos + los 3 canales. `padding:4.5px 10px`, `rounded-[20px]`, `text-[11.5px] font-medium`. Activo: `bg-surface-avatar border-line-control text-ink-primary`. Inactivo: `bg-transparent border-line-card text-ink-dim`. Cambiar el filtro hace `router.replace` con el `searchParam`, sin recargar.

- [ ] **Step 3: `PanelLista`**

Contenedor `w-[322px] shrink-0 bg-surface-panel border-line-layout flex flex-col border-r`.

Encabezado: "Bandeja" `text-[17px] font-[650] tracking-[-0.02em]` + contador en `MonoMeta`. Debajo, punto `ok` de 5px con `animate-pulse-dot` + "Sincronizado en vivo · Meta Cloud API" en `text-[10.5px] text-ink-faint`.

La lista: `flex-1 min-h-0 overflow-y-auto`. **El `min-h-0` es obligatorio** — sin él, igual que pasó con el `<nav>` de la SideNav en A, el contenedor flex no deja scrollear y empuja el resto fuera del viewport.

El filtrado por canal ocurre en cliente sobre `items`, no re-fetchea.

- [ ] **Step 4: `InboxListItem` al diseño**

`padding:11px`, `rounded-[12px]`, hover `bg-surface-elevated`, seleccionada `bg-surface-hover` + barra izquierda `bg-brand` de 2.5px con `rounded-r-[3px]`.

`InitialsAvatar` de 38px con `ChannelDot` de 13px abajo a la derecha, `ringColor="#0a0b0e"` (el `surface-panel` del fondo).

Nombre `text-[12.5px] font-semibold truncate` + timestamp en `MonoMeta`. Preview `text-[11.5px] text-ink-dim truncate`. Fila inferior con `StageBadge` y, si `ia_pausada`, un badge `text-danger` sobre `bg-danger/13` con ícono `PanTool` de 12px.

Marcar la seleccionada comparando `usePathname()` con `/inbox/${item.leadId}`.

- [ ] **Step 5: Verificar en navegador**

Medir y reportar: ancho del panel (322px), que la lista scrollee sin empujar el encabezado, que los filtros filtren, y que la fila activa muestre la barra ámbar. Confirmar que `ChannelTabs` ya no se importa en ningún lado antes de borrarlo.

- [ ] **Step 6: Commit**

```bash
git add src/components/inbox/
git commit -m "feat(inbox): panel de lista con filtros de canal y filas al diseno"
```

---

## Task 3: Panel de conversación — header y hilo

**Files:**

- Modify: `src/components/inbox/ConversationHeader.tsx`, `src/components/inbox/HandoffToggle.tsx`, `src/components/inbox/ChatThread.tsx`

- [ ] **Step 1: Fondo con patrón de puntos**

En `ChatThread`, el contenedor del hilo:

```tsx
className="bg-surface-chat flex flex-1 flex-col-reverse gap-[9px] overflow-y-auto px-[26px] py-5"
style={{
  backgroundImage:
    "radial-gradient(circle at 1px 1px, rgba(255,255,255,.03) 1px, transparent 0)",
  backgroundSize: "24px 24px",
}}
```

> `flex-col-reverse` ancla el scroll abajo sin JavaScript. Los mensajes hay que iterarlos en orden inverso para que se lean cronológicamente.

- [ ] **Step 2: Header**

`px-5 py-[13px]`, borde inferior `line-layout`, `bg-[rgba(13,14,18,.86)] backdrop-blur-[8px]`. `InitialsAvatar` de 36px con `ChannelDot`. Nombre `text-[14.5px] font-[650] tracking-[-0.015em]` + `StageBadge`. Segunda línea en `MonoMeta` con teléfono · canales · última actividad, separadores `·` en `text-ink-fainter`, todo en una sola línea con `truncate`.

- [ ] **Step 3: `HandoffToggle`**

`px-[11px] py-1.5 rounded-[9px] text-[11.5px] font-semibold` con punto de 6px.

- IA activa: `text-ok bg-ok/10 border border-ok/28`, punto con `animate-pulse-dot`.
- IA pausada: `text-warn bg-warn/10 border border-warn/28`, sin animación.

**Conservar la lógica de la Server Action tal cual.** Solo cambia la presentación.

- [ ] **Step 4: Verificar en navegador**

Entrar a una conversación. Confirmar el patrón de puntos, que el hilo esté anclado abajo, que el header no se corte con nombres largos, y que el toggle refleje el estado real de `ia_pausada`.

- [ ] **Step 5: Commit**

```bash
git add src/components/inbox/
git commit -m "feat(inbox): header y hilo de conversacion al diseno"
```

---

## Task 4: Burbujas y composer

**Files:**

- Rewrite: `src/components/inbox/MessageBubble.tsx`
- Modify: `src/components/inbox/MessageInput.tsx`

- [ ] **Step 1: Leer cómo llega el tipo de mensaje**

`mensajes.sender` distingue `lead` / `ia` / `humano` / `sistema` — **no hace falta migrar nada**. Leer el `MessageBubble` actual y el tipo que recibe antes de escribir.

- [ ] **Step 2: Las 4 burbujas**

Máximo `max-w-[62%]`, hora en `MonoMeta` de 9.5px alineada a la derecha.

| `sender`  | Alineación | Clases                                                                                                                                                                                                                              |
| --------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sistema` | centrada   | Sin burbuja: línea `bg-surface-avatar` a cada lado, texto `font-mono text-[9.5px] uppercase text-ink-fainter`                                                                                                                       |
| `lead`    | izquierda  | `bg-surface-bubble-in border border-line-input rounded-[15px_15px_15px_5px] text-[12.5px] text-ink-body`                                                                                                                            |
| `ia`      | derecha    | `border border-brand/22 rounded-[15px_15px_5px_15px]`, fondo `linear-gradient(150deg, rgba(255,175,58,.16), rgba(255,175,58,.07))`, etiqueta "AGENTE IA" con `AutoAwesome` 12px + `font-mono text-[9px] uppercase text-brand-hover` |
| `humano`  | derecha    | `bg-surface-bubble-vend rounded-[15px_15px_5px_15px] text-[#14161b]`, etiqueta "VENDEDOR" en `font-mono text-[9px] text-ink-faint`                                                                                                  |

> La burbuja del vendedor es **clara sobre fondo oscuro**, a propósito: el handoff la distingue así de la del agente. El texto va en `#14161b`, no en un token `ink-*`, porque ninguno está pensado para fondo claro.

- [ ] **Step 3: Composer**

`px-[14px] py-[9px] rounded-[14px] bg-surface-input border border-line-input`. Hint "Enter envía · ⇧Enter salto de línea" en `font-mono text-[10px] text-ink-ghost`. Botón de envío 32×32 `rounded-[9px] bg-brand text-brand-ink` con `boxShadow: "0 3px 12px rgba(240,138,29,.3)"`.

**No agregar** los íconos de adjuntar ni respuestas rápidas del prototipo: no tienen función, y A estableció que un control sin función lleva comentario o no va.

- [ ] **Step 4: Verificar en navegador**

Con los mensajes reales de la DB, que incluyen `lead`, `ia` y `sistema`: confirmar que las tres se distinguen, que ninguna supera el 62%, y que el composer envía. **Enviar un mensaje de prueba y confirmar que aparece como burbuja de vendedor.**

- [ ] **Step 5: Commit**

```bash
git add src/components/inbox/
git commit -m "feat(inbox): burbujas por remitente y composer al diseno"
```

---

## Task 5: Panel del Twin

**Files:**

- Modify: `src/components/lead-twin/TwinPanel.tsx`

- [ ] **Step 1: Revestir**

Fondo `surface-panel`, borde izquierdo `line-layout`, `overflow-y-auto`. Secciones separadas por `border-b border-line-layout` con `px-[17px] py-[15px]`. Encabezado con ícono `ContactEmergency` en `text-brand` + "Lead Twin" `text-[12.5px] font-[650]`.

**Sin chips de procedencia ni edición** — eso es E.

- [ ] **Step 2: Rail del embudo**

`src/lib/ui/stage.ts` ya expone `FUNNEL_STAGES`, `FUNNEL_LENGTH`, `funnelStep`, `isDetour` y `stageColor` desde el sub-proyecto A. No hay datos nuevos.

- Nombre de la etapa `text-[18px] font-[680]` en `stageColor(stage)`, y "paso N/6" cuando `funnelStep` no es `null`.
- Rail de 6 segmentos `h-[3.5px] gap-[3px]`: los de índice ≤ paso actual en el color de la etapa, el resto en `bg-line-card`.
- **Si `isDetour(stage)`**: el rail se congela en gris `#3A3F49`, se oculta el contador de pasos, y aparece un chip con ícono `AltRoute` en `text-special` sobre `bg-special/9` diciendo que el embudo quedó frenado.

> `perdido` y `requiere_humano` **no son los pasos 7 y 8**. `funnelStep` devuelve `null` para ellos justamente para que el rail no pueda tratarlos como continuación.

- [ ] **Step 3: Verificar en navegador**

Con las sesiones reales de la DB. Si alguna está en `requiere_humano`, confirmar que el rail se congela y aparece el chip de desvío. Si ninguna lo está, cambiar una a mano desde Supabase para verlo, y **dejarla como estaba**.

- [ ] **Step 4: Commit**

```bash
git add src/components/lead-twin/
git commit -m "feat(inbox): panel del twin revestido con rail del embudo"
```

---

## Task 6: Verificación completa

**Files:** ninguno — solo verificación.

- [ ] **Step 1: CI**

`npm run ci` — verde, coverage sobre 80/75/80/80.

- [ ] **Step 2: Recorrida de las 8 rutas**

Con `npm run dev` y sesión de admin, a 1440×900:

| Ruta                              | Qué mirar                                                              |
| --------------------------------- | ---------------------------------------------------------------------- |
| `/inbox`                          | 3 paneles, estado vacío al centro                                      |
| `/inbox/[leadId]`                 | Los 3 paneles con contenido                                            |
| `/login`                          | Fuera del grupo `(panel)`: no hereda el shell. La más fácil de olvidar |
| `/leads`, `/leads/[id]`           | Tabla y diálogos de merge sin regresión                                |
| `/productos`, `/productos/import` | Tabla y formulario                                                     |
| `/metricas`, `/tags`, `/ajustes`  | Stubs legibles                                                         |
| `/agente`                         | Solo si G1 ya está mergeado                                            |

- [ ] **Step 3: Las tres pruebas que definen B**

1. Scrollear la lista, seleccionar otra conversación, **el scroll se mantiene**.
2. Entrar directo por URL a `/inbox/<uuid>` y ver los 3 paneles.
3. A 1164px de ancho aparece scroll horizontal, no paneles aplastados.

- [ ] **Step 4: Comparar contra el prototipo**

Abrir `CRM Repuestos v2.dc.html` al lado y contrastar. Anotar toda diferencia: las que sean de C, D o E se registran como esperadas; el resto son defectos.

- [ ] **Step 5: Actualizar docs y commit**

`AGENTS.md` §2 y `docs/next-session.md` con B completo y D como siguiente.

```bash
git add AGENTS.md docs/
git commit -m "docs(rediseno): cierra el sub-proyecto B bandeja"
```

---

## Cobertura del spec

| Sección                             | Tarea                          |
| ----------------------------------- | ------------------------------ |
| §3 layout compartido                | Task 1                         |
| §4 panel de lista                   | Task 2                         |
| §5 header, hilo, burbujas, composer | Tasks 3, 4                     |
| §6 panel del Twin                   | Task 5                         |
| §7 estado vacío y responsive        | Tasks 1, 6                     |
| §8 verificación                     | Tasks 1-6, medida en navegador |
| §9 criterios de aceptación          | Task 6                         |
