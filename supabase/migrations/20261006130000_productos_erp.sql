-- El catálogo del ERP (Oracle) entra en `productos`.
--
-- Lo carga el extractor de Bodega Web (`sync-oracle`, en la PC del dueño) por las
-- RPC de `20261006130100_erp_sync.sql`. El CRM nunca se conecta a Oracle.
-- Contrato: docs/integraciones/erp-oracle-contrato-crm.md.
--
-- Lo nuevo:
--   * Los cuatro precios de venta del ERP, uno por empresa (lista 1):
--     1 Matriz, 3 Magdalena, 5 Koreanos SAS, 6 SAS Repuestos.
--   * `precio` sigue siendo la columna que leen el agente, el formulario y la
--     búsqueda. Para lo que viene del ERP es el MÁS BARATO distinto de cero de los
--     cuatro (decisión del dueño, 2026-10-05). Sin ninguno > 0 queda NULL, que se
--     lee "a consultar": por eso deja de ser NOT NULL. El CHECK `precio >= 0`
--     sigue (NULL lo pasa).
--   * `codigo_difiere`: el mismo No. Item tiene distinto código de fábrica en otra
--     empresa. Solo se muestra; no cambia ninguna regla.
--   * `erp_actualizado_at`: la última vez que la carga del ERP CAMBIÓ algo de la
--     fila (no la última corrida: eso está en `erp_sync_estado.ultimo_exito`).
--   * `compatibilidad_pendiente`: el nombre (la descripción comprimida que se
--     traduce a compatibilidad) es nuevo o cambió. La prende un trigger; la apaga
--     el proceso que rellena `compatibilidad`.

alter table public.productos
  add column if not exists precio_matriz numeric(12, 2),
  add column if not exists precio_magdalena numeric(12, 2),
  add column if not exists precio_koreanos numeric(12, 2),
  add column if not exists precio_sas_repuestos numeric(12, 2),
  add column if not exists codigo_difiere boolean not null default false,
  add column if not exists erp_actualizado_at timestamptz,
  add column if not exists compatibilidad_pendiente boolean not null default false;

alter table public.productos alter column precio drop not null;

alter table public.productos
  drop constraint if exists productos_precios_erp_check;
alter table public.productos
  add constraint productos_precios_erp_check check (
    coalesce(precio_matriz, 0) >= 0
    and coalesce(precio_magdalena, 0) >= 0
    and coalesce(precio_koreanos, 0) >= 0
    and coalesce(precio_sas_repuestos, 0) >= 0
  );

comment on column public.productos.precio is
  'Precio que cotiza el agente. Para lo cargado del ERP: el mas barato distinto de cero de los cuatro precios por empresa. NULL = a consultar.';
comment on column public.productos.precio_matriz is 'PVP lista 1 de la empresa 1 (Matriz) en el ERP. NULL = sin precio ahi.';
comment on column public.productos.precio_magdalena is 'PVP lista 1 de la empresa 3 (Magdalena) en el ERP.';
comment on column public.productos.precio_koreanos is 'PVP lista 1 de la empresa 5 (Koreanos SAS) en el ERP.';
comment on column public.productos.precio_sas_repuestos is 'PVP lista 1 de la empresa 6 (SAS Repuestos) en el ERP.';
comment on column public.productos.codigo_difiere is
  'El mismo No. Item tiene distinto codigo de fabrica en alguna empresa del ERP. Solo informativo.';
comment on column public.productos.erp_actualizado_at is
  'Ultima vez que la carga del ERP cambio algo de esta fila. NULL = nunca vino del ERP.';
comment on column public.productos.compatibilidad_pendiente is
  'El nombre es nuevo o cambio y compatibilidad no se recalculo. La prende un trigger; la apaga quien rellena compatibilidad.';

-- =========================================================================
-- compatibilidad_pendiente: nombre nuevo o cambiado
-- =========================================================================

create or replace function private.productos_marcar_compatibilidad_pendiente()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if tg_op = 'INSERT' or new.nombre is distinct from old.nombre then
    new.compatibilidad_pendiente := true;
  end if;
  return new;
end;
$function$;

revoke all on function private.productos_marcar_compatibilidad_pendiente()
  from public, anon, authenticated;

drop trigger if exists productos_compatibilidad_pendiente on public.productos;
create trigger productos_compatibilidad_pendiente
  before insert or update of nombre on public.productos
  for each row execute function private.productos_marcar_compatibilidad_pendiente();

-- Lo lee el proceso de compatibilidad: pocas filas pendientes entre ~27 mil.
create index if not exists productos_compatibilidad_pendiente_idx
  on public.productos (id)
  where compatibilidad_pendiente;

-- =========================================================================
-- productos_listar: precio nulo al final y las columnas del ERP en cada fila
-- =========================================================================
-- Igual a la de 20261001120000_productos_filtros_y_facetas.sql salvo tres cosas:
--   * `precio` ordena con `nulls last` en las dos direcciones, como el resto de
--     las columnas con vacíos (antes no hacía falta: era NOT NULL).
--   * Se puede ordenar por cada uno de los cuatro precios del ERP
--     (`precio_matriz`, `precio_magdalena`, `precio_koreanos`,
--     `precio_sas_repuestos`), también con `nulls last`. Los nombres de campo del
--     lado TypeScript viven en `CAMPOS_ORDEN` / `campoOrdenSql`
--     (src/lib/catalogo/columnas-productos.ts).
--   * Cada fila trae además los cuatro precios del ERP, `codigo_difiere` y
--     `erp_actualizado_at`.
create or replace function public.productos_listar(
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
  v_bordes constant text := E' \t\r\n ';
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
      when 'precio' then format('p.precio %1$s nulls last', v_dir)
      when 'precio_matriz' then format('p.precio_matriz %1$s nulls last', v_dir)
      when 'precio_magdalena' then format('p.precio_magdalena %1$s nulls last', v_dir)
      when 'precio_koreanos' then format('p.precio_koreanos %1$s nulls last', v_dir)
      when 'precio_sas_repuestos' then format('p.precio_sas_repuestos %1$s nulls last', v_dir)
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
              'precio_matriz', p.precio_matriz,
              'precio_magdalena', p.precio_magdalena,
              'precio_koreanos', p.precio_koreanos,
              'precio_sas_repuestos', p.precio_sas_repuestos,
              'codigo_difiere', p.codigo_difiere,
              'erp_actualizado_at', p.erp_actualizado_at,
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
  'Lote ordenado del catalogo filtrado + total real, como {total, items}. p_orden: hasta 3 niveles [{campo, dir}] sobre campos de una lista blanca; siempre desempata por codigo (orden total). p_cantidad se acota a 1..1000. Cada item trae los cuatro precios del ERP, codigo_difiere y erp_actualizado_at.';
