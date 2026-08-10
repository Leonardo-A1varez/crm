# Handoff: CRM Repuestos — rediseño UI "sala de control"

## Overview

Rediseño completo de la UI del CRM conversacional de repuestos automotrices (single-org, self-hosted, agente IA seller multi-canal sobre WhatsApp / Instagram / Messenger).

El rediseño cubre cuatro pantallas: **Bandeja** (inbox de 3 paneles con triage), **Leads**, **Métricas** (que hoy es un stub) y **Agente IA** (consola de configuración de reglas, escalado, comportamiento y límites — no existe hoy).

Objetivo del rediseño, en orden de importancia:

1. Que el vendedor atienda **lo que la IA no puede resolver o donde hay plata en juego**, no "lo último que entró".
2. Que la restricción de la **ventana de 24 h de WhatsApp** sea visible en la UI antes de escribir, no un error después de enviar.
3. Que el **Lead Twin** sea confiable: cada campo declara su procedencia y el vendedor puede corregirlo.
4. Que las métricas de **IA y de vendedores estén separadas** (y también combinadas), porque miden cosas distintas.

## About the Design Files

Los archivos `.dc.html` de este bundle son **referencias de diseño creadas en HTML** — prototipos que muestran la apariencia y el comportamiento deseados. **No son código de producción para copiar.**

La tarea es **recrear estos diseños en el codebase existente** (Next.js 15 App Router + React 19 + Tailwind v4 + shadcn/ui, según `crm/`), usando sus patrones y librerías ya establecidos: componentes en `src/components/`, Server Components donde corresponda, Server Actions para mutaciones, Drizzle para datos.

Concretamente:

- Los estilos inline del prototipo se traducen a **clases de Tailwind** y, donde haga falta, a tokens nuevos en `src/app/globals.css`.
- Las listas y condicionales del prototipo (`sc-for`, `sc-if`) son `.map()` y renderizado condicional normal de React.
- Toda la data del prototipo es **ficticia y hardcodeada**. Se reemplaza por queries reales a Drizzle / Server Actions.
- La clase de lógica del prototipo (estado local, toggles) indica **qué estado hace falta**, no cómo implementarlo.

`support.js` es el runtime del prototipo. **No se porta**: existe solo para que los `.dc.html` abran en un navegador.

## Fidelity

**Alta fidelidad (hifi).** Colores, tipografía, espaciados, radios y estados están definidos con valores exactos. Recrear pixel-perfect usando Tailwind + shadcn, respetando los valores del apartado _Design Tokens_.

Dos salvedades:

- El diseño es **solo tema oscuro**. Los tokens claros de `globals.css` quedan sin usar en estas pantallas (decidir si se elimina el theme switcher o se pospone la variante clara).
- El diseño asume **escritorio** (mínimo ~1440px cómodo, 1164px con scroll horizontal). No hay layout móvil definido.

---

## Screens / Views

### 1. Bandeja (Inbox) — `/inbox`

**Propósito:** el vendedor supervisa las conversaciones que la IA maneja sola e interviene en las que lo requieren.

**Cambio estructural respecto del código actual:** hoy `/inbox` es una lista y `/inbox/[leadId]` una página aparte a pantalla completa. El rediseño los unifica en **un layout de 3 paneles fijos** (como promete el README del repo). La ruta `/inbox/[leadId]` se mantiene para deep-linking, pero renderiza el mismo layout con esa conversación seleccionada.

**Layout:**

```
┌────────┬──────────────┬────────────────────────┬──────────────┐
│ SideNav│ Lista        │ Conversación           │ Lead Twin    │
│ 222px  │ 322px        │ flex:1, min-width 520px│ 322px        │
└────────┴──────────────┴────────────────────────┴──────────────┘
```

- Contenedor raíz: `display:flex; height:100vh; overflow-x:auto; overflow-y:hidden; background:#08090b`
- `<main>`: `flex:1; display:flex; min-width:1164px; overflow:hidden` — por debajo de eso scrollea horizontal en vez de aplastarse.
- Bordes entre paneles: `1px solid #17191f`.

#### 1.1 SideNav (222px, fijo, presente en todas las pantallas)

- Fondo `#08090b`, borde derecho `#17191f`.
- **Logo:** cuadrado 30×30, `border-radius:9px`, `background:linear-gradient(145deg,#FFC46B,#F08A1D)`, `box-shadow:0 4px 14px rgba(240,138,29,.28)`, ícono `settings_suggest` 19px en `#231602`. Al lado: "Repuestos" (13.5px / 650 / `-.01em`) y "CRM · single-org" (Geist Mono 9.5px, `letter-spacing:.13em`, uppercase, `#7C838E`).
- **Buscador:** alto ~30px, `padding:7px 10px`, `radius:9px`, `background:#101218`, `border:1px solid #1c1f26`. Ícono `search` 15px + placeholder "Buscar…" 12px `#7C838E` + chip `⌘K` (Geist Mono 9.5px, `border:1px solid #23262d`, `radius:4px`).
- **Ítems de nav:** `padding:8px 10px`, `radius:9px`, `gap:11px`, ícono 18px (Material Symbols Rounded, `wght 300`), label 12.5px.
  - Inactivo: `color:#8B909A`, `font-weight:500`, fondo transparente.
  - Hover: `background:#12141a`, `color:#ECEDEF`.
  - Activo: `color:#ECEDEF`, `font-weight:600`, `background:#15181e`, más una barra vertical a la izquierda (`left:-10px`, `width:2.5px`, `radius:0 3px 3px 0`, `background:#FFAF3A`, `box-shadow:0 0 10px rgba(255,175,58,.7)`).
  - Badge de contador (Bandeja): Geist Mono 10px/600, `color:#231602`, `background:#FFAF3A`, `radius:20px`, `padding:1px 6px`.
