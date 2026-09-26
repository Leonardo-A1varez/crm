-- Workflows: el contador de la condición, las corridas por nodo y los intentos
-- de la corrida que falló.
--
-- Aditiva: tres funciones nuevas y una columna nullable. No reescribe nada.
--
-- =========================================================================
-- 1. Cuántos leads cumplen una condición de workflow, AHORA
-- =========================================================================
-- El panel de Condición dice "N leads coinciden" y deja ver la lista. Se
-- cuenta acá y no trayendo los leads a la app: PostgREST corta en 1.000 filas
-- y no avisa (AGENTS.md, lección 12).
--
-- No reusa `difusion_audiencia_predicado`: la audiencia de Difusión y la
-- condición de un workflow comparten la gramática del árbol pero no los
-- campos ni la semántica de cada comparador. Esto es la semántica del
-- evaluador del motor (`src/lib/workflows/condiciones.ts`), fila por fila:
--
--   * un campo ausente da false con todo comparador salvo "está vacío";
--   * "está vacío" = null, texto en blanco o lista vacía;
--   * texto: `es`/`no_es` exactos, `contiene`/`no_contiene`/`empieza_con` sin
--     distinguir mayúsculas;
--   * lista de varias (etiquetas): tiene alguna / tiene todas / no tiene;
--   * número: es, no es, mayor, menor, entre (inclusive);
--   * fecha: antes/después/entre comparan el DÍA en la zona del negocio;
--     "hace más de N días" es instante contra instante, días de 24 h;
--   * un grupo sin hijos no se cumple.
--
-- Qué es cada campo al contar (el motor lo lee igual al evaluar, salvo lo que
-- depende del disparo):
--   lead.etapa, sesion.tiene_cotizacion, sesion.precio_cotizado,
--   sesion.intent → la sesión MÁS RECIENTE del lead (`started_at`). En una
--     corrida es la sesión del disparo, que casi siempre es la misma.
--   lead.canal → `leads.canal_origen`. En una corrida disparada por mensaje
--     es el canal del mensaje.
--   sesion.intent → el turno clasificado más nuevo de esa sesión, del LLM
--     (`turn_classifications`) o de una regla (`rule_executions`).
--   lead.etiquetas → las puestas y no quitadas.
--   vehiculo.marca → el vehículo principal; entre iguales, el más viejo.
--   lead.ultimo_mensaje → el último entrante del lead, en cualquier conversación.
--   sesion.respondio → NO SE PUEDE CONTAR: es "el lead acaba de escribir", lo
--     sabe sólo el disparo. Levanta 23514; la app no llega a llamar con él.
--
-- Los valores entran al SQL generado sólo con `format('%L')` y las columnas
-- salen de una lista fija por campo: no hay por dónde inyectar. Cualquier
-- campo, comparador o valor que no conozca levanta 23514.

create function public.workflow_condicion_regla(
  p_regla jsonb,
  p_ahora timestamptz,
  p_zona  text
)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_campo      text := p_regla ->> 'campoId';
  v_comparador text := p_regla ->> 'comparador';
  v_valor      jsonb := p_regla -> 'valor';
  v_tipo_valor text := p_regla -> 'valor' ->> 'tipo';
  v_col        text;
  v_clase      text;
  v_expr       text;
  v_dia        text;
