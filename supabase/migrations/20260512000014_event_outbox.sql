-- 20260512000014_event_outbox.sql
-- Transactional outbox pattern (B2 Pre-Slice 1 Industrial Hardening).
-- Garantiza at-least-once delivery de eventos Inngest aunque dispatcher falle entre
-- DB write y emit. Cron worker dispatch-outbox-events.cron poll pending → emit → mark sent.

create table public.event_outbox (
  id            uuid primary key default gen_random_uuid(),
  event_name    text not null,
  event_data    jsonb not null default '{}'::jsonb,
  event_id      text,
  status        text not null default 'pending'
                check (status in ('pending', 'sent', 'failed')),
  attempts      integer not null default 0,
  last_error    text,
  scheduled_at  timestamptz not null default now(),
  sent_at       timestamptz,
  created_at    timestamptz not null default now()
);

create index event_outbox_pending_idx
  on public.event_outbox (status, scheduled_at)
  where status = 'pending';

create index event_outbox_sent_at_idx
  on public.event_outbox (sent_at)
  where sent_at is not null;

create index event_outbox_event_name_idx on public.event_outbox (event_name);

comment on table public.event_outbox is 'Transactional outbox pattern. Eventos persistidos en DB antes de emit Inngest. Cron worker dispatch-outbox-events (*/1 * * * *) poll pending -> emit -> mark sent. Service EventBusService.publish optimistic direct dispatch + outbox fallback. At-least-once delivery garantizada incluso si Inngest down al momento del write.';

comment on column public.event_outbox.event_id is
  'Optional idempotency key. Si presente, Inngest dedupe events con mismo id.';

comment on column public.event_outbox.attempts is
  'Counter incremental por cada retry fallido. UI/alerts pueden flag attempts > N.';

alter table public.event_outbox enable row level security;
