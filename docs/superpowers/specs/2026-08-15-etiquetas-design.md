# Etiquetas: administración compacta y asignación automática

**Fecha:** 2026-08-15
**Estado:** aprobado por el dueño, listo para plan de implementación

---

## 1. Por qué

La pantalla `/tags` administra etiquetas: crea, edita, borra y muestra cuántos leads usan cada una. No tiene buscador. Ocupa 1 de las 7 entradas de la barra lateral. En la base hay **una sola etiqueta** (`seed-vip`, en 1 lead).

El problema no es que la pantalla sea básica: es que **las etiquetas no hacen nada solas**. `AGENTS.md §3` declara como decisión cerrada _"Tags: auto vía workflows + manuales editables"_, y `lead_tags` tiene desde la migración fundacional una columna `source tag_source_enum` con valores `manual | workflow`. El schema fue diseñado esperando etiquetado automático. **Ningún workflow escribe `lead_tags` jamás** — las 0 filas con `source='workflow'` lo confirman. La mitad automática nunca se construyó.

Una etiqueta que alguien tiene que acordarse de poner a mano contradice la tesis del producto: el diferenciador declarado es _"sin kanban manual"_, la etapa se calcula sola. Las etiquetas quedaron como el único objeto que exige trabajo manual.

## 2. Alcance

**Entra:**

1. La administración de etiquetas se muda a un modal que se abre desde la pantalla de Leads. `/tags` se borra y sale de la barra lateral.
2. Una regla puede colgar una etiqueta automáticamente, **sin obligación de contestar**.
3. Sacar una etiqueta a mano es definitivo: esa regla no vuelve a ponérsela a ese lead.

**No entra:**

- Fusionar o renombrar etiquetas en masa. Se difiere hasta que la cantidad de etiquetas lo haga doler.
- Mostrar en el modal qué reglas usan cada etiqueta. En su lugar, borrar una etiqueta en uso **falla con un mensaje claro** (ver §4.2).
- Etiquetas que cambien el comportamiento del sistema (pausar la IA, excluir de reactivación, priorizar en triage). Se difiere.
- Etiquetado desde el extractor de conversación (taller vs particular, pide factura, regatea). Se difiere.

## 3. Hacia dónde va esto (restricción de diseño, no trabajo de ahora)

El dueño va a construir **un motor de workflows con trigger de etiqueta**: un workflow arranca porque un lead recibió cierta etiqueta, con condiciones extra sobre quién lo dispara. Cuando llegue, **el IF/THEN queda como mecanismo de transición**.

Dos consecuencias que sí afectan el diseño de hoy:

1. `reglas_etiqueta` va en **tabla propia y separable**, para poder deprecarla sin tocar `lead_tags` ni el modelo de etiquetas.
2. El punto de integración futuro es **la asignación de la etiqueta**, no la regla. Por eso todo camino que cuelgue una etiqueta pasa por `TagsRepository.assignToLead`: mañana un workflow se engancha ahí sin reescribir nada.

No se construye ninguna parte del motor de workflows en este trabajo.

## 4. Arquitectura

### 4.1 Por qué una tabla aparte y no una columna en `reglas`

Las dos clases de regla tienen reglas de selección **contradictorias**:

|                 | Regla que contesta             | Regla que etiqueta         |
| --------------- | ------------------------------ | -------------------------- |
| Cuántas aplican | **una**, la de mayor prioridad | **todas** las que matcheen |
| Corta el LLM    | sí — es el ahorro de costo     | no                         |
| `prioridad`     | decide quién gana              | no significa nada          |

Meterlas en la misma fila obliga a aflojar `respuesta_contenido` de `NOT NULL` a nullable, y entonces **todo lector de una regla tiene que manejar el vacío** — incluido el que decide si se llama o no al LLM. Si eso se rompe, se rompe el ahorro y encima en silencio.

Se descartó también una tabla genérica `regla_acciones` (tipo + payload): para un solo tipo de acción nueva es abstracción prematura, prohibida por `AGENTS.md §6`.

### 4.2 Tabla nueva

```sql
create table public.reglas_etiqueta (
  id                uuid primary key default gen_random_uuid(),
  intent_id         uuid not null references public.intents(id) on delete cascade,
  tag_id            uuid not null references public.tags(id) on delete restrict,
  condiciones_extra jsonb,
  activa            boolean not null default true,
  created_at        timestamptz not null default now(),
  constraint reglas_etiqueta_par_unico unique (intent_id, tag_id)
);
```

`unique (intent_id, tag_id)`: dos filas iguales colgarían la misma etiqueta dos veces.

**`on delete restrict` en `tag_id`, no cascade.** Con cascade, borrar una etiqueta desde el modal borraría la regla que la asigna sin decir nada. Con restrict, Postgres devuelve `23503`, `mapPostgrestError` lo convierte en `ConflictError` y el modal muestra el motivo. El usuario se entera en vez de perder la regla en silencio.

