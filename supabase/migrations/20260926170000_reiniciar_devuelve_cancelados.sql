-- La política "reiniciar" cancela en la base las corridas vivas del lead, pero
-- nadie se enteraba de cuáles: `arrancar_workflow_run` devolvía sólo
-- (run_id, error_code). Sin los ids, el motor no podía mandar
-- `workflow/corrida.cancelada`, y el segmento de la corrida cancelada que
-- dormía en Inngest (una espera, `step.waitForEvent`/`step.sleepUntil`) seguía
-- dormido hasta vencer. Al despertar lo frenaba el CAS de `tomarSegmento`, así
-- que no hacía nada: el costo era una ejecución de Inngest colgada días y el
-- historial de Inngest mintiendo ("esperando") sobre una corrida cancelada.
--
-- Ahora las dos funciones que arrancan corridas devuelven también `cancelados`:
-- los ids que la política canceló. `workflow-disparar` y "Ejecutar de nuevo"
-- (`corridas.service.ts#ejecutarDeNuevo`) emiten el evento por cada uno.
--
-- Cambia el tipo de retorno, así que es `drop` + `create` y no `create or
-- replace`. Una app que todavía no lee `cancelados` no se rompe: PostgREST
-- devuelve la columna de más y el código viejo la ignora. `relanzar` llama a
-- `arrancar` por nombre de columna, y se recrea en la misma migración.
--
-- Cuerpo de `arrancar` idéntico a 20260925100000 salvo el `returning` del
-- UPDATE de `reiniciar`. Cuerpo de `relanzar` idéntico a 20260913232100 salvo
-- la columna nueva.

drop function public.relanzar_workflow_run(uuid);
drop function public.arrancar_workflow_run(uuid, uuid, uuid, jsonb);

create function public.arrancar_workflow_run(
  p_version_id uuid,
  p_lead_id    uuid,
  p_session_id uuid,
  p_contexto   jsonb
)
returns table (run_id uuid, error_code text, cancelados uuid[])
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_workflow_id uuid;
  v_politica    public.workflow_concurrencia;
  v_viva        uuid;
  v_cancelados  uuid[] := '{}'::uuid[];
begin
  select wv.workflow_id, wv.politica_concurrencia
    into v_workflow_id, v_politica
    from public.workflow_versiones as wv
   where wv.id = p_version_id;

  if not found then
    return query select null::uuid, 'version_not_found'::text, '{}'::uuid[];
    return;
  end if;

  -- Probar: fuera de la política. Ni frena ni cancela a producción.
  if coalesce(p_contexto, '{}'::jsonb) @> '{"$prueba": true}'::jsonb then
    return query
    insert into public.workflow_runs (workflow_version_id, lead_id, lead_session_id, contexto)
    values (p_version_id, p_lead_id, p_session_id, p_contexto)
    returning public.workflow_runs.id, null::text, '{}'::uuid[];
    return;
  end if;

  -- hashtextextended da un bigint estable; el lock se suelta al commit.
  perform pg_advisory_xact_lock(
    hashtextextended(v_workflow_id::text || ':' || p_lead_id::text, 0)
  );

  select r.id into v_viva
    from public.workflow_runs as r
    join public.workflow_versiones as v on v.id = r.workflow_version_id
   where v.workflow_id = v_workflow_id
     and r.lead_id = p_lead_id
     and r.estado in ('corriendo','esperando')
     and not (r.contexto @> '{"$prueba": true}'::jsonb)
   limit 1;

  if v_viva is not null then
    if v_politica = 'ignorar' then
      return query select null::uuid, 'ya_hay_corrida_viva'::text, '{}'::uuid[];
      return;
    elsif v_politica = 'reiniciar' then
      -- Set-based: TODAS las corridas de producción vivas de este
      -- (workflow, lead). Mismo join y mismo filtro que el chequeo.
      with canceladas as (
        update public.workflow_runs as r
           set estado = 'cancelado',
               ended_at = now(),
               error = 'reiniciado por un disparo nuevo'
          from public.workflow_versiones as v
         where v.id = r.workflow_version_id
           and v.workflow_id = v_workflow_id
           and r.lead_id = p_lead_id
           and r.estado in ('corriendo','esperando')
           and not (r.contexto @> '{"$prueba": true}'::jsonb)
        returning r.id
      )
      select coalesce(array_agg(c.id), '{}'::uuid[]) into v_cancelados from canceladas as c;
    end if;
  end if;

  return query
  insert into public.workflow_runs (workflow_version_id, lead_id, lead_session_id, contexto)
  values (p_version_id, p_lead_id, p_session_id, coalesce(p_contexto, '{}'::jsonb))
  returning public.workflow_runs.id, null::text, v_cancelados;
end;
$function$;

-- Lo usan el motor (service_role) y "Probar" (un admin autenticado, frenado
-- por RLS a corridas `$prueba`: 20260924120000). anon, no.
revoke all on function public.arrancar_workflow_run(uuid, uuid, uuid, jsonb) from public, anon;
grant execute on function public.arrancar_workflow_run(uuid, uuid, uuid, jsonb)
  to authenticated, service_role;

comment on function public.arrancar_workflow_run(uuid, uuid, uuid, jsonb) is
  'Arranca una corrida aplicando la politica de concurrencia de la version, con advisory lock por (workflow, lead) para que decision e insert sean atomicos. reiniciar cancela TODAS las corridas vivas del workflow para ese lead, no solo una, y devuelve sus ids en cancelados para que el motor le avise a Inngest. La politica rige solo entre corridas de produccion: una de prueba ($prueba en el contexto) no pasa por ella, y las de prueba no cuentan como vivas.';

create function public.relanzar_workflow_run(p_run_id uuid)
returns table (
  run_id     uuid,
  error_code text,
  cancelados uuid[]
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_run    public.workflow_runs%rowtype;
  v_sesion uuid;
begin
  if not coalesce(public.is_admin(), false) then
    raise exception 'solo un admin puede relanzar una corrida' using errcode = '42501';
  end if;

  select r.* into v_run
    from public.workflow_runs as r
   where r.id = p_run_id;

  if not found then
    return query select null::uuid, 'corrida_no_encontrada'::text, '{}'::uuid[];
    return;
  end if;

  if v_run.estado <> 'fallado' then
    return query select null::uuid, 'corrida_no_fallada'::text, '{}'::uuid[];
    return;
  end if;

  if v_run.contexto @> '{"$prueba": true}'::jsonb then
    return query select null::uuid, 'corrida_de_prueba'::text, '{}'::uuid[];
    return;
  end if;

  select s.id into v_sesion
    from public.lead_session as s
   where s.lead_id = v_run.lead_id
     and s.closed_at is null
   order by (s.id = v_run.lead_session_id) desc, s.started_at desc
   limit 1;

  return query
  select a.run_id, a.error_code, a.cancelados
    from public.arrancar_workflow_run(
      v_run.workflow_version_id, v_run.lead_id, v_sesion, v_run.contexto
    ) as a;
end;
$function$;

revoke all on function public.relanzar_workflow_run(uuid) from public, anon;
grant execute on function public.relanzar_workflow_run(uuid) to authenticated, service_role;

comment on function public.relanzar_workflow_run(uuid) is
  'Ejecutar de nuevo desde el principio: arranca una corrida nueva (arrancar_workflow_run, con su politica de concurrencia) de la misma version, lead y contexto que una corrida fallada, y devuelve en cancelados las que reinicio esa politica. SECURITY DEFINER porque authenticated no puede insertar corridas; autoriza con is_admin() en la primera sentencia.';
