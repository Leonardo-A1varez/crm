-- Busquedas del agente que el catalogo no encontro.
--
-- Cada llamada del agente a `buscar_repuesto` queda en `tool_executions`
-- (args = {query, marca?, modelo?, anio?}, result = {matches, count}). Esta funcion
-- agrupa las que volvieron con `count = 0` para que el dueno vea que siglas o
-- productos faltan en el catalogo.
--
-- Alcance: las filas se borran en cascada con la sesion (~29 dias despues de
-- cerrarla), asi que el reporte cubre aproximadamente el ultimo mes.
--
-- Que NO cuenta: las filas con `error` no nulo (la herramienta fallo, no es un
-- producto que falte). El vencimiento por `timeout_tool_ms` tampoco se puede
-- distinguir aca: se audita la llamada interna al catalogo, que termina con su
-- resultado real aunque el modelo ya haya recibido el aviso de timeout.
--
-- Agrupa por el texto plegado (`plegar_texto`: minusculas y sin tildes) y
-- recortado, mas marca, modelo y anio. Admin-only: la RLS de `tool_executions`
-- deja leer a vendedores, pero este reporte es del dueno, asi que la funcion
-- lo exige. `security invoker`: corre con el rol de quien llama.

create or replace function public.busquedas_sin_resultado(
  p_desde timestamptz default (now() - interval '30 days'),
  p_limite integer default 100
)
returns table (
  busqueda text,
  marca text,
  modelo text,
  anio integer,
  veces bigint,
  ultima_vez timestamptz
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if not (select public.is_admin()) then
    raise exception 'solo admin' using errcode = '42501';
  end if;

  return query
  select
    public.plegar_texto(btrim(t.args ->> 'query')) as busqueda,
    nullif(public.plegar_texto(btrim(coalesce(t.args ->> 'marca', ''))), '') as marca,
    nullif(public.plegar_texto(btrim(coalesce(t.args ->> 'modelo', ''))), '') as modelo,
    case when t.args ->> 'anio' ~ '^[0-9]{1,4}$' then (t.args ->> 'anio')::integer end as anio,
    count(*) as veces,
    max(t.created_at) as ultima_vez
  from public.tool_executions t
  where t.tool_name = 'buscar_repuesto'
    and t.error is null
    and t.created_at >= p_desde
    and jsonb_typeof(t.result) = 'object'
    and t.result ->> 'count' = '0'
    and nullif(btrim(coalesce(t.args ->> 'query', '')), '') is not null
  group by 1, 2, 3, 4
  order by veces desc, ultima_vez desc
  limit greatest(least(coalesce(p_limite, 100), 500), 1);
end;
$$;

revoke all on function public.busquedas_sin_resultado(timestamptz, integer) from public, anon;
grant execute on function public.busquedas_sin_resultado(timestamptz, integer) to authenticated;