begin
  -- La columna del contexto y la clase de campo, de una lista fija.
  case v_campo
    when 'lead.etapa'             then v_col := 'c.etapa';            v_clase := 'texto';
    when 'lead.nombre'            then v_col := 'c.nombre';           v_clase := 'texto';
    when 'lead.canal'             then v_col := 'c.canal';            v_clase := 'texto';
    when 'sesion.intent'          then v_col := 'c.intent';           v_clase := 'texto';
    when 'vehiculo.marca'         then v_col := 'c.marca';            v_clase := 'texto';
    when 'sesion.tiene_cotizacion' then v_col := 'c.tiene_cotizacion'; v_clase := 'booleano';
    when 'lead.etiquetas'         then v_col := 'c.etiquetas';        v_clase := 'lista';
    when 'sesion.precio_cotizado' then v_col := 'c.precio';           v_clase := 'numero';
    when 'lead.alta'              then v_col := 'c.alta';             v_clase := 'fecha';
    when 'lead.ultimo_mensaje'    then v_col := 'c.ultimo_mensaje';   v_clase := 'fecha';
    when 'sesion.respondio' then
      raise exception 'la condicion usa "Respondio", que depende del disparo y no se puede contar'
        using errcode = '23514';
    else
      raise exception 'campo de condicion desconocido: %', coalesce(v_campo, 'ninguno')
        using errcode = '23514';
  end case;

  if v_comparador = 'esta_vacio' or v_comparador = 'no_esta_vacio' then
    v_expr := case v_clase
      when 'texto' then format('(%1$s is null or %1$s ~ ''^[[:space:]]*$'')', v_col)
      when 'lista' then format('(%1$s is null or cardinality(%1$s) = 0)', v_col)
      else format('(%s is null)', v_col)
    end;
    return case when v_comparador = 'esta_vacio' then v_expr else 'not ' || v_expr end;
  end if;

  -- Contra el booleano, y ausente no es "no".
  if v_tipo_valor = 'booleano' then
    if v_comparador <> 'es' or jsonb_typeof(v_valor -> 'valor') <> 'boolean' then
      raise exception 'valor booleano invalido en %', v_campo using errcode = '23514';
    end if;
    if v_clase <> 'booleano' then return 'false'; end if;
    return format('coalesce(%s = %L::boolean, false)', v_col, v_valor ->> 'valor');
  end if;

  -- Una fila de número o fecha sin su valor no se evalúa: el motor la
  -- rechaza antes (`CondicionSchema`) y acá tampoco se adivina.
  if v_clase in ('fecha', 'numero') and (
       (v_tipo_valor in ('numero', 'fecha') and v_valor ->> 'valor' is null)
    or (v_tipo_valor in ('rango', 'rangoFecha')
        and (v_valor ->> 'desde' is null or v_valor ->> 'hasta' is null))
  ) then
    raise exception 'a la fila de % le falta el valor', v_campo using errcode = '23514';
  end if;

  if v_clase = 'fecha' then
    v_dia := format('((%s at time zone %L)::date)', v_col, p_zona);
    if v_comparador = 'hace_mas_de' and v_tipo_valor = 'numero' then
      v_expr := format('extract(epoch from (%L::timestamptz - %s)) > %s * 86400',
                       p_ahora, v_col, (v_valor ->> 'valor')::numeric);
    elsif v_comparador = 'entre' and v_tipo_valor = 'rangoFecha' then
      v_expr := format('%s between %L::date and %L::date', v_dia,
                       v_valor ->> 'desde', v_valor ->> 'hasta');
    elsif v_comparador = 'antes_de' and v_tipo_valor = 'fecha' then
      v_expr := format('%s < %L::date', v_dia, v_valor ->> 'valor');
    elsif v_comparador = 'despues_de' and v_tipo_valor = 'fecha' then
      v_expr := format('%s > %L::date', v_dia, v_valor ->> 'valor');
    else
      raise exception 'comparador % no se aplica a la fecha %', v_comparador, v_campo
        using errcode = '23514';
    end if;
    return format('coalesce(%s, false)', v_expr);
  end if;

  if v_clase = 'numero' then
    if v_comparador = 'entre' and v_tipo_valor = 'rango' then
      v_expr := format('%s between %s and %s', v_col,
                       (v_valor ->> 'desde')::numeric, (v_valor ->> 'hasta')::numeric);
    elsif v_tipo_valor = 'numero' and v_comparador in ('es', 'no_es', 'mayor_que', 'menor_que') then
      v_expr := format('%s %s %s', v_col,
                       case v_comparador when 'es' then '=' when 'no_es' then '<>'
                                         when 'mayor_que' then '>' else '<' end,
                       (v_valor ->> 'valor')::numeric);
    else
      raise exception 'comparador % no se aplica al numero %', v_comparador, v_campo
        using errcode = '23514';
    end if;
    return format('coalesce(%s, false)', v_expr);
  end if;

  if v_tipo_valor = 'opciones' then
    if v_clase <> 'lista' then return 'false'; end if;
    v_expr := format('array(select jsonb_array_elements_text(%L::jsonb))', v_valor -> 'valores');
    return case v_comparador
      when 'tiene'       then format('coalesce(%s && %s, false)', v_col, v_expr)
      when 'tiene_todas' then format('coalesce(%s @> %s, false)', v_col, v_expr)
      when 'no_tiene'    then format('coalesce(not (%s && %s), false)', v_col, v_expr)
      else 'false'
    end;
  end if;

  if v_tipo_valor in ('opcion', 'texto') then
    if v_clase <> 'texto' then return 'false'; end if;
    -- Igual que `compararTexto`: exacto para es/no_es, sin mayúsculas el resto.
    return case v_comparador
      when 'es'          then format('coalesce(%s = %L, false)', v_col, v_valor ->> 'valor')
      when 'no_es'       then format('coalesce(%s <> %L, false)', v_col, v_valor ->> 'valor')
      when 'contiene'    then format('coalesce(strpos(lower(%s), lower(%L)) > 0, false)', v_col, v_valor ->> 'valor')
      when 'no_contiene' then format('coalesce(strpos(lower(%s), lower(%L)) = 0, false)', v_col, v_valor ->> 'valor')
      when 'empieza_con' then format('coalesce(starts_with(lower(%s), lower(%L)), false)', v_col, v_valor ->> 'valor')
      else 'false'
    end;
  end if;

  raise exception 'valor de condicion desconocido en %: %', v_campo, coalesce(v_tipo_valor, 'ninguno')
    using errcode = '23514';
