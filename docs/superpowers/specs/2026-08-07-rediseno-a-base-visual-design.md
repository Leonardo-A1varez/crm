# Rediseño "sala de control" — Sub-proyecto A: base visual

> Fecha: 2026-08-07 · Estado: implementado (rama `rediseno-a-base-visual`, commits 88fd1cf..07696a5)
> Handoff de origen: `Rediseño UI sala de control.zip` → `design_handoff_crm_control_room/`
> Referencia principal: `CRM Repuestos v2.dc.html` + `README.md` del bundle

---

## 1. Contexto

El handoff de diseño cubre cuatro pantallas (Bandeja, Leads, Métricas, consola Agente IA) con fidelidad alta y tokens exactos. No es un trabajo: son **siete subsistemas independientes**, y tres de ellos exigen migración.

Descomposición acordada:

| #     | Sub-proyecto                                                             | Backend nuevo                                    | Entregable solo |
| ----- | ------------------------------------------------------------------------ | ------------------------------------------------ | --------------- |
| **A** | **Base visual: tokens, modo oscuro, íconos, primitivas, SideNav, shell** | **no**                                           | **sí**          |
| B     | Bandeja unificada de 3 paneles                                           | poco                                             | sí              |
| C     | Ventana de 24 h + estados de entrega                                     | migración + persistir webhooks de status de Meta | sí              |
| D     | Triage (motivo + prioridad)                                              | cálculo en server                                | sí              |
| E     | Twin con procedencia y edición                                           | migración por campo                              | sí              |
| F     | Métricas en 3 cortes                                                     | queries nuevas                                   | sí              |
| G     | Consola Agente IA                                                        | tablas nuevas de config                          | sí              |

**G se solapa con la fase 11 Intents+Reglas** ya planificada en `AGENTS.md` §2 — mismo dominio, alcance mayor. Tratar como un solo trabajo cuando llegue el turno, no como dos.

Este spec cubre **solo A**. Cada sub-proyecto restante tendrá su propio ciclo spec → plan → implementación.

### 1.1 Correcciones al handoff

El documento de handoff asume un stack que no es el del repo. Al implementar, mandan estos hechos, no el handoff:

| Handoff dice                              | Realidad del repo                                                                                                                                                    |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Drizzle para datos"                      | No hay Drizzle. Repositorios sobre Supabase (`src/server/repositories/`)                                                                                             |
| "Next.js 15"                              | Next **16.2.6** — el middleware se llama `proxy` (`src/proxy.ts`)                                                                                                    |
| "Material Symbols Rounded"                | `lucide-react`, ya presente. Ver §4                                                                                                                                  |
| "decidir si se elimina el theme switcher" | No existe switcher. `next-themes` sí está en el repo (`src/components/ui/sonner.tsx` lo usa para `useTheme`), pero no hay `<ThemeProvider>` montado — nada lo activa |

Hallazgos del schema relevantes para sub-proyectos posteriores, registrados acá para no re-descubrirlos:

- `mensajes` **tiene** `direction` y `sender` → el corte IA vs vendedor de Métricas (F) es viable sin migrar.
- `mensajes` **no tiene** columna de estado de entrega → los `enviado/entregado/leido/fallido` del diseño (C) requieren persistir los webhooks de status de Meta, que hoy se descartan.

---

## 2. Objetivo y alcance

**Objetivo:** instalar el lenguaje visual del rediseño en toda la app, sin tocar datos ni rutas, de modo que las siete pantallas existentes queden con la estética nueva y los sub-proyectos B–G construyan sobre una base ya establecida.

### 2.1 Dentro de alcance

1. Capa de tokens en `globals.css`.
2. Modo oscuro forzado.
3. Módulo de íconos con alias trazables al handoff.
4. Lógica pura de presentación en `src/lib/ui/` (con tests).
5. Primitivas compartidas en `src/components/shared/`.
6. SideNav reconstruida.
7. Shell del panel.
8. Borrado de la plantilla de inicio de Next en `src/app/page.tsx`.

