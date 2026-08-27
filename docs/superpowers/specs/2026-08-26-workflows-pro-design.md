# Workflows Pro — Spec de Diseño

> **Objetivo:** Crear un motor de workflows visual de clase mundial, al nivel de N8N, Make y Kommo. No un canvas básico, sino una herramienta completa de automatización visual.

## Principios de Diseño

1. **Visual-first**: Todo se hace arrastrando y conectando, sin tocar código
2. **Progressive disclosure**: Simple para empezar, poderoso cuando lo necesitas
3. **Feedback inmediato**: Cada acción tiene respuesta visual instantánea
4. **Debug sin dolor**: Ver exactamente qué pasó en cada ejecución

---

## 1. Pantalla de Listado de Workflows

### 1.1 Vista Principal `/workflows`

```
┌─────────────────────────────────────────────────────────────────────┐
│  Workflows                                    [+ Nuevo workflow]    │
├─────────────────────────────────────────────────────────────────────┤
│  [Buscar...]                    [Todos ▼] [Estado ▼] [Ordenar ▼]   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ 🟢 Bienvenida automática                                     │   │
│  │ Cuando llega mensaje → Saluda → Clasifica intent            │   │
│  │ ────────────────────────────────────────────────────────────│   │
│  │ Activo · 1,234 ejecuciones · 98% éxito · Hace 2 min         │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ 🟡 Seguimiento de cotización                    [BORRADOR]   │   │
│  │ Cron diario → Busca leads en etapa cotización → Envía msg   │   │
│  │ ────────────────────────────────────────────────────────────│   │
│  │ Borrador · Sin publicar · Editado hace 1 hora               │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ 🔴 Notificar stock bajo                         [ERROR]      │   │
│  │ Webhook de inventario → Notifica vendedor                   │   │
│  │ ────────────────────────────────────────────────────────────│   │
│  │ Error · 3 fallos seguidos · Última: Error de conexión       │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 1.2 Estados de Workflow

| Estado   | Color    | Significado                |
| -------- | -------- | -------------------------- |
| Activo   | Verde    | Publicado y ejecutándose   |
| Borrador | Amarillo | Cambios sin publicar       |
| Pausado  | Gris     | Publicado pero desactivado |
| Error    | Rojo     | Último run falló           |

### 1.3 Métricas en la Card

- Total de ejecuciones (últimos 30 días)
- Tasa de éxito (%)
- Última ejecución (tiempo relativo)
- Tiempo promedio de ejecución

### 1.4 Modal "Nuevo Workflow"

```
┌─────────────────────────────────────────────────────────────────┐
│  Crear nuevo workflow                                      [X]  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Nombre: [Bienvenida automática________________]                │
│                                                                 │
│  ─────────────────────────────────────────────────────────────  │
│  Empezar desde:                                                 │
│                                                                 │
│  ○ En blanco                                                    │
│     Canvas vacío para construir desde cero                      │
│                                                                 │
│  ○ Template                                                     │
│     ┌─────────────┐ ┌─────────────┐ ┌─────────────┐            │
│     │ Bienvenida  │ │ Seguimiento │ │ Escalado    │            │
│     │ + clasif.   │ │ cotización  │ │ automático  │            │
│     └─────────────┘ └─────────────┘ └─────────────┘            │
│                                                                 │
│                                          [Cancelar] [Crear →]   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Editor de Workflow (Canvas)

