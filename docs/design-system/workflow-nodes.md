# Workflow Nodes — Design System

> Sistema de diseño para nodos del workflow builder. Inspirado en N8N con identidad propia.

## Filosofía

Los nodos son **tarjetas de acción**: cada uno representa una operación clara. El diseño prioriza:

1. **Reconocimiento instantáneo** — color y icono identifican el tipo en <100ms
2. **Jerarquía clara** — header → contenido → handles
3. **Feedback de estado** — el nodo comunica qué está pasando

---

## 1. Paleta de Colores por Categoría

```css
:root {
  /* Triggers — Verde esmeralda (inicio del flujo) */
  --node-trigger-bg: #ecfdf5;
  --node-trigger-header: #10b981;
  --node-trigger-border: #6ee7b7;
  --node-trigger-text: #065f46;

  /* Mensajería — Azul (comunicación) */
  --node-msg-bg: #eff6ff;
  --node-msg-header: #3b82f6;
  --node-msg-border: #93c5fd;
  --node-msg-text: #1e40af;

  /* CRM — Violeta (gestión de datos) */
  --node-crm-bg: #f5f3ff;
  --node-crm-header: #8b5cf6;
  --node-crm-border: #c4b5fd;
  --node-crm-text: #5b21b6;

  /* Lógica — Ámbar (decisiones) */
  --node-logic-bg: #fffbeb;
  --node-logic-header: #f59e0b;
  --node-logic-border: #fcd34d;
  --node-logic-text: #92400e;

  /* Integraciones — Cyan (externos) */
  --node-int-bg: #ecfeff;
  --node-int-header: #06b6d4;
  --node-int-border: #67e8f9;
  --node-int-text: #155e75;

  /* IA — Rosa (inteligencia) */
  --node-ai-bg: #fdf2f8;
  --node-ai-header: #ec4899;
  --node-ai-border: #f9a8d4;
  --node-ai-text: #9d174d;

  /* Internos — Gris (sistema) */
  --node-sys-bg: #f9fafb;
  --node-sys-header: #6b7280;
  --node-sys-border: #d1d5db;
  --node-sys-text: #374151;

  /* Estados */
  --node-selected-ring: #3b82f6;
  --node-error-ring: #ef4444;
  --node-running-ring: #10b981;
  --node-hover-shadow: rgba(0, 0, 0, 0.08);
}
```

### Tailwind equivalentes

```typescript
const CATEGORIAS = {
  trigger: {
    bg: "bg-emerald-50",
    header: "bg-emerald-500",
    border: "border-emerald-300",
    text: "text-emerald-800",
    icon: "text-white",
  },
  mensajeria: {
    bg: "bg-blue-50",
    header: "bg-blue-500",
    border: "border-blue-300",
    text: "text-blue-800",
    icon: "text-white",
  },
  crm: {
    bg: "bg-violet-50",
    header: "bg-violet-500",
    border: "border-violet-300",
    text: "text-violet-800",
    icon: "text-white",
  },
  logica: {
    bg: "bg-amber-50",
    header: "bg-amber-500",
    border: "border-amber-300",
    text: "text-amber-800",
    icon: "text-white",
  },
  integracion: {
    bg: "bg-cyan-50",
    header: "bg-cyan-500",
    border: "border-cyan-300",
    text: "text-cyan-800",
    icon: "text-white",
  },
  ia: {
    bg: "bg-pink-50",
    header: "bg-pink-500",
    border: "border-pink-300",
    text: "text-pink-800",
    icon: "text-white",
  },
  interno: {
    bg: "bg-gray-50",
    header: "bg-gray-500",
    border: "border-gray-300",
    text: "text-gray-700",
    icon: "text-white",
  },
};
```

---

## 2. Tipografía

```css
.node {
  font-family: var(--font-sans); /* Inter o system */
}

.node-header-text {
  font-size: 13px;
  font-weight: 600;
  line-height: 1.2;
  letter-spacing: -0.01em;
}

.node-preview {
  font-size: 11px;
  font-weight: 400;
  line-height: 1.4;
  color: var(--text-ink-secondary);
}

.node-badge {
  font-size: 9px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
```

### Tailwind

```html
<span class="text-[13px] leading-tight font-semibold tracking-tight">Nombre</span>
<span class="text-ink-secondary text-[11px] leading-snug">Preview</span>
<span class="text-[9px] font-semibold tracking-wide uppercase">BADGE</span>
```