end;
$$;

comment on function public.workflow_condicion_regla(jsonb, timestamptz, text) is
  'Una fila de la condicion de un workflow -> predicado SQL sobre el contexto por lead (alias c). Misma semantica que evaluarCondicion (src/lib/workflows/condiciones.ts). 23514 ante lo que no conozca.';

create function public.workflow_condicion_predicado(
  p_nodo  jsonb,
  p_ahora timestamptz,
  p_zona  text,
  p_nivel integer default 1
)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_operador text;
  v_partes   text[];
begin
  if jsonb_typeof(p_nodo) is distinct from 'object' then
    raise exception 'la condicion no tiene la forma esperada' using errcode = '23514';
  end if;

  if p_nodo ->> 'clase' = 'regla' then
    if p_nivel = 1 then
      raise exception 'la raiz de la condicion tiene que ser un grupo' using errcode = '23514';
    end if;
    return public.workflow_condicion_regla(p_nodo, p_ahora, p_zona);
  end if;

  if p_nodo ->> 'clase' is distinct from 'grupo' then
    raise exception 'nodo de condicion desconocido' using errcode = '23514';
  end if;
  -- Tres niveles de grupos, igual que PROFUNDIDAD_MAX del constructor.
  if p_nivel > 3 then
    raise exception 'la condicion admite hasta 3 niveles de grupos' using errcode = '23514';
  end if;
  v_operador := p_nodo ->> 'operador';
  if v_operador is null or v_operador not in ('y', 'o') then
    raise exception 'operador de grupo desconocido: %', coalesce(v_operador, 'ninguno') using errcode = '23514';
  end if;
  if jsonb_typeof(p_nodo -> 'hijos') is distinct from 'array' then
    raise exception 'un grupo de la condicion no trae su lista de filas' using errcode = '23514';
  end if;
  if jsonb_array_length(p_nodo -> 'hijos') > 50 then
    raise exception 'un grupo admite hasta 50 filas' using errcode = '23514';
  end if;
  -- Igual que el motor: un grupo sin hijos no se cumple, con Y ni con O.
  if jsonb_array_length(p_nodo -> 'hijos') = 0 then
    return 'false';
  end if;

  select array_agg('(' || public.workflow_condicion_predicado(h.valor, p_ahora, p_zona, p_nivel + 1) || ')'
                   order by h.orden)
    into v_partes
    from jsonb_array_elements(p_nodo -> 'hijos') with ordinality as h(valor, orden);
  return array_to_string(v_partes, case v_operador when 'y' then ' and ' else ' or ' end);
