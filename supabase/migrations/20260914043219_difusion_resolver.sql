-- Difusión conectada: el resolver de audiencia, la programación atómica y las
-- lecturas agregadas que usan las pantallas.
-- Spec: docs/prd-workflows.md §7 · docs/prd-workflows-difusion.md §6.1, §7.3, §8.
--
-- Depende de 20260913230655 (lead_session.vendedor_asignado_id) y de
-- 20260913231021 (las tablas de difusión). Aditiva: una columna con default,
-- dos CHECK, dos índices parciales y funciones nuevas. No reescribe ninguna.
--
-- Por qué en SQL y no en TypeScript: el árbol de condiciones combina Y/O con
-- EXISTS sobre otras tablas, y eso no se expresa con los filtros de PostgREST.
-- Traer los leads para filtrarlos en la app es exactamente el bug de la
-- lección 12 de AGENTS.md: PostgREST corta en 1.000 filas y no avisa. Acá la
-- base filtra y devuelve páginas explícitas por keyset.

-- =========================================================================
-- 1. Mandarle a toda la base es una elección, no un árbol vacío
-- =========================================================================
-- Sin esta columna no hay forma de distinguir "eligió toda la base" de "borró
-- todas las filas sin querer". La app rechaza el árbol vacío sin la marca; la
-- base lo impide también en cuanto la difusión deja de ser borrador.

alter table public.difusiones
  add column audiencia_toda_la_base boolean not null default false;

comment on column public.difusiones.audiencia_toda_la_base is
  'true = se eligio mandarle a toda la base, a proposito. Exige el arbol vacio. Un arbol vacio sin esta marca no se programa.';

-- `difusiones_audiencia_es_grupo` ya garantiza que `hijos` es un array.
alter table public.difusiones
  add constraint difusiones_toda_la_base_sin_condiciones
  check (not audiencia_toda_la_base or jsonb_array_length(audiencia -> 'hijos') = 0);

alter table public.difusiones
  add constraint difusiones_audiencia_definida_al_programar
  check (
    estado = 'borrador'
    or audiencia_toda_la_base
    or jsonb_array_length(audiencia -> 'hijos') > 0
  );

-- =========================================================================
-- 2. El resolver de audiencia
-- =========================================================================
-- Recibe la forma compilada de `src/lib/difusion/audiencia.ts`
-- (`compilarAudiencia`), no el árbol crudo de la pantalla:
--
--   {"tipo":"toda_la_base"}
--   {"tipo":"grupo","operador":"y"|"o","hijos":[...]}
--   {"tipo":"regla","campo":..,"comparador":..,"valores":[..]|"texto":..|"numero":..}
--
-- La app ya validó todo; esto vuelve a validar, porque la API REST también
-- puede llamar a la función. Cualquier cosa que no conozca —un nodo, un campo,
-- un comparador, un valor fuera de su enum— levanta 23514 (ValidationError en
-- la app). Nunca se ignora una fila: una fila ignorada ensancha la audiencia.
--
-- Los valores entran al SQL generado sólo con `format('%L')` (quote_literal) y
-- las columnas salen de una lista fija por campo: no hay por dónde inyectar.
--
-- Qué pregunta cada campo:
--   etapa, motivo_perdida, vendedor, consulta → la sesión MÁS RECIENTE del
--     lead (`ls`): la etapa de alguien que perdió la venta es `perdido`, y esa
--     sesión ya está cerrada.
--   canal → `leads.canal_origen`, por dónde llegó.
--   ultima_actividad → la conversación más reciente (`ua`); sin conversación,
--     el alta del lead.
--   vehiculo → cualquiera de sus `lead_vehiculos`.
--   campania_previa → un envío de esa difusión que llegó a Meta.
-- "No es ninguna de" incluye a quien no tiene el dato: un lead sin sesión no
-- está en ninguna etapa.

create function public.difusion_audiencia_regla(p_regla jsonb, p_ahora timestamptz)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_campo      text := p_regla ->> 'campo';
  v_comparador text := p_regla ->> 'comparador';
  v_valores    text[];
  v_distintos  integer;
  v_texto      text;
  v_dias       numeric;
  v_limite     timestamptz;
