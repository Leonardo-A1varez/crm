-- Carga del catálogo del ERP (Oracle) en `productos`, sin service_role en la PC.
--
-- Quien escribe: el extractor de Bodega Web (`sync-oracle`), en la PC del dueño
-- dentro de la red de Oracle. Llama con la clave ANON a tres RPC `security
-- definer` que exigen una clave de sincronización propia (`p_clave`). La base
-- guarda solo su sha256 (`private.erp_sync_config.clave_hash`); la clave en claro
-- vive únicamente en la PC del extractor. El hash NO está en esta migración: lo
-- fija `scripts/erp/configurar-clave.mjs`.
--
-- Patrón copiado de bodega_web/supabase/migrations/20261005120000_erp_oracle_sync.sql
-- y adaptado: acá hay UNA tabla destino (`productos`), las filas se validan
-- campo por campo antes de escribir y solo se actualiza lo que cambió.
-- Contrato para el extractor: docs/integraciones/erp-oracle-contrato-crm.md.
--
-- Modelo de seguridad:
--   * `erp_sync_cargar` / `erp_sync_borrar` / `erp_sync_estado_fijar`: las únicas
--     funciones de `public` que `anon` ejecuta. Cada una valida la clave contra el
--     hash ANTES de mirar cualquier otro parámetro (42501 si no coincide), acepta
--     solo las tablas de una lista cerrada (22023) y lotes de hasta 5000 (54000).
--     La clave es de 32 bytes aleatorios: adivinarla no es practicable.
--   * `authenticated` NO las ejecuta: un vendedor no carga catálogo ni con la clave.
--   * `erp_sync_clave_fijar`: solo `service_role` (el script de configuración
--     contra el stack local y los tests). En la nube la clave se fija pegando en
--     el SQL editor la sentencia que imprime el script.
--   * `erp_sync_estado`: RLS, SELECT para admin y vendedor, ninguna escritura
--     directa. `anon` no tiene ningún grant de tabla.
--   * Ningún mensaje de error incluye la clave; `ultimo_error` la tacha si el
--     extractor la mandara por error.

-- =========================================================================
-- Tablas
-- =========================================================================

-- La clave de la sincronización (solo su sha256 en hex). Fuera de la API.
create table if not exists private.erp_sync_config (
  id smallint primary key default 1 check (id = 1),
  clave_hash text not null check (clave_hash ~ '^[0-9a-f]{64}$'),
  actualizado_at timestamptz not null default now()
);

create table if not exists public.erp_sync_estado (
  id smallint primary key default 1 check (id = 1),
  ultimo_inicio timestamptz,
  ultimo_fin timestamptz,
  ultimo_ok boolean,
  -- Fin del último ciclo que terminó bien: es lo que muestra «Actualizado hace X
  -- min», aunque el último ciclo haya fallado.
  ultimo_exito timestamptz,
  ultimo_error text,
  filas_cargadas integer,
  actualizado_at timestamptz not null default now()
);
insert into public.erp_sync_estado (id) values (1) on conflict (id) do nothing;

comment on table public.erp_sync_estado is
  'Una fila: estado de la ultima carga del catalogo del ERP. La escribe solo erp_sync_estado_fijar.';

alter table public.erp_sync_estado enable row level security;
alter table private.erp_sync_config enable row level security;

drop policy if exists erp_sync_estado_select on public.erp_sync_estado;
create policy erp_sync_estado_select on public.erp_sync_estado
  for select to authenticated
  using ((select public.is_admin()) or (select public.is_vendedor()));

revoke all on public.erp_sync_estado from public, anon, authenticated;
grant select on public.erp_sync_estado to authenticated;
grant select, insert, update, delete on public.erp_sync_estado to service_role;

revoke all on private.erp_sync_config from public, anon, authenticated;