end;
$$;

comment on function public.workflow_condicion_predicado(jsonb, timestamptz, text, integer) is
  'El arbol de la condicion de un workflow ({arbol} del constructor) -> un predicado SQL. El operador es del grupo; cada hijo entre parentesis.';

-- SECURITY INVOKER: corre con el RLS de quien llama. Devuelve el total y los
-- primeros `p_muestra` leads (los de actividad más reciente primero) para
-- "Ver la lista". Un solo jsonb: el tope de filas de PostgREST no aplica.
create function public.workflow_condicion_coincidencias(
  p_arbol   jsonb,
  p_ahora   timestamptz,
  p_zona    text,
  p_muestra integer default 0
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_pred      text;
  v_resultado jsonb;
begin
  if p_muestra < 0 or p_muestra > 200 then
    raise exception 'la muestra va de 0 a 200 leads' using errcode = '23514';
  end if;
  -- Valida la zona antes de armar nada: una zona inexistente es un error de
  -- quien llama, no "cero leads".
  perform p_ahora at time zone p_zona;

  v_pred := public.workflow_condicion_predicado(p_arbol, p_ahora, p_zona);

  execute format($q$
    with c as (
      select l.id,
             l.nombre,
             l.nombre_perfil,
             l.updated_at,
             l.canal_origen::text                       as canal,
             l.created_at                               as alta,
             s.current_stage::text                      as etapa,
             -- Sin sesión, ausente: no "no tiene", igual que el motor.
             case when s.id is null then null
                  else s.producto_cotizado_id is not null
                       or s.precio_cotizado is not null
             end                                        as tiene_cotizacion,
             s.precio_cotizado                          as precio,
             (select coalesce(array_agg(lt.tag_id::text), '{}')
                from public.lead_tags lt
               where lt.lead_id = l.id and lt.quitada_at is null) as etiquetas,
             (select v.marca
                from public.lead_vehiculos v
               where v.lead_id = l.id
               order by v.principal desc, v.created_at asc
               limit 1)                                 as marca,
             (select m.created_at
                from public.mensajes m
                join public.conversaciones cv on cv.id = m.conversacion_id
               where cv.lead_id = l.id and m.direction = 'in'
               order by m.created_at desc
               limit 1)                                 as ultimo_mensaje,
             (select t.intent_id::text
                from (
                  select tc.intent_id, tc.created_at
                    from public.turn_classifications tc
                    join public.mensajes m on m.id = tc.mensaje_id
                   where m.lead_session_id = s.id
                  union all
                  select re.matched_intent_id, re.created_at
                    from public.rule_executions re
                    join public.mensajes m on m.id = re.mensaje_id
                   where m.lead_session_id = s.id
                ) t
               order by t.created_at desc
               limit 1)                                 as intent
        from public.leads l
        left join lateral (
          select ls.id, ls.current_stage, ls.producto_cotizado_id, ls.precio_cotizado
            from public.lead_session ls
           where ls.lead_id = l.id
           order by ls.started_at desc
           limit 1
        ) s on true
    ),
    f as (select c.id, c.nombre, c.nombre_perfil, c.updated_at from c where %s)
    select jsonb_build_object(
      'total', (select count(*) from f),
      'leads', coalesce((
        select jsonb_agg(jsonb_build_object('id', x.id,
                                            'nombre', coalesce(nullif(x.nombre, ''), x.nombre_perfil))
                         order by x.updated_at desc, x.id)
          from (select * from f order by f.updated_at desc, f.id limit %s) x
      ), '[]'::jsonb)
    )
  $q$, v_pred, p_muestra)
  into v_resultado;

  return v_resultado;
end;
$$;

comment on function public.workflow_condicion_coincidencias(jsonb, timestamptz, text, integer) is
  'Cuantos leads cumplen HOY la condicion de un workflow y los primeros p_muestra. SECURITY INVOKER. Ver el encabezado de la migracion para que es cada campo al contar.';

-- =========================================================================
-- 2. Por dónde pasan las corridas de una versión
-- =========================================================================
-- El lienzo de una corrida muestra, además de la corrida abierta, cuántas
-- corridas de la MISMA versión pasaron por cada nodo desde `p_desde`, cuántas
-- fallaron ahí y cuántas están esperando ahí ahora. Agregado en la base: son
-- `workflow_run_pasos`, que crecen con cada paso de cada corrida.
--
-- Las corridas de Probar no cuentan, igual que en `contar_saltos_workflow`:
-- no se le iba a mandar nada a nadie.

create function public.workflow_corridas_por_nodo(
  p_version_id uuid,
  p_desde      timestamptz
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with runs as (
    select r.id, r.estado, r.nodo_actual
      from public.workflow_runs r
     where r.workflow_version_id = p_version_id
       and r.started_at >= p_desde
       and not (r.contexto @> '{"$prueba": true}'::jsonb)
  ),
  por_nodo as (
    select p.nodo_id,
           count(distinct p.run_id)                             as corridas,
           count(distinct p.run_id) filter (where p.error is not null) as fallaron
      from public.workflow_run_pasos p
      join runs on runs.id = p.run_id
     group by p.nodo_id
  ),
  esperando as (
    select runs.nodo_actual as nodo_id, count(*) as esperando
      from runs
     where runs.estado = 'esperando' and runs.nodo_actual is not null
     group by runs.nodo_actual
  )
  select jsonb_build_object(
    'corridas', (select count(*) from runs),
    'vivas', (select count(*) from runs where runs.estado in ('corriendo', 'esperando')),
    'nodos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'nodo_id', coalesce(pn.nodo_id, e.nodo_id),
               'corridas', coalesce(pn.corridas, 0),
               'fallaron', coalesce(pn.fallaron, 0),
               'esperando', coalesce(e.esperando, 0))
             order by coalesce(pn.nodo_id, e.nodo_id))
        from por_nodo pn
        full join esperando e on e.nodo_id = pn.nodo_id
    ), '[]'::jsonb)
  );
