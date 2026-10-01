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
--
-- Filtros (jsonb, claves ausentes = sin filtro):
--   q                                            buscador general: "contiene" plegado en
--                                                codigo_interno, codigo_fabrica,
--                                                otros_codigos, nombre y la marca
--   codigo, codigo_modo ('contiene'|'empieza')   sobre codigo_interno
--   descripcion, descripcion_modo                sobre nombre
--   categorias, sin_categorias  [texto]          incluir / excluir categorías
--   marcas, sin_marcas          [texto]          incluir / excluir marcas
--   precio_min, precio_max, stock_min, stock_max rangos inclusivos
--   con_stock   boolean                          true: stock > 0 · false: stock = 0
--   estado      'activo'|'inactivo'
-- Solo para `productos_facetas`:
--   q_categoria, q_marca                         búsqueda dentro de cada lista
--
-- El buscador general `q` se combina con AND con todo lo demás y llega también a
-- las facetas, que lo heredan por pasar por `productos_filtrados`. La marca
-- buscable es el texto real de `descripcion`: el sentinela '(sin marca)' es un
-- valor de lista, no un texto que alguien haya escrito, así que "sin marca" no
-- trae los productos sin marca. La categoría no entra (tiene su columna).
--
-- Incluir y excluir son excluyentes por columna (lo valida el schema Zod); acá,
-- si llegaran los dos, se aplican los dos. Una clave de lista que no sea un
-- array se ignora en vez de romper la consulta.
--
-- Los textos se comparan con `plegar_texto` (minúsculas, sin tildes), el mismo
-- plegado de `buscar_productos`; en TypeScript lo espeja `plegarTexto`.
--
-- Valor de categoría y de marca. Un solo criterio, el mismo en el filtro y en la
-- faceta, para que lo que la faceta devuelve sea EXACTAMENTE lo que se filtra:
--   marca     = btrim(descripcion), o '(sin marca)' si queda vacía o es nula
--   categoria = btrim(categoria),   o '(sin categoría)' si queda vacía o es nula
-- `btrim` quita espacio, tab, CR, LF y NBSP (E' \t\r\n '). En TypeScript es
-- `normalizarValor`; NO es `String.trim()`, que quita más. Los literales son los
-- mismos que `SIN_MARCA` y `SIN_CATEGORIA`. Hoy 2.740 filas tienen la marca
-- nula; la categoría nunca es nula en crm-dev, pero el sentinela evita que una
-- fila con categoría vacía quede sin casilla que marcar.

-- =========================================================================
-- 0. Índices
-- =========================================================================

-- Texto: sobre la expresión plegada, que es la que comparan los filtros.
-- `plegar_texto` es IMMUTABLE y la expresión del índice es idéntica a la de la
-- consulta. Un GIN trigram sirve tanto para `contiene` como para `empieza`. Con
-- menos de 3 caracteres no hay trigramas que buscar y Postgres cae a recorrer la
-- tabla.
create index if not exists productos_codigo_interno_texto_trgm_idx
  on public.productos using gin (public.plegar_texto(codigo_interno) gin_trgm_ops);

create index if not exists productos_nombre_texto_trgm_idx
  on public.productos using gin (public.plegar_texto(nombre) gin_trgm_ops);

-- Buscador general (`q`). Una columna generada con los cinco campos que busca,
-- plegados y separados por chr(31) (separador de unidad), y un GIN trigram encima.
--
-- Por qué una columna y no cinco condiciones. `productos.busqueda` ya junta casi
-- los mismos campos, pero también la categoría, y `q` no la busca: usarla sola
-- devolvería productos que solo coinciden en la categoría, y descartarlos con
-- cinco `plegar_texto(...) like` por fila cuesta. Medido con 21.000 filas, en
-- local: con ese recheck, `q` de 2 letras tardaba ~190 ms (listado) y ~370 ms
-- (facetas); con esta columna lo resuelve una sola comparación. Con 3 o más
-- letras el índice trigram trae solo los candidatos.
--
-- El separador impide que un `q` con espacios coincida a caballo entre dos
-- campos ("q-003 filtro" no encuentra el código de un producto y el nombre de
-- otro): cada campo se busca por separado, como en TypeScript. Un `q` que
-- tuviera el propio chr(31) no coincidiría con nada, que es lo correcto.
--
-- Los alternos se unen con espacio (`codigos_a_texto`), igual que en
-- `productos.busqueda`. La marca es el texto real de `descripcion`.
--
-- Una columna generada nueva reescribe la tabla (lock de tabla): con 21.009
-- filas son milisegundos, pero se aplica en ventana.
alter table public.productos
  add column if not exists busqueda_general text
  generated always as (
    public.plegar_texto(
      coalesce(codigo_interno, '') || chr(31) ||
      coalesce(codigo_fabrica, '') || chr(31) ||
      public.codigos_a_texto(otros_codigos) || chr(31) ||
      coalesce(nombre, '') || chr(31) ||
      coalesce(descripcion, '')
    )
  ) stored;

