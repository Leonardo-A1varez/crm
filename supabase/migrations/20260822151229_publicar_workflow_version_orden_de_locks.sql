-- `publicar_workflow_version` tomaba los locks en dos pasos y sin orden:
-- primero `for update` sobre la version que se publica, despues `for update`
-- sobre todas las versiones del workflow. Dos publicaciones simultaneas de
-- versiones distintas del mismo workflow se traban entre si -- T1 tiene A y
-- espera B, T2 tiene B y espera A -- y Postgres aborta una con 40P01. No
-- corrompe nada (la transaccion garantiza que nunca queden 0 ni 2 filas
-- publicadas), pero le devuelve un error evitable a quien publico segundo.
--
-- Dos cambios: el primer SELECT deja de tomar lock -- solo lee workflow_id,
-- que es inmutable desde el grant column-scoped de 20260822150127 -- y el
-- lock masivo agrega `order by wv.id`, asi todas las sesiones piden las
-- mismas filas en el mismo orden y ninguna puede quedar cruzada con otra.
--
-- La definicion se repite completa porque la migracion anterior ya fue
-- aplicada y el historial de migraciones es inmutable.

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
   where wv.id = p_version_id;

  if not found then
    return query select null::uuid, 'version_not_found'::text;
    return;
  end if;

  -- Bloquea TODAS las versiones del workflow, no solo la que se publica: dos
  -- publicaciones concurrentes del mismo workflow quedan serializadas y
  -- ninguna puede dejar 0 o 2 filas con `publicada = true`. El `order by` es
  -- lo que evita que se traben entre si: sin el, cada sesion pide las filas
  -- en el orden que le devuelva el plan y dos pueden cruzarse.
  perform wv.id
    from public.workflow_versiones as wv
   where wv.workflow_id = v_workflow_id
   order by wv.id
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

comment on function public.publicar_workflow_version(uuid) is
  'Publica una version de workflow y despublica la que estuviera publicada de ese workflow, en una sola transaccion, tomando los locks en orden de id. Mismo patron que approve_lead_merge.';