- El `<nav>` debe llevar `flex:1 1 0; min-height:0; overflow-y:auto` — **crítico**: sin `min-height:0` empuja el footer fuera del viewport en pantallas bajas.
- **Ítems:** Bandeja (`inbox`, badge 6), Leads (`group`), Productos (`inventory_2`), Agente IA (`smart_toy`), Tags (`sell`), Métricas (`bar_chart`), Ajustes (`settings`).
- **Footer:** avatar 26×26 (`radius:8px`, `background:#1c1f26`, iniciales 10.5px/600), nombre 11.5px/550, rol 10px `#7C838E`, ícono `logout` 17px. Borde superior `#17191f`.
- **Nota:** el widget de gasto de IA **fue removido del sidebar** por pedido explícito — vive solo en Métricas → pestaña Agente IA.

#### 1.2 Lista de conversaciones (322px)

Fondo `#0a0b0e`.

**Encabezado:** "Bandeja" 17px/650/`-.02em` + contador de activas (Geist Mono 11px `#7C838E`). Debajo: punto verde `#34D399` de 5px con animación `pulseDot` + "Sincronizado en vivo · Meta Cloud API" (10.5px `#7C838E`).

**Selector de orden** (segmented control, `padding:3px`, `radius:10px`, `background:#101218`, `border:1px solid #1c1f26`):

- **Triage** (default) — agrupa por urgencia.
- **Recientes** — orden cronológico clásico.
- Ítem activo: `background:#FFAF3A`, `color:#231602`, `radius:7px`, 11.5px/600. Inactivo: `color:#8B909A`, fondo transparente.

**Filtros de canal** (chips, scroll horizontal): Todos / WhatsApp / Instagram / Messenger. `padding:4.5px 10px`, `radius:20px`, 11.5px/550. Cada uno con punto de color del canal (6px). Activo: `background:#1a1d24`, `border:1px solid #2a2e37`, `color:#ECEDEF`. Inactivo: transparente, `border:1px solid #1c1f26`, `color:#8B909A`.

**Modo Triage — dos grupos:**

_Grupo A — "Requieren tu atención"_ (encabezado: punto `#FFAF3A` + Geist Mono 9px uppercase `letter-spacing:.13em` `#FFAF3A` + contador). Filas completas:

- `padding:11px`, `radius:12px`, hover `background:#101218`, seleccionada `background:#15181e` + barra izquierda `#FFAF3A` 2.5px.
- Avatar 38×38 `radius:12px` `background:#1a1d24`, iniciales 12.5px/600 `#C8CCD3`. Punto de canal 13px abajo-derecha con `border:2.5px solid` del color de fondo del panel.
- Nombre 12.5px/600 truncado + timestamp Geist Mono 10px `#7C838E`.
- Preview del último mensaje 11.5px `#8B909A` truncado + badge de no leídos (`background:#FFAF3A`, `color:#231602`, Geist Mono 10px/600, `radius:20px`, mín 17px).
- **Chip de motivo** (lo que distingue el triage): `padding:5px 8px`, `radius:8px`, ícono 13px + texto 10.5px/600 + tiempo esperando (Geist Mono 9.5px, `opacity:.75`). Tres tipos:
  - `humano` — "Pidió hablar con una persona", ícono `pan_tool`, color `#E879F9`, fondo `rgba(232,121,249,.1)`, borde `rgba(232,121,249,.26)`
  - `bloqueo` — "Bloqueador: …", ícono `warning`, color `#FB923C`, fondo `rgba(251,146,60,.1)`, borde `rgba(251,146,60,.26)`
  - `pago` — "Pago sin comprobante", ícono `receipt_long`, color `#FBBF24`, fondo `rgba(251,191,36,.1)`, borde `rgba(251,191,36,.26)`
- Fila inferior: badge de etapa (10px/600, `padding:2.5px 7px`, `radius:6px`, color de la etapa sobre el mismo color al 13% alpha), badge "IA pausada" cuando corresponde (`#F87171` sobre `rgba(248,113,113,.13)`, ícono `pan_tool` 12px), e ícono `bolt` `#FB923C` a la derecha si es urgente.

_Grupo B — "La IA está manejando"_ (encabezado: ícono `auto_awesome` 13px `#6E7580` + Geist Mono 9px uppercase `#7C838E`). Filas **compactas**:

- `padding:8px 11px`, `radius:10px`, una sola línea de contenido.
- Avatar 26×26 `radius:8px` `background:#15181e`, iniciales 10px `#8B909A`.
- Nombre 12px/550 `#C8CCD3` + badge de etapa chico (9.5px, `padding:1.5px 6px`) + preview 11px `#7C838E` + timestamp Geist Mono 9.5px.

**Modo Recientes:** una sola lista, orden cronológico, filas completas, sin chips de motivo ni encabezados de grupo.

**Orden de prioridad en triage** (implementar como sort en el server): `requiere_humano` → bloqueador activo → `esperando_pago` sin comprobante → resto por recencia.

#### 1.3 Panel de conversación (flex:1, min-width 520px)

Fondo `#0d0e12` + patrón de puntos: `background-image:radial-gradient(circle at 1px 1px, rgba(255,255,255,.03) 1px, transparent 0); background-size:24px 24px`.

**Header** (`padding:13px 20px`, borde inferior `#17191f`, `background:rgba(13,14,18,.86)` + `backdrop-filter:blur(8px)`):

- Avatar 36×36 `radius:11px` con punto de canal.
- Nombre 14.5px/650 truncado + badge de etapa.
- Segunda línea (Geist Mono 10.5px `#7C838E`, una sola línea con truncado): teléfono · canales · "últ. actividad {tiempo}". Separadores `·` en `#2c3038`.
- **Toggle IA** (clickeable, `padding:6px 11px`, `radius:9px`, 11.5px/600, punto 6px):
  - Activa: `color:#34D399`, `background:rgba(52,211,153,.1)`, `border:1px solid rgba(52,211,153,.28)`, punto con `pulseDot`.
  - Pausada: `color:#FB923C`, `background:rgba(251,146,60,.1)`, `border:1px solid rgba(251,146,60,.28)`, sin animación.
  - **El estado es por conversación**, no global. Una conversación en `requiere_humano` abre con la IA pausada.