begin
  -- Cada familia de comparador trae su valor, y sólo el suyo. Los `if`
  -- anidados y no un `or`: SQL no garantiza el orden de evaluación, y
  -- `jsonb_array_length` sobre algo que no es un array no es un 23514.
  if v_comparador in ('tiene', 'tiene_todas', 'no_tiene') then
    if jsonb_typeof(p_regla -> 'valores') is distinct from 'array' then
      raise exception 'la condicion sobre % necesita una lista de valores', coalesce(v_campo, '?')
        using errcode = '23514';
    end if;
    if jsonb_array_length(p_regla -> 'valores') = 0
       or exists (
         select 1 from jsonb_array_elements(p_regla -> 'valores') as e
          where jsonb_typeof(e) <> 'string'
       ) then
      raise exception 'la condicion sobre % necesita al menos un valor de texto', coalesce(v_campo, '?')
        using errcode = '23514';
    end if;
    select array_agg(distinct x order by x) into v_valores
      from jsonb_array_elements_text(p_regla -> 'valores') as x;
  elsif v_comparador in ('contiene', 'no_contiene') then
    if jsonb_typeof(p_regla -> 'texto') is distinct from 'string' then
      raise exception 'la condicion sobre % necesita un texto', coalesce(v_campo, '?')
        using errcode = '23514';
    end if;
    v_texto := btrim(p_regla ->> 'texto');
    if v_texto = '' or char_length(v_texto) > 200 then
      raise exception 'la condicion sobre % necesita un texto de 1 a 200 caracteres', coalesce(v_campo, '?')
        using errcode = '23514';
    end if;
    v_texto := public.plegar_texto(v_texto);
  elsif v_comparador in ('mayor_que', 'menor_que') then
    if jsonb_typeof(p_regla -> 'numero') is distinct from 'number' then
      raise exception 'la condicion sobre % necesita una cantidad de dias', coalesce(v_campo, '?')
        using errcode = '23514';
    end if;
    v_dias := (p_regla ->> 'numero')::numeric;
    if v_dias < 0 or v_dias > 36500 then
      raise exception 'la cantidad de dias va de 0 a 36500 (llego %)', v_dias using errcode = '23514';
    end if;
    v_limite := p_ahora - v_dias * interval '1 day';
  elsif v_comparador in ('esta_vacio', 'no_esta_vacio') then
    null;
  else
    raise exception 'comparador de audiencia desconocido: %', coalesce(v_comparador, 'ninguno')
      using errcode = '23514';
  end if;

  case v_campo
    when 'etapa' then
      if v_comparador not in ('tiene', 'no_tiene') then
        raise exception 'la etapa no admite el comparador %', v_comparador using errcode = '23514';
      end if;
      if exists (select 1 from unnest(v_valores) as x
                  where x <> all (enum_range(null::public.current_stage_enum)::text[])) then
        raise exception 'etapa desconocida en la audiencia' using errcode = '23514';
      end if;
      if v_comparador = 'tiene' then
        return format($f$ls.current_stage = any (%L::public.current_stage_enum[])$f$, v_valores);
      end if;
      return format($f$coalesce(ls.current_stage <> all (%L::public.current_stage_enum[]), true)$f$, v_valores);

    when 'motivo_perdida' then
      if v_comparador not in ('tiene', 'no_tiene') then
        raise exception 'el motivo de perdida no admite el comparador %', v_comparador using errcode = '23514';
      end if;
      if exists (select 1 from unnest(v_valores) as x
                  where x <> all (enum_range(null::public.motivo_perdida_enum)::text[])) then
        raise exception 'motivo de perdida desconocido en la audiencia' using errcode = '23514';
      end if;
      if v_comparador = 'tiene' then
        return format($f$ls.motivo_perdida = any (%L::public.motivo_perdida_enum[])$f$, v_valores);
      end if;
      return format($f$coalesce(ls.motivo_perdida <> all (%L::public.motivo_perdida_enum[]), true)$f$, v_valores);

    when 'canal' then
      if v_comparador not in ('tiene', 'no_tiene') then
        raise exception 'el canal no admite el comparador %', v_comparador using errcode = '23514';
      end if;
      if exists (select 1 from unnest(v_valores) as x
                  where x <> all (enum_range(null::public.canal_enum)::text[])) then
        raise exception 'canal desconocido en la audiencia' using errcode = '23514';
      end if;
      if v_comparador = 'tiene' then
        return format($f$l.canal_origen = any (%L::public.canal_enum[])$f$, v_valores);
      end if;
      return format($f$l.canal_origen <> all (%L::public.canal_enum[])$f$, v_valores);

    when 'etiqueta', 'vendedor', 'campania_previa' then
      if exists (select 1 from unnest(v_valores) as x
                  where x !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
        raise exception 'la condicion sobre % lleva ids, y llego otra cosa', v_campo using errcode = '23514';
      end if;
      -- En minúsculas y sin repetir: `tiene_todas` compara cantidades.
      select array_agg(distinct lower(x) order by lower(x)) into v_valores from unnest(v_valores) as x;
      v_distintos := cardinality(v_valores);

      if v_campo = 'etiqueta' then
        if v_comparador = 'tiene' then
          return format($f$exists (select 1 from public.lead_tags as lt where lt.lead_id = l.id and lt.quitada_at is null and lt.tag_id = any (%L::uuid[]))$f$, v_valores);
        elsif v_comparador = 'tiene_todas' then
          return format($f$(select count(distinct lt.tag_id) from public.lead_tags as lt where lt.lead_id = l.id and lt.quitada_at is null and lt.tag_id = any (%L::uuid[])) = %s$f$, v_valores, v_distintos);
        elsif v_comparador = 'no_tiene' then
          return format($f$not exists (select 1 from public.lead_tags as lt where lt.lead_id = l.id and lt.quitada_at is null and lt.tag_id = any (%L::uuid[]))$f$, v_valores);
        end if;
        raise exception 'la etiqueta no admite el comparador %', v_comparador using errcode = '23514';
      end if;

      if v_campo = 'vendedor' then
        if v_comparador = 'tiene' then
          return format($f$ls.vendedor_asignado_id = any (%L::uuid[])$f$, v_valores);
        elsif v_comparador = 'no_tiene' then
          return format($f$coalesce(ls.vendedor_asignado_id <> all (%L::uuid[]), true)$f$, v_valores);
        end if;
        raise exception 'el vendedor no admite el comparador %', v_comparador using errcode = '23514';
      end if;

      -- campania_previa: "recibió" = el envío llegó a Meta (aceptado o después).
      if v_comparador = 'tiene' then
        return format($f$exists (select 1 from public.difusion_envios as e where e.lead_id = l.id and e.difusion_id = any (%L::uuid[]) and e.estado in ('aceptado', 'entregado', 'leido'))$f$, v_valores);
      elsif v_comparador = 'no_tiene' then
        return format($f$not exists (select 1 from public.difusion_envios as e where e.lead_id = l.id and e.difusion_id = any (%L::uuid[]) and e.estado in ('aceptado', 'entregado', 'leido'))$f$, v_valores);
      end if;
      raise exception 'la campania previa no admite el comparador %', v_comparador using errcode = '23514';

    when 'ultima_actividad' then
      if v_comparador = 'mayor_que' then
        return format($f$coalesce(ua.ultima, l.created_at) < %L::timestamptz$f$, v_limite);
      elsif v_comparador = 'menor_que' then
        return format($f$coalesce(ua.ultima, l.created_at) > %L::timestamptz$f$, v_limite);
      end if;
      raise exception 'la ultima actividad no admite el comparador %', v_comparador using errcode = '23514';

    when 'consulta' then
      if v_comparador = 'contiene' then
        return format($f$strpos(public.plegar_texto(coalesce(ls.consulta, '')), %L) > 0$f$, v_texto);
      elsif v_comparador = 'no_contiene' then
        return format($f$strpos(public.plegar_texto(coalesce(ls.consulta, '')), %L) = 0$f$, v_texto);
      elsif v_comparador = 'esta_vacio' then
        return $f$btrim(coalesce(ls.consulta, '')) = ''$f$;
      elsif v_comparador = 'no_esta_vacio' then
        return $f$btrim(coalesce(ls.consulta, '')) <> ''$f$;
      end if;
      raise exception 'la consulta no admite el comparador %', v_comparador using errcode = '23514';

    when 'vehiculo' then
      if v_comparador = 'contiene' then
        return format($f$exists (select 1 from public.lead_vehiculos as v where v.lead_id = l.id and strpos(public.plegar_texto(concat_ws(' ', v.marca, v.modelo, v.anio::text, v.motor, v.placa, v.vin)), %L) > 0)$f$, v_texto);
      elsif v_comparador = 'no_contiene' then
        return format($f$not exists (select 1 from public.lead_vehiculos as v where v.lead_id = l.id and strpos(public.plegar_texto(concat_ws(' ', v.marca, v.modelo, v.anio::text, v.motor, v.placa, v.vin)), %L) > 0)$f$, v_texto);
      end if;
      raise exception 'el vehiculo no admite el comparador %', v_comparador using errcode = '23514';

    else
      raise exception 'campo de audiencia desconocido: %', coalesce(v_campo, 'ninguno') using errcode = '23514';
  end case;
end;
$$;

comment on function public.difusion_audiencia_regla(jsonb, timestamptz) is
  'Una fila compilada de la audiencia → predicado SQL sobre l (leads), ls (sesion mas reciente) y ua (ultima actividad). Levanta 23514 ante cualquier campo, comparador o valor que no conozca.';

create function public.difusion_audiencia_predicado(
  p_nodo  jsonb,
  p_ahora timestamptz,
  p_nivel integer default 1
)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_tipo     text;
  v_operador text;
  v_partes   text[];
begin
  if jsonb_typeof(p_nodo) is distinct from 'object' then
    raise exception 'la audiencia no tiene la forma esperada' using errcode = '23514';
  end if;
  v_tipo := p_nodo ->> 'tipo';

  if v_tipo = 'toda_la_base' then
    if p_nivel <> 1 then
      raise exception 'toda la base solo puede ser la audiencia entera, no una parte' using errcode = '23514';
    end if;
    return 'true';
  end if;

  if v_tipo = 'grupo' then
    if p_nivel > 3 then
      raise exception 'la audiencia admite hasta 3 niveles de grupos' using errcode = '23514';
    end if;
    v_operador := p_nodo ->> 'operador';
    if v_operador is null or v_operador not in ('y', 'o') then
      raise exception 'operador de grupo desconocido: %', coalesce(v_operador, 'ninguno') using errcode = '23514';
    end if;
    if jsonb_typeof(p_nodo -> 'hijos') is distinct from 'array' then
      raise exception 'un grupo de la audiencia no trae su lista de condiciones' using errcode = '23514';
    end if;
    if jsonb_array_length(p_nodo -> 'hijos') = 0 then
      -- Un Y de nada es toda la base y un O de nada es nadie: no se adivina.
      raise exception 'un grupo sin condiciones no dice nada' using errcode = '23514';
    end if;
    if jsonb_array_length(p_nodo -> 'hijos') > 50 then
      raise exception 'un grupo admite hasta 50 condiciones' using errcode = '23514';
    end if;

    select array_agg('(' || public.difusion_audiencia_predicado(h.valor, p_ahora, p_nivel + 1) || ')'
                     order by h.orden)
      into v_partes
      from jsonb_array_elements(p_nodo -> 'hijos') with ordinality as h(valor, orden);
    return array_to_string(v_partes, case v_operador when 'y' then ' and ' else ' or ' end);
  end if;

  if v_tipo = 'regla' then
    if p_nivel = 1 then
      raise exception 'la raiz de la audiencia tiene que ser un grupo' using errcode = '23514';
    end if;
    return public.difusion_audiencia_regla(p_nodo, p_ahora);
  end if;

  raise exception 'nodo de audiencia desconocido: %', coalesce(v_tipo, 'sin tipo') using errcode = '23514';
end;
$$;

comment on function public.difusion_audiencia_predicado(jsonb, timestamptz, integer) is
  'La audiencia compilada entera → un solo predicado SQL. Cada hijo va entre parentesis y el operador es del grupo. Levanta 23514 ante un nodo que no conozca.';

-- La lista de leads que coinciden, por páginas de hasta 1.000 ordenadas por
-- id: el llamador pasa el último id de la página anterior (keyset). Nunca
-- devuelve más de `p_limite` filas, así que el corte de PostgREST no puede
-- mentir sobre el total.
--
-- Trae, además de quién es, lo que necesita el planificador
-- (`src/lib/difusion/planificador.ts`): la etapa de la sesión ACTIVA
-- (`resultado is null`), el último entrante por WhatsApp —el que abre la
-- ventana de 24 h de ese canal— y los salientes automáticos (ia, sistema) de
-- las últimas 24 h, con el mismo criterio que `contarSalientesAutomaticos`.
--
-- SECURITY INVOKER: corre con el RLS de quien llama.
create function public.difusion_resolver_audiencia(
  p_audiencia  jsonb,
  p_ahora      timestamptz,
  p_despues_de uuid default null,
  p_limite     integer default 1000
)
returns table (
  lead_id                   uuid,
  nombre                    text,
  telefono                  text,
  etapa_activa              public.current_stage_enum,
  ultimo_entrante_at        timestamptz,
  salientes_automaticos_24h integer,
  vehiculo                  text
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_predicado text;
  v_filas     bigint;
begin
  if p_ahora is null then
    raise exception 'falta el instante de referencia de la audiencia' using errcode = '23514';
  end if;
  if p_limite is null or p_limite not between 1 and 1000 then
    raise exception 'el limite de pagina va de 1 a 1000 (llego %)', p_limite using errcode = '23514';
  end if;
  -- Cuántas filas trae el árbol, en todos sus niveles. `->` sobre algo que no
  -- es un objeto devuelve null, así que un nodo con cualquier forma no rompe
  -- el conteo: lo rechaza después el predicado, con 23514.
  with recursive nodos(n) as (
    select p_audiencia
    union all
    select h.valor
      from nodos
     cross join lateral jsonb_array_elements(
       case when jsonb_typeof(nodos.n -> 'hijos') = 'array' then nodos.n -> 'hijos' else '[]'::jsonb end
     ) as h(valor)
  )
  select count(*) into v_filas from nodos where nodos.n ->> 'tipo' = 'regla';
  if v_filas > 50 then
    raise exception 'la audiencia admite hasta 50 condiciones (llegaron %)', v_filas using errcode = '23514';
  end if;

  v_predicado := public.difusion_audiencia_predicado(p_audiencia, p_ahora, 1);

  -- Primero la página de ids —sólo con lo que el filtro necesita—, y recién
  -- después, para esas filas, lo que el planificador necesita: el costo de
  -- los datos de salida no crece con el tamaño de la base.
  return query execute format($q$
    with pagina as (
      select l.id
        from public.leads as l
        left join lateral (
          select s.current_stage, s.motivo_perdida, s.vendedor_asignado_id, s.consulta
            from public.lead_session as s
           where s.lead_id = l.id
           order by s.started_at desc, s.id desc
           limit 1
        ) as ls on true
        left join lateral (
          select max(c.ultima_actividad_at) as ultima
            from public.conversaciones as c
           where c.lead_id = l.id
        ) as ua on true
       where (%s)
         and ($2::uuid is null or l.id > $2::uuid)
       order by l.id
       limit $3
    )
    select p.id,
           coalesce(nullif(btrim(l.nombre), ''), nullif(btrim(l.nombre_perfil), ''), ''),
           l.telefono,
           sa.current_stage,
           ue.ultimo,
           coalesce(sal.n, 0)::integer,
           veh.texto
      from pagina as p
      join public.leads as l on l.id = p.id
      left join lateral (
        select s.current_stage
          from public.lead_session as s
         where s.lead_id = p.id and s.resultado is null
         limit 1
      ) as sa on true
      left join lateral (
        select max(x.en) as ultimo
          from public.conversaciones as c
          cross join lateral (
            select m.created_at as en
              from public.mensajes as m
             where m.conversacion_id = c.id and m.direction = 'in'
             order by m.created_at desc
             limit 1
          ) as x
         where c.lead_id = p.id and c.canal = 'wa'
      ) as ue on true
      -- Por conversación y no con un join plano: con el join, el planificador
      -- elegía recorrer todas las salientes recientes de la base una vez por
      -- lead (646.000 sondas para una página de 1.000 en la réplica, ~700 ms).
      -- El lateral lo obliga a ir por (conversacion_id, created_at).
      left join lateral (
        select coalesce(sum(x.n), 0) as n
          from public.conversaciones as c
          cross join lateral (
            select count(*) as n
              from public.mensajes as m
             where m.conversacion_id = c.id
               and m.created_at >= $1 - interval '24 hours'
               and m.direction = 'out'
               and m.sender in ('ia', 'sistema')
          ) as x
         where c.lead_id = p.id
      ) as sal on true
      left join lateral (
        select nullif(concat_ws(' ', v.marca, v.modelo, v.anio::text), '') as texto
          from public.lead_vehiculos as v
         where v.lead_id = p.id
         order by v.principal desc, v.created_at desc
         limit 1
      ) as veh on true
     order by p.id
  $q$, v_predicado)
  using p_ahora, p_despues_de, p_limite;
end;
$$;

comment on function public.difusion_resolver_audiencia(jsonb, timestamptz, uuid, integer) is
  'Leads que coinciden con una audiencia compilada, por paginas keyset de hasta 1000 (p_despues_de = ultimo id de la pagina anterior), con lo que necesita el planificador. SECURITY INVOKER.';

-- =========================================================================
-- 3. Cuánto cupo se usó en las últimas 24 h, según este CRM
-- =========================================================================
-- Meta no expone el uso del límite por API (`SaludWhatsApp.usoDelLimite`).
-- Esto cuenta a quién le salió una plantilla desde acá: por el pipeline
-- (`mensajes` de tipo template por WhatsApp) o por una difusión (envío por
-- plantilla que llegó a Meta). Leads distintos, porque el límite es de
-- destinatarios únicos. El cupo es del portfolio: lo que manden otros
-- sistemas del mismo portfolio no aparece acá, y la pantalla lo dice.
--
-- `estado_at` es cuándo entró al estado actual: un envío leído hoy que salió
-- ayer cuenta como de hoy. Sobrecuenta, que es el error del lado seguro.

create function public.difusion_uso_cupo_24h(p_desde timestamptz)
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select count(*)::integer
    from (
      select c.lead_id
        from public.mensajes as m
        join public.conversaciones as c on c.id = m.conversacion_id
       where m.direction = 'out'
         and m.tipo = 'template'
         and c.canal = 'wa'
         and m.created_at >= p_desde
      union
      select e.lead_id
        from public.difusion_envios as e
       where e.ruta = 'plantilla'
         and e.estado in ('aceptado', 'entregado', 'leido')
         and e.estado_at >= p_desde
         and e.lead_id is not null
    ) as contactados;
$$;

comment on function public.difusion_uso_cupo_24h(timestamptz) is
  'Leads distintos a los que les salio una plantilla desde este CRM desde p_desde. Meta no expone el uso del limite: esto es lo que se sabe localmente.';

-- Parciales: hoy casi ninguna fila cumple la condición, y las dos lecturas de
-- arriba no pueden recorrer `mensajes` ni `difusion_envios` enteras.
create index mensajes_plantillas_salientes_idx
  on public.mensajes (created_at)
  where direction = 'out' and tipo = 'template';

create index difusion_envios_plantillas_salidas_idx
  on public.difusion_envios (estado_at)
  where ruta = 'plantilla' and estado in ('aceptado', 'entregado', 'leido');

-- =========================================================================
-- 4. Lecturas agregadas para el listado y el envío en curso
-- =========================================================================
-- Agregadas en la base por la misma razón que `difusion_envios_conteo`: contar
-- en la app es traer la audiencia entera, y pasar las 1.000 filas es donde
-- PostgREST corta.

-- Una fila por difusión pedida, con sus envíos contados por estado. Hasta
-- 1.000 difusiones por llamada: el resultado nunca puede pasar el corte.
create function public.difusion_envios_resumen(p_difusion_ids uuid[])
returns table (
  difusion_id uuid,
  total       bigint,
  excluidos   bigint,
  en_cola     bigint,
  aceptados   bigint,
  entregados  bigint,
  leidos      bigint,
  fallidos    bigint,
  cancelados  bigint
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if cardinality(p_difusion_ids) > 1000 then
    raise exception 'se piden hasta 1000 difusiones por llamada (llegaron %)', cardinality(p_difusion_ids)
      using errcode = '23514';
  end if;

  return query
  select e.difusion_id,
         count(*),
         count(*) filter (where e.estado = 'excluido'),
         count(*) filter (where e.estado = 'en_cola'),
         count(*) filter (where e.estado = 'aceptado'),
         count(*) filter (where e.estado = 'entregado'),
         count(*) filter (where e.estado = 'leido'),
         count(*) filter (where e.estado = 'fallido'),
         count(*) filter (where e.estado = 'cancelado')
    from public.difusion_envios as e
   where e.difusion_id = any (p_difusion_ids)
   group by e.difusion_id;
end;
$$;

comment on function public.difusion_envios_resumen(uuid[]) is
  'Envios por estado de hasta 1000 difusiones, una fila por difusion. Para el listado.';

-- El reparto persistido: una fila por tanda.
create function public.difusion_envios_tandas(p_difusion_id uuid)
returns table (
  tanda         integer,
  desde         timestamptz,
  total         bigint,
  en_cola       bigint,
  por_plantilla bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select e.tanda,
         min(e.programado_para),
         count(*),
         count(*) filter (where e.estado = 'en_cola'),
         count(*) filter (where e.ruta = 'plantilla')
    from public.difusion_envios as e
   where e.difusion_id = p_difusion_id
     and e.tanda is not null
   group by e.tanda
   order by e.tanda;
$$;

comment on function public.difusion_envios_tandas(uuid) is
  'El plan persistido de una difusion, por tanda: desde cuando sale, cuantos lleva y cuantos siguen en cola.';

-- Los fallidos por código de Meta: "214 fallidos" no decide nada; 131050 y
-- 130429 son problemas opuestos.
create function public.difusion_envios_fallos(p_difusion_id uuid)
returns table (
  error_codigo text,
  cantidad     bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select e.error_codigo, count(*)
    from public.difusion_envios as e
   where e.difusion_id = p_difusion_id
     and e.estado = 'fallido'
   group by e.error_codigo
   order by count(*) desc, e.error_codigo;
$$;

comment on function public.difusion_envios_fallos(uuid) is
  'Envios fallidos de una difusion agrupados por codigo de error de Meta, el mas frecuente primero.';

-- =========================================================================
-- 5. Programar: el plan, el estado y el aviso al motor, en una transacción
-- =========================================================================
-- Si el plan se escribiera por lotes desde la app, un corte a la mitad dejaría
-- media audiencia persistida con la difusión todavía en borrador; el
-- reintento re-planificaría —la audiencia pudo cambiar— y chocaría contra lo
-- ya escrito. Acá es todo o nada: las filas del plan, `programada`, y la fila
-- de `event_outbox` que el cron `dispatch-outbox-events` le reenvía al motor
-- aunque el aviso directo de la app falle.
--
-- SECURITY DEFINER con la autorización en la primera sentencia y
-- `search_path` vacío, mismo patrón que `revert_lead_merge` y
-- `relanzar_workflow_run`: un admin autenticado no tiene INSERT sobre
-- `event_outbox` (sin policies: es del service-role), y abrírselo le daría a la
-- API REST una puerta para encolar eventos arbitrarios. Esta función sólo
-- encola el aviso de la difusión que acaba de programar, armado con lo que
-- escribió, no con lo que manda el llamador.
--
-- Las filas pasan por los mismos CHECK, el trigger de transiciones y el
-- índice único por teléfono que cualquier otra escritura: SECURITY DEFINER
-- saltea RLS, no las garantías de la tabla.
--
-- El payload del evento es el contrato `DifusionProgramadaSchema`
-- (`src/lib/difusion/eventos.ts`): la fecha va como `toISOString()`.

create function public.programar_difusion(
  p_difusion_id     uuid,
  p_programada_para timestamptz,
  p_envios          jsonb,
  -- Null = sin canary. Último y con default para que la app lo omita.
  p_canary_tamano   integer default null
)
returns table (
  audiencia_inicial bigint,
  destinatarios     bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_estado        public.difusion_estado;
  v_audiencia     bigint;
  v_destinatarios bigint;
begin
  if not coalesce(public.is_admin(), false) then
    raise exception 'programar una difusion exige una persona con rol admin' using errcode = '42501';
  end if;
  if p_programada_para is null then
    raise exception 'una difusion programada necesita fecha' using errcode = '23514';
  end if;
  if jsonb_typeof(p_envios) is distinct from 'array' then
    raise exception 'el plan de envio no tiene la forma esperada' using errcode = '23514';
  end if;
  if jsonb_array_length(p_envios) = 0 then
    raise exception 'el plan de envio llego vacio: no hay a quien mandarle' using errcode = '23514';
  end if;

  select d.estado into v_estado
    from public.difusiones as d
   where d.id = p_difusion_id
     for update;
  if not found then
    raise exception 'no hay una difusion con id %', p_difusion_id using errcode = 'P0002';
  end if;
  -- 23505 y no 23514: dos confirmaciones simultáneas son una carrera; la
  -- segunda relee y encuentra la difusión ya programada.
  if v_estado <> 'borrador' then
    raise exception 'la difusion % ya esta %: se programa una sola vez', p_difusion_id, v_estado
      using errcode = '23505';
  end if;
  if exists (select 1 from public.difusion_envios as e where e.difusion_id = p_difusion_id) then
    raise exception 'la difusion % ya tiene un plan escrito', p_difusion_id using errcode = '23505';
  end if;

  -- `difusion_id` sale del parámetro y no de cada fila: el plan no puede
  -- escribirle a otra difusión.
  insert into public.difusion_envios (
    difusion_id, lead_id, telefono, estado, motivo_exclusion, ruta, tanda, programado_para
  )
  select p_difusion_id, x.lead_id, x.telefono, x.estado, x.motivo_exclusion, x.ruta, x.tanda, x.programado_para
    from jsonb_to_recordset(p_envios) as x(
      lead_id          uuid,
      telefono         text,
      estado           public.difusion_envio_estado,
      motivo_exclusion public.difusion_motivo_exclusion,
      ruta             public.difusion_ruta,
      tanda            integer,
      programado_para  timestamptz
    );

  select count(*), count(*) filter (where e.estado <> 'excluido')
    into v_audiencia, v_destinatarios
    from public.difusion_envios as e
   where e.difusion_id = p_difusion_id;

  update public.difusiones
     set estado = 'programada',
         programada_para = p_programada_para,
         canary_tamano = p_canary_tamano
   where id = p_difusion_id;

  insert into public.event_outbox (event_name, event_data, event_id)
  values (
    'difusion/programada',
    jsonb_build_object(
      'difusionId', p_difusion_id,
      'programadaPara', to_char(p_programada_para at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'audienciaInicial', v_audiencia,
      'destinatarios', v_destinatarios
    ),
    'difusion-programada:' || p_difusion_id::text
  );

  return query select v_audiencia, v_destinatarios;
end;
$$;

comment on function public.programar_difusion(uuid, timestamptz, jsonb, integer) is
  'Borrador -> programada en una transaccion: escribe el plan, cambia el estado y encola difusion/programada en event_outbox. SECURITY DEFINER porque authenticated no escribe event_outbox; autoriza con is_admin() en la primera sentencia.';

-- =========================================================================
-- 6. Permisos
-- =========================================================================
-- Los privilegios por defecto del schema (20260816042039) le dan EXECUTE a
-- anon sobre toda función nueva. Se recortan explícitamente.

revoke all on function public.difusion_audiencia_regla(jsonb, timestamptz) from public, anon;
grant execute on function public.difusion_audiencia_regla(jsonb, timestamptz) to authenticated, service_role;

revoke all on function public.difusion_audiencia_predicado(jsonb, timestamptz, integer) from public, anon;
grant execute on function public.difusion_audiencia_predicado(jsonb, timestamptz, integer) to authenticated, service_role;

revoke all on function public.difusion_resolver_audiencia(jsonb, timestamptz, uuid, integer) from public, anon;
grant execute on function public.difusion_resolver_audiencia(jsonb, timestamptz, uuid, integer) to authenticated, service_role;

revoke all on function public.difusion_uso_cupo_24h(timestamptz) from public, anon;
grant execute on function public.difusion_uso_cupo_24h(timestamptz) to authenticated, service_role;

revoke all on function public.difusion_envios_resumen(uuid[]) from public, anon;
grant execute on function public.difusion_envios_resumen(uuid[]) to authenticated, service_role;

revoke all on function public.difusion_envios_tandas(uuid) from public, anon;
grant execute on function public.difusion_envios_tandas(uuid) to authenticated, service_role;

revoke all on function public.difusion_envios_fallos(uuid) from public, anon;
grant execute on function public.difusion_envios_fallos(uuid) to authenticated, service_role;

revoke all on function public.programar_difusion(uuid, timestamptz, jsonb, integer) from public, anon;
grant execute on function public.programar_difusion(uuid, timestamptz, jsonb, integer) to authenticated, service_role;
