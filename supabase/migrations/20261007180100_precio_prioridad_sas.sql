-- Precio que cotiza el agente: prioridad por empresa en vez del más barato.
--
-- Antes: el más barato distinto de cero de los cuatro. Ahora (dueño, 2026-10-07):
--   1. `precio_sas_repuestos` (empresa 6) si es > 0;
--   2. si no, `precio_matriz` (empresa 1; «Norte» es una Matriz local) si es > 0;
--   3. si no, `precio_koreanos` y después `precio_magdalena`, el primero > 0;
--   4. si ninguno es > 0, null («a consultar»).
--
-- erp_sync_cargar llama a esta función con (matriz, magdalena, koreanos, sas):
-- la firma no cambia, así que alcanza con reemplazar el cuerpo.
create or replace function private.erp_precio_cotizable(
  p_matriz numeric, p_magdalena numeric, p_koreanos numeric, p_sas numeric)
returns numeric
language sql
immutable
parallel safe
set search_path = ''
as $function$
  select coalesce(
    nullif(p_sas, 0), nullif(p_matriz, 0), nullif(p_koreanos, 0), nullif(p_magdalena, 0)
  )
$function$;

revoke all on function private.erp_precio_cotizable(numeric, numeric, numeric, numeric)
  from public, anon, authenticated;

-- Recalcula lo ya cargado. Solo toca `precio`: el trigger de
-- compatibilidad_pendiente reacciona únicamente a `update of nombre`.
update public.productos
   set precio = private.erp_precio_cotizable(
         precio_matriz, precio_magdalena, precio_koreanos, precio_sas_repuestos)
 where precio is distinct from private.erp_precio_cotizable(
         precio_matriz, precio_magdalena, precio_koreanos, precio_sas_repuestos);