### 2.2 Fuera de alcance

Bandeja de 3 paneles · triage · ventana de 24 h · procedencia del Twin · métricas · consola del agente · layout móvil · atajos de teclado · buscador funcional · renombrar rutas.

**No se altera** ningún repositorio, servicio, Server Action, migración ni ruta. Si la implementación necesita tocar algo de eso, es señal de que el alcance se desbordó: parar y revisar.

---

## 3. Capa de tokens

`src/app/globals.css`. Dos grupos con propósitos distintos.

### 3.1 Tokens semánticos de shadcn, redefinidos

Redefinir los tokens que ya consume `src/components/ui/**` es lo que hace que `Button`, `Input`, `Table`, `Dialog` y el resto adopten el lenguaje nuevo **sin reescribir ni un componente**. Se aplica sobre el bloque `.dark`.

| Token                                        | Valor             | Origen en el handoff         |
| -------------------------------------------- | ----------------- | ---------------------------- |
| `--background`                               | `#08090b`         | bg-root                      |
| `--foreground`                               | `#ECEDEF`         | text-primary                 |
| `--card` / `--popover`                       | `#0f1116`         | bg-card                      |
| `--card-foreground` / `--popover-foreground` | `#ECEDEF`         | text-primary                 |
| `--primary`                                  | `#FFAF3A`         | accent                       |
| `--primary-foreground`                       | `#231602`         | accent-ink                   |
| `--secondary`                                | `#14161b`         | bg-input                     |
| `--secondary-foreground`                     | `#ECEDEF`         | text-primary                 |
| `--muted`                                    | `#101218`         | bg-elevated                  |
| `--muted-foreground`                         | `#8B909A`         | text-dim                     |
| `--accent`                                   | `#15181e`         | bg-hover                     |
| `--accent-foreground`                        | `#ECEDEF`         | text-primary                 |
| `--destructive`                              | `#F87171`         | danger                       |
| `--border`                                   | `#1c1f26`         | borde de tarjetas            |
| `--input`                                    | `#21242c`         | borde de inputs              |
| `--ring`                                     | `#FFAF3A`         | accent                       |
| `--sidebar`                                  | `#08090b`         | bg-root                      |
| `--sidebar-foreground`                       | `#ECEDEF`         | text-primary                 |
| `--sidebar-border`                           | `#17191f`         | borde de layout              |
| `--sidebar-accent`                           | `#15181e`         | fondo de ítem activo         |
| `--sidebar-accent-foreground`                | `#ECEDEF`         | text-primary                 |
| `--sidebar-primary`                          | `#FFAF3A`         | accent                       |
| `--sidebar-primary-foreground`               | `#231602`         | accent-ink                   |
| `--radius`                                   | `0.5625rem` (9px) | radio de botones y controles |

### 3.2 Tokens propios del diseño

Los que shadcn no tiene. Superficies, líneas, texto, marca y semánticos se declaran en `@theme inline` para que Tailwind genere utilidades (`bg-surface-panel`, `text-ink-dim`, `border-line-card`). Etapas y canales son la excepción: ver nota al final de esta sección.

**Superficies**

| Utilidad              | Hex       |
| --------------------- | --------- |
| `surface-root`        | `#08090b` |
| `surface-panel`       | `#0a0b0e` |
| `surface-chat`        | `#0d0e12` |
| `surface-card`        | `#0f1116` |
| `surface-elevated`    | `#101218` |
| `surface-input`       | `#14161b` |
| `surface-hover`       | `#15181e` |
| `surface-avatar`      | `#1a1d24` |
| `surface-bubble-in`   | `#191c22` |
| `surface-bubble-vend` | `#E8EAEE` |

**Líneas:** `line-layout` `#17191f` · `line-card` `#1c1f26` · `line-input` `#21242c` · `line-control` `#23262d`

