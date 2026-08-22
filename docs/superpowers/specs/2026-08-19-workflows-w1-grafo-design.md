# Workflows W1 — schema del grafo, validador estático y versionado

> Primer sub-proyecto de cinco. **W1 no ejecuta nada**: entrega el modelo de datos, el validador y el versionado. Que un grafo inválido no se pueda guardar es lo que le permite a W2 asumir que lo que lee está sano.

## 1. Por qué, y qué ya existe

El dueño quiere una sección de Workflows para armar flujos automáticos, mejor que Kommo. La observación que reencuadra el proyecto:

**El motor de workflows ya existe.** Inngest corre 12 funciones con ejecución durable, reintentos, idempotencia y cron. Lo que falta no es un motor: es **una forma de definir flujos sin escribir TypeScript**.

Y el schema ya venía esperando esto. `20260816014036_reglas_etiqueta_y_lead_tags_descarte.sql` dice, textual:

> _"Además nace separable: el dueño va a construir un motor de workflows con trigger de etiqueta y esta tabla queda como mecanismo de transición."_

También existe ya, y se reusa en vez de reinventarse:

- `matchesCondiciones(condiciones_extra, context)` en `src/server/services/rule-engine.service.ts` — evaluador de condiciones estructuradas.
- `agente_config` — append-only versionado con una sola fila activa. W1 copia ese patrón exacto.
- `DomainError` + `isNonRetriable()` — la distinción reintentar/rendirse que Inngest ya respeta.

## 2. Qué hace mal Kommo, y qué se hace distinto

Investigado en su documentación de desarrollo (`developers.kommo.com/docs/salesbot-dp`). Su motor son siete handlers: `show`, `condition`, `action`, `widget_request`, `goto`, `wait_answer`, `stop`. El problema no es la cantidad — es `goto`:

```json
{ "handler": "goto", "params": { "step": 3 } }
```

**Salto por índice posicional.** Tres consecuencias al crecer el flujo:

1. Insertar un paso al medio desplaza todos los índices y cada `goto` queda apuntando al lugar equivocado, en silencio.
2. `goto` arbitrario convierte el flujo en un grafo sin estructura: no se valida, no se dibuja limpio, no se razona.
3. Las condiciones anidan `result: [...]` dentro de otras condiciones — a tres niveles deja de entenderse.

Y nada se valida hasta que corre: el error aparece a mitad de conversación con un cliente real.

| Kommo                                | Acá                                                      |
| ------------------------------------ | -------------------------------------------------------- |
| `goto step: 3`                       | aristas entre **IDs de nodo**; mover o insertar no rompe |
| condiciones anidadas                 | cada rama es una **arista explícita**                    |
| valida al ejecutar                   | **valida al guardar**                                    |
| `term1: "chat.origin"` string mágico | condición estructurada: campo + operador + valor         |

**No se inventa un lenguaje.** Las condiciones son datos estructurados que se renderizan como formulario y se evalúan con el `matchesCondiciones` que ya existe. Sin parser, sin gramática, sin intérprete.

## 3. Decisiones tomadas en la conversación

| Pregunta                                                  | Decisión                                                                                                                                                                                        |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ¿Secuencia, canvas con ramas, o reglas disparador→acción? | **Canvas con ramificación** (n8n) **más** secuencia con condiciones y esperas (Kommo). Las dos cosas.                                                                                           |
| ¿Se permiten ciclos?                                      | **Sí, libres.** El dueño eligió la opción más expresiva sabiendo que es un proyecto grande.                                                                                                     |
| ¿Cómo se evita el bucle infinito, entonces?               | Tres capas, §5. La garantía estática de terminación se pierde; la protección baja a runtime.                                                                                                    |
| ¿Orden de los cinco sub-proyectos?                        | W1 schema → W2 motor → W3 catálogo → W4 observabilidad → **W5 canvas al final**.                                                                                                                |
| ¿Por qué el canvas último?                                | Con W1–W3 hay workflows corriendo de verdad. Un canvas construido antes dibuja para un motor no probado y se rehace cuando el motor cambia. Al llegar a W5 se sabe qué nodos existen realmente. |

## 4. Los cinco sub-proyectos

|        | Sub-proyecto                                                 | Entrega algo usable por sí solo |
| ------ | ------------------------------------------------------------ | ------------------------------- |
| **W1** | Schema del grafo · validador estático · versionado inmutable | No — es cimiento                |
| **W2** | Compilador grafo → pasos de Inngest · runtime · los 3 topes  | Sí — workflows corriendo        |
| **W3** | Catálogo de disparadores y acciones                          | Sí — amplía qué puede hacer     |
| **W4** | Observabilidad: qué corrió, por dónde pasó, reejecutar       | Sí                              |
| **W5** | Canvas visual                                                | Sí — la cara del asunto         |

