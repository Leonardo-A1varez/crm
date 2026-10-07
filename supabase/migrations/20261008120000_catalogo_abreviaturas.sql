-- Abreviaturas del inventario: del `AMORTIG DELT` del ERP a «amortiguadores delanteros».
--
-- OBSERVACION
--
-- «Necesito los amortiguadores delanteros para el Kia niro 2020» (crm-dev,
-- 2026-10-07 19:12 UTC) devolvio dos filas basura (`290 AMORTIGUADORES DEL CH
-- TAOHE 2011`, grupo `REPUESTO EMG`, sin existencia) y el agente las cotizo con el
-- encabezado «Repuesto emg Niro 2020». Los amortiguadores que si estan (codigos
-- 23868 y 23869, grupo `AMORTIG DELT`, Kia Niro 2017-) no aparecieron.
--
-- CAUSA RAIZ
--
-- 1. El texto de la consulta solo admitia filas cuyo `busqueda` contenia una palabra
--    del cliente como subcadena. El inventario escribe `AMORTIG` y `DELT`: ni
--    «amortiguadores» ni «delanteros» estan dentro.
-- 2. El Niro no estaba en `catalogo_modelos`, asi que el vehiculo no resolvia.
-- 3. Las filas sin existencia se cotizaron con precio.
--
-- FIX (esta migracion y la siguiente)
--
-- Esta tabla es el puente: una fila por abreviatura, con su expansion en palabras del
-- cliente. La carga `scripts/catalogo/cargar-abreviaturas.mjs` a partir de
-- docs/catalogo/abreviaturas-sugeridas.csv, que el dueno revisa. NO se siembra nada
-- aca: una abreviatura inventada es peor que ninguna.
--
-- QUE ENTRA A LA BUSQUEDA
--
-- Igual que `catalogo_modelos` (decision del dueno, 2026-10-05): las que el dueno
-- confirmo y las sugerencias con confianza `alta`. Las `media` y `baja` se guardan
-- con `activo = false` y la busqueda las ignora.
--
-- COLUMNAS
--
--   abrev       el token tal cual lo escribe el inventario (`AMORTIG`, `DELT`, `LH`).
--               Para `ruido` es el nombre completo del grupo (`REPUESTO EMG`).
--   expansion   la palabra del cliente (`amortiguador`, `delantero`). Puede traer una
--               aclaracion entre parentesis (`posterior (trasero)`): la busqueda usa
--               lo que va antes del parentesis (`catalogo_cabeza`).
--   tipo        pieza: dice QUE pieza es · posicion: delantero/posterior/izquierdo/
--               derecho (es un FILTRO, no una palabra obligatoria) · atributo: otro
--               calificador que tampoco obliga · ruido: grupo basura del ERP.
--   ambito      donde aparece: la categoria (el grupo del ERP), el nombre o ambos.
--
-- La clave es (abrev, tipo) y no solo `abrev`: el CSV del dueno trae `DEL` dos veces
-- (una posicion en el nombre y la preposicion «del» como ruido en la categoria), y son
-- dos cosas distintas.

-- =========================================================================
-- Funciones puras que usa la busqueda
-- =========================================================================

-- La raiz de una palabra: sin tildes, sin plural y sin la vocal final, para que
-- «amortiguadores» y «amortiguador», o «delanteros» y «delantera», sean la misma.
-- Espeja `raizDe` en src/lib/catalogo/abreviaturas.ts.
create or replace function public.catalogo_raiz(t text)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select case when length(s.v) >= 5 and s.v ~ '[aeo]$' then left(s.v, length(s.v) - 1) else s.v end
  from (
    select case
      when length(p.v) > 4 and p.v ~ '[rldnz]es$' then left(p.v, length(p.v) - 2)
      when length(p.v) > 3 and p.v ~ 's$' then left(p.v, length(p.v) - 1)
      else p.v
    end as v
    from (select public.plegar_texto(btrim(t)) as v) as p
  ) as s
$$;

comment on function public.catalogo_raiz(text) is
  'Raiz de una palabra (sin tildes, plural ni vocal final). Espeja raizDe de src/lib/catalogo/abreviaturas.ts.';

-- La cabeza de una expansion: lo que va antes del primer parentesis o punto y coma
-- («posterior (trasero)» -> «posterior»). Espeja `cabezaDeExpansion`.
create or replace function public.catalogo_cabeza(t text)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select btrim(split_part(split_part(t, '(', 1), ';', 1))
$$;

comment on function public.catalogo_cabeza(text) is
  'Cabeza de una expansion de abreviatura (antes del parentesis o del punto y coma). Espeja cabezaDeExpansion.';

