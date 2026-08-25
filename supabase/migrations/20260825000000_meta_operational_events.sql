-- Eventos operativos de la plataforma de Meta: cosas que le pasan a la CUENTA,
-- no a una conversación. Que una plantilla quede rechazada, que cambie el
-- límite de mensajería del número, que la cuenta entre en revisión.
--
-- Hasta hoy `parse-webhook.ts` hacía `if (change.field !== "messages") continue`
-- y los descartaba en silencio. No rompía nada, pero significaba que si Meta
-- rechazaba una plantilla nadie se enteraba hasta que fallaba un envío.
--
-- Por qué tabla y no sólo un log: los logs de Vercel rotan en minutos. Se
-- comprobó el 2026-08-25 depurando el deploy — los logs del webhook
-- desaparecieron antes de poder leerlos. Un evento que avisa "te rechazaron
-- una plantilla" no sirve si dura menos que el tiempo en que alguien lo mira.
--
-- `docs/meta-webhook-payloads.md` ya pedía un contrato propio para esto:
-- "estos eventos deben ir a un contrato MetaOperationalEvent, no fingirse
-- como mensajes de conversación".

create table public.meta_operational_events (
  id            uuid primary key default gen_random_uuid(),
  -- El `field` del change de Meta: `message_template_status_update`,
  -- `phone_number_quality_update`, etc. Texto y no enum: Meta agrega campos
  -- nuevos sin avisar, y una migración por cada uno sería peor que un texto.
  campo         text not null,
  -- El `event` de adentro del value (`APPROVED`, `REJECTED`, `THROUGHPUT_UPGRADE`).
  -- Nullable: no todos los campos operativos traen uno.
  evento        text,
  -- Qué objeto de Meta quedó afectado: id de plantilla, número, WABA.
  -- Nullable por el mismo motivo.
  objeto_id     text,
  -- El nombre legible, cuando lo hay (nombre de la plantilla, por ejemplo).
  objeto_nombre text,
  -- El `value` completo. Es la fuente de verdad: las columnas de arriba son
  -- un índice para consultar, no un reemplazo. Meta cambia la forma de sus
  -- payloads (a `phone_number_quality_update` le sacan `current_limit` en
  -- febrero de 2026) y sin el crudo un cambio así perdería el dato.
  payload       jsonb not null,
  -- Cuándo lo disparó Meta, no cuándo lo recibimos. Nullable: `entry[].time`
  -- puede faltar o venir mal.
  ocurrido_at   timestamptz,
  created_at    timestamptz not null default now(),
  constraint meta_operational_events_campo_len check (char_length(campo) between 1 and 100),
  constraint meta_operational_events_payload_objeto check (jsonb_typeof(payload) = 'object')
);

-- Lo que se consulta es "qué pasó últimamente", y filtrado por campo cuando se
-- busca algo puntual ("¿me rechazaron alguna plantilla?").
create index meta_operational_events_recientes
  on public.meta_operational_events (created_at desc);
create index meta_operational_events_por_campo
  on public.meta_operational_events (campo, created_at desc);

comment on table public.meta_operational_events is
  'Eventos de la plataforma de Meta sobre la cuenta (plantillas, limites, revisiones), no sobre conversaciones. Los escribe el motor con service-role.';

alter table public.meta_operational_events enable row level security;

-- Lee cualquiera autenticado: es informacion operativa que un vendedor puede
-- necesitar ver ("por que no sale esta plantilla"). La escribe el motor con
-- service-role, que no pasa por RLS.
create policy meta_operational_events_select on public.meta_operational_events
  for select to authenticated
  using ((select public.is_admin()) or (select public.is_vendedor()));

revoke all on table public.meta_operational_events from public, anon;
grant select on table public.meta_operational_events to authenticated;
grant all on table public.meta_operational_events to service_role;
