-- La fusión también se lleva los autos.
--
-- Desde que el vehículo dejó de ser cuatro columnas de `leads` (migración
-- 20260814230000), `approve_lead_merge` tenía un agujero: movía conversaciones,
-- sesiones, etiquetas e identificadores, y no `lead_vehiculos`. Como esa tabla
-- referencia `leads(id) on delete cascade`, el `delete from public.leads` del
-- final borraba los autos del lead absorbido en silencio. Fusionar dos leads
-- del mismo taller destruía la placa y el VIN de una de las camionetas — que
-- son, además, la señal más fuerte del detector de duplicados.
--
-- `payload_version` sube a 4: el revert tiene que saber qué vehículos devolver
-- y con qué `principal`. Los payloads 3 y 2 se siguen pudiendo revertir (no
-- tienen vehículos movidos, así que no hay nada que devolver); los 1 siguen sin
-- poder.
--
-- Lo que NO hace, a propósito: no sintetiza una fila de `lead_vehiculos` a
-- partir de `leads.vehiculo_marca/modelo/anio/motor` del perdedor, como sí hace
-- con `telefono` y `email` para los identificadores. Esas cuatro columnas ya se
-- rellenan en el ganador con el `update public.leads` de más abajo, así que el
-- dato no se pierde; crear la fila es parte de mover los lectores a
-- `lead_vehiculos`, que es la deuda que declara 20260814230000.

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
  v_ids_movidos jsonb;
  v_ganador_tiene_principal boolean;
  v_vehiculos_movidos jsonb;
