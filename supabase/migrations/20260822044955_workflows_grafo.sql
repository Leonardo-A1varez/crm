-- Workflows W1: definir un flujo como grafo, validarlo antes de guardarlo y
-- versionarlo de forma inmutable. NO ejecuta nada — eso es W2.
-- Diseño completo en docs/superpowers/specs/2026-08-19-workflows-w1-grafo-design.md
--
-- El motor de ejecución ya existe (Inngest). Lo que falta es poder definir un
-- flujo sin escribir TypeScript, y eso arranca por poder guardarlo.

create table public.workflows (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null,
  descripcion text,
  -- Apagar un workflow no toca sus corridas en vuelo: acá sólo significa
  -- "no aceptar disparos nuevos". Qué hacer con las vivas lo decide W2.
  activo      boolean not null default false,
  created_at  timestamptz not null default now(),
  constraint workflows_nombre_len check (char_length(nombre) between 2 and 80)
);

comment on table public.workflows is
  'Identidad de un flujo automatico. El grafo vive en workflow_versiones.';

alter table public.workflows enable row level security;

create policy workflows_select on public.workflows
  for select to authenticated
  using ((select public.is_admin()) or (select public.is_vendedor()));
create policy workflows_insert_admin on public.workflows
  for insert to authenticated
  with check ((select public.is_admin()));
create policy workflows_update_admin on public.workflows
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
create policy workflows_delete_admin on public.workflows
  for delete to authenticated
  using ((select public.is_admin()));

revoke all on table public.workflows from public, anon;
grant select, insert, update, delete on table public.workflows to authenticated;
grant all on table public.workflows to service_role;

-- =========================================================================
-- Versiones: append-only, mismo patrón que agente_config
-- =========================================================================
-- Guardar inserta una fila nueva, nunca actualiza una existente. Es lo que
-- permite editar un workflow con corridas en vuelo sin romperlas: cada
-- corrida sigue apuntando a la versión con la que arrancó.

create table public.workflow_versiones (
  id           uuid primary key default gen_random_uuid(),
  workflow_id  uuid not null references public.workflows(id) on delete cascade,
  version      integer not null,
  -- { nodos: [...], aristas: [...] }. Validado por validarGrafo() antes de
  -- publicarse: acá llega sano o no llega.
  grafo        jsonb not null,
  -- Tope de pasos por corrida. Vive en la versión y no en el workflow para que
  -- cambiarlo también genere versión nueva: es comportamiento, no preferencia.
  max_pasos    integer not null default 500,
  publicada    boolean not null default false,
  created_at   timestamptz not null default now(),
  created_by   uuid references public.usuarios(id) on delete set null,
  constraint workflow_versiones_max_pasos_rango check (max_pasos between 1 and 10000)
);

comment on column public.workflow_versiones.max_pasos is
  'Tope duro de pasos por corrida. Capa 2 de las tres que hacen seguros los ciclos libres; W2 lo hace cumplir.';

create unique index workflow_versiones_version_unica
  on public.workflow_versiones (workflow_id, version);

-- Una sola publicada por workflow. Mismo mecanismo que agente_config_una_activa.
create unique index workflow_versiones_una_publicada
  on public.workflow_versiones (workflow_id) where publicada;

create index workflow_versiones_recientes
  on public.workflow_versiones (workflow_id, created_at desc);

alter table public.workflow_versiones enable row level security;

create policy workflow_versiones_select on public.workflow_versiones
  for select to authenticated
  using ((select public.is_admin()) or (select public.is_vendedor()));
create policy workflow_versiones_insert_admin on public.workflow_versiones
  for insert to authenticated
  with check ((select public.is_admin()));
-- Sin policy de UPDATE del grafo: la tabla es append-only por diseño. La de
-- update existe sólo para poder despublicar (marcar publicada = false).
create policy workflow_versiones_update_admin on public.workflow_versiones
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

revoke all on table public.workflow_versiones from public, anon;
grant select, insert, update on table public.workflow_versiones to authenticated;
grant all on table public.workflow_versiones to service_role;

-- =========================================================================
-- Corridas
-- =========================================================================

create type workflow_run_estado as enum ('corriendo','esperando','terminado','fallado','cancelado');

create table public.workflow_runs (
  id                  uuid primary key default gen_random_uuid(),
  -- La versión exacta con la que arrancó. `restrict` y no `cascade`: borrar una
  -- versión que alguien está ejecutando dejaría corridas sin definición.
  workflow_version_id uuid not null references public.workflow_versiones(id) on delete restrict,
  lead_id             uuid not null references public.leads(id) on delete cascade,
  -- Nullable: hay disparadores que no nacen de una sesión (ej. cron por lead).
  lead_session_id     uuid references public.lead_session(id) on delete set null,
  estado              workflow_run_estado not null default 'corriendo',
  -- Un id DENTRO del grafo de la versión, no una FK: los nodos no son filas.
  nodo_actual         text,
  contexto            jsonb not null default '{}'::jsonb,
  pasos_ejecutados    integer not null default 0,
  -- Texto y no enum: W2 todavía no existe y fijar la taxonomía ahora sería
  -- adivinar sin haber ejecutado un flujo.
  error               text,
  started_at          timestamptz not null default now(),
  ended_at            timestamptz,
  constraint workflow_runs_pasos_no_negativo check (pasos_ejecutados >= 0),
  -- Una corrida terminada tiene fin; una viva no. Sin esto quedan corridas
  -- "corriendo" con ended_at, que rompen cualquier consulta de duración.
  constraint workflow_runs_fin_coherente check (
    (estado in ('terminado','fallado','cancelado')) = (ended_at is not null)
  )
);

create index workflow_runs_vivas
  on public.workflow_runs (lead_id)
  where estado in ('corriendo','esperando');

create index workflow_runs_por_version
  on public.workflow_runs (workflow_version_id, started_at desc);

alter table public.workflow_runs enable row level security;

create policy workflow_runs_select on public.workflow_runs
  for select to authenticated
  using ((select public.is_admin()) or (select public.is_vendedor()));
-- Las escribe el motor con service-role, que no pasa por RLS. La policy de
-- update admin existe para poder cancelar una corrida a mano desde la UI.
create policy workflow_runs_update_admin on public.workflow_runs
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

revoke all on table public.workflow_runs from public, anon;
grant select, update on table public.workflow_runs to authenticated;
grant all on table public.workflow_runs to service_role;

-- =========================================================================
-- Pasos de cada corrida
-- =========================================================================
-- Alimenta la observabilidad de W4 y es lo que permite responder "por qué este
-- lead recibió este mensaje".

create table public.workflow_run_pasos (
  id         uuid primary key default gen_random_uuid(),
  run_id     uuid not null references public.workflow_runs(id) on delete cascade,
  nodo_id    text not null,
  -- Con ciclos, un mismo nodo_id aparece varias veces en la misma corrida:
  -- el orden es lo único que reconstruye el recorrido.
  orden      integer not null,
  entrada    jsonb,
  salida     jsonb,
  error      text,
  created_at timestamptz not null default now(),
  constraint workflow_run_pasos_orden_unico unique (run_id, orden)
);

create index workflow_run_pasos_recorrido
  on public.workflow_run_pasos (run_id, orden);

alter table public.workflow_run_pasos enable row level security;

create policy workflow_run_pasos_select on public.workflow_run_pasos
  for select to authenticated
  using ((select public.is_admin()) or (select public.is_vendedor()));

revoke all on table public.workflow_run_pasos from public, anon;
grant select on table public.workflow_run_pasos to authenticated;
grant all on table public.workflow_run_pasos to service_role;
