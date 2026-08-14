-- La auditoría del merge guardaba el lead perdedor entero, pero no lo que hacía
-- falta para deshacerlo: qué conversaciones y sesiones se movieron, qué
-- etiquetas se insertaron de verdad, y cómo estaba el ganador ANTES de que le
-- rellenaran los huecos. Sin eso, después de fusionar las filas de los dos
-- leads quedan indistinguibles y un "deshacer" tendría que adivinar cuáles
-- devolver: adivinar mal le arranca a un lead una conversación que siempre fue
-- suya, que es peor que no poder deshacer.
--
-- Esta migración NO cambia el comportamiento del merge. Solo registra.
--
-- `payload_version` es el permiso para revertir: las fusiones anteriores no
-- tienen la versión y su payload está incompleto, así que quien escriba el
-- revert tiene que negarse a tocarlas en vez de completarlas con supuestos.
--
-- El audit pasa a insertarse DESPUÉS de las mutaciones porque ahora depende de
-- sus `returning`. No debilita nada: desde `20260813163957` todo esto vive en
-- una sola transacción, así que un fallo posterior revierte también el audit.
-- El orden "audit primero" venía de cuando eran siete escrituras sueltas
-- llamadas desde TypeScript.

create or replace function public.approve_lead_merge(
  p_candidate_id uuid,
  p_keep_lead_id uuid
)
returns table (
  ganador_id uuid,
  error_code text
)
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_candidate public.merge_candidates%rowtype;
  v_ganador public.leads%rowtype;
  v_perdedor public.leads%rowtype;
  v_perdedor_id uuid;
  v_locked_leads integer;
  v_active_count integer;
  v_perdedor_tags jsonb;
  v_convs_movidas jsonb;
  v_sesiones_movidas jsonb;
  v_tags_insertados jsonb;
