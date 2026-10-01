-- Copiloto del Inbox (spec docs/superpowers/specs/2026-09-30-copiloto-inbox-design.md).
--
-- Tres piezas, todas aditivas y reaplicables (`if not exists`, `drop policy if
-- exists`, `create or replace`): no se reescribe ninguna fila ni ninguna
-- política existente.
--
--   1. `agente_config.horario_equipo`: cuándo hay personas para enviar desde
--      WhatsApp Web. Default = los 7 días vacíos = "nunca hay equipo", así que
--      desplegar esto no cambia el comportamiento hasta que alguien lo
--      configure (§3.2). `agente_config` es append-only y versionada: solo se
--      agrega una columna con default; toda versión previa lee "sin equipo".
--   2. `conversaciones.modo_respuesta_override`: la preferencia por
--      conversación (null = "Según horario").
--   3. `borradores_ia` + RPC `iniciar_borrador_ia`: el borrador vigente de cada
--      conversación y su arranque atómico.

-- =========================================================================
-- 1. Horario del equipo
-- =========================================================================

alter table public.agente_config
  add column if not exists horario_equipo jsonb not null
    default '{"lun":[],"mar":[],"mie":[],"jue":[],"vie":[],"sab":[],"dom":[]}'::jsonb;

-- Los 7 días son obligatorios: un `{}` fallaría al leer la fila con
-- `HorarioSchema`, y un día ausente sería un cierre silencioso. Con el CHECK el
-- error aparece al escribir y no en el pipeline. `jsonb_exists_all` es la forma
-- de función del operador `?&` (se evita el `?` en un archivo que pasan por
-- distintos clientes SQL).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'agente_config_horario_equipo_dias'
  ) then
    alter table public.agente_config
      add constraint agente_config_horario_equipo_dias
      check (
        jsonb_typeof(horario_equipo) = 'object'
        and jsonb_exists_all(horario_equipo, array['lun','mar','mie','jue','vie','sab','dom'])
      );
  end if;
end
$$;

comment on column public.agente_config.horario_equipo is
  'Cuándo hay personas del equipo para enviar desde WhatsApp Web (copiloto). Mismo formato y misma zona (horario_timezone) que horario. Sin ningún rango = nunca hay equipo.';

-- =========================================================================
-- 2. Preferencia de modo por conversación
-- =========================================================================

alter table public.conversaciones
  add column if not exists modo_respuesta_override text
    check (modo_respuesta_override in ('copiloto', 'automatico'));

comment on column public.conversaciones.modo_respuesta_override is
  'Preferencia del equipo para esta conversación: copiloto | automatico. null = "Según horario".';

-- `conversaciones_update` (20260714124024) ya deja actualizar a admin y vendedor
-- sin restringir columnas: el interruptor del encabezado no necesita policy nueva.

-- =========================================================================
-- 3. borradores_ia
-- =========================================================================
--
-- Un borrador por respuesta que la IA redactó en modo Copiloto. Se escribe con
-- service-role desde el pipeline y desde la función de Regenerar (sin policy de
-- INSERT: nadie más puede fabricar borradores). El panel solo lee y marca
-- "usado".
--
-- El texto del borrador (`contenido`) puede traer datos del cliente: nunca se
-- loguea, y se va con la sesión (CASCADE) cuando la purga de 29 días la borra.