-- Que lado dice una palabra de posicion; NULL si no dice ninguno. «trasero» y
-- «posterior» son lo mismo. Espeja `ladoDe`.
create or replace function public.catalogo_lado(t text)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select case public.catalogo_raiz(t)
    when 'delanter' then 'delantero'
    when 'anterior' then 'delantero'
    when 'frontal' then 'delantero'
    when 'posterior' then 'posterior'
    when 'traser' then 'posterior'
    when 'izquierd' then 'izquierdo'
    when 'derech' then 'derecho'
    when 'superior' then 'superior'
    when 'inferior' then 'inferior'
    when 'exterior' then 'exterior'
    when 'interior' then 'interior'
  end
$$;

comment on function public.catalogo_lado(text) is
  'Lado que dice una palabra de posicion (delantero, posterior, izquierdo, derecho) o NULL. Espeja ladoDe de src/lib/catalogo/abreviaturas.ts.';

-- Como se lleva un producto con los lados que pidio el cliente. Espeja
-- `nivelDeLado`: 2 tiene el lado pedido · 1 no dice lado (no sabemos) · 0 dice el
-- contrario (pidio delanteros y es POST). Sin lados pedidos, 1.
-- Delante/atras, izquierda/derecha, arriba/abajo y afuera/adentro son familias distintas.
create or replace function public.catalogo_nivel_lado(p_tiene text[], p_pedidos text[])
returns integer
language sql
immutable
parallel safe
set search_path = ''
as $$
  with fam(m) as (
    values
      ('{delantero,posterior}'::text[]),
      ('{izquierdo,derecho}'::text[]),
      ('{superior,inferior}'::text[]),
      ('{exterior,interior}'::text[])
  ),
  pedidas as (
    -- Por cada familia pedida: ¿el producto tiene alguno de los lados pedidos?
    -- ¿dice algun lado de esa familia?
    select
      coalesce(p_tiene, '{}') && array(select x from unnest(p_pedidos) as x where x = any (f.m))
        as acierta,
      coalesce(p_tiene, '{}') && f.m as dice
    from fam as f
    where p_pedidos && f.m
  )
  select case
    when coalesce(cardinality(p_pedidos), 0) = 0 then 1
    when exists (select 1 from pedidas where not acierta and dice) then 0
    when not exists (select 1 from pedidas where not acierta) then 2
    else 1
  end
$$;

comment on function public.catalogo_nivel_lado(text[], text[]) is
  'Nivel de un producto frente a los lados pedidos: 2 lo tiene, 1 no dice lado, 0 dice el contrario. Espeja nivelDeLado.';

