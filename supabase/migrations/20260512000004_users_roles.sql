-- 0004_users_roles.sql
-- Triggers updated_at, sync auth.users → public.usuarios, helpers de rol.
-- Funciones SECURITY DEFINER viven en schema `private` (no expuesto Data API)
-- per regla supabase skill: nunca SECURITY DEFINER en schema público.

-- =========================================================================
-- Schema privado para helpers SECURITY DEFINER
-- =========================================================================
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- =========================================================================
-- updated_at trigger (genérico)
-- =========================================================================
create or replace function public.bump_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger leads_bump_updated_at
  before update on public.leads
  for each row execute function public.bump_updated_at();

create trigger productos_bump_updated_at
  before update on public.productos
  for each row execute function public.bump_updated_at();

-- =========================================================================
-- Sync auth.users → public.usuarios
-- Trigger function vive en `private` (SECURITY DEFINER necesario para insertar
-- en public.usuarios desde contexto auth).
-- =========================================================================
create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol rol_usuario_enum;
  v_nombre text;
begin
  -- Lee rol desde raw_app_meta_data (NUNCA user_metadata: editable por cliente).
  v_rol := coalesce(
    (new.raw_app_meta_data ->> 'rol')::rol_usuario_enum,
    'vendedor'::rol_usuario_enum
  );
  v_nombre := coalesce(new.raw_app_meta_data ->> 'nombre', split_part(new.email, '@', 1));

  insert into public.usuarios (id, nombre, email, rol, activo)
  values (new.id, v_nombre, new.email, v_rol, true)
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_auth_user();

-- =========================================================================
-- Helpers de rol (stable, sin SECURITY DEFINER — leen JWT del request actual)
-- Diseñadas para usarse en policies RLS (Fase 13).
-- =========================================================================
create or replace function public.current_rol()
returns rol_usuario_enum
language sql
stable
as $$
  select nullif(
    coalesce(auth.jwt() -> 'app_metadata' ->> 'rol', ''),
    ''
  )::rol_usuario_enum
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select public.current_rol() = 'admin'::rol_usuario_enum
$$;

create or replace function public.is_vendedor()
returns boolean
language sql
stable
as $$
  select public.current_rol() = 'vendedor'::rol_usuario_enum
$$;

-- =========================================================================
-- GRANT execute helpers de rol a roles autenticados (necesario para policies)
-- =========================================================================
grant execute on function public.current_rol() to authenticated;
grant execute on function public.is_admin()    to authenticated;
grant execute on function public.is_vendedor() to authenticated;
