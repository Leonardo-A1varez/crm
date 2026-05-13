-- 0003_messages.sql
-- Conversaciones (persistentes) + mensajes (cascade purge sesión) + rule_executions audit.

-- =========================================================================
-- Enums dominio
-- =========================================================================
create type direction_enum as enum ('in','out');

create type sender_enum as enum ('lead','ia','humano','sistema');

create type tipo_mensaje_enum as enum (
  'text','image','audio','video','doc','location','template'
);

-- =========================================================================
-- conversaciones (hilo persistente por canal; nunca se purga)
-- =========================================================================
create table public.conversaciones (
  id                   uuid primary key default gen_random_uuid(),
  lead_id              uuid not null references public.leads(id) on delete cascade,
  canal                canal_enum not null,
  canal_thread_id      text not null,
  ultima_actividad_at  timestamptz not null default now(),
  created_at           timestamptz not null default now(),
  unique (canal, canal_thread_id)
);

create index conversaciones_lead_idx on public.conversaciones (lead_id);
create index conversaciones_ultima_actividad_idx
  on public.conversaciones (ultima_actividad_at desc);

alter table public.conversaciones enable row level security;

-- =========================================================================
-- mensajes
-- CASCADE desde lead_session: purge cron diario borra mensajes con sesión cerrada >29d.
-- =========================================================================
create table public.mensajes (
  id                uuid primary key default gen_random_uuid(),
  conversacion_id   uuid not null references public.conversaciones(id) on delete cascade,
  lead_session_id   uuid not null references public.lead_session(id) on delete cascade,
  direction         direction_enum not null,
  sender            sender_enum not null,
  sender_user_id    uuid references public.usuarios(id) on delete set null,
  tipo              tipo_mensaje_enum not null default 'text',
  contenido         text,
  media_url         text,
  meta_message_id   text,
  metadata          jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now()
);

create index mensajes_conv_created_idx
  on public.mensajes (conversacion_id, created_at desc);
create index mensajes_session_idx on public.mensajes (lead_session_id);
create index mensajes_meta_id_idx
  on public.mensajes (meta_message_id)
  where meta_message_id is not null;
create index mensajes_sender_idx on public.mensajes (sender);

alter table public.mensajes enable row level security;

-- =========================================================================
-- rule_executions (auditoría: qué regla matcheó qué mensaje)
-- =========================================================================
create table public.rule_executions (
  id                  uuid primary key default gen_random_uuid(),
  regla_id            uuid not null references public.reglas(id) on delete cascade,
  mensaje_id          uuid not null references public.mensajes(id) on delete cascade,
  matched_intent_id   uuid not null references public.intents(id) on delete cascade,
  created_at          timestamptz not null default now()
);

create index rule_executions_regla_idx on public.rule_executions (regla_id);
create index rule_executions_mensaje_idx on public.rule_executions (mensaje_id);
create index rule_executions_intent_idx on public.rule_executions (matched_intent_id);
create index rule_executions_created_idx
  on public.rule_executions (created_at desc);

alter table public.rule_executions enable row level security;
