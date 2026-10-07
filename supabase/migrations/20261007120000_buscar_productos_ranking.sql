-- `buscar_productos` ordena por cuanto confirma el vehiculo, no solo por texto.
--
-- OBSERVACION
--
-- Un cliente pidio "un termostato para el Accent 1.6" y despues dijo "2006". La
-- herramienta devolvio 20 filas y las coincidencias exactas (`HY ACC 1.6 06-
-- CVVT COMPL`, `BASE TERMOST`, `TAPA`) estaban en las posiciones 12 a 20. Arriba
-- iban `CH TAX ORING CARCASA TERMOSTATO` (un Chevrolet), las bases del Accent
-- 1.4 y las del Chevrolet Corsa. El agente cotizo con lo que tenia arriba.
--
-- CAUSA RAIZ
--
-- 20261005120100 ya filtra por vehiculo, pero el orden seguia siendo el del
-- puntaje de texto: `termostato` puntua igual en una fila que declara el
-- vehiculo, en una sin compatibilidad cargada ("no sabemos") y en una que solo
-- entra por una variante (`HY ACC 1.4 06- VER 03-` entra para un 1.6 por el
-- elemento `VER`, que no declara cilindrada, aunque el `ACC` del mismo producto
-- diga 1.4). Con un empate de puntaje el desempate es la existencia y despues el
-- nombre, que no dicen nada del vehiculo.
--
-- FIX
--
-- 1. `resolver_modelos` suma `exacto`: es verdadero para el modelo que el
--    cliente nombro y falso para el que solo entro por prefijo ("Accent" tambien
--    trae "Accent Verna", que es otra variante). Si nadie coincide por
--    igualdad ("Tucson" y sus generaciones) todos valen verdadero.
-- 2. `buscar_productos` calcula un `nivel_vehiculo` por producto y ordena por
--    (codigo exacto, nivel, puntaje, existencia, nombre). El nivel es:
--
--      +4  un elemento sirve y es el modelo exacto
--      +2  ... y declara la cilindrada pedida (solo si se pidio cilindrada)
--      +1  ... y declara algun limite de anio (solo si se pidio anio)
--      se toma el mejor elemento que sirve: 0..7
--      -1  sin compatibilidad cargada ("no sabemos"): entra, pero despues de
--          todo lo que SI confirma el vehiculo
--      -2  declara el modelo exacto pero en otro anio o cilindrada, y solo entra
--          por una variante: al final, debajo de "no sabemos"
--       0  si no se pidio ningun dato de vehiculo
--
--    Ninguna fila se descarta por esto: el filtro por vehiculo no cambia, solo el
--    orden. `nivel_vehiculo` se devuelve para que el servicio decida que
--    candidatos comparan entre si al armar `diferencias`.
--
-- Espeja `evaluarCompatibilidad` en `src/lib/catalogo/compatibilidad.ts`; los dos
-- se prueban con las mismas filas (`tests/helpers/catalogo-ranking-fixtures.ts`).
--
-- ESTRUCTURA Y RENDIMIENTO
--
-- Los cuatro escaneos del UNION no se tocan (ver 20260826010000). El nivel sale
-- de la misma agregacion set-based (`sirven`) que ya decidia los elementos: se
-- agregan tres agregados mas sobre las mismas filas y el filtro de elementos
-- pasa del WHERE a un FILTER, para ver tambien los que NO sirven (hacen falta
-- para el -2). No hay una pasada nueva sobre la tabla.

-- =========================================================================
-- 1. resolver_modelos
-- =========================================================================

drop function if exists public.buscar_productos(text, text, text, integer, integer, text);
drop function if exists public.resolver_modelos(text, text);

