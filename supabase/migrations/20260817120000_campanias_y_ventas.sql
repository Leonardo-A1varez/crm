-- Campañas de marketing: ventana de fechas propia para filtrar Métricas.
-- `leads.campania_id` nace nullable y sin escritor: es el schema listo para
-- atribución real (ctwa_clid de Meta u otra) cuando se conecte ese lado.
-- Mientras tanto, Métricas filtra por campaña usando leads.created_at dentro
-- de [desde, hasta] como proxy — la UI lo declara así, no finge precisión.

create table public.campanias (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  desde timestamptz not null,
  hasta timestamptz not null,
  created_at timestamptz not null default now(),
  constraint campanias_nombre_len check (char_length(nombre) between 2 and 60),
  constraint campanias_rango_valido check (hasta > desde)
);

alter table public.campanias enable row level security;

-- R ambos / W admin, mismo patrón que tags (20260714124024_slice3_rls_policies.sql).
create policy campanias_select on public.campanias
  for select to authenticated
  using ((select public.is_admin()) or (select public.is_vendedor()));
create policy campanias_insert_admin on public.campanias
  for insert to authenticated
  with check ((select public.is_admin()));
create policy campanias_update_admin on public.campanias
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
create policy campanias_delete_admin on public.campanias
  for delete to authenticated
  using ((select public.is_admin()));

revoke all on table public.campanias from public, anon;
grant select, insert, update, delete on table public.campanias to authenticated;
grant all on table public.campanias to service_role;

alter table public.leads
  add column campania_id uuid references public.campanias(id) on delete set null;

comment on column public.leads.campania_id is
  'Atribución real de campaña (ctwa_clid u otro), poblada cuando el webhook de Meta la capture. NULL hoy: ningún código la escribe todavía.';
