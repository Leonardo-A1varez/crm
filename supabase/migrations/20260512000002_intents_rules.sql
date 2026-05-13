-- 0002_intents_rules.sql
-- Motor intents + reglas IF/THEN + tagging.
-- rule_executions movida a 0003 (FK → mensajes).

-- =========================================================================
-- Enums dominio
-- =========================================================================
create type respuesta_tipo_enum as enum ('text','template','handoff');

create type tag_source_enum as enum ('manual','workflow');

-- =========================================================================
-- intents
-- =========================================================================
create table public.intents (
  id              uuid primary key default gen_random_uuid(),
  nombre          text not null unique,
  descripcion     text not null default '',
  ejemplos        text[] not null default '{}',
  auto_detectado  boolean not null default false,
  activo          boolean not null default true,
  created_at      timestamptz not null default now()
);

create index intents_activo_idx on public.intents (activo) where activo = true;
create index intents_nombre_trgm_idx on public.intents using gin (nombre gin_trgm_ops);

alter table public.intents enable row level security;

-- =========================================================================
-- reglas
-- =========================================================================
create table public.reglas (
  id                   uuid primary key default gen_random_uuid(),
  intent_id            uuid not null references public.intents(id) on delete cascade,
  condiciones_extra    jsonb,
  respuesta_tipo       respuesta_tipo_enum not null,
  respuesta_contenido  text not null,
  prioridad            integer not null default 0,
  activa               boolean not null default true,
  created_at           timestamptz not null default now()
);

create index reglas_intent_idx on public.reglas (intent_id);
create index reglas_activa_prioridad_idx
  on public.reglas (intent_id, prioridad desc)
  where activa = true;

alter table public.reglas enable row level security;

-- =========================================================================
-- tags
-- =========================================================================
create table public.tags (
  id           uuid primary key default gen_random_uuid(),
  nombre       text not null unique,
  color        text not null default '#888888'
               check (color ~ '^#[0-9a-fA-F]{6}$'),
  descripcion  text,
  created_at   timestamptz not null default now()
);

alter table public.tags enable row level security;

-- =========================================================================
-- lead_tags (pivot)
-- =========================================================================
create table public.lead_tags (
  lead_id       uuid not null references public.leads(id) on delete cascade,
  tag_id        uuid not null references public.tags(id) on delete cascade,
  source        tag_source_enum not null default 'manual',
  assigned_by   uuid references public.usuarios(id) on delete set null,
  assigned_at   timestamptz not null default now(),
  primary key (lead_id, tag_id)
);

create index lead_tags_tag_idx on public.lead_tags (tag_id);
create index lead_tags_source_idx on public.lead_tags (source);

alter table public.lead_tags enable row level security;