$$;

comment on function public.workflow_corridas_por_nodo(uuid, timestamptz) is
  'Cuantas corridas de produccion de una version pasaron por cada nodo desde p_desde, cuantas fallaron ahi y cuantas esperan ahi ahora. SECURITY INVOKER.';

-- `workflow_run_pasos (run_id, orden)` ya existe; esto sirve al filtro por
-- versión y ventana.
-- (workflow_runs_por_version (workflow_version_id, started_at desc) ya existe.)

-- =========================================================================
-- 3. Cuántas veces se intentó el paso que hizo fallar la corrida
-- =========================================================================
-- "Falló tras N intentos". Inngest reintenta el step de un segmento que falla
-- con un error reintentable; hasta ahora nadie anotaba cuántas veces. NULL =
-- no se registró (corridas anteriores a esta columna, o que no fallaron).

alter table public.workflow_runs
  add column intentos smallint,
  add constraint workflow_runs_intentos_positivo check (intentos is null or intentos >= 1);

comment on column public.workflow_runs.intentos is
  'Cuantas veces se intento el paso que hizo fallar la corrida (1 = fallo sin reintentar). NULL = no registrado.';

revoke all on function public.workflow_condicion_regla(jsonb, timestamptz, text) from public, anon;
grant execute on function public.workflow_condicion_regla(jsonb, timestamptz, text) to authenticated, service_role;

revoke all on function public.workflow_condicion_predicado(jsonb, timestamptz, text, integer) from public, anon;
grant execute on function public.workflow_condicion_predicado(jsonb, timestamptz, text, integer) to authenticated, service_role;

revoke all on function public.workflow_condicion_coincidencias(jsonb, timestamptz, text, integer) from public, anon;
grant execute on function public.workflow_condicion_coincidencias(jsonb, timestamptz, text, integer) to authenticated, service_role;

revoke all on function public.workflow_corridas_por_nodo(uuid, timestamptz) from public, anon;
grant execute on function public.workflow_corridas_por_nodo(uuid, timestamptz) to authenticated, service_role;
