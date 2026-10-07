-- `buscar_productos` entiende las abreviaturas del inventario y los lados.
--
-- OBSERVACION y CAUSA RAIZ: ver 20261008120000_catalogo_abreviaturas.sql. «Amortiguadores
-- delanteros» para un Kia Niro 2020 no encontraba `AMORTIG DELT`.
--
-- FIX
--
-- 1. Cada palabra del cliente se pliega a las abreviaturas ACTIVAS cuya expansion
--    tiene su misma raiz (`catalogo_raiz`: singular, plural y genero) o que ella
--    misma escribio (`lh`). Una palabra que se pliega a una abreviatura de
--    `posicion` o `atributo` ya no es una palabra OBLIGATORIA: es un filtro. Las
--    palabras que dicen que pieza es son las `requeridas`.
-- 2. Ademas, una palabra de 5 letras o mas se compara por PREFIJO contra los tokens
--    de la categoria y el nombre de 4 letras o mas: `amortiguadores` ~ `AMORTIG`.
--    Funciona aunque la tabla de abreviaturas este vacia.
-- 3. Las posiciones pedidas («delanteros», «izquierdo», «traseros») descartan los
--    productos que dicen el lado contrario (`AMORTIG POST`, `RH`) y ordenan primero
--    a los que dicen el pedido. Un producto que no dice lado se queda (no sabemos).
--    «Traseros» y «posteriores» son el mismo lado (`catalogo_lado`).
-- 4. Los grupos de tipo `ruido` (`REPUESTO EMG`) van despues de todo lo demas,
--    detras incluso del parecido de la categoria, pero no se descartan.
-- 5. Los grupos que no son repuestos (`catalogo_grupos_excluidos`: REPUESTO EMG, GASTOS
--    VARIOS, OTROS, OTROS INGRESOS, ACTIVOS FIJOS) no se buscan ni se cotizan.
-- 6. El modelo que dijo el cliente tambien sirve si aparece al FINAL de
--    `compatibilidad[].modelo_nombre` («kia niro» para «niro») aunque el modelo no
--    este en `catalogo_modelos`.
--
-- Espeja `puntaje.ts`, `categoria.ts`, `abreviaturas.ts` y `compatibilidad.ts`; la
-- paridad se prueba en tests/integration/buscar-productos-abreviaturas.supabase.test.ts.
--
-- ESTRUCTURA Y RENDIMIENTO
--
-- Los cuatro escaneos del UNION se conservan (ver 20260826010000: volver a juntarlos
-- en un OR arrastra todo a seq scan). Lo unico que cambia es el predicado del cuarto:
-- una palabra admite la fila si esta como subcadena en `busqueda` (como antes) o si
-- alguno de sus tokens de abreviatura o prefijo aparece como palabra completa
-- (`busqueda ~ '\m(amortig|amor|...)\M'`, que pg_trgm tambien acelera). La
-- normalizacion de la consulta es un puñado de filas; el puntaje se calcula sobre
-- los candidatos ya reducidos, con los tokens de categoria y nombre calculados una
-- sola vez por candidato.

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
  palabras00 as (
    select distinct t as palabra
    from consulta, unnest(regexp_split_to_array(consulta.q, '[^0-9a-z/.*-]+')) as t
    where length(t) > 1
      and t not in (
        'de','del','la','el','los','las','un','una','para','con','y','o','mi',
        'me','por','que','tiene','tienen','tenes','tienes','hay','busco',
        'necesito','quiero','precio','cuanto','cuesta'
      )
  ),
  -- La raiz y el lado de cada palabra, una vez (cada llamada a estas funciones cuesta).
  palabras0 as materialized (
    select w.palabra, public.catalogo_raiz(w.palabra) as raiz, public.catalogo_lado(w.palabra) as lado
    from palabras00 as w
  ),
  -- Las abreviaturas activas que no son basura, de UNA palabra: el token del
  -- inventario, la raiz de su expansion y el lado que dice (solo las posiciones).
  abrev as materialized (
    select a.clave as token, a.tipo, a.ambito, a.exp_raiz, a.lado
    from public.catalogo_abreviaturas as a
    where a.activo
      and a.tipo <> 'ruido'
      and a.clave <> ''
      and a.clave !~ ' '
  ),
  -- Los grupos basura del ERP (REPUESTO EMG), con las palabras separadas por espacio.
  ruido as materialized (
    select a.clave, a.ambito
    from public.catalogo_abreviaturas as a
    where a.activo and a.tipo = 'ruido'
  ),
  -- A que abreviaturas se pliega cada palabra: por la raiz de su expansion, porque
  -- la palabra ES la abreviatura, o (posiciones) por el lado que dice.
  enlaces as materialized (
    select w.palabra, a.token, a.tipo, a.ambito, a.lado
    from palabras0 as w
    join abrev as a
      on a.exp_raiz = w.raiz
      or a.token = w.palabra
      or (a.lado is not null and a.lado = w.lado)
  ),
  -- Requerida: dice QUE pieza es. Las que solo se pliegan a posicion o atributo son
  -- filtros.
  palabras1 as materialized (
    select
      w.palabra,
      not exists (select 1 from enlaces as e where e.palabra = w.palabra)
        or exists (select 1 from enlaces as e where e.palabra = w.palabra and e.tipo = 'pieza')
        as requerida
    from palabras0 as w
  ),
  -- Si TODAS son filtros («diesel», «izquierdo») no hay nada que obligue: vale el texto.
  palabras as materialized (
    select
      w.palabra,
      (w.requerida or not exists (select 1 from palabras1 as x where x.requerida)) as requerida,
      w.requerida as requerida_de_verdad
    from palabras1 as w
  ),
  req0 as materialized (
    select w.palabra from palabras as w where w.requerida
  ),
  -- Los lados que pidio: «delanteros» -> delantero.
  lados_pedidos as materialized (
    select coalesce(array_agg(distinct e.lado), '{}') as lados
    from enlaces as e
    join palabras as w on w.palabra = e.palabra and not w.requerida
    where e.tipo = 'posicion' and e.lado is not null
  ),
  -- Que tokens del catalogo cuentan como cada palabra requerida, y donde valen: sus
  -- abreviaturas de pieza y los prefijos.
  terminos as materialized (
    select e.palabra, e.token, e.ambito
    from enlaces as e
    join req0 as r on r.palabra = e.palabra
    where e.tipo = 'pieza'
    union
    select r.palabra, substr(r.palabra, 1, k.n), 'ambos'
    from req0 as r
    cross join lateral generate_series(4, length(r.palabra) - 1) as k(n)
    where length(r.palabra) >= 5 and r.palabra ~ '^[0-9a-z]+$'
  ),
  -- Cada palabra requerida con sus tokens en dos arrays (los que valen en la categoria y
  -- los que valen en el nombre) y un regex con todos, para admitir filas.
  requeridas as materialized (
    select
      r.palabra,
      coalesce((
        select array_agg(t.token) from terminos as t
        where t.palabra = r.palabra and t.ambito in ('categoria', 'ambos')
      ), '{}') as tk_cat,
      coalesce((
        select array_agg(t.token) from terminos as t
        where t.palabra = r.palabra and t.ambito in ('nombre', 'ambos')
      ), '{}') as tk_nom,
      (select '\m(' || string_agg(distinct t.token, '|') || ')\M' from terminos as t where t.palabra = r.palabra)
        as rx,
      -- Un LIKE barato que todo token cumple antes de correr el regex: la abreviatura
      -- misma, o las primeras 4 letras de la palabra (todo prefijo las contiene).
      (
        select array_agg(distinct '%' || g || '%')
        from (
          select t.token as g from terminos as t
          where t.palabra = r.palabra and left(t.token, 4) <> left(r.palabra, 4)
          union
          select left(r.palabra, 4)
          where exists (
            select 1 from terminos as t
            where t.palabra = r.palabra and left(t.token, 4) = left(r.palabra, 4)
          )
        ) as gs
      ) as guardas
    from req0 as r
  ),
  -- Los grupos del ERP que no son repuestos, plegados.
  grupos_excluidos as materialized (
    select coalesce(array_agg(g.clave), '{}') as claves from public.catalogo_grupos_excluidos as g
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
  -- palabras del vehiculo pedido (ni los filtros). Contra estas se compara la categoria.
  palabras_clave as (
    select w.palabra, w.tk_cat
    from requeridas as w
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
        and exists (
          select 1 from requeridas as w
          where p.busqueda like '%' || w.palabra || '%'
             or (w.rx is not null and p.busqueda like any (w.guardas) and p.busqueda ~ w.rx)
        )
  ),
  -- Los candidatos del UNION, una vez. Se materializa porque se lee dos veces:
  -- para decidir que elementos de compatibilidad sirven y para armar el resultado.
  base as materialized (
    select p.*
    from public.productos as p
    join ids on ids.id = p.id
    cross join grupos_excluidos as ge
    -- Los grupos que no son repuestos (catalogo_grupos_excluidos) nunca se buscan ni se cotizan.
    where not (public.plegar_texto(btrim(coalesce(p.categoria, ''))) = any (ge.claves))
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
                -- `modelo_nombre` lleva la marca delante («kia niro»).
                or right(x.mn, length(f.modelo) + 1) = ' ' || f.modelo
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
              and (
                x.mo = f.modelo
                or x.mn = f.modelo
                or right(x.mn, length(f.modelo) + 1) = ' ' || f.modelo
              )
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
  -- Materializado: el filtro de vehiculo descarta casi todo y el resto del trabajo
  -- (tokens, puntaje) se hace solo sobre lo que queda.
  candidatos as materialized (
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
  -- Los tokens de categoria y nombre, una vez por candidato.
  -- Los grupos basura como arrays, para compararlos sin recorrer la tabla por candidato.
  ruido_arr as materialized (
    select
      coalesce(array_agg(r.clave) filter (where r.ambito in ('categoria', 'ambos')), '{}') as cat,
      coalesce(array_agg(r.clave) filter (where r.ambito in ('nombre', 'ambos')), '{}') as nom
    from ruido as r
  ),
  -- Los textos plegados y los tokens de categoria y nombre, una vez por candidato. El
  -- plegado va inline (el mismo translate(lower(..)) de plegar_texto): una llamada a la
  -- funcion por texto y por candidato era lo mas caro de la busqueda sin vehiculo.
  fila as (
    select
      c.*,
      translate(lower(coalesce(c.categoria, '')), 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunaeiouun') as cat_p,
      translate(lower(c.codigo_interno), 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunaeiouun') as cod_p,
      translate(lower(c.nombre), 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunaeiouun') as nom_p,
      translate(lower(coalesce(c.descripcion, '')), 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunaeiouun') as desc_p
    from candidatos as c
  ),
  fila_tokens as (
    select
      f.*,
      array_remove(regexp_split_to_array(f.cat_p, '[^0-9a-z]+'), '') as tok_cat,
      array_remove(regexp_split_to_array(f.nom_p, '[^0-9a-z]+'), '') as tok_nom
    from fila as f
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
      s.suma,
      s.aciertos,
      s.total_palabras,
      k.cat_aciertos,
      k.cat_total,
      -- Delante/atras, izquierda/derecha: 2 lo dice, 1 no dice lado, 0 dice el contrario.
      case
        when cardinality(lp.lados) = 0 then 1
        else public.catalogo_nivel_lado(
          coalesce((
            select array_agg(distinct a.lado)
            from abrev as a
            where a.lado is not null and a.token = any (c.tok_nom || c.tok_cat)
          ), '{}'),
          lp.lados
        )
      end as nivel_lado,
      -- Grupo basura del ERP: va despues de todo lo demas.
      (
        array_to_string(c.tok_cat, ' ') = any (ra.cat)
        or array_to_string(c.tok_nom, ' ') = any (ra.nom)
      ) as es_ruido
    from fila_tokens as c
    cross join consulta as q
    cross join lados_pedidos as lp
    cross join ruido_arr as ra
    cross join lateral (
      select
        coalesce(
          sum(
            greatest(
              case
                when c.cod_p like '%' || w.palabra || '%' then 10
                when c.cat_p = w.palabra then 9
                when c.nom_p like '%' || w.palabra || '%' then 8
                when c.cat_p like '%' || w.palabra || '%' then 6
                when c.desc_p like '%' || w.palabra || '%' then 3
                else 0
              end,
              -- Lo mismo contra las abreviaturas y prefijos de la palabra.
              case
                when c.cat_p = any (w.tk_cat) then 9
                when c.tok_nom && w.tk_nom then 8
                when c.tok_cat && w.tk_cat then 6
                else 0
              end
            )
          )::int,
          0
        ) as suma,
        (
          count(*) filter (
            where c.busqueda like '%' || w.palabra || '%'
              or c.tok_cat && w.tk_cat
              or c.tok_nom && w.tk_nom
          )
        )::int as aciertos,
        count(*)::int as total_palabras
      from requeridas as w
    ) as s
    cross join lateral (
      select
        (
          count(*) filter (where c.cat_p like '%' || kk.palabra || '%' or c.tok_cat && kk.tk_cat)
        )::int as cat_aciertos,
        count(*)::int as cat_total
      from palabras_clave as kk
    ) as k
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
  -- Pidio delanteros y el producto es POST (nivel_lado 0): no se ofrece.
  where (exacto > 0 or suma > 0) and nivel_lado > 0
  -- Quien dicta un codigo lo encuentra primero, sea cual sea su vehiculo; despues la
  -- basura del ERP al final, que la categoria sea la pieza pedida y no una que
  -- comparte una palabra, el lado pedido, luego cuanto confirma el vehiculo, y
  -- recien ahi el texto y la existencia.
  order by
    (exacto > 0) desc,
    es_ruido asc,
    (case
       when cat_total < 2 or btrim(coalesce(categoria, '')) = '' then 2
       when cat_aciertos = cat_total then 2
       when cat_aciertos > 0 then 1
       else 0
     end) desc,
    nivel_lado desc,
    nivel desc, puntaje desc, stock desc, nombre asc
  limit greatest(1, least(coalesce(p_tope, 20), 50))
$function$;

revoke all on function public.buscar_productos(text, text, text, integer, integer, text) from public;
revoke all on function public.buscar_productos(text, text, text, integer, integer, text) from anon;
grant execute on function public.buscar_productos(text, text, text, integer, integer, text) to authenticated;
grant execute on function public.buscar_productos(text, text, text, integer, integer, text) to service_role;

comment on function public.buscar_productos(text, text, text, integer, integer, text) is
  'Busqueda del catalogo por codigo de fabrica, codigo interno, alternos y texto, con filtro de vehiculo (marca, modelo resuelto por catalogo_modelos o por modelo_nombre, anio, cilindrada) sobre productos.compatibilidad. Las palabras del cliente se pliegan a catalogo_abreviaturas (AMORTIG) y a prefijos; delanteros/traseros/izquierdo/derecho son filtros de lado. Ordena por codigo exacto, basura del ERP al final, parecido de la categoria con la pieza pedida, lado pedido, nivel_vehiculo (7..0, -1 sin compatibilidad, -2 contradice), puntaje, existencia y nombre. Devuelve en `compatibilidad` solo los elementos que justifican el match. Los candidatos salen de un UNION y no de un OR para no caer a seq scan.';
