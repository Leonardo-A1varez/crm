-- Catálogo de /productos: filtros, orden, carga por lotes y listas de valores,
-- todo dentro de Postgres.
--
-- Hasta acá la pantalla pedía `productos.list({ limit: 1000 })` y filtraba en el
-- navegador: de los 21.009 productos nunca se veían más de 1.000, y PostgREST
-- corta ahí sin avisar (AGENTS.md, lección 12). Esto mueve a SQL el filtro, el
-- orden, el recorte en lotes de 1.000 y las listas de valores distintos de cada
-- columna, de modo que a Next solo llega un lote por pedido y el navegador los junta.
--
-- Piezas:
--   1. `escapar_like`      : texto literal para un LIKE (\ % _ escapados).
--   2. `jsonb_lista`       : un array jsonb de strings como text[], tolerante.
--   3. `productos_filtrados`: EL predicado. Un solo lugar donde vive la regla de
--      cada filtro; el listado y las listas de valores lo llaman, así no pueden
--      divergir.
--   4. `productos_listar`  : un lote ordenado + el total real, como jsonb.
--   5. `productos_faceta`  : valores distintos de UNA columna con su cantidad.
--
-- Todo es `security invoker`: corre con el rol de quien llama y la RLS de
-- `productos` (select para admin y vendedor) recorta igual que en cualquier
-- consulta directa.
--
-- `productos_filtrados` es plpgsql con `plan_cache_mode = force_custom_plan` a
-- propósito. Escrita en SQL puro, Postgres planifica el cuerpo UNA vez con los
-- parámetros sin valor, y la guarda `filtro is null or ...` de cada condición
-- impide simplificar la consulta: con un plan por llamada los valores son
-- constantes y las guardas se pliegan.
--
-- Filtros (jsonb, claves ausentes = sin filtro):
--   q                                  buscador general: "contiene" plegado en
--                                      codigo_interno, codigo_fabrica,
--                                      otros_codigos, nombre y la marca
--   Seis columnas con lista de valores, cada una con "solo estos" / "todos menos estos":
--     codigos / sin_codigos                    sobre codigo_interno
--     codigos_fabrica / sin_codigos_fabrica    sobre codigo_fabrica
--     otros_codigos / sin_otros_codigos        sobre otros_codigos unidos con ', '
--     categorias / sin_categorias              sobre categoria
--     descripciones / sin_descripciones        sobre nombre
--     marcas / sin_marcas                      sobre descripcion (la marca)
--   precio_min, precio_max, stock_min, stock_max   rangos inclusivos
--   con_stock   boolean                       true: stock > 0 · false: stock = 0
--   estado      'activo'|'inactivo'           otro valor = sin filtro
--
-- El buscador general `q` se combina con AND con todo lo demás y llega también a
-- las listas, que lo heredan por pasar por `productos_filtrados`. La marca
-- buscable es el texto real de `descripcion`: el sentinela '(sin marca)' es un
-- valor de lista, no un texto que alguien haya escrito, así que "sin marca" no
-- trae los productos sin marca. La categoría no entra (tiene su columna).
--
-- Los filtros de columnas distintas se combinan con AND (Excel): cada lista de
-- valores se calcula con TODOS los filtros menos el de su propia columna.
--
-- Incluir y excluir son excluyentes por columna (lo valida el schema Zod); acá,
-- si llegaran los dos, se aplican los dos. Una clave de lista que no sea un
-- array se ignora en vez de romper la consulta.
--
-- Los textos se comparan con `plegar_texto` (minúsculas, sin tildes), el mismo
-- plegado de `buscar_productos`; en TypeScript lo espeja `plegarTexto`.
--
-- Valor de cada lista. Un solo criterio, el mismo en el filtro y en la lista, para
-- que lo que la lista devuelve sea EXACTAMENTE lo que se filtra:
--   codigo         = codigo_interno tal cual (es único y es la clave de la fila)
--   codigo_fabrica = recortado, o '(sin cód. de fábrica)' si queda vacío
--   otros_codigos  = unidos con ', ' y recortados, o '(sin otros códigos)'
--   categoria      = recortada, o '(sin categoría)'
--   descripcion    = nombre recortado, o '(sin descripción)'
--   marca          = descripcion recortada, o '(sin marca)'
-- El recorte es `btrim(x, E' \t\r\n\u00a0')`: espacio, tab, CR, LF y NBSP. En TypeScript es
-- `normalizarValor`; NO es `String.trim()`, que quita más. Los literales son los de
-- `columnas-productos.ts`.

