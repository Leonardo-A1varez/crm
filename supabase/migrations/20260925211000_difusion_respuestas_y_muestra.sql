-- Quién respondió a una difusión, y con qué mensaje.
-- Spec: docs/prd-workflows.md §7.6 ("Al terminar: ... respondidos"; "dispara el
-- trigger Difusión respondida") y §4.1 (disparador "Difusión respondida").
--
-- Hasta acá la respuesta sólo quedaba en el hilo (la plantilla anotada en
-- `mensajes`) y en `lead_session.extras`. Para contar respondidos, listar las
-- respuestas en la pantalla de envío y disparar los flujos UNA vez por
-- respuesta, el envío tiene que saberlo:
--
--   respondido_at              cuándo llegó el primer mensaje del lead después
--                              de la difusión (dentro de la ventana de
--                              atribución, `VENTANA_ATRIBUCION_DIAS`).
--   respuesta_meta_message_id  el wamid de ESE mensaje. Es lo que vuelve
--                              idempotente la marca: el reintento del mismo
--                              entrante la encuentra igual y sigue siendo "la
--                              primera"; otro entrante no la pisa.
--
-- Aditiva: dos columnas nullable, un CHECK y un índice parcial. El trigger de
-- transiciones sólo mira `estado`, `difusion_id` y `telefono`: estas columnas
-- no lo tocan.

alter table public.difusion_envios
  add column respondido_at             timestamptz,
  add column respuesta_meta_message_id text;

alter table public.difusion_envios
  add constraint difusion_envios_respuesta_coherente
    check ((respondido_at is null) = (respuesta_meta_message_id is null)),
  -- Sólo responde quien recibió algo.
  add constraint difusion_envios_respuesta_de_un_envio
    check (respondido_at is null or meta_message_id is not null);

comment on column public.difusion_envios.respondido_at is
  'Primer mensaje del lead despues de la difusion (ventana de atribucion). Null = no respondio.';
comment on column public.difusion_envios.respuesta_meta_message_id is
  'wamid del entrante que cuenta como respuesta. Hace idempotente la marca.';

-- La pantalla de envío lista las respuestas de una difusión, lo más nuevo
-- primero, y las cuenta. Parcial: la enorme mayoría de las filas no responde.
create index difusion_envios_respuestas
  on public.difusion_envios (difusion_id, respondido_at desc)
  where respondido_at is not null;

-- =========================================================================
-- La muestra (canary): cuándo se siguió y qué salió en ella
-- =========================================================================
--
--   canary_continuada_at  una persona reanudó después de revisar la muestra.
--                         Lo escribe `reanudar` la primera vez; la pantalla de
--                         envío dice "se continuó a las HH:MM".
--
-- La muestra son los envíos reservados hasta `canary_revisado_at` (el motor la
-- frena apenas salen `canary_tamano`, y no reserva nada más hasta que alguien
-- reanuda). `difusion_envios_muestra` los cuenta por estado y código de error:
-- la muestra puede tener hasta 10.000 filas y traerlas para contarlas en la
-- app pasaría el corte de PostgREST.

alter table public.difusiones
  add column canary_continuada_at timestamptz;

alter table public.difusiones
  add constraint difusiones_canary_continuada_coherente
    check (canary_continuada_at is null or canary_revisado_at is not null);

comment on column public.difusiones.canary_continuada_at is
  'Cuando una persona reanudo despues de revisar la muestra. Null = no se siguio (todavia).';

create function public.difusion_envios_muestra(p_difusion_id uuid, p_hasta timestamptz)
returns table (
  estado public.difusion_envio_estado,
  error_codigo text,
  cantidad bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select e.estado, e.error_codigo, count(*)::bigint
    from public.difusion_envios e
   where e.difusion_id = p_difusion_id
     and e.intento_at is not null
     and e.intento_at <= p_hasta
   group by e.estado, e.error_codigo;
$$;

revoke all on function public.difusion_envios_muestra(uuid, timestamptz) from public, anon;
grant execute on function public.difusion_envios_muestra(uuid, timestamptz)
  to authenticated, service_role;