### 2.1 Layout del Editor

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ← Workflows    Bienvenida automática    [Probar ▶] [Guardar] [Publicar] │
├────────────┬─────────────────────────────────────────────┬───────────────┤
│            │                                             │               │
│  PALETA    │              CANVAS INFINITO                │    PANEL      │
│            │                                             │    CONFIG     │
│ ┌────────┐ │     ┌───────────┐                          │               │
│ │Triggers│ │     │  Trigger  │                          │  Configurar   │
│ ├────────┤ │     │  Mensaje  │                          │  nodo...      │
│ │Mensaje │ │     │  recibido │                          │               │
│ │Webhook │ │     └─────┬─────┘                          │               │
│ │Cron    │ │           │                                │               │
│ │Manual  │ │           ▼                                │               │
│ └────────┘ │     ┌───────────┐                          │               │
│            │     │  Acción   │                          │               │
│ ┌────────┐ │     │  Enviar   │                          │               │
│ │Acciones│ │     │  mensaje  │                          │               │
│ ├────────┤ │     └───────────┘                          │               │
│ │Mensaje │ │                                            │               │
│ │Etiqueta│ │     ─────────────────────────              │               │
│ │Etapa   │ │     [+][-][⊡][🔒]    Minimap              │               │
│ │Asignar │ │                      ┌──────┐              │               │
│ │Esperar │ │                      │ ● ●  │              │               │
│ │API     │ │                      └──────┘              │               │
│ └────────┘ │                                            │               │
│            │                                            │               │
│ ┌────────┐ │                                            │               │
│ │ Lógica │ │                                            │               │
│ ├────────┤ │                                            │               │
│ │IF/Else │ │                                            │               │
│ │Switch  │ │                                            │               │
│ │Loop    │ │                                            │               │
│ │Delay   │ │                                            │               │
│ └────────┘ │                                            │               │
│            │                                            │               │
└────────────┴─────────────────────────────────────────────┴───────────────┘
```

### 2.2 Paleta de Nodos (Izquierda)

**Triggers** (Inician el workflow)
| Nodo | Icono | Config | Descripción |
|------|-------|--------|-------------|
| Mensaje recibido | 💬 | Canal, Filtro texto, Contiene media | Cuando un lead envía un mensaje |
| Webhook entrante | 🔗 | URL generada, Headers, Auth | Cuando llega una petición HTTP externa |
| Programado (Cron) | ⏰ | Frecuencia, Hora, Días, Timezone | A una hora específica o intervalo |
| Manual | ▶️ | - | Ejecutar a mano desde el panel |
| Etiqueta asignada | 🏷️ | Etiqueta específica | Cuando un lead recibe cierta etiqueta |
| Etiqueta removida | 🏷️ | Etiqueta específica | Cuando se quita una etiqueta |
| Etapa cambiada | 📊 | Etapa origen, Etapa destino | Cuando un lead cambia de etapa |
| Lead creado | 👤 | Canal origen | Cuando se crea un nuevo lead |
| Vendedor asignado | 👥 | Vendedor específico o cualquiera | Cuando se asigna vendedor |
| Inactividad | 💤 | Tiempo sin respuesta | Cuando pasa X tiempo sin mensajes |
| Formulario enviado | 📝 | Formulario específico | Cuando se completa un form web |

**Mensajería** (Comunicación con el lead)
| Nodo | Icono | Config | Descripción |
|------|-------|--------|-------------|
| Enviar mensaje | 📤 | Canal, Texto, Variables | Envía mensaje de texto al lead |
| Mensaje con botones | 🔘 | Texto, Botones (max 3), Acciones | Mensaje interactivo con opciones |
| Mensaje de lista | 📋 | Header, Secciones, Items | Lista desplegable de WhatsApp |
| Enviar imagen | 🖼️ | URL/Archivo, Caption | Envía imagen con texto opcional |
| Enviar documento | 📎 | URL/Archivo, Nombre | Envía PDF, Excel, etc |
| Enviar ubicación | 📍 | Lat, Lng, Nombre, Dirección | Envía ubicación en mapa |
| Enviar plantilla | 📄 | Plantilla HSM, Variables | Mensaje pre-aprobado por Meta |
| Reacción | ❤️ | Emoji, Mensaje objetivo | Reacciona a un mensaje específico |

**CRM** (Gestión del lead)
| Nodo | Icono | Config | Descripción |
|------|-------|--------|-------------|
| Asignar etiqueta | 🏷️ | Etiqueta(s) | Agrega etiquetas al lead |
| Remover etiqueta | 🏷️ | Etiqueta(s) | Quita etiquetas del lead |
| Cambiar etapa | 📊 | Etapa destino | Mueve el lead en el pipeline |
| Asignar vendedor | 👤 | Vendedor específico | Asigna a un vendedor |
| Round Robin | 🔄 | Lista de vendedores, Modo | Asigna rotando entre vendedores |
| Actualizar campo | ✏️ | Campo, Valor | Modifica un campo del lead |
| Crear tarea | ✅ | Título, Fecha, Asignado | Crea tarea para seguimiento |
| Agregar nota | 📝 | Contenido, Interna/Visible | Agrega nota a la conversación |
| Marcar como spam | 🚫 | - | Marca el lead como spam |
| Archivar lead | 📦 | - | Archiva el lead |

**Lógica** (Control de flujo)
| Nodo | Icono | Config | Descripción |
|------|-------|--------|-------------|
| Condición (IF) | ◇ | Campo, Operador, Valor | Si X entonces A, sino B |
| Switch | ⋔ | Campo, Casos (múltiples) | Múltiples ramas según valor |
| Validación | ✓ | Expresión, Error message | Valida datos y continúa o falla |
| Esperar tiempo | ⏳ | Duración (min/hora/día) | Pausa el workflow X tiempo |
| Esperar respuesta | 👁️ | Timeout, Mensaje esperado | Pausa hasta que el lead responda |
| Esperar evento | 📡 | Tipo evento, Filtro | Pausa hasta que ocurra evento |
| Loop/Iterar | ↻ | Lista, Variable item | Repite para cada elemento |
| Agrupar | 📦 | Nodos internos | Agrupa nodos visualmente |
| Ir a nodo | ➡️ | Nodo destino | Salta a otro punto del workflow |
| Detener | ⏹️ | Estado final | Termina el workflow |
| Error handler | ⚠️ | Nodo a proteger | Captura errores de un nodo |

**Integraciones** (Sistemas externos)
| Nodo | Icono | Config | Descripción |
|------|-------|--------|-------------|
| HTTP Request | 🌐 | URL, Método, Headers, Body | Llamada HTTP/API genérica |
| Webhook saliente | 📤 | URL destino, Payload | Notifica a sistema externo |
| Ejecutar código | 💻 | JavaScript, Variables | Código JS personalizado |
| Enviar email | ✉️ | Destinatario, Asunto, Cuerpo | Envía email SMTP |
| Google Sheets | 📊 | Spreadsheet, Acción | Lee/escribe en Google Sheets |
| Base de datos | 🗄️ | Query, Conexión | Consulta DB externa |

**IA** (Inteligencia artificial)
| Nodo | Icono | Config | Descripción |
|------|-------|--------|-------------|
| Clasificar intent | 🧠 | Intents disponibles | Detecta qué quiere el lead |
| Generar respuesta | 🤖 | Instrucciones, Contexto | El agente IA genera respuesta |
| Extraer datos | 📋 | Campos a extraer | Extrae info estructurada del mensaje |
| Analizar sentimiento | 😊 | - | Detecta emoción del mensaje |
| Resumir conversación | 📝 | - | Genera resumen de la conversación |
| Traducir | 🌍 | Idioma destino | Traduce el mensaje |
| Verificar spam | 🚫 | Umbral | Detecta si es spam/bot |

**Internos** (Para el equipo)
| Nodo | Icono | Config | Descripción |
|------|-------|--------|-------------|
| Notificar vendedor | 🔔 | Mensaje, Canal (app/email/sms) | Avisa al vendedor asignado |
| Notificar grupo | 👥 | Grupo, Mensaje | Avisa a un grupo/canal interno |
| Comentario interno | 💭 | Texto | Agrega comentario solo visible internamente |
| Log/Debug | 🔧 | Datos a loguear | Para debugging del workflow |

### 2.3 Canvas Central

**Interacciones:**

- **Pan**: Click + arrastrar en área vacía, o rueda del mouse
- **Zoom**: Ctrl + rueda, o pinch en trackpad
- **Seleccionar**: Click en nodo
- **Multi-seleccionar**: Shift + click, o arrastrar rectángulo
- **Conectar**: Arrastrar desde handle de salida a handle de entrada
- **Borrar**: Seleccionar + Backspace/Delete
- **Copiar**: Ctrl+C, Ctrl+V
- **Deshacer**: Ctrl+Z
- **Rehacer**: Ctrl+Shift+Z

**Visuales:**

- Grid de puntos para alineación
- Snap a grid (16px)
- Líneas de conexión con curva bezier
- Animación de flujo en las líneas (puntos que viajan)
- Nodos con colores por categoría
- Handle de entrada (arriba), handles de salida (abajo)
- Nodos de lógica con múltiples salidas

**Minimap:**

- Esquina inferior derecha
- Muestra vista general del workflow
- Click para navegar
- Rectángulo indica viewport actual

**Controles de zoom:**

- Esquina inferior izquierda
- [+] Zoom in
- [-] Zoom out
- [⊡] Fit to view
- [🔒] Lock (solo lectura)

### 2.4 Diseño de Nodos

```
Trigger (verde esmeralda):
┌─────────────────────────┐
│ 💬 Mensaje recibido     │  ← Header con icono y nombre
│─────────────────────────│
│ Canal: WhatsApp         │  ← Config resumida
│ Filtro: Todos           │
└──────────●──────────────┘  ← Handle de salida