-- La columna generada de abajo reescribe `productos` y el índice se construye
-- bloqueando las escrituras. Si otra transacción tiene la tabla tomada, mejor
-- abortar a los 5 s que dejar una cola de lock exclusivo detrás de ella.
set local lock_timeout = '5s';

-- =========================================================================
-- 0. Columnas generadas e índices
-- =========================================================================

-- Buscador general (`q`). Una columna generada con los cinco campos que busca,
-- plegados y separados por chr(31) (separador de unidad), y un GIN trigram encima.
--
-- Por qué una columna y no cinco condiciones. `productos.busqueda` ya junta casi
-- los mismos campos, pero también la categoría, y `q` no la busca: usarla sola
-- devolvería productos que solo coinciden en la categoría, y descartarlos con
-- cinco `plegar_texto(...) like` por fila cuesta. Con esta columna lo resuelve una
-- sola comparación. Con 3 o más letras el índice trigram trae solo los candidatos.
--
-- El separador impide que un `q` con espacios coincida a caballo entre dos
-- campos ("q-003 filtro" no encuentra el código de un producto y el nombre de
-- otro): cada campo se busca por separado, como en TypeScript. Un `q` que
-- tuviera el propio chr(31) no coincidiría con nada, que es lo correcto.
--
-- Los alternos se unen con espacio (`codigos_a_texto`), igual que en
-- `productos.busqueda`. La marca es el texto real de `descripcion`.
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

-- Orden numérico del código. `codigo_interno` es texto, y ordenado como texto
-- `1, 10000, 10001, …, 1001`: el código de la casa (la columna `No.Item` del
-- inventario) es un número y se espera `1, 2, …, 10, 100, 1000`. Los códigos que no
-- son todo dígitos quedan nulos y van al final, desempatados por el texto. El
-- límite de 18 dígitos es lo que cabe en un bigint (el regex lo garantiza antes del
-- cast).
alter table public.productos
  add column if not exists codigo_interno_orden bigint
  generated always as (
    case when codigo_interno ~ '^[0-9]{1,18}$' then codigo_interno::bigint end
  ) stored;

comment on column public.productos.codigo_interno_orden is
  'codigo_interno como numero si es todo digitos (hasta 18), si no null. Generada. Ordena la columna Codigo de /productos.';

-- =========================================================================
-- 1. Helpers
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

-- Un array jsonb de strings como text[]. Una clave ausente, que no sea un array, o
-- un filtro nulo dan el array vacío: se ignora en vez de romper la consulta.
create function public.jsonb_lista(p_filtros jsonb, p_clave text)
returns text[]
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when jsonb_typeof(p_filtros -> p_clave) = 'array'
      then array(select jsonb_array_elements_text(p_filtros -> p_clave))
    else '{}'::text[]
  end
$$;

comment on function public.jsonb_lista(jsonb, text) is
  'p_filtros -> p_clave como text[]; vacio si falta o no es un array.';

-- =========================================================================
-- 2. El predicado único
-- =========================================================================

