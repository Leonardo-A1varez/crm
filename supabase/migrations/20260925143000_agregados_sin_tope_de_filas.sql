-- Agregados que antes se calculaban en TypeScript sobre filas traídas por
-- PostgREST. PostgREST corta en `max_rows` (1.000) y no avisa (AGENTS.md,
-- lección 12): pasado ese volumen los números salían de una muestra y no del
-- total, sin un error en ningún log.
--
-- Todas son `security invoker`: corren con el rol del que llama, así que RLS
-- recorta igual que recortaba la consulta de filas que reemplazan. Devuelven
-- una fila por grupo —etiqueta, intent, motivo, workflow—, que son catálogos
-- chicos: el resultado no se acerca al corte.

-- =========================================================================
-- Etiquetas: cuántos leads tienen puesta cada una.
-- =========================================================================

-- Reemplaza el `select tag_id from lead_tags` que se agrupaba en JS para el
-- contador de uso de la administración de etiquetas. Las descartadas
-- (`quitada_at` no nulo) siguen en la tabla pero no están puestas.
create function public.contar_leads_por_etiqueta()
returns table (tag_id uuid, leads bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select lt.tag_id, count(*)::bigint
    from public.lead_tags lt
   where lt.quitada_at is null
   group by lt.tag_id;
$$;

revoke all on function public.contar_leads_por_etiqueta() from public, anon;
grant execute on function public.contar_leads_por_etiqueta() to authenticated, service_role;

-- =========================================================================
-- Métricas: los cortes que el service solo cuenta o suma.
-- =========================================================================
--
-- Ventana `[p_desde, p_hasta)`, la misma que aplican las lecturas de filas con
-- `.gte()` + `.lt()`. Los tres se apoyan en los índices `(created_at desc)` que
-- ya existen en cada tabla.

-- Turnos que el LLM resolvió con cada intent. `intent_id` null = el
-- clasificador no reconoció ninguno; el service los descarta.
create function public.metricas_clasificaciones_por_intent(
  p_desde timestamptz,
  p_hasta timestamptz
)
returns table (intent_id uuid, turnos bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select tc.intent_id, count(*)::bigint
    from public.turn_classifications tc
   where tc.created_at >= p_desde
     and tc.created_at < p_hasta
   group by tc.intent_id;
$$;

-- Pausas de la IA por motivo. Las reanudaciones (`action = 'resume'`) no son
-- escalados y nunca se contaron.
create function public.metricas_pausas_por_motivo(
  p_desde timestamptz,
  p_hasta timestamptz
)
returns table (reason_code text, cantidad bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select he.reason_code, count(*)::bigint
    from public.handoff_events he
   where he.action = 'pause'
     and he.created_at >= p_desde
     and he.created_at < p_hasta
   group by he.reason_code;
$$;

-- Gasto por workflow. La suma de `costo_usd` queda en `numeric`: exacta, sin
-- el error de redondeo binario que acumulaba sumar doubles en JS.
create function public.metricas_gasto_por_workflow(
  p_desde timestamptz,
  p_hasta timestamptz
)
returns table (
  workflow text,
  llamadas bigint,
  costo_usd numeric,
  input_tokens bigint,
  output_tokens bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select u.workflow,
         count(*)::bigint,
         sum(u.costo_usd),
         sum(u.input_tokens)::bigint,
         sum(u.output_tokens)::bigint
    from public.llm_usage u
   where u.created_at >= p_desde
     and u.created_at < p_hasta
   group by u.workflow;
$$;

revoke all on function public.metricas_clasificaciones_por_intent(timestamptz, timestamptz)
  from public, anon;
grant execute on function public.metricas_clasificaciones_por_intent(timestamptz, timestamptz)
  to authenticated, service_role;

revoke all on function public.metricas_pausas_por_motivo(timestamptz, timestamptz)
  from public, anon;
grant execute on function public.metricas_pausas_por_motivo(timestamptz, timestamptz)
  to authenticated, service_role;

revoke all on function public.metricas_gasto_por_workflow(timestamptz, timestamptz)
  from public, anon;
grant execute on function public.metricas_gasto_por_workflow(timestamptz, timestamptz)
  to authenticated, service_role;
