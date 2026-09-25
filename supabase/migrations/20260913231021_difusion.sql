-- Difusión: mandarle un mensaje a muchos leads a la vez sin quemar el número.
-- Spec: docs/prd-workflows.md §7 · docs/prd-workflows-difusion.md §6.1, §6.3, §7.3, §7.4, §8.
--
-- Tres tablas nuevas. No se toca ninguna tabla existente: las FKs apuntan a
-- `leads`, `usuarios` y `difusiones`, y la única escritura sobre algo previo
-- ocurre en tiempo de ejecución, cuando `reactivar_supresion_difusion()` deja
-- su fila en `admin_actions`.
--
--   difusiones            qué se manda, a quién (el árbol de condiciones) y cómo.
--   difusion_envios       una fila por lead de la audiencia inicial: su tanda, o
--                         el motivo tipado por el que no salió.
--   difusion_supresiones  la lista de bajas. Irreversible por escritura automática.
--
-- Qué NO hace: no manda nada. No hay función que llame a Meta ni cron que drene
-- la cola; eso es el motor de envío y va aparte. Lo que sí hace es fijar en la
-- base las garantías que un bug del motor no puede saltarse:
--   1. Un teléfono recibe una sola vez por difusión (índice único parcial).
--   2. Un envío nace excluido o en cola, y nunca vuelve a la cola: volver a
--      `en_cola` es exactamente la forma de mandar dos veces.
--   3. Una baja no se borra ni se reactiva sola: ni el service-role, ni un
--      import, ni la API. Sólo una persona admin, con motivo, y queda auditado.

-- =========================================================================
-- Tipos
-- =========================================================================

create type public.difusion_estado as enum (
  'borrador', 'programada', 'enviando', 'en_revision', 'completada', 'detenida'
);

-- Congelada manda a los que coinciden hoy; dinámica sigue sumando a quien
-- empiece a coincidir. Es la separación "ya matchean" / "de ahora en más" (§8.2).
create type public.difusion_audiencia_modo as enum ('congelada', 'dinamica');

-- La asigna Meta al aprobar la plantilla. Decide si el envío cuenta contra el
-- cap de marketing por persona (131049): utility no cuenta.
create type public.difusion_plantilla_categoria as enum ('marketing', 'utility');

-- `aceptado` NO es `enviado`: es el 200 de la Cloud API con un wamid y nada
-- más. Meta todavía puede no entregarlo nunca (§6.6).
create type public.difusion_envio_estado as enum (
  'excluido', 'en_cola', 'aceptado', 'entregado', 'leido', 'fallido', 'cancelado'
);

-- Gratis dentro de la ventana de servicio de 24 h, o por plantilla paga fuera
-- de ella (§7.3, punto 5).
create type public.difusion_ruta as enum ('ventana_abierta', 'plantilla');

-- Un motivo por lead excluido. `baja_meta` = 131050 o `user_preferences`;
-- `saturado_meta` = 131049 reciente. El orden de precedencia lo fija el
-- planificador (`src/lib/difusion/modelo.ts`), no este enum.
create type public.difusion_motivo_exclusion as enum (
  'sin_telefono',
  'duplicado_telefono',
  'baja_propia',
  'baja_meta',
  'requiere_humano',
  'conversacion_activa',
  'sin_ventana',
  'saturado_meta',
  'cap_frecuencia',
  'en_negociacion'
);

create type public.difusion_supresion_origen as enum (
  'palabra_clave',     -- escribió BAJA, SALIR, PARAR, CANCELAR, SAIR o PARE (§6.3)
  'boton_baja',        -- tocó el botón de baja de una plantilla
  'meta_131050',       -- Meta rebotó con 131050: se dio de baja del marketing
  'meta_preferencias', -- webhook `user_preferences` de Meta
  'manual'             -- una persona la cargó a pedido del cliente
);

-- =========================================================================
-- difusiones
-- =========================================================================

