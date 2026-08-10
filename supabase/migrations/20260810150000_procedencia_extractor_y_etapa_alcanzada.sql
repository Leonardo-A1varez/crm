-- Sub-proyecto E (continuación) — la procedencia también anota al extractor, y
-- la sesión recuerda hasta dónde llegó en el embudo.
--
-- === 1. `procedencia` cambia de contrato ===
--
-- La forma de 20260810011600 guardaba solo la corrección humana y la ausencia
-- de clave significaba "lo puso la IA". Ese atajo alcanzaba para pintar un chip
-- pero no para las dos líneas que pide el handoff §1.4 debajo de cada campo:
-- "origen: mensaje del cliente · 09:12" y "el extractor había inferido
-- «Hilux 2.8»". Las dos necesitan dato que nadie guardaba — de qué mensaje
-- salió el valor, y qué había ahí antes de pisarlo.
--
-- Forma nueva, por campo:
--   { "por": "ia" | "humano",
--     "at": "<iso>",
--     "user_id": "<uuid|null>",          -- solo tiene sentido en por=humano
--     "mensaje_origen_id": "<uuid|null>",-- mensaje del que se dedujo el valor
--     "valor_anterior": <texto|numero|null> }
--
-- La ausencia de clave ya NO significa "lo puso la IA": significa que nadie
-- escribió ese campo todavía. Sí se paga escribir el caso normal en cada turno,
-- que es lo que la migración original evitaba, pero acotado a los 5 campos que
-- el Twin declara (`CAMPOS_TWIN_EDITABLES` en src/types/domain.ts) y no a la
-- fila entera: el resto del patch del extractor sigue sin dejar rastro.
--
-- === 2. `etapa_alcanzada` ===
--
-- El rail del Twin se congela cuando la sesión se va a un desvío (`perdido`,
-- `requiere_humano`), y el handoff pide que se congele *hasta la última etapa
-- del embudo por la que pasó*, con el texto "El embudo quedó frenado en
-- «Identificando»". Ese dato no existía: `current_stage` ya vale `perdido` y
-- por dónde venía se perdió, así que el rail se apagaba entero en gris.

-- -------------------------------------------------------------------------
-- 1. procedencia
-- -------------------------------------------------------------------------

comment on column public.lead_session.procedencia is
  'Quien escribio cada campo del Twin (ia|humano), cuando, de que mensaje salio y que valor piso. Clave ausente = nadie escribio ese campo todavia.';

-- Guarda de forma sobre el contrato nuevo: `por` es el discriminador del que
-- cuelga toda la UI, y un valor fuera del par haria que el panel no sepa que
-- chip pintar. El CHECK de 20260810011600 ya cubre que la raiz sea un objeto.
alter table public.lead_session
  add constraint lead_session_procedencia_por_valido
  check (
    not jsonb_path_exists(
      procedencia,
      '$.* ? (!exists(@.por) || (@.por != "ia" && @.por != "humano"))'
    )
  );

-- -------------------------------------------------------------------------
-- 2. etapa_alcanzada
-- -------------------------------------------------------------------------

alter table public.lead_session
  add column etapa_alcanzada current_stage_enum not null default 'nuevo';

-- El embudo son 6 etapas. `perdido` y `requiere_humano` son desvios y no
-- pueden ser "lo alcanzado" — guardarlos ahi seria volver a perder el dato que
-- esta columna existe para conservar. El CHECK deja la columna incapaz de
-- aceptarlos, en vez de confiar en que ningun caller se equivoque.
alter table public.lead_session
  add constraint lead_session_etapa_alcanzada_es_del_embudo
  check (
    etapa_alcanzada in (
      'nuevo','identificando','cotizado','negociando','esperando_pago','cerrado'
    )
  );

-- Backfill: una sesion ya paso por su etapa actual. Las que estan en un desvio
-- quedan en 'nuevo' porque su recorrido es justamente lo que no se guardo.
--
-- El trigger `lead_session_bump_updated_at` (20260810143100) se apaga mientras
-- dura: esto es un cambio de schema y no una edicion de la ficha, y sin apagarlo
-- toda sesion vieja pasaria a decir "hace 0 s" en el encabezado del Twin.
-- El `if exists` es por los entornos donde esa migracion todavia no corrio.
do $$
declare
  tiene_trigger boolean := exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.lead_session'::regclass
      and tgname = 'lead_session_bump_updated_at'
  );
begin
  if tiene_trigger then
    alter table public.lead_session disable trigger lead_session_bump_updated_at;
  end if;

  update public.lead_session
     set etapa_alcanzada = current_stage
   where current_stage in (
     'nuevo','identificando','cotizado','negociando','esperando_pago','cerrado'
   );

  if tiene_trigger then
    alter table public.lead_session enable trigger lead_session_bump_updated_at;
  end if;
end
$$;

comment on column public.lead_session.etapa_alcanzada is
  'Maximo paso del embudo por el que paso la sesion. En un desvio el rail del Twin se congela aca. Nunca guarda perdido ni requiere_humano.';
