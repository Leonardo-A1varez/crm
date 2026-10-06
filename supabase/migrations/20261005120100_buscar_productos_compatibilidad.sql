-- `buscar_productos` aprende a filtrar por vehiculo de verdad.
--
-- OBSERVACION
--
-- Los filtros marca/modelo/anio de `buscar_productos` miran solo
-- `productos.compatibilidad`, y esa columna esta vacia en todo el catalogo. Una
-- fila con `compatibilidad` vacia significa "no sabemos" y pasa siempre, asi que
-- el filtro por vehiculo no filtraba nada: "radiador para un Accent 2012"
-- devolvia radiadores de cualquier auto.
--
-- CAUSA RAIZ
--
-- El inventario trae el vehiculo escrito en el nombre con siglas de la casa
-- (`HY ACC 06- 1.4`) y nunca se convirtio a datos. El traductor que llena
-- `compatibilidad` guarda elementos
--
--   {marca: "Hyundai", modelo: "ACC", modelo_nombre: "Hyundai Accent",
--    anio_desde, anio_hasta, cilindrada, combustible}
--
-- con el modelo en sigla (`modelo_nombre` es el nombre unificado del
-- diccionario: PIC, PICANT y PICANTO son todos "Kia Picanto"). El cliente dice
-- "Accent", nunca "ACC", asi que comparar el texto del cliente contra
-- `compatibilidad[].modelo` tampoco sirve.
--
-- FIX
--
-- 1. `resolver_modelos(marca, modelo)` traduce lo que dijo el cliente a
--    (marca, sigla, nombre) usando `catalogo_modelos`: por la sigla misma, el
--    nombre real con o sin la marca, o un alias. Solo mira modelos activos. Un
--    modelo con varias siglas devuelve todas.
-- 2. `buscar_productos` suma `p_cilindrada`, filtra por lo resuelto y por el
--    anio, y devuelve `compatibilidad` con SOLO los elementos que justifican el
--    match. Asi el agente puede ver en que se diferencian los candidatos (anio,
--    cilindrada, combustible) y preguntar solo eso.
--
-- REGLAS (las que ya tenia, mas las nuevas)
--
-- * `compatibilidad` vacia sigue siendo "no sabemos": la fila entra.
-- * Un dato que falta dentro de un elemento tambien es "no sabemos": un
--   `anio_desde` nulo es "desde siempre", un `anio_hasta` nulo es "hasta hoy" y
--   una `cilindrada` nula sirve para cualquiera.
-- * `modelo: "TODOS"` (`MARCA TODOS` en el inventario) sirve para cualquier
--   modelo de esa marca.
-- * Si el modelo no resuelve a ninguna sigla (no esta en el diccionario, o esta
--   con confianza media/baja sin confirmar) NO se descartan filas por eso: se
--   compara el texto literal contra la sigla, el `modelo_nombre` o el texto del
--   producto.
-- * Si el modelo si resuelve, lo resuelto manda (marca y sigla, o marca y
--   `modelo_nombre`) y la marca suelta ya no se compara: el diccionario sabe que
--   una Vitara catalogada bajo SUZUKI tambien se pide como "Chevrolet Vitara".
--
-- ESTRUCTURA Y RENDIMIENTO
--
-- Los cuatro escaneos independientes del UNION no se tocan (ver
-- 20260826010000: un OR con una rama no indexable arrastra a las demas a
-- seq scan). El filtro de vehiculo se aplica despues, sobre los candidatos que
-- ya salieron del UNION, igual que antes. El puntaje no cambia: lo espeja
-- `src/lib/catalogo/puntaje.ts`.
--
-- Los elementos de `compatibilidad` que sirven se deciden con una agregacion
-- set-based (CTE `sirven`), no con una funcion o subconsulta por candidato: ver
-- el comentario ahi.

-- =========================================================================
-- 1. resolver_modelos
-- =========================================================================

-- Cambia el tipo de retorno respecto de una version anterior de esta misma
-- migracion que nunca salio de desarrollo; `create or replace` no puede
-- cambiarlo, asi que se tira primero.
drop function if exists public.resolver_modelos(text, text);

create function public.resolver_modelos(
  p_marca text,
  p_modelo text
)
returns table (marca text, sigla text, nombre text)
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
  )
  select distinct
    public.plegar_texto(c.marca) as marca,
    public.plegar_texto(c.sigla_modelo) as sigla,
    c.nombre as nombre
  from nombres as c, n
  where n.m <> ''
    -- La marca puede ser la del diccionario o la que lleva el nombre real.
    and (
      n.k = ''
      or public.plegar_texto(c.marca) = n.k
      or left(c.nombre, length(n.k) + 1) = n.k || ' '
    )
    and (
      public.plegar_texto(c.sigla_modelo) = n.m
      or c.nombre = n.m
      or c.nombre_clave = n.m
      or c.resto = n.m
      -- "tucson" sirve para "tucson 1a gen (jm)" y para "tucson ix / ix35 (lm)":
      -- el cliente no sabe de generaciones y el anio las separa despues.
      -- `left` en vez de `like` para que un `%` o `_` escrito por el cliente no
      -- se interprete como comodin.
      or left(c.nombre_clave, length(n.m) + 1) = n.m || ' '
      or left(c.resto, length(n.m) + 1) = n.m || ' '
      or exists (
        select 1 from unnest(c.alias) as a where public.plegar_texto(a) = n.m
      )
    )
