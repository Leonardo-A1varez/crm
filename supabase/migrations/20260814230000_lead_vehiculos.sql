-- El vehículo deja de ser cuatro columnas del lead.
--
-- Un taller tiene UN documento fiscal y TRES camionetas. Con `vehiculo_marca`,
-- `vehiculo_modelo`, `vehiculo_anio` y `vehiculo_motor` en `leads` entra un solo
-- auto por lead: el segundo pisa al primero. Y la placa y el VIN —lo único que
-- identifica a un auto sin ambigüedad— no tenían dónde ir.
--
-- La separación es el punto de toda la tabla:
--
--   * teléfono, correo y documento fiscal identifican a la PERSONA y viven en
--     `lead_identificadores`;
--   * placa, VIN, marca, modelo, año y motor identifican al AUTO y viven acá.
--
-- El RUC del taller no pertenece a ninguna de sus tres camionetas, y la placa de
-- la camioneta no pertenece al taller. `lead_identificadores` tiene hoy los
-- tipos `placa` y `vin` en su enum: fueron un error de ubicación y quedan sin
-- uso (ver migración 20260814240000).
--
-- Igual que `lead_identificadores`, NO hay UNIQUE global sobre placa ni VIN a
-- propósito: que dos leads compartan una placa es exactamente la señal que busca
-- el detector de duplicados. Prohibirlo haría imposible detectar lo que se
-- quiere detectar.

create table public.lead_vehiculos (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,

  marca text,
  modelo text,
  anio integer,
  motor text,

  -- Normalizada para comparar: alfanuméricos en mayúscula, la misma regla que
  -- `normalizarIdentificador` en `src/lib/identificadores.ts`. "AB-123-CD" y
  -- "AB123CD" tienen que caer en la misma cadena o el duplicado no se detecta.
  placa text,
  -- Como la escribió la persona. Es lo que se muestra: "AB-123-CD" se lee mejor
  -- que "AB123CD". Mismo par `valor` / `valor_original` de `lead_identificadores`.
  placa_original text,

  vin text,
  vin_original text,

  -- El que va en la ficha cuando el lead tiene varios autos, y el que espejan
  -- las cuatro columnas de `leads`. No es UNIQUE por lead: un lead recién
  -- fusionado puede tener dos marcados hasta que alguien elija, y bloquear la
  -- fusión por eso sería peor.
  principal boolean not null default false,
  created_at timestamptz not null default now(),

  constraint lead_vehiculos_placa_no_vacia check (placa is null or btrim(placa) <> ''),
  constraint lead_vehiculos_vin_no_vacio check (vin is null or btrim(vin) <> ''),

  -- ISO 3779: 17 alfanuméricos. Es el único dato del auto con largo fijo en todo
  -- el mundo, y por eso el único que se puede rechazar por forma sin riesgo de
  -- tirar un dato legítimo. La placa NO se valida a propósito: el producto vende
  -- en seis países con seis formatos distintos, y los que cambian con cada
  -- reforma. Un VIN mal formado además ensucia la detección, porque dos basuras
  -- iguales se proponen como el mismo auto.
  constraint lead_vehiculos_vin_forma check (vin is null or vin ~ '^[0-9A-Z]{17}$')
);

-- Sin UNIQUE sobre (lead_id, placa) ni (lead_id, vin), aunque
-- `lead_identificadores` sí tenga su equivalente. La diferencia es la fusión:
-- los identificadores se copian con `on conflict do nothing`, pero los vehículos
-- se mueven con un UPDATE, y `ON CONFLICT` no existe para UPDATE. Un índice
-- único haría fallar con 23505 la fusión de dos leads que comparten placa —que
-- es justo el par que el detector propone— y abortaría la transacción entera.
-- Dos filas de la misma placa tras una fusión son ruido que una persona limpia;
-- una fusión que no se puede ejecutar es un lead partido para siempre.

create index lead_vehiculos_lead_idx on public.lead_vehiculos (lead_id);

-- Los índices de la detección: dada una placa o un VIN, qué otros leads lo
-- tienen. Parciales porque la mayoría de los vehículos entra por la conversación
-- con marca y modelo y sin papeles a mano: indexar los NULL sería pagar por
-- filas que la consulta descarta.
create index lead_vehiculos_placa_idx on public.lead_vehiculos (placa) where placa is not null;
create index lead_vehiculos_vin_idx on public.lead_vehiculos (vin) where vin is not null;

