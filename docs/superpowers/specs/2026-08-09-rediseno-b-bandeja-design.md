# Rediseño "sala de control" — Sub-proyecto B: Bandeja unificada

> Fecha: 2026-08-09 · Estado: aprobado, pendiente de plan
> Handoff §1 (Bandeja). Referencia: `CRM Repuestos v2.dc.html`
> Depende de A (base visual, en master). Precede a D (triage), C (ventana 24 h) y E (Twin con procedencia).

---

## 1. Problema

Hoy la Bandeja son **dos páginas separadas**:

- `src/app/(panel)/inbox/page.tsx` — 26 líneas: header, tabs de canal, lista, poller.
- `src/app/(panel)/inbox/[leadId]/page.tsx` — pantalla completa con conversación + Twin.

Hacer click en una conversación **te saca de la lista**. Para pasar a la siguiente hay que volver. Con una bandeja de decenas de conversaciones, el vendedor navega en vez de atender.

El handoff lo resume en su primer objetivo: que el vendedor atienda _"lo que la IA no puede resolver o donde hay plata en juego, no lo último que entró"_. Sin ver la lista mientras responde, eso es imposible.

### 1.1 Lo que ya existe y no hay que rehacer

`/inbox/[leadId]` **ya tiene dos de los tres paneles**: `ChatThread` + `MessageInput` en el centro, `TwinPanel` en un `<aside>` de 320px. Y ya están construidos `ConversationHeader`, `HandoffToggle`, `CloseSessionButton`, `InboxList`, `InboxListItem`, `MessageBubble`, `ChannelIcons`, `ChannelTabs`.

B **no construye paneles nuevos**: mueve la lista adentro del mismo layout y reviste lo que hay con el lenguaje del handoff.

---

## 2. Alcance

### 2.1 Dentro

1. Layout de 3 paneles compartido por `/inbox` y `/inbox/[leadId]`.
2. Panel de lista al diseño: encabezado, indicador en vivo, filtros de canal, filas.
3. Panel de conversación: fondo con patrón de puntos, header, hilo con las 5 burbujas del handoff, composer.
4. Panel del Twin revestido (sin procedencia — eso es E).
5. Estado vacío cuando no hay conversación seleccionada.

### 2.2 Fuera — cada uno es su sub-proyecto

| Qué                                                     | Por qué no acá                                                        |
| ------------------------------------------------------- | --------------------------------------------------------------------- |
| Toggle **Triage / Recientes**, grupos y chips de motivo | Sub-proyecto **D**: requiere calcular motivo y prioridad en el server |
| Bloque **ventana de 24 h** y plantillas                 | Sub-proyecto **C**: requiere migración                                |
| **Estados de entrega** (`✓✓`)                           | Sub-proyecto **C**: hoy los webhooks de status de Meta se descartan   |
| **Chips de procedencia** del Twin                       | Sub-proyecto **E**: requiere migración por campo                      |
| **Sugerencia del agente** sobre el composer             | Requiere que el agente proponga sin enviar. Va después de D           |
| Burbuja de **llamada a herramienta**                    | `tool_executions` existe pero no está unida al hilo. Va con D         |
| Buscador `⌘K`, badge contador de la nav                 | Siguen decorativos, ya declarados en A                                |

**Regla de alcance:** B no toca repositorios, servicios, migraciones ni Server Actions. Si algo parece necesitarlo, pertenece a C, D o E.

---

## 3. Arquitectura: un layout, no una máquina de estados

El handoff dice que seleccionar una conversación _"no navega a otra página: actualiza los paneles 2 y 3"_, y que la URL debe reflejar `/inbox/[leadId]`.

En Next App Router eso **no requiere estado en cliente**. Se resuelve con un layout compartido:

```
src/app/(panel)/inbox/
  layout.tsx          ← panel de lista + {children}
  page.tsx            ← estado vacío
  [leadId]/page.tsx   ← conversación + Twin
```

Al navegar entre hijos, **Next preserva el layout**: la lista no se remonta, no se re-fetchea y no pierde su scroll. Se obtiene el comportamiento del prototipo con routing normal.

Esta decisión es la que mantiene B chico. La alternativa —un componente cliente con `activeId` en estado y fetch de la conversación por acción— duplicaría el fetching que las páginas ya hacen en el server, y rompería el deep-linking que hoy funciona.

**Consecuencia a aceptar:** cada selección es una navegación del server. Con el poller de 5s ya existente eso es coherente, y evita mantener dos caminos de datos.

### 3.1 Dónde vive el fetch de la lista

