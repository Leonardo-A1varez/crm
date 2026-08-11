-- Recordatorio de seguimiento sobre una conversación: "volver a contactar en 2
-- días". Pedido del dueño: sin esto, el lead que dijo "lo pienso" desaparece.
--
-- TABLA NUEVA Y NO REUSAR `reactivation_dispatches`. Se parecen en la forma
-- —las dos cuelgan de `lead_session` y las dos hablan de volver a un lead— y
-- son cosas opuestas:
--
--   * `reactivation_dispatches` es el AUDIT de un template de Meta que YA SE LE
--     MANDÓ al cliente. Es append-only, no tiene estado, no se cancela, y su
--     `created_at` existe para hacer cumplir un cooldown. Además solo mira
--     sesiones CERRADAS con `resultado = 'perdido'`.
--   * Esto es una CITA A FUTURO sobre una sesión ABIERTA, que no le manda nada
--     a nadie: se dispara hacia adentro (chip en el Inbox), tiene ciclo de vida
--     (pendiente → avisado | cancelado) y se cancela sola si el cliente
--     escribe.
--
-- Meterlas en la misma tabla obligaría a que la mitad de las columnas fueran
-- NULL en cada caso y a que el cron de reactivación aprendiera a ignorar filas
-- que no le pertenecen.
--
-- CASCADE con lead_session: la cita es de esta conversación. Si la sesión se
-- cierra y a los 29 días el cron de purga la borra, el recordatorio va con ella
-- (y ya no significaría nada: el embudo de ese lead terminó).

create table public.session_recordatorios (
  id uuid primary key default gen_random_uuid(),

  lead_session_id uuid not null
    references public.lead_session(id) on delete cascade,

  -- Cuándo hay que volver. Es la fecha a la que duerme el `step.sleepUntil` del
  -- workflow, y también la que usa la bandeja como red: ver el índice de abajo.
  recordar_at timestamptz not null,

  -- Lo que el vendedor va a leer cuando esto se dispare ("dijo que lo pensaba,
  -- tiene el precio"). Texto libre corto; el tope real lo pone el schema Zod.
  -- PUEDE CONTENER DATOS DEL CLIENTE: no se loguea nunca.
  nota text not null default '',

  -- pendiente → avisado (lo escribe el workflow al despertarse)
  --           → cancelado (a mano, o porque el cliente escribió antes)
  -- `avisado` es terminal a propósito: no hay "atendido". El vendedor apaga el
  -- recordatorio contestando —lo que lo cancela solo— o cancelándolo.
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'avisado', 'cancelado')),

  -- 'manual' | 'respondio'. Sin esto no se puede responder después cuántos
  -- seguimientos se apagaron porque el cliente volvió solo, que es la métrica
  -- que dice si la función sirve.
  motivo_cancelacion text
    check (motivo_cancelacion in ('manual', 'respondio')),

  creado_por uuid references public.usuarios(id) on delete set null,

  created_at   timestamptz not null default now(),
  avisado_at   timestamptz,
  cancelado_at timestamptz,

  -- Un estado y sus sellos no pueden contradecirse. Sin esto una fila podría
  -- decir `cancelado` sin motivo y nadie sabría por qué se apagó.
  constraint session_recordatorios_estado_coherente check (
    (estado = 'pendiente' and avisado_at is null and cancelado_at is null
      and motivo_cancelacion is null)
    or (estado = 'avisado' and avisado_at is not null and cancelado_at is null
      and motivo_cancelacion is null)
    or (estado = 'cancelado' and cancelado_at is not null
      and motivo_cancelacion is not null)
  )
);

-- Un solo recordatorio vivo por sesión.
--
-- No es una limitación técnica sino la regla del producto: "volver a contactar"
-- es una cosa sola, y dos citas sobre la misma conversación dejarían al chip
-- del Inbox eligiendo cuál mostrar. Cambiar la fecha = cancelar y programar de
-- nuevo. El índice además cierra la carrera de dos pestañas abiertas, que es lo
-- que un `if (ya hay uno)` en el service no puede cerrar.
create unique index session_recordatorios_uno_vivo_idx
  on public.session_recordatorios (lead_session_id)
  where estado in ('pendiente', 'avisado');

-- La consulta de la bandeja: qué sesiones tienen que aparecer arriba.
--
-- Barre `avisado` (el workflow ya se despertó) Y `pendiente` con la fecha
-- cumplida. Lo segundo es una red, no el mecanismo: quien avisa es el workflow
-- de Inngest. Pero si Inngest está caído, un recordatorio que no se dispara
-- desaparece en silencio, que es exactamente lo que el dueño no quiere que
-- pase. Con esto una caída atrasa el sello en la fila, no el aviso al vendedor.
create index session_recordatorios_por_avisar_idx
  on public.session_recordatorios (estado, recordar_at)
  where estado in ('pendiente', 'avisado');

comment on table public.session_recordatorios is
  'Cita de seguimiento sobre una sesión abierta ("volver a contactar en 2 días"). Se dispara hacia adentro: enciende un motivo de triage en el Inbox y NO le manda nada al cliente. Para el saliente automático está reactivation_dispatches, que es otra cosa.';
comment on column public.session_recordatorios.nota is
  'Texto libre del vendedor. Puede contener datos del cliente: prohibido loguearlo.';
comment on column public.session_recordatorios.estado is
  'pendiente | avisado | cancelado. A avisado lo escribe el workflow recordatorio-seguimiento al despertarse.';
comment on column public.session_recordatorios.motivo_cancelacion is
  'manual = lo apagó el vendedor. respondio = el cliente escribió antes y el seguimiento dejó de tener sentido.';

alter table public.session_recordatorios enable row level security;

-- RLS: las CUATRO operaciones que el panel ejecuta.
--
-- Se listan todas a propósito. En este repo ya pasó que una tabla quedara sin
-- policy de DELETE y el borrado afectara 0 filas en silencio mientras la UI
-- decía "listo" (ver 20260810200000_tags_delete_admin.sql). Acá el panel hace
-- SELECT (el Twin y la bandeja), INSERT (programar) y UPDATE (cancelar).
--
-- DELETE NO TIENE POLICY, Y ES DELIBERADO: nada borra estas filas. Cancelar es
-- un UPDATE de estado —el historial de "se programó y se apagó porque el
-- cliente volvió" es el dato que dice si esto sirve— y la limpieza la hace el
-- CASCADE de la FK, que corre con los permisos del dueño de la tabla y no pasa
-- por RLS. Si algún día alguien agrega un borrado real desde el panel, tiene
-- que agregar la policy en la misma migración.
--
-- Alcance admin + vendedor en las tres: ponerse un recordatorio sobre una
-- conversación es parte de atenderla, no administración.
create policy session_recordatorios_select on public.session_recordatorios
  for select to authenticated
  using ((select public.is_admin()) or (select public.is_vendedor()));

create policy session_recordatorios_insert on public.session_recordatorios
  for insert to authenticated
  with check ((select public.is_admin()) or (select public.is_vendedor()));

create policy session_recordatorios_update on public.session_recordatorios
  for update to authenticated
  using ((select public.is_admin()) or (select public.is_vendedor()))
  with check ((select public.is_admin()) or (select public.is_vendedor()));
