# W3: Canvas Visual y Enriquecimiento del Motor de Workflows

> Spec de diseño. Fecha: 2026-08-26.
> Plan de implementación: `docs/superpowers/plans/2026-08-26-workflows-w3-canvas-visual.md` (por escribir).

---

## 1. Contexto

El editor de workflows actual (`EditorDeGrafo.tsx`) es un formulario secuencial: lista de pasos, dropdowns para configurar cada uno, y conexiones manuales por selectores. Funciona, pero no compite visualmente con N8N, Kommo ni ningún builder moderno.

El motor de ejecución (W2) ya está completo y en producción. Las tablas `workflow_runs` y `workflow_run_pasos` guardan cada corrida con su estado y recorrido. Lo que falta es:

1. **Canvas visual drag & drop** — la experiencia de armar flujos que el usuario espera
2. **Variables en mensajes** — `{{lead.nombre}}` interpolado al ejecutar
3. **Historial de corridas visible** — UI sobre los datos que ya se guardan
4. **Trigger manual** — probar un workflow sin esperar el evento real

Este spec cubre las 4 piezas. El canvas es la prioridad; el resto aprovecha el impulso.

---

## 2. Decisiones de diseño

### 2.1 Librería de canvas

**Elegida: `@xyflow/react` v12** (antes React Flow).

Razones:

- 25k+ estrellas, mantenida activamente, TypeScript nativo
- Usada por N8N, Stripe, Typeform
- Minimap, controles de zoom, y handles de conexión incluidos
- Compatible con React 19 y Next.js App Router
- MIT license

Alternativas descartadas:

- `react-diagrams`: menos mantenida, API más compleja
- `jointjs`: comercial para features avanzados
- Canvas manual: esfuerzo desproporcionado

### 2.2 Persistencia de posiciones

`Nodo.posicion` ya existe en el tipo y se guarda en `workflow_versiones.grafo`. El canvas lo lee y escribe sin cambios al modelo de datos.

### 2.3 Colores por tipo de nodo

| Tipo       | Color    | Hex       | Motivo               |
| ---------- | -------- | --------- | -------------------- |
| Disparador | Verde    | `#22c55e` | Inicio, positivo     |
| Acción     | Azul     | `#3b82f6` | Hacer algo           |
| Condición  | Amarillo | `#eab308` | Decisión, precaución |
| Espera     | Gris     | `#6b7280` | Pausa, neutral       |
| Fin        | Rojo     | `#ef4444` | Termina el flujo     |

Estos colores ya existen en el tema del proyecto (Tailwind). Los nodos usan las clases `bg-emerald-500`, `bg-blue-500`, etc.

### 2.4 Variables en mensajes

Sintaxis: `{{namespace.campo}}` con doble llave (estándar Mustache/Handlebars).

Namespaces disponibles al ejecutar:

| Namespace  | Fuente de datos                             | Campos ejemplo                                            |
| ---------- | ------------------------------------------- | --------------------------------------------------------- |
| `lead`     | `LeadsRepository.findById(leadId)`          | `nombre`, `telefono`, `etapa`, `canal`                    |
| `sesion`   | `LeadSessionRepository.findById(sessionId)` | `auto_marca`, `auto_modelo`, `auto_anio`, `current_stage` |
| `contexto` | `ContextoRun` de la corrida                 | cualquier campo que una acción anterior haya escrito      |
| `vendedor` | Usuario asignado al lead                    | `nombre`, `email`                                         |

Resolución:

- Campo existente → valor como string
- Campo null/undefined → string vacío `""`
- Namespace desconocido → se deja literal `{{foo.bar}}` y se anota warning en `salida`

### 2.5 Historial de corridas

Ya existe en base de datos (`workflow_runs` + `workflow_run_pasos`). La UI muestra:

- Lista de corridas del workflow con estado (badge verde/rojo/amarillo)
- Click en una corrida → timeline de pasos con entrada/salida/error de cada uno
- Filtros: por estado, por fecha, por lead

### 2.6 Trigger manual

Botón "Probar con un lead" que:

1. Abre modal para seleccionar un lead existente
2. Llama a `arrancar_workflow_run()` directamente con la versión actual (no necesita estar publicada)
3. Muestra el resultado en el historial

---

## 3. Componentes nuevos

### 3.1 Canvas principal

