-- Volver a lanzar una corrida fallada, de las dos maneras que distingue la
-- pantalla "corrida en vivo" (PreviaReanudacion), que nunca se llaman igual:
--
--  - `reanudar_workflow_run`: "Reanudar desde el fallo". La MISMA corrida
--    sigue desde el nodo del paso que falló, nunca desde el disparador. Los
--    pasos que ya se hicieron no se repiten.
--  - `relanzar_workflow_run`: "Ejecutar de nuevo desde el principio". Una
--    corrida NUEVA, de la misma versión, con el mismo contexto de arranque. La
--    fallada queda como estaba, como registro.
--
-- Ninguna de las dos encola el segmento: eso lo hace la app con Inngest
-- (`workflow/segmento.pendiente`), después de que la transición quedó
-- confirmada acá.
--
-- Las dos rechazan una corrida de "Probar" (contexto con `$prueba: true`): se
-- ejecutó con los efectos interceptados, y continuarla con el motor de
-- producción mandaría WhatsApp de verdad a un lead que sólo se usó de prueba.

-- =========================================================================
-- Reanudar desde el fallo
-- =========================================================================
-- Qué deja la corrida:
--
--  - `nodo_actual` = el nodo del último paso, el que falló. Hace falta
--    escribirlo: al fallar, `nodo_actual` quedó en el nodo con el que arrancó
--    ese segmento, y en el primero es null, que el motor lee como "desde el
--    disparador".
--  - `pasos_ejecutados` = el orden de ese paso fallado. El nodo se vuelve a
--    ejecutar con orden +1: su paso fallado queda como historia (UNIQUE
--    run_id+orden) y, sobre todo, la clave de idempotencia del envío cambia
--    (`wf:<runId>:<orden>`). Con la misma clave, `sendOutbound` encontraría la
--    reserva de un envío que Meta rechazó y la daría por enviada sin mandar
--    nada. Una corrida sólo queda `fallado` en un envío que no salió: los
--    errores de desenlace incierto los reintenta Inngest y ahí ganan la clave.
--  - estado `esperando`, sin error ni `ended_at`: viva, lista para que
--    `tomarSegmento(run, pasos_ejecutados)` la tome.
--
-- Se niega si:
--  - la corrida no está `fallado`, o es de prueba;
--  - no tiene un paso fallado como último paso (falló antes de ejecutar un
--    nodo -- versión ausente, grafo sin disparador -- o por tope, que no
--    escribe paso);
--  - el paso fallado ya está en el tope de pasos: reanudar volvería a cortarse;
--  - hay otra corrida viva del mismo workflow para el lead y la política no es
--    `permitir`: sería la segunda corrida viva que la política prohíbe.
--
-- SECURITY INVOKER: sólo actualiza `workflow_runs`, que un admin puede
-- actualizar (policy workflow_runs_update_admin). El advisory lock es el mismo
-- que `arrancar_workflow_run`, y se toma PRIMERO, igual que allá, para que las
-- dos se serialicen por (workflow, lead) sin poder cruzarse.

create function public.reanudar_workflow_run(p_run_id uuid)
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

  -- Versión y lead no cambian nunca en una corrida: se leen sin lock para
  -- calcular la clave del advisory lock, que tiene que ir antes que el de fila.
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

revoke all on function public.reanudar_workflow_run(uuid) from public, anon;
grant execute on function public.reanudar_workflow_run(uuid) to authenticated, service_role;

comment on function public.reanudar_workflow_run(uuid) is
  'Reanuda una corrida fallada desde el nodo del paso que fallo (nunca desde el disparador): la deja esperando con nodo_actual = ese nodo y pasos_ejecutados = su orden. Rechaza corridas de prueba, sin paso fallado, en el tope, o con otra corrida viva del mismo workflow para el lead.';

-- =========================================================================
-- Ejecutar de nuevo desde el principio
-- =========================================================================
-- Arranca una corrida nueva con `arrancar_workflow_run` -- la misma política de
-- concurrencia y el mismo advisory lock que un disparo -- sobre la versión de
-- la corrida fallada, con su mismo contexto de arranque. Es "de nuevo": misma
-- definición, mismos datos. Si hace falta aplicar un arreglo publicado después,
-- eso es otra acción, que hoy no existe.
--
-- La sesión es la abierta del lead (a lo sumo hay una), prefiriendo la de la
-- corrida si sigue abierta: una sesión cerrada no sirve para mandar nada.
--
-- SECURITY DEFINER, con la autorización en la primera sentencia y
-- `search_path` vacío -- mismo patrón que `revert_lead_merge`: un admin
-- autenticado no tiene INSERT sobre `workflow_runs` ni EXECUTE sobre
-- `arrancar_workflow_run`, que son del motor (service_role), y abrirle esos
-- permisos le daría a la API REST una puerta para crear corridas arbitrarias.
-- Esta función sólo puede crear la réplica de una corrida fallada existente.

create function public.relanzar_workflow_run(p_run_id uuid)
returns table (
  run_id     uuid,
  error_code text
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
    return query select null::uuid, 'corrida_no_encontrada'::text;
    return;
  end if;

  if v_run.estado <> 'fallado' then
    return query select null::uuid, 'corrida_no_fallada'::text;
    return;
  end if;

  if v_run.contexto @> '{"$prueba": true}'::jsonb then
    return query select null::uuid, 'corrida_de_prueba'::text;
    return;
  end if;

  select s.id into v_sesion
    from public.lead_session as s
   where s.lead_id = v_run.lead_id
     and s.closed_at is null
   order by (s.id = v_run.lead_session_id) desc, s.started_at desc
   limit 1;

  return query
  select a.run_id, a.error_code
    from public.arrancar_workflow_run(
      v_run.workflow_version_id, v_run.lead_id, v_sesion, v_run.contexto
    ) as a;
end;
$function$;

revoke all on function public.relanzar_workflow_run(uuid) from public, anon;
grant execute on function public.relanzar_workflow_run(uuid) to authenticated, service_role;

comment on function public.relanzar_workflow_run(uuid) is
  'Ejecutar de nuevo desde el principio: arranca una corrida nueva (arrancar_workflow_run, con su politica de concurrencia) de la misma version, lead y contexto que una corrida fallada. SECURITY DEFINER porque authenticated no puede insertar corridas; autoriza con is_admin() en la primera sentencia.';