**Este spec cubre W1 y nada más.**

## 5. Ciclos libres sin desastre

Al permitir ciclos libres se pierde la garantía estática de que todo flujo termina. La protección se muda a tres capas. **W1 implementa la primera; las otras dos son de W2 y se documentan acá para que el schema las contemple.**

**Capa 1 — estática, en W1: todo ciclo debe contener al menos un nodo de espera.** Un ciclo sin espera no es un flujo válido, es un bug: gira en milisegundos y funde el sistema. Se detecta al guardar sin restringir la expresividad real, porque un ciclo legítimo de negocio ("insistir cada 2 días") siempre tiene una espera adentro.

**Capa 2 — runtime, en W2: tope duro de pasos por corrida.** `workflow_runs.pasos_ejecutados` se incrementa en cada paso; superado el tope la corrida termina en `fallado` registrando el nodo donde se descontroló. El tope vive en la definición (`workflow_versiones.max_pasos`), con default 500 y un CHECK que impide ponerlo en cero o en un número absurdo.

**Capa 3 — runtime, en W2: tope de mensajes por lead por ventana.** Es el que protege la plata y la reputación: aunque el flujo cicle, el lead no recibe 200 WhatsApps. Se apoya en la ventana de 24 h que el proyecto ya modela.

Sin la capa 1, las otras dos son insuficientes: un ciclo sin espera consume el tope de 500 pasos en menos de un segundo y deja la corrida muerta sin haber hecho nada útil.

## 6. Schema — una migración nueva

Timestamp mayor a `20260817194227` (última aplicada).

### 6.1 `workflows` — la identidad

```sql
create table public.workflows (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null,
  descripcion text,
  -- Apagar un workflow no borra sus corridas en vuelo: W2 decide qué hacer con
  -- ellas. Acá sólo significa "no aceptar disparos nuevos".
  activo      boolean not null default false,
  created_at  timestamptz not null default now(),
  constraint workflows_nombre_len check (char_length(nombre) between 2 and 80)
);
```

### 6.2 `workflow_versiones` — append-only, el grafo

Mismo patrón que `agente_config`: guardar crea una fila nueva, nunca actualiza. Editar un workflow publica una versión nueva; la anterior queda intacta porque puede haber corridas ejecutándola.

```sql
create table public.workflow_versiones (
  id           uuid primary key default gen_random_uuid(),
  workflow_id  uuid not null references public.workflows(id) on delete cascade,
  version      integer not null,
  -- El grafo entero: { nodos: [...], aristas: [...] }. Ver §7.
  grafo        jsonb not null,
  -- Tope de pasos por corrida (capa 2 de §5). Vive en la versión y no en el
  -- workflow para que cambiarlo también genere versión nueva: es parte de la
  -- definición del comportamiento, no una preferencia de la pantalla.
  max_pasos    integer not null default 500,
  publicada    boolean not null default false,
  created_at   timestamptz not null default now(),
  created_by   uuid references public.usuarios(id) on delete set null,
  constraint workflow_versiones_max_pasos_rango check (max_pasos between 1 and 10000)
);

create unique index workflow_versiones_version_unica
  on public.workflow_versiones (workflow_id, version);

-- Una sola versión publicada por workflow. Mismo mecanismo que
-- `agente_config_una_activa`: índice único parcial.
create unique index workflow_versiones_una_publicada
  on public.workflow_versiones (workflow_id) where publicada;

create index workflow_versiones_recientes
  on public.workflow_versiones (workflow_id, created_at desc);
```

### 6.3 `workflow_runs` — una corrida

La fila que hace que editar un workflow no rompa las corridas en vuelo: apunta a la **versión** con la que arrancó, y ese FK nunca cambia.