- Botón icónico "Cerrar sesión" (30×30, ícono `task_alt` 16px) y `more_horiz` 19px.

**Hilo de mensajes** (`display:flex; flex-direction:column-reverse; gap:9px; overflow-y:auto; padding:20px 26px` — el `column-reverse` ancla el scroll abajo). Cinco tipos de burbuja:

| Tipo                  | Alineación | Fondo                                                                                               | Radio                | Detalle                                                                                                                                          |
| --------------------- | ---------- | --------------------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Sistema               | centrada   | —                                                                                                   | —                    | Línea `#1a1d24` a cada lado, texto Geist Mono 9.5px uppercase `#6E7580`                                                                          |
| Entrante (cliente)    | izquierda  | `#191c22`, borde `#21242c`                                                                          | `15px 15px 15px 5px` | Texto 12.5px `#E4E6EA`                                                                                                                           |
| Agente IA             | derecha    | `linear-gradient(150deg, rgba(255,175,58,.16), rgba(255,175,58,.07))`, borde `rgba(255,175,58,.22)` | `15px 15px 5px 15px` | Etiqueta "AGENTE IA" (ícono `auto_awesome` 12px + Geist Mono 9px uppercase `#FFC46B`), texto `#F2EDE4`                                           |
| Vendedor              | derecha    | `#E8EAEE` (claro)                                                                                   | `15px 15px 5px 15px` | Etiqueta "VENDEDOR" Geist Mono 9px `#7C838E`, texto 12.5px `#14161b`                                                                             |
| Llamada a herramienta | derecha    | `rgba(255,175,58,.045)`, **borde punteado** `1px dashed rgba(255,175,58,.28)`                       | `13px`               | Encabezado "HERRAMIENTA · buscar_repuesto" (ícono `database_search`), la invocación en Geist Mono 11px, y meta: "3 resultados · 180 ms · $0,004" |

Ancho máximo de burbuja: `62%`. Hora en Geist Mono 9.5px alineada a la derecha.

**Estados de entrega** (solo en salientes — IA y vendedor), ícono 12px junto a la hora:

| Estado      | Ícono      | Color     |
| ----------- | ---------- | --------- |
| `enviado`   | `done`     | `#8B909A` |
| `entregado` | `done_all` | `#8B909A` |
| `leido`     | `done_all` | `#7FB3F5` |
| `fallido`   | `error`    | `#F87171` |

`fallido` debe ofrecer reintento (no maquetado en detalle — resolver con el patrón de la app).

**Sugerencia del agente** (barra sobre el composer, `margin:0 26px`, `padding:11px 13px`, `radius:13px`, `background:rgba(255,175,58,.06)`, `border:1px solid rgba(255,175,58,.24)`, animación `riseIn .3s`):

- Encabezado: ícono `auto_awesome` + "SUGERENCIA DEL AGENTE" (Geist Mono 9.5px uppercase `#FFAF3A`) + "confianza 0.91" + `close`.
- Texto sugerido 12.5px `#E4E6EA`.
- Acciones: **Enviar** (`background:#FFAF3A`, `color:#231602`, 11.5px/650), **Editar** (`background:#191c22`, `border:1px solid #23262d`), **Descartar** (solo texto `#8B909A`).
- Se oculta si la IA está pausada o la ventana de 24 h está cerrada.

**Composer — dos estados según la ventana de 24 h de WhatsApp:**

_Ventana abierta:_ sobre el input, una línea con ícono `schedule` 13px `#34D399` + "Ventana de 24 h abierta · quedan 21 h 58 m" (Geist Mono 9.5px) + barra de progreso (máx 130px, alto 3px, `#34D399` sobre `#1c1f26`). Input: `padding:9px 10px 9px 14px`, `radius:14px`, `background:#14161b`, `border:1px solid #21242c`, placeholder 12.5px + hint "Enter envía · ⇧Enter salto de línea" (Geist Mono 10px `#5F6672`). Acciones: `attach_file`, `bolt` (respuestas rápidas) y botón de envío 32×32 `radius:9px` `background:#FFAF3A` con `box-shadow:0 3px 12px rgba(240,138,29,.3)`.

_Ventana cerrada:_ el input se reemplaza por un bloque (`background:#141116`, `border:1px solid rgba(251,146,60,.28)`, `radius:14px`): ícono `lock_clock` `#FB923C` + "Ventana de 24 h cerrada" + "último mensaje del cliente hace 31 h"; explicación ("Meta no permite mensajes libres. Solo plantillas aprobadas hasta que el cliente vuelva a escribir."); y chips de plantillas aprobadas (`background:#191c22`, `border:1px solid #23262d`, punto verde 5px) + "Ver todas →".

> **Implementación:** la ventana se calcula desde el timestamp del último mensaje **entrante** (`mensajes.direccion = 'in'`). `now - ultimoEntrante >= 24h` ⇒ cerrada. Debe recalcularse en cliente (intervalo) para que no quede obsoleta con la pestaña abierta.

#### 1.4 Lead Twin (322px)

Fondo `#0a0b0e`, borde izquierdo `#17191f`, `overflow-y:auto`. Secciones separadas por `border-bottom:1px solid #17191f`, `padding:15px 17px`.

**Encabezado:** ícono `contact_emergency` `#FFAF3A` + "Lead Twin" 12.5px/650 + "hace 40 s" con punto verde animado. Subtítulo: "Ficha mantenida por el extractor LLM en cada turno. No hace falta leer el hilo." (10.5px `#7C838E`).

