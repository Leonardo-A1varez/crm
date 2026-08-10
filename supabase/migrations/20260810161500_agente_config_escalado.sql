-- Escalado (handoff §4.2) y el limite tecnico del §4.4 que si tiene lector.
--
-- Aditiva sobre `agente_config`, que es append-only y versionada: NO se toca
-- ninguna fila existente ni se borra nada. Los DEFAULT no son cosmeticos —
-- son los que van a quedar en las versiones ya guardadas (incluida la semilla
-- v1), asi que cada uno tiene que ser un valor con el que el agente pueda
-- operar sin que nadie entre a la pantalla. Por eso el default de cada
-- condicion nueva es el estado APAGADO, salvo donde el handoff pide un numero.
--
-- Solo entran campos que alguien lee. Las condiciones del §4.2/§4.4 que hoy
-- no tienen forma de hacerse efectivas NO tienen columna, porque un numero
-- guardado que nadie lee es peor que no tenerlo: la pantalla promete un
-- control que no existe (el problema que ya arrastra `tope_gasto_diario_usd`).
-- Quedan afuera, y la pantalla las muestra como faltantes:
--
--   * "urgencia alta sin cerrar en N min" — nadie mide cuanto lleva abierta
--     una sesion ni hay un scheduler por sesion.
--   * "reintentos ante error de Meta" — los pone Inngest al definir la
--     funcion, no por turno.
--   * "fuera de horario escala" — fuera de horario el pipeline responde la
--     plantilla y corta ANTES de llamar al agente, asi que no hay ningun
--     punto donde un booleano pudiera cambiar el rumbo.
--   * "maximo de turnos por sesion" — nadie cuenta los turnos de una sesion.
--     La ventana de contexto es mas corta que cualquier tope razonable, asi
--     que tampoco se puede deducir de lo que el agente ya recibe.

alter table agente_config
  -- §4.2 — Intents desconocidos seguidos. Hasta ahora fijo en 3 dentro de
  -- handoff.service. El handoff pide 2 por defecto, rango 1-5.
  add column escalar_umbral_intents integer not null default 2,

  -- §4.2 — "Palabras que escalan siempre". `text[]` y no una tabla aparte
  -- porque son parte de la version de config: cambiar la lista tiene que
  -- quedar en el historial y poder revertirse con el rollback, igual que el
  -- tono o el tope de gasto. Una tabla suelta se editaria por fuera de la
  -- linea de versiones y el rollback no la traeria de vuelta.
  add column escalar_palabras text[] not null default '{}',

  -- §4.2 — "Cotizacion mayor a". NULL = condicion apagada; el handoff la
  -- modela con un switch y esto es su apagado, sin una segunda columna
  -- booleana que pueda contradecir al monto.
  add column escalar_cotizacion_desde numeric(12,2),

  -- §4.4 — Timeout de la herramienta de catalogo, en ms.
  add column timeout_tool_ms integer not null default 3000;

alter table agente_config
  add constraint agente_config_umbral_intents_rango
    check (escalar_umbral_intents between 1 and 5),
  -- Tope de cardinalidad: la lista se recorre contra cada mensaje entrante, y
  -- sin cota una edicion desprolija la vuelve un costo por turno.
  -- `array_length` de un array vacio devuelve NULL, de ahi el IS NULL.
  --
  -- El largo de cada palabra lo valida Zod y no un CHECK: un CHECK tendria que
  -- recorrer el array con una subconsulta, y Postgres no las admite adentro de
  -- un CHECK. Mismo criterio que `modelo`, que tampoco tiene CHECK.
  add constraint agente_config_palabras_cantidad
    check (array_length(escalar_palabras, 1) is null or array_length(escalar_palabras, 1) <= 50),
  -- Rango del handoff: $100k a $2.000k, paso $100k.
  add constraint agente_config_cotizacion_rango
    check (escalar_cotizacion_desde is null
           or escalar_cotizacion_desde between 100000 and 2000000),
  add constraint agente_config_timeout_rango
    check (timeout_tool_ms between 500 and 30000);

comment on column agente_config.escalar_umbral_intents is
  'Intents desconocidos consecutivos que pausan la IA. Lo lee handoff.service al evaluar el auto-handoff.';
comment on column agente_config.escalar_palabras is
  'Palabras que escalan sin importar el intent. Se comparan normalizadas (minusculas, sin tildes) contra el texto entrante.';
comment on column agente_config.escalar_cotizacion_desde is
  'Monto cotizado a partir del cual la sesion pasa a un humano. NULL = condicion apagada.';
comment on column agente_config.timeout_tool_ms is
  'Corte de la llamada a buscar_repuesto. Al vencer, el turno sigue sin resultado de catalogo en vez de colgarse.';

-- Las filas ya existentes toman los DEFAULT. Es un cambio de comportamiento
-- deliberado y hay que decirlo: la v1 pasa a tener timeout de tool de 3 s y
-- umbral de intents 2 (antes 3, fijo en codigo). Los dos son los valores que
-- pide el handoff. Las condiciones que agregan escalado nuevo —palabras y
-- cotizacion— quedan apagadas, asi que nadie se despierta con conversaciones
-- escalando por una config que no eligio.
