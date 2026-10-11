-- Números de WhatsApp conectados desde Ajustes con el registro insertado de
-- Meta (Embedded Signup v4), en modo coexistencia: el número sigue andando en
-- la app WhatsApp Business del teléfono y además recibe la Cloud API.
-- Diseño y fuentes: docs/meta/conectar-whatsapp.md.
--
-- Aditiva: dos tablas nuevas, una función nueva y una columna nullable en
-- `conversaciones`. No cambia ninguna política ni columna existente. El número
-- configurado por env (`META_WHATSAPP_PHONE_NUMBER_ID`) sigue siendo el
-- fallback: sin filas acá, todo sale por él como antes.

-- =========================================================================
-- whatsapp_numeros: lo que se muestra del número, sin el token
-- =========================================================================

create table public.whatsapp_numeros (
  id                          uuid primary key default gen_random_uuid(),
  waba_id                     text not null,
  phone_number_id             text not null,
  display_phone_number        text,
  verified_name               text,
  modo                        text not null,
  -- conectado: hay token y se usa para mandar. error: la conexión quedó a
  -- medias (ver `error`). desconectado: el CRM ya no manda por este número.
  estado                      text not null default 'conectado',
  -- Texto para el admin; nunca el token ni el cuerpo de un mensaje.
  error                       text,
  conectado_por               uuid references public.usuarios(id) on delete set null,
  conectado_at                timestamptz not null default now(),
  -- Verificación de coexistencia (`GET /{phone}?fields=is_on_biz_app,platform_type`).
  is_on_biz_app               boolean,
  platform_type               text,
  verificado_at               timestamptz,
  -- Sincronización de contactos (`smb_app_data`, sync_type smb_app_state_sync).
  -- Meta la acepta UNA sola vez y dentro de las 24 h de la conexión:
  -- `contactos_pedido_at` es la reserva que se toma antes de llamar, para que
  -- un reintento no la pida dos veces; `contactos_sincronizados_at`, el momento
  -- en que Meta la aceptó.
  contactos_pedido_at         timestamptz,
  contactos_sincronizados_at  timestamptz,
  contactos_request_id        text,
  -- Historial de 180 días (`smb_app_data`, sync_type history). Mismo contrato.
  historial_pedido_at         timestamptz,
  historial_request_id        text,
  historial_estado            text not null default 'pendiente',
  historial_progreso          smallint,
  updated_at                  timestamptz not null default now(),
  constraint whatsapp_numeros_phone_unico unique (phone_number_id),
  constraint whatsapp_numeros_phone_forma check (phone_number_id ~ '^[0-9]{1,30}$'),
  constraint whatsapp_numeros_waba_forma check (waba_id ~ '^[0-9]{1,30}$'),
  constraint whatsapp_numeros_modo check (modo in ('coexistencia', 'cloud')),
  constraint whatsapp_numeros_estado check (estado in ('conectado', 'error', 'desconectado')),
  constraint whatsapp_numeros_historial_estado check (
    historial_estado in ('pendiente', 'pedido', 'en_curso', 'completo', 'rechazado', 'vencido', 'error')
  ),
  constraint whatsapp_numeros_historial_progreso check (
    historial_progreso is null or historial_progreso between 0 and 100
  ),
  constraint whatsapp_numeros_error_largo check (error is null or char_length(error) <= 500)
);

comment on table public.whatsapp_numeros is
  'Numeros de WhatsApp conectados con el registro insertado de Meta. El token vive cifrado en whatsapp_numeros_credenciales.';

create index whatsapp_numeros_conectado_por on public.whatsapp_numeros (conectado_por);

alter table public.whatsapp_numeros enable row level security;

-- Solo el admin lo ve en el panel. Nadie del panel escribe directo: conectar
-- pasa por `whatsapp_numero_conectar` y el resto lo escribe el backend
-- (service role, Inngest).
create policy whatsapp_numeros_select_admin on public.whatsapp_numeros
  for select to authenticated
  using ((select public.is_admin()));

revoke all on table public.whatsapp_numeros from public, anon, authenticated;
grant select on table public.whatsapp_numeros to authenticated;
grant all on table public.whatsapp_numeros to service_role;

-- =========================================================================
-- whatsapp_numeros_credenciales: el token, cifrado, sólo para el backend
-- =========================================================================
--
-- Tabla aparte y no una columna de `whatsapp_numeros`: con la columna al lado,
-- cualquier `select *` del admin la traería, y la RLS no filtra columnas. Acá
-- no hay grant ni policy para `authenticated` ni `anon`: ni el admin lo lee por
-- REST. Lo escribe la función de conexión (security definer) y lo lee el
-- backend con service role.
--
-- El token va cifrado en la app con AES-256-GCM (`src/lib/meta/token-cifrado.ts`,
-- clave `META_TOKENS_CLAVE`, fuera de la base): un dump o un backup de la base
-- no alcanza para mandar mensajes en nombre del negocio. Formato
-- `v1.<kid>.<iv>.<tag>.<cifrado>`, todo en base64url.