comment on column public.productos.busqueda_general is
  'codigo_interno, codigo_fabrica, otros_codigos, nombre y descripcion (la marca), plegados y separados por chr(31). Generada. La usa el buscador general q de /productos; la indexa productos_busqueda_general_trgm_idx.';

create index if not exists productos_busqueda_general_trgm_idx
  on public.productos using gin (busqueda_general gin_trgm_ops);

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

-- Devuelve lo que necesitan sus dos clientes: el listado ordena por
-- (nombre, codigo_interno) y cuenta; las facetas agrupan por categoría y marca.
-- `p_excluir` ('categoria' | 'marca') salta TODOS los filtros de esa columna
-- (incluir y excluir): es lo que necesita la faceta de esa columna para no
-- vaciarse al seleccionar un valor.
create function public.productos_filtrados(p_filtros jsonb, p_excluir text default null)
returns table (id uuid, nombre text, codigo_interno text, categoria text, marca text)
language plpgsql
stable
security invoker
set search_path = ''
set plan_cache_mode = force_custom_plan
as $function$
#variable_conflict use_column
declare
  v_cats text[] := case when jsonb_typeof(p_filtros -> 'categorias') = 'array'
    then array(select jsonb_array_elements_text(p_filtros -> 'categorias'))
    else '{}'::text[] end;
  v_sin_cats text[] := case when jsonb_typeof(p_filtros -> 'sin_categorias') = 'array'
    then array(select jsonb_array_elements_text(p_filtros -> 'sin_categorias'))
    else '{}'::text[] end;
  v_marcas text[] := case when jsonb_typeof(p_filtros -> 'marcas') = 'array'
    then array(select jsonb_array_elements_text(p_filtros -> 'marcas'))
    else '{}'::text[] end;
  v_sin_marcas text[] := case when jsonb_typeof(p_filtros -> 'sin_marcas') = 'array'
    then array(select jsonb_array_elements_text(p_filtros -> 'sin_marcas'))
    else '{}'::text[] end;
  -- Patrón del buscador general, o null si no hay búsqueda.
  v_q text := case
    when nullif(btrim(p_filtros ->> 'q', E' \t\r\n '), '') is null then null
    else '%' || public.escapar_like(
      public.plegar_texto(btrim(p_filtros ->> 'q', E' \t\r\n '))
    ) || '%'
  end;
