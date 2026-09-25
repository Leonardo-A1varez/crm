-- "Probar" no puede tocar corridas de producción.
--
-- `workflows-admin.service.ts#probar` arranca su corrida con
-- `arrancar_workflow_run`, que aplicaba la política de concurrencia de la
-- versión sin mirar si la corrida era de prueba. Con la policy
-- `workflow_runs_insert_prueba_admin` (20260924120000) un admin por fin puede
-- insertar esa corrida, y la función es SECURITY INVOKER: el UPDATE de
-- `reiniciar` corre con la policy `workflow_runs_update_admin` y pasa. O sea,
-- probar un flujo `reiniciar` cancelaba la corrida de producción viva que ese
-- lead tuviera en ese flujo, y un flujo `ignorar` no se podía probar para un
-- lead con una corrida viva. Al revés también: una prueba que quedara viva
-- (el proceso muere a mitad de la prueba y nadie la cierra) frenaba para
-- siempre los disparos `ignorar` de ese lead y bloqueaba `reanudar`.
--
-- Dónde se corta: la concurrencia se aplica sólo entre corridas de
-- producción, en la base. No alcanza con que Probar esquive la rama desde el
-- servicio: la otra mitad del problema —una prueba viva frenando a
-- producción— la deciden los disparos de producción, que también pasan por
-- esta función y por `reanudar_workflow_run`. El único lugar que ve a todos
-- los que llaman, bajo el mismo lock, es la base.
--
--  - Una corrida de prueba (`$prueba: true`, mismo predicado que la policy de
--    INSERT y que `reanudar`/`relanzar`) no pasa por la política: no espera el
--    advisory lock, no consulta vivas, no cancela nada. Se inserta y listo.
--  - Una de producción cuenta como "viva" sólo a otras de producción: el
--    chequeo y el UPDATE de `reiniciar` excluyen las de prueba.
--
-- Mismo nombre y misma firma: `create or replace`, sin drop. La app
-- desplegada usa esta base.

create or replace function public.arrancar_workflow_run(
  p_version_id uuid,
  p_lead_id    uuid,
  p_session_id uuid,
  p_contexto   jsonb
)
returns table (run_id uuid, error_code text)
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_workflow_id uuid;
  v_politica    public.workflow_concurrencia;
  v_viva        uuid;
begin
  select wv.workflow_id, wv.politica_concurrencia
    into v_workflow_id, v_politica
    from public.workflow_versiones as wv
   where wv.id = p_version_id;

  if not found then
    return query select null::uuid, 'version_not_found'::text;
    return;
  end if;

  -- Probar: fuera de la política. Ni frena ni cancela a producción.
  if coalesce(p_contexto, '{}'::jsonb) @> '{"$prueba": true}'::jsonb then
    return query
    insert into public.workflow_runs (workflow_version_id, lead_id, lead_session_id, contexto)
    values (p_version_id, p_lead_id, p_session_id, p_contexto)
    returning public.workflow_runs.id, null::text;
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
      return query select null::uuid, 'ya_hay_corrida_viva'::text;
      return;
    elsif v_politica = 'reiniciar' then
      -- Set-based: TODAS las corridas de producción vivas de este
      -- (workflow, lead). Mismo join y mismo filtro que el chequeo.
      update public.workflow_runs as r
         set estado = 'cancelado',
             ended_at = now(),
             error = 'reiniciado por un disparo nuevo'
        from public.workflow_versiones as v
       where v.id = r.workflow_version_id
         and v.workflow_id = v_workflow_id
         and r.lead_id = p_lead_id
         and r.estado in ('corriendo','esperando')
         and not (r.contexto @> '{"$prueba": true}'::jsonb);
    end if;
  end if;

  return query
  insert into public.workflow_runs (workflow_version_id, lead_id, lead_session_id, contexto)
  values (p_version_id, p_lead_id, p_session_id, coalesce(p_contexto, '{}'::jsonb))
  returning public.workflow_runs.id, null::text;
end;
$function$;