Acción (azul):
         ●                   ← Handle de entrada
┌─────────────────────────┐
│ 📤 Enviar mensaje       │
│─────────────────────────│
│ "Hola {{lead.nombre}}"  │  ← Preview del contenido
└──────────●──────────────┘

Condición (ámbar):
         ●
┌─────────────────────────┐
│ ◇ Si lead.etapa        │
│─────────────────────────│
│ es "nuevo"              │
└────●───────────●────────┘
   Sí           No         ← Múltiples salidas

Espera (gris):
         ●
┌─────────────────────────┐
│ ⏳ Esperar              │
│─────────────────────────│
│ 24 horas                │
└──────────●──────────────┘
```

### 2.5 Panel de Configuración (Derecha)

Aparece cuando se selecciona un nodo:

```
┌─────────────────────────────┐
│ 📤 Enviar mensaje      [X]  │
├─────────────────────────────┤
│                             │
│ Canal                       │
│ [WhatsApp ▼]                │
│                             │
│ Mensaje                     │
│ ┌─────────────────────────┐ │
│ │ Hola {{lead.nombre}},   │ │
│ │ gracias por escribir... │ │
│ └─────────────────────────┘ │
│                             │
│ Variables disponibles:      │
│ ┌─────────────────────────┐ │
│ │ {{lead.nombre}}         │ │
│ │ {{lead.telefono}}       │ │
│ │ {{lead.etapa}}          │ │
│ │ {{sesion.auto_marca}}   │ │
│ │ {{vendedor.nombre}}     │ │
│ └─────────────────────────┘ │
│                             │
│ Opciones avanzadas ▼        │
│                             │
│ [Probar este paso]          │
│                             │
└─────────────────────────────┘
```

---

## 3. Ejecución y Debug

### 3.1 Botón "Probar"

Al hacer click en [Probar ▶]:

1. Abre modal para seleccionar datos de entrada
2. Opciones:
   - Usar lead de prueba (seleccionar de lista)
   - Usar última ejecución real
   - Datos personalizados (JSON)

### 3.2 Vista de Ejecución

```
┌────────────────────────────────────────────────────────────────┐
│ Ejecución #1234                              [X]               │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│ Estado: ✅ Completado en 1.2s                                  │
│                                                                │
│ ┌──────────────────┐      ┌──────────────────┐                │
│ │ ✅ Mensaje       │ ───▶ │ ✅ Clasificar    │                │
│ │    recibido      │      │    intent        │                │
│ │    0.1s          │      │    0.8s          │                │
│ └──────────────────┘      └──────────────────┘                │
│                                  │                             │
│                                  ▼                             │
│                           ┌──────────────────┐                │
│                           │ ✅ Enviar        │                │
│                           │    mensaje       │                │
│                           │    0.3s          │                │
│                           └──────────────────┘                │
│                                                                │
│ ─────────────────────────────────────────────────────────────  │
│                                                                │
│ Paso seleccionado: Clasificar intent                          │
│                                                                │
│ Entrada:                                                       │
│ {                                                              │
│   "mensaje": "Hola, tienen filtros para Aveo?"                │
│ }                                                              │
│                                                                │
│ Salida:                                                        │
│ {                                                              │
│   "intent": "consulta_producto",                               │
│   "confianza": 0.95                                            │
│ }                                                              │
│                                                                │
│ [Re-ejecutar este paso]                                        │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