---

## 3. Dimensiones y Espaciado

```
Nodo completo:
┌─────────────────────────────────────┐
│ Ancho: 200px (fijo)                 │
│ Alto: auto (mínimo 56px)            │
│ Border radius: 8px                  │
│ Border: 1px solid                   │
└─────────────────────────────────────┘

Header:
┌─────────────────────────────────────┐
│ Altura: 32px                        │
│ Padding: 0 12px                     │
│ Border radius: 8px 8px 0 0          │
│ Gap icono-texto: 8px                │
└─────────────────────────────────────┘

Body:
┌─────────────────────────────────────┐
│ Padding: 8px 12px                   │
│ Min height: 24px                    │
└─────────────────────────────────────┘
```

### Tailwind

```html
<div class="min-h-[56px] w-[200px] rounded-lg border">
  <div class="flex h-8 items-center gap-2 rounded-t-lg px-3">
    <!-- Header -->
  </div>
  <div class="px-3 py-2">
    <!-- Body -->
  </div>
</div>
```

---

## 4. Estados

### Normal

```css
.node {
  background: var(--node-{cat}-bg);
  border: 1px solid var(--node-{cat}-border);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  transition: all 150ms ease;
}
```

### Hover

```css
.node:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  transform: translateY(-1px);
}
```

### Selected

```css
.node.selected {
  box-shadow:
    0 0 0 2px var(--node-selected-ring),
    0 4px 12px rgba(59, 130, 246, 0.15);
}
```

### Error

```css
.node.error {
  border-color: #ef4444;
  box-shadow:
    0 0 0 2px #ef4444,
    0 4px 12px rgba(239, 68, 68, 0.15);
}

.node.error .node-header {
  background: #ef4444;
}
```

### Running (animado)

```css
.node.running {
  box-shadow:
    0 0 0 2px var(--node-running-ring),
    0 4px 12px rgba(16, 185, 129, 0.2);
}

.node.running::after {
  content: "";
  position: absolute;
  inset: -2px;
  border-radius: 10px;
  border: 2px solid transparent;
  border-top-color: var(--node-running-ring);
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
```

### Tailwind equivalentes

```typescript
const ESTADOS = {
  normal: "shadow-sm hover:shadow-md hover:-translate-y-px transition-all duration-150",
  selected: "ring-2 ring-blue-500 shadow-lg shadow-blue-500/15",
  error: "ring-2 ring-red-500 shadow-lg shadow-red-500/15",
  running: "ring-2 ring-emerald-500 shadow-lg shadow-emerald-500/20 animate-pulse",
};
```

---

## 5. Handles (Conectores)

```
Posición entrada: centro-arriba
Posición salida: centro-abajo (o múltiples para lógica)

┌─────────────────────────────────────┐
│           ● (entrada)               │
│  ┌─────────────────────────────┐    │
│  │         NODO                │    │
│  └─────────────────────────────┘    │
│           ● (salida)                │
│      ●         ● (si tiene 2)       │
└─────────────────────────────────────┘
```

### Estilos

```css
.react-flow__handle {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #6b7280;
  border: 2px solid white;
  transition: all 150ms ease;
}

.react-flow__handle:hover {
  width: 14px;
  height: 14px;
  background: #3b82f6;
}

.react-flow__handle.connecting {
  background: #10b981;
  animation: pulse 0.5s ease infinite;
}
```

### Handles múltiples (Condición/Switch)

```tsx
// Para nodo condición: 2 salidas
<Handle type="source" id="si" position={Position.Bottom} style={{ left: '33%' }} />
<Handle type="source" id="no" position={Position.Bottom} style={{ left: '66%' }} />

// Labels bajo los handles
<div className="absolute -bottom-5 left-[33%] -translate-x-1/2 text-[9px] text-emerald-600">Sí</div>
<div className="absolute -bottom-5 left-[66%] -translate-x-1/2 text-[9px] text-red-500">No</div>
```

---

## 6. Conexiones (Edges)