comment on function public.arrancar_workflow_run(uuid, uuid, uuid, jsonb) is
  'Arranca una corrida aplicando la politica de concurrencia de la version, con advisory lock por (workflow, lead) para que decision e insert sean atomicos. reiniciar cancela TODAS las corridas vivas del workflow para ese lead, no solo una. La politica rige solo entre corridas de produccion: una de prueba ($prueba en el contexto) no pasa por ella, y las de prueba no cuentan como vivas.';

-- =========================================================================
-- reanudar_workflow_run: una prueba viva no frena reanudar producción
-- =========================================================================
-- Cuerpo idéntico a 20260913232100 salvo el filtro `$prueba` en el chequeo de
-- "otra corrida viva". `reanudar` ya rechaza corridas de prueba, así que
-- siempre reanuda una de producción: sólo otras de producción la frenan.

create or replace function public.reanudar_workflow_run(p_run_id uuid)
returns table (
  desde_paso integer,
  nodo_id    text,
  error_code text
)
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_version_id   uuid;
  v_lead_id      uuid;
  v_workflow_id  uuid;
  v_max_pasos    integer;
  v_politica     public.workflow_concurrencia;
  v_estado       public.workflow_run_estado;
  v_contexto     jsonb;
  v_ultimo_orden integer;
  v_ultimo_nodo  text;
  v_ultimo_error text;
begin
  if not coalesce(public.is_admin(), false) then
    raise exception 'solo un admin puede reanudar una corrida' using errcode = '42501';
  end if;

  select r.workflow_version_id, r.lead_id
    into v_version_id, v_lead_id
    from public.workflow_runs as r
   where r.id = p_run_id;

  if not found then
    return query select null::integer, null::text, 'corrida_no_encontrada'::text;
    return;
  end if;

  select wv.workflow_id, wv.max_pasos, wv.politica_concurrencia
    into v_workflow_id, v_max_pasos, v_politica
    from public.workflow_versiones as wv
   where wv.id = v_version_id;

  perform pg_advisory_xact_lock(
    hashtextextended(v_workflow_id::text || ':' || v_lead_id::text, 0)
  );

  select r.estado, r.contexto
    into v_estado, v_contexto
    from public.workflow_runs as r
   where r.id = p_run_id
     for update;

  if not found then
    return query select null::integer, null::text, 'corrida_no_encontrada'::text;
    return;
  end if;

  if v_estado <> 'fallado' then
    return query select null::integer, null::text, 'corrida_no_fallada'::text;
    return;
  end if;

  if v_contexto @> '{"$prueba": true}'::jsonb then
    return query select null::integer, null::text, 'corrida_de_prueba'::text;
    return;
  end if;

  select p.orden, p.nodo_id, p.error
    into v_ultimo_orden, v_ultimo_nodo, v_ultimo_error
    from public.workflow_run_pasos as p
   where p.run_id = p_run_id
   order by p.orden desc
   limit 1;

  if v_ultimo_orden is null or v_ultimo_error is null then
    return query select null::integer, null::text, 'sin_paso_fallado'::text;
    return;
  end if;

  if v_ultimo_orden >= v_max_pasos then
    return query select null::integer, null::text, 'tope_pasos'::text;
    return;
  end if;

  if v_politica <> 'permitir' and exists (
    select 1
      from public.workflow_runs as r
      join public.workflow_versiones as v on v.id = r.workflow_version_id
     where v.workflow_id = v_workflow_id
       and r.lead_id = v_lead_id
       and r.estado in ('corriendo', 'esperando')
       and r.id <> p_run_id
       and not (r.contexto @> '{"$prueba": true}'::jsonb)
  ) then
    return query select null::integer, null::text, 'ya_hay_corrida_viva'::text;
    return;
  end if;

  update public.workflow_runs
     set estado = 'esperando',
         nodo_actual = v_ultimo_nodo,
         pasos_ejecutados = v_ultimo_orden,
         error = null,
         ended_at = null
   where id = p_run_id;

  return query select v_ultimo_orden, v_ultimo_nodo, null::text;
end;
$function$;

comment on function public.reanudar_workflow_run(uuid) is
  'Reanuda una corrida fallada desde el nodo del paso que fallo (nunca desde el disparador): la deja esperando con nodo_actual = ese nodo y pasos_ejecutados = su orden. Rechaza corridas de prueba, sin paso fallado, en el tope, o con otra corrida de produccion viva del mismo workflow para el lead.';
