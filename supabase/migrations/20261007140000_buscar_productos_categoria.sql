-- `buscar_productos` ordena por cuanto se parece la CATEGORIA a la pieza pedida.
--
-- OBSERVACION
--
-- "Necesito una bomba de agua para el Rio 18" ofrecio como piezas los manguitos
-- del radiador (MANG RADIADOR, MANG PASO AGUA) y la bomba de combustible (BOMBA
-- COMPLETA COMBUST INYEC), y despues de que el cliente eligio "la bomba de agua
-- completa" el agente volvio a preguntar.
--
-- CAUSA RAIZ
--
-- El texto de la consulta puntua con CUALQUIER palabra: `agua` entra por `MANG
-- PASO AGUA`, `bomba` y `completa` por `BOMBA COMPLETA COMBUST INYEC`. Con el
-- orden por (codigo, nivel de vehiculo, puntaje) esas filas, que declaran el
-- Rio exacto, podian ganarle a la `BOMBA DE AGUA` y ocupar los 20 lugares que
-- ve el agente.
--
-- FIX
--
-- Se agrega `nivel_cat` al orden, entre el codigo exacto y el nivel de vehiculo:
--
--   2  la categoria contiene TODAS las palabras que dicen que pieza es (o no hay
--      con que comparar: una sola palabra util, o sin categoria)
--   1  comparte alguna
--   0  no comparte ninguna (el producto entro por el nombre)
--
-- Las palabras que dicen que pieza es son las de la consulta sin relleno, sin
-- calificadores de conjunto (completa, completo, conjunto, kit, original, armado:
-- se resuelven con la logica de subpiezas del servicio, no contra el texto de la
-- categoria) y sin las palabras de la marca y el modelo pedidos.
--
-- No se descarta ninguna fila aca: el servicio (`filtrarPorCategoria`) decide que
-- se ofrece. Espeja `nivelDeCategoria` en `src/lib/catalogo/categoria.ts` (el 3
-- de ese archivo, "la categoria ES lo pedido", solo existe en TypeScript).
--
-- ESTRUCTURA Y RENDIMIENTO
--
-- Los cuatro escaneos del UNION no se tocan (ver 20260826010000). El nivel se
-- calcula sobre los candidatos ya reducidos, con el mismo patron de subselect
-- sobre `palabras` que ya usan `suma` y `aciertos`.