**Procedencia por campo** — el punto central de este panel. Cada sección declara de dónde salió el dato con un chip de 9px/600, `padding:1.5px 6px`, `radius:5px`:

| Chip                               | Color     | Fondo                       | Significado                                           |
| ---------------------------------- | --------- | --------------------------- | ----------------------------------------------------- |
| `auto_awesome` **Extraído por IA** | `#FFC46B` | `rgba(255,175,58,.12)`      | Lo infirió el extractor. Editable.                    |
| `edit` **Corregido por vos**       | `#7FB3F5` | `rgba(127,179,245,.12)`     | Un humano lo pisó; el extractor no lo vuelve a tocar. |
| `inventory_2` **Del catálogo**     | `#8B909A` | `#16191f` + borde `#21242c` | Dato duro de la DB. No editable.                      |

Además, bajo los campos extraídos: la línea de origen en Geist Mono 9.5px `#6E7580` ("origen: mensaje del cliente · 09:12") y, en los corregidos, qué había inferido antes ("el extractor había inferido «Hilux 2.8» · tu corrección tiene prioridad").

**Secciones (en orden):**

1. **Etapa inferida** — nombre de la etapa 18px/680 en su color + "paso N/6". Debajo, rail de 6 segmentos (`height:3.5px`, `gap:3px`): pasados/actual en el color de la etapa, futuros en `#1c1f26`. Labels "nuevo" / "cerrado" en Geist Mono 9px.
   - **Regla importante:** el embudo son las 6 primeras etapas (`nuevo → identificando → cotizado → negociando → esperando_pago → cerrado`). `perdido` y `requiere_humano` **no son pasos 7 y 8**: son desvíos. Cuando la etapa es un desvío, el rail se congela en gris `#3A3F49` hasta la última etapa alcanzada (campo `alcanzada`), se oculta el contador de pasos y aparece un chip de desvío (ícono `alt_route`, `color:#E879F9`, fondo `rgba(232,121,249,.09)`) con el texto "El embudo quedó frenado en «Identificando»".
2. **Vehículo** — tarjeta `background:#101218`, `border:1px solid #1c1f26`, `radius:12px`, ícono `directions_car` 22px. Modelo 12.5px/600 + motor/patente Geist Mono 10px. Editable (ícono `edit` a la derecha, hover `border-color:#2f333c`).
3. **Consulta** — párrafo 12.5px `#E4E6EA` con `text-wrap:pretty`. Editable.
4. **Urgencia** — tres barras de 18×4px (`radius:3px`): alta `#FB923C` ×3, media `#FBBF24` ×2, baja `#8B909A` ×1; las vacías en `#23262d`. Label 11px/600 en el mismo color.
5. **Cotización** (solo si existe) — badge de stock verde. Tarjeta `background:linear-gradient(160deg,#141116,#101218)`, `border:1px solid #23262d`: producto 12px/600, SKU Geist Mono 10px `#FFAF3A`, precio **Geist Mono 25px/600 `-.03em` blanco**, "IVA incl. · x{cantidad}".
6. **Bloqueador** (solo si existe) — `background:rgba(251,146,60,.07)`, `border:1px solid rgba(251,146,60,.24)`, ícono `warning` `#FB923C`, etiqueta "BLOQUEADOR" Geist Mono 9px uppercase, texto 11.5px `#E4D9CB`.
7. **Pago** — método y comprobante como pares label/valor 11.5px.
8. **Tags** — chips 10.5px/550 `background:#16191f`, `border:1px solid #21242c`, `radius:6px` + "+ Agregar" con `border:1px dashed`.
9. **Historial** — "Sesión iniciada", "Sesiones previas" (ej. "4 · 3 con compra") y un bloque de resumen (`background:#101218`, 11px `#8B909A`) con la etiqueta "Resumen:" en `#C8CCD3`.

Todas las secciones condicionales (cotización, bloqueador, corrección) se ocultan si el lead no tiene ese dato — **no** dejar secciones vacías.

---

### 2. Leads — `/leads`

Header: "Leads" 22px/680/`-.03em` + "1.024 esta semana · 7 con sesión activa" 12px `#7C838E`. Buscador de 250px a la derecha (mismo estilo que el del sidebar).

Tabla en tarjeta (`radius:15px`, `background:#0f1116`, `border:1px solid #1c1f26`):

- Grid `1.5fr 1.1fr 1.4fr .9fr .8fr`, `gap:14px`, `padding:11px 18px`.
- Encabezados: Geist Mono 9px uppercase `letter-spacing:.13em` `#7C838E`. Columnas: Lead / Teléfono / Vehículo / Etapa / Actividad.
- Filas: avatar 28×28 con punto de canal + nombre 12.5px/550; teléfono Geist Mono 11px; vehículo 11.5px `#A9AEB7`; badge de etapa; actividad Geist Mono 10.5px alineada a la derecha. Separador `1px solid #14161b`, hover `background:#14161b`.

> Pantalla llevada al nuevo lenguaje visual pero **sin cambios estructurales**. Pendiente de diseño: la ficha individual del lead y el flujo de merge de duplicados (existe `merge_candidates` en el schema).

---

### 3. Métricas — `/metricas`

Hoy es un stub (`TODO: métricas básicas (Fase 8)`). Diseñada de cero.

Header: "Métricas" + rango "Últimos 7 días · 29 jul – 2 ago 2026". Selector 7 / 30 / 90 días (activo: `background:#FFAF3A`, `color:#231602`).

**Tres pestañas** (borde inferior 2px `#FFAF3A` en la activa, ícono 16px + label 12.5px/600), con una aclaración a la derecha de qué mide cada una:

