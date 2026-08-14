-- Los datos que identifican a una persona dejan de ser una columna sola.
--
-- Antes, fusionar dos leads con teléfonos distintos descartaba uno: el modelo
-- no tenía dónde poner el segundo. Pero un lead fusionado es una persona con
-- dos teléfonos, no una persona cuyo segundo teléfono es basura.
--
-- La misma tabla resuelve la detección de duplicados. El detector buscaba por
-- nombre exacto + canales distintos + ventana de 7 días, que es débil por un
-- lado (hay cientos de "Carlos Gómez") y demasiado estricto por el otro (dos
-- leads del mismo canal, o de hace 8 días, nunca se proponían). Compartir un
-- RUC, un VIN, una placa o un teléfono es evidencia real de ser la misma
-- persona; compartir el nombre no.
--
-- NO hay UNIQUE global sobre (tipo, valor) a propósito: que dos leads tengan
-- el mismo valor es justamente lo que hay que poder detectar. `leads.telefono`
-- conserva su UNIQUE y sigue siendo la identidad canónica de WhatsApp que usa
-- el pipeline; esta tabla es aditiva.

create type public.identificador_tipo_enum as enum (
  'telefono',
  'email',
  'ruc',
  'placa',
  'vin'
);

create table public.lead_identificadores (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  tipo public.identificador_tipo_enum not null,
  -- Normalizado para comparar: sin espacios, guiones ni mayúsculas. Es la
  -- columna contra la que se buscan coincidencias.
  valor text not null,
  -- Como lo escribió la persona o como llegó de Meta. Es lo que se muestra:
  -- "+54 9 11 5555-0002" se lee mejor que "5491155550002".
  valor_original text,
  -- El que va en la ficha cuando hay varios del mismo tipo. No es UNIQUE por
  -- lead+tipo: un lead recién fusionado puede tener dos marcados hasta que
  -- alguien elija, y bloquear la fusión por eso sería peor.
  principal boolean not null default false,
  -- De dónde salió: 'meta' (identidad del canal), 'manual' (lo cargó alguien),
  -- 'extractor' (lo dijo el cliente en la conversación), 'merge' (venía del
  -- lead absorbido). Sirve para saber a cuál creerle si dos se contradicen.
  origen text not null default 'manual',
  created_at timestamptz not null default now(),

  constraint lead_identificadores_valor_no_vacio check (btrim(valor) <> '')
);

-- Un lead no repite el mismo valor del mismo tipo. Sí puede tener dos
-- teléfonos distintos, que es el punto de toda la tabla.
create unique index lead_identificadores_lead_tipo_valor_idx
  on public.lead_identificadores (lead_id, tipo, valor);

-- El índice de la detección: dado un valor, quiénes más lo tienen.
create index lead_identificadores_tipo_valor_idx
  on public.lead_identificadores (tipo, valor);

create index lead_identificadores_lead_idx
  on public.lead_identificadores (lead_id);

comment on table public.lead_identificadores is
  'Datos que identifican a un lead (telefono, email, ruc, placa, vin). Varios por lead: fusionar acumula en vez de descartar. Sin UNIQUE global sobre (tipo, valor) porque el valor compartido es la señal que usa el detector de duplicados.';

alter table public.lead_identificadores enable row level security;

-- Mismas reglas que `leads` y `lead_tags`: admin o vendedor, nunca "cualquier
-- autenticado". Un `using (true)` acá dejaría leer los teléfonos y correos de
-- todos los leads a un usuario sin rol asignado.
create policy "lead_identificadores_select"
  on public.lead_identificadores for select
  to authenticated
  using ((select public.is_admin()) or (select public.is_vendedor()));

create policy "lead_identificadores_insert"
  on public.lead_identificadores for insert
  to authenticated
  with check ((select public.is_admin()) or (select public.is_vendedor()));

create policy "lead_identificadores_update"
  on public.lead_identificadores for update
  to authenticated
  using ((select public.is_admin()) or (select public.is_vendedor()))
  with check ((select public.is_admin()) or (select public.is_vendedor()));

create policy "lead_identificadores_delete"
  on public.lead_identificadores for delete
  to authenticated
  using ((select public.is_admin()) or (select public.is_vendedor()));

-- =========================================================================
-- Backfill de lo que ya está en `leads`
-- =========================================================================

-- Los teléfonos de relleno de IG/FB (`ig:12345`) NO entran: no identifican a
-- nadie, y dos leads de Instagram sin teléfono real matchearían entre sí por
-- un valor que solo dice "no sabemos el número".
insert into public.lead_identificadores (lead_id, tipo, valor, valor_original, principal, origen)
select
  l.id,
  'telefono'::public.identificador_tipo_enum,
  regexp_replace(l.telefono, '[^0-9+]', '', 'g'),
  l.telefono,
  true,
  'meta'
from public.leads as l
where l.telefono is not null
  and btrim(l.telefono) <> ''
  and l.telefono !~ '^(wa|ig|fb):'
  and regexp_replace(l.telefono, '[^0-9+]', '', 'g') <> ''
on conflict (lead_id, tipo, valor) do nothing;

insert into public.lead_identificadores (lead_id, tipo, valor, valor_original, principal, origen)
select
  l.id,
  'email'::public.identificador_tipo_enum,
  lower(btrim(l.email)),
  l.email,
  true,
  'manual'
from public.leads as l
where l.email is not null
  and btrim(l.email) <> ''
on conflict (lead_id, tipo, valor) do nothing;
