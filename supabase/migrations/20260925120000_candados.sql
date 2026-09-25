-- Candados con vencimiento, para serializar trabajo entre instancias.
--
-- El primer uso es el reparto round robin de los workflows: el servicio lee el
-- historial de asignaciones, elige y escribe, y dos repartos a la vez leían lo
-- mismo y le daban las dos sesiones a la misma persona.
--
-- Por qué una fila y no `pg_advisory_lock`: cada llamada de PostgREST es su
-- propia transacción en una conexión del pool. Un advisory de sesión quedaría
-- tomado en una conexión que otro request reusa; uno de transacción se suelta
-- al terminar el RPC, antes de que corra la sección crítica en TypeScript. Una
-- fila con `vence_at` sobrevive a los dos problemas y a un proceso que muere
-- con el candado en la mano: vence sola.
--
-- Aditiva: una tabla nueva y dos funciones. Nada existente cambia.

create table public.candados (
  clave     text primary key,
  duenio    uuid not null,
  vence_at  timestamptz not null
);

-- Sólo el service role (el motor de workflows) la toca. RLS prendido y sin
-- policies: authenticated y anon no ven ni escriben nada.
alter table public.candados enable row level security;

comment on table public.candados is
  'Candados con vencimiento entre instancias (LeaseLock, src/server/lock/lease-lock.ts). Una fila por clave tomada; vence_at pasado = libre. Solo service_role.';

-- Toma el candado si está libre o si el anterior venció. La decisión la toma
-- un solo INSERT … ON CONFLICT: dos llamadas simultáneas por la misma clave se
-- serializan en el índice único y la segunda ve la fila de la primera.
--
-- `clock_timestamp()` y no `now()`: `now()` es la hora de inicio de la
-- transacción, y el vencimiento se compara contra la hora real.
create or replace function public.tomar_candado(
  p_clave text,
  p_duenio uuid,
  p_ttl_ms integer
)
returns boolean
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_tomado boolean;
begin
  if p_ttl_ms is null or p_ttl_ms <= 0 then
    raise exception 'tomar_candado: el vencimiento tiene que ser positivo, llegó %', p_ttl_ms
      using errcode = '22023';
  end if;

  insert into public.candados as c (clave, duenio, vence_at)
  values (p_clave, p_duenio, clock_timestamp() + make_interval(secs => p_ttl_ms / 1000.0))
  on conflict (clave) do update
    set duenio = excluded.duenio,
        vence_at = excluded.vence_at
    where c.vence_at <= clock_timestamp()
  returning true into v_tomado;

  return coalesce(v_tomado, false);
end;
$function$;

-- Suelta el candado sólo si sigue siendo de quien lo pide: si venció y otro lo
-- tomó, soltarlo le sacaría el candado al nuevo dueño.
create or replace function public.soltar_candado(p_clave text, p_duenio uuid)
returns void
language sql
volatile
security invoker
set search_path = ''
as $function$
  delete from public.candados where clave = p_clave and duenio = p_duenio;
$function$;

revoke all on table public.candados from public, anon, authenticated;
grant select, insert, update, delete on table public.candados to service_role;

revoke all on function public.tomar_candado(text, uuid, integer) from public, anon, authenticated;
revoke all on function public.soltar_candado(text, uuid) from public, anon, authenticated;
grant execute on function public.tomar_candado(text, uuid, integer) to service_role;
grant execute on function public.soltar_candado(text, uuid) to service_role;

comment on function public.tomar_candado(text, uuid, integer) is
  'Toma el candado p_clave para p_duenio por p_ttl_ms si esta libre o vencido. true = tomado.';
comment on function public.soltar_candado(text, uuid) is
  'Suelta el candado p_clave si sigue siendo de p_duenio. Idempotente.';
