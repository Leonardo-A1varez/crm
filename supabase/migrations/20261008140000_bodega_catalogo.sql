-- Copia de solo lectura e incremental del catálogo de Bodega Web (ítems, ítems de
-- proveedor, marcas y las bajas de las tres).
--
-- Contrato: la RPC `public.crm_catalogo_cambios(p_clave, p_tabla, p_desde, p_despues,
-- p_limite)` del Supabase de Bodega Web (otro proyecto). El CRM la consulta cada 5
-- minutos desde Inngest (`sincronizar-bodega`), de a páginas de hasta 1000 filas, con
-- un cursor por tabla. Nunca recibe precios de compra ni costos.
--
-- Esta migración crea:
--   * `bodega_sync_cursor`   posición de lectura por tabla (solo service_role).
--   * `bodega_variantes`     ítems de proveedor (lectura: admin y vendedor).
--   * `bodega_existencias`   lo mínimo del ítem que NO está ya en `productos` (el ERP
--                            sigue mandando precios, stock y descripciones).
--   * `catalogo_marcas.bodega_actualizada_en` para la regla de las bajas.
--   * `bodega_aplicar_pagina(p_tabla, p_filas, p_cursor)`: aplica una página y guarda
--     el cursor EN LA MISMA transacción (una sola función = una sola transacción).
--
-- Modelo de seguridad:
--   * Ninguna tabla nueva tiene escritura para `anon` ni `authenticated`; solo escribe
--     `service_role` (la función de abajo, que ejecuta el cron del servidor).
--   * La función es SECURITY DEFINER con `search_path = ''` y solo `service_role` puede
--     ejecutarla. Valida cada fila campo por campo antes de escribir (todo o nada).
--   * El cursor `desde` se guarda como TEXTO exactamente como lo dio Bodega Web
--     (microsegundos): nunca pasa por un Date de JavaScript ni se redondea.

-- =========================================================================
-- Cursor
-- =========================================================================
create table if not exists public.bodega_sync_cursor (
  tabla text primary key
    check (tabla in ('marcas', 'existencias', 'variantes', 'bajas')),
  -- Texto UTC con microsegundos tal cual, o '-infinity' la primera vez.
  desde text not null default '-infinity'
    check (length(desde) <= 40),
  -- Opaco: se devuelve igual que llegó.
  despues text
    check (despues is null or length(despues) <= 200),
  actualizado_at timestamptz not null default now()
);

comment on table public.bodega_sync_cursor is
  'Posicion de lectura de la copia del catalogo de Bodega Web, una fila por tabla. Solo service_role. Borrar las filas fuerza una re-sincronizacion completa.';

alter table public.bodega_sync_cursor enable row level security;
revoke all on public.bodega_sync_cursor from public, anon, authenticated;
grant select, insert, update, delete on public.bodega_sync_cursor to service_role;

-- =========================================================================
-- Existencias (lo que no trae el ERP)
-- =========================================================================
create table if not exists public.bodega_existencias (
  no_item text primary key
    check (no_item = btrim(no_item) and no_item <> '' and length(no_item) <= 100),
  -- Número del grupo en el catálogo de grupos de Bodega Web (p. ej. las exclusiones
  -- por grupo).
  grupo_numero integer,
  -- 'excel' (listado del catálogo) o 'pedido' (alta por un pedido de distribución).
  origen text
    check (origen is null or length(origen) <= 30),
  -- Sello `actualizado_en` de Bodega Web. Es la mitad de la regla de las bajas.
  bodega_actualizado_en timestamptz not null,
  -- false = una baja de Bodega Web la dio de baja. Nunca se borra.
  activa boolean not null default true
);

create index if not exists bodega_existencias_grupo_numero_idx
  on public.bodega_existencias (grupo_numero)
  where grupo_numero is not null;

comment on table public.bodega_existencias is
  'Copia de solo lectura de existencias de Bodega Web: solo lo que no esta ya en productos (grupo, origen). Precios, stock y descripciones siguen viniendo del ERP.';

alter table public.bodega_existencias enable row level security;

drop policy if exists bodega_existencias_select on public.bodega_existencias;
create policy bodega_existencias_select on public.bodega_existencias
  for select to authenticated
  using ((select public.is_admin()) or (select public.is_vendedor()));

revoke all on public.bodega_existencias from public, anon, authenticated;
grant select on public.bodega_existencias to authenticated;
grant select, insert, update, delete on public.bodega_existencias to service_role;

