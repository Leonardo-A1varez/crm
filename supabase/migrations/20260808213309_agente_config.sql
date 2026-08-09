-- G1: configuracion del agente en runtime.
--
-- Append-only y versionada: guardar crea una fila nueva, nunca actualiza una
-- existente. Rollback inserta una version que copia los valores de una vieja.
-- Asi la linea de tiempo nunca retrocede y el historial se lee como lo que paso
-- ("v7 fue un rollback a v3") en vez de borrar que hubo un problema.

create table agente_config (
  id uuid primary key default gen_random_uuid(),
  version integer not null,

  -- Comportamiento
  modelo text not null,
  instrucciones text not null default '',
  tono text not null,
  largo text not null,
  emojis text not null,
  descuento_max_pct numeric(4,1) not null,

  -- Limites tecnicos
  max_pasos_tool integer not null,
  ventana_contexto_mensajes integer not null,
  umbral_resumen_turnos integer not null,

  -- Costo
  tope_gasto_diario_usd numeric(8,2) not null,
  politica_tope text not null,

  -- Horario
  horario jsonb not null,
  horario_timezone text not null,
  plantilla_fuera_horario text not null default '',

  -- Procedencia
  activa boolean not null default false,
  nota text,
  rollback_de uuid references agente_config(id) on delete set null,
  creada_por uuid references public.usuarios(id) on delete set null,
  created_at timestamptz not null default now(),

  constraint agente_config_tono_valido       check (tono in ('formal','neutro','cercano')),
  constraint agente_config_largo_valido      check (largo in ('corto','medio','detallado')),
  constraint agente_config_emojis_valido     check (emojis in ('nunca','ocasional','libre')),
  constraint agente_config_politica_valida   check (politica_tope in ('pausar','solo_reglas','seguir')),
  constraint agente_config_descuento_rango   check (descuento_max_pct between 0 and 20),
  constraint agente_config_pasos_rango       check (max_pasos_tool between 1 and 10),
  constraint agente_config_ventana_rango     check (ventana_contexto_mensajes between 4 and 40),
  constraint agente_config_resumen_rango     check (umbral_resumen_turnos between 10 and 100),
  constraint agente_config_tope_rango        check (tope_gasto_diario_usd between 0.5 and 1000),
  constraint agente_config_instrucciones_len check (char_length(instrucciones) <= 4000),
  constraint agente_config_plantilla_len     check (char_length(plantilla_fuera_horario) <= 1000)
);

-- `modelo` NO lleva CHECK contra una lista fija a proposito: la lista vive en
-- OPENAI_PRICING (TypeScript) y duplicarla en SQL crea dos fuentes de verdad
-- que se desincronizan en cuanto se agregue un modelo. Valida la Server Action.

create unique index agente_config_version_unica on agente_config (version);

-- Garantiza a nivel de base que hay como maximo UNA fila activa. Sin este
-- indice, dos admins guardando a la vez dejan dos configs activas y el agente
-- elige una al azar segun el orden de la query: un bug que no se reproduce en
-- dev y arruina una tarde en produccion.
create unique index agente_config_una_activa on agente_config (activa) where activa;

create index agente_config_creada on agente_config (created_at desc);

alter table agente_config enable row level security;

-- Lectura para todo autenticado: la UI la muestra, y el vendedor necesita ver
-- con que config opera el agente de la conversacion que va a tomar.
create policy agente_config_select_authed on agente_config
  for select to authenticated using (true);

-- Escritura solo admin. Sin policy de DELETE: la historia no se borra.
create policy agente_config_insert_admin on agente_config
  for insert to authenticated with check ((select public.is_admin()));

-- UPDATE existe unicamente para alternar `activa`.
create policy agente_config_update_admin on agente_config
  for update to authenticated using ((select public.is_admin()));

comment on table agente_config is
  'Config del agente vendedor, append-only y versionada. Una sola fila activa (indice parcial). Ver docs/superpowers/specs/2026-08-08-agente-g1-configuracion-design.md';

-- Semilla: reproduce EXACTAMENTE los valores hoy hardcodeados, para que aplicar
-- esta migracion no cambie el comportamiento del agente. Debe coincidir con
-- CONFIG_DE_FABRICA en src/lib/agente/defaults.ts.
insert into agente_config (
  version, modelo, instrucciones, tono, largo, emojis, descuento_max_pct,
  max_pasos_tool, ventana_contexto_mensajes, umbral_resumen_turnos,
  tope_gasto_diario_usd, politica_tope,
  horario, horario_timezone, plantilla_fuera_horario,
  activa, nota
) values (
  1, 'gpt-4o-mini', '', 'cercano', 'corto', 'nunca', 0,
  5, 10, 20,
  10, 'pausar',
  '{"lun":[{"desde":"00:00","hasta":"23:59"}],
    "mar":[{"desde":"00:00","hasta":"23:59"}],
    "mie":[{"desde":"00:00","hasta":"23:59"}],
    "jue":[{"desde":"00:00","hasta":"23:59"}],
    "vie":[{"desde":"00:00","hasta":"23:59"}],
    "sab":[{"desde":"00:00","hasta":"23:59"}],
    "dom":[{"desde":"00:00","hasta":"23:59"}]}'::jsonb,
  'America/Argentina/Buenos_Aires', '',
  true, 'Semilla: valores hardcodeados previos a G1'
);