### 3.3 Historial de Ejecuciones

Accesible desde el header del editor:

```
┌────────────────────────────────────────────────────────────────┐
│ Historial de ejecuciones                                  [X]  │
├────────────────────────────────────────────────────────────────┤
│ [Buscar...] [Hoy ▼] [Todas ▼]                                  │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│ ✅ #1234  Hace 2 min    1.2s    Lead: Juan Pérez              │
│ ✅ #1233  Hace 5 min    0.9s    Lead: María García            │
│ ❌ #1232  Hace 8 min    2.1s    Lead: Pedro López    [Ver →]  │
│ ✅ #1231  Hace 12 min   1.1s    Lead: Ana Ruiz                │
│ ...                                                            │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

---

## 4. Versiones y Publicación

### 4.1 Estados del Workflow

```
               ┌──────────┐
               │ Borrador │ ← Creado, no publicado
               └────┬─────┘
                    │ [Publicar]
                    ▼
               ┌──────────┐
               │ Activo   │ ← En producción
               └────┬─────┘
                    │ [Editar]
                    ▼
               ┌──────────┐
               │ Borrador │ ← Cambios sobre versión activa
               │ + Activo │   (la versión activa sigue corriendo)
               └──────────┘
```

### 4.2 Publicar

Al hacer click en [Publicar]:

```
┌─────────────────────────────────────────────────────────────┐
│ Publicar workflow                                      [X]  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ Vas a publicar "Bienvenida automática"                      │
│                                                             │
│ Cambios desde la última versión:                            │
│ • Agregado nodo "Clasificar intent"                         │
│ • Modificado mensaje de bienvenida                          │
│                                                             │
│ ⚠️ Esta versión reemplazará la actual inmediatamente        │
│                                                             │
│ Nota de versión (opcional):                                 │
│ [Agregado clasificación de intent___________]               │
│                                                             │
│                              [Cancelar] [Publicar ahora →]  │
└─────────────────────────────────────────────────────────────┘
```

### 4.3 Historial de Versiones

```
┌─────────────────────────────────────────────────────────────┐
│ Versiones                                              [X]  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ v3 (actual) · Publicada hace 2 días                         │
│   "Agregado clasificación de intent"                        │
│   [Ver] [Restaurar a esta versión]                          │
│                                                             │
│ v2 · Publicada hace 1 semana                                │
│   "Ajustado mensaje de bienvenida"                          │
│   [Ver] [Restaurar a esta versión]                          │
│                                                             │
│ v1 · Publicada hace 2 semanas                               │
│   "Versión inicial"                                         │
│   [Ver] [Restaurar a esta versión]                          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 5. Modelo de Datos