create table if not exists public.borradores_ia (
  id                uuid primary key default gen_random_uuid(),
  conversacion_id   uuid not null references public.conversaciones(id) on delete cascade,
  lead_session_id   uuid not null references public.lead_session(id) on delete cascade,
  -- El entrante que lo disparó.
  mensaje_origen_id uuid not null references public.mensajes(id) on delete cascade,
  estado            text not null
    check (estado in ('redactando', 'listo', 'usado', 'error', 'descartado')),
  contenido         text,
  origen            text check (origen in ('ia', 'regla')),
  regla_id          uuid references public.reglas(id) on delete set null,
  -- Código corto (`llm_error`, `tope_diario`…), nunca el texto del proveedor.
  error_codigo      text check (error_codigo is null or error_codigo ~ '^[a-z_]{1,40}$'),
  usado_at          timestamptz,
  usado_via         text check (usado_via in ('insertar', 'copiar', 'abrir_web', 'al_composer')),
  usado_por         uuid references public.usuarios(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint borradores_ia_listo_con_texto
    check (estado <> 'listo' or (contenido is not null and origen is not null)),
  constraint borradores_ia_error_con_codigo
    check (estado <> 'error' or error_codigo is not null),
  constraint borradores_ia_usado_con_via
    check (estado <> 'usado' or (usado_via is not null and usado_at is not null))
);

comment on table public.borradores_ia is
  'Respuesta que la IA redactó en modo Copiloto para que una persona la envíe desde WhatsApp Web. Uno vigente por conversación (redactando|listo|error); usado y descartado quedan de historial.';

-- Un vigente por conversación. "Usado" y "descartado" no compiten por el índice.
create unique index if not exists borradores_ia_vigente_uq
  on public.borradores_ia (conversacion_id)
  where estado in ('redactando', 'listo', 'error');

-- Las FK con cascade/set null necesitan índice: sin ellos el borrado en cascada
-- recorre la tabla (mismo criterio que turnos_interceptados).
create index if not exists borradores_ia_sesion_idx on public.borradores_ia (lead_session_id);
create index if not exists borradores_ia_mensaje_origen_idx
  on public.borradores_ia (mensaje_origen_id);
create index if not exists borradores_ia_regla_idx on public.borradores_ia (regla_id);
create index if not exists borradores_ia_usado_por_idx on public.borradores_ia (usado_por);

alter table public.borradores_ia enable row level security;

drop policy if exists borradores_ia_select on public.borradores_ia;
create policy borradores_ia_select on public.borradores_ia
  for select to authenticated
  using ((select public.is_admin()) or (select public.is_vendedor()));

-- El panel solo puede pasar un borrador `listo` a `usado`. Filtrar por estado en
-- el USING hace que un segundo "usar" afecte 0 filas (sin error) y que el
-- guardado del saliente "sin confirmar" (§3.4) no se repita.
drop policy if exists borradores_ia_update_uso on public.borradores_ia;
create policy borradores_ia_update_uso on public.borradores_ia
  for update to authenticated
  using (((select public.is_admin()) or (select public.is_vendedor())) and estado = 'listo')
  with check (
    ((select public.is_admin()) or (select public.is_vendedor()))
    and estado = 'usado'
    -- Quien marca el uso es quien queda registrado: no se puede atribuir a otro.
    and usado_por = (select auth.uid())
  );

-- Permisos de tabla: los default privileges (20260816042039) otorgan todo; acá
-- se recorta a lo que el panel necesita. service_role conserva todo.
revoke all on public.borradores_ia from anon;
-- `revoke all` y no solo insert/update/delete: TRUNCATE no pasa por RLS.
revoke all on public.borradores_ia from authenticated;
grant select on public.borradores_ia to authenticated;
grant update (estado, usado_at, usado_via, usado_por, updated_at)
  on public.borradores_ia to authenticated;

-- =========================================================================
-- 4. RPC: arrancar un borrador de forma atómica
-- =========================================================================
--
-- Lo llama el pipeline (primer intento de un turno) y la función de Regenerar
-- (`p_forzar = true`). Con un lock a la fila de la conversación:
--
--   * 'obsoleto': `p_mensaje_origen_id` ya no es el último entrante de la
--     conversación. El más viejo nunca pisa al nuevo.
--   * 'existente': ya hay un borrador para ese entrante (idempotencia por
--     mensaje_origen_id, R6). Vale también si ya fue usado. Con `p_forzar` se
--     ignora y se crea otro (Regenerar / Reintentar).
--   * 'creado': descartó los vigentes de la conversación y creó uno `redactando`.
--
-- `for no key update` y no `for update`: no choca con el `for key share` que
-- toma cualquier INSERT de `mensajes` (FK a conversaciones), así que no frena la
-- llegada de mensajes mientras se decide.
create or replace function public.iniciar_borrador_ia(
  p_conversacion_id   uuid,
  p_lead_session_id   uuid,
  p_mensaje_origen_id uuid,
  p_forzar            boolean default false
)
returns table (out_id uuid, out_resultado text, out_estado text)
language plpgsql
set search_path = public
as $$
declare
  v_ultimo uuid;
  v_id     uuid;
  v_estado text;
begin
  perform 1 from public.conversaciones c where c.id = p_conversacion_id for no key update;
  if not found then
    raise exception 'conversacion no encontrada: %', p_conversacion_id using errcode = 'P0002';
  end if;

  select m.id into v_ultimo
    from public.mensajes m
   where m.conversacion_id = p_conversacion_id and m.direction = 'in'
   order by m.created_at desc, m.id desc
   limit 1;

  if v_ultimo is distinct from p_mensaje_origen_id then
    return query select null::uuid, 'obsoleto'::text, null::text;
    return;
  end if;

  select b.id, b.estado into v_id, v_estado
    from public.borradores_ia b
   where b.mensaje_origen_id = p_mensaje_origen_id
     and b.estado in ('redactando', 'listo', 'error', 'usado')
   order by b.created_at desc
   limit 1;

  if found and not p_forzar then
    return query select v_id, 'existente'::text, v_estado;
    return;
  end if;

  update public.borradores_ia b
     set estado = 'descartado', updated_at = now()
   where b.conversacion_id = p_conversacion_id
     and b.estado in ('redactando', 'listo', 'error');

  insert into public.borradores_ia (conversacion_id, lead_session_id, mensaje_origen_id, estado)
  values (p_conversacion_id, p_lead_session_id, p_mensaje_origen_id, 'redactando')
  returning id into v_id;

  return query select v_id, 'creado'::text, 'redactando'::text;
end
$$;

-- Solo service_role: el panel no arranca borradores.
revoke execute on function public.iniciar_borrador_ia(uuid, uuid, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.iniciar_borrador_ia(uuid, uuid, uuid, boolean)
  to service_role;
