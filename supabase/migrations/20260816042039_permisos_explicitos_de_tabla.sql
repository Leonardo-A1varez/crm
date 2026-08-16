-- El schema deja de depender de cómo venga configurado el entorno.
--
-- Ninguna de las 51 migraciones anteriores otorga un solo permiso de tabla.
-- En `crm-dev` la app funciona igual porque el proyecto de Supabase en la nube
-- trae `alter default privileges` generosos de fábrica para el rol `postgres`:
--
--   nube:  anon=arwdDxtm   (incluye INSERT, SELECT, UPDATE, DELETE)
--   local: anon=Dxtm       (solo TRUNCATE, REFERENCES, TRIGGER)
--
-- O sea que el schema del repo **no es portable**: aplicado sobre un Postgres
-- que no venga con esos privilegios default —el stack local del CLI, una
-- restauración de backup, un proyecto nuevo de producción— todas las tablas
-- salen sin permisos y cada consulta devuelve 403 `permission denied`. Se
-- descubrió al levantar el stack local y correr los integration tests, que
-- fallaron en la primera tabla que tocaron.
--
-- Esto no afloja la seguridad: es el modelo estándar de Supabase, donde los
-- permisos de tabla son permisivos y **quien restringe de verdad es RLS**. Las
-- 25 tablas de `public` tienen RLS activo y sus políticas, así que `anon`
-- —el rol sin autenticar— sigue sin poder leer nada: ninguna política lo
-- habilita. Verificado antes de escribir esto:
--   select count(*) from pg_tables where schemaname='public' and not rowsecurity;  -- 0
--
-- Reproduce exactamente el estado de `crm-dev`, no inventa uno nuevo.

-- =========================================================================
-- 1. Las tablas, vistas y secuencias que ya existen
-- =========================================================================

grant usage on schema public to anon, authenticated, service_role;

grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant all on all functions in schema public to anon, authenticated, service_role;

-- =========================================================================
-- 2. Y las que se creen de acá en adelante
-- =========================================================================

-- Sin esto, la próxima migración que agregue una tabla vuelve a dejarla sin
-- permisos en cualquier entorno que no sea la nube, y el defecto reaparece.
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on functions to anon, authenticated, service_role;