-- =========================================================================
-- Variantes (ítems de proveedor)
-- =========================================================================
create table if not exists public.bodega_variantes (
  id uuid primary key,
  item_codigo_interno text not null
    check (item_codigo_interno <> '' and length(item_codigo_interno) <= 100),
  proveedor_id uuid,
  proveedor_nombre text,
  proveedor_abreviatura text,
  supplier_code_raw text,
  supplier_code_norm text,
  codigos_auxiliares text[] not null default '{}'
    check (cardinality(codigos_auxiliares) <= 200),
  descripcion_raw text,
  descripcion_limpia text,
  descripcion_auxiliar text,
  marca_raw text,
  marca_canonica text,
  marca_id uuid,
  marca_procedencia text,
  -- LEFT, RIGHT, BOTH o null.
  lado text check (lado is null or lado in ('LEFT', 'RIGHT', 'BOTH')),
  categoria text,
  -- OBSERVED, CONFIRMED, TRUSTED o CONFLICT. Texto libre a propósito: un estado nuevo
  -- de Bodega Web no puede frenar la sincronización; el CRM solo confía en dos.
  estado text not null check (length(estado) <= 30),
  descartada boolean not null default false,
  promovida boolean not null default false,
  promovida_en timestamptz,
  primera_vez timestamptz,
  ultima_vez timestamptz,
  bodega_actualizado_en timestamptz not null,
  activa boolean not null default true
);

create index if not exists bodega_variantes_item_codigo_interno_idx
  on public.bodega_variantes (item_codigo_interno);

comment on table public.bodega_variantes is
  'Copia de solo lectura de variantes (items de proveedor) de Bodega Web, incluidas las descartadas y las no confiables con sus banderas. El CRM decide: confiable = not descartada and estado in (CONFIRMED, TRUSTED). Sin precios ni costos.';

alter table public.bodega_variantes enable row level security;

drop policy if exists bodega_variantes_select on public.bodega_variantes;
create policy bodega_variantes_select on public.bodega_variantes
  for select to authenticated
  using ((select public.is_admin()) or (select public.is_vendedor()));

revoke all on public.bodega_variantes from public, anon, authenticated;
grant select on public.bodega_variantes to authenticated;
grant select, insert, update, delete on public.bodega_variantes to service_role;

-- =========================================================================
-- Marcas: el sello de Bodega Web (regla de las bajas)
-- =========================================================================
-- `erp_actualizado_at` es la hora de ESTA base cuando algo cambió; la regla de las
-- bajas compara el sello de Bodega Web (`actualizada_en`) con `borrado_en`, y son
-- relojes distintos. NULL = la fila solo la escribió la carga del ERP.
alter table public.catalogo_marcas
  add column if not exists bodega_actualizada_en timestamptz;

-- =========================================================================
-- Validación de filas (NULL si cumple; si no, el motivo)
-- =========================================================================
create or replace function private.bodega_ts_valido(p text)
returns boolean
language sql
immutable
set search_path = ''
as $function$
  select p ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}(:?[0-9]{2})?)$'
$function$;

create or replace function private.bodega_uuid_valido(p text)
returns boolean
language sql
immutable
set search_path = ''
as $function$
  select p ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
$function$;

-- Un campo de texto opcional: ausente, null o texto de hasta `p_max` caracteres.
create or replace function private.bodega_texto_ok(f jsonb, p_campo text, p_max integer)
returns boolean
language sql
immutable
set search_path = ''
as $function$
  select coalesce(jsonb_typeof(f -> p_campo), 'null') in ('string', 'null')
     and coalesce(length(f ->> p_campo), 0) <= p_max
$function$;

-- Una fecha opcional: ausente, null o ISO 8601 válida.
create or replace function private.bodega_fecha_ok(f jsonb, p_campo text)
returns boolean
language sql
immutable
set search_path = ''
as $function$
  select case coalesce(jsonb_typeof(f -> p_campo), 'null')
    when 'null' then true
    when 'string' then private.bodega_ts_valido(f ->> p_campo)
    else false
  end
$function$;

create or replace function private.bodega_fila_error(p_tabla text, f jsonb)
returns text
language plpgsql
stable
set search_path = ''
as $function$
declare
  v_campo text;