En `layout.tsx`, con `getInboxServiceForRequest()`, igual que hoy en `page.tsx`. El layout es Server Component.

El filtro de canal viaja por `searchParams`. **Limitación conocida de Next: los layouts no reciben `searchParams`.** Se resuelve haciendo que el filtro sea un Client Component que lee `useSearchParams()` y filtra la lista ya cargada en cliente. La lista completa de conversaciones activas es pequeña (decenas), así que filtrar en cliente no tiene costo real y evita re-fetchear.

---

## 4. Panel de lista (322px)

Fondo `surface-panel`, borde derecho `line-layout`.

**Encabezado:** "Bandeja" 17px/650/`-.02em` + contador de activas en mono `ink-faint`. Debajo: punto `ok` de 5px con `animate-pulse-dot` + "Sincronizado en vivo · Meta Cloud API" 10.5px.

**Filtros de canal** — chips con scroll horizontal: Todos / WhatsApp / Instagram / Messenger. `padding:4.5px 10px`, `radius:20px`, 11.5px/550, cada uno con su `ChannelDot` de 6px. Activo: `surface-avatar` + borde `line-control` + `ink-primary`. Inactivo: transparente + borde `line-card` + `ink-dim`.

Reemplaza a `ChannelTabs`, que hoy son tabs sobrias.

**Filas** (`InboxListItem` revestido):

- `padding:11px`, `radius:12px`, hover `surface-elevated`, seleccionada `surface-hover` + barra izquierda `brand` de 2.5px.
- `InitialsAvatar` de 38px con `ChannelDot` de 13px abajo a la derecha, con `ringColor` del fondo del panel.
- Nombre 12.5px/600 truncado + timestamp mono 10px `ink-faint`.
- Preview del último mensaje 11.5px `ink-dim` truncado + badge de no leídos (`bg-brand`, `text-brand-ink`, mono 10px/600, `radius:20px`, mín 17px).
- Fila inferior: `StageBadge` + badge "IA pausada" cuando corresponde (`danger` sobre `danger/13%`).

**Sin grupos ni chips de motivo.** El orden es el actual —por última actividad— hasta que D traiga el triage.

---

## 5. Panel de conversación (flex, mín 520px)

Fondo `surface-chat` + patrón de puntos:

```css
background-image: radial-gradient(circle at 1px 1px, rgba(255, 255, 255, 0.03) 1px, transparent 0);
background-size: 24px 24px;
```

**Header** (`ConversationHeader` revestido): `padding:13px 20px`, borde inferior `line-layout`, `background: rgba(13,14,18,.86)` + `backdrop-filter: blur(8px)`. Avatar de 36px con punto de canal, nombre 14.5px/650 + `StageBadge`, y segunda línea en mono 10.5px con teléfono · canales · última actividad, separadores `·` en `#2c3038`.

El `HandoffToggle` pasa a la forma del handoff: `padding:6px 11px`, `radius:9px`, 11.5px/600, con punto de 6px. Activa: `ok` sobre `ok/10%` con borde `ok/28%` y `animate-pulse-dot`. Pausada: `warn` sobre `warn/10%`, sin animación.

**Hilo** (`ChatThread`): `flex-direction: column-reverse`, `gap:9px`, `padding:20px 26px`. El `column-reverse` ancla el scroll abajo sin JavaScript.

**Burbujas** (`MessageBubble`), máx 62% de ancho, hora en mono 9.5px:

| Tipo      | Alineación | Fondo                                                                                    | Radio                                                                        |
| --------- | ---------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Sistema   | centrada   | —                                                                                        | línea `surface-avatar` a los lados, texto mono 9.5px uppercase `ink-fainter` |
| Entrante  | izquierda  | `surface-bubble-in`, borde `line-input`                                                  | `15px 15px 15px 5px`                                                         |
| Agente IA | derecha    | `linear-gradient(150deg, rgba(255,175,58,.16), rgba(255,175,58,.07))`, borde `brand/22%` | `15px 15px 5px 15px`                                                         |
| Vendedor  | derecha    | `surface-bubble-vend` (claro), texto `#14161b`                                           | `15px 15px 5px 15px`                                                         |

La burbuja del agente lleva etiqueta "AGENTE IA" con ícono `AutoAwesome` 12px + mono 9px uppercase `brand-hover`. La del vendedor, "VENDEDOR" en mono 9px `ink-faint`.

El tipo sale de `mensajes.sender`, que ya distingue `lead` / `ia` / `humano` / `sistema`. **No hace falta migrar.**

