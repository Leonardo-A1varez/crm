-- 0001_init.sql
-- Schema core: empresas, usuarios, leads, lead_session, productos.
-- RLS habilitado sin policies (deny-all). Policies reales en 0004 + fase 13.

-- =========================================================================
-- Extensions
-- =========================================================================
create extension if not exists "pgcrypto";   -- gen_random_uuid()
create extension if not exists "pg_trgm";    -- trigram fuzzy search

-- =========================================================================
-- Enums dominio (espejo de src/types/domain.ts)
-- =========================================================================
create type current_stage_enum as enum (
  'nuevo','identificando','cotizado','negociando',
  'esperando_pago','cerrado','perdido','requiere_humano'
);

create type urgencia_enum as enum ('baja','media','alta');

create type canal_enum as enum ('wa','ig','fb');

create type metodo_pago_enum as enum ('transferencia','efectivo','tarjeta');

create type resultado_enum as enum ('exito','perdido');

create type motivo_perdida_enum as enum ('precio','stock','tiempo','no_responde','otro');

create type rol_usuario_enum as enum ('admin','vendedor');

-- =========================================================================
-- empresas
-- =========================================================================
create table public.empresas (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null,
  ruc_nit     text unique,
  created_at  timestamptz not null default now()
);

comment on table public.empresas is 'Single-org per deployment (white-label self-hosted). Cliente empresa = 1 row. Multi-tenant SaaS NO soportado en design actual. Re-evaluar post-Year 3 si demand.';

alter table public.empresas enable row level security;

-- =========================================================================
-- usuarios (id = auth.users.id; sync trigger en 0004)
-- =========================================================================
create table public.usuarios (
  id          uuid primary key,
  nombre      text not null,
  email       text not null unique,
  rol         rol_usuario_enum not null default 'vendedor',
  activo      boolean not null default true,
  created_at  timestamptz not null default now()
);

alter table public.usuarios enable row level security;

-- =========================================================================
-- leads (datos estáticos)
-- =========================================================================
create table public.leads (
  id                uuid primary key default gen_random_uuid(),
  nombre            text not null,
  telefono          text not null unique,
  email             text,
  direccion         text,
  vehiculo_marca    text not null,
  vehiculo_modelo   text not null,
  vehiculo_anio     integer not null,
  vehiculo_motor    text,
  empresa_id        uuid references public.empresas(id) on delete set null,
  canal_origen      canal_enum not null,
  meta_user_ids     jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index leads_empresa_idx on public.leads (empresa_id);
create index leads_canal_origen_idx on public.leads (canal_origen);
create index leads_meta_user_ids_idx on public.leads using gin (meta_user_ids);
create index leads_nombre_trgm_idx on public.leads using gin (nombre gin_trgm_ops);
create index leads_telefono_trgm_idx on public.leads using gin (telefono gin_trgm_ops);

alter table public.leads enable row level security;

-- =========================================================================
-- productos
-- =========================================================================
create table public.productos (
  id              uuid primary key default gen_random_uuid(),
  codigo_interno  text not null unique,
  sku_proveedor   text,
  nombre          text not null,
  descripcion     text,
  categoria       text,
  compatibilidad  jsonb not null default '[]'::jsonb,
  precio          numeric(12,2) not null check (precio >= 0),
  stock           integer not null default 0 check (stock >= 0),
  imagen_url      text,
  activo          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index productos_categoria_idx on public.productos (categoria);
create index productos_activo_idx on public.productos (activo) where activo = true;
create index productos_compatibilidad_idx on public.productos using gin (compatibilidad);
create index productos_nombre_trgm_idx on public.productos using gin (nombre gin_trgm_ops);
create index productos_codigo_interno_trgm_idx on public.productos using gin (codigo_interno gin_trgm_ops);

alter table public.productos enable row level security;

-- =========================================================================
-- lead_session (sesión activa o histórica)
-- =========================================================================
create table public.lead_session (
  id                    uuid primary key default gen_random_uuid(),
  lead_id               uuid not null references public.leads(id) on delete cascade,
  current_stage         current_stage_enum not null default 'nuevo',
  urgencia              urgencia_enum not null default 'media',
  consulta              text not null default '',
  producto_cotizado_id  uuid references public.productos(id) on delete set null,
  codigo_interno        text,
  precio_cotizado       numeric(12,2),
  cantidad              integer,
  bloqueador            text,
  comprobante_pago_url  text,
  metodo_pago           metodo_pago_enum,
  resultado             resultado_enum,
  motivo_perdida        motivo_perdida_enum,
  ia_pausada            boolean not null default false,
  started_at            timestamptz not null default now(),
  closed_at             timestamptz
);

-- Máximo 1 sesión activa por lead (parcial)
create unique index lead_session_unique_activa_idx
  on public.lead_session (lead_id)
  where resultado is null;

-- Index purge cron diario (>29 días cerradas)
create index lead_session_closed_at_idx
  on public.lead_session (closed_at)
  where closed_at is not null;

create index lead_session_lead_idx on public.lead_session (lead_id);
create index lead_session_stage_idx on public.lead_session (current_stage);
create index lead_session_resultado_idx on public.lead_session (resultado);

alter table public.lead_session enable row level security;
