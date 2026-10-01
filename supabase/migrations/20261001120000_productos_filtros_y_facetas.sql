-- Filtrado, paginación y facetas de /productos, todo dentro de Postgres.
--
-- Hasta acá la pantalla pedía `productos.list({ limit: 1000 })` y filtraba en el
-- navegador: de los 21.009 productos nunca se veían más de 1.000, y PostgREST
-- corta ahí sin avisar (AGENTS.md, lección 12). Esto mueve a SQL el filtro, el
-- orden, la página, el total y las listas de valores distintos de categoría y de
-- marca, de modo que a Next solo llega la página de 50 filas.
--
-- Piezas:
--   1. `escapar_like`     : texto literal para un LIKE (\ % _ escapados).
--   2. `productos_filtrados`: EL predicado. Un solo lugar donde vive la regla de
--      cada filtro; el listado y las facetas lo llaman, así no pueden divergir.
--   3. `productos_listar` : una página + el total real, como jsonb.
--   4. `productos_facetas`: valores distintos con cantidad, estilo Excel.
--
-- Todo es `security invoker`: corre con el rol de quien llama y la RLS de
-- `productos` (select para admin y vendedor) recorta igual que en cualquier
-- consulta directa.
--
-- `productos_filtrados` es plpgsql con `plan_cache_mode = force_custom_plan` a
-- propósito. Escrita en SQL puro, Postgres planifica el cuerpo UNA vez con los
-- parámetros sin valor, y la guarda `filtro is null or ...` de cada condición
-- impide usar los índices trigram: medido con 21.009 filas, un filtro de texto
-- tardaba ~200 ms haciendo seq scan. Con un plan por llamada los valores son
-- constantes, las guardas se pliegan, y el LIKE usa el índice.

-- Filtros (jsonb, claves ausentes = sin filtro):
--   codigo, codigo_modo ('contiene'|'empieza')   sobre codigo_interno
--   descripcion, descripcion_modo                sobre nombre
--   categorias  [texto]                          IN sobre categoria
--   marcas      [texto]                          IN sobre la marca; '(sin marca)'
--                                                es descripcion nula o en blanco
--   precio_min, precio_max, stock_min, stock_max rangos inclusivos
--   con_stock   boolean                          true: stock > 0 · false: stock = 0
--   estado      'activo'|'inactivo'
--
-- Los textos se comparan con `plegar_texto` (minúsculas, sin tildes), el mismo
-- plegado de `buscar_productos`; en TypeScript lo espeja `plegarTexto`.
--
-- La "marca" de un producto es `btrim(descripcion)`: en el inventario real esa
-- columna trae la marca del repuesto (MOBIS, CHINA, GM…) y 2.740 filas la tienen
-- nula. El literal '(sin marca)' es el mismo que `SIN_MARCA` en TypeScript.

-- =========================================================================
-- 0. Índices para los filtros de texto
-- =========================================================================

-- Sobre la expresión plegada, que es la que comparan los filtros. `plegar_texto`
-- es IMMUTABLE y la expresión del índice es idéntica a la de la consulta. Un
-- GIN trigram sirve tanto para `contiene` como para `empieza`. Con menos de 3
-- caracteres no hay trigramas que buscar y Postgres cae a recorrer la tabla.
--
-- Costo: dos índices más en cada escritura de `productos` (hoy ya hay 6 y el
-- import CSV hace upsert por lotes). El catálogo cambia por import, no por
-- tráfico transaccional, así que se acepta.
create index if not exists productos_codigo_interno_texto_trgm_idx
  on public.productos using gin (public.plegar_texto(codigo_interno) gin_trgm_ops);

create index if not exists productos_nombre_texto_trgm_idx
  on public.productos using gin (public.plegar_texto(nombre) gin_trgm_ops);

-- =========================================================================
-- 1. Texto literal para LIKE
-- =========================================================================

