-- Marcas del catálogo y su procedencia, cargadas desde Bodega Web.
--
-- El ERP no tiene una columna de origen: `productos.descripcion` (DESCRIP_AUX)
-- mezcla MARCAS (MOBIS, GM, MANDO, CTR, JUNGWOO…) con PAÍSES (CHINA, KOREA…). La
-- única fuente de qué marca es de dónde es la base de Bodega Web
-- (`public.marcas` + `marca_alias`); esta tabla es su copia de solo lectura para
-- el agente, que cotiza «MOBIS (Original) $96,66 · JUNGWOO (Korea) $21,51».
--
-- Quien escribe: el mismo extractor de Bodega Web (`sync-oracle`), por las mismas
-- RPC `erp_sync_cargar` / `erp_sync_borrar`, ahora con `p_tabla = 'marcas'`. La
-- lista de tablas sigue siendo CERRADA ('productos', 'marcas'); la clave se valida
-- primero, igual que antes. `productos` no cambia: el cuerpo de las dos funciones
-- para esa tabla es el de 20261006130100_erp_sync.sql, palabra por palabra.
--
-- Modelo de seguridad (lo nuevo):
--   * `catalogo_marcas`: RLS con SELECT para admin y vendedor; ninguna escritura
--     directa para nadie (ni anon ni authenticated). Solo escribe la RPC `security
--     definer` con la clave de sincronización, y `service_role`.
--   * Las filas se validan campo por campo antes de escribir (todo o nada) y las
--     claves permitidas son una lista cerrada.
--   * Los mensajes de error no incluyen la clave.
-- Contrato para el extractor: docs/integraciones/erp-oracle-contrato-crm.md §3.4.

-- =========================================================================
-- Tabla
-- =========================================================================
create table if not exists public.catalogo_marcas (
  nombre text primary key
    check (nombre = btrim(nombre) and nombre <> '' and length(nombre) <= 100),
  tipo text
    check (tipo is null or (tipo = btrim(tipo) and tipo <> '' and length(tipo) <= 50)),
  -- País u «ORIGINAL», como lo escribe Bodega Web. NULL = no se sabe.
  procedencia text
    check (procedencia is null
           or (procedencia = btrim(procedencia) and procedencia <> '' and length(procedencia) <= 50)),
  -- false = la marca desapareció de Bodega Web; el agente la ignora. Nunca se borra.
  activa boolean not null default true,
  alias text[] not null default '{}'
    check (cardinality(alias) <= 50),
  -- La última vez que la carga CAMBIÓ algo de esta fila.
  erp_actualizado_at timestamptz
);

-- El agente compara sin mayúsculas: dos nombres que solo difieren en eso serían la
-- misma marca dos veces.
create unique index if not exists catalogo_marcas_nombre_lower_uidx
  on public.catalogo_marcas (lower(nombre));

comment on table public.catalogo_marcas is
  'Marcas del catalogo y su procedencia (copia de solo lectura de marcas + marca_alias de Bodega Web). La escribe solo erp_sync_cargar/erp_sync_borrar con p_tabla = marcas.';

alter table public.catalogo_marcas enable row level security;

drop policy if exists catalogo_marcas_select on public.catalogo_marcas;
create policy catalogo_marcas_select on public.catalogo_marcas
  for select to authenticated
  using ((select public.is_admin()) or (select public.is_vendedor()));

revoke all on public.catalogo_marcas from public, anon, authenticated;
grant select on public.catalogo_marcas to authenticated;
grant select, insert, update, delete on public.catalogo_marcas to service_role;

-- =========================================================================
-- Reglas de una fila de `marcas`
-- =========================================================================
-- NULL si la fila cumple el contrato; si no, el motivo. Claves: lista cerrada.
create or replace function private.erp_marca_fila_error(f jsonb)
returns text
language plpgsql
stable
set search_path = ''
as $function$
declare
  v_extra text;
  v_campo text;
  v_alias jsonb;