-- Devuelve lo que necesitan sus dos clientes: el listado ordena y recorta por `id`;
-- las listas de valores agrupan por el valor de UNA columna. `p_excluir` es el nombre
-- de una columna ('codigo' | 'codigo_fabrica' | 'otros_codigos' | 'categoria' |
-- 'descripcion' | 'marca'): salta TODOS los filtros de esa columna (incluir y
-- excluir), que es lo que necesita su lista para no vaciarse al marcar un valor.
create function public.productos_filtrados(p_filtros jsonb, p_excluir text default null)
returns table (
  id uuid,
  v_codigo text,
  v_codigo_fabrica text,
  v_otros_codigos text,
  v_categoria text,
  v_descripcion text,
  v_marca text
)
language plpgsql
stable
security invoker
set search_path = ''
set plan_cache_mode = force_custom_plan
as $function$
#variable_conflict use_column
declare
  v_codigos text[] := public.jsonb_lista(p_filtros, 'codigos');
  v_sin_codigos text[] := public.jsonb_lista(p_filtros, 'sin_codigos');
  v_codigos_fab text[] := public.jsonb_lista(p_filtros, 'codigos_fabrica');
  v_sin_codigos_fab text[] := public.jsonb_lista(p_filtros, 'sin_codigos_fabrica');
  v_otros text[] := public.jsonb_lista(p_filtros, 'otros_codigos');
  v_sin_otros text[] := public.jsonb_lista(p_filtros, 'sin_otros_codigos');
  v_cats text[] := public.jsonb_lista(p_filtros, 'categorias');
  v_sin_cats text[] := public.jsonb_lista(p_filtros, 'sin_categorias');
  v_descs text[] := public.jsonb_lista(p_filtros, 'descripciones');
  v_sin_descs text[] := public.jsonb_lista(p_filtros, 'sin_descripciones');
  v_marcas text[] := public.jsonb_lista(p_filtros, 'marcas');
  v_sin_marcas text[] := public.jsonb_lista(p_filtros, 'sin_marcas');
  -- Patrón del buscador general, o null si no hay búsqueda.
  v_q text := case
    when nullif(btrim(p_filtros ->> 'q', E' \t\r\n\u00a0'), '') is null then null
    else '%' || public.escapar_like(
      public.plegar_texto(btrim(p_filtros ->> 'q', E' \t\r\n\u00a0'))
    ) || '%'
  end;
