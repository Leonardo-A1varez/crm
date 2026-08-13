-- QA 2026-08-12: trazabilidad real de tiempos y handoffs administrativos.
-- Todo es aditivo; no se inventa backfill para datos que nunca se guardaron.

alter table public.mensajes
  add column platform_created_at timestamptz;

comment on column public.mensajes.platform_created_at is
  'Timestamp del mensaje entrante informado por Meta. NULL = dato histórico o payload sin timestamp válido; no sustituir por created_at.';

-- La ficha admite datos de vehículo parciales. Los sentinels históricos
-- (`''`/`0`) se normalizan antes de abrir la nulabilidad.
update public.leads set vehiculo_marca = null where btrim(vehiculo_marca) = '';
update public.leads set vehiculo_modelo = null where btrim(vehiculo_modelo) = '';
update public.leads set vehiculo_anio = null where vehiculo_anio = 0;
alter table public.leads
  alter column vehiculo_marca drop not null,
  alter column vehiculo_modelo drop not null,
  alter column vehiculo_anio drop not null;

create policy admin_actions_insert_lead_update on public.admin_actions
  for insert to authenticated
  with check (
    (select public.is_vendedor())
    and action = 'lead.update'
    and entity_type = 'lead'
    and actor_user_id = (select auth.uid())
  );

alter table public.lead_session
  add column stage_before_handoff public.current_stage_enum;

alter table public.lead_session
  add constraint lead_session_stage_before_handoff_valida
  check (stage_before_handoff is null or stage_before_handoff <> 'requiere_humano');

comment on column public.lead_session.stage_before_handoff is
  'Etapa de negocio previa al desvío requiere_humano. Se restaura al reanudar la IA.';

create table public.handoff_events (
  id uuid primary key default gen_random_uuid(),
  lead_session_id uuid not null references public.lead_session(id) on delete cascade,
  action text not null check (action in ('pause', 'resume')),
  reason_code text not null check (reason_code in (
    'unknown_intents',
    'sensitive_keyword',
    'quote_limit',
    'discount_limit',
    'rule_handoff',
    'manual_pause',
    'manual_resume',
    'other'
  )),
  source text not null check (source in (
    'auto_handoff',
    'agent_guard',
    'rule',
    'pipeline_guard',
    'admin'
  )),
  previous_stage public.current_stage_enum,
  actor_user_id uuid references public.usuarios(id) on delete set null,
  source_event_key text not null,
  created_at timestamptz not null default now(),
  constraint handoff_events_source_event_key_unique unique (source_event_key),
  constraint handoff_events_previous_stage_valida
    check (previous_stage is null or previous_stage <> 'requiere_humano')
);

create index handoff_events_session_created_idx
  on public.handoff_events (lead_session_id, created_at desc);

alter table public.handoff_events enable row level security;

create policy handoff_events_select_authed on public.handoff_events
  for select to authenticated
  using ((select public.is_admin()) or (select public.is_vendedor()));

create policy handoff_events_insert_authed on public.handoff_events
  for insert to authenticated
  with check ((select public.is_admin()) or (select public.is_vendedor()));

revoke all on table public.handoff_events from public, anon;
grant select, insert on table public.handoff_events to authenticated, service_role;

comment on table public.handoff_events is
  'Historial append-only de pausas y reanudaciones. No guarda texto del cliente ni el valor que disparó el escalado.';

-- Transición corta y atómica: bloquea una sola sesión, registra el evento y,
-- únicamente para callers service-role, deja el aviso durable en el outbox.
create function public.transition_handoff(
  p_session_id uuid,
  p_action text,
  p_reason_code text,
  p_source text,
  p_source_event_key text,
  p_notify_customer boolean default false
)
returns table (
  handoff_event_id uuid,
  lead_session_id uuid,
  action text,
  reason_code text,
  source text,
  previous_stage public.current_stage_enum,
  created_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_session public.lead_session%rowtype;
  v_event public.handoff_events%rowtype;
  v_previous public.current_stage_enum;
begin
  select * into v_session
  from public.lead_session
  where id = p_session_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'lead_session not found';
  end if;
  if v_session.resultado is not null then
    raise exception using errcode = '23514', message = 'lead_session is closed';
  end if;

  select * into v_event
  from public.handoff_events
  where source_event_key = p_source_event_key;
  if found then
    return query select
      v_event.id, v_event.lead_session_id, v_event.action,
      v_event.reason_code, v_event.source, v_event.previous_stage,
      v_event.created_at;
    return;
  end if;

  if p_action = 'pause' then
    v_previous := case
      when v_session.current_stage = 'requiere_humano' then v_session.stage_before_handoff
      else v_session.current_stage
    end;
    update public.lead_session
    set ia_pausada = true,
        stage_before_handoff = coalesce(v_session.stage_before_handoff, v_previous),
        current_stage = 'requiere_humano'
    where id = p_session_id;
  elsif p_action = 'resume' then
    v_previous := v_session.stage_before_handoff;
    update public.lead_session
    set ia_pausada = false,
        current_stage = coalesce(v_session.stage_before_handoff, 'nuevo'),
        stage_before_handoff = null
    where id = p_session_id;
  else
    raise exception using errcode = '22023', message = 'invalid handoff action';
  end if;

  insert into public.handoff_events (
    lead_session_id,
    action,
    reason_code,
    source,
    previous_stage,
    actor_user_id,
    source_event_key
  ) values (
    p_session_id,
    p_action,
    p_reason_code,
    p_source,
    v_previous,
    (select auth.uid()),
    p_source_event_key
  )
  on conflict (source_event_key) do nothing
  returning * into v_event;

  -- Dos workers pueden pasar el SELECT inicial antes de que uno confirme. El
  -- índice único decide el ganador; el perdedor devuelve ese mismo evento.
  if not found then
    select * into v_event
    from public.handoff_events
    where source_event_key = p_source_event_key;
    return query select
      v_event.id, v_event.lead_session_id, v_event.action,
      v_event.reason_code, v_event.source, v_event.previous_stage,
      v_event.created_at;
    return;
  end if;

  if p_notify_customer then
    insert into public.event_outbox (event_name, event_data, event_id)
    values (
      'lead-session/handoff.notification.requested',
      jsonb_build_object(
        'handoffEventId', v_event.id,
        'leadSessionId', p_session_id
      ),
      'handoff-notice:' || v_event.id::text
    );
  end if;

  return query select
    v_event.id, v_event.lead_session_id, v_event.action,
    v_event.reason_code, v_event.source, v_event.previous_stage,
    v_event.created_at;
end;
$$;

revoke execute on function public.transition_handoff(uuid, text, text, text, text, boolean)
  from public, anon;
grant execute on function public.transition_handoff(uuid, text, text, text, text, boolean)
  to authenticated, service_role;

comment on function public.transition_handoff(uuid, text, text, text, text, boolean) is
  'Pausa/reanuda una sesión y registra el evento en una transacción. notify=true requiere service_role porque escribe event_outbox.';

alter table public.agente_config
  add column plantilla_escalado text not null default
    'Necesito que revisemos tu caso antes de continuar. Dejé la conversación marcada para revisión administrativa y no voy a confirmar precios ni condiciones hasta que sea revisada.';

alter table public.agente_config
  add constraint agente_config_plantilla_escalado_len
  check (char_length(plantilla_escalado) between 20 and 1000);

comment on column public.agente_config.plantilla_escalado is
  'Aviso neutral enviado una vez al escalar automáticamente. Nunca incluye la causa interna.';