RLS igual que `reglas`: admin RW, vendedor solo lectura.

### 4.3 `lead_tags` deja de borrar filas

```sql
alter table public.lead_tags
  add column quitada_at  timestamptz,
  add column quitada_por uuid references public.usuarios(id) on delete set null;
```

`removeFromLead` marca en vez de borrar. Todas las lecturas filtran `quitada_at is null`.

Se eligió marcar y no una tabla `lead_tags_descartadas` porque así **"puesta" y "descartada" son el mismo renglón en dos estados y no pueden contradecirse**. Con dos tablas, un lead podría figurar con la etiqueta puesta y descartada a la vez, y habría que elegir a cuál creerle.

De ahí sale la regla de reasignación, que aprovecha que `assignToLead(leadId, tagId, source, assignedBy?)` **ya recibe el source**:

| Quién asigna | Si ya existe la fila (puesta o descartada) |
| ------------ | ------------------------------------------ |
| `workflow`   | no hace nada                               |
| `manual`     | limpia `quitada_at` y `quitada_por`        |

Sacarla a mano es definitivo **para la regla**, pero un vendedor puede volver a ponerla él mismo — que es exactamente lo que se pidió.

### 4.4 Motor

`RuleEngineService` gana un método al lado del que ya existe, sin tocarlo:

```ts
match(input: RuleMatchInput): Promise<RuleMatchResult | null>;  // sin cambios
etiquetasPara(input: RuleMatchInput): Promise<UUID[]>;          // nuevo
```

El predicado de `condiciones_extra` se extrae a una función pura que usan los dos, para que no deriven. Una copia que deriva hace que la misma condición signifique cosas distintas según quién la evalúe.

### 4.5 Dónde se ejecuta

En `AiAgentService.responder()`, después de clasificar el intent y **antes** del corte por regla que contesta. Así el lead se etiqueta igual, conteste una regla enlatada o conteste el LLM.

## 5. Pantallas

### 5.1 Modal de etiquetas

Se abre con un botón `Etiquetas` al lado del buscador de la pantalla de Leads.

- Buscador que filtra mientras se escribe.
- Lista: color, nombre, y cuántos leads la usan.
- Crear, editar nombre y color, borrar (solo admin).
- **Clic en el contador**: cierra el modal y deja Leads filtrado por esa etiqueta, con el filtro `etiquetaId` que ya existe.
- Borrar una etiqueta que usa una regla falla con mensaje claro (§4.2).
- El vendedor ve y filtra; no edita.

Cierra al hacer clic afuera y con `Escape`, como el resto de los diálogos del panel.

### 5.2 Barra lateral

`/tags` se borra y sale de la barra. De 7 entradas quedan 6. Es el primer paso de un objetivo más amplio del dueño: **menos secciones, cada una sirviendo para más cosas**.

### 5.3 Reglas que etiquetan

Pestaña en `/intents-reglas/reglas`: intent, etiqueta, condiciones, activa. Es la pantalla más chica de las tres.

## 6. Errores

| Situación                               | Qué pasa                                                                                                                                |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Borrar una etiqueta que usa una regla   | `ConflictError` con mensaje que nombra el motivo. No se borra nada.                                                                     |
| Falla al colgar una etiqueta automática | Se traga con `logger.warn` y el turno sigue. La respuesta al cliente vale más que la anotación; el próximo mensaje vuelve a intentarlo. |
| Regla activa cuya etiqueta fue borrada  | Imposible por `on delete restrict`.                                                                                                     |
| Nombre de etiqueta repetido             | `ConflictError` — `tags.nombre` ya es `unique`.                                                                                         |

## 7. Tests

- **Contract test** de `reglas-etiqueta.repo` (in-memory + Supabase), como los otros 24 repos.
- **Contract test de `tags.repo` extendido**: que `removeFromLead` marque y no borre; que las lecturas no devuelvan las descartadas; la tabla de reasignación de §4.3 en sus cuatro casos.
- **Motor**: que `etiquetasPara` devuelva **todas** las que matchean y no solo la de mayor prioridad; que respete `activa`; que las condiciones extra se evalúen igual que en `match`.
- **Agente**: que el lead se etiquete tanto cuando contesta una regla enlatada como cuando contesta el LLM; que un fallo al etiquetar no tumbe la respuesta.
- **Regresión del ciclo**: sacar a mano una etiqueta puesta por regla, volver a disparar la regla, y verificar que **no** vuelve.

## 8. Decisiones cerradas

1. Una regla puede etiquetar **sin contestar**.
2. Sacar a mano es **definitivo** para la regla; una persona sí puede volver a ponerla.
3. El modal cubre lo esencial más el salto a los leads. Sin fusionar, sin listar reglas.
4. Tabla aparte (enfoque B), no columna en `reglas`.
5. `lead_tags` marca en vez de borrar.