```
src/components/workflows/
├── CanvasWorkflow.tsx          # Wrapper de ReactFlow con estado del grafo
├── CanvasToolbar.tsx           # Zoom, minimap toggle, undo/redo
├── CanvasMinimap.tsx           # Vista aérea (componente de xyflow)
├── PanelConfigNodo.tsx         # Sidebar derecho al seleccionar nodo
├── PaletaNodos.tsx             # Drag source de los 5 tipos
└── nodos/
    ├── NodoBase.tsx            # Layout compartido: header + body + handles
    ├── NodoDisparador.tsx      # Config: qué evento dispara
    ├── NodoAccion.tsx          # Config: qué acción + params
    ├── NodoCondicion.tsx       # Config: campo + operador + valor
    ├── NodoEspera.tsx          # Config: minutos (o multi-trigger W3.5)
    └── NodoFin.tsx             # Sin config
```

### 3.2 Historial de corridas

```
src/components/workflows/
├── HistorialCorridas.tsx       # Lista paginada de workflow_runs
├── DetalleCorrida.tsx          # Timeline de pasos de una corrida
└── PasoTimeline.tsx            # Un paso con entrada/salida/error
```

### 3.3 Interpolación de variables

```
src/lib/workflows/
├── variables.ts                # interpolarVariables(texto, datos)
└── variables.test.ts           # unit tests
```

---

## 4. Cambios a código existente

### 4.1 `EditorDeGrafo.tsx`

Se reemplaza completamente por `CanvasWorkflow.tsx`. El archivo actual se puede borrar o renombrar a `EditorDeGrafoLegacy.tsx` por si hace falta rollback.

### 4.2 `enviar-mensaje.ts`

Antes de mandar el texto, interpolar variables:

```typescript
// Línea ~107, después de leerTexto()
const texto = leerTexto(nodo);
const datosInterpolacion = await cargarDatosInterpolacion(deps, entorno);
const textoFinal = interpolarVariables(texto, datosInterpolacion);
```

### 4.3 `catalogo.ts`

Agregar preview de variables disponibles para el editor:

```typescript
export const VARIABLES_DISPONIBLES = [
  { namespace: "lead", campos: ["nombre", "telefono", "etapa", "canal"] },
  { namespace: "sesion", campos: ["auto_marca", "auto_modelo", "auto_anio"] },
  { namespace: "contexto", campos: ["(dinámico)"] },
  { namespace: "vendedor", campos: ["nombre"] },
] as const;
```

### 4.4 Página `[id]/page.tsx`

Agregar tabs: "Editor" | "Historial" | "Configuración"

---

## 5. Dependencias nuevas

```bash
npm install @xyflow/react
```

Una sola dependencia. `@xyflow/react` incluye todo: minimap, controles, background grid.

---

## 6. Migración de datos

Ninguna. El modelo de datos no cambia. Los workflows existentes se ven en el canvas con las posiciones que ya tienen (o posiciones por defecto si `posicion` está en `{x:0, y:0}`).

Para workflows con posiciones en cero, el canvas puede auto-layout al abrir (dagre o similar), pero eso es mejora opcional, no requisito.

---

## 7. Tareas de implementación

### Fase A: Canvas básico (lo visual)

| #   | Tarea                      | Entregable                                                               |
| --- | -------------------------- | ------------------------------------------------------------------------ |
| A1  | Instalar `@xyflow/react`   | `package.json` actualizado                                               |
| A2  | `NodoBase.tsx` con handles | Componente base con header + color + handles entrada/salida              |
| A3  | 5 nodos tipados            | `NodoDisparador`, `NodoAccion`, `NodoCondicion`, `NodoEspera`, `NodoFin` |
| A4  | `CanvasWorkflow.tsx`       | Canvas que renderiza un `Grafo` existente                                |
| A5  | Drag & drop desde paleta   | `PaletaNodos.tsx` + onDrop en canvas                                     |
| A6  | Conexiones arrastrando     | onConnect crea arista en el grafo                                        |
| A7  | `PanelConfigNodo.tsx`      | Sidebar derecho al seleccionar                                           |
| A8  | Minimap + zoom controls    | `CanvasToolbar.tsx` + `CanvasMinimap.tsx`                                |
| A9  | Guardar posiciones         | onNodeDragStop actualiza `nodo.posicion`                                 |
| A10 | Integrar en página         | Reemplazar `EditorDeGrafo` por `CanvasWorkflow`                          |