```css
.react-flow__edge-path {
  stroke: #94a3b8;
  stroke-width: 2;
  fill: none;
}

.react-flow__edge.selected .react-flow__edge-path {
  stroke: #3b82f6;
  stroke-width: 2.5;
}

/* Animación de flujo */
.react-flow__edge.animated .react-flow__edge-path {
  stroke-dasharray: 5;
  animation: flow 0.5s linear infinite;
}

@keyframes flow {
  to {
    stroke-dashoffset: -10;
  }
}
```

---

## 7. Dark Mode

```css
[data-theme="dark"] {
  --node-trigger-bg: #064e3b;
  --node-trigger-header: #10b981;
  --node-trigger-border: #047857;
  --node-trigger-text: #a7f3d0;

  /* ... resto de categorías con colores oscuros */
}
```

### Tailwind con dark:

```html
<div class="border-emerald-300 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-950">
  <div class="bg-emerald-500 dark:bg-emerald-600">
    <!-- Header -->
  </div>
</div>
```

---

## 8. Anatomía Completa del Nodo

```tsx
interface NodoProps {
  tipo: string;
  categoria: "trigger" | "mensajeria" | "crm" | "logica" | "integracion" | "ia" | "interno";
  nombre: string;
  icono: LucideIcon;
  preview: string;
  estado?: "normal" | "selected" | "error" | "running";
  tieneEntrada?: boolean;
  salidasMultiples?: { id: string; label: string }[];
}

// Estructura visual:
<div
  className={cn(
    // Base
    "min-h-[56px] w-[200px] rounded-lg border",
    "shadow-sm transition-all duration-150",
    // Hover
    "hover:-translate-y-px hover:shadow-md",
    // Categoría
    CATEGORIAS[categoria].bg,
    CATEGORIAS[categoria].border,
    // Estado
    estado === "selected" && "shadow-lg ring-2 ring-blue-500",
    estado === "error" && "ring-2 ring-red-500",
    estado === "running" && "animate-pulse ring-2 ring-emerald-500",
  )}
>
  {/* Handle entrada */}
  {tieneEntrada && (
    <Handle
      type="target"
      position={Position.Top}
      className="!h-2.5 !w-2.5 !border-2 !border-white !bg-gray-400"
    />
  )}

  {/* Header */}
  <div
    className={cn("flex h-8 items-center gap-2 rounded-t-lg px-3", CATEGORIAS[categoria].header)}
  >
    <Icono className="h-4 w-4 text-white" />
    <span className="truncate text-[13px] font-semibold text-white">{nombre}</span>
  </div>

  {/* Body */}
  <div className="px-3 py-2">
    <span className={cn("line-clamp-2 text-[11px] leading-snug", CATEGORIAS[categoria].text)}>
      {preview}
    </span>
  </div>

  {/* Handle(s) salida */}
  {salidasMultiples ? (
    salidasMultiples.map((s, i) => (
      <Handle
        key={s.id}
        type="source"
        id={s.id}
        position={Position.Bottom}
        style={{ left: `${((i + 1) / (salidasMultiples.length + 1)) * 100}%` }}
        className="!h-2.5 !w-2.5 !border-2 !border-white !bg-gray-500"
      />
    ))
  ) : (
    <Handle
      type="source"
      position={Position.Bottom}
      className="!h-2.5 !w-2.5 !border-2 !border-white !bg-gray-500"
    />
  )}
</div>;
```

---

## 9. Ejemplos Visuales (ASCII)

### Trigger (Verde)

```
         ○
┌────────────────────┐
│ 💬 Mensaje recibido│ ← header verde
├────────────────────┤
│ Canal: WhatsApp    │ ← body verde claro
│ Todos los mensajes │
└─────────●──────────┘
```

### Condición (Ámbar)

```
         ○
┌────────────────────┐
│ ◇ Si etapa es     │ ← header ámbar
├────────────────────┤
│ lead.etapa = nuevo │
└────●─────────●─────┘
    Sí         No
```

### Acción con error

```
         ○
┌════════════════════┐ ← borde rojo
│ 📤 Enviar mensaje  │ ← header rojo
├────────────────────┤
│ Error: timeout     │
└─────────●──────────┘
```

---

## 10. Checklist de Implementación

- [ ] Crear constantes de categorías con colores
- [ ] NodoBase con todos los estados
- [ ] Handles con estilos hover
- [ ] Animación para estado running
- [ ] Dark mode para todos los colores
- [ ] Responsive (no escala, pero handles accesibles en touch)
- [ ] Focus visible para accesibilidad
