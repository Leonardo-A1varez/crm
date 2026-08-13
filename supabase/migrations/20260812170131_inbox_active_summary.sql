-- Read path acotado para el poller del Inbox.
--
-- El panel solo necesita la cola de cada sesión para derivar preview y mensajes
-- sin responder. Traer todo el historial cada cinco segundos crece sin límite.
-- SECURITY INVOKER conserva las policies RLS del caller y devuelve como máximo
-- p_limit filas por sesión solicitada.
create function public.inbox_recent_messages(
  p_session_ids uuid[],
  p_limit integer default 50
)
returns table (
  conversacion_id uuid,
  lead_session_id uuid,
  direction public.direction_enum,
  sender public.sender_enum,
  contenido text,
  created_at timestamptz
)
language sql
security invoker
set search_path = ''
stable
as $$
  select
    recent.conversacion_id,
    recent.lead_session_id,
    recent.direction,
    recent.sender,
    recent.contenido,
    recent.created_at
  from unnest(p_session_ids) as requested(id)
  cross join lateral (
    select m.*
    from public.mensajes as m
    where m.lead_session_id = requested.id
    order by m.created_at desc
    limit greatest(1, least(p_limit, 200))
  ) as recent
  order by recent.created_at asc;
$$;

comment on function public.inbox_recent_messages(uuid[], integer) is
  'Inbox poller: bounded trailing messages per session; security invoker preserves RLS.';

-- El LATERAL hace un top-N por sesión. El índice histórico solo tenía
-- lead_session_id sin orden y obligaba a ordenar cada hilo completo.
create index mensajes_session_created_idx
  on public.mensajes (lead_session_id, created_at desc);

-- Mantiene la postura de la Data API: public/anon no reciben execute implícito.
-- El panel usa un cliente authenticated y la función conserva las policies RLS
-- de `mensajes`; service_role queda explícito para los workflows del servidor.
revoke execute on function public.inbox_recent_messages(uuid[], integer) from public, anon;
grant execute on function public.inbox_recent_messages(uuid[], integer) to authenticated, service_role;