### Fase B: Variables en mensajes

| #   | Tarea                           | Entregable                                                      |
| --- | ------------------------------- | --------------------------------------------------------------- |
| B1  | `interpolarVariables()`         | Función pura + tests                                            |
| B2  | `cargarDatosInterpolacion()`    | Carga lead + sesión + vendedor                                  |
| B3  | Integrar en `enviar-mensaje.ts` | Texto interpolado antes de mandar                               |
| B4  | Preview en editor               | Input de texto muestra variables resueltas con datos de ejemplo |
| B5  | Autocompletado de variables     | Al escribir `{{` aparece lista de opciones                      |

### Fase C: Historial de corridas

| #   | Tarea                   | Entregable                           |
| --- | ----------------------- | ------------------------------------ |
| C1  | `HistorialCorridas.tsx` | Lista paginada con estado/fecha/lead |
| C2  | `DetalleCorrida.tsx`    | Timeline de pasos                    |
| C3  | Integrar en página      | Tab "Historial" en `/workflows/[id]` |
| C4  | Filtros                 | Por estado, fecha, lead              |

### Fase D: Trigger manual

| #   | Tarea                          | Entregable                                         |
| --- | ------------------------------ | -------------------------------------------------- |
| D1  | Modal selección de lead        | Buscador de leads existentes                       |
| D2  | Server action `probarWorkflow` | Llama `arrancar_workflow_run` con versión draft    |
| D3  | Botón en toolbar               | "Probar" abre modal y dispara                      |
| D4  | Feedback en historial          | La corrida de prueba aparece marcada como "manual" |

---

## 8. Criterios de aceptación

### Canvas

- [ ] Puedo arrastrar un nodo desde la paleta y soltarlo en el canvas
- [ ] Puedo conectar dos nodos arrastrando desde un handle a otro
- [ ] Puedo mover nodos y las conexiones siguen
- [ ] Puedo hacer zoom con scroll wheel y pan arrastrando el fondo
- [ ] El minimap muestra el flujo completo y puedo navegar desde él
- [ ] Al seleccionar un nodo, el panel lateral muestra su configuración
- [ ] Al guardar, las posiciones se persisten y al recargar están igual

### Variables

- [ ] Un mensaje con `{{lead.nombre}}` llega al WhatsApp con el nombre real
- [ ] Si el campo no existe, llega vacío sin explotar
- [ ] El editor muestra preview del texto interpolado

### Historial

- [ ] Puedo ver todas las corridas de un workflow
- [ ] Puedo ver cada paso de una corrida con su entrada/salida
- [ ] Los errores se muestran en rojo con el mensaje

### Trigger manual

- [ ] Puedo probar un workflow con un lead sin esperar el evento real
- [ ] La corrida aparece en el historial marcada como "prueba manual"

---

## 9. Fuera de alcance (W4+)

- **Espera multi-trigger** ("hasta que responda O pasen X minutos") → W4
- **Botones de respuesta rápida WhatsApp** → W4
- **A/B Split testing** → W5
- **Sub-workflows reutilizables** → W5
- **AI Builder (lenguaje natural)** → W6
- **Templates predefinidos** → después del canvas

---

## 10. Riesgos y mitigaciones

| Riesgo                               | Probabilidad | Impacto | Mitigación                                                    |
| ------------------------------------ | ------------ | ------- | ------------------------------------------------------------- |
| React Flow incompatible con React 19 | Baja         | Alto    | v12 de xyflow ya soporta React 19; verificar antes de empezar |
| Performance con muchos nodos         | Media        | Medio   | Virtualization incluida en xyflow; testear con 50+ nodos      |
| Conflictos con el tema oscuro        | Baja         | Bajo    | xyflow soporta theming; mapear a tokens del proyecto          |

---

## 11. Referencias

- [xyflow/react docs](https://reactflow.dev/docs)
- [N8N UI research](https://docs.n8n.io/workflows/)
- [Kommo Salesbot](https://support.kommo.com/docs/salesbot-overview)
- Specs anteriores: `2026-08-19-workflows-w1-grafo-design.md`, `2026-08-22-workflows-w2-motor-design.md`