create table public.catalogo_abreviaturas (
  abrev text not null check (btrim(abrev) <> '' and length(abrev) <= 100),
  expansion text not null check (btrim(expansion) <> '' and length(expansion) <= 200),
  tipo text not null check (tipo in ('pieza', 'posicion', 'atributo', 'ruido')),
  ambito text not null check (ambito in ('categoria', 'nombre', 'ambos')),
  confianza text not null check (confianza in ('alta', 'media', 'baja')),
  confirmado boolean not null default false,
  activo boolean generated always as (confirmado or confianza = 'alta') stored,
  -- Lo que la busqueda necesita de cada fila, calculado UNA vez al escribir y no en cada
  -- consulta (las funciones SQL con `set search_path` no se inlinean y cada llamada
  -- cuesta): el token tal cual lo escribe el inventario (`amortig`; para el ruido, el
  -- nombre del grupo con espacios), la raiz de la cabeza de la expansion si es UNA
  -- palabra, y el lado que dice (solo las posiciones).
  clave text generated always as (
    btrim(regexp_replace(public.plegar_texto(abrev), '[^0-9a-z]+', ' ', 'g'))
  ) stored,
  exp_raiz text generated always as (
    case
      when btrim(regexp_replace(public.plegar_texto(public.catalogo_cabeza(expansion)), '[^0-9a-z]+', ' ', 'g')) <> ''
        and btrim(regexp_replace(public.plegar_texto(public.catalogo_cabeza(expansion)), '[^0-9a-z]+', ' ', 'g')) !~ ' '
      then public.catalogo_raiz(
        btrim(regexp_replace(public.plegar_texto(public.catalogo_cabeza(expansion)), '[^0-9a-z]+', ' ', 'g'))
      )
    end
  ) stored,
  lado text generated always as (
    case when tipo = 'posicion' then public.catalogo_lado(public.catalogo_cabeza(expansion)) end
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (abrev, tipo)
);

comment on table public.catalogo_abreviaturas is
  'Abreviaturas del inventario (AMORTIG, DELT, LH) y su expansion en palabras del cliente. La busqueda de repuestos usa las filas activas (confirmadas por el dueno o con confianza alta).';

create trigger catalogo_abreviaturas_bump_updated_at
  before update on public.catalogo_abreviaturas
  for each row execute function public.bump_updated_at();

alter table public.catalogo_abreviaturas enable row level security;

-- Lectura para quien usa el panel; escritura solo del admin. `(select ...)` para que
-- el planner cachee el predicado (mismo criterio que catalogo_modelos).
create policy catalogo_abreviaturas_select on public.catalogo_abreviaturas
  for select to authenticated
  using ((select public.is_admin()) or (select public.is_vendedor()));
create policy catalogo_abreviaturas_insert_admin on public.catalogo_abreviaturas
  for insert to authenticated
  with check ((select public.is_admin()));
create policy catalogo_abreviaturas_update_admin on public.catalogo_abreviaturas
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
create policy catalogo_abreviaturas_delete_admin on public.catalogo_abreviaturas
  for delete to authenticated
  using ((select public.is_admin()));

-- `revoke all` y no solo insert/update/delete: TRUNCATE no pasa por RLS.
-- service_role conserva todo.
revoke all on public.catalogo_abreviaturas from anon;
revoke all on public.catalogo_abreviaturas from authenticated;
grant select, insert, update, delete on public.catalogo_abreviaturas to authenticated;

-- =========================================================================
-- Grupos del ERP que no son repuestos
-- =========================================================================
--
-- Un solo lugar para los grupos (`productos.categoria`) que el agente nunca busca ni
-- cotiza; el dueno puede agregar mas con un INSERT. Aplica a `buscar_productos`; la
-- pantalla de Productos los sigue listando.
--
--   inactivar   true: ademas la carga del ERP (`erp_sync_cargar`) deja esos items
--               `activo = false` en cada recarga (el grupo se elimina). false: siguen
--               activos en la base pero la busqueda del agente los ignora.
--
-- Decisiones (2026-10-08): REPUESTO EMG se elimina por completo (el dueno). GASTOS
-- VARIOS, OTROS, OTROS INGRESOS y ACTIVOS FIJOS no son repuestos de vehiculo (gastos,
-- ingresos y activos de la empresa): la busqueda los ignora.
create table public.catalogo_grupos_excluidos (
  grupo text primary key check (btrim(grupo) <> '' and length(grupo) <= 100),
  -- Plegado, para comparar sin mayusculas ni tildes con `productos.categoria`.
  clave text generated always as (public.plegar_texto(btrim(grupo))) stored,
  inactivar boolean not null default false,
  motivo text,
  created_at timestamptz not null default now()
);

create unique index catalogo_grupos_excluidos_clave_uidx on public.catalogo_grupos_excluidos (clave);

comment on table public.catalogo_grupos_excluidos is
  'Grupos del ERP (productos.categoria) que no son repuestos: buscar_productos los ignora y, con inactivar = true, la carga del ERP los deja inactivos.';

insert into public.catalogo_grupos_excluidos (grupo, inactivar, motivo) values
  ('REPUESTO EMG', true, 'El dueno decidio eliminar el grupo completo (2026-10-08).'),
  ('GASTOS VARIOS', false, 'Gastos de la empresa, no es un repuesto.'),
  ('OTROS', false, 'Mezcla de articulos y servicios que no son repuestos de vehiculo.'),
  ('OTROS INGRESOS', false, 'Ingresos distintos de ventas, no es un repuesto.'),
  ('ACTIVOS FIJOS', false, 'Activos fijos de la empresa, no es un repuesto.');

alter table public.catalogo_grupos_excluidos enable row level security;

create policy catalogo_grupos_excluidos_select on public.catalogo_grupos_excluidos
  for select to authenticated
  using ((select public.is_admin()) or (select public.is_vendedor()));
create policy catalogo_grupos_excluidos_insert_admin on public.catalogo_grupos_excluidos
  for insert to authenticated
  with check ((select public.is_admin()));
create policy catalogo_grupos_excluidos_update_admin on public.catalogo_grupos_excluidos
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
create policy catalogo_grupos_excluidos_delete_admin on public.catalogo_grupos_excluidos
  for delete to authenticated
  using ((select public.is_admin()));

revoke all on public.catalogo_grupos_excluidos from anon;
revoke all on public.catalogo_grupos_excluidos from authenticated;
grant select, insert, update, delete on public.catalogo_grupos_excluidos to authenticated;