**Texto:** `ink-primary` `#ECEDEF` · `ink-body` `#E4E6EA` · `ink-secondary` `#C8CCD3` · `ink-muted` `#A9AEB7` · `ink-dim` `#8B909A` · `ink-faint` `#7C838E` · `ink-fainter` `#6E7580` · `ink-ghost` `#5F6672`

> `ink-faint`, `ink-fainter` e `ink-ghost` fueron elevados en el diseño para alcanzar ~3:1 sobre `surface-panel`. **No bajarlos** — es una herramienta de uso continuo.

**Marca:** `brand` `#FFAF3A` · `brand-hover` `#FFC46B` · `brand-deep` `#F08A1D` · `brand-ink` `#231602`

**Semánticos:** `ok` `#34D399` · `warn` `#FB923C` · `caution` `#FBBF24` · `danger` `#F87171` · `info` `#7FB3F5` · `special` `#E879F9`

**Etapas:** `nuevo` `#38BDF8` · `identificando` `#818CF8` · `cotizado` `#A78BFA` · `negociando` `#FBBF24` · `esperando_pago` `#FB923C` · `cerrado` `#34D399` · `perdido` `#F87171` · `requiere_humano` `#E879F9`

**Canales:** WhatsApp `#25D366` · Instagram `#E1306C` · Messenger `#1877F2`

> **Etapas y canales NO se declaran en `@theme inline`.** Viven como constantes TypeScript en `src/lib/ui/stage.ts` y `src/lib/ui/canal.ts` (`stageColor`/`stageLabel`/`stageBadgeBackground`, `canalColor`/`canalLabel`), consumidas con `style` inline por `StageBadge` y `ChannelDot` en `src/components/shared/`. Dos razones, no una omisión: (1) Tailwind genera utilidades a partir de valores estáticos en tiempo de build — no puede generar una clase `bg-{stage}` a partir de un `CurrentStage` que solo se conoce en runtime; (2) el fondo del badge de etapa necesita el color de la etapa compuesto al 13% de alpha (`stageBadgeBackground`), un valor derivado que una utilidad de Tailwind no expresa sin de todos modos recurrir a un `style` inline. Los hex de la tabla de arriba son el mismo valor que esas constantes — no hay divergencia de color, solo de mecanismo.

### 3.3 Formato: hex, no oklch

El resto de `globals.css` usa oklch (default de shadcn). Los tokens de este spec van en **hex**.

Razón: el handoff define valores hex exactos y declara fidelidad alta. La única forma de auditar el resultado contra el documento es que el token diga literalmente lo que dice el handoff. Convertir a oklch introduce deriva de redondeo que nadie puede verificar a ojo, y obliga a una tabla de traducción para cada revisión futura.

### 3.4 Extras en `globals.css`

- Keyframes `pulseDot` (2 s ease-in-out infinita, `opacity 1→.35` + `scale 1→.82`) y `riseIn` (.3 s, `translateY(6px)` + fade). Son las **únicas dos** animaciones del sistema.
- Scrollbars: 9px, thumb `#23262d` (hover `#343841`) con `border: 2px solid transparent` + `background-clip: content-box`, track transparente.
- `text-wrap: pretty` en párrafos.
- `line-height` base 1.45.

---

## 4. Modo oscuro

Aplicar `dark` en el `<html>` de `src/app/layout.tsx`. El bloque `.dark` de `globals.css` pasa a llevar la paleta de §3.1.

El bloque claro `:root` **queda intacto**. No estorba (lo pisa `.dark`), mantiene el contrato que esperan los componentes de shadcn, y deja abierta una variante clara futura sin trabajo de arqueología. No hay switcher que remover: el repo tiene `next-themes` como dependencia (lo usa `src/components/ui/sonner.tsx` para `useTheme`), pero no hay `<ThemeProvider>` montado en el árbol — sin él nada activa la clase `.dark` por sí solo, y por eso la app renderiza hoy la paleta clara.

La tipografía **ya cumple**: `src/app/layout.tsx` carga Geist y Geist Mono con `next/font/google`, que las auto-hospeda en el build. Satisface el diseño y respeta la CSP estricta de B3 sin cambios.