| Pestaña    | Ícono          | Aclaración                                |
| ---------- | -------------- | ----------------------------------------- |
| Total      | `dashboard`    | "IA + vendedores combinados"              |
| Agente IA  | `auto_awesome` | "solo turnos resueltos por el agente"     |
| Vendedores | `group`        | "solo conversaciones tomadas por humanos" |

**Tarjeta KPI** (patrón común a las tres pestañas): `padding:16px 17px`, `radius:15px`, `background:#0f1116`, `border:1px solid #1c1f26`. Label Geist Mono 9px uppercase `#7C838E`; valor **Geist Mono 28px/600 `-.035em` blanco**; delta 11px/600 (`#34D399` positivo, `#F87171` negativo, `#7FB3F5` neutro); subtítulo 10.5px `#7C838E`; ícono decorativo 19px `#23262d` arriba a la derecha.

#### 3.1 Total

- KPIs: Leads nuevos (1.024, +12,4%) · Tasa de cierre (23,4%, +2,1 pts) · 1ra respuesta (8 s, −41%) · Costo IA / lead ($0,04, −9%).
- **Embudo por etapa inferida** (grid `1.55fr 1fr`): filas con label de 112px, barra de 22px (`radius:6px`, `background:#14161b`, relleno en el color de la etapa al 85% de opacidad), conteo y porcentaje en Geist Mono.
- **Volumen por canal:** barra apilada de 9px (WhatsApp `#25D366` 68%, Instagram `#E1306C` 21%, Messenger `#1877F2` 11%) + leyenda con punto, porcentaje y conteo.
- **Quién cerró la venta:** barra apilada IA (`#FFAF3A`, 61%) vs. vendedor (`#7FB3F5`, 39%), con la observación "El ticket promedio del vendedor es 2,1× el de la IA — conviene escalar antes en cotizaciones altas."

#### 3.2 Agente IA

- KPIs: Resueltas sin humano (71,4%) · Escaladas a humano (12,8%) · Latencia 1ra respuesta (8 s) · Costo por lead ($0,04).
- **Cómo resolvió cada turno:** barras con label de 150px + porcentaje + costo — Regla IF/THEN 41% ($0,00, `#34D399`), LLM 46% ($41,20, `#FFAF3A`), Escalado a humano 13% (`#7FB3F5`). Subtítulo: "Las reglas IF/THEN no consumen tokens: cada punto que sube esta franja baja el costo".
- **Uso del catálogo:** llamadas a `buscar_repuesto` (1.842), sin resultado (214, badge rojo "demanda perdida"), cotizó con stock en 0 (37, "revisar").
- **Gasto de IA hoy** (movido acá desde el sidebar): tarjeta destacada `background:linear-gradient(160deg,#151116,#0f1116)`, `border:1px solid rgba(255,175,58,.24)`. "$4,12" Geist Mono 30px + "/ $10,00"; barra de 6px con gradiente `#F08A1D → #FFC46B` al 41%; "41% del tope · kill switch inactivo"; y desglose: tokens entrada/salida (412k / 96k), turnos con LLM (1.284), ahorro por reglas (−$2,86 en `#34D399`).
- **Intents sin regla:** lista con conteo y **costo diario** de cada uno ("$0,38/día"), con acción "Aprobar". Subtítulo: "Cada uno se responde con LLM hoy — aprobar la regla lo vuelve gratis".

#### 3.3 Vendedores

- KPIs: Conversaciones tomadas (218) · Cierre tras handoff (38,6%) · Ticket promedio ($312k, "2,1× IA") · Tiempo hasta tomar (4 m 12 s, +52 s en rojo).
- **Rendimiento por vendedor:** tabla grid `1.4fr .8fr 1fr .8fr 1fr .8fr` — Vendedor / Tomadas / Toma en / Cerradas / Ticket prom. / Cierre. "Toma en" se colorea: `#34D399` bueno, `#ECEDEF` normal, `#F87171` lento. Subtítulo: "Solo conversaciones tomadas por humano — excluye lo que cerró la IA".
- **Por qué se escaló a humano:** barras horizontales de 5px por motivo (pidió humano 96 `#E879F9`, intents desconocidos 61 `#FFAF3A`, pausa manual 41 `#7FB3F5`, bloqueador sin resolver 20 `#FB923C`) + lectura: "44% de los handoffs son «pidió humano»: la IA está reteniendo bien, el cuello está en la disponibilidad del equipo."

---

### 4. Agente IA — `/intents` (o `/agente`)

Consola de configuración del agente. **Pantalla nueva**, reemplaza el ítem "Intents y reglas" de la nav.

Header: "Agente IA" + "Reglas, escalado y límites del vendedor automático". A la derecha, panel de estado: punto verde animado + "Agente operando" / "1.284 turnos hoy · sin incidentes" + botón **Pausar todo** (`color:#F87171`, hover `border-color:#F87171`).

Cuatro pestañas (mismo patrón que Métricas): Reglas IF/THEN (`account_tree`) · Escalado (`pan_tool`) · Comportamiento (`psychology`) · Límites y costo (`speed`).

#### 4.1 Reglas IF/THEN — grid `1.35fr 1fr`

**Intents pendientes de aprobación** (tarjeta destacada ámbar): "2 intents esperando tu aprobación" + "detectados por el cron semanal". Cada uno: label entre comillas, meta ("96 veces esta semana · $0,38/día en LLM · confianza 0,93"), botón **Crear regla** (ámbar sólido) e **Ignorar**.

**Tabla de reglas activas** — grid `1.6fr .7fr .7fr 44px`: Regla / Usos/sem / Ahorro / On. Subtítulo: "se ejecutan antes del LLM — sin costo de tokens". Cada fila: nombre 12px/600 (atenuado a `#7C838E` si está apagada) + "intent: {slug}" en Geist Mono 9.5px; usos; ahorro en `#34D399`; y un **switch** (30×17, `radius:20px`, knob 12px blanco; on `background:#FFAF3A` con knob en `left:15.5px`, off `#23262d` con knob en `left:2.5px`, transición `.16s`). Clic en la fila selecciona; clic en el switch activa/desactiva.

