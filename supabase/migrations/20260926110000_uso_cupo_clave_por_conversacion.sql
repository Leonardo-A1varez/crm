-- Correcciones a `20260926100000_ajustes_rol_numero_y_uso_cupo.sql`, que ya
-- está aplicada en crm-dev y no se reescribe.
--
-- 1. Índice duplicado. `mensajes_plantillas_salientes_created` es idéntico a
--    `mensajes_plantillas_salientes_idx` (misma columna, mismo predicado), que
--    ya existía desde `20260914043219_difusion_resolver.sql`. Se detectó con
--    `select indexname from pg_indexes where tablename = 'mensajes' and
--    indexdef like '%template%'` en el stack local: devolvía los dos. Un
--    duplicado sólo cuesta escrituras.
--
-- 2. La clave del destinatario de una difusión. La versión anterior cruzaba
--    `difusion_envios.telefono` (dígitos E.164 que salen de normalizar
--    `leads.telefono`, `lib/difusion/telefono.ts`) contra
--    `conversaciones.canal_thread_id` (el `from` que manda Meta). Para un lead
--    que nació por WhatsApp son el mismo texto: el pipeline guarda
--    `leads.telefono = meta_user_id` (`on-message-received.ts`), y en el stack
--    local las 3 conversaciones de WhatsApp dan iguales. Pero un teléfono
--    cargado a mano puede no coincidir con el `from` (en Argentina y México
--    Meta a veces omite el 9 o el 1, ver `parse-webhook.ts`), y ahí la misma
--    persona contaba dos veces y el chequeo de ventana no veía su entrante.
--    Ahora, si el lead del envío tiene conversación de WhatsApp, la clave es
--    su `canal_thread_id`; si no la tiene, el teléfono del envío.
--
-- Sin aplicar: la aplica el dueño con el resto.

drop index if exists public.mensajes_plantillas_salientes_created;

create or replace function public.uso_cupo_whatsapp(p_dias integer, p_zona text)
returns table (dia date, destinatarios bigint, total_ventana bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  with ventana as (
    select
      (now() at time zone p_zona)::date - (p_dias - 1) as primer_dia,
      (((now() at time zone p_zona)::date - (p_dias - 1))::timestamp at time zone p_zona) as desde
    where p_dias between 1 and 31
  ),
  salidas as (
    select coalesce(
             (select c.canal_thread_id
                from public.conversaciones c
               where c.lead_id = e.lead_id
                 and c.canal = 'wa'
               order by c.ultima_actividad_at desc
               limit 1),
             e.telefono
           ) as destinatario,
           e.intento_at as salio_at
      from public.difusion_envios e, ventana v
     where e.intento_at >= v.desde
       and e.estado in ('aceptado', 'entregado', 'leido')
       and e.telefono is not null
    union all
    select c.canal_thread_id, m.created_at
      from public.mensajes m
      join public.conversaciones c on c.id = m.conversacion_id
      cross join ventana v
     where m.direction = 'out'
       and m.tipo = 'template'
       and m.created_at >= v.desde
       and m.meta_message_id is not null
       and m.estado_entrega is distinct from 'fallido'
       and c.canal = 'wa'
    union all
    select c.canal_thread_id, p.intento_at
      from public.workflow_plantillas_sin_sesion p
      join public.conversaciones c on c.id = p.conversacion_id
      cross join ventana v
     where p.intento_at >= v.desde
       and p.estado in ('aceptado', 'entregado', 'leido')
       and c.canal = 'wa'
  ),
  fuera_de_ventana as (
    select s.destinatario, (s.salio_at at time zone p_zona)::date as dia
      from salidas s
     where not exists (
       select 1
         from public.conversaciones c
         join public.mensajes m on m.conversacion_id = c.id
        where c.canal = 'wa'
          and c.canal_thread_id = s.destinatario
          and m.direction = 'in'
          and m.created_at > s.salio_at - interval '24 hours'
          and m.created_at <= s.salio_at
     )
  ),
  dias as (
    select (v.primer_dia + i)::date as dia
      from ventana v, generate_series(0, p_dias - 1) as i
  )
  select d.dia,
         count(distinct f.destinatario)::bigint,
         (select count(distinct destinatario) from fuera_de_ventana)::bigint
    from dias d
    left join fuera_de_ventana f on f.dia = d.dia
   group by d.dia
   order by d.dia;
$$;

comment on function public.uso_cupo_whatsapp(integer, text) is
  'Destinatarios distintos por dia de plantillas que salieron por este CRM fuera de la ventana de 24 h, en la zona p_zona. Clave: canal_thread_id de WhatsApp del lead, o el telefono del envio si no tiene conversacion. total_ventana = distintos en todos los dias.';