-- =========================================================================
-- La compuerta: clave de sincronización contra su hash
-- =========================================================================
create or replace function private.erp_sync_autorizar(p_clave text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_hash text;
begin
  select c.clave_hash into v_hash from private.erp_sync_config c where c.id = 1;
  if v_hash is null
     or p_clave is null
     or length(p_clave) < 32
     or length(p_clave) > 256
     or encode(extensions.digest(p_clave, 'sha256'), 'hex') <> v_hash then
    raise exception 'Clave de sincronizacion invalida' using errcode = '42501';
  end if;
end;
$function$;

revoke all on function private.erp_sync_autorizar(text) from public, anon, authenticated;

-- Lote: un arreglo jsonb de 0 a 5000 elementos. Devuelve el largo.
create or replace function private.erp_sync_validar_lote(p_lote jsonb)
returns integer
language plpgsql
immutable
set search_path = ''
as $function$
begin
  if p_lote is null or jsonb_typeof(p_lote) <> 'array' then
    raise exception 'El lote tiene que ser un arreglo JSON' using errcode = '22023';
  end if;
  if jsonb_array_length(p_lote) > 5000 then
    raise exception 'Lote demasiado grande (maximo 5000 filas)' using errcode = '54000';
  end if;
  return jsonb_array_length(p_lote);
end;
$function$;

revoke all on function private.erp_sync_validar_lote(jsonb) from public, anon, authenticated;

-- =========================================================================
-- Reglas de una fila
-- =========================================================================

-- El precio que cotiza el agente: el más barato distinto de cero de los cuatro.
-- NULL si ninguno es > 0 (se lee "a consultar"). `least` ignora los NULL.
create or replace function private.erp_precio_cotizable(
  p_matriz numeric, p_magdalena numeric, p_koreanos numeric, p_sas numeric)
returns numeric
language sql
immutable
parallel safe
set search_path = ''
as $function$
  select least(
    nullif(p_matriz, 0), nullif(p_magdalena, 0), nullif(p_koreanos, 0), nullif(p_sas, 0)
  )
$function$;

revoke all on function private.erp_precio_cotizable(numeric, numeric, numeric, numeric)
  from public, anon, authenticated;

-- `OTROS_COD` del ERP es texto libre: `22311-22360 EGHNH00069`,
-- `13028-ED000/15041-ED000/...`, `SZC-519/USA`, `.....`. Se parte así:
--   1. Por blancos, coma y punto y coma.
--   2. Cada pedazo se parte además por `/` SOLO si todas las partes parecen
--      códigos (al menos 5 letras/dígitos y algún dígito): `13028-ED000/15041-ED000`
--      se parte; `SZC-519/USA`, `4T-L68149/11` o `SIN_1/2_LUNA` no, porque ahí la
--      barra es un sufijo de origen o de medida que `plegar_codigo` ya sabe pelar.
--   3. A lo que no se parte se le sacan las `/` de los bordes (`K972-12-205/`).
--   4. Se descartan los pedazos con menos de 2 letras/dígitos (`.....`, `/`, `A`)
--      y los repetidos, conservando el orden. Tope: 50 códigos.
create or replace function private.erp_partir_codigos(p_texto text)
returns text[]
language sql
immutable
parallel safe
set search_path = ''
as $function$
  with pedazos as (
    select t.pedazo, t.ord
    from regexp_split_to_table(coalesce(p_texto, ''), '[\s,;]+') with ordinality as t(pedazo, ord)
  ),
  partes as (
    select
      p.ord,
      s.parte,
      s.sub,
      bool_and(
        length(regexp_replace(s.parte, '[^A-Za-z0-9]', '', 'g')) >= 5 and s.parte ~ '[0-9]'
      ) over (partition by p.ord) as todas_codigo
    from pedazos p
    cross join lateral regexp_split_to_table(p.pedazo, '/') with ordinality as s(parte, sub)
  ),
  elegidos as (
    select p.ord, p.sub, p.parte as codigo
    from partes p
    where p.todas_codigo
    union all
    -- Sin partir: se le sacan las barras sueltas de los bordes (`K972-12-205/`).
    select p.ord, 1, btrim(p.pedazo, '/')
    from pedazos p
    where not exists (
      select 1 from partes x where x.ord = p.ord and x.todas_codigo
    )
  ),
  unicos as (
    select e.codigo, min(e.ord * 1000 + e.sub) as orden
    from elegidos e
    where length(regexp_replace(e.codigo, '[^A-Za-z0-9]', '', 'g')) >= 2
    group by e.codigo
  )
  select coalesce(
    (select array_agg(u.codigo order by u.orden)
       from (select * from unicos order by orden limit 50) u),
    '{}'::text[]
  )
$function$;

revoke all on function private.erp_partir_codigos(text) from public, anon, authenticated;

-- NULL si la fila cumple el contrato; si no, el motivo (sin datos de la fila más
-- allá del nombre del campo). Las claves permitidas son una lista cerrada: una
-- columna nueva del extractor se rechaza en vez de perderse en silencio.
create or replace function private.erp_producto_fila_error(f jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $function$
declare
  v_extra text;
  v_campo text;
  v_n numeric;
begin
  if jsonb_typeof(f) is distinct from 'object' then
    return 'la fila tiene que ser un objeto JSON';
  end if;

  select k into v_extra
  from jsonb_object_keys(f) as k
  where k not in (
    'no_item', 'codigo', 'otros_codigos', 'n_grupo', 'grupo', 'descripcion',
    'descripcion_auxiliar', 'existencias_total', 'precio_matriz', 'precio_magdalena',
    'precio_koreanos', 'precio_sas_repuestos', 'codigo_difiere')
  limit 1;
  if v_extra is not null then
    return format('campo desconocido %s', left(v_extra, 40));
  end if;

  if jsonb_typeof(f -> 'no_item') is distinct from 'string'
     or btrim(f ->> 'no_item') = ''
     or length(f ->> 'no_item') > 50 then
    return 'no_item tiene que ser texto no vacio de hasta 50 caracteres';
  end if;

  if jsonb_typeof(f -> 'descripcion') is distinct from 'string'
     or btrim(f ->> 'descripcion') = ''
     or length(f ->> 'descripcion') > 500 then
    return 'descripcion tiene que ser texto no vacio de hasta 500 caracteres';
  end if;

  foreach v_campo in array array['codigo', 'otros_codigos', 'n_grupo', 'grupo',
                                 'descripcion_auxiliar'] loop
    if coalesce(jsonb_typeof(f -> v_campo), 'null') not in ('string', 'null')
       or length(f ->> v_campo) > 1000 then
      return format('%s tiene que ser texto (hasta 1000 caracteres) o null', v_campo);
    end if;
  end loop;

  if jsonb_typeof(f -> 'existencias_total') is distinct from 'number' then
    return 'existencias_total tiene que ser un numero';
  end if;
  v_n := (f ->> 'existencias_total')::numeric;
  if v_n < 0 or v_n > 2147483647 then
    return 'existencias_total fuera de rango (0 a 2147483647)';
  end if;

  foreach v_campo in array array['precio_matriz', 'precio_magdalena', 'precio_koreanos',
                                 'precio_sas_repuestos'] loop
    if coalesce(jsonb_typeof(f -> v_campo), 'null') not in ('number', 'null') then
      return format('%s tiene que ser un numero o null', v_campo);
    end if;
    if jsonb_typeof(f -> v_campo) = 'number' then
      v_n := (f ->> v_campo)::numeric;
      -- numeric(12,2): hasta 9.999.999.999,99 después de redondear.
      if v_n < 0 or v_n >= 9999999999.995 then
        return format('%s fuera de rango (0 a 9999999999.99)', v_campo);
      end if;
    end if;
  end loop;

  if coalesce(f ->> 'codigo_difiere', 'no') not in ('si', 'no')
     or coalesce(jsonb_typeof(f -> 'codigo_difiere'), 'null') not in ('string', 'null') then
    return 'codigo_difiere tiene que ser "si", "no" o null';
  end if;

  return null;
end;
$function$;

revoke all on function private.erp_producto_fila_error(jsonb) from public, anon, authenticated;

-- =========================================================================
-- Escritura: upsert de un lote
-- =========================================================================
-- Devuelve cuántas filas insertó o cambió. Una fila idéntica a la guardada no se
-- toca: ni `updated_at`, ni `erp_actualizado_at`, ni el trigger de
-- compatibilidad. Recargar el catálogo entero sin cambios escribe 0 filas.
--
-- `statement_timeout` propio: anon tiene 3 s en Supabase y un lote de 5000 tardó
-- entre 1,3 y 3,2 s en el stack local (medido el 2026-10-05 y el 2026-10-06; el
-- 2026-10-06 un lote cortó con 57014). Medido en el stack local el 2026-10-06:
-- con `set statement_timeout` en la función, una RPC de anon de 4 s termina; sin
-- él, corta a los 3 s. La clave se valida primero, así que sin clave el tope
-- largo no se alcanza.
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
  if p_tabla is distinct from 'productos' then
    raise exception 'Tabla no permitida: %', left(coalesce(p_tabla, '(null)'), 60)
      using errcode = '22023';
  end if;
  if private.erp_sync_validar_lote(p_filas) = 0 then
    return 0;
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

-- =========================================================================
-- Escritura: dar de baja lo que ya no está en el ERP (activo = false)
-- =========================================================================
-- Nunca borra: un producto puede estar cotizado en una sesión
-- (`lead_session.producto_cotizado_id`). Recargarlo lo reactiva.
-- `p_claves`: `[{"no_item": "123"}, ...]`. Devuelve cuántas filas desactivó.
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
  if p_tabla is distinct from 'productos' then
    raise exception 'Tabla no permitida: %', left(coalesce(p_tabla, '(null)'), 60)
      using errcode = '22023';
  end if;
  if private.erp_sync_validar_lote(p_claves) = 0 then
    return 0;
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

-- =========================================================================
-- Escritura: estado del ciclo (inicio / fin). Las horas las pone la base.
-- =========================================================================
create or replace function public.erp_sync_estado_fijar(
  p_clave text,
  p_fase text,
  p_ok boolean default null,
  p_error text default null,
  p_filas_cargadas integer default null)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_error text;
begin
  perform private.erp_sync_autorizar(p_clave);

  if p_filas_cargadas is not null and p_filas_cargadas < 0 then
    raise exception 'filas_cargadas no puede ser negativo' using errcode = '22023';
  end if;

  insert into public.erp_sync_estado (id) values (1) on conflict (id) do nothing;

  if p_fase = 'inicio' then
    update public.erp_sync_estado
       set ultimo_inicio = now(),
           actualizado_at = now()
     where id = 1;
  elsif p_fase = 'fin' then
    -- La clave nunca se guarda, aunque el extractor la metiera en el mensaje.
    v_error := left(replace(coalesce(p_error, ''), p_clave, '[clave]'), 2000);
    update public.erp_sync_estado
       set ultimo_fin = now(),
           ultimo_ok = coalesce(p_ok, false),
           ultimo_exito = case when coalesce(p_ok, false) then now() else ultimo_exito end,
           ultimo_error = case when coalesce(p_ok, false) then null else nullif(v_error, '') end,
           filas_cargadas = coalesce(p_filas_cargadas, filas_cargadas),
           actualizado_at = now()
     where id = 1;
  else
    raise exception 'Fase invalida: %', left(coalesce(p_fase, '(null)'), 30)
      using errcode = '22023';
  end if;
end;
$function$;

-- =========================================================================
-- Configuración: fijar el hash de la clave (solo service_role)
-- =========================================================================
create or replace function public.erp_sync_clave_fijar(p_clave_hash text)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if p_clave_hash is null or p_clave_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'clave_hash tiene que ser el sha256 en hex (64 caracteres)'
      using errcode = '22023';
  end if;
  insert into private.erp_sync_config (id, clave_hash, actualizado_at)
  values (1, p_clave_hash, now())
  on conflict (id) do update
    set clave_hash = excluded.clave_hash,
        actualizado_at = excluded.actualizado_at;
end;
$function$;

-- Supabase da EXECUTE a anon y authenticated por defecto en `public`: se quita
-- explícito y se concede solo lo que hace falta.
revoke all on function public.erp_sync_cargar(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.erp_sync_borrar(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.erp_sync_estado_fijar(text, text, boolean, text, integer)
  from public, anon, authenticated;
revoke all on function public.erp_sync_clave_fijar(text) from public, anon, authenticated;

grant execute on function public.erp_sync_cargar(text, text, jsonb) to anon, service_role;
grant execute on function public.erp_sync_borrar(text, text, jsonb) to anon, service_role;
grant execute on function public.erp_sync_estado_fijar(text, text, boolean, text, integer)
  to anon, service_role;
grant execute on function public.erp_sync_clave_fijar(text) to service_role;