### 6.1 Tabla `workflow_definitions`

```sql
CREATE TABLE workflow_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES empresas(id),
  nombre TEXT NOT NULL,
  descripcion TEXT,

  -- Estado
  estado workflow_estado NOT NULL DEFAULT 'borrador', -- borrador, activo, pausado

  -- Versión publicada (JSON del grafo)
  version_publicada JSONB,
  version_publicada_at TIMESTAMPTZ,
  version_publicada_nota TEXT,

  -- Versión borrador (si hay cambios sin publicar)
  version_borrador JSONB,
  version_borrador_at TIMESTAMPTZ,

  -- Métricas
  total_ejecuciones INTEGER DEFAULT 0,
  ejecuciones_exitosas INTEGER DEFAULT 0,
  ultima_ejecucion_at TIMESTAMPTZ,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES usuarios(id),

  UNIQUE(empresa_id, nombre)
);

CREATE TYPE workflow_estado AS ENUM ('borrador', 'activo', 'pausado');
```

### 6.2 Tabla `workflow_versions`

```sql
CREATE TABLE workflow_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES workflow_definitions(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  grafo JSONB NOT NULL,
  nota TEXT,
  publicado_at TIMESTAMPTZ DEFAULT now(),
  publicado_por UUID REFERENCES usuarios(id),

  UNIQUE(workflow_id, version)
);
```

### 6.3 Tabla `workflow_executions`