begin
  return query
  select p.id, n.codigo, n.codigo_fabrica, n.otros_codigos, n.categoria, n.descripcion, n.marca
  from public.productos as p
  cross join lateral (
    select
      p.codigo_interno as codigo,
      coalesce(nullif(btrim(p.codigo_fabrica, E' \t\r\n\u00a0'), ''), '(sin cód. de fábrica)')
        as codigo_fabrica,
      coalesce(
        nullif(btrim(array_to_string(p.otros_codigos, ', '), E' \t\r\n\u00a0'), ''),
        '(sin otros códigos)'
      ) as otros_codigos,
      coalesce(nullif(btrim(p.categoria, E' \t\r\n\u00a0'), ''), '(sin categoría)') as categoria,
      coalesce(nullif(btrim(p.nombre, E' \t\r\n\u00a0'), ''), '(sin descripción)') as descripcion,
      coalesce(nullif(btrim(p.descripcion, E' \t\r\n\u00a0'), ''), '(sin marca)') as marca
  ) as n
  where
    (v_q is null or p.busqueda_general like v_q)
    and (
      p_excluir is not distinct from 'codigo'
      or (
        (cardinality(v_codigos) = 0 or n.codigo = any (v_codigos))
        and not (n.codigo = any (v_sin_codigos))
      )
    )
    and (
      p_excluir is not distinct from 'codigo_fabrica'
      or (
        (cardinality(v_codigos_fab) = 0 or n.codigo_fabrica = any (v_codigos_fab))
        and not (n.codigo_fabrica = any (v_sin_codigos_fab))
      )
    )
    and (
      p_excluir is not distinct from 'otros_codigos'
      or (
        (cardinality(v_otros) = 0 or n.otros_codigos = any (v_otros))
        and not (n.otros_codigos = any (v_sin_otros))
      )
    )
    and (
      p_excluir is not distinct from 'categoria'
      or (
        (cardinality(v_cats) = 0 or n.categoria = any (v_cats))
        and not (n.categoria = any (v_sin_cats))
      )
    )
    and (
      p_excluir is not distinct from 'descripcion'
      or (
        (cardinality(v_descs) = 0 or n.descripcion = any (v_descs))
        and not (n.descripcion = any (v_sin_descs))
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
      or p_filtros ->> 'estado' not in ('activo', 'inactivo')
      or p.activo = (p_filtros ->> 'estado' = 'activo')
    );
end
$function$;

comment on function public.productos_filtrados(jsonb, text) is
  'Predicado unico de los filtros de /productos: devuelve id y el valor de cada columna con lista (ya recortado, con el sentinela de vacio) de los productos que lo cumplen. p_excluir salta los filtros de una columna (su lista de valores).';

-- =========================================================================
-- 3. Un lote ordenado y el total real
-- =========================================================================

-- Devuelve `{ total, items }` como jsonb. Un objeto y no un `table(...)`: el lote
-- vacío (fuera de rango) igual trae el total, cosa que un `count(*) over ()` no puede
-- dar porque no hay fila donde ponerlo.
--
-- `p_orden` es un array jsonb `[{ "campo": "...", "dir": "asc"|"desc" }]` de hasta
-- tres niveles. El `order by` se arma con SQL dinámico, pero lo que se pega en la
-- consulta nunca sale del parámetro: cada `campo` se traduce con un `case` a una
-- expresión constante, un campo desconocido se ignora y `dir` solo puede ser
-- 'asc' o 'desc'. Campos: codigo, codigo_fabrica, otros_codigos, categoria,
-- descripcion, marca, precio, stock, estado. Los vacíos van al final en las dos
-- direcciones. Sin ningún nivel válido se ordena por `nombre`.
--
-- Siempre se agrega el código (numérico y después texto) como último criterio:
-- `codigo_interno` es UNIQUE, así que el orden es TOTAL. Con un orden total los lotes
-- (offset/limit) no repiten ni saltean filas aunque dos productos empaten en todo lo
-- demás.
--
-- Los lotes se eligen ordenando solo las claves y recién entonces se leen las ≤1.000
-- filas por clave. Solo se devuelven las columnas que la tabla muestra y que el
-- formulario de edición necesita: con 21.000 filas, cada byte de más se paga 21.000
-- veces en la carga completa.
create function public.productos_listar(
  p_filtros jsonb,
  p_orden jsonb default '[]'::jsonb,
  p_desde integer default 0,
  p_cantidad integer default 1000
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
set plan_cache_mode = force_custom_plan
as $function$
declare
  v_nivel record;
  -- Los bordes que se recortan: espacio, tab, CR, LF y NBSP. Mismo conjunto que
  -- `normalizarValor` en TypeScript.
  v_bordes constant text := E' \t\r\n\u00a0';
  v_dir text;
  v_clave text;
  v_orden text := '';
  v_cantidad integer := greatest(1, least(coalesce(p_cantidad, 1000), 1000));
  v_desde integer := greatest(coalesce(p_desde, 0), 0);
  v_res jsonb;
begin
  for v_nivel in
    select e.value ->> 'campo' as campo, e.value ->> 'dir' as dir
    from jsonb_array_elements(
      case when jsonb_typeof(p_orden) = 'array' then p_orden else '[]'::jsonb end
    ) with ordinality as e (value, ord)
    order by e.ord
    limit 3
  loop
    v_dir := case when v_nivel.dir = 'desc' then 'desc' else 'asc' end;
    v_clave := case v_nivel.campo
      when 'codigo' then
        format('p.codigo_interno_orden %1$s nulls last, p.codigo_interno %1$s', v_dir)
      when 'codigo_fabrica' then
        format('nullif(btrim(p.codigo_fabrica, %2$L), %3$L) %1$s nulls last', v_dir, v_bordes, '')
      when 'otros_codigos' then
        format(
          'nullif(btrim(array_to_string(p.otros_codigos, %2$L), %4$L), %3$L) %1$s nulls last',
          v_dir, ', ', '', v_bordes
        )
      when 'categoria' then
        format('nullif(btrim(p.categoria, %2$L), %3$L) %1$s nulls last', v_dir, v_bordes, '')
      when 'descripcion' then
        format('nullif(btrim(p.nombre, %2$L), %3$L) %1$s nulls last', v_dir, v_bordes, '')
      when 'marca' then
        format('nullif(btrim(p.descripcion, %2$L), %3$L) %1$s nulls last', v_dir, v_bordes, '')
      when 'precio' then format('p.precio %1$s', v_dir)
      when 'stock' then format('p.stock %1$s', v_dir)
      -- Ascendente = activos primero (Activo antes que Inactivo).
      when 'estado' then format('(not p.activo) %1$s', v_dir)
      else null
    end;
    if v_clave is not null then
      v_orden := v_orden || v_clave || ', ';
    end if;
  end loop;

  if v_orden = '' then
    v_orden := 'p.nombre asc, ';
  end if;
  v_orden := v_orden || 'p.codigo_interno_orden asc nulls last, p.codigo_interno asc';

  execute format($q$
    with f as materialized (
      select x.id from public.productos_filtrados($1) as x
    ),
    total as (
      select count(*)::bigint as n from f
    ),
    ordenados as (
      select p.id, row_number() over (order by %s) as rn
      from public.productos as p
      join f on f.id = p.id
    ),
    lote as (
      select o.id, o.rn
      from ordenados as o
      where o.rn > $2 and o.rn <= $2 + $3
    )
    select jsonb_build_object(
      'total', (select n from total),
      'items', coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', p.id,
              'codigo_interno', p.codigo_interno,
              'codigo_fabrica', p.codigo_fabrica,
              'otros_codigos', to_jsonb(p.otros_codigos),
              'sku_proveedor', p.sku_proveedor,
              'nombre', p.nombre,
              'descripcion', p.descripcion,
              'categoria', p.categoria,
              'precio', p.precio,
              'stock', p.stock,
              'activo', p.activo
            )
            order by l.rn
          )
          from lote as l
          join public.productos as p on p.id = l.id
        ),
        '[]'::jsonb
      )
    )
  $q$, v_orden)
  into v_res
  using p_filtros, v_desde, v_cantidad;

  return v_res;