**Composer** (`MessageInput`): `padding:9px 10px 9px 14px`, `radius:14px`, `surface-input`, borde `line-input`. Hint "Enter envía · ⇧Enter salto de línea" en mono 10px `ink-ghost`. Botón de envío 32×32, `radius:9px`, `bg-brand`, sombra `0 3px 12px rgba(240,138,29,.3)`.

Los íconos `AttachFile` y `Bolt` del handoff **no se agregan**: no tienen función y A ya estableció que un control sin función lleva comentario o no va.

---

## 6. Panel del Twin (322px)

`TwinPanel` revestido: fondo `surface-panel`, borde izquierdo `line-layout`, secciones separadas por `line-layout` con `padding:15px 17px`, encabezado con ícono `ContactEmergency` en `brand`.

**Sin chips de procedencia ni edición** — eso es E. B solo lleva el panel al lenguaje visual nuevo.

El rail del embudo **sí entra**, porque `src/lib/ui/stage.ts` ya expone `FUNNEL_STAGES`, `funnelStep` e `isDetour` desde A: 6 segmentos de 3.5px, los pasados y el actual en el color de la etapa, los futuros en `line-card`. Cuando la etapa es un desvío el rail se congela en gris y aparece el chip correspondiente con ícono `AltRoute` en `special`.

---

## 7. Estado vacío y responsive

`/inbox/page.tsx` renderiza un `EmptyState` centrado en el panel de conversación: "Elegí una conversación de la lista". El Twin no se muestra sin conversación seleccionada.

**Responsive:** el contenedor raíz del panel ya tiene `overflow-x-auto` desde A. `<main>` lleva `min-width: 1164px` para que por debajo scrollee horizontal en vez de aplastarse. **No hay layout móvil** y no se diseña acá — el handoff tampoco lo define.

---

## 8. Verificación

| Qué                                   | Cómo                                                                                   |
| ------------------------------------- | -------------------------------------------------------------------------------------- |
| Los 3 paneles con sus anchos          | Medido en navegador a 1440px: lista 322, Twin 322, conversación el resto               |
| La lista no se remonta al seleccionar | Scrollear la lista, seleccionar otra conversación, confirmar que el scroll se mantiene |
| Deep-linking                          | Entrar directo a `/inbox/[leadId]` por URL y ver los 3 paneles                         |
| Las 4 burbujas                        | Con los 7 mensajes reales de la DB, que incluyen `lead`, `ia` y `sistema`              |
| Sin regresión                         | `npm run ci` verde                                                                     |
| Fidelidad                             | Comparar contra `CRM Repuestos v2.dc.html`                                             |

**La verificación medida en navegador es criterio de aceptación, no cortesía.** Los dos defectos de plan del sub-proyecto A cayeron en layout y los encontró alguien midiendo anchos, no leyendo diffs. B es todo layout.

---

## 9. Criterios de aceptación

1. `/inbox` y `/inbox/[leadId]` renderizan el mismo layout de 3 paneles.
2. Seleccionar una conversación actualiza los paneles 2 y 3 sin remontar la lista, y la URL refleja `/inbox/[leadId]`.
3. Entrar directo por URL a una conversación funciona igual.
4. Las 4 burbujas se distinguen visualmente y salen de `mensajes.sender`.
5. El filtro de canal funciona sin re-fetchear.
6. Cero cambios en repositorios, servicios, Server Actions y migraciones.
7. `npm run ci` verde y las 7 pantallas del panel sin regresión.

---

## 10. Decisiones registradas

| Decisión                                      | Razón                                                                                                                                   |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Layout compartido en vez de estado en cliente | Next preserva el layout entre hijos: se obtiene el comportamiento del prototipo sin duplicar el fetching ni romper el deep-linking      |
| Filtro de canal en cliente                    | Los layouts de Next no reciben `searchParams`; la lista es chica y filtrar en cliente evita re-fetchear                                 |
| Sin triage en B                               | Requiere calcular motivo y prioridad en server. El propio handoff lo pone como paso 4 y dice que la bandeja sin triage ya es entregable |
| Sin íconos de adjuntar ni respuestas rápidas  | No tienen función; A estableció que un control sin función lleva comentario o no va                                                     |
| El rail del embudo sí entra                   | `stage.ts` ya lo expone desde A, sin datos nuevos                                                                                       |

---

## 11. Sub-proyecto siguiente

**D — Triage.** Es el objetivo número uno del handoff y solo necesita cálculo en server: motivo (`requiere_humano` → bloqueador → `esperando_pago` sin comprobante → resto por recencia) y tiempo esperando. Después **C** (ventana de 24 h y estados de entrega, con migración) y **E** (Twin con procedencia, con migración).
