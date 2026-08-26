-- El catálogo gana el número de fábrica, y la búsqueda aprende a usarlo.
--
-- Contexto de por qué esto es lo primero que hay que hacer:
--
-- `buscar_productos` se escribió el 2026-08-15 para matar un bug concreto —el
-- agente veía 1.000 de 19.731 productos porque PostgREST corta ahí y el filtro
-- vivía en memoria— y **nunca se cableó**. La única referencia a la función en
-- todo `src/` es el tipo autogenerado. `catalog-matcher.service.ts` sigue
-- haciendo `productos.list({activo:true})` sin límite, y en
-- `productos.supabase.repo.ts` un `list` sin `limit` no aplica ningún `.range()`.
-- O sea: el bug documentado como resuelto está vivo. Esta migración es la
-- mitad SQL del arreglo; la otra mitad es el `search()` del repo.
--
-- Lo nuevo:
--
-- El inventario real tiene tres códigos por fila, no uno:
--   `No.Item`      → el que pone la casa              → `codigo_interno` (ya existía)
--   `Código`       → el NÚMERO DE FÁBRICA             → `codigo_fabrica`  (nuevo)
--   `Otros Códs.`  → alternos, casi todos de proveedor → `otros_codigos`  (nuevo)
--
-- Medido sobre las 21.009 filas del inventario del 2026-08-22: el 77,0% tiene
-- número de fábrica reconocible en alguna de las dos columnas de código. Ese
-- número es lo que permite vender exacto cuando el cliente trae la pieza vieja
-- en la mano, que es la venta más rápida que existe en este negocio.
--
-- Los alternos van con peso BAJO a propósito: la mayoría son códigos de
-- proveedor sin valor para el cliente. Pero hay 343 filas donde el número de
-- fábrica aparece SOLO ahí, así que tirarlos cuesta 343 ventas y guardarlos
-- cuesta una columna.

-- =========================================================================
-- 1. Plegado de códigos, indexable
-- =========================================================================

/*
 * Espejo EXACTO de `plegarCodigo` en `src/lib/catalogo/normalizar-codigo.ts`.
 * Si una cambia sin la otra, la búsqueda del agente y la de la pantalla dejan
 * de coincidir en silencio — la misma trampa que ya advierte el comentario de
 * `buscar_productos` sobre `relevanceScore`.
 *
 * Qué pela: los sufijos que la casa le agrega al número de fábrica.
 *   MEDIDA  `/STD` `/0` `/2` `/0.50` `/1.00`   (sobremedida de rectificación)
 *   ORIGEN  `/ORG` `/K` `/CH` `/JP` `/NPR`      (procedencia o marca)
 *
 * Pela SOLO desde el final y corta apenas encuentra algo que no es sufijo.
 * Medido: 9 códigos sobre 25.429 quedan sin pelar del todo por esa regla, y
 * los 9 son basura de carga a mano. Filtrar segmentos del medio haría esta
 * función ilegible y el espejo con TypeScript, imposible de sostener.
 */
create or replace function public.plegar_codigo(t text)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $function$
  with limpio as (
    -- La medida separada por espacio solo se pela si es inequívoca (`STD` o un
    -- decimal): `6PK2005 25212-37112` es un código real, y un entero suelto
    -- detrás de un espacio puede ser parte del número.
    select regexp_replace(btrim(coalesce(t, '')), '\s+(STD|\d{1,2}\.\d{1,2})$', '', 'i') as c
  ),
  -- Cuatro pasadas: la cadena más larga observada en el inventario real tiene
  -- tres sufijos (`.../0.25/NPR`), y la cuarta cubre el margen.
  p1 as (select regexp_replace(c, '/\s*(STD|\d{1,2}(\.\d{1,2})?|ORG|OEM|K|KR|CH|JP|JAPON|C|TW|USA|BR|IND|PLS|X|NPR|IZU|MET|NP)?[-\s]*$', '', 'i') as c from limpio),
  p2 as (select regexp_replace(c, '/\s*(STD|\d{1,2}(\.\d{1,2})?|ORG|OEM|K|KR|CH|JP|JAPON|C|TW|USA|BR|IND|PLS|X|NPR|IZU|MET|NP)?[-\s]*$', '', 'i') as c from p1),
  p3 as (select regexp_replace(c, '/\s*(STD|\d{1,2}(\.\d{1,2})?|ORG|OEM|K|KR|CH|JP|JAPON|C|TW|USA|BR|IND|PLS|X|NPR|IZU|MET|NP)?[-\s]*$', '', 'i') as c from p2),
  p4 as (select regexp_replace(c, '/\s*(STD|\d{1,2}(\.\d{1,2})?|ORG|OEM|K|KR|CH|JP|JAPON|C|TW|USA|BR|IND|PLS|X|NPR|IZU|MET|NP)?[-\s]*$', '', 'i') as c from p3)
  select upper(regexp_replace(c, '[^A-Za-z0-9]', '', 'g')) from p4