create function public.resolver_modelos(
  p_marca text,
  p_modelo text
)
returns table (marca text, sigla text, nombre text, exacto boolean)
language sql
stable
security invoker
set search_path = ''
as $function$
  with n as (
    select
      public.plegar_texto(btrim(coalesce(p_modelo, ''))) as m,
      public.plegar_texto(btrim(coalesce(p_marca, ''))) as k
  ),
  -- El nombre real de cada modelo activo de dos maneras: sin su marca
  -- (`nombre_clave`) y sin su primera palabra. La segunda existe para los
  -- modelos catalogados bajo una marca y llamados con otra: "Chevrolet Vitara"
  -- vive bajo SUZUKI, asi que `nombre_clave` ("chevrolet vitara") no sirve para
  -- el cliente que dice "Vitara".
  nombres as (
    select
      c.*,
      public.plegar_texto(c.nombre_real) as nombre,
      substr(
        public.plegar_texto(c.nombre_real),
        strpos(public.plegar_texto(c.nombre_real), ' ') + 1
      ) as resto
    from public.catalogo_modelos as c
    where c.activo
  ),
  coincidencias as (
    select
      public.plegar_texto(c.marca) as marca,
      public.plegar_texto(c.sigla_modelo) as sigla,
      c.nombre as nombre,
      m.igual
    from nombres as c
    cross join n
    cross join lateral (
      select
        -- El cliente nombro exactamente este modelo.
        (
          public.plegar_texto(c.sigla_modelo) = n.m
          or c.nombre = n.m
          or c.nombre_clave = n.m
          or c.resto = n.m
          or exists (
            select 1 from unnest(c.alias) as a where public.plegar_texto(a) = n.m
          )
        ) as igual,
        -- "tucson" sirve para "tucson 1a gen (jm)" y para "tucson ix / ix35 (lm)":
        -- el cliente no sabe de generaciones y el anio las separa despues.
        -- `left` en vez de `like` para que un `%` o `_` escrito por el cliente no
        -- se interprete como comodin.
        (
          left(c.nombre_clave, length(n.m) + 1) = n.m || ' '
          or left(c.resto, length(n.m) + 1) = n.m || ' '
        ) as prefijo
    ) as m
    where n.m <> ''
      -- La marca puede ser la del diccionario o la que lleva el nombre real.
      and (
        n.k = ''
        or public.plegar_texto(c.marca) = n.k
        or left(c.nombre, length(n.k) + 1) = n.k || ' '
      )
      and (m.igual or m.prefijo)
  ),
  unicos as (
    select marca, sigla, nombre, bool_or(igual) as igual
    from coincidencias
    group by marca, sigla, nombre
  )
  -- Si nadie coincide por igualdad, lo que entro por prefijo ES lo que se pidio.
  select marca, sigla, nombre, (igual or not bool_or(igual) over ()) as exacto
  from unicos
$function$;

revoke all on function public.resolver_modelos(text, text) from public;
revoke all on function public.resolver_modelos(text, text) from anon;
grant execute on function public.resolver_modelos(text, text) to authenticated;
grant execute on function public.resolver_modelos(text, text) to service_role;

comment on function public.resolver_modelos(text, text) is
  'Traduce marca/modelo dichos por el cliente a (marca, sigla, nombre, exacto) plegados del inventario, usando los modelos activos de catalogo_modelos. exacto = el cliente nombro ese modelo y no una variante que entro por prefijo. Vacio si no resuelve.';

-- =========================================================================
-- 2. buscar_productos
-- =========================================================================

create function public.buscar_productos(
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
      (select count(*)::int from palabras) as total_palabras
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
  -- manda cuanto confirma el vehiculo, y recien ahi el texto y la existencia.
  order by (exacto > 0) desc, nivel desc, puntaje desc, stock desc, nombre asc
  limit greatest(1, least(coalesce(p_tope, 20), 50))
$function$;

revoke all on function public.buscar_productos(text, text, text, integer, integer, text) from public;
revoke all on function public.buscar_productos(text, text, text, integer, integer, text) from anon;
grant execute on function public.buscar_productos(text, text, text, integer, integer, text) to authenticated;
grant execute on function public.buscar_productos(text, text, text, integer, integer, text) to service_role;

comment on function public.buscar_productos(text, text, text, integer, integer, text) is
  'Busqueda del catalogo por codigo de fabrica, codigo interno, alternos y texto, con filtro de vehiculo (marca, modelo resuelto por catalogo_modelos, anio, cilindrada) sobre productos.compatibilidad. Ordena por codigo exacto, nivel_vehiculo (cuanto confirma el vehiculo: 7..0, -1 sin compatibilidad, -2 contradice), puntaje, existencia y nombre. Devuelve en `compatibilidad` solo los elementos que justifican el match. Los candidatos salen de un UNION y no de un OR para no caer a seq scan.';
