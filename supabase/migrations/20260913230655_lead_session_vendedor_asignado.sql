-- Vendedor asignado por sesión.
--
-- El catálogo de workflows ofrecía "Asignar vendedor" y "Round Robin" sin
-- ningún lugar donde guardar el resultado: los nodos validaban y no hacían
-- nada. Decisión del dueño: la asignación vive en la sesión, no en el lead.
-- Cada intento de venta (`lead_session`) tiene su vendedor; si el lead vuelve
-- meses después, el round robin lo reparte de nuevo.
--
-- Aditiva: dos columnas nulables, un CHECK, un trigger que rellena, un índice
-- parcial y una RPC de lectura. Ninguna fila existente cambia (todas quedan
-- sin asignar) y RLS queda como estaba: la asignación es ruteo, no permisos.

alter table public.lead_session
  add column vendedor_asignado_id uuid references public.usuarios (id) on delete set null,
  add column asignado_at timestamptz;

-- Con vendedor hay fecha, y sin vendedor no. El round robin ordena por
-- `asignado_at`: un vendedor sin fecha rompería el "hace más tiempo que no
-- recibe" sin que nada falle.
alter table public.lead_session
  add constraint lead_session_asignacion_con_fecha
  check ((vendedor_asignado_id is null) = (asignado_at is null));

-- `asignado_at` lo escribe la base y nadie más: es la hora del último cambio
-- de vendedor. Trigger y no un valor que manda el repo, por dos motivos:
--   1. `on delete set null` es un UPDATE que hace Postgres, no la app. Sin el
--      trigger, borrar un usuario dejaría `asignado_at` con valor y el CHECK
--      de arriba haría fallar el DELETE.
--   2. Es el reloj que ordena el reparto entre procesos distintos: la hora de
--      la base no se desfasa entre instancias, y un UPDATE que no cambia el
--      vendedor no la puede correr (se conserva la anterior).
-- Mismo idioma que `bump_updated_at`: rellena una columna, no bloquea nada.
create or replace function public.lead_session_sellar_asignacion()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if tg_op = 'UPDATE'
     and new.vendedor_asignado_id is not distinct from old.vendedor_asignado_id then
    new.asignado_at := old.asignado_at;
  elsif new.vendedor_asignado_id is null then
    new.asignado_at := null;
  else
    new.asignado_at := now();
  end if;
  return new;
end;
$function$;

create trigger lead_session_sellar_asignacion
  before insert or update on public.lead_session
  for each row execute function public.lead_session_sellar_asignacion();

-- Buscar por vendedor: el resumen del round robin, las sesiones de una persona
-- y el `set null` de la FK cuando se borra un usuario. Parcial porque las
-- sesiones sin vendedor nunca se buscan por vendedor.
create index lead_session_vendedor_asignado_idx
  on public.lead_session (vendedor_asignado_id, asignado_at desc)
  where vendedor_asignado_id is not null;

-- El historial del round robin, agregado en la base: una fila por vendedor
-- pedido que tenga sesiones asignadas. Traer las filas y agregar en TypeScript
-- se rompería en silencio al pasar las 1.000 sesiones asignadas, que es donde
-- PostgREST corta.
create or replace function public.resumen_asignaciones_vendedores(p_vendedor_ids uuid[])
returns table (
  vendedor_id uuid,
  ultima_asignacion_at timestamptz,
  sesiones_abiertas integer
)
language sql
stable
security invoker
set search_path = ''
as $function$
  select
    s.vendedor_asignado_id,
    max(s.asignado_at),
    (count(*) filter (where s.resultado is null))::integer
  from public.lead_session as s
  where s.vendedor_asignado_id = any (p_vendedor_ids)
  group by s.vendedor_asignado_id
$function$;

revoke all on function public.resumen_asignaciones_vendedores(uuid[]) from public;
revoke all on function public.resumen_asignaciones_vendedores(uuid[]) from anon;
grant execute on function public.resumen_asignaciones_vendedores(uuid[]) to authenticated;
grant execute on function public.resumen_asignaciones_vendedores(uuid[]) to service_role;

comment on column public.lead_session.vendedor_asignado_id is
  'Vendedor que atiende este intento de venta. NULL = sin asignar. on delete set null: si el usuario se borra, la sesion queda sin asignar y no se borra. Se escribe solo con LeadSessionRepository.asignarVendedor.';
comment on column public.lead_session.asignado_at is
  'Hora de la base del ultimo cambio de vendedor; NULL sin vendedor. La sella el trigger lead_session_sellar_asignacion: el valor que mande un INSERT o un UPDATE se ignora.';
comment on function public.resumen_asignaciones_vendedores(uuid[]) is
  'Historial del round robin: por cada vendedor pedido con sesiones asignadas, su asignacion mas reciente y cuantas siguen abiertas. security invoker: respeta el RLS del caller.';