begin
  if jsonb_typeof(f) is distinct from 'object' then
    return 'la fila tiene que ser un objeto JSON';
  end if;

  if p_tabla = 'marcas' then
    if jsonb_typeof(f -> 'nombre') is distinct from 'string'
       or btrim(f ->> 'nombre') = ''
       or length(btrim(f ->> 'nombre')) > 100 then
      return 'nombre tiene que ser texto no vacio de hasta 100 caracteres';
    end if;
    foreach v_campo in array array['tipo', 'procedencia'] loop
      if not private.bodega_texto_ok(f, v_campo, 50) then
        return format('%s tiene que ser texto (hasta 50 caracteres) o null', v_campo);
      end if;
    end loop;
    if jsonb_typeof(f -> 'activa') is distinct from 'boolean' then
      return 'activa tiene que ser true o false';
    end if;
    if jsonb_typeof(f -> 'alias') is distinct from 'array'
       or jsonb_array_length(f -> 'alias') > 50
       or exists (
         select 1 from jsonb_array_elements(f -> 'alias') a
         where jsonb_typeof(a) is distinct from 'string'
            or btrim(a #>> '{}') = ''
            or length(btrim(a #>> '{}')) > 100
       ) then
      return 'alias tiene que ser un arreglo de hasta 50 textos no vacios de hasta 100 caracteres';
    end if;
    if jsonb_typeof(f -> 'actualizada_en') is distinct from 'string'
       or not private.bodega_ts_valido(f ->> 'actualizada_en') then
      return 'actualizada_en tiene que ser una fecha ISO 8601';
    end if;
    return null;
  end if;

  if p_tabla = 'existencias' then
    if jsonb_typeof(f -> 'no_item') is distinct from 'string'
       or btrim(f ->> 'no_item') = ''
       or length(btrim(f ->> 'no_item')) > 100 then
      return 'no_item tiene que ser texto no vacio de hasta 100 caracteres';
    end if;
    if coalesce(jsonb_typeof(f -> 'grupo_numero'), 'null') not in ('number', 'null')
       or (jsonb_typeof(f -> 'grupo_numero') = 'number'
           and (f ->> 'grupo_numero') !~ '^-?[0-9]{1,9}$') then
      return 'grupo_numero tiene que ser un entero o null';
    end if;
    if not private.bodega_texto_ok(f, 'origen', 30) then
      return 'origen tiene que ser texto (hasta 30 caracteres) o null';
    end if;
    if jsonb_typeof(f -> 'actualizado_en') is distinct from 'string'
       or not private.bodega_ts_valido(f ->> 'actualizado_en') then
      return 'actualizado_en tiene que ser una fecha ISO 8601';
    end if;
    return null;
  end if;

  if p_tabla = 'variantes' then
    if jsonb_typeof(f -> 'id') is distinct from 'string'
       or not private.bodega_uuid_valido(f ->> 'id') then
      return 'id tiene que ser un uuid';
    end if;
    if jsonb_typeof(f -> 'item_codigo_interno') is distinct from 'string'
       or btrim(f ->> 'item_codigo_interno') = ''
       or length(btrim(f ->> 'item_codigo_interno')) > 100 then
      return 'item_codigo_interno tiene que ser texto no vacio de hasta 100 caracteres';
    end if;
    if coalesce(jsonb_typeof(f -> 'proveedor'), 'null') not in ('object', 'null') then
      return 'proveedor tiene que ser un objeto o null';
    end if;
    if jsonb_typeof(f -> 'proveedor') = 'object' then
      if coalesce(jsonb_typeof(f -> 'proveedor' -> 'id'), 'null') not in ('string', 'null')
         or (jsonb_typeof(f -> 'proveedor' -> 'id') = 'string'
             and not private.bodega_uuid_valido(f -> 'proveedor' ->> 'id')) then
        return 'proveedor.id tiene que ser un uuid o null';
      end if;
      foreach v_campo in array array['nombre', 'abreviatura'] loop
        if not private.bodega_texto_ok(f -> 'proveedor', v_campo, 200) then
          return format('proveedor.%s tiene que ser texto (hasta 200 caracteres) o null', v_campo);
        end if;
      end loop;
    end if;
    foreach v_campo in array array[
      'supplier_code_raw', 'supplier_code_norm', 'descripcion_raw', 'descripcion_limpia',
      'descripcion_auxiliar', 'marca_raw', 'categoria'
    ] loop
      if not private.bodega_texto_ok(f, v_campo, 2000) then
        return format('%s tiene que ser texto (hasta 2000 caracteres) o null', v_campo);
      end if;
    end loop;
    -- La marca y su procedencia llegan al texto que cotiza el agente: mismos topes que
    -- `catalogo_marcas` (nombre 100, procedencia 50).
    if not private.bodega_texto_ok(f, 'marca_canonica', 100) then
      return 'marca_canonica tiene que ser texto (hasta 100 caracteres) o null';
    end if;
    if not private.bodega_texto_ok(f, 'marca_procedencia', 50) then
      return 'marca_procedencia tiene que ser texto (hasta 50 caracteres) o null';
    end if;
    if coalesce(jsonb_typeof(f -> 'marca_id'), 'null') not in ('string', 'null')
       or (jsonb_typeof(f -> 'marca_id') = 'string'
           and not private.bodega_uuid_valido(f ->> 'marca_id')) then
      return 'marca_id tiene que ser un uuid o null';
    end if;
    if coalesce(f ->> 'lado', 'LEFT') not in ('LEFT', 'RIGHT', 'BOTH')
       or coalesce(jsonb_typeof(f -> 'lado'), 'null') not in ('string', 'null') then
      return 'lado tiene que ser LEFT, RIGHT, BOTH o null';
    end if;
    if jsonb_typeof(f -> 'estado') is distinct from 'string'
       or btrim(f ->> 'estado') = ''
       or length(f ->> 'estado') > 30 then
      return 'estado tiene que ser texto no vacio de hasta 30 caracteres';
    end if;
    foreach v_campo in array array['descartada', 'promovida'] loop
      if jsonb_typeof(f -> v_campo) is distinct from 'boolean' then
        return format('%s tiene que ser true o false', v_campo);
      end if;
    end loop;
    if coalesce(jsonb_typeof(f -> 'codigos_auxiliares'), 'null') not in ('array', 'null')
       or (jsonb_typeof(f -> 'codigos_auxiliares') = 'array'
           and (jsonb_array_length(f -> 'codigos_auxiliares') > 200
                or exists (
                  select 1 from jsonb_array_elements(f -> 'codigos_auxiliares') a
                  where jsonb_typeof(a) is distinct from 'string'
                     or length(a #>> '{}') > 200
                ))) then
      return 'codigos_auxiliares tiene que ser un arreglo de hasta 200 textos o null';
    end if;
    foreach v_campo in array array['promovida_en', 'primera_vez', 'ultima_vez'] loop
      if not private.bodega_fecha_ok(f, v_campo) then
        return format('%s tiene que ser una fecha ISO 8601 o null', v_campo);
      end if;
    end loop;
    if jsonb_typeof(f -> 'actualizado_en') is distinct from 'string'
       or not private.bodega_ts_valido(f ->> 'actualizado_en') then
      return 'actualizado_en tiene que ser una fecha ISO 8601';
    end if;
    return null;
  end if;

  if p_tabla = 'bajas' then
    if jsonb_typeof(f -> 'tabla') is distinct from 'string'
       or length(f ->> 'tabla') > 30 then
      return 'tabla tiene que ser texto';
    end if;
    if jsonb_typeof(f -> 'clave') is distinct from 'string'
       or btrim(f ->> 'clave') = ''
       or length(f ->> 'clave') > 200 then
      return 'clave tiene que ser texto no vacio de hasta 200 caracteres';
    end if;
    if f ->> 'tabla' = 'variantes' and not private.bodega_uuid_valido(f ->> 'clave') then
      return 'la clave de una baja de variantes tiene que ser un uuid';
    end if;
    if jsonb_typeof(f -> 'borrado_en') is distinct from 'string'
       or not private.bodega_ts_valido(f ->> 'borrado_en') then
      return 'borrado_en tiene que ser una fecha ISO 8601';
    end if;
    return null;
  end if;

  return 'tabla desconocida';
end;
$function$;

revoke all on function private.bodega_ts_valido(text) from public, anon, authenticated;
revoke all on function private.bodega_uuid_valido(text) from public, anon, authenticated;
revoke all on function private.bodega_texto_ok(jsonb, text, integer) from public, anon, authenticated;
revoke all on function private.bodega_fecha_ok(jsonb, text) from public, anon, authenticated;
revoke all on function private.bodega_fila_error(text, jsonb) from public, anon, authenticated;

-- =========================================================================
-- Aplicar una página + guardar el cursor, en una sola transacción
-- =========================================================================
-- `p_filas`: el arreglo `filas` de la respuesta de `crm_catalogo_cambios`.
-- `p_cursor`: `{"desde": "<texto>", "despues": "<texto>"|null}`, el `cursor` de la
-- respuesta. Devuelve cuántas filas cambiaron (altas, modificaciones o bajas).
--
-- Una fila más vieja que la guardada (la misma página reenviada, o una carrera) no la
-- pisa: el upsert solo escribe si el sello nuevo es mayor o igual.
create or replace function public.bodega_aplicar_pagina(
  p_tabla text,
  p_filas jsonb,
  p_cursor jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
set statement_timeout = '120s'
as $function$
declare
  v_n integer := 0;
  v_k integer;
  v_mal record;
  v_desde text;
  v_despues text;
begin
  if p_tabla is null or p_tabla not in ('marcas', 'existencias', 'variantes', 'bajas') then
    raise exception 'Tabla no permitida: %', left(coalesce(p_tabla, '(null)'), 60)
      using errcode = '22023';
  end if;
  if jsonb_typeof(p_filas) is distinct from 'array' then
    raise exception 'p_filas tiene que ser un arreglo JSON' using errcode = '22023';
  end if;
  if jsonb_array_length(p_filas) > 5000 then
    raise exception 'p_filas admite hasta 5000 filas' using errcode = '22023';
  end if;
  if jsonb_typeof(p_cursor) is distinct from 'object'
     or jsonb_typeof(p_cursor -> 'desde') is distinct from 'string'
     or coalesce(jsonb_typeof(p_cursor -> 'despues'), 'null') not in ('string', 'null') then
    raise exception 'p_cursor tiene que ser {"desde": texto, "despues": texto|null}'
      using errcode = '22023';
  end if;

  v_desde := p_cursor ->> 'desde';
  v_despues := p_cursor ->> 'despues';
  if not (v_desde = '-infinity' or private.bodega_ts_valido(v_desde)) then
    raise exception 'cursor.desde no es una fecha ISO 8601' using errcode = '22023';
  end if;
  if length(coalesce(v_despues, '')) > 200 then
    raise exception 'cursor.despues es demasiado largo' using errcode = '22023';
  end if;

  -- Todo o nada: la primera fila mala rechaza la página entera (y no avanza el cursor).
  select v.ord, v.motivo into v_mal
  from (
    select e.ord, private.bodega_fila_error(p_tabla, e.f) as motivo
    from jsonb_array_elements(p_filas) with ordinality as e(f, ord)
  ) v
  where v.motivo is not null
  order by v.ord
  limit 1;
  if found then
    raise exception 'fila %: %', v_mal.ord, v_mal.motivo using errcode = '22023';
  end if;

  if p_tabla = 'marcas' then
    -- Una fila por nombre (sin mayúsculas): ON CONFLICT no puede tocar la misma fila
    -- dos veces. Gana la de tipo 'producto' y, a igualdad, la más reciente.
    with r as (
      select distinct on (lower(btrim(f ->> 'nombre')))
        btrim(f ->> 'nombre') as nombre,
        nullif(btrim(f ->> 'tipo'), '') as tipo,
        nullif(btrim(f ->> 'procedencia'), '') as procedencia,
        (f ->> 'activa')::boolean as activa,
        coalesce(
          (select array_agg(btrim(a #>> '{}') order by o)
             from jsonb_array_elements(f -> 'alias') with ordinality as x(a, o)),
          '{}'::text[]) as alias,
        (f ->> 'actualizada_en')::timestamptz as actualizada_en
      from jsonb_array_elements(p_filas) as e(f)
      order by lower(btrim(f ->> 'nombre')),
               (coalesce(f ->> 'tipo', '') = 'producto') desc,
               (f ->> 'actualizada_en')::timestamptz desc
    )
    insert into public.catalogo_marcas as t
      (nombre, tipo, procedencia, activa, alias, erp_actualizado_at, bodega_actualizada_en)
    select r.nombre, r.tipo, r.procedencia, r.activa, r.alias, now(), r.actualizada_en
    from r
    on conflict (lower(nombre)) do update
       set nombre = excluded.nombre,
           tipo = excluded.tipo,
           procedencia = excluded.procedencia,
           activa = excluded.activa,
           alias = excluded.alias,
           erp_actualizado_at = excluded.erp_actualizado_at,
           bodega_actualizada_en = excluded.bodega_actualizada_en
     where t.bodega_actualizada_en is null
        or t.bodega_actualizada_en <= excluded.bodega_actualizada_en;
    get diagnostics v_n = row_count;

  elsif p_tabla = 'existencias' then
    with r as (
      select distinct on (btrim(f ->> 'no_item'))
        btrim(f ->> 'no_item') as no_item,
        (f ->> 'grupo_numero')::integer as grupo_numero,
        nullif(btrim(f ->> 'origen'), '') as origen,
        (f ->> 'actualizado_en')::timestamptz as actualizado_en
      from jsonb_array_elements(p_filas) as e(f)
      order by btrim(f ->> 'no_item'), (f ->> 'actualizado_en')::timestamptz desc
    )
    insert into public.bodega_existencias as t
      (no_item, grupo_numero, origen, bodega_actualizado_en, activa)
    select r.no_item, r.grupo_numero, r.origen, r.actualizado_en, true
    from r
    on conflict (no_item) do update
       set grupo_numero = excluded.grupo_numero,
           origen = excluded.origen,
           bodega_actualizado_en = excluded.bodega_actualizado_en,
           -- Una fila que llega es una fila que existe: reactiva una dada de baja antes.
           activa = true
     where t.bodega_actualizado_en <= excluded.bodega_actualizado_en;
    get diagnostics v_n = row_count;

  elsif p_tabla = 'variantes' then
    with r as (
      select distinct on ((f ->> 'id')::uuid)
        (f ->> 'id')::uuid as id,
        btrim(f ->> 'item_codigo_interno') as item_codigo_interno,
        (f -> 'proveedor' ->> 'id')::uuid as proveedor_id,
        f -> 'proveedor' ->> 'nombre' as proveedor_nombre,
        f -> 'proveedor' ->> 'abreviatura' as proveedor_abreviatura,
        f ->> 'supplier_code_raw' as supplier_code_raw,
        f ->> 'supplier_code_norm' as supplier_code_norm,
        coalesce(
          (select array_agg(a #>> '{}' order by o)
             from jsonb_array_elements(
                    case when jsonb_typeof(f -> 'codigos_auxiliares') = 'array'
                         then f -> 'codigos_auxiliares' else '[]'::jsonb end)
                  with ordinality as x(a, o)),
          '{}'::text[]) as codigos_auxiliares,
        f ->> 'descripcion_raw' as descripcion_raw,
        f ->> 'descripcion_limpia' as descripcion_limpia,
        f ->> 'descripcion_auxiliar' as descripcion_auxiliar,
        f ->> 'marca_raw' as marca_raw,
        f ->> 'marca_canonica' as marca_canonica,
        (f ->> 'marca_id')::uuid as marca_id,
        f ->> 'marca_procedencia' as marca_procedencia,
        f ->> 'lado' as lado,
        f ->> 'categoria' as categoria,
        f ->> 'estado' as estado,
        (f ->> 'descartada')::boolean as descartada,
        (f ->> 'promovida')::boolean as promovida,
        (f ->> 'promovida_en')::timestamptz as promovida_en,
        (f ->> 'primera_vez')::timestamptz as primera_vez,
        (f ->> 'ultima_vez')::timestamptz as ultima_vez,
        (f ->> 'actualizado_en')::timestamptz as actualizado_en
      from jsonb_array_elements(p_filas) as e(f)
      order by (f ->> 'id')::uuid, (f ->> 'actualizado_en')::timestamptz desc
    )
    insert into public.bodega_variantes as t (
      id, item_codigo_interno, proveedor_id, proveedor_nombre, proveedor_abreviatura,
      supplier_code_raw, supplier_code_norm, codigos_auxiliares, descripcion_raw,
      descripcion_limpia, descripcion_auxiliar, marca_raw, marca_canonica, marca_id,
      marca_procedencia, lado, categoria, estado, descartada, promovida, promovida_en,
      primera_vez, ultima_vez, bodega_actualizado_en, activa)
    select
      r.id, r.item_codigo_interno, r.proveedor_id, r.proveedor_nombre, r.proveedor_abreviatura,
      r.supplier_code_raw, r.supplier_code_norm, r.codigos_auxiliares, r.descripcion_raw,
      r.descripcion_limpia, r.descripcion_auxiliar, r.marca_raw, r.marca_canonica, r.marca_id,
      r.marca_procedencia, r.lado, r.categoria, r.estado, r.descartada, r.promovida,
      r.promovida_en, r.primera_vez, r.ultima_vez, r.actualizado_en, true
    from r
    on conflict (id) do update
       set item_codigo_interno = excluded.item_codigo_interno,
           proveedor_id = excluded.proveedor_id,
           proveedor_nombre = excluded.proveedor_nombre,
           proveedor_abreviatura = excluded.proveedor_abreviatura,
           supplier_code_raw = excluded.supplier_code_raw,
           supplier_code_norm = excluded.supplier_code_norm,
           codigos_auxiliares = excluded.codigos_auxiliares,
           descripcion_raw = excluded.descripcion_raw,
           descripcion_limpia = excluded.descripcion_limpia,
           descripcion_auxiliar = excluded.descripcion_auxiliar,
           marca_raw = excluded.marca_raw,
           marca_canonica = excluded.marca_canonica,
           marca_id = excluded.marca_id,
           marca_procedencia = excluded.marca_procedencia,
           lado = excluded.lado,
           categoria = excluded.categoria,
           estado = excluded.estado,
           descartada = excluded.descartada,
           promovida = excluded.promovida,
           promovida_en = excluded.promovida_en,
           primera_vez = excluded.primera_vez,
           ultima_vez = excluded.ultima_vez,
           bodega_actualizado_en = excluded.bodega_actualizado_en,
           activa = true
     where t.bodega_actualizado_en <= excluded.bodega_actualizado_en;
    get diagnostics v_n = row_count;

  else
    -- Bajas. Regla del contrato (§6): una clave puede borrarse y volver a crearse,
    -- así que una baja se aplica solo si lo que se tiene guardado es ANTERIOR al
    -- borrado. Si es posterior, la fila volvió a existir y la baja es vieja.
    -- Se desactiva, nunca se borra. Una tabla que este código no conoce se ignora:
    -- una tabla nueva en Bodega Web no puede frenar la sincronización.
    update public.bodega_existencias t
       set activa = false
      from jsonb_array_elements(p_filas) as e(f)
     where e.f ->> 'tabla' = 'existencias'
       and t.no_item = btrim(e.f ->> 'clave')
       and t.activa
       and t.bodega_actualizado_en < (e.f ->> 'borrado_en')::timestamptz;
    get diagnostics v_k = row_count;
    v_n := v_n + v_k;

    update public.bodega_variantes t
       set activa = false
      from jsonb_array_elements(p_filas) as e(f)
     where e.f ->> 'tabla' = 'variantes'
       -- CASE: Postgres no garantiza el orden de los AND, y la clave de las otras
       -- tablas no es un uuid.
       and t.id = case when e.f ->> 'tabla' = 'variantes' then (e.f ->> 'clave')::uuid end
       and t.activa
       and t.bodega_actualizado_en < (e.f ->> 'borrado_en')::timestamptz;
    get diagnostics v_k = row_count;
    v_n := v_n + v_k;

    -- Una marca que solo conoce la carga del ERP (sin sello de Bodega Web) no tiene
    -- con qué compararse: la baja de Bodega Web dice que ya no existe y se aplica.
    update public.catalogo_marcas t
       set activa = false,
           erp_actualizado_at = now()
      from jsonb_array_elements(p_filas) as e(f)
     where e.f ->> 'tabla' = 'marcas'
       and t.nombre = btrim(e.f ->> 'clave')
       and t.activa
       and (t.bodega_actualizada_en is null
            or t.bodega_actualizada_en < (e.f ->> 'borrado_en')::timestamptz);
    get diagnostics v_k = row_count;
    v_n := v_n + v_k;
  end if;

  -- El cursor viaja con la página: si algo de arriba falló, esta línea no corre y la
  -- transacción entera se deshace.
  insert into public.bodega_sync_cursor as c (tabla, desde, despues, actualizado_at)
  values (p_tabla, v_desde, v_despues, now())
  on conflict (tabla) do update
     set desde = excluded.desde,
         despues = excluded.despues,
         actualizado_at = excluded.actualizado_at;

  return v_n;
end;
$function$;

revoke all on function public.bodega_aplicar_pagina(text, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.bodega_aplicar_pagina(text, jsonb, jsonb) to service_role;
