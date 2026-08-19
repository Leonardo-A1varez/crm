# Tema claro/oscuro + rebrand a rojo

> Diseño acordado por chat + compañero visual. Logo (asset final, integración en sidebar) queda **fuera de este spec** — el dueño pidió dejarlo de lado y centrarse en el sistema de temas. Se retoma en otra sesión.

## 1. Por qué

Hoy el "modo oscuro" no es un modo: es la única paleta que existe. `src/app/layout.tsx:29` fuerza la clase `dark` en `<html>` sin condición, y los tokens propios del rediseño "sala de control" (`surface-*`, `ink-*`, `line-*`, `brand-*`, `ok/warn/caution/danger/info/special`) están definidos **una sola vez** dentro de `@theme inline` en `globals.css` — no tienen contraparte clara. Un toggle no puede "invertir" nada porque no hay nada que invertir: hace falta diseñar la paleta clara entera, token por token.

En paralelo, el color secundario de marca (`--color-brand` y su familia `-hover/-deep/-ink`) es ámbar (`#ffaf3a`) en 23 archivos. Se reemplaza por rojo, acercándose al logo que el dueño mandó (`GR CRM`, llama + G roja + R gris con flecha ascendente).

## 2. Decisiones tomadas (compañero visual)

| Pregunta                                  | Decisión                                                                                                                             |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| ¿Alcance: todo junto o logo+rojo primero? | Todo junto: paleta clara + oscura + rojo en la misma sesión.                                                                         |
| ¿Qué rojo?                                | "Rojo carrera": `hover #ff5c5c` · `base #d61f1f` · `deep #b71414`. Mismo hex en los dos temas — el rojo no se invierte, es la marca. |
| ¿Paleta clara aprobada?                   | Sí, con componentes reales (tarjeta KPI, filas con badges, nav, botón) — ver §4.                                                     |
| ¿Dónde va el toggle?                      | Pie del sidebar, junto al avatar/logout. Ícono sol/luna.                                                                             |
| ¿Logo?                                    | Pausado. El dueño lo saca del alcance de esta sesión explícitamente.                                                                 |

## 3. Mecanismo del toggle

`next-themes@^0.4.6` ya está en `package.json` — instalado, nunca usado (`find src -iname "*theme*"` no devuelve nada). No se agrega dependencia nueva.

- `ThemeProvider` de `next-themes` envuelve el árbol en `src/app/layout.tsx`, con `attribute="class"` (coincide con `@custom-variant dark (&:is(.dark *))` que ya existe en `globals.css`), `defaultTheme="dark"`, `enableSystem={false}`.
  - `enableSystem={false}` porque la decisión previa de "modo oscuro forzado" fue deliberada (no accidental): el default sigue siendo oscuro para todo el que ya conoce el producto así. El toggle es explícito, no sigue `prefers-color-scheme` del SO.
- `<html>` pierde el `dark` hardcodeado de `layout.tsx:29` y gana `suppressHydrationWarning` (requisito de `next-themes`, porque la clase real la decide un script inline antes de la hidratación — sin la clase en el HTML del server, evita el flash del tema equivocado).
- Nuevo componente cliente `ThemeToggle.tsx`: botón sol/luna, usa `useTheme()` de `next-themes`, se monta en `SideNav.tsx` junto al avatar/logout (mismo lugar del mockup).

## 4. Paleta clara — token por token

Todos los tokens custom de `@theme inline` en `globals.css` (hoy dark-only) pasan a vivir en dos bloques: `:root` (claro, nuevo) y `.dark` (oscuro, los valores actuales sin cambios — se mueven tal cual, no se retocan). El rojo (`brand*`) es la excepción: mismo valor en ambos bloques.

**Superficies** (fondo, de más al fondo a más elevado):

| Token                 | Oscuro (sin cambio) | Claro (nuevo)                                                                                                                                                                                                                                                                               |
| --------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `surface-root`        | `#08090b`           | `#f6f7f8`                                                                                                                                                                                                                                                                                   |
| `surface-panel`       | `#0a0b0e`           | `#ffffff`                                                                                                                                                                                                                                                                                   |
| `surface-chat`        | `#0d0e12`           | `#f9fafb`                                                                                                                                                                                                                                                                                   |
| `surface-card`        | `#0f1116`           | `#ffffff`                                                                                                                                                                                                                                                                                   |
| `surface-elevated`    | `#101218`           | `#ffffff`                                                                                                                                                                                                                                                                                   |
| `surface-input`       | `#14161b`           | `#f1f2f4`                                                                                                                                                                                                                                                                                   |
| `surface-hover`       | `#15181e`           | `#eceef1`                                                                                                                                                                                                                                                                                   |
| `surface-avatar`      | `#1a1d24`           | `#e4e6ea`                                                                                                                                                                                                                                                                                   |
| `surface-bubble-in`   | `#191c22`           | `#eef0f2`                                                                                                                                                                                                                                                                                   |
| `surface-bubble-vend` | `#e8eaee`           | `#20242c` — es la burbuja "del vendedor humano" en el chat; en oscuro ya era clara (burbuja clara sobre fondo oscuro), en claro pasa a oscura (mismo contraste invertido, no tocado en detalle porque Inbox no es el foco de esta sesión — validar visualmente cuando se abra esa pantalla) |

