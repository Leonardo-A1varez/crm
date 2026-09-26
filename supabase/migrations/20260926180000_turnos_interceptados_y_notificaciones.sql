-- Dos piezas de los flujos que se apoyan en tablas nuevas (decisiones 2 y 3 del
-- dueño, 2026-09-26):
--
--   1. `turnos_interceptados`: el turno que contestó un flujo en lugar del
--      agente de IA ("intercepta el LLM", o el toque de un botón que una
--      corrida estaba esperando). Auditable: sin esta fila, un entrante sin
--      respuesta del agente es indistinguible de un turno que se cayó.
--   2. `notificaciones`: "Avisar al equipo" deja un aviso en el panel para el
--      vendedor asignado o, sin uno, para los admins. No es WhatsApp ni email:
--      no depende de Meta ni del cupo.
--
-- Reaplicable a propósito (`if not exists`, `drop policy if exists`): en el
-- stack local se aplica sola con psql, sin `migration up`, para no arrastrar
-- migraciones pendientes de otros.

-- =========================================================================
-- 1. turnos_interceptados
-- =========================================================================
--
-- Mismo patrón que `turn_classifications` y `rule_executions`: una fila
-- append-only por turno, colgada del mensaje ENTRANTE. UNIQUE por mensaje: el
-- reintento del step no audita el turno dos veces. Se va con el mensaje
-- (CASCADE) cuando la purga de 29 días borra la sesión.
--
-- Sin texto del mensaje ni datos del lead: tres referencias y un motivo.
create table if not exists public.turnos_interceptados (
  id                  uuid primary key default gen_random_uuid(),
  mensaje_id          uuid not null unique references public.mensajes(id) on delete cascade,
  -- `set null`: borrar el flujo no borra la constancia de que el agente calló.
  workflow_id         uuid references public.workflows(id) on delete set null,
  -- La versión cuya condición se cumplió (motivo `condicion`).
  workflow_version_id uuid references public.workflow_versiones(id) on delete set null,
  -- La corrida que esperaba el toque (motivo `respuesta_esperada`). En
  -- `condicion` es null: la corrida la arranca después `workflow-disparar`.
  workflow_run_id     uuid references public.workflow_runs(id) on delete set null,
  motivo              text not null
    check (motivo in ('condicion', 'respuesta_esperada')),
  created_at          timestamptz not null default now()
);

-- Las FK que pueden quedar en null por un borrado necesitan índice: sin él, el
-- `on delete set null` recorre la tabla entera por cada flujo borrado.
create index if not exists turnos_interceptados_workflow_idx
  on public.turnos_interceptados (workflow_id);
create index if not exists turnos_interceptados_version_idx
  on public.turnos_interceptados (workflow_version_id);
create index if not exists turnos_interceptados_run_idx
  on public.turnos_interceptados (workflow_run_id);

comment on table public.turnos_interceptados is
  'Turnos que contestó un flujo en lugar del agente de IA. Una fila por mensaje entrante.';

alter table public.turnos_interceptados enable row level security;

-- Lectura para el Inbox. La escribe el pipeline con service-role (bypassa RLS):
-- sin policy de INSERT nadie más puede fabricar auditoría.
drop policy if exists turnos_interceptados_select on public.turnos_interceptados;
create policy turnos_interceptados_select on public.turnos_interceptados
  for select to authenticated
  using ((select public.is_admin()) or (select public.is_vendedor()));

-- =========================================================================
-- 2. notificaciones
-- =========================================================================
--
-- Guarda referencias (lead, conversación, corrida) y el texto que escribió
-- quien armó el flujo, sin resolver variables: nunca una copia de datos del
-- lead. El nombre del lead se lee al mostrarla, por la FK, así que borrar el
-- lead (derecho de supresión) se lleva la notificación con él.
create table if not exists public.notificaciones (
  id              uuid primary key default gen_random_uuid(),
  usuario_id      uuid not null references public.usuarios(id) on delete cascade,
  lead_id         uuid references public.leads(id) on delete cascade,
  conversacion_id uuid references public.conversaciones(id) on delete set null,
  workflow_run_id uuid references public.workflow_runs(id) on delete set null,
  texto           text not null check (char_length(btrim(texto)) between 1 and 500),
  -- Idempotencia: `wf:<runId>:<orden>`. Un reintento del paso no duplica el
  -- aviso de ningún destinatario.
  clave           text not null,
  leida_at        timestamptz,
  created_at      timestamptz not null default now(),
  constraint notificaciones_clave_por_usuario unique (clave, usuario_id)
);

-- Lo que pide el panel en cada navegación: las del usuario, las más nuevas
-- primero, y cuántas no leyó.
create index if not exists notificaciones_usuario_idx
  on public.notificaciones (usuario_id, created_at desc);
create index if not exists notificaciones_no_leidas_idx
  on public.notificaciones (usuario_id)
  where leida_at is null;
create index if not exists notificaciones_lead_idx
  on public.notificaciones (lead_id);
create index if not exists notificaciones_conversacion_idx
  on public.notificaciones (conversacion_id);
create index if not exists notificaciones_run_idx
  on public.notificaciones (workflow_run_id);

comment on table public.notificaciones is
  'Avisos del panel ("Avisar al equipo"). Cada usuario ve solo las suyas.';

alter table public.notificaciones enable row level security;

-- Cada usuario ve solo las suyas; ni el admin lee las de otro.
drop policy if exists notificaciones_select_propias on public.notificaciones;
create policy notificaciones_select_propias on public.notificaciones
  for select to authenticated
  using (usuario_id = (select auth.uid()));

-- Marcar como leída: solo las propias y solo `leida_at` (grant por columna).
drop policy if exists notificaciones_update_propias on public.notificaciones;
create policy notificaciones_update_propias on public.notificaciones
  for update to authenticated
  using (usuario_id = (select auth.uid()))
  with check (usuario_id = (select auth.uid()));

revoke insert, update, delete on public.notificaciones from anon, authenticated;
grant select on public.notificaciones to authenticated;
grant update (leida_at) on public.notificaciones to authenticated;

-- La campanita del panel se entera de un aviso nuevo por Realtime, filtrado
-- por `usuario_id`. Realtime entrega cada fila con la policy de SELECT de
-- quien mira (`notificaciones_select_propias`): nadie recibe los de otro.
do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'notificaciones'
  ) then
    alter publication supabase_realtime add table public.notificaciones;
  end if;
end
$$;
