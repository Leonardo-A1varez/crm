-- Realtime sobre las corridas: la pantalla "corrida en vivo" recibe cada paso
-- nuevo (INSERT en workflow_run_pasos) y cada cambio de estado o de nodo
-- (UPDATE en workflow_runs) sin polling.
--
-- RLS: Realtime entrega cada cambio aplicando las policies de SELECT de la
-- tabla con el rol del que se suscribe, igual que una consulta normal (docs de
-- Supabase, troubleshooting de Postgres Changes). `workflow_runs_select` y
-- `workflow_run_pasos_select` (20260822044955) ya dejan ver a admin y a
-- vendedor y a nadie más -- anon no tiene ni el grant de SELECT --, así que no
-- hace falta una policy nueva: el canal ve exactamente lo que la API REST.
--
-- Sin `replica identity full`: con RLS activo el `old` de un UPDATE trae sólo
-- la PK igual, y la pantalla no compara viejo contra nuevo -- vuelve a leer.
--
-- Idempotente: agregar una tabla que ya está en la publicación es un error.

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'workflow_run_pasos'
  ) then
    alter publication supabase_realtime add table public.workflow_run_pasos;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'workflow_runs'
  ) then
    alter publication supabase_realtime add table public.workflow_runs;
  end if;
end;
$$;