**Líneas/bordes:**

| Token          | Oscuro    | Claro     |
| -------------- | --------- | --------- |
| `line-layout`  | `#17191f` | `#e6e8eb` |
| `line-card`    | `#1c1f26` | `#dfe2e6` |
| `line-input`   | `#21242c` | `#d5d9df` |
| `line-control` | `#23262d` | `#cdd2d9` |
| `line-row`     | `#14161b` | `#eceef1` |
| `line-dot`     | `#2c3038` | `#b8bec7` |

**Texto** (`ink-*`, de más al menos énfasis):

| Token           | Oscuro    | Claro     |
| --------------- | --------- | --------- |
| `ink-primary`   | `#ecedef` | `#14161b` |
| `ink-body`      | `#e4e6ea` | `#1c1f26` |
| `ink-secondary` | `#c8ccd3` | `#383d47` |
| `ink-muted`     | `#a9aeb7` | `#565c68` |
| `ink-dim`       | `#8b909a` | `#5a616e` |
| `ink-faint`     | `#7c838e` | `#646b78` |
| `ink-fainter`   | `#6e7580` | `#6d7481` |
| `ink-ghost`     | `#5f6672` | `#757c89` |

> Los cuatro últimos (`dim`/`faint`/`fainter`/`ghost`) salieron de esta tabla más claros de lo que shippeó. Se midieron por debajo de la paridad de contraste que el oscuro ya tenía contra su propio fondo — texto secundario que en oscuro se lee perfectamente bien quedaba, con estos valores, más tenue en claro de lo que el oscuro es en oscuro. Se oscurecieron a los de `globals.css` (columna de arriba, ya corregida) durante la implementación, sin que se actualizara esta tabla; ver Finding 5 del review final de rama.

**Marca — rojo, mismo valor en los dos temas:**

| Token         | Valor (claro y oscuro)                                                                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `brand`       | `#d61f1f`                                                                                                                                               |
| `brand-hover` | `#ff5c5c`                                                                                                                                               |
| `brand-deep`  | `#b71414`                                                                                                                                               |
| `brand-ink`   | `#fff5f4` (texto sobre superficie roja — antes `#231602`, negro sobre ámbar; con rojo más saturado el texto en blanco es lo que da contraste, no negro) |

**Colores de estado** (`ok/warn/caution/danger/info/special`) — en oscuro son tintes claros pensados para leerse sobre fondo casi negro; sobre blanco esos mismos tintes no llegan a 4.5:1 de contraste. Se oscurecen manteniendo la familia de matiz:

| Token     | Oscuro    | Claro     |
| --------- | --------- | --------- |
| `ok`      | `#34d399` | `#0f8f61` |
| `warn`    | `#fb923c` | `#c2540f` |
| `caution` | `#fbbf24` | `#a16207` |
| `danger`  | `#f87171` | `#dc2626` |
| `info`    | `#7fb3f5` | `#2563a8` |
| `special` | `#e879f9` | `#a21caf` |

**Tokens de bloque de aviso** (`ink-warm`, `surface-glow`, `surface-warm`, `ink-warm-dim` — el bloque ENTONCES de una regla, la tarjeta de gasto destacada):

| Token          | Oscuro    | Claro                                                        |
| -------------- | --------- | ------------------------------------------------------------ |
| `ink-warm`     | `#f2ede4` | `#6b2a26` (mismo valor que `ink-warm-dim`)                   |
| `surface-glow` | `#151116` | `#fff0ee` (primer stop del gradiente de tarjetas destacadas) |
| `surface-warm` | `#141116` | `#fdf1f0`                                                    |
| `ink-warm-dim` | `#e4d9cb` | `#6b2a26`                                                    |

