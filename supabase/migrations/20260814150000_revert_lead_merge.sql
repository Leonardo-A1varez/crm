-- Deshace una fusión de leads usando lo que registró `approve_lead_merge` en
-- `admin_actions` (payload_version 2, migración 20260814120000).
--
-- Solo revierte lo que la fusión hizo, y solo si sigue como la fusión lo dejó.
-- Un merge no es una foto del sistema: entre la fusión y el revert alguien pudo
-- editar el lead, cerrar una sesión o escribir un mensaje. Restaurar a ciegas
-- el estado previo borraría ese trabajo, así que cada paso comprueba que lo que
-- va a tocar todavía es lo que la fusión puso:
--
--   * Una conversación o sesión vuelve solo si todavía apunta al ganador.
--   * Una etiqueta se saca solo si la fusión la insertó de verdad
--     (`tags_insertados`, que ya excluye las que el ganador ya tenía).
--   * Un campo escalar vuelve a su valor previo solo si el ganador estaba
--     vacío antes Y hoy tiene exactamente el valor que aportó el perdedor. Si
--     alguien lo editó después, esa edición gana: es trabajo deliberado.
--   * De `meta_user_ids` y `datos_extra` se quitan únicamente las claves que
--     puso el perdedor; las agregadas después sobreviven.
--
-- Lo que NO hace, a propósito:
--   * No recrea el `merge_candidate`. Revertir significa que el admin decidió
--     que no son la misma persona; volver a proponer el par sería discutirle.
--     Si se fusionó con el ganador equivocado, se marca duplicado de nuevo.
--   * No revierte fusiones anteriores a payload_version 2: su registro está
--     incompleto y completarlo con supuestos es peor que no poder deshacer.

create or replace function public.revert_lead_merge(
  p_merge_action_id uuid
)
returns table (
  perdedor_id uuid,
  error_code text
)
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_accion public.admin_actions%rowtype;
  v_payload jsonb;
  v_ganador_id uuid;
  v_perdedor_id uuid;
  v_perdedor public.leads%rowtype;
  v_antes public.leads%rowtype;
  v_convs uuid[];
  v_sesiones uuid[];
  v_tags uuid[];
  v_claves_meta text[];
  v_claves_extra text[];
  v_activas integer;