---

## 5. Íconos

**Decisión: `lucide-react` con alias, no Material Symbols.**

El handoff especifica Material Symbols Rounded y nombra íconos concretos. Traerla desde Google Fonts exigiría abrir `font-src` y `style-src` en la CSP de `next.config.ts` — justo lo que el hardening B3 cerró a propósito, en una app con datos personales de clientes bajo compliance Latam. Auto-hospedarla obliga a subsetear a mano y a rehacer ese subset cada vez que un diseño nuevo pida un ícono más.

A `wght 300` el trazo de Material Symbols y el de lucide son muy parecidos, así que el costo de fidelidad es bajo y el de mantenimiento, nulo.

`src/components/icons.ts` — **re-exports nombrados**, no un objeto indexado por string:

```ts
export { Hand as PanTool, Sparkles as AutoAwesome } from "lucide-react";
```

Un mapa `Record<string, Icon>` obligaría al bundler a incluir **todos** los íconos mapeados en cada página que importe el módulo, crezca como crezca la tabla. Los re-exports preservan el tree-shaking y el alias conserva la trazabilidad contra el handoff.

Mapeo inicial (se extiende cuando B–G pidan íconos nuevos):

| Handoff             | lucide           |
| ------------------- | ---------------- |
| `pan_tool`          | `Hand`           |
| `auto_awesome`      | `Sparkles`       |
| `database_search`   | `DatabaseZap`    |
| `receipt_long`      | `ReceiptText`    |
| `alt_route`         | `Split`          |
| `lock_clock`        | `LockKeyhole`    |
| `settings_suggest`  | `Settings2`      |
| `inbox`             | `Inbox`          |
| `group`             | `Users`          |
| `inventory_2`       | `Package`        |
| `smart_toy`         | `Bot`            |
| `sell`              | `Tag`            |
| `bar_chart`         | `BarChart3`      |
| `settings`          | `Settings`       |
| `search`            | `Search`         |
| `logout`            | `LogOut`         |
| `warning`           | `TriangleAlert`  |
| `bolt`              | `Zap`            |
| `schedule`          | `Clock`          |
| `contact_emergency` | `ContactRound`   |
| `directions_car`    | `Car`            |
| `edit`              | `Pencil`         |
| `task_alt`          | `CircleCheckBig` |
| `more_horiz`        | `Ellipsis`       |
| `close`             | `X`              |
| `attach_file`       | `Paperclip`      |
| `done`              | `Check`          |
| `done_all`          | `CheckCheck`     |
| `error`             | `CircleAlert`    |
| `verified_user`     | `ShieldCheck`    |

Cuando un nombre no tenga equivalente exacto, elegir el más cercano y **dejar el alias del handoff** para que la correspondencia siga siendo evidente.

---

## 6. Lógica pura — `src/lib/ui/`

Va en `lib/` y no junto a los componentes por una razón concreta: `src/components/shared/**` está **excluido de coverage** en `vitest.config.ts:35` por política (se valida con browser/Playwright). `src/lib/**` no lo está. Separar el dato puro de la presentación hace que las tablas de color y la derivación de iniciales queden cubiertas por tests, que es donde un error es silencioso y caro.

Además respeta las architecture zones de `eslint.config.mjs`: `lib/**` solo puede importar de `lib` y `types`.

| Archivo       | Exporta                                                                |
| ------------- | ---------------------------------------------------------------------- |
| `stage.ts`    | color, label, índice en el embudo y flag de desvío por `current_stage` |
| `canal.ts`    | color y label por canal                                                |
| `initials.ts` | nombre → iniciales                                                     |

**Regla del embudo** (del handoff, importa para E y F pero se define acá porque es dato puro): el embudo son las **6 primeras** etapas — `nuevo → identificando → cotizado → negociando → esperando_pago → cerrado`. `perdido` y `requiere_humano` **no son pasos 7 y 8**: son desvíos. `stage.ts` debe exponer esa distinción explícitamente, no como un índice numérico que invite a tratarlos como continuación.