> `ink-warm` no quedó como esta tabla decía originalmente ("sin cambio, vive sobre un chip oscuro/rojo fijo en los dos temas"). Esa premisa era falsa incluso en oscuro: los dos usos reales son la respuesta del bloque ENTONCES de una regla (`DetalleRegla.tsx`, sobre `bg-brand/[0.06]`) y el texto de la burbuja del agente (`MessageBubble.tsx`, sobre el gradiente `FONDO_IA`) — ambos tintes translúcidos de `--color-brand`, no un chip sólido. El crema `#f2ede4` funciona sobre el tinte oscuro (12-16:1) pero cae a 1.02-1.06:1 sobre el tinte claro. Se corrigió a `#6b2a26` — el mismo valor que `ink-warm-dim` ya usaba para ese rol — durante el fix wave del review final de rama (Finding 2).

**shadcn genéricos** (`background/foreground/card/primary/...`, ya tenían light+dark vía `:root`/`.dark` con oklch): `--primary`/`--ring`/`--sidebar-primary`/`--sidebar-ring` pasan de `#ffaf3a` a `#d61f1f` en `.dark`, y sus contrapartes en `:root` (hoy genéricas de shadcn, `oklch(0.205 0 0)` etc.) se alinean a los mismos hex que la tabla de arriba donde correspondan (`--background` = `surface-root` claro, `--foreground` = `ink-primary` claro, etc.) para que ambos sistemas de tokens (custom y shadcn) queden consistentes.

**Colores de etapa del embudo** (`stage-*`, `src/lib/ui/stage.ts`) y **rail congelado** (`rail-congelado`, rail del Twin en un desvío) — no estaban en la versión original de este spec; se agregaron durante la implementación:

| Token                   | Oscuro (= handoff, sin cambio) | Claro     |
| ----------------------- | ------------------------------ | --------- |
| `stage-nuevo`           | `#38bdf8`                      | `#0369a1` |
| `stage-identificando`   | `#818cf8`                      | `#4f46e5` |
| `stage-cotizado`        | `#a78bfa`                      | `#7c3aed` |
| `stage-negociando`      | `#fbbf24`                      | `#854d0e` |
| `stage-esperando-pago`  | `#fb923c`                      | `#9a3412` |
| `stage-cerrado`         | `#34d399`                      | `#047857` |
| `stage-perdido`         | `#f87171`                      | `#b91c1c` |
| `stage-requiere-humano` | `#e879f9`                      | `#a21caf` |
| `rail-congelado`        | `#3a3f49`                      | `#b8bec7` |

Los valores claros de `stage-*` no son los mismos que los tokens semánticos que a simple vista comparten familia de matiz (`warn`/`caution`/`danger`/`special` de la tabla de arriba, o incluso `ok`/`info`). Es deliberado: un badge de etapa pinta el texto sobre `stageBadgeBackground()`, un `color-mix` al 13% del propio color de la etapa (`src/lib/ui/stage.ts`), así que la superficie efectiva es un tinte muy claro del mismo tono — no la superficie plana (`surface-card`/`surface-root`) sobre la que sientan `ok/warn/caution/danger/info/special`. Un texto que alcanza 4.5:1 sobre superficie plana puede no alcanzarlo sobre un tinte de sí mismo, porque ese tinte ya aclaró el fondo hacia el color del texto. Cuatro etapas necesitaron oscurecerse más allá de lo que su semántico equivalente hubiera sugerido para volver a pasar 4.5:1 sobre su propio 13%: `negociando`, `esperando_pago`, `cerrado`, `perdido`. Las otras cuatro (`nuevo`, `identificando`, `cotizado`, `requiere_humano`) alcanzan con el mismo criterio de oscurecimiento que el resto de la paleta clara. `rail-congelado` no es de etapa: es el gris del rail cuando la sesión tomó un desvío, y se mantiene más claro que `line-card` a propósito para leerse como barra inerte y no como progreso apagado — mismo criterio en los dos temas.

## 5. No entra en este spec

- Asset final del logo y su integración en el sidebar — pausado por pedido explícito.
- Revisión visual de Inbox (burbujas de chat, `surface-bubble-vend`) — el valor de la tabla es una propuesta razonable, no validada con componentes reales de esa pantalla.
- Cualquier otra pantalla fuera de lo que ya se mockeó (Métricas-style KPI card, fila de tabla, badges, nav, botón).

## 6. Testing / verificación

- Sin lógica de negocio nueva — no aplica TDD de service/repo.
- Verificación es visual: cada pantalla existente cargada en los dos temas, confirmando contraste legible y que ningún componente quedó con un token sin su par claro (esto se verifica navegando la app real con el toggle, no con tests automatizados).
- `npm run typecheck` + `npm run lint` + `npm run test` igual se corren — no deberían tocar tests existentes (esto es CSS + un componente de toggle + wiring de `layout.tsx`), pero se confirma que nada se rompió.