create or replace function public.buscar_productos(
  p_q text,
  p_marca text default null,
  p_modelo text default null,
  p_anio integer default null,
  p_tope integer default 20,
  p_cilindrada text default null
)
returns table (
  id uuid,
  codigo_interno text,
  codigo_fabrica text,
  nombre text,
  categoria text,
  descripcion text,
  precio numeric,
  stock integer,
  puntaje integer,
  compatibilidad jsonb,
  nivel_vehiculo integer
)
language sql
stable
security invoker
set search_path = ''
as $function$
  with consulta as (
    select
      public.plegar_texto(btrim(coalesce(p_q, ''))) as q,
      public.plegar_codigo(coalesce(p_q, '')) as cod
  ),
  palabras as (
    select distinct t as palabra
    from consulta, unnest(regexp_split_to_array(consulta.q, '[^0-9a-z/.*-]+')) as t
    where length(t) > 1
      and t not in (
        'de','del','la','el','los','las','un','una','para','con','y','o','mi',
        'me','por','que','tiene','tienen','tenes','tienes','hay','busco',
        'necesito','quiero','precio','cuanto','cuesta'
      )
  ),
  -- Lo que pidio el cliente sobre el vehiculo, ya normalizado. "" cuenta como
  -- "no lo dijo".
  vehiculo as (
    select
      nullif(public.plegar_texto(btrim(coalesce(p_marca, ''))), '') as marca,
      nullif(public.plegar_texto(btrim(coalesce(p_modelo, ''))), '') as modelo,
      p_anio as anio,
      nullif(
        regexp_replace(replace(btrim(coalesce(p_cilindrada, '')), ',', '.'), '[^0-9.]', '', 'g'),
        ''
      ) as cilindrada
  ),
  -- Las palabras que dicen QUE PIEZA es: sin calificadores de conjunto ni las
  -- palabras del vehiculo pedido. Contra estas se compara la categoria.
  palabras_clave as (
    select w.palabra
    from palabras as w
    where w.palabra not in (
        'completa','completo','completas','completos','conjunto','armado','armada',
        'kit','original','originales'
      )
      and not exists (
        select 1
        from vehiculo as v,
          unnest(
            regexp_split_to_array(
              coalesce(v.marca, '') || ' ' || coalesce(v.modelo, ''), '[^0-9a-z/.*-]+'
            )
          ) as t
        where t = w.palabra
      )
  ),
  -- Lo que corresponde al modelo del cliente en el diccionario.
  resueltos as materialized (
    select r.marca, r.sigla, r.nombre, r.exacto from public.resolver_modelos(p_marca, p_modelo) as r
  ),
  filtro as (
    select
      v.*,
      (v.marca is null and v.modelo is null and v.anio is null and v.cilindrada is null)
        as sin_filtros,
      exists (select 1 from resueltos) as modelo_resuelto,
      coalesce((select array_agg(r.marca || '|' || r.sigla) from resueltos as r), '{}') as claves,
      coalesce((select array_agg(r.marca || '|' || r.nombre) from resueltos as r), '{}') as nombres,
      coalesce((select array_agg(distinct r.marca) from resueltos as r), '{}') as marcas,
      -- Solo los que el cliente nombro: los demas entraron por prefijo (variantes).
      coalesce(
        (select array_agg(r.marca || '|' || r.sigla) from resueltos as r where r.exacto), '{}'
      ) as claves_exactas,
      coalesce(
        (select array_agg(r.marca || '|' || r.nombre) from resueltos as r where r.exacto), '{}'
      ) as nombres_exactos
    from vehiculo as v
  ),
  /*
   * Cuatro escaneos independientes en vez de un OR.
   *
   * Es LA diferencia de 20260826010000. Cada rama elige su plan: las tres de
   * codigo entran por indice, la del texto recorre la tabla pero sin arrastrar
   * a las otras. Volver a juntarlas en un OR devuelve el nested loop.
   */
  ids as (
    select p.id from public.productos as p, consulta as c
      where p.activo and c.cod <> '' and p.codigo_fabrica_plegado = c.cod
    union
    select p.id from public.productos as p, consulta as c
      where p.activo and c.cod <> '' and p.codigo_interno_plegado = c.cod
    union
    select p.id from public.productos as p, consulta as c
      where p.activo and c.cod <> '' and public.plegar_codigos(p.otros_codigos) @> array[c.cod]
    union
    select p.id from public.productos as p
      where p.activo
        and exists (select 1 from palabras as w where p.busqueda like '%' || w.palabra || '%')
  ),
  -- Los candidatos del UNION, una vez. Se materializa porque se lee dos veces:
  -- para decidir que elementos de compatibilidad sirven y para armar el resultado.
  base as materialized (
    select p.*
    from public.productos as p
    join ids on ids.id = p.id
  ),
  /*
   * Los elementos de `compatibilidad` que sirven para el vehiculo pedido, y que
   * tan bien lo confirman, agrupados por producto. Es el unico lugar donde se
   * decide si un elemento sirve.
   *
   * Es una agregacion SET-BASED a proposito. Evaluar el mismo predicado fila por
   * fila —con una funcion, o con un LATERAL/subselect por candidato— costaba
   * entre 2 y 20 veces mas sobre 21.000 filas sinteticas (ver el EXPLAIN ANALYZE
   * del informe de 20261005120100): cada llamada paga el arranque del ejecutor.
   * Tampoco se llama a `plegar_texto()` por elemento: es una funcion SQL con
   * `set search_path` y no se inlinea; se pliega con el mismo
   * `translate(lower(..))` inline.
   *
   * Los elementos que NO sirven tambien se leen (no hay WHERE sobre `sirve`):
   * `hay_exacto_que_no_sirve` los necesita para el nivel -2. Lo que sirve se
   * filtra en cada agregado.
   */
  sirven as (
    select
      b.id,
      jsonb_agg(k.e) filter (where v.sirve) as elementos,
      -- 0..7 sobre el mejor elemento que sirve. Ver el encabezado.
      max(
        case when v.sirve then
          (case when v.exacto then 4 else 0 end)
          + (case
               when f.cilindrada is not null and nullif(k.e->>'cilindrada', '') is not null
               then 2 else 0
             end)
          + (case
               when f.anio is not null
                 and (nullif(k.e->>'anio_desde', '') is not null
                      or nullif(k.e->>'anio_hasta', '') is not null)
               then 1 else 0
             end)
        end
      ) as nivel,
      coalesce(bool_or(v.sirve and v.exacto), false) as hay_exacto_que_sirve,
      coalesce(bool_or(v.exacto and not v.sirve), false) as hay_exacto_que_no_sirve
    from base as b
    cross join filtro as f
    cross join lateral jsonb_array_elements(coalesce(b.compatibilidad, '[]'::jsonb)) as k(e)
    cross join lateral (
      select
        translate(lower(k.e->>'marca'), 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunaeiouun') as ma,
        translate(lower(k.e->>'modelo'), 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunaeiouun') as mo,
        translate(lower(k.e->>'modelo_nombre'), 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunaeiouun') as mn
    ) as x
    cross join lateral (
      select
        -- Marca y modelo coinciden con lo pedido (sin mirar anio ni cilindrada).
        coalesce(
          case
            when f.modelo is null then
              (f.marca is null or x.ma = f.marca)
            when f.modelo_resuelto then
              (x.ma || '|' || x.mo) = any (f.claves)
              or (x.ma || '|' || x.mn) = any (f.nombres)
              -- `MARCA TODOS` del inventario: sirve para cualquier modelo de la marca.
              or (x.mo = 'todos' and x.ma = any (f.marcas))
            else
              (f.marca is null or x.ma = f.marca)
              and (
                x.mo = f.modelo
                or x.mn = f.modelo
                or (f.marca is not null and x.mo = 'todos')
                or strpos(b.busqueda, f.modelo) > 0
              )
          end,
          false
        ) as vehiculo_ok,
        -- ... y ademas es el modelo que nombro el cliente, no una variante ni TODOS.
        coalesce(
          case
            when f.modelo is null then
              (f.marca is null or x.ma = f.marca)
            when f.modelo_resuelto then
              (x.ma || '|' || x.mo) = any (f.claves_exactas)
              or (x.ma || '|' || x.mn) = any (f.nombres_exactos)
            else
              (f.marca is null or x.ma = f.marca)
              and (x.mo = f.modelo or x.mn = f.modelo)
          end,
          false
        ) as exacto
    ) as m
    cross join lateral (
      select
        m.vehiculo_ok
        and (
          f.anio is null
          or (
            (nullif(k.e->>'anio_desde', '') is null or f.anio >= (k.e->>'anio_desde')::int)
            and (nullif(k.e->>'anio_hasta', '') is null or f.anio <= (k.e->>'anio_hasta')::int)
          )
        )
        and (
          f.cilindrada is null
          or nullif(k.e->>'cilindrada', '') is null
          or k.e->>'cilindrada' = f.cilindrada
        ) as sirve,
        m.exacto
    ) as v
    where not f.sin_filtros
    group by b.id
  ),
  candidatos as (
    select
      b.*,
      case
        when f.sin_filtros then coalesce(b.compatibilidad, '[]'::jsonb)
        else coalesce(s.elementos, '[]'::jsonb)
      end as elementos,
      case
        when f.sin_filtros then 0
        -- Sin compatibilidad cargada: "no sabemos", despues de lo que si confirma.
        when jsonb_array_length(coalesce(b.compatibilidad, '[]'::jsonb)) = 0 then -1
        -- Declara el modelo pedido pero en otro anio o cilindrada y solo entra por
        -- una variante: al final.
        when not s.hay_exacto_que_sirve and s.hay_exacto_que_no_sirve then -2
        else s.nivel
      end as nivel
    from base as b
    cross join filtro as f
    left join sirven as s on s.id = b.id
    where
      -- `compatibilidad` vacia significa "no sabemos", no "no sirve": el export
      -- de inventario no trae esa columna y el vehiculo va escrito adentro del
      -- nombre. Filtrar por ahi escondia el catalogo entero apenas el agente
      -- mencionaba una marca.
      f.sin_filtros
      or jsonb_array_length(coalesce(b.compatibilidad, '[]'::jsonb)) = 0
      or s.elementos is not null
  ),
  puntuados as (
    select
      c.id, c.codigo_interno, c.codigo_fabrica, c.nombre, c.categoria,
      c.descripcion, c.precio, c.stock, c.elementos, c.nivel,
      case
        when q.cod <> '' and c.codigo_fabrica_plegado = q.cod then 1000
        when q.cod <> '' and c.codigo_interno_plegado = q.cod then 900
        when q.cod <> '' and public.plegar_codigos(c.otros_codigos) @> array[q.cod] then 700
        else 0
      end as exacto,
      coalesce((
        select sum(
          case
            when public.plegar_texto(c.codigo_interno) like '%' || w.palabra || '%' then 10
            when public.plegar_texto(coalesce(c.categoria, '')) = w.palabra then 9
            when public.plegar_texto(c.nombre) like '%' || w.palabra || '%' then 8
            when public.plegar_texto(coalesce(c.categoria, '')) like '%' || w.palabra || '%' then 6
            when public.plegar_texto(coalesce(c.descripcion, '')) like '%' || w.palabra || '%' then 3
            else 0
          end
        )::int
        from palabras as w
      ), 0) as suma,
      coalesce((
        select count(*)::int from palabras as w
        where c.busqueda like '%' || w.palabra || '%'
      ), 0) as aciertos,
      (select count(*)::int from palabras) as total_palabras,
      coalesce((
        select count(*)::int from palabras_clave as k
        where public.plegar_texto(coalesce(c.categoria, '')) like '%' || k.palabra || '%'
      ), 0) as cat_aciertos,
      (select count(*)::int from palabras_clave) as cat_total
    from candidatos as c, consulta as q
  )
  select
    id, codigo_interno, codigo_fabrica, nombre, categoria, descripcion, precio, stock,
    (exacto + case
       when total_palabras > 0 and aciertos = total_palabras then suma * 2
       else suma
     end) as puntaje,
    elementos as compatibilidad,
    nivel as nivel_vehiculo
  from puntuados
  where exacto > 0 or suma > 0
  -- Quien dicta un codigo lo encuentra primero, sea cual sea su vehiculo; despues
  -- que la categoria sea la pieza pedida y no una que comparte una palabra, luego
  -- cuanto confirma el vehiculo, y recien ahi el texto y la existencia.
  order by
    (exacto > 0) desc,
    (case
       when cat_total < 2 or btrim(coalesce(categoria, '')) = '' then 2
       when cat_aciertos = cat_total then 2
       when cat_aciertos > 0 then 1
       else 0
     end) desc,
    nivel desc, puntaje desc, stock desc, nombre asc
  limit greatest(1, least(coalesce(p_tope, 20), 50))
$function$;

revoke all on function public.buscar_productos(text, text, text, integer, integer, text) from public;
revoke all on function public.buscar_productos(text, text, text, integer, integer, text) from anon;
grant execute on function public.buscar_productos(text, text, text, integer, integer, text) to authenticated;
grant execute on function public.buscar_productos(text, text, text, integer, integer, text) to service_role;

comment on function public.buscar_productos(text, text, text, integer, integer, text) is
  'Busqueda del catalogo por codigo de fabrica, codigo interno, alternos y texto, con filtro de vehiculo (marca, modelo resuelto por catalogo_modelos, anio, cilindrada) sobre productos.compatibilidad. Ordena por codigo exacto, parecido de la categoria con la pieza pedida (2 la contiene, 1 comparte alguna palabra, 0 ninguna), nivel_vehiculo (cuanto confirma el vehiculo: 7..0, -1 sin compatibilidad, -2 contradice), puntaje, existencia y nombre. Devuelve en `compatibilidad` solo los elementos que justifican el match. Los candidatos salen de un UNION y no de un OR para no caer a seq scan.';
