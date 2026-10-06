-- Diccionario de modelos del catalogo: de la sigla del inventario al nombre real.
--
-- OBSERVACION
--
-- El inventario escribe el vehiculo con siglas de la casa: `HY ACC 06- 1.4`,
-- `HY STA FE 2.2`, `CH GRAN VIT`. El cliente dice "Accent", "Santa Fe",
-- "Grand Vitara". `buscar_productos` filtra por marca/modelo/anio contra
-- `productos.compatibilidad`, y ahi el modelo va a quedar guardado con la sigla
-- (`ACC`). Sin un puente entre las dos, el filtro compara "accent" contra "acc"
-- y descarta justo lo que el cliente pidio.
--
-- Esta tabla es ese puente. La carga `scripts/catalogo/cargar-modelos.mjs` a
-- partir de docs/catalogo/diccionario-modelos-sugerido.csv, que el dueno revisa.
--
-- QUE ENTRA A LA BUSQUEDA
--
-- Decision del dueno (2026-10-05): la busqueda usa los modelos que el dueno
-- confirmo y las sugerencias con confianza `alta`. Las de confianza `media` y
-- `baja` esperan su confirmacion: se guardan, pero `activo` es false y
-- `resolver_modelos` (migracion siguiente) las ignora. Que un modelo "dudoso"
-- no se resuelva no oculta productos: la busqueda cae al texto plano.
--
-- `nombre_clave` es el nombre real sin la marca y sin tildes ("accent",
-- "tucson 1a gen (jm)"). Es lo que el cliente escribe cuando ya dio la marca por
-- separado. Se genera para que nadie lo mantenga a mano ni se desincronice.

create table public.catalogo_modelos (
  id uuid primary key default gen_random_uuid(),
  -- Marca con nombre completo ("Hyundai"), la misma que va en
  -- `compatibilidad[].marca`.
  marca text not null check (btrim(marca) <> ''),
  -- La sigla tal cual aparece en el inventario ("ACC", "STA FE").
  sigla_modelo text not null check (btrim(sigla_modelo) <> ''),
  -- El nombre con el que lo conoce el cliente ("Hyundai Accent").
  nombre_real text not null check (btrim(nombre_real) <> ''),
  -- Otras formas de nombrarlo ("santafe", "tucson ix35").
  alias text[] not null default '{}',
  confianza text not null check (confianza in ('alta', 'media', 'baja')),
  confirmado boolean not null default false,
  -- Si la busqueda lo usa: lo confirmo el dueno o es una sugerencia con
  -- confianza alta.
  activo boolean generated always as (confirmado or confianza = 'alta') stored,
  nombre_clave text generated always as (
    case
      when left(public.plegar_texto(nombre_real), length(marca) + 1)
           = public.plegar_texto(marca) || ' '
        then substr(public.plegar_texto(nombre_real), length(marca) + 2)
      else public.plegar_texto(nombre_real)
    end
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint catalogo_modelos_marca_sigla_uq unique (marca, sigla_modelo)
);

comment on table public.catalogo_modelos is
  'Diccionario sigla del inventario -> nombre real del modelo. La busqueda de repuestos usa las filas activas (confirmadas por el dueno o con confianza alta).';
comment on column public.catalogo_modelos.nombre_clave is
  'nombre_real plegado y sin el prefijo de la marca. Generada.';

create index catalogo_modelos_nombre_real_idx
  on public.catalogo_modelos (public.plegar_texto(nombre_real));
create index catalogo_modelos_nombre_clave_idx on public.catalogo_modelos (nombre_clave);
create index catalogo_modelos_alias_idx on public.catalogo_modelos using gin (alias);

create trigger catalogo_modelos_bump_updated_at
  before update on public.catalogo_modelos
  for each row execute function public.bump_updated_at();

alter table public.catalogo_modelos enable row level security;

-- Lectura para quien usa el panel; escritura solo del admin. `(select ...)`
-- para que el planner cachee el predicado (mismo criterio que slice3).
create policy catalogo_modelos_select on public.catalogo_modelos
  for select to authenticated
  using ((select public.is_admin()) or (select public.is_vendedor()));
create policy catalogo_modelos_insert_admin on public.catalogo_modelos
  for insert to authenticated
  with check ((select public.is_admin()));
create policy catalogo_modelos_update_admin on public.catalogo_modelos
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
create policy catalogo_modelos_delete_admin on public.catalogo_modelos
  for delete to authenticated
  using ((select public.is_admin()));

-- Los default privileges otorgan todo; se recorta. `revoke all` y no solo
-- insert/update/delete: TRUNCATE no pasa por RLS. service_role conserva todo.
revoke all on public.catalogo_modelos from anon;
revoke all on public.catalogo_modelos from authenticated;
grant select, insert, update, delete on public.catalogo_modelos to authenticated;