begin
  return query
  select p.id, p.nombre, p.codigo_interno, n.cat, n.marca
  from public.productos as p
  cross join lateral (
    select
      coalesce(nullif(btrim(p.categoria, E' \t\r\n '), ''), '(sin categoría)') as cat,
      coalesce(nullif(btrim(p.descripcion, E' \t\r\n '), ''), '(sin marca)') as marca
  ) as n
  where
    (
      v_q is null
      or p.busqueda_general like v_q
    )
    and (
      nullif(btrim(p_filtros ->> 'codigo', E' \t\r\n '), '') is null
      or public.plegar_texto(p.codigo_interno) like
        case when p_filtros ->> 'codigo_modo' = 'empieza' then '' else '%' end
        || public.escapar_like(
          public.plegar_texto(btrim(p_filtros ->> 'codigo', E' \t\r\n '))
        )
        || '%'
    )
    and (
      nullif(btrim(p_filtros ->> 'descripcion', E' \t\r\n '), '') is null
      or public.plegar_texto(p.nombre) like
        case when p_filtros ->> 'descripcion_modo' = 'empieza' then '' else '%' end
        || public.escapar_like(
          public.plegar_texto(btrim(p_filtros ->> 'descripcion', E' \t\r\n '))
        )
        || '%'
    )
    and (
      p_excluir is not distinct from 'categoria'
      or (
        (cardinality(v_cats) = 0 or n.cat = any (v_cats))
        and not (n.cat = any (v_sin_cats))
      )
    )
    and (
      p_excluir is not distinct from 'marca'
      or (
        (cardinality(v_marcas) = 0 or n.marca = any (v_marcas))
        and not (n.marca = any (v_sin_marcas))
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
  'Predicado unico de los filtros de /productos: devuelve id, nombre, codigo_interno, categoria y marca (ya normalizadas) de los productos que lo cumplen. p_excluir salta los filtros de una columna (facetas).';

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
--
-- La página se elige ordenando solo las claves que devuelve `productos_filtrados`
-- y recién entonces se leen las ≤100 filas completas por primary key. No se une
-- el resultado de la función con `productos` entero: Postgres estima 1.000 filas
-- para una función que devuelve conjuntos y el plan del join dependía de esa
-- estimación (nested loop con 21k lookups si el filtro era ancho).
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
    select f.id, f.nombre, f.codigo_interno from public.productos_filtrados(p_filtros) as f
  ),
  total as (
    select count(*)::bigint as n from ids
  ),
  tamanio as (
    select greatest(1, least(coalesce(p_por_pagina, 50), 100)) as n
  ),
  pagina_ids as (
    select i.id
    from ids as i
    order by i.nombre, i.codigo_interno
    limit (select n from tamanio)
    offset (greatest(coalesce(p_pagina, 1), 1) - 1) * (select n from tamanio)
  ),
  pagina as (
    select p.*
    from public.productos as p
    where p.id in (select id from pagina_ids)
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
-- con todos los filtros menos los suyos. Orden: cantidad desc y, a igual
-- cantidad, el valor en orden binario (`collate "C"`) para que no dependa de la
-- collation de la base.
--
-- `q_categoria` / `q_marca` (en p_filtros) buscan dentro de la lista —plegado,
-- "contiene"— ANTES del límite, así una marca de una sola fila fuera del top
-- sigue siendo encontrable. La búsqueda recorta también a los seleccionados.
--
-- Se devuelven los `p_limite` primeros más los valores seleccionados (los de
-- incluir y los de excluir) que coinciden con la búsqueda, aunque queden fuera
-- del tope o no tengan filas: esos van con cantidad 0. `distintos` repite en
-- cada fila cuántos valores CON FILAS hay (los seleccionados con 0 no cuentan),
-- para que la pantalla pueda avisar que la lista está recortada.
create function public.productos_facetas(p_filtros jsonb, p_limite integer default 500)
returns table (columna text, valor text, cantidad bigint, distintos bigint)
language sql
stable
security invoker
set search_path = ''
as $function$
  with
  sel_categoria as (
    select distinct x.v
    from (
      select jsonb_array_elements_text(
        case when jsonb_typeof(p_filtros -> 'categorias') = 'array'
          then p_filtros -> 'categorias' else '[]'::jsonb end
      ) as v
      union all
      select jsonb_array_elements_text(
        case when jsonb_typeof(p_filtros -> 'sin_categorias') = 'array'
          then p_filtros -> 'sin_categorias' else '[]'::jsonb end
      )
    ) as x
  ),
  sel_marca as (
    select distinct x.v
    from (
      select jsonb_array_elements_text(
        case when jsonb_typeof(p_filtros -> 'marcas') = 'array'
          then p_filtros -> 'marcas' else '[]'::jsonb end
      ) as v
      union all
      select jsonb_array_elements_text(
        case when jsonb_typeof(p_filtros -> 'sin_marcas') = 'array'
          then p_filtros -> 'sin_marcas' else '[]'::jsonb end
      )
    ) as x
  ),
  busqueda as (
    select
      case when nullif(btrim(p_filtros ->> 'q_categoria', E' \t\r\n '), '') is null then null
        else '%' || public.escapar_like(
          public.plegar_texto(btrim(p_filtros ->> 'q_categoria', E' \t\r\n '))
        ) || '%' end as categoria,
      case when nullif(btrim(p_filtros ->> 'q_marca', E' \t\r\n '), '') is null then null
        else '%' || public.escapar_like(
          public.plegar_texto(btrim(p_filtros ->> 'q_marca', E' \t\r\n '))
        ) || '%' end as marca
  ),
  cuenta_categoria as (
    select f.categoria as valor, count(*) as cantidad
    from public.productos_filtrados(p_filtros, 'categoria') as f
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
      count(*) filter (where t.cantidad > 0) over () as distintos
    from todo_categoria as t, busqueda as b
    where b.categoria is null or public.plegar_texto(t.valor) like b.categoria
  ),
  rank_marca as (
    select
      t.valor,
      t.cantidad,
      row_number() over (order by t.cantidad desc, t.valor collate "C") as pos,
      count(*) filter (where t.cantidad > 0) over () as distintos
    from todo_marca as t, busqueda as b
    where b.marca is null or public.plegar_texto(t.valor) like b.marca
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
  'Valores distintos de categoria y marca con su cantidad. Cada columna se cuenta con todos los filtros menos los suyos. q_categoria/q_marca buscan dentro de la lista antes del limite. Los valores seleccionados siempre salen; distintos no los cuenta si no tienen filas.';

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