```sql
create type workflow_run_estado as enum ('corriendo','esperando','terminado','fallado','cancelado');

create table public.workflow_runs (
  id                    uuid primary key default gen_random_uuid(),
  -- La versión exacta con la que arrancó. Editar el workflow publica otra
  -- versión y NO toca esta fila: los leads en vuelo terminan con las reglas
  -- que tenían cuando entraron.
  workflow_version_id   uuid not null references public.workflow_versiones(id) on delete restrict,
  lead_id               uuid not null references public.leads(id) on delete cascade,
  -- La sesión en la que se disparó, cuando aplica. Nullable porque hay
  -- disparadores que no nacen de una sesión (ej. cron sobre un lead).
  lead_session_id       uuid references public.lead_session(id) on delete set null,
  estado                workflow_run_estado not null default 'corriendo',
  -- Nodo donde está parada la corrida. Es un id DENTRO del grafo de la versión,
  -- no una FK: los nodos no son filas.
  nodo_actual           text,
  -- Estado acumulado del flujo, disponible para las condiciones.
  contexto              jsonb not null default '{}'::jsonb,
  -- Capa 2 de §5. W2 lo incrementa y compara contra `max_pasos` de la versión.
  pasos_ejecutados      integer not null default 0,
  -- Por qué murió, cuando murió mal. Texto y no enum: W2 todavía no existe y
  -- fijar la taxonomía ahora sería adivinar.
  error                 text,
  started_at            timestamptz not null default now(),
  ended_at              timestamptz,
  constraint workflow_runs_pasos_no_negativo check (pasos_ejecutados >= 0),
  -- Una corrida terminada tiene fin; una viva no.
  constraint workflow_runs_fin_coherente check (
    (estado in ('terminado','fallado','cancelado')) = (ended_at is not null)
  )
);

-- Las corridas vivas de un lead: lo que W2 consulta antes de disparar otra.
create index workflow_runs_vivas
  on public.workflow_runs (lead_id)
  where estado in ('corriendo','esperando');

create index workflow_runs_por_version
  on public.workflow_runs (workflow_version_id, started_at desc);
```

### 6.4 `workflow_run_pasos` — cada paso ejecutado

Alimenta W4 (observabilidad) y hace posible responder "por qué este lead recibió este mensaje".

```sql
create table public.workflow_run_pasos (
  id          uuid primary key default gen_random_uuid(),
  run_id      uuid not null references public.workflow_runs(id) on delete cascade,
  nodo_id     text not null,
  -- Orden dentro de la corrida. Con ciclos, un mismo nodo_id aparece varias
  -- veces: el orden es lo único que reconstruye el recorrido.
  orden       integer not null,
  entrada     jsonb,
  salida      jsonb,
  error       text,
  created_at  timestamptz not null default now(),
  constraint workflow_run_pasos_orden_unico unique (run_id, orden)
);

create index workflow_run_pasos_recorrido
  on public.workflow_run_pasos (run_id, orden);
```

### 6.5 RLS

Mismo criterio que el resto de configuración (`reglas`, `reglas_etiqueta`, `campanias`): lee cualquiera autenticado, escribe admin. Las cuatro tablas llevan `enable row level security` y el bloque `revoke all ... from public, anon` + grants explícitos que el schema ya usa desde `20260816042039_permisos_explicitos_de_tabla.sql`.

`workflow_runs` y `workflow_run_pasos` las escribe el motor con el cliente service-role, que no pasa por RLS. Las policies de escritura admin existen igual para que la UI pueda cancelar una corrida a mano.

## 7. El grafo

Vive en `workflow_versiones.grafo` como `jsonb`, validado por Zod antes de guardar.

```ts
interface Grafo {
  nodos: Nodo[];
  aristas: Arista[];
}

interface Nodo {
  /** Estable y único dentro del grafo. Las aristas apuntan acá, nunca a un índice. */
  id: string;
  tipo: NodoTipo;
  /** Configuración específica del tipo. W3 define las formas concretas. */
  config: Record<string, unknown>;
  /** Sólo para el canvas de W5. El motor la ignora. */
  posicion: { x: number; y: number };
}

interface Arista {
  desde: string;
  hasta: string;
  /** Cuál salida del nodo origen. Un `condicion` tiene dos; el resto, una. */
  puerto: Puerto;
}

type NodoTipo = "disparador" | "accion" | "condicion" | "espera" | "fin";
type Puerto = "salida" | "verdadero" | "falso";
```

**Puertos por tipo de nodo** — el validador lo usa y W5 lo dibuja:

| Tipo         | Puertos de salida     | Entrantes         |
| ------------ | --------------------- | ----------------- |
| `disparador` | `salida`              | ninguna permitida |
| `accion`     | `salida`              | una o más         |
| `condicion`  | `verdadero` y `falso` | una o más         |
| `espera`     | `salida`              | una o más         |
| `fin`        | ninguno               | una o más         |

W1 **no** define qué acciones ni qué disparadores existen — eso es W3. W1 valida la **forma** del grafo. `config` se valida como objeto y nada más; cuando W3 aporte el catálogo, el validador gana una capa que verifica `config` contra el tipo concreto.

## 8. El validador

