-- Clasificación del turno cuando lo contesta el LLM.
--
-- Hasta ahora la clasificación de un turno solo sobrevivía si alguna regla la
-- matcheaba: el pipeline audita ese caso en `rule_executions` y descarta el
-- resto. Como consecuencia, `rule_executions` registra por construcción solo
-- los intents que YA tienen regla, y la pregunta que importa —"cuánto se está
-- usando un intent que todavía nadie cubrió"— no tenía dato.
--
-- Tabla nueva y no una columna en `mensajes`:
--   1. Es el mismo patrón que `rule_executions`: una fila append-only por
--      turno, colgada del mensaje ENTRANTE que la disparó. Las dos mitades del
--      turno (regla / LLM) quedan con la misma forma y la misma query por
--      ventana de tiempo, en vez de una tabla y un jsonb que hay que unir
--      distinto según el caso.
--   2. `mensajes` es la tabla más caliente del schema y la más grande. Una
--      columna tipada estaría en NULL en todos los salientes y en todos los
--      entrantes que resolvió una regla — la mayoría de las filas.
--   3. Meterlo en `mensajes.metadata` mezclaría auditoría inmutable con el
--      payload crudo de Meta, y contar por intent obligaría a un índice GIN de
--      expresión sobre un jsonb que se escribe en cada mensaje.
--
-- Guarda los dos: `intent_id` para contar contra la tabla de intents, y
-- `intent_nombre` porque es lo que devolvió el clasificador y tiene que
-- sobrevivir a que después renombren o borren el intent.

create table public.turn_classifications (
  id             uuid primary key default gen_random_uuid(),
  -- UNIQUE, no solo FK: un replay del workflow no puede contar el turno dos
  -- veces. `rule_executions` no lo tiene y arrastra esa deuda.
  mensaje_id     uuid not null unique references public.mensajes(id) on delete cascade,
  intent_id      uuid references public.intents(id) on delete set null,
  intent_nombre  text,
  confidence     numeric(4,3) not null check (confidence >= 0 and confidence <= 1),
  created_at     timestamptz not null default now()
);

create index turn_classifications_intent_created_idx
  on public.turn_classifications (intent_id, created_at desc);
create index turn_classifications_created_idx
  on public.turn_classifications (created_at desc);

comment on table public.turn_classifications is
  'Turnos que resolvio el LLM (source = llm), con el intent que clasifico el turno. Los turnos que resolvio una regla van en rule_executions.';
comment on column public.turn_classifications.intent_id is
  'NULL cuando el clasificador no reconocio ningun intent activo, o cuando el intent se borro despues.';
comment on column public.turn_classifications.intent_nombre is
  'Nombre tal como se clasifico. Sobrevive al rename o borrado del intent, a diferencia del FK.';

alter table public.turn_classifications enable row level security;

-- Lectura para el panel (metricas §3.2). La escritura la hace el pipeline con
-- service-role, que bypassa RLS: sin policy de INSERT, nadie mas puede escribir
-- auditoria. Mismo criterio que `tool_executions`.
create policy turn_classifications_select on public.turn_classifications
  for select to authenticated
  using ((select public.is_admin()) or (select public.is_vendedor()));

-- `rule_executions` quedo deny-all para authenticated en la migracion de RLS
-- (0714124024) por ser "tabla infra". Dejo de serlo: la columna "Usos/sem" de
-- la tabla de reglas y el reparto regla/LLM de metricas la leen desde el panel
-- con el client authed, y sin esta policy los dos devuelven cero en silencio.
-- Solo SELECT: las filas las sigue escribiendo el pipeline con service-role.
-- No hay PII adentro — son tres FK y un timestamp.
create policy rule_executions_select on public.rule_executions
  for select to authenticated
  using ((select public.is_admin()) or (select public.is_vendedor()));