---

## 7. Primitivas — `src/components/shared/`

Los átomos que las cuatro pantallas del handoff repiten. Se construyen ahora una vez, no cuatro veces mal.

| Componente       | Responsabilidad                                                         |
| ---------------- | ----------------------------------------------------------------------- |
| `StageBadge`     | Badge de etapa: color pleno sobre el mismo color al 13% de alpha        |
| `ChannelDot`     | Punto de canal, con tamaño y anillo opcional del color de la superficie |
| `InitialsAvatar` | Avatar de iniciales en 26/28/36/38 px, cada uno con su radio            |
| `Eyebrow`        | Etiqueta mono 9px uppercase `letter-spacing:.13em`                      |
| `MonoMeta`       | Texto mono chico para timestamps, IDs, SKUs y meta técnica              |

Regla tipográfica del handoff que estas primitivas encarnan: **todo dato que se compara o se escanea va en mono**.

---

## 8. SideNav

`src/components/shared/SideNav.tsx`, reconstruida al diseño.

- Ancho 222px, fondo `surface-root`, borde derecho `line-layout`.
- **Logo:** cuadrado 30×30, radio 9px, `linear-gradient(145deg,#FFC46B,#F08A1D)`, sombra `0 4px 14px rgba(240,138,29,.28)`. Al lado "Repuestos" (13.5px/650) y "CRM · single-org" (mono 9.5px, `.13em`, uppercase, `ink-faint`).
- **Buscador:** alto ~30px, radio 9px, `surface-elevated`, borde `#1c1f26`, ícono `Search` + placeholder + chip `⌘K`.
- **Ítems:** padding 8×10, radio 9px, gap 11px, ícono 18px, label 12.5px. Inactivo `ink-dim`/500; hover `surface-elevated` + `ink-primary`; activo `ink-primary`/600 + `surface-hover` + barra vertical izquierda (`left:-10px`, 2.5px, radio `0 3px 3px 0`, `brand`, glow `0 0 10px rgba(255,175,58,.7)`).
- **`<nav>` con `flex:1 1 0; min-height:0; overflow-y:auto`.** Sin `min-height:0` el footer se va del viewport en pantallas bajas — el handoff lo marca como crítico y es un bug real de flexbox, no un detalle estético.
- **Footer:** avatar 26×26, nombre 11.5px/550, rol 10px `ink-faint`, ícono `LogOut` 17px. Borde superior `line-layout`. El `LogoutButton` actual se mueve acá.
- El widget de gasto de IA **no va** en el sidebar: por decisión explícita del handoff vive solo en Métricas → pestaña Agente IA.

Ítems y rutas — **las rutas no cambian en A**:

| Label            | Ruta              | Nota                                                                          |
| ---------------- | ----------------- | ----------------------------------------------------------------------------- |
| Bandeja          | `/inbox`          | badge contador decorativo                                                     |
| Leads            | `/leads`          |                                                                               |
| Productos        | `/productos`      |                                                                               |
| Intents y reglas | `/intents-reglas` | el handoff lo llama "Agente IA"; se renombra en G, cuando esa pantalla exista |
| Tags             | `/tags`           |                                                                               |
| Métricas         | `/metricas`       |                                                                               |
| Ajustes          | `/ajustes`        |                                                                               |

Nombre y rol del usuario salen de `(panel)/layout.tsx`, que ya resuelve `getAuthenticatedUser()`. Sin datos nuevos.

### 8.1 Elementos decorativos declarados

Dos elementos se maquetan sin función y **deben quedar marcados como tales en el código**:

- **Chip `⌘K`** — el handoff mismo lo declara decorativo hoy.
- **Badge contador de Bandeja** — recibe el número por prop opcional; cablearlo requiere la query de conversaciones que pertenece a B.