begin
  if not coalesce(public.is_admin(), false) then
    raise exception 'solo un admin puede fusionar leads' using errcode = '42501';
  end if;

  -- El candidate se bloquea primero. Dos aprobaciones del mismo par quedan
  -- serializadas antes de mirar el estado pending.
  select mc.*
    into v_candidate
    from public.merge_candidates as mc
   where mc.id = p_candidate_id
   for update;

  if not found then
    return query select null::uuid, 'candidate_not_found'::text;
    return;
  end if;
  if v_candidate.status <> 'pending'::public.merge_candidate_status_enum then
    return query select null::uuid, 'candidate_resolved'::text;
    return;
  end if;
  if p_keep_lead_id not in (v_candidate.src_lead_id, v_candidate.dst_lead_id) then
    return query select null::uuid, 'invalid_keep'::text;
    return;
  end if;

  v_perdedor_id := case
    when p_keep_lead_id = v_candidate.src_lead_id then v_candidate.dst_lead_id
    else v_candidate.src_lead_id
  end;

  -- Orden estable para evitar deadlocks entre transiciones que compartan un
  -- lead. El FOR UPDATE también bloquea inserts FK de sesiones/conversaciones:
  -- no puede aparecer actividad nueva entre la validación y el DELETE.
  perform l.id
    from public.leads as l
   where l.id in (p_keep_lead_id, v_perdedor_id)
   order by l.id
   for update;
  get diagnostics v_locked_leads = row_count;

  if v_locked_leads <> 2 then
    return query select null::uuid, 'lead_not_found'::text;
    return;
  end if;

  -- `v_ganador` queda con el estado PREVIO al relleno de huecos de más abajo.
  -- Es lo único que permite devolver esos campos a como estaban.
  select l.* into strict v_ganador
    from public.leads as l
   where l.id = p_keep_lead_id;
  select l.* into strict v_perdedor
    from public.leads as l
   where l.id = v_perdedor_id;

  -- Las filas existentes se bloquean antes de contar. El lock de los padres
  -- impide simultáneamente que nazca una sesión nueva para cualquiera del par.
  perform s.id
    from public.lead_session as s
   where s.lead_id in (p_keep_lead_id, v_perdedor_id)
   order by s.id
   for update;

  select count(*)::integer
    into v_active_count
    from public.lead_session as s
   where s.lead_id in (p_keep_lead_id, v_perdedor_id)
     and s.resultado is null;

  if v_active_count > 1 then
    return query select null::uuid, 'both_active'::text;
    return;
  end if;

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', t.id,
               'nombre', t.nombre,
               'source', lt.source
             ) order by t.id
           ),
           '[]'::jsonb
         )
    into v_perdedor_tags
    from public.lead_tags as lt
    join public.tags as t on t.id = lt.tag_id
   where lt.lead_id = v_perdedor_id;

  with movidas as (
    update public.conversaciones
       set lead_id = p_keep_lead_id
     where lead_id = v_perdedor_id
    returning id
  )
  select coalesce(jsonb_agg(m.id order by m.id), '[]'::jsonb)
    into v_convs_movidas
    from movidas as m;

  with movidas as (
    update public.lead_session
       set lead_id = p_keep_lead_id
     where lead_id = v_perdedor_id
    returning id
  )
  select coalesce(jsonb_agg(m.id order by m.id), '[]'::jsonb)
    into v_sesiones_movidas
    from movidas as m;

  -- Solo las que el insert agregó de verdad. Las que el ganador ya tenía las
  -- descarta el `do nothing` y no aparecen acá: sacárselas al revertir sería
  -- quitarle una etiqueta que era suya desde antes.
  with insertados as (
    insert into public.lead_tags (lead_id, tag_id, source, assigned_by, assigned_at)
    select p_keep_lead_id, lt.tag_id, lt.source, lt.assigned_by, lt.assigned_at
      from public.lead_tags as lt
     where lt.lead_id = v_perdedor_id
    on conflict (lead_id, tag_id) do nothing
    returning tag_id
  )
  select coalesce(jsonb_agg(i.tag_id order by i.tag_id), '[]'::jsonb)
    into v_tags_insertados
    from insertados as i;

  update public.leads as g
     set email = coalesce(g.email, v_perdedor.email),
         direccion = coalesce(g.direccion, v_perdedor.direccion),
         vehiculo_motor = coalesce(g.vehiculo_motor, v_perdedor.vehiculo_motor),
         empresa_id = coalesce(g.empresa_id, v_perdedor.empresa_id),
         vehiculo_marca = case
           when nullif(btrim(g.vehiculo_marca), '') is null
            and nullif(btrim(v_perdedor.vehiculo_marca), '') is not null
             then v_perdedor.vehiculo_marca
           else g.vehiculo_marca
         end,
         vehiculo_modelo = case
           when nullif(btrim(g.vehiculo_modelo), '') is null
            and nullif(btrim(v_perdedor.vehiculo_modelo), '') is not null
             then v_perdedor.vehiculo_modelo
           else g.vehiculo_modelo
         end,
         vehiculo_anio = case
           when (g.vehiculo_anio is null or g.vehiculo_anio = 0)
            and v_perdedor.vehiculo_anio is not null
            and v_perdedor.vehiculo_anio <> 0
             then v_perdedor.vehiculo_anio
           else g.vehiculo_anio
         end,
         nombre_perfil = coalesce(g.nombre_perfil, v_perdedor.nombre_perfil),
         meta_user_ids = v_perdedor.meta_user_ids || g.meta_user_ids,
         datos_extra = v_perdedor.datos_extra || g.datos_extra
   where g.id = p_keep_lead_id;

  insert into public.admin_actions (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    payload
  ) values (
    auth.uid(),
    'lead.merge',
    'lead',
    p_keep_lead_id,
    jsonb_build_object(
      'payload_version', 2,
      'candidate_id', p_candidate_id,
      'ganador_id', p_keep_lead_id,
      'ganador_antes', to_jsonb(v_ganador),
      'perdedor', to_jsonb(v_perdedor),
      'perdedor_tags', v_perdedor_tags,
      'conversaciones_movidas', v_convs_movidas,
      'sesiones_movidas', v_sesiones_movidas,
      'tags_insertados', v_tags_insertados
    )
  );

  -- CASCADE limpia tags del perdedor y candidates que lo referencian. Las
  -- conversaciones y sesiones ya fueron reasignadas, así que sobreviven.
  delete from public.leads where id = v_perdedor_id;

  return query select p_keep_lead_id, null::text;
end;
$function$;

revoke all on function public.approve_lead_merge(uuid, uuid) from public;
revoke all on function public.approve_lead_merge(uuid, uuid) from anon;
grant execute on function public.approve_lead_merge(uuid, uuid) to authenticated;
grant execute on function public.approve_lead_merge(uuid, uuid) to service_role;

comment on function public.approve_lead_merge(uuid, uuid) is
  'Merge administrativo atómico: locks ordenados, validaciones, reasignación, delete y audit reversible (payload_version 2) en una transacción security invoker.';
