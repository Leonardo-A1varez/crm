-- 20260514000016_repo_helpers.sql
-- Helper SQL functions para repos Supabase.
--
-- server_now(): server-side now() expuesto via PostgREST RPC. Evita el bug
-- clock-skew entre client JS y servidor cuando un repo updatea una columna
-- timestamptz que tiene `default now()` usando `new Date().toISOString()`.
--
-- Bug reproducible (Slice 1 7.4 conversations integration):
--   1. INSERT row → server setea ultima_actividad_at = now() (T_server)
--   2. JS calcula `new Date().toISOString()` (T_js)
--   3. UPDATE row SET ultima_actividad_at = T_js
--   4. Si T_js < T_server (NTP drift, ~1-2s), el timestamp retrocede
--   5. Tests que esperan monotonicidad post-update fallan flaky
--
-- Fix: repos llaman `client.rpc("server_now")` antes de UPDATE → timestamp
-- garantizado server-side, monotonic vs INSERT default.
--
-- Costo: 1 roundtrip extra por write que toca timestamp. Aceptable.
-- Aplicación: leads.update, productos.update, conversations.touch+update,
-- y futuros repos con columnas timestamp updateables.

create or replace function public.server_now()
returns timestamptz
language sql
stable
security invoker
as $$
  select now()
$$;

comment on function public.server_now() is
  'Helper repos Supabase: devuelve now() server-side. Evita clock skew JS↔PG en columnas timestamptz con default now() updateadas desde client JS.';