**Detalle de la regla seleccionada** (columna derecha, `position:sticky; top:22px`):

- Bloque **SI**: etiqueta Geist Mono 9.5px `#7FB3F5`, condiciones en Geist Mono 11px sobre `background:#14161b`.
- Bloque **ENTONCES**: etiqueta `#FFAF3A` sobre `rgba(255,175,58,.06)` con borde ámbar; la respuesta 11.5px `#F2EDE4`; y "variables: {horario_semana}, {horario_sabado}" en Geist Mono 9.5px.
- Nota al pie con ícono `bolt` verde ("Evita 214 llamadas al LLM por semana").
- **Probador:** input de ejemplo, resultado ("Coincide", badge verde + "intent: envios · 0,94 · sin LLM") y la respuesta renderizada como burbuja.

#### 4.2 Escalado — grid `1.35fr 1fr`

**Cuándo pasar a un humano** — "La primera condición que se cumpla pausa la IA y manda la conversación al triage". Cada condición: ícono 18px en su color, label 12px/600, subtítulo 10.5px, **stepper** (− valor +, Geist Mono 11.5px, ancho mínimo 62px) cuando aplica, y switch.

| Condición                              | Ícono / color        | Valor  | Rango               |
| -------------------------------------- | -------------------- | ------ | ------------------- |
| El cliente pide hablar con una persona | `pan_tool` `#E879F9` | —      | —                   |
| Intents desconocidos seguidos          | `help` `#FB923C`     | 2      | 1–5                 |
| Cotización mayor a                     | `sell` `#FFAF3A`     | $500k  | 100–2000, paso 100  |
| Urgencia alta sin cerrar en            | `bolt` `#FBBF24`     | 10 min | 5–60, paso 5        |
| Fuera de horario                       | `schedule` `#7FB3F5` | —      | — (off por defecto) |

**Palabras que escalan siempre:** chips removibles (reclamo, abogado, devolución, factura A, roto) + "+ Agregar" punteado. "Coinciden sin importar el intent detectado".

**A quién le llega:** lista ordenable (ícono `drag_indicator`) con posición, avatar, nombre y badge de estado (Disponible `#34D399` / Ausente `#7C838E`).

#### 4.3 Comportamiento — grid `1.35fr 1fr`

**Cómo habla el agente** — "Afecta todas las respuestas generadas con LLM, no las reglas fijas". Tres grupos de botones segmentados (`flex:1`, `padding:8px 0`, `radius:9px`; activo `background:#FFAF3A` `color:#231602`, inactivo `background:#14161b` `border:1px solid #23262d`):

- **Tono:** Formal / Neutro / Cercano (vos) ← default
- **Largo:** Corto ← default / Medio / Detallado
- **Emojis:** Nunca ← default / Ocasional / Libre

**Descuento máximo que puede ofrecer solo:** slider (track 5px, relleno con gradiente ámbar, knob 15px `#FFC46B` con `border:2px solid #0f1116`) + stepper. Default 5%, rango 0–20%. Nota: "Por encima de eso pide autorización al vendedor antes de ofrecerlo."

**Reglas duras** (bloqueadas, ícono `verified_user` verde + candado): no prometer stock sin consultar el catálogo · no inventar códigos ni compatibilidades · siempre informar precios con IVA · derivar reclamos y garantías a un humano. "No se pueden desactivar: protegen contra respuestas inventadas".

**Vista previa** (sticky): pregunta del cliente + respuesta del agente que **cambia en vivo** con el tono elegido. Al pie, resumen en Geist Mono: "tono: cercano · largo: corto · emojis: nunca".

Textos de preview por tono:

- _Formal:_ "Buenos días. El kit de embrague para Toyota Hilux 2.4 TDI 2018 (código KE-4482-VL) tiene un valor de $ 486.900 IVA incluido, con 4 unidades disponibles."
- _Neutro:_ "El kit de embrague para la Hilux 2018 2.4 TDI cuesta $ 486.900 con IVA. Código KE-4482-VL, hay 4 en stock."
- _Cercano:_ "¡Hola! El kit de embrague para tu Hilux 2018 2.4 sale $ 486.900 con IVA — código KE-4482-VL. Tengo 4 en stock, ¿te lo reservo?"

#### 4.4 Límites y costo — grid `1.35fr 1fr`

**Modelo y límites técnicos** — filas label/subtítulo/valor: Modelo (GPT-4.1, "se puede cambiar sin tocar código — Vercel AI SDK") · Máximo de turnos por sesión (15) · Timeout de herramienta (3 s) · Reintentos ante error de Meta (2) · Ventana de contexto por sesión (12 mensajes además del Twin).

**Tope de gasto diario:** misma tarjeta ámbar que en Métricas ($10,00 / usados $4,12 / barra al 41%). Debajo, **radios** de qué hacer al llegar al tope (círculo 13px con borde `#FFAF3A` y relleno cuando está activo; fila activa `background:rgba(255,175,58,.09)` `border:1px solid rgba(255,175,58,.3)`):

- Pausar la IA y avisar al equipo ← default
- Seguir solo con reglas IF/THEN
- Seguir generando (sin tope real)

**Horario del agente:** L-V 08:00–18:00 · Sábados 08:00–13:00 · Domingos y feriados Cerrado. "Fuera de horario responde con plantilla y no genera con LLM".

---

## Interactions & Behavior

**Navegación**

- SideNav cambia de pantalla. Bandeja / Leads / Métricas / Agente IA están diseñadas; Productos, Tags y Ajustes quedan pendientes.
- Seleccionar una conversación **no navega a otra página**: actualiza los paneles 2 y 3. La URL sí debería reflejar `/inbox/[leadId]` (shallow routing) para deep-linking y refresh.