create table public.difusiones (
  id                     uuid primary key default gen_random_uuid(),
  nombre                 text not null,
  estado                 public.difusion_estado not null default 'borrador',
  -- El árbol de condiciones de `src/lib/ui/condiciones.ts`, tal cual: el mismo
  -- modelo que usa el editor de workflows. La forma completa la valida
  -- `AudienciaSchema` antes de escribir; acá sólo se ata que la raíz sea un
  -- grupo con hijos, para que un JSON cualquiera no pase por audiencia.
  audiencia              jsonb not null,
  audiencia_modo         public.difusion_audiencia_modo not null default 'congelada',
  -- La plantilla con la que sale a quien no tiene la ventana de 24 h abierta.
  -- Null = sólo texto libre, sólo a quien tiene la ventana abierta.
  plantilla_nombre       text,
  plantilla_categoria    public.difusion_plantilla_categoria,
  -- Las dos exenciones que el planificador respeta. Viven en la fila y no en un
  -- parámetro de la llamada para que queden auditadas (§7.4: "la exención es
  -- explícita, por campaña, y queda en la auditoría").
  incluir_en_negociacion boolean not null default false,
  exenta_tope_frecuencia boolean not null default false,
  -- Null = sin canary. Si no, cuántos salen primero antes de frenar a revisar.
  canary_tamano          integer,
  programada_para        timestamptz,
  iniciada_at            timestamptz,
  finalizada_at          timestamptz,
  -- Null con estado `detenida` = la frenó el sistema (368, 131031, 131048).
  detenida_por           uuid references public.usuarios(id) on delete set null,
  motivo_detencion       text,
  creada_por             uuid references public.usuarios(id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint difusiones_nombre_len
    check (char_length(btrim(nombre)) between 1 and 120),
  constraint difusiones_audiencia_es_grupo
    check (
      jsonb_typeof(audiencia) = 'object'
      and audiencia ->> 'clase' = 'grupo'
      and jsonb_typeof(audiencia -> 'hijos') = 'array'
    ),
  constraint difusiones_plantilla_completa
    check ((plantilla_nombre is null) = (plantilla_categoria is null)),
  -- Cota defensiva contra un pegado accidental, no un validador del formato de Meta.
  constraint difusiones_plantilla_nombre_len
    check (plantilla_nombre is null or char_length(plantilla_nombre) between 1 and 512),
  constraint difusiones_canary_rango
    check (canary_tamano is null or canary_tamano between 1 and 10000),
  constraint difusiones_programada_con_fecha
    check (estado <> 'programada' or programada_para is not null),
  -- Mismo patrón que `workflow_runs_fin_coherente`: sin esto quedan difusiones
  -- "enviando" con fecha de fin, que rompen cualquier cálculo de duración.
  constraint difusiones_fin_coherente
    check ((estado in ('completada', 'detenida')) = (finalizada_at is not null)),
  -- "Detener dice con precisión qué pasó" (§8.5): una detención sin motivo no se puede explicar.
  constraint difusiones_detencion_con_motivo
    check ((estado = 'detenida') = (motivo_detencion is not null)),
  constraint difusiones_detenida_por_coherente
    check (detenida_por is null or estado = 'detenida'),
  constraint difusiones_motivo_detencion_len
    check (motivo_detencion is null or char_length(motivo_detencion) between 1 and 500)
);

comment on table public.difusiones is
  'Un envio masivo: audiencia (arbol de condiciones), plantilla y exenciones auditadas. No envia nada por si misma.';
comment on column public.difusiones.audiencia is
  'Arbol de condiciones de src/lib/ui/condiciones.ts (raiz = grupo). Validado por AudienciaSchema antes de escribir.';

create index difusiones_recientes on public.difusiones (created_at desc);
create index difusiones_creada_por on public.difusiones (creada_por);
create index difusiones_detenida_por on public.difusiones (detenida_por);

create trigger difusiones_bump_updated_at
  before update on public.difusiones
  for each row execute function public.bump_updated_at();

-- Una difusión que ya salió (o está programada) es el registro de a quién se le
-- mandó qué, y alimenta el filtro "campaña previa" de las audiencias. Borrarla
-- borraría en cascada sus envíos. Se detiene; no se borra.
create function public.difusiones_solo_borra_borradores()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.estado <> 'borrador' then
    raise exception 'la difusion % no es un borrador: se detiene, no se borra', old.id
      using errcode = '23514';
  end if;
  return old;
end;
$$;

create trigger difusiones_solo_borra_borradores
  before delete on public.difusiones
  for each row execute function public.difusiones_solo_borra_borradores();

-- =========================================================================
-- difusion_envios
-- =========================================================================

create table public.difusion_envios (
  id               uuid primary key default gen_random_uuid(),
  difusion_id      uuid not null references public.difusiones(id) on delete cascade,
  -- `set null` y no `cascade`: borrar un lead (fusión, baja administrativa) no
  -- puede cambiar retroactivamente las cifras de una difusión que ya salió.
  -- Al insertar es obligatorio (lo exige el trigger de abajo).
  lead_id          uuid references public.leads(id) on delete set null,
  -- Sólo dígitos E.164, sin `+`: la clave de la deduplicación y el número al
  -- que efectivamente se mandó. Null sólo si el lead no tenía uno de WhatsApp.
  telefono         text,
  estado           public.difusion_envio_estado not null,
  motivo_exclusion public.difusion_motivo_exclusion,
  ruta             public.difusion_ruta,
  -- Día del reparto contado desde que se planificó: 0 = hoy.
  tanda            integer,
  programado_para  timestamptz,
  meta_message_id  text,
  error_codigo     text,
  error_detalle    text,
  created_at       timestamptz not null default now(),
  -- Cuándo entró al estado actual. Lo mueve sólo un cambio de estado: el
  -- `set null` de un lead borrado no puede "refrescar" la fecha de un 131049 y
  -- estirar la saturación de esa persona.
  estado_at        timestamptz not null default now(),
  constraint difusion_envios_excluido_con_motivo
    check ((estado = 'excluido') = (motivo_exclusion is not null)),
  constraint difusion_envios_plan_completo
    check (
      estado = 'excluido'
      or (telefono is not null and ruta is not null and tanda is not null and programado_para is not null)
    ),
  constraint difusion_envios_sin_telefono_coherente
    check ((telefono is null) = (motivo_exclusion is not null and motivo_exclusion = 'sin_telefono')),
  -- E.164: el código de país nunca empieza con 0 y el total no pasa de 15 dígitos.
  constraint difusion_envios_telefono_e164
    check (telefono is null or telefono ~ '^[1-9][0-9]{6,14}$'),
  constraint difusion_envios_tanda_no_negativa
    check (tanda is null or tanda >= 0),
  constraint difusion_envios_tanda_con_fecha
    check ((tanda is null) = (programado_para is null)),
  -- Lo que llegó a Meta tiene wamid; sin él no hay cómo reconciliar el webhook.
  constraint difusion_envios_salido_con_wamid
    check (estado not in ('aceptado', 'entregado', 'leido') or meta_message_id is not null),
  -- Un fallido sin código no se puede agrupar "por motivo" ni decidir si se reintenta.
  constraint difusion_envios_fallido_con_codigo
    check (estado <> 'fallido' or error_codigo is not null),
  constraint difusion_envios_error_codigo_len
    check (error_codigo is null or char_length(error_codigo) between 1 and 40),
  constraint difusion_envios_error_detalle_len
    check (error_detalle is null or char_length(error_detalle) <= 1000),
  constraint difusion_envios_wamid_len
    check (meta_message_id is null or char_length(meta_message_id) between 1 and 200),
  constraint difusion_envios_un_lead_por_difusion unique (difusion_id, lead_id)
);

comment on table public.difusion_envios is
  'Una fila por lead de la audiencia inicial de una difusion: su tanda y estado de entrega, o el motivo tipado de exclusion.';

-- Una persona recibe UNA vez por difusión aunque tenga dos leads (§7.4). El
-- planificador ya deduplica; esto hace que un bug del motor no pueda deshacerlo.
create unique index difusion_envios_un_mensaje_por_telefono
  on public.difusion_envios (difusion_id, telefono)
  where estado <> 'excluido';

-- El webhook de estados de Meta llega por wamid.
create unique index difusion_envios_wamid
  on public.difusion_envios (meta_message_id)
  where meta_message_id is not null;

-- Progreso en vivo y próxima tanda a drenar.
create index difusion_envios_por_estado on public.difusion_envios (difusion_id, estado);
create index difusion_envios_lead on public.difusion_envios (lead_id);
-- "¿Este teléfono rebotó con 131049 hace poco?" — la saturación del planificador.
create index difusion_envios_fallidos_por_telefono
  on public.difusion_envios (telefono, estado_at desc)
  where estado = 'fallido';

-- Las transiciones legales de un envío. La misma tabla vive en TypeScript
-- (`transicionEnvioPermitida`, `src/lib/difusion/modelo.ts`) y
-- `tests/unit/difusion/modelo-vs-migracion.test.ts` falla si se separan.
--
--   en_cola   → aceptado | fallido | cancelado | excluido (re-evaluado al salir, §8.6)
--   cancelado → aceptado | fallido  (estaba en vuelo al detener: manda la verdad de Meta)
--   aceptado  → entregado | leido | fallido
--   entregado → leido
--
-- Nada vuelve a `en_cola`. Y nada nace ya enviado.
create function public.difusion_envios_transicion()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.estado not in ('excluido', 'en_cola') then
      raise exception 'un envio nace excluido o en cola, nunca como %', new.estado
        using errcode = '23514';
    end if;
    if new.lead_id is null then
      raise exception 'un envio se planifica para un lead: lead_id es obligatorio al insertar'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if new.difusion_id <> old.difusion_id or new.telefono is distinct from old.telefono then
    raise exception 'la difusion y el telefono de un envio no se cambian: seria mandarle a otra persona'
      using errcode = '23514';
  end if;

  if new.estado is distinct from old.estado then
    if not (
         (old.estado = 'en_cola'   and new.estado in ('aceptado', 'fallido', 'cancelado', 'excluido'))
      or (old.estado = 'cancelado' and new.estado in ('aceptado', 'fallido'))
      or (old.estado = 'aceptado'  and new.estado in ('entregado', 'leido', 'fallido'))
      or (old.estado = 'entregado' and new.estado = 'leido')
    ) then
      raise exception 'transicion de envio no permitida: % -> %', old.estado, new.estado
        using errcode = '23514';
    end if;
    new.estado_at := now();
  end if;

  return new;
end;
$$;

create trigger difusion_envios_transicion
  before insert or update on public.difusion_envios
  for each row execute function public.difusion_envios_transicion();

-- Conteo por estado y motivo para el progreso en vivo y el cierre. PostgREST no
-- agrupa sin una función; traer las filas para contarlas en la app sería
-- transferir la audiencia entera por cada refresco.
create function public.difusion_envios_conteo(p_difusion_id uuid)
returns table (
  estado public.difusion_envio_estado,
  motivo_exclusion public.difusion_motivo_exclusion,
  cantidad bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select e.estado, e.motivo_exclusion, count(*)::bigint
    from public.difusion_envios e
   where e.difusion_id = p_difusion_id
   group by e.estado, e.motivo_exclusion;
$$;

-- =========================================================================
-- difusion_supresiones
-- =========================================================================

create table public.difusion_supresiones (
  id                  uuid primary key default gen_random_uuid(),
  -- Por teléfono y no por lead: la baja es de la persona. Un import de CSV que
  -- crea un lead nuevo con el mismo número tiene que chocar contra esta fila, y
  -- borrar el lead no la levanta. Es el dato mínimo para poder respetar la baja;
  -- que sobreviva a un pedido de supresión de datos del lead es una decisión que
  -- tiene que confirmar el dueño (ver docs/data-retention.md §3).
  telefono            text not null,
  origen              public.difusion_supresion_origen not null,
  -- Qué la disparó, sin datos personales: la palabra ("BAJA"), el código de
  -- Meta, el texto del botón.
  detalle             text,
  lead_id             uuid references public.leads(id) on delete set null,
  difusion_id         uuid references public.difusiones(id) on delete set null,
  registrada_por      uuid references public.usuarios(id) on delete set null,
  created_at          timestamptz not null default now(),
  reactivada_at       timestamptz,
  reactivada_por      uuid references public.usuarios(id) on delete set null,
  reactivacion_motivo text,
  constraint difusion_supresiones_telefono_e164
    check (telefono ~ '^[1-9][0-9]{6,14}$'),
  constraint difusion_supresiones_detalle_len
    check (detalle is null or char_length(detalle) <= 200),
  constraint difusion_supresiones_reactivacion_completa
    check ((reactivada_at is null) = (reactivacion_motivo is null)),
  constraint difusion_supresiones_reactivada_por_sin_fecha
    check (reactivada_por is null or reactivada_at is not null),
  constraint difusion_supresiones_motivo_len
    check (reactivacion_motivo is null or char_length(btrim(reactivacion_motivo)) between 10 and 500)
);

comment on table public.difusion_supresiones is
  'Bajas de difusion por telefono. Irreversible por escritura automatica: solo reactivar_supresion_difusion() la levanta, con persona admin y motivo.';

-- Una baja activa por teléfono. Re-darse de baja después de una reactivación
-- es una fila nueva: la historia no se pisa.
create unique index difusion_supresiones_activa_por_telefono
  on public.difusion_supresiones (telefono)
  where reactivada_at is null;

create index difusion_supresiones_historial on public.difusion_supresiones (created_at desc);
create index difusion_supresiones_lead on public.difusion_supresiones (lead_id);
create index difusion_supresiones_difusion on public.difusion_supresiones (difusion_id);
create index difusion_supresiones_registrada_por on public.difusion_supresiones (registrada_por);
create index difusion_supresiones_reactivada_por on public.difusion_supresiones (reactivada_por);

-- La garantía de §6.3, en la base y no en la app: los triggers corren también
-- para el service-role, que es justamente quien hace las escrituras automáticas
-- (imports, el motor, la API). RLS no alcanza porque el service-role lo saltea.
create function public.difusion_supresiones_irreversible()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op in ('DELETE', 'TRUNCATE') then
    raise exception 'una baja no se borra: se reactiva con reactivar_supresion_difusion(), que exige una persona admin y deja auditoria'
      using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    if new.reactivada_at is not null or new.reactivada_por is not null or new.reactivacion_motivo is not null then
      raise exception 'una baja nace activa: la reactivacion es un paso aparte y auditado'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.telefono <> old.telefono
     or new.origen <> old.origen
     or new.created_at <> old.created_at
     or new.detalle is distinct from old.detalle then
    raise exception 'la identidad de una baja (telefono, origen, fecha, detalle) no se edita'
      using errcode = '42501';
  end if;

  if old.reactivada_at is not null then
    if new.reactivada_at is distinct from old.reactivada_at
       or new.reactivacion_motivo is distinct from old.reactivacion_motivo
       or (new.reactivada_por is distinct from old.reactivada_por and new.reactivada_por is not null) then
      raise exception 'una reactivacion registrada no se edita ni se deshace: una baja nueva es otra fila'
        using errcode = '42501';
    end if;
  elsif new.reactivada_at is not null
        and coalesce(current_setting('crm.reactivacion_supresion', true), '') <> 'on' then
    raise exception 'una baja solo se reactiva con reactivar_supresion_difusion(): ni un import ni la API la reactivan'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger difusion_supresiones_irreversible
  before insert or update or delete on public.difusion_supresiones
  for each row execute function public.difusion_supresiones_irreversible();

create trigger difusion_supresiones_sin_truncate
  before truncate on public.difusion_supresiones
  for each statement execute function public.difusion_supresiones_irreversible();

-- La única puerta para levantar una baja. SECURITY INVOKER: corre con los
-- permisos y el RLS de quien llama, así que además de los chequeos de acá
-- adentro vale la policy de UPDATE (sólo admin).
--
-- Orden de los chequeos: motivo, existencia, persona. El service-role no tiene
-- `auth.uid()`, así que ningún proceso automático pasa del tercero.
create function public.reactivar_supresion_difusion(p_supresion_id uuid, p_motivo text)
returns public.difusion_supresiones
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor      uuid := auth.uid();
  v_motivo     text := btrim(coalesce(p_motivo, ''));
  v_fila       public.difusion_supresiones;
  v_encontrada boolean;
begin
  if char_length(v_motivo) not between 10 and 500 then
    raise exception 'el motivo de la reactivacion es obligatorio: entre 10 y 500 caracteres'
      using errcode = '23514';
  end if;

  perform 1 from public.difusion_supresiones where id = p_supresion_id and reactivada_at is null;
  if not found then
    raise exception 'no hay una baja activa con id %', p_supresion_id
      using errcode = 'P0002';
  end if;

  if v_actor is null or not coalesce(public.is_admin(), false) then
    raise exception 'reactivar una baja exige una persona con rol admin'
      using errcode = '42501';
  end if;

  perform set_config('crm.reactivacion_supresion', 'on', true);
  update public.difusion_supresiones
     set reactivada_at = now(),
         reactivada_por = v_actor,
         reactivacion_motivo = v_motivo
   where id = p_supresion_id
     and reactivada_at is null
  returning * into v_fila;
  v_encontrada := found;
  perform set_config('crm.reactivacion_supresion', '', true);

  if not v_encontrada then
    raise exception 'no hay una baja activa con id %', p_supresion_id
      using errcode = 'P0002';
  end if;

  -- Sin el teléfono: la auditoría registra quién, cuándo y por qué, no a quién.
  insert into public.admin_actions (actor_user_id, action, entity_type, entity_id, payload)
  values (
    v_actor,
    'difusion.supresion_reactivada',
    'difusion_supresion',
    v_fila.id,
    jsonb_build_object('origen', v_fila.origen, 'motivo', v_motivo)
  );

  return v_fila;
end;
$$;

-- =========================================================================
-- RLS y permisos
-- =========================================================================
-- Admin RW. Vendedor lee todo (necesita ver que un lead se dio de baja o de qué
-- campaña viene una respuesta) y puede cargar una baja manual: registrar una baja
-- es la dirección segura, y es lo que corresponde cuando el cliente la pide por
-- teléfono. Las escrituras del motor van con service-role.

alter table public.difusiones enable row level security;
alter table public.difusion_envios enable row level security;
alter table public.difusion_supresiones enable row level security;

create policy difusiones_select on public.difusiones
  for select to authenticated
  using ((select public.is_admin()) or (select public.is_vendedor()));
create policy difusiones_insert_admin on public.difusiones
  for insert to authenticated
  with check ((select public.is_admin()));
create policy difusiones_update_admin on public.difusiones
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
create policy difusiones_delete_admin on public.difusiones
  for delete to authenticated
  using ((select public.is_admin()));

create policy difusion_envios_select on public.difusion_envios
  for select to authenticated
  using ((select public.is_admin()) or (select public.is_vendedor()));
create policy difusion_envios_insert_admin on public.difusion_envios
  for insert to authenticated
  with check ((select public.is_admin()));
create policy difusion_envios_update_admin on public.difusion_envios
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
-- Sin policy de DELETE: a quién le llegó qué no se borra a mano.

create policy difusion_supresiones_select on public.difusion_supresiones
  for select to authenticated
  using ((select public.is_admin()) or (select public.is_vendedor()));
create policy difusion_supresiones_insert_manual on public.difusion_supresiones
  for insert to authenticated
  with check (
    ((select public.is_admin()) or (select public.is_vendedor()))
    and origen = 'manual'
    and registrada_por = (select auth.uid())
  );
-- La usa `reactivar_supresion_difusion()`, que es SECURITY INVOKER. El trigger
-- decide qué columnas se pueden tocar; esta policy decide quién.
create policy difusion_supresiones_update_admin on public.difusion_supresiones
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
-- Sin policy de DELETE, y el trigger lo impide también para el service-role.

-- Los privilegios por defecto del schema (20260816042039) dan ALL a anon y
-- authenticated sobre toda tabla nueva. Se recortan explícitamente.
revoke all on table public.difusiones from public, anon, authenticated;
grant select, insert, update, delete on table public.difusiones to authenticated;
grant all on table public.difusiones to service_role;

revoke all on table public.difusion_envios from public, anon, authenticated;
grant select, insert, update on table public.difusion_envios to authenticated;
grant all on table public.difusion_envios to service_role;

-- Ni el service-role borra ni trunca bajas.
revoke all on table public.difusion_supresiones from public, anon, authenticated, service_role;
grant select, insert, update on table public.difusion_supresiones to authenticated, service_role;

revoke all on function public.difusion_envios_conteo(uuid) from public, anon;
grant execute on function public.difusion_envios_conteo(uuid) to authenticated, service_role;

revoke all on function public.reactivar_supresion_difusion(uuid, text) from public, anon;
grant execute on function public.reactivar_supresion_difusion(uuid, text) to authenticated, service_role;

-- Funciones de trigger: nadie las llama por RPC.
revoke all on function public.difusiones_solo_borra_borradores() from public, anon, authenticated;
revoke all on function public.difusion_envios_transicion() from public, anon, authenticated;
revoke all on function public.difusion_supresiones_irreversible() from public, anon, authenticated;