create table public.whatsapp_numeros_credenciales (
  phone_number_id text primary key
                  references public.whatsapp_numeros(phone_number_id) on delete cascade,
  token_cifrado   text not null,
  actualizado_at  timestamptz not null default now(),
  constraint whatsapp_numeros_credenciales_forma check (
    token_cifrado ~ '^v1\.[0-9a-f]{8}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'
  )
);

comment on table public.whatsapp_numeros_credenciales is
  'Token de negocio de cada numero conectado, cifrado en la app (AES-256-GCM). Solo service role.';

alter table public.whatsapp_numeros_credenciales enable row level security;

revoke all on table public.whatsapp_numeros_credenciales from public, anon, authenticated;
grant all on table public.whatsapp_numeros_credenciales to service_role;

-- =========================================================================
-- Conectar: la única escritura del panel
-- =========================================================================
--
-- Security definer porque el admin tiene que poder dejar el token sin poder
-- leerlo nunca. Exige admin adentro: `is_admin()` lee el rol del JWT del que
-- llama, no el del dueño de la función. El token llega ya cifrado.
--
-- Reconectar el mismo número (Meta lo permite tras un offboarding) arranca de
-- cero la sincronización: es una conexión nueva con su propia ventana de 24 h.

create function public.whatsapp_numero_conectar(
  p_waba_id              text,
  p_phone_number_id      text,
  p_display_phone_number text,
  p_verified_name        text,
  p_modo                 text,
  p_token_cifrado        text
)
returns table (id uuid, conectado_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not (select public.is_admin()) then
    raise exception 'solo un administrador puede conectar un numero'
      using errcode = '42501';
  end if;

  return query
  insert into public.whatsapp_numeros as n (
    waba_id, phone_number_id, display_phone_number, verified_name, modo,
    estado, error, conectado_por, conectado_at
  )
  values (
    p_waba_id, p_phone_number_id,
    nullif(btrim(p_display_phone_number), ''), nullif(btrim(p_verified_name), ''), p_modo,
    'conectado', null, (select auth.uid()), now()
  )
  on conflict (phone_number_id) do update set
    waba_id                    = excluded.waba_id,
    display_phone_number       = excluded.display_phone_number,
    verified_name              = excluded.verified_name,
    modo                       = excluded.modo,
    estado                     = 'conectado',
    error                      = null,
    conectado_por              = excluded.conectado_por,
    conectado_at               = excluded.conectado_at,
    is_on_biz_app              = null,
    platform_type              = null,
    verificado_at              = null,
    contactos_pedido_at        = null,
    contactos_sincronizados_at = null,
    contactos_request_id       = null,
    historial_pedido_at        = null,
    historial_request_id       = null,
    historial_estado           = 'pendiente',
    historial_progreso         = null,
    updated_at                 = now()
  returning n.id, n.conectado_at;

  insert into public.whatsapp_numeros_credenciales (phone_number_id, token_cifrado, actualizado_at)
  values (p_phone_number_id, p_token_cifrado, now())
  on conflict (phone_number_id) do update set
    token_cifrado  = excluded.token_cifrado,
    actualizado_at = now();
end;
$$;

comment on function public.whatsapp_numero_conectar(text, text, text, text, text, text) is
  'Alta o reconexion de un numero de WhatsApp con su token ya cifrado. Solo admin.';

revoke all on function public.whatsapp_numero_conectar(text, text, text, text, text, text)
  from public, anon;
grant execute on function public.whatsapp_numero_conectar(text, text, text, text, text, text)
  to authenticated, service_role;

-- =========================================================================
-- conversaciones: por qué número de negocio vive el hilo
-- =========================================================================
--
-- Con más de un número, la respuesta tiene que salir por el número al que
-- escribió el cliente: si sale por otro, al cliente le llega desde un
-- WhatsApp distinto. Se anota con el `metadata.phone_number_id` del último
-- entrante. `null` = el número de env, como hasta ahora.

alter table public.conversaciones
  add column whatsapp_phone_number_id text,
  add constraint conversaciones_whatsapp_phone_forma check (
    whatsapp_phone_number_id is null or whatsapp_phone_number_id ~ '^[0-9]{1,30}$'
  );

comment on column public.conversaciones.whatsapp_phone_number_id is
  'phone_number_id del numero de negocio por el que escribio el cliente (null = numero de env).';

-- `conversaciones` tiene grant de UPDATE de tabla para `authenticated` (lo usa
-- el panel para `modo_respuesta_override`), y un REVOKE por columna no le gana
-- a un grant de tabla. Sin esto, cualquiera del panel podría cambiar por qué
-- número sale la respuesta de un hilo. La columna la escribe sólo el pipeline
-- (service role).
create function public.conversaciones_numero_solo_backend()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon')
     and new.whatsapp_phone_number_id is distinct from
         (case when tg_op = 'UPDATE' then old.whatsapp_phone_number_id else null end) then
    raise exception 'whatsapp_phone_number_id lo escribe solo el backend'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.conversaciones_numero_solo_backend() from public, anon, authenticated;

create trigger conversaciones_numero_solo_backend
  before insert or update of whatsapp_phone_number_id on public.conversaciones
  for each row execute function public.conversaciones_numero_solo_backend();