`src/lib/workflows/validar-grafo.ts` — función pura, sin acceso a base. Recibe un `Grafo` y devuelve la lista de problemas (vacía = válido). Devuelve **todos** los problemas, no el primero: quien arma un flujo quiere ver todo lo que falta de una vez.

```ts
interface ProblemaGrafo {
  regla: ReglaValidacion;
  /** Nodos involucrados, para que W5 los pinte en rojo. */
  nodos: string[];
  mensaje: string;
}

type ReglaValidacion =
  | "disparador_unico"
  | "disparador_sin_entrantes"
  | "nodo_inalcanzable"
  | "salida_sin_conectar"
  | "arista_a_nodo_inexistente"
  | "condicion_puertos"
  | "ciclo_sin_espera";
```

Las siete reglas:

1. **`disparador_unico`** — exactamente un nodo `disparador`. Cero: nada lo arranca. Dos: ambiguo cuál es el punto de entrada.
2. **`disparador_sin_entrantes`** — ninguna arista termina en el disparador. Una arista hacia él significaría reiniciar el flujo desde adentro: un ciclo disfrazado, sin la espera que exige la regla 7.
3. **`nodo_inalcanzable`** — todo nodo se alcanza desde el disparador siguiendo aristas. Un nodo huérfano es trabajo que alguien creyó haber conectado.
4. **`salida_sin_conectar`** — cada puerto de salida tiene arista. `fin` no tiene puertos, así que es el único que cierra un camino. Sin esta regla un flujo se muere en silencio a mitad de camino y nadie sabe por qué.
5. **`arista_a_nodo_inexistente`** — `desde` y `hasta` existen en `nodos`.
6. **`condicion_puertos`** — un `condicion` tiene exactamente una arista por `verdadero` y una por `falso`. Ni dos por el mismo puerto (indeterminismo), ni ninguna.
7. **`ciclo_sin_espera`** — **la regla que hace seguros los ciclos libres.** Se detectan todos los ciclos; cada uno debe contener al menos un nodo `espera`. Es la capa 1 de §5.

**Detección de ciclos:** DFS con marcado de tres colores (blanco/gris/negro). Al encontrar una arista hacia un nodo gris se reconstruye el ciclo desde la pila de recursión y se revisa si alguno de sus nodos es `espera`. Un mismo nodo puede pertenecer a varios ciclos; el validador reporta cada ciclo sin espera por separado, con sus nodos, para que W5 pueda resaltarlo.

## 9. Alcance de W1

**Entra:** la migración, los tipos TypeScript del grafo, el schema Zod, el validador puro con sus tests, los repositorios de las cuatro tablas con contract tests, y un service que publica versiones aplicando el validador.

**No entra:** ejecutar (W2), el catálogo de disparadores/acciones (W3), la observabilidad (W4), el canvas (W5), y **ninguna pantalla** — W1 no tiene UI. Se prueba con tests.

Que W1 no tenga UI es deliberado, y es la lección 7 de `AGENTS.md` aplicada al revés: no se declara terminado porque los archivos existen, sino porque los tests prueban que el validador rechaza los siete casos inválidos y acepta los válidos.

## 10. Testing

El validador es una función pura sobre una estructura de datos: TDD de manual, y `AGENTS.md §0.11` lo exige para lógica de negocio.

- **Una prueba por regla en su forma negativa** — un grafo que viola exactamente esa regla y ninguna otra, confirmando que el problema reportado es el correcto. Siete casos mínimo.
- **Grafos válidos que podrían confundirse con inválidos:** un ciclo _con_ espera (válido, regla 7 no dispara), dos ramas de una condición que vuelven a unirse en el mismo nodo (válido, no es ciclo), un nodo con varias aristas entrantes (válido).
- **El caso que más importa:** un grafo con dos problemas distintos devuelve los dos, no el primero.
- Contract tests de los cuatro repositorios, contra InMemory. **No corren contra Postgres** — `test:integration` sigue congelado (`AGENTS.md`, lección 10) y decirlo es parte del cierre, no una nota al pie.

## 11. Lo que este spec deja explícitamente sin resolver

- **Qué pasa con las corridas vivas cuando se despublica un workflow.** W1 permite el estado; la política la decide W2.
- **La taxonomía de errores de corrida** (`workflow_runs.error` es texto libre). Fijarla ahora sería adivinar sin haber ejecutado un flujo.
- **`config` de cada nodo** se valida como objeto genérico. La validación por tipo llega con W3.
- **Concurrencia:** si un lead puede tener dos corridas del mismo workflow a la vez. El índice `workflow_runs_vivas` existe para poder consultarlo barato, pero la regla la pone W2.
