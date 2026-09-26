-- Ajustes › Salud de WhatsApp: el rol de cada número y el uso del cupo.
--
-- Aditiva: una tabla nueva, una función nueva y dos índices parciales. No
-- cambia ninguna columna ni política existente.

-- =========================================================================
-- Rol de cada número
-- =========================================================================
--
-- El diseño muestra "Casilla principal", "Ventas mayorista", "Posventa" al
-- lado de cada número. Es una ETIQUETA que pone el admin para saber qué es
-- cada línea: no rutea nada ni decide por qué número sale un mensaje (hoy el
-- CRM manda por un solo número, `META_WHATSAPP_PHONE_NUMBER_ID`).
--
-- La clave es el `phone_number_id` de Meta y no una FK: los números viven en
-- Meta, no en esta base, y se leen por API en cada visita a la pantalla.

create table public.whatsapp_numeros_rol (
  phone_number_id text primary key,
  rol             text not null,
  actualizado_por uuid references public.usuarios(id) on delete set null,
  updated_at      timestamptz not null default now(),
  -- Los ids de Meta son numéricos. Validado también en el Server Action.
  constraint whatsapp_numeros_rol_id_forma check (phone_number_id ~ '^[0-9]{1,30}$'),
  -- Sin rol se borra la fila: un texto vacío no es un rol.
  constraint whatsapp_numeros_rol_rol_largo check (char_length(btrim(rol)) between 1 and 40)
);

comment on table public.whatsapp_numeros_rol is
  'Etiqueta que el admin le pone a cada numero de WhatsApp (Casilla principal, Posventa...). Solo informativa: no rutea envios.';

create index whatsapp_numeros_rol_actualizado_por
  on public.whatsapp_numeros_rol (actualizado_por);

alter table public.whatsapp_numeros_rol enable row level security;

create policy whatsapp_numeros_rol_select on public.whatsapp_numeros_rol
  for select to authenticated
  using ((select public.is_admin()) or (select public.is_vendedor()));
create policy whatsapp_numeros_rol_insert_admin on public.whatsapp_numeros_rol
  for insert to authenticated
  with check ((select public.is_admin()));
create policy whatsapp_numeros_rol_update_admin on public.whatsapp_numeros_rol
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
create policy whatsapp_numeros_rol_delete_admin on public.whatsapp_numeros_rol
  for delete to authenticated
  using ((select public.is_admin()));

revoke all on table public.whatsapp_numeros_rol from public, anon;
grant select, insert, update, delete on table public.whatsapp_numeros_rol to authenticated;
grant all on table public.whatsapp_numeros_rol to service_role;

-- =========================================================================
-- Uso del cupo: destinatarios distintos por día fuera de la ventana
-- =========================================================================
--
-- Meta expone el escalón (`whatsapp_business_manager_messaging_limit`) y no
-- cuánto se usó. Su definición (developers.facebook.com/docs/whatsapp/
-- messaging-limits, leída el 2026-09-25): "the maximum number of unique
-- WhatsApp user phone numbers your business can deliver messages to, outside
-- of a customer service window, within a moving 24-hour period".
--
-- Se reconstruye con lo que salió por este CRM. Tres lugares escriben una
-- plantilla que salió:
--
--   1. `difusion_envios` — el motor de difusión.
--   2. `mensajes` con `tipo = 'template'` — `MetaApiService.sendTemplate`
--      (flujos con sesión).
--   3. `workflow_plantillas_sin_sesion` — flujos a leads sin sesión. Cuando el
--      lead responde se anota también en `mensajes` con la misma hora; se
--      deduplica por destinatario y día, así que no cuenta doble.
--
-- Cuenta lo que Meta ACEPTÓ (tiene wamid y no terminó fallido), no sólo lo
-- entregado: el webhook de entrega puede no haber llegado todavía, y contar
-- de menos haría ver cupo libre que no lo está.
--
-- "Fuera de la ventana" = sin un entrante de ese mismo número de WhatsApp en
-- las 24 h anteriores al envío. Un texto libre no puede salir fuera de la
-- ventana (Meta lo rechaza), así que sólo se miran plantillas.
--
-- Lo que NO captura, y la pantalla lo dice: envíos hechos fuera de este CRM
-- (otra integración, la app de WhatsApp Business u otro número del mismo
-- portfolio), y el "enviar de prueba a mi número" de difusión, que sólo queda
-- en `admin_actions` con el número enmascarado.
--
-- Por día calendario en la zona del negocio y no por ventana móvil de 24 h:
-- los días son lo que se puede dibujar y comparar. La pantalla lo aclara.
--
-- `security invoker`: corre con el rol del que llama. Las tres tablas son
-- legibles por admin y vendedor, así que nadie ve un número recortado.
-- Devuelve a lo sumo `p_dias` filas: no se acerca al corte de PostgREST.

create function public.uso_cupo_whatsapp(p_dias integer, p_zona text)
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
    select e.telefono as destinatario, e.intento_at as salio_at
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
  'Destinatarios distintos por dia de plantillas que salieron por este CRM fuera de la ventana de 24 h, en la zona p_zona. total_ventana = distintos en todos los dias.';

revoke all on function public.uso_cupo_whatsapp(integer, text) from public, anon;
grant execute on function public.uso_cupo_whatsapp(integer, text) to authenticated, service_role;

-- Lo que filtra la función por fecha. Parciales: sólo las filas que pueden
-- haber salido. El chequeo de ventana usa `conversaciones (canal,
-- canal_thread_id)` (unique) y `mensajes_conv_created_idx`, que ya existen.
create index difusion_envios_intento_at
  on public.difusion_envios (intento_at)
  where intento_at is not null;
create index mensajes_plantillas_salientes_created
  on public.mensajes (created_at)
  where direction = 'out' and tipo = 'template';
create index workflow_plantillas_sin_sesion_intento_at
  on public.workflow_plantillas_sin_sesion (intento_at);