begin
  if not coalesce(public.is_admin(), false) then
    raise exception 'solo un admin puede deshacer una fusion' using errcode = '42501';
  end if;

  select a.* into v_accion
    from public.admin_actions as a
   where a.id = p_merge_action_id
   for update;

  if not found then
    return query select null::uuid, 'action_not_found'::text;
    return;
  end if;
  if v_accion.action <> 'lead.merge' then
    return query select null::uuid, 'not_a_merge'::text;
    return;
  end if;

  v_payload := v_accion.payload;

  if coalesce((v_payload->>'payload_version')::int, 1) < 2 then
    return query select null::uuid, 'payload_too_old'::text;
    return;
  end if;

  -- Una sola reversión por fusión. El registro del revert es el candado.
  if exists (
    select 1 from public.admin_actions as r
     where r.action = 'lead.merge.revert'
       and r.payload->>'merge_action_id' = p_merge_action_id::text
  ) then
    return query select null::uuid, 'already_reverted'::text;
    return;
  end if;

  v_ganador_id := (v_payload->>'ganador_id')::uuid;
  select * into v_perdedor
    from jsonb_populate_record(null::public.leads, v_payload->'perdedor');
  select * into v_antes
    from jsonb_populate_record(null::public.leads, v_payload->'ganador_antes');
  v_perdedor_id := v_perdedor.id;

  perform l.id from public.leads as l where l.id = v_ganador_id for update;
  if not found then
    -- El ganador ya no existe: lo borró otra fusión posterior o una baja.
    return query select null::uuid, 'ganador_not_found'::text;
    return;
  end if;

  if exists (select 1 from public.leads as l where l.id = v_perdedor_id) then
    return query select null::uuid, 'lead_exists'::text;
    return;
  end if;
  -- `leads_telefono_key` es UNIQUE: si alguien reusó el número, resucitar el
  -- lead fallaría con un 23505 crudo. Mejor un código que la UI sepa explicar.
  if exists (
    select 1 from public.leads as l where l.telefono = v_perdedor.telefono
  ) then
    return query select null::uuid, 'telefono_taken'::text;
    return;
  end if;

  select coalesce(array_agg((e.valor)::uuid), '{}')
    into v_convs
    from jsonb_array_elements_text(coalesce(v_payload->'conversaciones_movidas', '[]'::jsonb))
      as e(valor);

  select coalesce(array_agg((e.valor)::uuid), '{}')
    into v_sesiones
    from jsonb_array_elements_text(coalesce(v_payload->'sesiones_movidas', '[]'::jsonb))
      as e(valor);

  select coalesce(array_agg((e.valor)::uuid), '{}')
    into v_tags
    from jsonb_array_elements_text(coalesce(v_payload->'tags_insertados', '[]'::jsonb))
      as e(valor);

  -- El índice parcial `(lead_id) WHERE resultado IS NULL` no admite dos
  -- sesiones abiertas por lead. Se comprueba ANTES de escribir: en PL/pgSQL un
  -- `return` no revierte, así que devolver el código de error después de mover
  -- filas dejaría el reparto a medias y commiteado.
  --
  -- El perdedor nace sin sesiones, así que se lleva exactamente las abiertas
  -- que vuelven; al ganador le quedan las abiertas que no están en la lista.
  select greatest(
           count(*) filter (
             where s.id = any(v_sesiones)
           ),
           count(*) filter (
             where not (s.id = any(v_sesiones))
           )
         )::integer
    into v_activas
    from public.lead_session as s
   where s.lead_id = v_ganador_id
     and s.resultado is null;

  if coalesce(v_activas, 0) > 1 then
    return query select null::uuid, 'sesiones_activas_duplicadas'::text;
    return;
  end if;

  insert into public.leads select (v_perdedor).*;

  -- `lead_id = v_ganador_id` en el WHERE: si alguien ya movió la conversación a
  -- otro lado, se la deja donde está.
  update public.conversaciones
     set lead_id = v_perdedor_id
   where id = any(v_convs)
     and lead_id = v_ganador_id;

  update public.lead_session
     set lead_id = v_perdedor_id
   where id = any(v_sesiones)
     and lead_id = v_ganador_id;

  delete from public.lead_tags
   where lead_id = v_ganador_id
     and tag_id = any(v_tags);

  -- Claves que aportó el perdedor y que el ganador no tenía antes. Las que se
  -- agregaron después de la fusión no están en esta lista y sobreviven.
  select coalesce(array_agg(k.clave), '{}')
    into v_claves_meta
    from jsonb_object_keys(coalesce(v_perdedor.meta_user_ids, '{}'::jsonb)) as k(clave)
   where not (coalesce(v_antes.meta_user_ids, '{}'::jsonb) ? k.clave);

  select coalesce(array_agg(k.clave), '{}')
    into v_claves_extra
    from jsonb_object_keys(coalesce(v_perdedor.datos_extra, '{}'::jsonb)) as k(clave)
   where not (coalesce(v_antes.datos_extra, '{}'::jsonb) ? k.clave);

  update public.leads as g
     set email = case
           when v_antes.email is null and g.email is not distinct from v_perdedor.email
             then null else g.email end,
         direccion = case
           when v_antes.direccion is null and g.direccion is not distinct from v_perdedor.direccion
             then null else g.direccion end,
         vehiculo_motor = case
           when v_antes.vehiculo_motor is null
            and g.vehiculo_motor is not distinct from v_perdedor.vehiculo_motor
             then null else g.vehiculo_motor end,
         empresa_id = case
           when v_antes.empresa_id is null and g.empresa_id is not distinct from v_perdedor.empresa_id
             then null else g.empresa_id end,
         nombre_perfil = case
           when v_antes.nombre_perfil is null
            and g.nombre_perfil is not distinct from v_perdedor.nombre_perfil
             then null else g.nombre_perfil end,
         vehiculo_marca = case
           when nullif(btrim(coalesce(v_antes.vehiculo_marca, '')), '') is null
            and g.vehiculo_marca is not distinct from v_perdedor.vehiculo_marca
             then v_antes.vehiculo_marca else g.vehiculo_marca end,
         vehiculo_modelo = case
           when nullif(btrim(coalesce(v_antes.vehiculo_modelo, '')), '') is null
            and g.vehiculo_modelo is not distinct from v_perdedor.vehiculo_modelo
             then v_antes.vehiculo_modelo else g.vehiculo_modelo end,
         vehiculo_anio = case
           when coalesce(v_antes.vehiculo_anio, 0) = 0
            and g.vehiculo_anio is not distinct from v_perdedor.vehiculo_anio
             then v_antes.vehiculo_anio else g.vehiculo_anio end,
         meta_user_ids = coalesce(g.meta_user_ids, '{}'::jsonb) - v_claves_meta,
         datos_extra = coalesce(g.datos_extra, '{}'::jsonb) - v_claves_extra
   where g.id = v_ganador_id;

  insert into public.admin_actions (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    payload
  ) values (
    auth.uid(),
    'lead.merge.revert',
    'lead',
    v_perdedor_id,
    jsonb_build_object(
      'merge_action_id', p_merge_action_id,
      'ganador_id', v_ganador_id,
      'perdedor_id', v_perdedor_id,
      'conversaciones_devueltas', to_jsonb(v_convs),
      'sesiones_devueltas', to_jsonb(v_sesiones),
      'tags_quitados', to_jsonb(v_tags)
    )
  );

  return query select v_perdedor_id, null::text;
end;
$function$;

revoke all on function public.revert_lead_merge(uuid) from public;
revoke all on function public.revert_lead_merge(uuid) from anon;
grant execute on function public.revert_lead_merge(uuid) to authenticated;
grant execute on function public.revert_lead_merge(uuid) to service_role;

comment on function public.revert_lead_merge(uuid) is
  'Deshace una fusion registrada con payload_version 2: resucita el lead borrado, devuelve conversaciones y sesiones que sigan en el ganador, quita las etiquetas que la fusion inserto y restaura los campos que no se hayan editado despues.';