create function public.escapar_like(t text)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select replace(replace(replace(t, '\', '\\'), '%', '\%'), '_', '\_')
$$;

comment on function public.escapar_like(text) is
  'Escapa \, % y _ para que el texto sea literal dentro de un LIKE.';

-- =========================================================================
-- 2. El predicado único
-- =========================================================================

-- `p_excluir` ('categoria' | 'marca') salta el filtro de esa columna: es lo que
-- necesita la faceta de esa columna para no vaciarse al seleccionar un valor.
create function public.productos_filtrados(p_filtros jsonb, p_excluir text default null)
returns table (id uuid, categoria text, marca text)
language plpgsql
stable
security invoker
set search_path = ''
set plan_cache_mode = force_custom_plan
as $function$
#variable_conflict use_column
begin
  return query
  select
    p.id,
    p.categoria,
    coalesce(nullif(btrim(p.descripcion), ''), '(sin marca)') as marca
  from public.productos as p
  where
    (
      nullif(btrim(p_filtros ->> 'codigo'), '') is null
      or public.plegar_texto(p.codigo_interno) like
        case when p_filtros ->> 'codigo_modo' = 'empieza' then '' else '%' end
        || public.escapar_like(public.plegar_texto(btrim(p_filtros ->> 'codigo')))
        || '%'
    )
    and (
      nullif(btrim(p_filtros ->> 'descripcion'), '') is null
      or public.plegar_texto(p.nombre) like
        case when p_filtros ->> 'descripcion_modo' = 'empieza' then '' else '%' end
        || public.escapar_like(public.plegar_texto(btrim(p_filtros ->> 'descripcion')))
        || '%'
    )
    and (
      p_excluir is not distinct from 'categoria'
      or jsonb_array_length(coalesce(p_filtros -> 'categorias', '[]'::jsonb)) = 0
      or p.categoria = any (
        array(select jsonb_array_elements_text(p_filtros -> 'categorias'))
      )
    )
    and (
      p_excluir is not distinct from 'marca'
      or jsonb_array_length(coalesce(p_filtros -> 'marcas', '[]'::jsonb)) = 0
      or coalesce(nullif(btrim(p.descripcion), ''), '(sin marca)') = any (
        array(select jsonb_array_elements_text(p_filtros -> 'marcas'))
      )
    )
    and (p_filtros ->> 'precio_min' is null or p.precio >= (p_filtros ->> 'precio_min')::numeric)
    and (p_filtros ->> 'precio_max' is null or p.precio <= (p_filtros ->> 'precio_max')::numeric)
    and (p_filtros ->> 'stock_min' is null or p.stock >= (p_filtros ->> 'stock_min')::integer)
    and (p_filtros ->> 'stock_max' is null or p.stock <= (p_filtros ->> 'stock_max')::integer)
    and (
      p_filtros ->> 'con_stock' is null
      or (p_filtros ->> 'con_stock')::boolean = (p.stock > 0)
    )
    and (
      p_filtros ->> 'estado' is null
      or p.activo = (p_filtros ->> 'estado' = 'activo')
    );
end
$function$;

comment on function public.productos_filtrados(jsonb, text) is
  'Predicado unico de los filtros de /productos: devuelve id, categoria y marca de los productos que lo cumplen. p_excluir salta el filtro de una columna (facetas).';

-- =========================================================================
-- 3. Una página y el total real
-- =========================================================================

-- Devuelve `{ total, items }` como jsonb. Un objeto y no un `table(...)`:
--   - la página vacía (fuera de rango) igual trae el total, cosa que un
--     `count(*) over ()` no puede dar porque no hay fila donde ponerlo;
--   - las columnas salen de `to_jsonb(productos)`, así que una columna nueva no
--     queda fuera en silencio por no estar en una lista a mano.
-- Se quitan `busqueda` y las dos columnas plegadas: son índices, no datos.
--
-- Orden `nombre, codigo_interno`: `codigo_interno` es UNIQUE, por lo que es un
-- orden total y dos páginas nunca se pisan.
create function public.productos_listar(
  p_filtros jsonb,
  p_pagina integer default 1,
  p_por_pagina integer default 50
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
  with ids as (
    select f.id from public.productos_filtrados(p_filtros) as f
  ),
  total as (
    select count(*)::bigint as n from ids
  ),
  tamanio as (
    select greatest(1, least(coalesce(p_por_pagina, 50), 100)) as n
  ),
  pagina as (
    select p.*
    from public.productos as p
    join ids using (id)
    order by p.nombre, p.codigo_interno
    limit (select n from tamanio)
    offset (greatest(coalesce(p_pagina, 1), 1) - 1) * (select n from tamanio)
  )
  select jsonb_build_object(
    'total', (select n from total),
    'items', coalesce(
      (
        select jsonb_agg(
          to_jsonb(pagina) - 'busqueda' - 'codigo_fabrica_plegado' - 'codigo_interno_plegado'
          order by pagina.nombre, pagina.codigo_interno
        )
        from pagina
      ),
      '[]'::jsonb
    )
  )
$function$;

comment on function public.productos_listar(jsonb, integer, integer) is
  'Pagina del catalogo filtrado + total real, como {total, items}. Orden nombre, codigo_interno. p_por_pagina se acota a 1..100.';

-- =========================================================================
-- 4. Facetas estilo Excel
-- =========================================================================

-- Una fila por (columna, valor): 'categoria' y 'marca'. Cada columna se cuenta
-- con todos los filtros menos el suyo. Orden: cantidad desc y, a igual cantidad,
-- el valor en orden binario (`collate "C"`) para que no dependa de la collation
-- de la base. Se devuelven los `p_limite` primeros más los valores seleccionados
-- —aunque queden fuera del tope o no tengan filas, en cuyo caso van con cantidad
-- 0— y `distintos` repite en cada fila cuántos valores hay en total, para que la
-- pantalla pueda avisar que la lista está recortada.
create function public.productos_facetas(p_filtros jsonb, p_limite integer default 500)
returns table (columna text, valor text, cantidad bigint, distintos bigint)
language sql
stable
security invoker
set search_path = ''
as $function$
  with
  sel_categoria as (
    select distinct v from jsonb_array_elements_text(
      coalesce(p_filtros -> 'categorias', '[]'::jsonb)
    ) as t(v)
  ),
  sel_marca as (
    select distinct v from jsonb_array_elements_text(
      coalesce(p_filtros -> 'marcas', '[]'::jsonb)
    ) as t(v)
  ),
  cuenta_categoria as (
    select f.categoria as valor, count(*) as cantidad
    from public.productos_filtrados(p_filtros, 'categoria') as f
    where f.categoria is not null
    group by f.categoria
  ),
  cuenta_marca as (
    select f.marca as valor, count(*) as cantidad
    from public.productos_filtrados(p_filtros, 'marca') as f
    group by f.marca
  ),
  todo_categoria as (
    select coalesce(c.valor, s.v) as valor, coalesce(c.cantidad, 0) as cantidad
    from cuenta_categoria as c
    full join sel_categoria as s on s.v = c.valor
  ),
  todo_marca as (
    select coalesce(c.valor, s.v) as valor, coalesce(c.cantidad, 0) as cantidad
    from cuenta_marca as c
    full join sel_marca as s on s.v = c.valor
  ),
  rank_categoria as (
    select
      t.valor,
      t.cantidad,
      row_number() over (order by t.cantidad desc, t.valor collate "C") as pos,
      count(*) over () as distintos
    from todo_categoria as t
  ),
  rank_marca as (
    select
      t.valor,
      t.cantidad,
      row_number() over (order by t.cantidad desc, t.valor collate "C") as pos,
      count(*) over () as distintos
    from todo_marca as t
  )
  select u.columna, u.valor, u.cantidad, u.distintos
  from (
    select 'categoria'::text as columna, r.valor, r.cantidad, r.distintos
    from rank_categoria as r
    where r.pos <= greatest(coalesce(p_limite, 500), 0)
       or r.valor in (select v from sel_categoria)
    union all
    select 'marca'::text, r.valor, r.cantidad, r.distintos
    from rank_marca as r
    where r.pos <= greatest(coalesce(p_limite, 500), 0)
       or r.valor in (select v from sel_marca)
  ) as u
  order by u.columna, u.cantidad desc, u.valor collate "C"
$function$;

comment on function public.productos_facetas(jsonb, integer) is
  'Valores distintos de categoria y marca con su cantidad. Cada columna se cuenta con todos los filtros menos el suyo. Los valores seleccionados siempre salen.';

-- =========================================================================
-- Permisos: solo usuarios autenticados y service_role; anon no entra.
-- =========================================================================

revoke all on function public.escapar_like(text) from public, anon;
revoke all on function public.productos_filtrados(jsonb, text) from public, anon;
revoke all on function public.productos_listar(jsonb, integer, integer) from public, anon;
revoke all on function public.productos_facetas(jsonb, integer) from public, anon;

grant execute on function public.escapar_like(text) to authenticated, service_role;
grant execute on function public.productos_filtrados(jsonb, text) to authenticated, service_role;
grant execute on function public.productos_listar(jsonb, integer, integer)
  to authenticated, service_role;
grant execute on function public.productos_facetas(jsonb, integer) to authenticated, service_role;
