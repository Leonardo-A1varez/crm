-- La detección de duplicados mira las dos tablas.
--
-- Desde que el vehículo se mudó a `lead_vehiculos` (migración 20260814230000),
-- la placa y el VIN ya no están en `lead_identificadores`, así que la versión
-- anterior de esta función había dejado de poder verlos. Y son las dos señales
-- más fuertes que existen: un VIN identifica un auto único en el mundo.
--
-- La firma no cambia —`(lead_id uuid, tipos text[])`— y los tipos siguen siendo
-- los mismos strings: 'telefono', 'email', 'ruc', 'cedula' salen de la persona,
-- 'placa' y 'vin' salen del auto. Para el detector es una sola lista de razones.
--
-- La placa NO se copia también a `lead_identificadores`. Dos copias del mismo
-- dato se desincronizan —alguien corrige una y no la otra— y a partir de ahí el
-- detector miente: propone pares por un valor viejo, o deja de proponerlos por
-- uno nuevo. La unión se hace acá, en la consulta, que es donde no puede
-- divergir.

create or replace function public.leads_que_comparten_identificador(
  p_lead_id uuid
)
returns table (
  lead_id uuid,
  tipos text[]
)
language sql
stable
security invoker
set search_path = ''
as $function$
  -- Tres joins unidos y no un CTE con las dos tablas apiladas: un CTE
  -- referenciado dos veces se materializa, y materializar `lead_identificadores`
  -- entera para después filtrar por un lead es un scan completo de la tabla que
  -- más crece. Así cada rama arranca por el índice de `lead_id` del lado propio
  -- y cruza por el índice del valor del lado ajeno.
  select
    coincidencias.lead_id,
    array_agg(distinct coincidencias.tipo order by coincidencias.tipo) as tipos
  from (
    -- La persona: teléfono, correo, documento fiscal.
    select otro.lead_id, otro.tipo::text as tipo
      from public.lead_identificadores as mio
      join public.lead_identificadores as otro
        on otro.tipo = mio.tipo
       and otro.valor = mio.valor
       and otro.lead_id <> mio.lead_id
     where mio.lead_id = p_lead_id

    union all

    -- El auto, por placa. `mio.placa is not null` alcanza: en SQL nada iguala a
    -- NULL, así que el join ya descarta los vehículos sin placa del otro lado.
    select otro.lead_id, 'placa'::text
      from public.lead_vehiculos as mio
      join public.lead_vehiculos as otro
        on otro.placa = mio.placa
       and otro.lead_id <> mio.lead_id
     where mio.lead_id = p_lead_id
       and mio.placa is not null

    union all

    -- El auto, por VIN.
    select otro.lead_id, 'vin'::text
      from public.lead_vehiculos as mio
      join public.lead_vehiculos as otro
        on otro.vin = mio.vin
       and otro.lead_id <> mio.lead_id
     where mio.lead_id = p_lead_id
       and mio.vin is not null
  ) as coincidencias
  group by coincidencias.lead_id
$function$;

revoke all on function public.leads_que_comparten_identificador(uuid) from public;
revoke all on function public.leads_que_comparten_identificador(uuid) from anon;
grant execute on function public.leads_que_comparten_identificador(uuid) to authenticated;
grant execute on function public.leads_que_comparten_identificador(uuid) to service_role;

comment on function public.leads_que_comparten_identificador(uuid) is
  'Leads que comparten al menos un identificador con el dado, con los tipos que coinciden. Une las dos fuentes: lead_identificadores (persona: telefono, email, ruc, cedula) y lead_vehiculos (auto: placa, vin). Base del detector de duplicados.';
