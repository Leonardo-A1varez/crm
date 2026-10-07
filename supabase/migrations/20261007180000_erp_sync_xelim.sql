-- ERP: los items marcados XELIM quedan inactivos.
--
-- En el ERP, una descripcion_auxiliar que empieza con XELIM (XELIM, XELIM DELPHI…)
-- significa «eliminar» (el dueño: XELIMINAR). La carga reactivaba toda fila que
-- recibía; ahora ctivo es false si la descripcion_auxiliar, sin blancos de los
-- extremos y en mayúsculas, empieza con XELIM, y true en cualquier otro caso. El
-- resto de erp_sync_cargar (clave, tablas, validación, límites, ramas de marcas)
-- es el de 20261007160000_catalogo_marcas.sql.
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
      coalesce(f ->> 'codigo_difiere', 'no') = 'si' as codigo_difiere,
      upper(btrim(coalesce(f ->> 'descripcion_auxiliar', ''))) like 'XELIM%' as eliminar
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
    r.codigo_difiere, not r.eliminar, now()
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
         activo = excluded.activo,
         erp_actualizado_at = excluded.erp_actualizado_at
   where (t.codigo_fabrica, t.otros_codigos, t.categoria, t.nombre, t.descripcion, t.stock,
          t.precio_matriz, t.precio_magdalena, t.precio_koreanos, t.precio_sas_repuestos,
          t.precio, t.codigo_difiere, t.activo)
         is distinct from
         (excluded.codigo_fabrica, excluded.otros_codigos, excluded.categoria, excluded.nombre,
          excluded.descripcion, excluded.stock, excluded.precio_matriz, excluded.precio_magdalena,
          excluded.precio_koreanos, excluded.precio_sas_repuestos, excluded.precio,
          excluded.codigo_difiere, excluded.activo);

  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;

-- create or replace conserva los grants de la función.

