-- ERP: el extractor pide las claves de lo que el CRM tiene activo del ERP.
--
-- Para qué: `erp_sync_borrar` solo da de baja los `no_item` que el extractor VIO
-- desaparecer. Si una corrida se cortó, o un item se borró en Oracle mientras el
-- extractor estaba apagado, la baja nunca llega y el agente sigue cotizando un item
-- que ya no existe. Con esta lista el extractor reconcilia: lo que está acá y no está
-- en Oracle se da de baja (con su propio umbral de seguridad, ver el contrato).
-- Aprobado por el dueño el 2026-10-08.
-- Contrato: docs/integraciones/erp-oracle-contrato-crm.md §4.1.
--
-- Qué devuelve: SOLO `codigo_interno` de productos con `activo` y
-- `erp_actualizado_at is not null`. Nada más de la fila (ni precios, ni nombre).
--
-- Por qué `erp_actualizado_at` sirve de "vino del ERP" y no hace falta una columna
-- `origen` (revisado el 2026-10-08 en este repo):
--   * La escriben solo `erp_sync_cargar` (insert y update, versiones de
--     20261006130100, 20261007160000, 20261007180000 y 20261008120200) y
--     `erp_sync_borrar` (que además pone `activo = false`, así que no entra acá).
--   * El alta manual (`createProducto` → `CreateProductoServiceInput`) no la trae; la
--     edición manual no puede (`ProductoUpdate` la excluye); el import CSV
--     (`bulkUpsert`) arma su payload sin ella.
--   * Error posible, en la dirección segura: un producto cargado a mano ANTES del ERP
--     cuya fila del ERP vino idéntica a la guardada (el upsert no escribe filas sin
--     cambios) queda con NULL y no aparece. Que no aparezca solo significa que la
--     reconciliación no lo da de baja; nunca aparece un producto que no vino del ERP.
--
-- Modelo de seguridad: el de 20261006130100_erp_sync.sql. `security definer` porque
-- anon no tiene ningún grant sobre `productos`; la clave se valida ANTES que todo lo
-- demás (42501); tabla de una lista cerrada (22023); límite 1..5000 (22023 / 54000);
-- ejecutan solo anon y service_role.

-- Índice parcial para el recorrido por clave en orden de bytes. Sin él, cada página
-- ordena todo el catálogo activo (~27 mil filas) para quedarse con 5000.
create index if not exists productos_erp_activos_codigo_c_idx
  on public.productos (codigo_interno collate "C")
  where activo and erp_actualizado_at is not null;

create or replace function public.erp_sync_claves(
  p_clave text,
  p_tabla text,
  p_despues text default null,
  p_limite integer default 5000)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '60s'
as $function$
declare
  v_claves text[];
  v_n integer;
begin
  perform private.erp_sync_autorizar(p_clave);
  if p_tabla is distinct from 'productos' then
    raise exception 'Tabla no permitida: %', left(coalesce(p_tabla, '(null)'), 60)
      using errcode = '22023';
  end if;
  if p_limite is null or p_limite < 1 then
    raise exception 'p_limite tiene que ser de 1 a 5000' using errcode = '22023';
  end if;
  if p_limite > 5000 then
    raise exception 'Limite demasiado grande (maximo 5000 claves)' using errcode = '54000';
  end if;
  if length(p_despues) > 256 then
    raise exception 'p_despues demasiado largo (maximo 256 caracteres)' using errcode = '22023';
  end if;

  -- Orden y comparación por bytes (`collate "C"`): el extractor compara igual sin
  -- depender de la intercalación de la base.
  select array_agg(x.codigo_interno order by x.codigo_interno collate "C")
    into v_claves
  from (
    select p.codigo_interno
    from public.productos as p
    where p.activo
      and p.erp_actualizado_at is not null
      and (p_despues is null or p.codigo_interno collate "C" > p_despues collate "C")
    order by p.codigo_interno collate "C"
    limit p_limite
  ) as x;

  v_n := coalesce(cardinality(v_claves), 0);
  return jsonb_build_object(
    'claves', coalesce(to_jsonb(v_claves), '[]'::jsonb),
    'siguiente', case when v_n = p_limite then to_jsonb(v_claves[v_n]) else 'null'::jsonb end
  );
end;
$function$;

comment on function public.erp_sync_claves(text, text, text, integer) is
  'Claves (codigo_interno) de los productos activos cargados por el ERP, de a p_limite (1..5000), en orden de bytes, despues de p_despues. {claves, siguiente}: siguiente = ultima clave si la pagina vino llena, si no null. Exige la clave de sincronizacion.';

-- Supabase da EXECUTE a anon y authenticated por defecto en `public`.
revoke all on function public.erp_sync_claves(text, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.erp_sync_claves(text, text, text, integer)
  to anon, service_role;
