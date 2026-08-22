-- Workflows W1, fix de review: `publicarVersion` hacía dos UPDATE sueltos
-- desde TypeScript (despublicar la vieja, publicar la nueva). Si el proceso
-- moría entre medio, el workflow quedaba con CERO versiones publicadas y
-- nadie se enteraba: mismo defecto de forma que ya pagó este proyecto una
-- vez con el lock de merge (AGENTS.md lección 11). La solución es la misma
-- que ya existe para fusionar leads: una sola función Postgres, una sola
-- transacción.
--
-- SECURITY INVOKER (no DEFINER) a propósito, igual que approve_lead_merge:
-- la función valida admin explícitamente y corre con los grants y policies
-- del que invoca, así que la migración que sigue (narrow del UPDATE a la
-- columna `publicada`) también protege esta ruta y no sólo el acceso directo
-- a la tabla.

create or replace function public.publicar_workflow_version(
  p_version_id uuid
)
returns table (
  version_id uuid,
  error_code text
)
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_workflow_id uuid;
begin
  if not coalesce(public.is_admin(), false) then
    raise exception 'solo un admin puede publicar una version de workflow' using errcode = '42501';
  end if;

  select wv.workflow_id
    into v_workflow_id
    from public.workflow_versiones as wv
   where wv.id = p_version_id
   for update;

  if not found then
    return query select null::uuid, 'version_not_found'::text;
    return;
  end if;

  -- Bloquea TODAS las versiones del workflow, no sólo la que se publica: dos
  -- publicaciones concurrentes del mismo workflow quedan serializadas y
  -- ninguna puede dejar 0 o 2 filas con `publicada = true`.
  perform wv.id
    from public.workflow_versiones as wv
   where wv.workflow_id = v_workflow_id
   for update;

  update public.workflow_versiones
     set publicada = false
   where workflow_id = v_workflow_id
     and publicada = true;

  update public.workflow_versiones
     set publicada = true
   where id = p_version_id;

  return query select p_version_id, null::text;
end;
$function$;

revoke all on function public.publicar_workflow_version(uuid) from public;
revoke all on function public.publicar_workflow_version(uuid) from anon;
grant execute on function public.publicar_workflow_version(uuid) to authenticated;
grant execute on function public.publicar_workflow_version(uuid) to service_role;

comment on function public.publicar_workflow_version(uuid) is
  'Publica una version de workflow y despublica la que estuviera publicada de ese workflow, en una sola transaccion. Mismo patron que approve_lead_merge.';
