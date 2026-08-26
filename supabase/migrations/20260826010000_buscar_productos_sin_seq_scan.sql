-- `buscar_productos` deja de recorrer la tabla entera en cada consulta.
--
-- OBSERVACIÓN
--
-- Con el catálogo real cargado (21.009 filas, 19.642 activas) la función tarda
-- **1.242 ms** medidos con EXPLAIN ANALYZE, y contra el proyecto remoto entre
-- 2.500 y 5.300 ms. Incluso `23041-2B101`, que es una igualdad exacta contra un
-- índice btree, tardaba 2,6 s. Para un agente de WhatsApp eso se le suma al
-- tiempo del LLM y el cliente se va.
--
-- CAUSA RAÍZ
--
-- No eran los índices: medidos uno por uno, los tres resuelven en menos de un
-- milisegundo.
--
--   codigo_fabrica_plegado = ...        btree          0,09 ms
--   plegar_codigos(otros_codigos) @> .. GIN            0,15 ms
--   busqueda like '%23041%'             GIN trigram    0,26 ms
--   los tres combinados con OR          BitmapOr       0,47 ms
--
-- El problema era la CUARTA rama del OR:
--
--   or exists (select 1 from palabras w where p.busqueda like '%'||w.palabra||'%')
--
-- Ese `like` no compara contra una constante sino contra un valor que sale de
-- `palabras`, un CTE construido con `unnest(regexp_split_to_array(...))` que el
-- planner no puede plegar. Un índice trigram no puede servir un patrón que no
-- conoce en tiempo de planificación, así que Postgres descarta el BitmapOr y
-- cae a un `Nested Loop` con **todo el OR como Join Filter**:
--
--   Nested Loop  (actual time=12.152..1242.897 rows=4)
--     Join Filter: (((c.cod <> '') AND ((codigo_fabrica_plegado = c.cod) OR ...
--                   OR (plegar_codigos(otros_codigos) @> ARRAY[c.cod]))) OR ...)
--     ->  Seq Scan on productos  (rows=19642)
--
-- Y una vez que recorre fila por fila, evalúa `plegar_codigos(otros_codigos)`
-- en las 21.009 filas: cuatro pasadas de `regexp_replace` por cada código
-- alterno de cada producto. Ahí se van los 1.242 ms. Una rama no indexable no
-- se limita a ser lenta ella: **arrastra a todas las demás del OR**.
--
-- FIX
--
-- Separar el OR en un UNION de escaneos independientes. Cada rama vuelve a
-- elegir su propio plan y su propio índice; la del texto sigue recorriendo la
-- tabla, pero sola cuesta 21 ms porque solo hace el `like`, sin las funciones
-- de plegado encima.
--
-- Medido con el mismo EXPLAIN ANALYZE sobre los mismos datos:
--
--   antes   1.242 ms
--   después    30 ms      (41x)
--
-- El puntaje NO se toca: sigue siendo el mismo que espeja
-- `src/lib/catalogo/puntaje.ts`, y los contract tests corren contra las dos
-- implementaciones para que no se separen.

drop function if exists public.buscar_productos(text, text, text, integer, integer);

create function public.buscar_productos(
  p_q text,
  p_marca text default null,
  p_modelo text default null,
  p_anio integer default null,
  p_tope integer default 20
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
  puntaje integer
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
  /*
   * Cuatro escaneos independientes en vez de un OR.
   *
   * Es LA diferencia de esta migración. Cada rama elige su plan: las tres de
   * código entran por índice, la del texto recorre la tabla pero sin arrastrar
   * a las otras. Volver a juntarlas en un OR devuelve el nested loop.
   *
   * La rama "sin palabras útiles" que tenía la versión anterior se eliminó:
   * dejaba pasar el catálogo entero y después el `where exacto > 0 or suma > 0`
   * del final lo descartaba fila por fila, porque sin palabras y sin código no
   * hay nada que pueda puntuar. Era trabajo para llegar a cero resultados.
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
  candidatos as (
    select p.*
    from public.productos as p
    join ids on ids.id = p.id
    where (
      -- `compatibilidad` vacía significa "no sabemos", no "no sirve": el export
      -- de inventario no trae esa columna y el vehículo va escrito adentro del
      -- nombre. Filtrar por ahí escondía el catálogo entero apenas el agente
      -- mencionaba una marca.
      (p_marca is null and p_modelo is null and p_anio is null)
      or jsonb_array_length(coalesce(p.compatibilidad, '[]'::jsonb)) = 0
      or exists (
        select 1
        from jsonb_array_elements(p.compatibilidad) as k
        where (p_marca is null or public.plegar_texto(k->>'marca') = public.plegar_texto(p_marca))
          and (p_modelo is null or public.plegar_texto(k->>'modelo') = public.plegar_texto(p_modelo))
          and (
            p_anio is null
            or (p_anio between (k->>'anio_desde')::int and (k->>'anio_hasta')::int)
          )
      )
    )
  ),
  puntuados as (
    select
      c.id, c.codigo_interno, c.codigo_fabrica, c.nombre, c.categoria,
      c.descripcion, c.precio, c.stock,
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
     end) as puntaje
  from puntuados
  where exacto > 0 or suma > 0
  order by puntaje desc, stock desc, nombre asc
  limit greatest(1, least(coalesce(p_tope, 20), 50))
$function$;

revoke all on function public.buscar_productos(text, text, text, integer, integer) from public;
revoke all on function public.buscar_productos(text, text, text, integer, integer) from anon;
grant execute on function public.buscar_productos(text, text, text, integer, integer) to authenticated;
grant execute on function public.buscar_productos(text, text, text, integer, integer) to service_role;

comment on function public.buscar_productos(text, text, text, integer, integer) is
  'Busqueda del catalogo por codigo de fabrica, codigo interno, alternos y texto. Los candidatos salen de un UNION y no de un OR: una rama no indexable dentro de un OR arrastra a las demas a seq scan (1242ms -> 30ms medidos sobre 21.009 filas).';
