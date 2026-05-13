-- 20260512000015_fix_function_search_path.sql
-- Fix Supabase advisors WARN function_search_path_mutable (lint 0011).
-- 4 funciones helpers públicas necesitan search_path explícito para evitar
-- privilege escalation vía search_path manipulation (low risk pero baseline
-- security best practice Supabase).
--
-- Razón cada función:
-- - public.bump_updated_at(): trigger updated_at. Usa now() builtin. pg_catalog suficiente.
-- - public.current_rol(): lee auth.jwt(). Necesita auth + public + pg_catalog.
-- - public.is_admin(): wrapper current_rol(). Mismo path.
-- - public.is_vendedor(): wrapper current_rol(). Mismo path.
--
-- Nota: private.handle_new_auth_user() ya tiene set search_path (SECURITY DEFINER).
-- pg_trgm extension in public schema: deferred Slice 4 hardening (riesgo break
-- indexes con gin_trgm_ops references — requiere drop indexes + ALTER EXTENSION
-- + recreate indexes). Documented docs/security-threat-model.md known issues.

alter function public.bump_updated_at() set search_path = public, pg_catalog;
alter function public.current_rol() set search_path = public, auth, pg_catalog;
alter function public.is_admin() set search_path = public, pg_catalog;
alter function public.is_vendedor() set search_path = public, pg_catalog;