```sql
CREATE TABLE workflow_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES workflow_definitions(id),
  version INTEGER NOT NULL,

  -- Trigger
  trigger_tipo TEXT NOT NULL,
  trigger_data JSONB,

  -- Lead (si aplica)
  lead_id UUID REFERENCES leads(id),
  lead_session_id UUID REFERENCES lead_session(id),

  -- Estado
  estado execution_estado NOT NULL DEFAULT 'running',
  started_at TIMESTAMPTZ DEFAULT now(),
  finished_at TIMESTAMPTZ,

  -- Error (si falló)
  error_nodo_id TEXT,
  error_mensaje TEXT,

  -- Pasos ejecutados
  pasos JSONB DEFAULT '[]'::jsonb
);

CREATE TYPE execution_estado AS ENUM ('running', 'completed', 'failed', 'cancelled');
```

### 6.4 Estructura del Grafo (JSONB)

```typescript
interface WorkflowGrafo {
  nodos: NodoDefinition[];
  aristas: AristaDefinition[];
  viewport?: { x: number; y: number; zoom: number };
}

interface NodoDefinition {
  id: string;
  tipo: NodoTipo;
  posicion: { x: number; y: number };
  config: Record<string, unknown>;
  nombre?: string; // Nombre personalizado
}

type NodoTipo =
  // Triggers
  | "trigger_mensaje"
  | "trigger_webhook"
  | "trigger_cron"
  | "trigger_manual"
  | "trigger_etiqueta"
  | "trigger_etapa"
  | "trigger_lead_creado"
  // Acciones
  | "accion_mensaje"
  | "accion_etiqueta"
  | "accion_etapa"
  | "accion_asignar"
  | "accion_api"
  | "accion_codigo"
  | "accion_email"
  | "accion_tarea"
  // Lógica
  | "logica_condicion"
  | "logica_switch"
  | "logica_loop"
  | "logica_esperar"
  | "logica_esperar_evento"
  | "logica_detener"
  // IA
  | "ia_clasificar"
  | "ia_responder"
  | "ia_extraer"
  | "ia_sentimiento";

interface AristaDefinition {
  id: string;
  origen: string; // nodo_id
  destino: string; // nodo_id
  handleOrigen?: string; // 'si' | 'no' | 'default' | 'caso_1' etc
  handleDestino?: string;
}
```

---

## 6. Plan de Ejecución Paralela

> Trabajo dividido en 10 streams para agentes simultáneos.

### Stream A: Migraciones SQL

| Task | Descripción                                   |
| ---- | --------------------------------------------- |
| A1   | `workflow_definitions` - tabla principal      |
| A2   | `workflow_versions` - historial de versiones  |
| A3   | `workflow_executions` - runs y logs           |
| A4   | `workflow_execution_steps` - detalle por paso |
| A5   | Enums y tipos                                 |
| A6   | Índices y RLS policies                        |

### Stream B: Repositorios

| Task | Descripción                                    |
| ---- | ---------------------------------------------- |
| B1   | `workflow-definitions.repo` con contract tests |
| B2   | `workflow-versions.repo` con contract tests    |
| B3   | `workflow-executions.repo` con contract tests  |

### Stream C: Listado UI

| Task | Descripción                      |
| ---- | -------------------------------- |
| C1   | Página `/workflows` con layout   |
| C2   | WorkflowCard con estado/métricas |
| C3   | Modal crear workflow             |
| C4   | Filtros y búsqueda               |
| C5   | Server actions CRUD              |

### Stream D: Canvas Core

| Task | Descripción                             |
| ---- | --------------------------------------- |
| D1   | Layout 3 paneles (paleta/canvas/config) |
| D2   | Canvas infinito pan/zoom                |
| D3   | Grid snap 16px                          |
| D4   | Conexiones bezier animadas              |
| D5   | Selección simple/múltiple               |
| D6   | Minimap                                 |
| D7   | Controles zoom                          |
| D8   | Undo/Redo (20+ pasos)                   |
| D9   | Copy/Paste                              |
| D10  | Keyboard shortcuts                      |

### Stream E: Paleta de Nodos