end
$function$;

comment on function public.productos_listar(jsonb, jsonb, integer, integer) is
  'Lote ordenado del catalogo filtrado + total real, como {total, items}. p_orden: hasta 3 niveles [{campo, dir}] sobre campos de una lista blanca; siempre desempata por codigo (orden total). p_cantidad se acota a 1..1000.';

-- =========================================================================
-- 4. La lista de valores de una columna
-- =========================================================================

-- Una fila por valor distinto de `p_columna`, con su cantidad, estilo Excel. Se cuenta
-- con todos los filtros menos los de esa columna. Orden: cantidad desc y, a igual
-- cantidad, el valor en orden binario (`collate "C"`) para que no dependa de la
-- collation de la base; en el código el desempate es numérico primero.
--
-- `p_busqueda` busca dentro de la lista —plegado— ANTES del límite, así un valor de una
-- sola fila fuera del top sigue siendo encontrable. En el código la búsqueda es por
-- igualdad sin distinguir mayúsculas (buscar `3` ofrece solo `3`, no `13`); en las demás,
-- "contiene", plegado. La
-- búsqueda recorta también a los seleccionados.
--
-- Se devuelven los `p_limite` primeros más los valores seleccionados (los de incluir
-- y los de excluir) que coinciden con la búsqueda, aunque queden fuera del tope o no
-- tengan filas: esos van con cantidad 0. `distintos` repite en cada fila cuántos
-- valores CON FILAS hay (los seleccionados con 0 no cuentan), para que la pantalla
-- pueda avisar que la lista está recortada.
create function public.productos_faceta(
  p_filtros jsonb,
  p_columna text,
  p_limite integer default 500,
  p_busqueda text default null
)
returns table (valor text, cantidad bigint, distintos bigint)
language plpgsql
stable
security invoker
set search_path = ''
as $function$
#variable_conflict use_column
declare
  v_sel text[];
  v_buscar text := nullif(btrim(p_busqueda, E' \t\r\n\u00a0'), '');
  v_exacta boolean := p_columna = 'codigo';
  v_patron text;