Un adorno sin comentario se lee como un bug en la próxima sesión. El comentario tiene que decir qué sub-proyecto lo activa.

---

## 9. Shell del panel

`src/app/(panel)/layout.tsx`:

- Contenedor raíz `flex h-screen overflow-x-auto overflow-y-hidden` sobre `surface-root`.
- Sidebar fija de 222px.
- `<main>` con `flex-1`, y por debajo de ~1164px scrollea horizontal en vez de aplastarse.

**No** incluye el layout de 3 paneles: eso requiere unificar `/inbox` con `/inbox/[leadId]` y rehacer el flujo de datos de la conversación, que es el sub-proyecto B.

---

## 10. Limpieza

`src/app/page.tsx` es la plantilla de inicio de Next sin modificar — links a nextjs.org, logos de Vercel, `dark:invert`. Es la raíz del sitio para un usuario autenticado. Se reemplaza por `redirect("/inbox")`.

---

## 11. Verificación

| Qué              | Cómo                                                                                                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lógica pura      | Tests unitarios de `src/lib/ui/**` (tablas de color completas para las 8 etapas y los 3 canales, desvíos del embudo, iniciales con casos borde: un solo nombre, vacío, acentos) |
| Sin regresión    | `npm run ci` verde: typecheck, lint, format, coverage sobre el umbral 80/75/80/80                                                                                               |
| Fidelidad visual | Recorrida en navegador de las 7 pantallas existentes, contrastada contra `CRM Repuestos v2.dc.html`                                                                             |
| Sin roturas      | Ninguna de las 7 pantallas queda ilegible por el cambio de paleta — en particular las tablas de Productos y Leads, y los diálogos de merge de la fase 10                        |

El riesgo real de A no es que la SideNav quede mal: es que el cambio de tokens rompa contraste o legibilidad en pantallas que nadie está mirando durante el trabajo. Por eso la recorrida de las 7 es criterio de aceptación, no una cortesía.

---

## 12. Criterios de aceptación

1. Las 7 pantallas existentes renderizan con la paleta oscura del handoff, sin regresiones funcionales.
2. Los componentes de `src/components/ui/**` (shadcn) adoptan el lenguaje nuevo **sin haber sido editados**.
3. `src/lib/ui/**` con tests; `npm run ci` verde.
4. SideNav coincide con el diseño, incluido el `min-height:0` del `<nav>`.
5. Los elementos decorativos están marcados en el código con el sub-proyecto que los activa.
6. `src/app/page.tsx` ya no es la plantilla de Next.
7. Cero cambios en repositorios, servicios, Server Actions, migraciones y rutas.

---

## 13. Decisiones registradas

| Decisión                                             | Razón                                                                                                        |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| lucide con alias, no Material Symbols                | Preserva el hardening de CSP B3; sin costo de mantenimiento de subsets; pérdida de fidelidad baja a wght 300 |
| Tokens en hex, no oklch                              | La fidelidad alta solo es auditable si el token dice lo mismo que el handoff                                 |
| Redefinir tokens semánticos de shadcn                | Los ~30 componentes vendorizados adoptan el diseño sin editarlos                                             |
| Lógica pura en `lib/ui/`, no en `components/shared/` | `components/shared/**` está excluido de coverage; las tablas de color merecen tests                          |
| Se conserva el bloque `:root` claro                  | No estorba, mantiene el contrato de shadcn, deja abierta una variante clara                                  |
| Rutas sin cambios                                    | Renombrar a `/agente` sin la consola detrás deja un ítem que promete algo que no existe                      |
| 3 paneles fuera de A                                 | Unificar `/inbox` con `/inbox/[leadId]` es cambio de flujo de datos, no de estilo                            |

---

## 14. Sub-proyecto siguiente

**B — Bandeja unificada de 3 paneles.** Consume los tokens y primitivas de A. Su spec debe resolver: cómo se unifican `/inbox` y `/inbox/[leadId]` conservando el deep-linking, y qué datos necesita la lista que hoy no se consultan.