begin
  if not coalesce(public.is_admin(), false) then
    raise exception 'solo un admin puede fusionar leads' using errcode = '42501';
  end if;

  select mc.* into v_candidate
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

  select l.* into strict v_ganador from public.leads as l where l.id = p_keep_lead_id;
  select l.* into strict v_perdedor from public.leads as l where l.id = v_perdedor_id;

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

  -- Última lectura antes de escribir. A partir de acá ningún camino puede
  -- devolver `error_code`: en PL/pgSQL un `return` no revierte la transacción,
  -- así que un error después de mover filas dejaría el reparto a medias y
  -- commiteado. Todas las validaciones que rechazan la fusión están arriba.
  --
  -- `lead_vehiculos` no agrega ninguna: no tiene UNIQUE (decisión de
  -- 20260814230000, justamente para que dos leads que comparten placa se puedan
  -- fusionar) y su FK apunta al ganador, que ya está lockeado y existe.
  select exists (
           select 1
             from public.lead_vehiculos as v
            where v.lead_id = p_keep_lead_id
              and v.principal
         )
    into v_ganador_tiene_principal;

  select coalesce(
           jsonb_agg(
             jsonb_build_object('id', t.id, 'nombre', t.nombre, 'source', lt.source) order by t.id
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
  select coalesce(jsonb_agg(m.id order by m.id), '[]'::jsonb) into v_convs_movidas from movidas as m;

  with movidas as (
    update public.lead_session
       set lead_id = p_keep_lead_id
     where lead_id = v_perdedor_id
    returning id
  )
  select coalesce(jsonb_agg(m.id order by m.id), '[]'::jsonb)
    into v_sesiones_movidas from movidas as m;

  with insertados as (
    insert into public.lead_tags (lead_id, tag_id, source, assigned_by, assigned_at)
    select p_keep_lead_id, lt.tag_id, lt.source, lt.assigned_by, lt.assigned_at
      from public.lead_tags as lt
     where lt.lead_id = v_perdedor_id
    on conflict (lead_id, tag_id) do nothing
    returning tag_id
  )
  select coalesce(jsonb_agg(i.tag_id order by i.tag_id), '[]'::jsonb)
    into v_tags_insertados from insertados as i;

  -- Los identificadores del perdedor, más su telefono y email de columna por si
  -- no tenían fila. `principal` se fuerza a false: el ganador ya tiene los
  -- suyos y dos principales del mismo tipo no ayudan a nadie.
  with candidatos as (
    select i.tipo, i.valor, i.valor_original
      from public.lead_identificadores as i
     where i.lead_id = v_perdedor_id
    union
    select 'telefono'::public.identificador_tipo_enum,
           regexp_replace(v_perdedor.telefono, '[^0-9+]', '', 'g'),
           v_perdedor.telefono
     where v_perdedor.telefono is not null
       and btrim(v_perdedor.telefono) <> ''
       and v_perdedor.telefono !~ '^(wa|ig|fb):'
       and regexp_replace(v_perdedor.telefono, '[^0-9+]', '', 'g') <> ''
    union
    select 'email'::public.identificador_tipo_enum,
           lower(btrim(v_perdedor.email)),
           v_perdedor.email
     where v_perdedor.email is not null and btrim(v_perdedor.email) <> ''
  ),
  insertados as (
    insert into public.lead_identificadores (lead_id, tipo, valor, valor_original, principal, origen)
    select p_keep_lead_id, c.tipo, c.valor, c.valor_original, false, 'merge'
      from candidatos as c
    on conflict (lead_id, tipo, valor) do nothing
    returning id, tipo, valor
  )
  select coalesce(
           jsonb_agg(jsonb_build_object('id', i.id, 'tipo', i.tipo, 'valor', i.valor) order by i.id),
           '[]'::jsonb
         )
    into v_ids_movidos
    from insertados as i;

  -- Los autos del perdedor pasan al ganador. Se mueven con UPDATE y no se
  -- copian con INSERT: `lead_vehiculos` no tiene UNIQUE, así que copiar dejaría
  -- dos filas del mismo auto en cuanto alguien revierta a medias, y además el
  -- id de la fila es lo que el revert usa para devolver exactamente estas.
  --
  -- `principal`: si el ganador YA tiene un auto principal, los que llegan
  -- entran en false — es lo mismo que hace la fusión con los identificadores, y
  -- la elección del ganador es la que vale. Si el ganador no tiene ninguno, los
  -- que llegan conservan el suyo: el `update public.leads` de abajo copia
  -- marca/modelo/año/motor del perdedor a las columnas espejo justamente en ese
  -- caso, y forzar false dejaría al lead fusionado con `leads.vehiculo_marca`
  -- lleno y ninguna fila marcada como el auto de la ficha.
  --
  -- El snapshot `antes` y el UPDATE van en la misma sentencia porque los dos
  -- brazos de un CTE ven la misma foto: `RETURNING` devolvería el `principal`
  -- nuevo, y el revert necesita el viejo.
  with antes as (
    select v.id, v.principal
      from public.lead_vehiculos as v
     where v.lead_id = v_perdedor_id
  ),
  movidos as (
    update public.lead_vehiculos as v
       set lead_id = p_keep_lead_id,
           principal = a.principal and not v_ganador_tiene_principal
      from antes as a
     where v.id = a.id
    returning v.id
  )
  select coalesce(
           jsonb_agg(
             jsonb_build_object('id', a.id, 'principal_antes', a.principal) order by a.id
           ),
           '[]'::jsonb
         )
    into v_vehiculos_movidos
    from antes as a
    join movidos as m on m.id = a.id;

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
    actor_user_id, action, entity_type, entity_id, payload
  ) values (
    auth.uid(), 'lead.merge', 'lead', p_keep_lead_id,
    jsonb_build_object(
      'payload_version', 4,
      'candidate_id', p_candidate_id,
      'ganador_id', p_keep_lead_id,
      'ganador_antes', to_jsonb(v_ganador),
      'perdedor', to_jsonb(v_perdedor),
      'perdedor_tags', v_perdedor_tags,
      'conversaciones_movidas', v_convs_movidas,
      'sesiones_movidas', v_sesiones_movidas,
      'tags_insertados', v_tags_insertados,
      'identificadores_movidos', v_ids_movidos,
      'vehiculos_movidos', v_vehiculos_movidos
    )
  );

  delete from public.leads where id = v_perdedor_id;

  return query select p_keep_lead_id, null::text;
end;
$function$;

comment on function public.approve_lead_merge(uuid, uuid) is
  'Merge administrativo atomico: locks ordenados, validaciones, reasignacion de conversaciones, sesiones, etiquetas, identificadores y vehiculos, delete y audit reversible (payload_version 4).';

-- =========================================================================
-- El revert devuelve los autos, con el `principal` que tenían
-- =========================================================================

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
  v_ids uuid[];
  v_vehiculos uuid[];
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

  if exists (
    select 1 from public.admin_actions as r
     where r.action = 'lead.merge.revert'
       and r.payload->>'merge_action_id' = p_merge_action_id::text
  ) then
    return query select null::uuid, 'already_reverted'::text;
    return;
  end if;

  v_ganador_id := (v_payload->>'ganador_id')::uuid;
  select * into v_perdedor from jsonb_populate_record(null::public.leads, v_payload->'perdedor');
  select * into v_antes from jsonb_populate_record(null::public.leads, v_payload->'ganador_antes');
  v_perdedor_id := v_perdedor.id;

  perform l.id from public.leads as l where l.id = v_ganador_id for update;
  if not found then
    return query select null::uuid, 'ganador_not_found'::text;
    return;
  end if;

  if exists (select 1 from public.leads as l where l.id = v_perdedor_id) then
    return query select null::uuid, 'lead_exists'::text;
    return;
  end if;
  if exists (select 1 from public.leads as l where l.telefono = v_perdedor.telefono) then
    return query select null::uuid, 'telefono_taken'::text;
    return;
  end if;

  select coalesce(array_agg((e.valor)::uuid), '{}') into v_convs
    from jsonb_array_elements_text(coalesce(v_payload->'conversaciones_movidas', '[]'::jsonb))
      as e(valor);

  select coalesce(array_agg((e.valor)::uuid), '{}') into v_sesiones
    from jsonb_array_elements_text(coalesce(v_payload->'sesiones_movidas', '[]'::jsonb))
      as e(valor);

  select coalesce(array_agg((e.valor)::uuid), '{}') into v_tags
    from jsonb_array_elements_text(coalesce(v_payload->'tags_insertados', '[]'::jsonb))
      as e(valor);

  -- Los identificadores se guardan como objetos; solo hace falta el id. En un
  -- payload 2 la clave no existe y el array queda vacío: no hay nada que sacar.
  select coalesce(array_agg((e.obj->>'id')::uuid), '{}') into v_ids
    from jsonb_array_elements(coalesce(v_payload->'identificadores_movidos', '[]'::jsonb))
      as e(obj);

  -- Los vehículos, igual: objetos con id y el `principal` que tenían antes. En
  -- un payload 2 o 3 la clave no existe y no hay nada que devolver.
  select coalesce(array_agg((e.obj->>'id')::uuid), '{}') into v_vehiculos
    from jsonb_array_elements(coalesce(v_payload->'vehiculos_movidos', '[]'::jsonb))
      as e(obj);

  select greatest(
           count(*) filter (where s.id = any(v_sesiones)),
           count(*) filter (where not (s.id = any(v_sesiones)))
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

  update public.conversaciones
     set lead_id = v_perdedor_id
   where id = any(v_convs) and lead_id = v_ganador_id;

  update public.lead_session
     set lead_id = v_perdedor_id
   where id = any(v_sesiones) and lead_id = v_ganador_id;

  delete from public.lead_tags
   where lead_id = v_ganador_id and tag_id = any(v_tags);

  -- Por id y no por (tipo, valor): si alguien volvió a cargar el mismo dato a
  -- mano después de la fusión, esa fila es otra y no se toca.
  delete from public.lead_identificadores
   where id = any(v_ids) and lead_id = v_ganador_id;

  -- El auto vuelve con el `principal` que tenía antes de la fusión, no con el
  -- que le dejó la fusión: si entró en false porque el ganador ya tenía uno,
  -- devolverlo en false dejaría al perdedor resucitado con autos y ninguno en
  -- la ficha. `lead_id = v_ganador_id` en el WHERE: si alguien ya lo movió a
  -- otro lead, se lo deja donde está.
  update public.lead_vehiculos as v
     set lead_id = v_perdedor_id,
         principal = coalesce((e.obj->>'principal_antes')::boolean, v.principal)
    from jsonb_array_elements(coalesce(v_payload->'vehiculos_movidos', '[]'::jsonb)) as e(obj)
   where v.id = (e.obj->>'id')::uuid
     and v.lead_id = v_ganador_id;

  select coalesce(array_agg(k.clave), '{}') into v_claves_meta
    from jsonb_object_keys(coalesce(v_perdedor.meta_user_ids, '{}'::jsonb)) as k(clave)
   where not (coalesce(v_antes.meta_user_ids, '{}'::jsonb) ? k.clave);

  select coalesce(array_agg(k.clave), '{}') into v_claves_extra
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
    actor_user_id, action, entity_type, entity_id, payload
  ) values (
    auth.uid(), 'lead.merge.revert', 'lead', v_perdedor_id,
    jsonb_build_object(
      'merge_action_id', p_merge_action_id,
      'ganador_id', v_ganador_id,
      'perdedor_id', v_perdedor_id,
      'conversaciones_devueltas', to_jsonb(v_convs),
      'sesiones_devueltas', to_jsonb(v_sesiones),
      'tags_quitados', to_jsonb(v_tags),
      'identificadores_quitados', to_jsonb(v_ids),
      'vehiculos_devueltos', to_jsonb(v_vehiculos)
    )
  );

  return query select v_perdedor_id, null::text;
end;
$function$;

comment on function public.revert_lead_merge(uuid) is
  'Deshace una fusion registrada con payload_version 2 o mayor: resucita el lead borrado, devuelve conversaciones, sesiones y vehiculos que sigan en el ganador, quita las etiquetas e identificadores que la fusion inserto y restaura los campos que no se hayan editado despues.';
