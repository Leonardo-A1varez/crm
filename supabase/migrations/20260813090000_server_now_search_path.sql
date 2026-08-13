-- Fija el search_path de server_now(), que quedó fuera de la migración
-- 20260512000015 por haberse creado después (20260514000016).
-- Advisor: function_search_path_mutable (WARN).
-- Ver https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable
--
-- now() vive en pg_catalog, que Postgres siempre resuelve primero aunque el
-- search_path quede vacío: el cuerpo sigue funcionando. Se repiten `stable`,
-- `security invoker` y el `returns timestamptz` de 20260514000016 porque un
-- create or replace que cambie cualquiera de esos falla.

create or replace function public.server_now()
returns timestamptz
language sql
stable
security invoker
set search_path = ''
as $$
  select now()
$$;

comment on function public.server_now() is
  'Helper repos Supabase: devuelve now() server-side. Evita clock skew JS↔PG en columnas timestamptz con default now() updateadas desde client JS.';

-- El grant a anon lo puso 20260714182011 para /api/health; create or replace
-- conserva los privilegios existentes, pero se repite para que esta migración
-- sea legible por sí sola.
grant execute on function public.server_now() to anon;
