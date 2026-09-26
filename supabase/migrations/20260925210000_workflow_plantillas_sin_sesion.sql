-- Las plantillas que un flujo le manda a un lead SIN sesión.
-- Spec: docs/prd-workflows.md §4.2 (Enviar plantilla) y la plantilla
-- "Reactivar perdidos" (`workflow-programados`).
--
-- Por qué una tabla y no `mensajes`: `mensajes.lead_session_id` es NOT NULL, y
-- el lead al que más le sirve una plantilla —uno que dejó de hablar— tiene su
-- última sesión cerrada. El cron "Programado" no le pasa esa sesión a la
-- corrida (moverle la etapa o escalar una sesión cerrada reescribiría
-- historia), y abrirle una sesión nueva a cada destinatario llenaría el Inbox de
-- sesiones sin conversación. Es el mismo criterio que usa el motor de difusión
-- con `difusion_envios`.
--
-- Cuando el lead responde, la plantilla se anota en el hilo (en `mensajes`, con
-- el mismo wamid y la hora en que salió) y `mensaje_id` queda apuntando a esa
-- fila. Desde ahí la cuenta el tope de frecuencia por `mensajes`; antes, por
-- esta tabla (`mensaje_id is null`).
--
-- Idempotencia: `idempotency_key` = `wf:<runId>:<orden>`, la misma clave que un
-- envío con sesión deja en `mensajes.idempotency_key`. La fila se escribe ANTES
-- de llamar a Meta: un reintento la ve y no vuelve a mandar.
--
-- Aditiva: tabla nueva, sin tocar ninguna existente.

create table public.workflow_plantillas_sin_sesion (
  id                uuid primary key default gen_random_uuid(),
  idempotency_key   text not null,
  -- `set null`: si se borra la corrida, el envío igual existió y cuenta.
  workflow_run_id   uuid references public.workflow_runs(id) on delete set null,
  -- `cascade`: el derecho al olvido borra el lead y con él a quién le llegó qué.
  lead_id           uuid not null references public.leads(id) on delete cascade,
  conversacion_id   uuid not null references public.conversaciones(id) on delete cascade,
  plantilla_nombre  text not null,
  plantilla_idioma  text not null,
  -- Lo que muestra el hilo cuando se anota: `contenidoDePlantilla()`.
  contenido         text not null,
  parametros_cuerpo jsonb not null default '[]'::jsonb,
  intento_at        timestamptz not null,
  meta_message_id   text,
  estado            text not null default 'reservado',
  estado_at         timestamptz,
  error_codigo      text,
  error_detalle     text,
  -- La fila del hilo, cuando el lead respondió.
  mensaje_id        uuid references public.mensajes(id) on delete set null,
  created_at        timestamptz not null default now(),

  constraint workflow_plantillas_sin_sesion_clave_unica unique (idempotency_key),
  constraint workflow_plantillas_sin_sesion_wamid_unico unique (meta_message_id),
  constraint workflow_plantillas_sin_sesion_estado
    check (estado in ('reservado', 'aceptado', 'entregado', 'leido', 'fallido')),
  -- Aceptado, entregado o leído quiere decir que Meta devolvió un wamid.
  constraint workflow_plantillas_sin_sesion_wamid_si_salio
    check (estado in ('reservado', 'fallido') or meta_message_id is not null),
  constraint workflow_plantillas_sin_sesion_idioma_forma
    check (plantilla_idioma ~ '^[a-z]{2,3}(_[A-Z]{2})?$'),
  constraint workflow_plantillas_sin_sesion_parametros_forma
    check (
      jsonb_typeof(parametros_cuerpo) = 'array'
      and jsonb_array_length(parametros_cuerpo) <= 20
    ),
  constraint workflow_plantillas_sin_sesion_detalle_largo
    check (error_detalle is null or char_length(error_detalle) <= 1000)
);

comment on table public.workflow_plantillas_sin_sesion is
  'Plantillas que un flujo mandó a un lead sin sesión activa. Se anotan en mensajes cuando el lead responde (mensaje_id).';

-- Lo que leen el tope de frecuencia y la anotación al responder: por lead, lo
-- más reciente primero, sólo lo que todavía no está en el hilo.
create index workflow_plantillas_sin_sesion_lead_pendientes
  on public.workflow_plantillas_sin_sesion (lead_id, intento_at desc)
  where mensaje_id is null;

-- Las FK sin índice propio (advisor 0001).
create index workflow_plantillas_sin_sesion_run
  on public.workflow_plantillas_sin_sesion (workflow_run_id);
create index workflow_plantillas_sin_sesion_conversacion
  on public.workflow_plantillas_sin_sesion (conversacion_id);
create index workflow_plantillas_sin_sesion_mensaje
  on public.workflow_plantillas_sin_sesion (mensaje_id);

-- Lectura para el panel (admin y vendedor, como `difusion_envios`). Escribe
-- sólo el motor, con service-role: no hay policy de escritura.
alter table public.workflow_plantillas_sin_sesion enable row level security;

create policy workflow_plantillas_sin_sesion_select on public.workflow_plantillas_sin_sesion
  for select to authenticated
  using ((select public.is_admin()) or (select public.is_vendedor()));

revoke all on table public.workflow_plantillas_sin_sesion from public, anon, authenticated;
grant select on table public.workflow_plantillas_sin_sesion to authenticated;
grant all on table public.workflow_plantillas_sin_sesion to service_role;
