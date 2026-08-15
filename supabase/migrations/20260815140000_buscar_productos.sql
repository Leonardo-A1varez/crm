-- La búsqueda del catálogo se muda a Postgres.
--
-- Hasta acá el agente hacía `productos.list({activo:true})` y puntuaba en
-- JavaScript. Con el catálogo real eso se rompe de la peor manera posible: en
-- silencio. PostgREST corta en 1.000 filas por defecto y la consulta no pasaba
-- límite, así que el agente veía 1.000 de 19.731 productos ordenados
-- alfabéticamente —de `001 CAMISAS` a `CH COR DW LAN 1C`— y todo Hyundai, KIA,
-- Mazda, Nissan y Toyota simplemente no existía para él. Respondía "no tenemos"
-- sin ningún error en ningún log.
--
-- Además los índices trigram de `nombre` y `codigo_interno` no los usaba nadie:
-- el filtro vivía en memoria, del otro lado de la red.
--
-- Tres piezas:
--   1. `plegar_texto`: minúsculas sin tildes, IMMUTABLE para poder indexarla.
--   2. `productos.busqueda`: columna generada que junta los cuatro campos
--      donde puede estar la respuesta, con un GIN trigram encima.
--   3. `buscar_productos`: puntúa palabra por palabra y devuelve el top N.
--
-- El puntaje espeja `relevanceScore` de `catalog-matcher.service.ts`, que sigue
-- siendo la implementación in-memory de los contract tests. Dos espejos de la
-- misma regla: si uno cambia, el otro miente.

-- =========================================================================
-- 1. Plegado de texto, indexable
-- =========================================================================

-- `unaccent` no sirve acá: no es IMMUTABLE (depende de un diccionario) y
-- Postgres no la acepta en una columna generada. `translate` sí lo es.
create or replace function public.plegar_texto(t text)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select translate(lower(t), 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunaeiouun')
$$;

comment on function public.plegar_texto(text) is
  'Minusculas sin tildes. IMMUTABLE para poder usarse en columnas generadas e indices.';

-- =========================================================================
-- 2. Columna de búsqueda + índice
-- =========================================================================

-- Las cuatro columnas donde puede estar la respuesta, en una sola. Un cliente
-- escribe "radiador del aveo": el repuesto está en `categoria` y el auto en
-- `nombre`, así que buscar en una sola columna nunca alcanza.
alter table public.productos
  add column if not exists busqueda text
  generated always as (
    public.plegar_texto(
      coalesce(codigo_interno, '') || ' ' ||
      coalesce(nombre, '') || ' ' ||
      coalesce(categoria, '') || ' ' ||
      coalesce(descripcion, '')
    )
  ) stored;

comment on column public.productos.busqueda is
  'codigo + nombre + categoria + descripcion, plegado. Generada: no se escribe a mano. Es lo que indexa productos_busqueda_trgm_idx.';

create index if not exists productos_busqueda_trgm_idx
  on public.productos using gin (busqueda gin_trgm_ops);

-- =========================================================================
-- 3. La búsqueda
-- =========================================================================

/*
 * Puntúa palabra por palabra y devuelve las mejores.
 *
 * Los pesos son los mismos que en TypeScript:
 *   codigo 10 · categoria exacta 9 · nombre 8 · categoria 6 · descripcion 3
 * y ×2 cuando el producto acierta TODAS las palabras, para que "radiador de
 * aveo" ponga el radiador del Aveo arriba del radiador del Spark.
 *
 * La categoría exacta pesa más que contenerla porque quien pide "radiador"
 * quiere un `RADIADOR` y no una `MANG RADIADOR`, que es la manguera.
 *
 * `p_marca` y `p_modelo` filtran por `compatibilidad` SOLO si el producto tiene
 * esa lista cargada: vacía significa "no sabemos", no "no sirve". El export de
 * inventario no trae esa columna y el vehículo va escrito dentro del nombre.
 */
create or replace function public.buscar_productos(
  p_q text,
  p_marca text default null,
  p_modelo text default null,
  p_anio integer default null,
  p_tope integer default 20
)
returns table (
  id uuid,
  codigo_interno text,
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
    select public.plegar_texto(btrim(coalesce(p_q, ''))) as q
  ),
  palabras as (
    select distinct t as palabra
    from consulta, unnest(regexp_split_to_array(consulta.q, '[^0-9a-z/.*-]+')) as t
    where length(t) > 1
      -- Relleno que aparecería en todo y ensuciaría el orden.
      and t not in (
        'de','del','la','el','los','las','un','una','para','con','y','o','mi',
        'me','por','que','tiene','tienen','tenes','tienes','hay','busco',
        'necesito','quiero','precio','cuanto','cuesta'
      )
  ),
  -- Solo los productos que contienen al menos una palabra. Acá es donde entra
  -- el índice trigram: sin este recorte habría que puntuar las 19.731 filas.
  candidatos as (
    select p.*
    from public.productos as p
    where p.activo
      and (
        not exists (select 1 from palabras)
        or exists (
          select 1 from palabras as w where p.busqueda like '%' || w.palabra || '%'
        )
      )
      and (
        (p_marca is null and p_modelo is null and p_anio is null)
        or jsonb_array_length(coalesce(p.compatibilidad, '[]'::jsonb)) = 0
        or exists (
          select 1
          from jsonb_array_elements(p.compatibilidad) as c
          where (p_marca is null or public.plegar_texto(c->>'marca') = public.plegar_texto(p_marca))
            and (p_modelo is null or public.plegar_texto(c->>'modelo') = public.plegar_texto(p_modelo))
            and (
              p_anio is null
              or (p_anio between (c->>'anio_desde')::int and (c->>'anio_hasta')::int)
            )
        )
      )
  ),
  puntuados as (
    select
      c.id, c.codigo_interno, c.nombre, c.categoria, c.descripcion, c.precio, c.stock,
      -- El código completo tiene atajo: un taller que dicta `96817344/CH`
      -- espera esa fila primero y no una lista.
      case when public.plegar_texto(c.codigo_interno) = (select q from consulta) then 1000 else 0 end
        as exacto,
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
    from candidatos as c
  )
  select
    id, codigo_interno, nombre, categoria, descripcion, precio, stock,
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
  'Busqueda del catalogo puntuada en Postgres sobre codigo, nombre, categoria y descripcion. Reemplaza el scan en memoria que solo veia las primeras 1000 filas.';