**Transiciones** — todas cortas y sobrias: `transition: background .16s, color .16s` en ítems de nav, filas y chips; `left .16s` en el knob de los switches. Solo dos animaciones:

- `pulseDot` — 2 s `ease-in-out` infinita, `opacity 1→.35` + `scale 1→.82`. Solo en indicadores de estado en vivo.
- `riseIn` — .3 s, `translateY(6px)` + fade. Solo al aparecer la sugerencia de IA.

**Estados interactivos implementados en el prototipo**

- Filtros de canal filtran la lista.
- Triage / Recientes reordena y reagrupa.
- Toggle de IA por conversación (persiste por lead mientras dura la sesión de UI).
- Descartar sugerencia.
- Pestañas de Métricas y de Agente IA.
- Switches de reglas, steppers de escalado, segmentados de comportamiento, slider de descuento, radios de kill switch.

**Estados faltantes (definir en implementación)**

- Loading / skeleton de cada panel.
- Empty states: sin conversaciones, sin resultados de filtro, lead sin Twin todavía.
- Error: fallo de envío con reintento, webhook de Meta caído, cola de Inngest atrasada.
- Optimistic UI al enviar un mensaje.

**Responsive** — no definido. El layout scrollea horizontalmente por debajo de 1164px. Si se necesita móvil, hay que diseñarlo: probablemente lista → conversación → Twin en drawer.

## State Management

Estado de UI (cliente):

```
screen                 pantalla activa
activeId               conversación seleccionada
canal                  filtro de canal: todos | wa | ig | fb
listMode               triage | recientes
iaPorConv              { [leadId]: boolean }  override manual del toggle
sugerencia             sugerencia visible / descartada
metricaTab             total | ia | vendedores
agTab                  reglas | escalado | comporta | limites
reglaSel               regla seleccionada en el detalle
reglasOn               { [reglaId]: boolean }
escOn / escVal         condiciones de escalado (on/off y valores numéricos)
tono / largo / emoji   comportamiento del agente
descuento              0–20
kill                   pausar | reglas | seguir
```

Datos que el server debe proveer:

- **Lista de conversaciones** con: lead, canal(es), etapa, último mensaje, no leídos, **motivo de triage** y **tiempo esperando**, y `ultimoMensajeEntranteAt` (para la ventana de 24 h).
- **Hilo** por lead: mensajes con `direccion`, `origen` (ia / vendedor / sistema / herramienta), `estadoEntrega`, timestamp; y las llamadas a herramienta con resultado, latencia y costo.
- **Lead Twin** por lead: cada campo con `valor`, `origen` (ia / humano / catalogo), `mensajeOrigenId` y `valorAnteriorIA` cuando fue corregido.
- **Métricas** en tres cortes: total, solo turnos del agente, solo conversaciones tomadas por humano. La separación IA / vendedor debe existir **en la query**, no calcularse en el cliente.
- **Configuración del agente**: reglas, condiciones de escalado, comportamiento y límites — todo persistido y editable.

## Design Tokens

**Superficies**

| Token          | Hex                   | Uso                                        |
| -------------- | --------------------- | ------------------------------------------ |
| bg-root        | `#08090b`             | Fondo del documento y SideNav              |
| bg-panel       | `#0a0b0e`             | Lista, Twin, páginas de contenido          |
| bg-chat        | `#0d0e12`             | Panel de conversación (+ patrón de puntos) |
| bg-card        | `#0f1116`             | Tarjetas                                   |
| bg-elevated    | `#101218`             | Inputs, tarjetas internas                  |
| bg-input       | `#14161b`             | Composer, filas internas                   |
| bg-hover       | `#15181e` / `#101218` | Fila seleccionada / hover                  |
| bg-avatar      | `#1a1d24`             | Avatares                                   |
| bg-bubble-in   | `#191c22`             | Burbuja del cliente                        |
| bg-bubble-vend | `#E8EAEE`             | Burbuja del vendedor (clara)               |

**Bordes:** `#17191f` (divisiones de layout) · `#1c1f26` (tarjetas) · `#21242c` (inputs, burbujas) · `#23262d` (controles).

**Texto**

| Token          | Hex       | Uso                      |
| -------------- | --------- | ------------------------ |
| text-primary   | `#ECEDEF` | Principal                |
| text-body      | `#E4E6EA` | Cuerpo de mensajes       |
| text-secondary | `#C8CCD3` | Iniciales, valores       |
| text-muted     | `#A9AEB7` | Labels de tabla          |
| text-dim       | `#8B909A` | Previews, subtítulos     |
| text-faint     | `#7C838E` | Etiquetas, meta          |
| text-fainter   | `#6E7580` | Procedencia, separadores |
| text-ghost     | `#5F6672` | Hints, íconos inactivos  |

> `#7C838E` / `#6E7580` / `#5F6672` fueron elevados desde valores más oscuros para llegar a ~3:1 sobre `#0a0b0e`. **No bajarlos**: es una herramienta de uso continuo.

**Acento (marca)**

| Token        | Hex       | Uso                           |
| ------------ | --------- | ----------------------------- |
| accent       | `#FFAF3A` | Acento principal, activos, IA |
| accent-hover | `#FFC46B` | Hover, gradientes             |
| accent-deep  | `#F08A1D` | Gradientes                    |
| accent-ink   | `#231602` | Texto sobre ámbar             |

**Semánticos**

| Token   | Hex       | Uso                         |
| ------- | --------- | --------------------------- |
| success | `#34D399` | En vivo, ahorro, cerrado    |
| warning | `#FB923C` | Bloqueador, urgencia alta   |
| caution | `#FBBF24` | Pendiente, negociando       |
| danger  | `#F87171` | Fallido, perdido            |
| info    | `#7FB3F5` | Leído, corregido por humano |
| special | `#E879F9` | Requiere humano, desvío     |