| Task | Descripción                    |
| ---- | ------------------------------ |
| E1   | Componente paleta categorizada |
| E2   | Búsqueda instant               |
| E3   | Drag & drop al canvas          |
| E4   | Iconos SVG por tipo            |
| E5   | Colores por categoría          |

### Stream F: Nodos UI (57 tipos)

| Task | Descripción           |
| ---- | --------------------- |
| F1   | NodoBase con handles  |
| F2   | 11 nodos Trigger      |
| F3   | 8 nodos Mensajería    |
| F4   | 10 nodos CRM          |
| F5   | 11 nodos Lógica       |
| F6   | 6 nodos Integraciones |
| F7   | 7 nodos IA            |
| F8   | 4 nodos Internos      |

### Stream G: Panel Config

| Task | Descripción                       |
| ---- | --------------------------------- |
| G1   | Panel contextual base             |
| G2   | Forms dinámicos por tipo          |
| G3   | Selector variables autocompletado |
| G4   | Preview mensaje con vars          |
| G5   | Validación tiempo real            |

### Stream H: Motor Ejecución

| Task | Descripción               |
| ---- | ------------------------- |
| H1   | Executor core             |
| H2   | Handlers por tipo de nodo |
| H3   | Context y variables       |
| H4   | Error handling + retry    |
| H5   | Logging por paso          |
| H6   | Integración Inngest       |

### Stream I: Ejecución UI

| Task | Descripción            |
| ---- | ---------------------- |
| I1   | Modal probar workflow  |
| I2   | Selector datos prueba  |
| I3   | Vista paso a paso      |
| I4   | Highlight nodo activo  |
| I5   | Panel entrada/salida   |
| I6   | Re-run paso individual |

### Stream J: Versiones

| Task | Descripción         |
| ---- | ------------------- |
| J1   | Guardar borrador    |
| J2   | Publicar versión    |
| J3   | Indicador estado    |
| J4   | Modal publicar      |
| J5   | Historial versiones |
| J6   | Restaurar versión   |

### Grafo de Dependencias

```
         A1─A6
           │
     ┌─────┼─────┐
     ▼     ▼     ▼
    B1    B2    B3
     │     │     │
     └──┬──┴──┬──┘
        ▼     ▼
       C1─C5  H1─H6
              │
              ▼
             I1─I6

  (Paralelo sin deps)
  D1─D10, E1─E5, F1─F8, G1─G5, J1─J6
```

---

## 8. Criterios de Aceptación

### Listado

- [ ] Cards muestran estado, métricas y última ejecución
- [ ] Filtros por estado funcionan
- [ ] Búsqueda por nombre funciona
- [ ] Modal de nuevo workflow con opción de template

### Canvas

- [ ] Pan/zoom fluido sin lag
- [ ] Snap a grid visible
- [ ] Conexiones con curva bezier
- [ ] Selección múltiple funciona
- [ ] Undo/redo funciona (al menos 20 pasos)
- [ ] Copy/paste de nodos funciona
- [ ] Minimap navegable
- [ ] Paleta categorizada con búsqueda

### Nodos

- [ ] Cada tipo de nodo tiene icono y color distintivo
- [ ] Config panel muestra campos según tipo
- [ ] Variables disponibles con autocompletado
- [ ] Preview de contenido en el nodo

### Ejecución

- [ ] Probar workflow con datos seleccionables
- [ ] Ver ejecución paso a paso
- [ ] Ver entrada/salida de cada paso
- [ ] Re-ejecutar paso individual
- [ ] Historial filtrable

### Versiones

- [ ] Publicar crea versión
- [ ] Ver diff entre versiones
- [ ] Restaurar versión anterior
- [ ] Workflow activo sigue corriendo mientras se edita borrador

---

## Fuentes de Referencia

- [n8n Guide 2026](https://hatchworks.com/blog/ai-agents/n8n-guide/)
- [n8n UI/UX Deep Dive](https://n8n.spot/n8n-ui-ux-deep-dive-how-thoughtful-design-streamlines-visual-automation/)
- [GoHighLevel Workflow Builder](https://www.ghlexperts.com/features/workflow-builder)
- [FlowMattic Visual Builder](https://flowmattic.com/visual-workflow-builder/)
- [Zapier UI Patterns](https://www.saasui.design/application/zapier)