comment on table public.lead_vehiculos is
  'Los autos de un lead. Varios por lead: un taller tiene un documento fiscal y tres camionetas. Placa y VIN identifican al auto, no a la persona, y por eso no viven en lead_identificadores. Sin UNIQUE global sobre placa ni vin porque el valor compartido es la senal que usa el detector de duplicados.';

comment on column public.lead_vehiculos.placa is
  'Placa normalizada (alfanumericos en mayuscula). Es la columna contra la que busca el detector; placa_original conserva lo que se escribio.';

comment on column public.lead_vehiculos.vin is
  'VIN normalizado, 17 alfanumericos (ISO 3779). Es la columna contra la que busca el detector; vin_original conserva lo que se escribio.';

alter table public.lead_vehiculos enable row level security;

-- Mismas reglas que `leads`, `lead_tags` y `lead_identificadores`: admin o
-- vendedor, nunca "cualquier autenticado". Un `using (true)` acá dejaría leer
-- las placas y los VIN de todos los leads a un usuario sin rol asignado.
create policy "lead_vehiculos_select"
  on public.lead_vehiculos for select
  to authenticated
  using ((select public.is_admin()) or (select public.is_vendedor()));

create policy "lead_vehiculos_insert"
  on public.lead_vehiculos for insert
  to authenticated
  with check ((select public.is_admin()) or (select public.is_vendedor()));

create policy "lead_vehiculos_update"
  on public.lead_vehiculos for update
  to authenticated
  using ((select public.is_admin()) or (select public.is_vendedor()))
  with check ((select public.is_admin()) or (select public.is_vendedor()));

create policy "lead_vehiculos_delete"
  on public.lead_vehiculos for delete
  to authenticated
  using ((select public.is_admin()) or (select public.is_vendedor()));

-- =========================================================================
-- Backfill de lo que ya está en `leads`
-- =========================================================================

-- Una fila por lead que tenga algo cargado, marcada `principal` porque es el
-- único auto que ese lead pudo haber tenido hasta ahora. Los leads sin ningún
-- dato de vehículo NO reciben fila: una fila con los seis campos en NULL no
-- dice "no sabemos", dice "hay un auto" y no lo hay.
--
-- Placa y VIN quedan en NULL: no existían como columna, así que no hay nada que
-- traer. `lead_identificadores` tampoco aporta —cero filas de tipo `placa` o
-- `vin` en la base, verificado antes de escribir esta migración con
-- `select tipo, count(*) from public.lead_identificadores group by tipo`.
insert into public.lead_vehiculos (lead_id, marca, modelo, anio, motor, principal)
select
  l.id,
  nullif(btrim(l.vehiculo_marca), ''),
  nullif(btrim(l.vehiculo_modelo), ''),
  nullif(l.vehiculo_anio, 0),
  nullif(btrim(l.vehiculo_motor), ''),
  true
from public.leads as l
where nullif(btrim(l.vehiculo_marca), '') is not null
   or nullif(btrim(l.vehiculo_modelo), '') is not null
   or nullif(l.vehiculo_anio, 0) is not null
   or nullif(btrim(l.vehiculo_motor), '') is not null;

-- =========================================================================
-- Las cuatro columnas de `leads` siguen vivas
-- =========================================================================

-- No se borran en esta migración a propósito. Las leen el catalog-matcher, las
-- métricas, el filtro por vehículo de `/leads`, el twin-extractor y la fusión.
-- Sacarlas es otra tarea: hay que mover cada uno de esos lectores a
-- `lead_vehiculos` primero.

comment on column public.leads.vehiculo_marca is
  'Espejo del vehiculo principal (lead_vehiculos.principal). DEUDA ABIERTA: la fuente de verdad es lead_vehiculos desde la migracion 20260814230000; esta columna sigue viva porque la leen catalog-matcher, metricas, el filtro de /leads, el twin-extractor y la fusion.';

comment on column public.leads.vehiculo_modelo is
  'Espejo del vehiculo principal (lead_vehiculos.principal). DEUDA ABIERTA: ver comentario de leads.vehiculo_marca.';

comment on column public.leads.vehiculo_anio is
  'Espejo del vehiculo principal (lead_vehiculos.principal). DEUDA ABIERTA: ver comentario de leads.vehiculo_marca.';

comment on column public.leads.vehiculo_motor is
  'Espejo del vehiculo principal (lead_vehiculos.principal). DEUDA ABIERTA: ver comentario de leads.vehiculo_marca.';