$function$;

comment on function public.plegar_codigo(text) is
  'Codigo de repuesto sin sufijos de medida ni de origen y sin separadores. Espejo de plegarCodigo() en src/lib/catalogo/normalizar-codigo.ts.';

/*
 * La versión array, para los alternos. Los vacíos se descartan: un `''` en la
 * lista mechearía contra cualquier consulta que pliegue a vacío.
 */
create or replace function public.plegar_codigos(ts text[])
returns text[]
language sql
immutable
strict
parallel safe
set search_path = ''
as $function$
  select coalesce(
    array(
      select distinct public.plegar_codigo(x)
      from unnest(coalesce(ts, '{}'::text[])) as x
      where public.plegar_codigo(x) <> ''
    ),
    '{}'::text[]
  )
$function$;

comment on function public.plegar_codigos(text[]) is
  'plegar_codigo aplicado a un array, sin vacios ni repetidos.';

/*
 * Une un array de códigos en una línea, para poder meterlo en la columna
 * generada `busqueda`.
 *
 * No usa `array_to_string` a propósito: esa función está marcada STABLE —opera
 * sobre `anyarray` y la salida del tipo elemento podría no ser inmutable— y
 * Postgres rechaza una columna generada que la invoque. Declararla inmutable
 * con un wrapper sería mentirle al planner. `string_agg` con `order by`
 * explícito sobre `with ordinality` es determinístico de verdad.
 */
create or replace function public.codigos_a_texto(ts text[])
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $function$
  select coalesce((
    select string_agg(u.x, ' ' order by u.ord)
    from unnest(coalesce(ts, '{}'::text[])) with ordinality as u(x, ord)
  ), '')
$function$;

comment on function public.codigos_a_texto(text[]) is
  'Une un array de codigos con espacios. Inmutable de verdad: no usa array_to_string, que es STABLE.';

-- =========================================================================
-- 2. Las columnas nuevas
-- =========================================================================

alter table public.productos
  add column if not exists codigo_fabrica text,
  add column if not exists otros_codigos text[] not null default '{}'::text[];

comment on column public.productos.codigo_fabrica is
  'Numero de parte del fabricante (columna "Codigo" del inventario). Es lo que trae grabado la pieza vieja.';
comment on column public.productos.otros_codigos is
  'Codigos alternos, mayormente de proveedor. Peso bajo en buscar_productos a proposito.';

-- Columnas plegadas: es contra estas que se machea, no contra el texto crudo.
alter table public.productos
  add column if not exists codigo_fabrica_plegado text
    generated always as (public.plegar_codigo(coalesce(codigo_fabrica, ''))) stored,
  add column if not exists codigo_interno_plegado text
    generated always as (public.plegar_codigo(codigo_interno)) stored;

comment on column public.productos.codigo_fabrica_plegado is
  'codigo_fabrica sin sufijos ni separadores. Generada: no se escribe a mano.';
comment on column public.productos.codigo_interno_plegado is
  'codigo_interno sin sufijos ni separadores. Generada: no se escribe a mano.';