begin
  if jsonb_typeof(f) is distinct from 'object' then
    return 'la fila tiene que ser un objeto JSON';
  end if;

  select k into v_extra
  from jsonb_object_keys(f) as k
  where k not in ('nombre', 'tipo', 'procedencia', 'activa', 'alias')
  limit 1;
  if v_extra is not null then
    return format('campo desconocido %s', left(v_extra, 40));
  end if;

  if jsonb_typeof(f -> 'nombre') is distinct from 'string'
     or btrim(f ->> 'nombre') = ''
     or length(btrim(f ->> 'nombre')) > 100 then
    return 'nombre tiene que ser texto no vacio de hasta 100 caracteres';
  end if;

  foreach v_campo in array array['tipo', 'procedencia'] loop
    if coalesce(jsonb_typeof(f -> v_campo), 'null') not in ('string', 'null')
       or length(btrim(f ->> v_campo)) > 50 then
      return format('%s tiene que ser texto (hasta 50 caracteres) o null', v_campo);
    end if;
  end loop;

  if coalesce(jsonb_typeof(f -> 'activa'), 'null') not in ('boolean', 'null') then
    return 'activa tiene que ser true, false o null';
  end if;

  v_alias := f -> 'alias';
  if coalesce(jsonb_typeof(v_alias), 'null') not in ('array', 'null') then
    return 'alias tiene que ser un arreglo de textos o null';
  end if;
  if jsonb_typeof(v_alias) = 'array' then
    if jsonb_array_length(v_alias) > 50 then
      return 'alias admite hasta 50 elementos';
    end if;
    if exists (
      select 1 from jsonb_array_elements(v_alias) a
      where jsonb_typeof(a) is distinct from 'string'
         or btrim(a #>> '{}') = ''
         or length(btrim(a #>> '{}')) > 100
    ) then
      return 'cada alias tiene que ser texto no vacio de hasta 100 caracteres';
    end if;
  end if;

  return null;
end;
$function$;

revoke all on function private.erp_marca_fila_error(jsonb) from public, anon, authenticated;

-- Upsert de un lote de marcas (ya validado el lote y la clave). Devuelve cuántas
-- filas insertó o cambió: una fila idéntica a la guardada no se toca.
create or replace function private.erp_cargar_marcas(p_filas jsonb)
returns integer
language plpgsql
set search_path = ''
as $function$
declare
  v_n integer := 0;
  v_mal record;
begin
  -- Todo o nada: la primera fila mala rechaza el lote entero.
  select v.ord, v.motivo into v_mal
  from (
    select e.ord, private.erp_marca_fila_error(e.f) as motivo
    from jsonb_array_elements(p_filas) with ordinality as e(f, ord)
  ) v
  where v.motivo is not null
  order by v.ord
  limit 1;
  if found then
    raise exception 'fila %: %', v_mal.ord, v_mal.motivo using errcode = '22023';
  end if;

  -- Dos filas con el mismo nombre (sin importar mayúsculas) harían que ON CONFLICT
  -- toque la misma fila dos veces (21000).
  select max(e.ord) as ord, lower(btrim(e.f ->> 'nombre')) as nombre into v_mal
  from jsonb_array_elements(p_filas) with ordinality as e(f, ord)
  group by lower(btrim(e.f ->> 'nombre'))
  having count(*) > 1
  order by 1
  limit 1;
  if found then
    raise exception 'fila %: nombre % repetido en el lote', v_mal.ord, left(v_mal.nombre, 100)
      using errcode = '22023';
  end if;

  with r as (
    select
      btrim(f ->> 'nombre') as nombre,
      nullif(btrim(f ->> 'tipo'), '') as tipo,
      nullif(btrim(f ->> 'procedencia'), '') as procedencia,
      coalesce((f ->> 'activa')::boolean, true) as activa,
      coalesce(
        (select array_agg(btrim(a #>> '{}') order by o)
           from jsonb_array_elements(case when jsonb_typeof(f -> 'alias') = 'array'
                                          then f -> 'alias' else '[]'::jsonb end)
                with ordinality as x(a, o)),
        '{}'::text[]) as alias
    from jsonb_array_elements(p_filas) as e(f)
  )
  insert into public.catalogo_marcas as t (nombre, tipo, procedencia, activa, alias, erp_actualizado_at)
  select r.nombre, r.tipo, r.procedencia, r.activa, r.alias, now()
  from r
  on conflict (nombre) do update
     set tipo = excluded.tipo,
         procedencia = excluded.procedencia,
         activa = excluded.activa,
         alias = excluded.alias,
         erp_actualizado_at = excluded.erp_actualizado_at
   where (t.tipo, t.procedencia, t.activa, t.alias)
         is distinct from
         (excluded.tipo, excluded.procedencia, excluded.activa, excluded.alias);

  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;

revoke all on function private.erp_cargar_marcas(jsonb) from public, anon, authenticated;

-- Da de baja las marcas nombradas (activa = false). `p_claves`: [{"nombre": "X"}].
create or replace function private.erp_borrar_marcas(p_claves jsonb)
returns integer
language plpgsql
set search_path = ''
as $function$
declare
  v_n integer := 0;
  v_mal bigint;
begin
  select e.ord into v_mal
  from jsonb_array_elements(p_claves) with ordinality as e(k, ord)
  where jsonb_typeof(e.k) is distinct from 'object'
     or (select count(*) from jsonb_object_keys(e.k)) <> 1
     or jsonb_typeof(e.k -> 'nombre') is distinct from 'string'
     or btrim(e.k ->> 'nombre') = ''
  order by e.ord
  limit 1;
  if found then
    raise exception 'clave %: tiene que ser {"nombre": "<texto>"}', v_mal using errcode = '22023';
  end if;

  update public.catalogo_marcas t
     set activa = false,
         erp_actualizado_at = now()
   where t.activa
     and t.nombre in (
       select btrim(e.k ->> 'nombre') from jsonb_array_elements(p_claves) as e(k));

  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;

revoke all on function private.erp_borrar_marcas(jsonb) from public, anon, authenticated;

-- =========================================================================
-- Las RPC: la misma compuerta, ahora con dos tablas permitidas
-- =========================================================================
-- Misma firma, mismos grants y mismo `statement_timeout`. Lo único que cambia:
-- la lista cerrada de tablas ('productos', 'marcas') y la rama de 'marcas'. El
-- cuerpo de 'productos' es el de la migración anterior.
create or replace function public.erp_sync_cargar(p_clave text, p_tabla text, p_filas jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
set statement_timeout = '60s'
as $function$
declare
  v_n integer := 0;
  v_mal record;
begin
  perform private.erp_sync_autorizar(p_clave);
  if p_tabla is null or p_tabla not in ('productos', 'marcas') then
    raise exception 'Tabla no permitida: %', left(coalesce(p_tabla, '(null)'), 60)
      using errcode = '22023';
  end if;
  if private.erp_sync_validar_lote(p_filas) = 0 then
    return 0;
  end if;

  if p_tabla = 'marcas' then
    return private.erp_cargar_marcas(p_filas);
  end if;

  -- Todo o nada: la primera fila mala rechaza el lote entero.
  select v.ord, v.motivo into v_mal
  from (
    select e.ord, private.erp_producto_fila_error(e.f) as motivo
    from jsonb_array_elements(p_filas) with ordinality as e(f, ord)
  ) v
  where v.motivo is not null
  order by v.ord
  limit 1;
  if found then
    raise exception 'fila %: %', v_mal.ord, v_mal.motivo using errcode = '22023';
  end if;

  -- Dos filas con el mismo no_item harían que ON CONFLICT toque la misma fila dos
  -- veces (21000). Se rechaza antes, con la fila que repite.
  select max(e.ord) as ord, btrim(e.f ->> 'no_item') as no_item into v_mal
  from jsonb_array_elements(p_filas) with ordinality as e(f, ord)
  group by btrim(e.f ->> 'no_item')
  having count(*) > 1
  order by 1
  limit 1;
  if found then
    raise exception 'fila %: no_item % repetido en el lote', v_mal.ord, left(v_mal.no_item, 50)
      using errcode = '22023';
  end if;

  with r as (
    select
      btrim(f ->> 'no_item') as codigo_interno,
      nullif(btrim(f ->> 'codigo'), '') as codigo_fabrica,
      private.erp_partir_codigos(f ->> 'otros_codigos') as otros_codigos,
      nullif(btrim(f ->> 'grupo'), '') as categoria,
      btrim(f ->> 'descripcion') as nombre,
      nullif(btrim(f ->> 'descripcion_auxiliar'), '') as descripcion,
      -- Existencias fraccionarias (juegos partidos, cuentas de gasto): se cuenta
      -- la unidad entera, no se promete media pieza.
      floor((f ->> 'existencias_total')::numeric)::integer as stock,
      (f ->> 'precio_matriz')::numeric(12, 2) as precio_matriz,
      (f ->> 'precio_magdalena')::numeric(12, 2) as precio_magdalena,
      (f ->> 'precio_koreanos')::numeric(12, 2) as precio_koreanos,
      (f ->> 'precio_sas_repuestos')::numeric(12, 2) as precio_sas_repuestos,
      coalesce(f ->> 'codigo_difiere', 'no') = 'si' as codigo_difiere
    from jsonb_array_elements(p_filas) as e(f)
  )
  insert into public.productos as t (
    codigo_interno, codigo_fabrica, otros_codigos, categoria, nombre, descripcion, stock,
    precio_matriz, precio_magdalena, precio_koreanos, precio_sas_repuestos, precio,
    codigo_difiere, activo, erp_actualizado_at)
  select
    r.codigo_interno, r.codigo_fabrica, r.otros_codigos, r.categoria, r.nombre, r.descripcion,
    r.stock, r.precio_matriz, r.precio_magdalena, r.precio_koreanos, r.precio_sas_repuestos,
    private.erp_precio_cotizable(
      r.precio_matriz, r.precio_magdalena, r.precio_koreanos, r.precio_sas_repuestos),
    r.codigo_difiere, true, now()
  from r
  on conflict (codigo_interno) do update
     set codigo_fabrica = excluded.codigo_fabrica,
         otros_codigos = excluded.otros_codigos,
         categoria = excluded.categoria,
         nombre = excluded.nombre,
         descripcion = excluded.descripcion,
         stock = excluded.stock,
         precio_matriz = excluded.precio_matriz,
         precio_magdalena = excluded.precio_magdalena,
         precio_koreanos = excluded.precio_koreanos,
         precio_sas_repuestos = excluded.precio_sas_repuestos,
         precio = excluded.precio,
         codigo_difiere = excluded.codigo_difiere,
         activo = true,
         erp_actualizado_at = excluded.erp_actualizado_at
   where (t.codigo_fabrica, t.otros_codigos, t.categoria, t.nombre, t.descripcion, t.stock,
          t.precio_matriz, t.precio_magdalena, t.precio_koreanos, t.precio_sas_repuestos,
          t.precio, t.codigo_difiere, t.activo)
         is distinct from
         (excluded.codigo_fabrica, excluded.otros_codigos, excluded.categoria, excluded.nombre,
          excluded.descripcion, excluded.stock, excluded.precio_matriz, excluded.precio_magdalena,
          excluded.precio_koreanos, excluded.precio_sas_repuestos, excluded.precio,
          excluded.codigo_difiere, true);

  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;

create or replace function public.erp_sync_borrar(p_clave text, p_tabla text, p_claves jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
set statement_timeout = '60s'
as $function$
declare
  v_n integer := 0;
  v_mal bigint;
begin
  perform private.erp_sync_autorizar(p_clave);
  if p_tabla is null or p_tabla not in ('productos', 'marcas') then
    raise exception 'Tabla no permitida: %', left(coalesce(p_tabla, '(null)'), 60)
      using errcode = '22023';
  end if;
  if private.erp_sync_validar_lote(p_claves) = 0 then
    return 0;
  end if;

  if p_tabla = 'marcas' then
    return private.erp_borrar_marcas(p_claves);
  end if;

  select e.ord into v_mal
  from jsonb_array_elements(p_claves) with ordinality as e(k, ord)
  where jsonb_typeof(e.k) is distinct from 'object'
     or (select count(*) from jsonb_object_keys(e.k)) <> 1
     or jsonb_typeof(e.k -> 'no_item') is distinct from 'string'
     or btrim(e.k ->> 'no_item') = ''
  order by e.ord
  limit 1;
  if found then
    raise exception 'clave %: tiene que ser {"no_item": "<texto>"}', v_mal using errcode = '22023';
  end if;

  update public.productos t
     set activo = false,
         erp_actualizado_at = now()
   where t.activo
     and t.codigo_interno in (
       select btrim(e.k ->> 'no_item') from jsonb_array_elements(p_claves) as e(k));

  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;

-- `create or replace` conserva los grants, pero se repiten por si alguien aplica
-- esta migración sobre una base donde las funciones se recrearon: anon solo ejecuta
-- estas RPC (con la clave); authenticated no.
revoke all on function public.erp_sync_cargar(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.erp_sync_borrar(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.erp_sync_cargar(text, text, jsonb) to anon, service_role;
grant execute on function public.erp_sync_borrar(text, text, jsonb) to anon, service_role;