**Etapas** (`current_stage`)

| Etapa           | Color     |
| --------------- | --------- |
| nuevo           | `#38BDF8` |
| identificando   | `#818CF8` |
| cotizado        | `#A78BFA` |
| negociando      | `#FBBF24` |
| esperando_pago  | `#FB923C` |
| cerrado         | `#34D399` |
| perdido         | `#F87171` |
| requiere_humano | `#E879F9` |

Los badges usan el color al **13% de alpha** como fondo y el color pleno como texto.

**Canales:** WhatsApp `#25D366` · Instagram `#E1306C` · Messenger `#1877F2`.

**Tipografía**

- **Geist** (300–800) — UI. Google Fonts.
- **Geist Mono** (400–600) — números, IDs, timestamps, SKUs, meta técnica. Regla: **todo dato que se compara o se escanea va en mono**.
- **Material Symbols Rounded** (`opsz 24, wght 300, FILL 0, GRAD 0`) — íconos. Nada dibujado a mano en SVG.

| Rol               | Tamaño / peso / tracking        |
| ----------------- | ------------------------------- |
| Título de página  | 22px / 680 / `-.03em`           |
| Título de sección | 17px / 650 / `-.02em`           |
| Título de tarjeta | 13px / 650 / `-.015em`          |
| Nombre en header  | 14.5px / 650 / `-.015em`        |
| Cuerpo / mensajes | 12.5px / 400                    |
| Label de fila     | 11.5px / 550                    |
| Secundario        | 10.5px / 400                    |
| Eyebrow (mono)    | 9px / 600 / `.13em` / uppercase |
| KPI (mono)        | 28px / 600 / `-.035em`          |
| Precio (mono)     | 25px / 600 / `-.03em`           |

`line-height` base 1.45. Usar `text-wrap: pretty` en párrafos.

**Radios:** 5–6px chips · 8–9px botones y controles · 10–12px filas y tarjetas internas · 13–15px tarjetas y burbujas · 20px+ píldoras.

**Espaciado:** escala de 2px. Padding típico: 15–20px en tarjetas, 11px en filas, 24–30px en headers de página. `gap` en flex/grid — **no** márgenes por elemento.

**Sombras:** solo dos, ambas ámbar. `0 4px 14px rgba(240,138,29,.28)` (logo) y `0 3px 12px rgba(240,138,29,.3)` (botón de envío). No hay sombras neutras: la jerarquía la dan las superficies.

**Scrollbars:** 9px, thumb `#23262d` (hover `#343841`) con `border:2px solid transparent` + `background-clip:content-box`, track transparente.

## Assets

- **Fuentes:** Geist y Geist Mono desde Google Fonts (`fonts.googleapis.com`). Material Symbols Rounded para íconos.
- **Logo:** el prototipo usa una marca generada (cuadrado ámbar + `settings_suggest`) porque no había identidad definida. Existe `public/logo.png` en el repo — reemplazar si esa es la marca real.
- **Imágenes:** ninguna. Los avatares son iniciales sobre fondo sólido.
- Sin dependencias de gráficos: barras, embudos y sliders son divs con `width` en porcentaje.

## Files

| Archivo                    | Qué es                                                                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `CRM Repuestos v2.dc.html` | **Diseño de referencia principal.** Bandeja con triage, ventana de 24 h, Twin con procedencia, Métricas en 3 cortes, consola del Agente IA. |
| `CRM Repuestos v1.dc.html` | Primera iteración. Solo como referencia histórica — no implementar.                                                                         |
| `support.js`               | Runtime del prototipo. **No portar.**                                                                                                       |

Abrir los `.dc.html` directamente en el navegador (los tres archivos deben estar en la misma carpeta).

### Cómo leer el prototipo

- `<sc-for list="{{ items }}" as="item">` → `items.map(item => …)`
- `<sc-if value="{{ cond }}">` → `{cond && …}`
- `{{ path }}` → interpolación de una variable
- Estilos inline con valores literales → clases de Tailwind
- La clase `Component` al final del archivo tiene toda la data ficticia y la lógica de estado

## Orden sugerido de implementación

1. **Tokens y layout base** — paleta oscura en `globals.css`, fuentes, SideNav, shell de 3 paneles.
2. **Bandeja sin triage** — layout unificado con orden cronológico y las burbujas nuevas. Ya es una mejora entregable.
3. **Ventana de 24 h + estados de entrega** — lo que evita ventas perdidas por mensajes que fallan en silencio.
4. **Triage** — requiere el cálculo de motivo y prioridad en el server.
5. **Twin con procedencia y edición** — requiere migración: guardar `origen` y `mensajeOrigenId` por campo.
6. **Métricas** — requiere que las queries separen turnos de IA de conversaciones tomadas por humanos.
7. **Consola del Agente IA** — requiere persistir la configuración.

## Pendientes de diseño

No maquetados todavía; se pueden pedir:

- **Presencia y bloqueo entre vendedores** — quién tomó cada conversación y desde cuándo. Con 3-4 personas sobre la misma bandeja, hoy dos pueden responderle al mismo cliente.
- **Auditoría por turno** — por qué el agente respondió lo que respondió, si fue regla o LLM, por qué cambió la etapa.
- **Duplicados / merge** — existe `merge_candidates` en el schema y no tiene lugar en la nav.
- **Barra global de sistema** — para incidentes: tope de gasto alcanzado, webhook de Meta caído, cola atrasada.
- **Ficha individual del lead**, Productos, Tags, Ajustes, Login.
- **Atajos de teclado** — `j`/`k` para navegar, `/` para buscar, `⌘↵` para enviar la sugerencia. El chip `⌘K` del buscador hoy es decorativo.
- **Layout móvil / tablet.**