-- Igualdad exacta: btree. Parciales porque las filas sin codigo no aportan
-- nada al indice y el catalogo real tiene 23% sin numero de fabrica.
create index if not exists productos_codigo_fabrica_plegado_idx
  on public.productos (codigo_fabrica_plegado)
  where codigo_fabrica_plegado <> '';

create index if not exists productos_codigo_interno_plegado_idx
  on public.productos (codigo_interno_plegado)
  where codigo_interno_plegado <> '';

-- Los alternos son un array: GIN sobre la expresion plegada, para que
-- `plegar_codigos(otros_codigos) @> array[x]` no escanee la tabla.
create index if not exists productos_otros_codigos_plegados_idx
  on public.productos using gin (public.plegar_codigos(otros_codigos));

-- =========================================================================
-- 3. `busqueda` incorpora el numero de fabrica
-- =========================================================================

-- Una columna generada no se puede ALTERar: hay que rehacerla. Hoy la tabla
-- tiene 0 filas (el catalogo se vacio a proposito), asi que el rewrite es
-- gratis. Con catalogo cargado esto toma un lock de tabla — hacerlo en
-- ventana, no en caliente.
drop index if exists public.productos_busqueda_trgm_idx;
alter table public.productos drop column if exists busqueda;

alter table public.productos
  add column busqueda text
  generated always as (
    public.plegar_texto(
      coalesce(codigo_interno, '') || ' ' ||
      coalesce(codigo_fabrica, '') || ' ' ||
      public.codigos_a_texto(otros_codigos) || ' ' ||
      coalesce(nombre, '') || ' ' ||
      coalesce(categoria, '') || ' ' ||
      coalesce(descripcion, '')
    )
  ) stored;

comment on column public.productos.busqueda is
  'Los tres codigos + nombre + categoria + descripcion, plegado. Es lo que indexa productos_busqueda_trgm_idx.';

create index productos_busqueda_trgm_idx
  on public.productos using gin (busqueda gin_trgm_ops);

-- =========================================================================
-- 4. `buscar_productos` aprende a buscar por codigo
-- =========================================================================

/*
 * Cambios contra la version anterior:
 *
 *   1. Un candidato ahora entra tambien por CODIGO, no solo por palabra. Antes,
 *      quien dictaba `96389106/STD/K` no encontraba nada si ninguna palabra de
 *      la consulta aparecia en el texto.
 *   2. El match de codigo se hace sobre el plegado, asi que `96389106`,
 *      `96389106/STD/K` y `9638-9106` caen todos en la misma fila. Medido:
 *      sobre 16.995 claves plegadas hay 16 colisiones y las 16 son el mismo
 *      codigo escrito de dos formas, no piezas distintas.
 *   3. Prioridad entre codigos: fabrica 1000 > interno 900 > alterno 700. El de
 *      fabrica gana porque es el que el cliente tiene en la mano.
 *
 * El puntaje por palabra no se toca: sigue espejando `relevanceScore` de
 * `catalog-matcher.service.ts`.
 */

-- La firma no cambia pero el TIPO DE RETORNO sí (suma `codigo_fabrica`), y
-- `create or replace` no puede cambiarlo: hay que dropear primero. Nadie la
-- llama todavía, así que el drop no rompe ningún cliente.
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
  candidatos as (
    select p.*
    from public.productos as p, consulta as c
    where p.activo
      and (
        -- por codigo
        (c.cod <> '' and (
          p.codigo_fabrica_plegado = c.cod
          or p.codigo_interno_plegado = c.cod
          or public.plegar_codigos(p.otros_codigos) @> array[c.cod]
        ))
        -- o por palabra, como antes
        or not exists (select 1 from palabras)
        or exists (select 1 from palabras as w where p.busqueda like '%' || w.palabra || '%')
      )
      and (
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
  'Busqueda del catalogo por codigo de fabrica, codigo interno, alternos y texto. El codigo se machea plegado: sin sufijos de medida ni de origen y sin separadores.';
