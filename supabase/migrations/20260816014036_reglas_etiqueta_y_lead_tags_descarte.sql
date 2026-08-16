-- Las etiquetas dejan de depender de que alguien se acuerde de ponerlas.
--
-- `lead_tags.source` admite 'workflow' desde la migración fundacional y ningún
-- workflow escribió una fila jamás: el schema se diseñó esperando etiquetado
-- automático y esa mitad nunca se construyó. Diseño completo en
-- `docs/superpowers/specs/2026-08-15-etiquetas-design.md`.
--
-- Dos piezas:
--   1. `reglas_etiqueta`: qué etiqueta colgar ante qué intent.
--   2. `lead_tags` deja de borrar filas, para recordar que una persona la sacó.

-- =========================================================================
-- 1. Reglas que etiquetan
-- =========================================================================

-- Tabla propia y no una columna en `reglas` porque las dos clases de regla
-- tienen reglas de selección contradictorias: la que contesta gana UNA (la de
-- mayor prioridad) y corta el LLM; la que etiqueta aplican TODAS y no corta
-- nada. En la misma fila habría que aflojar `respuesta_contenido` a nullable y
-- entonces todo lector de una regla —incluido el que decide si se llama al
-- LLM— tendría que manejar el vacío.
--
-- Además nace separable: el dueño va a construir un motor de workflows con
-- trigger de etiqueta y esta tabla queda como mecanismo de transición.
create table public.reglas_etiqueta (
  id                uuid primary key default gen_random_uuid(),
  intent_id         uuid not null references public.intents(id) on delete cascade,
  -- RESTRICT y no CASCADE: con cascade, borrar una etiqueta desde el modal se
  -- llevaría puesta la regla que la asigna sin decir nada. Con restrict,
  -- Postgres devuelve 23505/23503, `mapPostgrestError` lo vuelve ConflictError
  -- y la pantalla puede explicar por qué no se borró.
  tag_id            uuid not null references public.tags(id) on delete restrict,
  condiciones_extra jsonb,
  activa            boolean not null default true,
  created_at        timestamptz not null default now(),
  -- Dos filas iguales colgarían la misma etiqueta dos veces.
  constraint reglas_etiqueta_par_unico unique (intent_id, tag_id)
);

comment on table public.reglas_etiqueta is
  'Que etiqueta colgar ante que intent. No contesta: el turno sigue su curso normal.';

-- El motor busca por intent y solo las activas, igual que `reglas`.
create index reglas_etiqueta_intent_idx
  on public.reglas_etiqueta (intent_id)
  where activa;

alter table public.reglas_etiqueta enable row level security;

-- Mismo trato que `reglas`: lee cualquiera autenticado, escribe admin.
create policy reglas_etiqueta_select on public.reglas_etiqueta
  for select to authenticated
  using ((select public.is_admin()) or (select public.is_vendedor()));
create policy reglas_etiqueta_insert_admin on public.reglas_etiqueta
  for insert to authenticated
  with check ((select public.is_admin()));
create policy reglas_etiqueta_update_admin on public.reglas_etiqueta
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
-- `reglas` no tiene policy de DELETE y por eso no se pueden borrar. Acá sí:
-- una regla de etiquetado que sobra se saca, no se deja desactivada para
-- siempre ensuciando la lista.
create policy reglas_etiqueta_delete_admin on public.reglas_etiqueta
  for delete to authenticated
  using ((select public.is_admin()));

-- =========================================================================
-- 2. Quitar una etiqueta a mano es definitivo
-- =========================================================================

-- Sin esto, una regla vuelve a colgar la etiqueta apenas el cliente repite la
-- palabra que la disparó: el vendedor la saca, el cliente escribe "factura"
-- otra vez y reaparece. Es la misma promesa que ya hace el Twin con
-- `procedencia`: lo que corrigió una persona no se pisa.
--
-- Se marca la fila en vez de borrarla para que "puesta" y "descartada" sean el
-- mismo renglón en dos estados. Con una tabla aparte de descartes, un lead
-- podría figurar con la etiqueta puesta y descartada a la vez y habría que
-- elegir a cuál creerle.
alter table public.lead_tags
  add column quitada_at  timestamptz,
  add column quitada_por uuid references public.usuarios(id) on delete set null;

comment on column public.lead_tags.quitada_at is
  'Cuando una persona la saco. Con valor, la etiqueta NO esta puesta: toda lectura filtra por null.';
comment on column public.lead_tags.quitada_por is
  'Quien la saco. Null si la fila nunca se quito, o si el usuario fue borrado.';

-- Las lecturas filtran `quitada_at is null` y son casi todas por lead.
create index lead_tags_vigentes_idx
  on public.lead_tags (lead_id)
  where quitada_at is null;