begin
  if p_columna is null
    or p_columna not in (
      'codigo', 'codigo_fabrica', 'otros_codigos', 'categoria', 'descripcion', 'marca'
    ) then
    raise exception 'columna de lista invalida: %', coalesce(p_columna, '<null>')
      using errcode = '22023';
  end if;

  -- El patrón se arma UNA vez. En el código la búsqueda es por igualdad (sin distinguir
  -- mayúsculas) y en las demás es "contiene" plegado.
  v_patron := case
    when v_buscar is null then null
    when v_exacta then lower(v_buscar)
    else '%' || public.escapar_like(public.plegar_texto(v_buscar)) || '%'
  end;

  v_sel := case p_columna
    when 'codigo' then public.jsonb_lista(p_filtros, 'codigos')
      || public.jsonb_lista(p_filtros, 'sin_codigos')
    when 'codigo_fabrica' then public.jsonb_lista(p_filtros, 'codigos_fabrica')
      || public.jsonb_lista(p_filtros, 'sin_codigos_fabrica')
    when 'otros_codigos' then public.jsonb_lista(p_filtros, 'otros_codigos')
      || public.jsonb_lista(p_filtros, 'sin_otros_codigos')
    when 'categoria' then public.jsonb_lista(p_filtros, 'categorias')
      || public.jsonb_lista(p_filtros, 'sin_categorias')
    when 'descripcion' then public.jsonb_lista(p_filtros, 'descripciones')
      || public.jsonb_lista(p_filtros, 'sin_descripciones')
    else public.jsonb_lista(p_filtros, 'marcas') || public.jsonb_lista(p_filtros, 'sin_marcas')
  end;

  return query
  with
  sel as (
    select distinct s.v from unnest(v_sel) as s (v)
  ),
  cuenta as (
    select
      case p_columna
        when 'codigo' then f.v_codigo
        when 'codigo_fabrica' then f.v_codigo_fabrica
        when 'otros_codigos' then f.v_otros_codigos
        when 'categoria' then f.v_categoria
        when 'descripcion' then f.v_descripcion
        else f.v_marca
      end as valor,
      count(*) as cantidad
    from public.productos_filtrados(p_filtros, p_columna) as f
    group by 1
  ),
  todo as (
    select coalesce(c.valor, s.v) as valor, coalesce(c.cantidad, 0) as cantidad
    from cuenta as c
    full join sel as s on s.v = c.valor
  ),
  rango as (
    select
      t.valor,
      t.cantidad,
      row_number() over (
        order by
          t.cantidad desc,
          case when v_exacta and t.valor ~ '^[0-9]{1,18}$' then t.valor::bigint end nulls last,
          t.valor collate "C"
      ) as pos,
      count(*) filter (where t.cantidad > 0) over () as distintos
    from todo as t
    where v_patron is null
      or (
        case when v_exacta
          then lower(t.valor) = v_patron
          -- Lo mismo que `plegar_texto`, escrito en línea: esa función lleva `set search_path`
          -- y Postgres no inlinea una función con `set`, así que llamarla por cada valor de
          -- una lista de miles cuesta 20 veces más.
          else translate(lower(t.valor), 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunaeiouun') like v_patron
        end
      )
  )
  select r.valor, r.cantidad, r.distintos
  from rango as r
  where r.pos <= greatest(least(coalesce(p_limite, 500), 3000), 0)
    or r.valor in (select v from sel)
  order by
    r.cantidad desc,
    case when v_exacta and r.valor ~ '^[0-9]{1,18}$' then r.valor::bigint end nulls last,
    r.valor collate "C";
end
$function$;

comment on function public.productos_faceta(jsonb, text, integer, text) is
  'Valores distintos de UNA columna (codigo, codigo_fabrica, otros_codigos, categoria, descripcion, marca) con su cantidad, con todos los filtros menos los de esa columna. p_busqueda busca dentro de la lista antes del limite (igualdad en el codigo). Los valores seleccionados siempre salen; distintos no los cuenta si no tienen filas.';

-- =========================================================================
-- Permisos: solo usuarios autenticados y service_role; anon no entra.
-- =========================================================================

revoke all on function public.escapar_like(text) from public, anon;
revoke all on function public.jsonb_lista(jsonb, text) from public, anon;
revoke all on function public.productos_filtrados(jsonb, text) from public, anon;
revoke all on function public.productos_listar(jsonb, jsonb, integer, integer)
  from public, anon;
revoke all on function public.productos_faceta(jsonb, text, integer, text) from public, anon;

grant execute on function public.escapar_like(text) to authenticated, service_role;
grant execute on function public.jsonb_lista(jsonb, text) to authenticated, service_role;
grant execute on function public.productos_filtrados(jsonb, text) to authenticated, service_role;
grant execute on function public.productos_listar(jsonb, jsonb, integer, integer)
  to authenticated, service_role;
grant execute on function public.productos_faceta(jsonb, text, integer, text)
  to authenticated, service_role;
