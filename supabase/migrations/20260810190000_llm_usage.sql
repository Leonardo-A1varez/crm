-- Gasto del agente de IA, turno por turno.
--
-- Pedido del duenio del producto: saber cuanto cuesta cada conversacion y cada
-- lead. Hasta ahora `recordLlmUsage` alimentaba un contador en memoria
-- (`InMemoryCostTracker`) que se reinicia en cada cold start y que ademas suma
-- un unico total diario global: no hay forma de preguntarle cuanto costo una
-- sesion. El dato existia en cada llamada y se tiraba.
--
-- TABLA NUEVA Y NO COLUMNAS. Las tres alternativas y por que se descartaron:
--
--   1. Columnas en `mensajes` (costo del turno junto al mensaje entrante).
--      Un turno dispara MAS de una llamada al modelo —clasificador de intents,
--      agente vendedor, extractor del Twin, y el resumidor cuando toca— asi
--      que una fila de `mensajes` tendria que guardar la suma de todas y
--      perderia el desglose por modelo y por workflow, que es justo lo que
--      permite decidir donde bajar el gasto. Ademas `mensajes` es la tabla mas
--      caliente y mas grande del schema, y las columnas quedarian en NULL en
--      todos los salientes.
--
--   2. Un acumulador en `lead_session` (`costo_ia_usd` incremental).
--      Convierte cada llamada al modelo en un UPDATE sobre la fila mas
--      contendida de la sesion —la que el pipeline ya lee y escribe en cada
--      turno—, y deja el historial irrecuperable: un total no se puede
--      desagregar despues por modelo, workflow ni fecha.
--
--   3. `mensajes.metadata` jsonb. Mezcla auditoria inmutable con el payload
--      crudo de Meta y obliga a un indice de expresion para sumar por ventana.
--
-- Esta tabla es append-only, una fila por llamada al modelo, con el mismo
-- patron que `rule_executions`, `turn_classifications` y `tool_executions`:
-- misma forma, misma query por ventana de tiempo.
--
-- Que NO se toca: `agente_config.tope_gasto_diario_usd` y
-- `agente_config.politica_tope` siguen existiendo. Son parte de versiones ya
-- guardadas de una tabla append-only y borrarlas reescribiria el historial.
-- La consola deja de ofrecerlas como control (decision del duenio del
-- producto: no quiere tope de gasto), pero el dato queda.

create table public.llm_usage (
  id              uuid primary key default gen_random_uuid(),

  -- NULL legitimo: el detector batch de intents corre sobre muchas sesiones a
  -- la vez y no pertenece a ninguna.
  --
  -- `on delete set null` y no `cascade`: el cron de purga borra las sesiones
  -- cerradas a los 29 dias, y con cascade el gasto de ese mes desapareceria de
  -- las metricas junto con ellas. Se prefiere perder la atribucion —el
  -- drill-down por conversacion— antes que perder la plata gastada.
  lead_session_id uuid references public.lead_session(id) on delete set null,

  -- Mensaje entrante que origino el turno. Mismo criterio de borrado y mismo
  -- ancla que usan `rule_executions` y `turn_classifications`. NULL cuando la
  -- llamada no nace de un mensaje (batch de intents, preview de la consola).
  mensaje_id      uuid references public.mensajes(id) on delete set null,

  -- Texto y no FK ni enum: el modelo es lo que se facturo en ese momento. Si
  -- manana se saca `gpt-4o-mini` de la lista blanca, el historico tiene que
  -- seguir diciendo con que se pago.
  modelo          text not null,

  input_tokens    integer not null default 0 check (input_tokens >= 0),
  output_tokens   integer not null default 0 check (output_tokens >= 0),

  -- numeric y no float: son centavos que se suman miles de veces y el error de
  -- redondeo binario se acumula. 6 decimales porque un turno con un modelo
  -- nano cuesta del orden de 1e-5 USD y con menos precision se guardaria 0.
  costo_usd       numeric(12,6) not null check (costo_usd >= 0),

  -- Que llamada fue: "ai-agent", "intent-classifier", "twin-extractor",
  -- "conversation-summarizer", "intent-batch-detector", "agente-preview".
  -- Sin esto no se puede separar el gasto de produccion del de pruebas.
  workflow        text not null,

  created_at      timestamptz not null default now()
);

-- "Cuanto costo esta conversacion": el unico corte del panel del Twin.
create index llm_usage_session_idx
  on public.llm_usage (lead_session_id, created_at desc);
-- Metricas y gasto del dia: siempre por ventana de tiempo.
create index llm_usage_created_idx
  on public.llm_usage (created_at desc);

comment on table public.llm_usage is
  'Una fila por llamada al modelo: tokens, costo en USD, modelo y workflow. Append-only. Responde cuanto costo una sesion, un lead y un periodo.';
comment on column public.llm_usage.lead_session_id is
  'NULL cuando la llamada no pertenece a una sesion (detector batch) o cuando la sesion se purgo. El gasto sobrevive a la purga.';
comment on column public.llm_usage.mensaje_id is
  'Mensaje entrante que origino el turno. NULL en las llamadas que no nacen de un mensaje.';
comment on column public.llm_usage.costo_usd is
  'Calculado en la app con la tabla de precios de src/lib/agente/modelos.ts al momento de la llamada. No se recalcula despues: si el precio cambia, lo gastado no.';
comment on column public.llm_usage.workflow is
  'Que llamada al modelo fue. agente-preview marca las pruebas de la consola, que no son gasto de produccion.';

alter table public.llm_usage enable row level security;

-- Lectura para el panel (metricas §3.1/§3.2, Twin, consola del agente). La
-- escritura la hace el pipeline con service-role, que bypassa RLS: sin policy
-- de INSERT nadie mas puede escribir auditoria de gasto. Mismo criterio que
-- `tool_executions` y `turn_classifications`. No hay PII adentro.
create policy llm_usage_select on public.llm_usage
  for select to authenticated
  using ((select public.is_admin()) or (select public.is_vendedor()));
