-- Qué otros leads comparten un identificador con este, y de qué tipo.
--
-- Es el corazón del detector de duplicados nuevo. Antes se proponía un par por
-- nombre exacto + canales distintos + ventana de 7 días: débil por un lado (hay
-- cientos de "Carlos Gómez") y demasiado estricto por el otro (dos leads del
-- mismo canal, o de hace ocho días, no se proponían nunca). Compartir un RUC,
-- un VIN, una placa, un teléfono o un correo es evidencia de ser la misma
-- persona; compartir el nombre no lo es.
--
-- Una RPC y no dos consultas desde TypeScript: el join se apoya en el índice
-- `(tipo, valor)` y devuelve el agregado en un solo viaje. Traer los
-- identificadores del lead y después preguntar por cada valor sería N+1 sobre
-- la tabla que más crece.

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
  select
    otro.lead_id,
    array_agg(distinct otro.tipo::text order by otro.tipo::text) as tipos
  from public.lead_identificadores as mio
  join public.lead_identificadores as otro
    on otro.tipo = mio.tipo
   and otro.valor = mio.valor
   and otro.lead_id <> mio.lead_id
  where mio.lead_id = p_lead_id
  group by otro.lead_id
$function$;

revoke all on function public.leads_que_comparten_identificador(uuid) from public;
revoke all on function public.leads_que_comparten_identificador(uuid) from anon;
grant execute on function public.leads_que_comparten_identificador(uuid) to authenticated;
grant execute on function public.leads_que_comparten_identificador(uuid) to service_role;

comment on function public.leads_que_comparten_identificador(uuid) is
  'Leads que comparten al menos un identificador con el dado, con los tipos que coinciden. Base del detector de duplicados.';