$function$;

revoke all on function public.resolver_modelos(text, text) from public;
revoke all on function public.resolver_modelos(text, text) from anon;
grant execute on function public.resolver_modelos(text, text) to authenticated;
grant execute on function public.resolver_modelos(text, text) to service_role;

comment on function public.resolver_modelos(text, text) is
  'Traduce marca/modelo dichos por el cliente a (marca, sigla, nombre) plegados del inventario, usando los modelos activos de catalogo_modelos. Vacio si no resuelve.';

-- =========================================================================
-- 2. buscar_productos
-- =========================================================================

-- Cambia el tipo de retorno (suma `compatibilidad`) y los parametros (suma
-- `p_cilindrada`): hay que tirarla. Dejar la de cinco parametros haria que
-- PostgREST no pueda elegir entre las dos con los mismos nombres de argumento.
drop function if exists public.buscar_productos(text, text, text, integer, integer);

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
  compatibilidad jsonb
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
    select r.marca, r.sigla, r.nombre from public.resolver_modelos(p_marca, p_modelo) as r
  ),
  filtro as (
    select
      v.*,
      (v.marca is null and v.modelo is null and v.anio is null and v.cilindrada is null)
        as sin_filtros,
      exists (select 1 from resueltos) as modelo_resuelto,
      coalesce((select array_agg(r.marca || '|' || r.sigla) from resueltos as r), '{}') as claves,
      coalesce((select array_agg(r.marca || '|' || r.nombre) from resueltos as r), '{}') as nombres,
      coalesce((select array_agg(distinct r.marca) from resueltos as r), '{}') as marcas
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
   * Los elementos de `compatibilidad` que sirven para el vehiculo pedido,
   * agrupados por producto. Es el unico lugar donde se decide si un elemento sirve.
   *
   * Es una agregacion SET-BASED a proposito. Evaluar el mismo predicado fila por
   * fila —con una funcion, o con un LATERAL/subselect por candidato— costaba
   * entre 2 y 20 veces mas sobre 21.000 filas sinteticas (ver el EXPLAIN ANALYZE
   * del informe de esta migracion): cada llamada paga el arranque del ejecutor.
   * Tampoco se llama a `plegar_texto()` por elemento: es una funcion SQL con
   * `set search_path` y no se inlinea; se pliega con el mismo
   * `translate(lower(..))` inline.
   */
  sirven as (
    select b.id, jsonb_agg(k.e) as elementos
    from base as b
    cross join filtro as f
    cross join lateral jsonb_array_elements(coalesce(b.compatibilidad, '[]'::jsonb)) as k(e)
    cross join lateral (
      select
        translate(lower(k.e->>'marca'), 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunaeiouun') as ma,
        translate(lower(k.e->>'modelo'), 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunaeiouun') as mo,
        translate(lower(k.e->>'modelo_nombre'), 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunaeiouun') as mn
    ) as x
    where not f.sin_filtros
      and (
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
        end
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
        )
      )
    group by b.id
  ),
  candidatos as (
    select
      b.*,
      case
        when f.sin_filtros then coalesce(b.compatibilidad, '[]'::jsonb)
        else coalesce(s.elementos, '[]'::jsonb)
      end as elementos
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
      or s.id is not null
  ),
  puntuados as (
    select
      c.id, c.codigo_interno, c.codigo_fabrica, c.nombre, c.categoria,
      c.descripcion, c.precio, c.stock, c.elementos,
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
    elementos as compatibilidad
  from puntuados
  where exacto > 0 or suma > 0
  order by puntaje desc, stock desc, nombre asc
  limit greatest(1, least(coalesce(p_tope, 20), 50))
$function$;

revoke all on function public.buscar_productos(text, text, text, integer, integer, text) from public;
revoke all on function public.buscar_productos(text, text, text, integer, integer, text) from anon;
grant execute on function public.buscar_productos(text, text, text, integer, integer, text) to authenticated;
grant execute on function public.buscar_productos(text, text, text, integer, integer, text) to service_role;

comment on function public.buscar_productos(text, text, text, integer, integer, text) is
  'Busqueda del catalogo por codigo de fabrica, codigo interno, alternos y texto, con filtro de vehiculo (marca, modelo resuelto por catalogo_modelos, anio, cilindrada) sobre productos.compatibilidad. Devuelve en `compatibilidad` solo los elementos que justifican el match. Los candidatos salen de un UNION y no de un OR para no caer a seq scan.';
