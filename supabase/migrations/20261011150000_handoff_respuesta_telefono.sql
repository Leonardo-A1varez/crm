-- Coexistencia (docs/meta/conectar-whatsapp.md): cuando el negocio contesta desde
-- la app del teléfono, el sistema pausa la IA de esa sesión por 2 horas y la
-- reanuda al vencer. Ese mecanismo escribe en `handoff_events` con dos motivos y
-- un origen que los CHECK originales (20260812222808) no admiten:
--
--   reason_code: 'respuesta_desde_telefono' (la pausa) y 'reanudacion_automatica'
--   source:      'sistema' (no es una persona, ni el agente, ni una regla)
--
-- `transition_handoff` recibe ambos como `text` y no cambia: sólo se ensanchan
-- las listas permitidas. Los nombres son los que Postgres asignó a los CHECK en
-- línea del `create table` original.

alter table public.handoff_events
  drop constraint handoff_events_reason_code_check,
  add constraint handoff_events_reason_code_check check (reason_code in (
    'unknown_intents',
    'sensitive_keyword',
    'quote_limit',
    'discount_limit',
    'rule_handoff',
    'manual_pause',
    'manual_resume',
    'respuesta_desde_telefono',
    'reanudacion_automatica',
    'other'
  ));

alter table public.handoff_events
  drop constraint handoff_events_source_check,
  add constraint handoff_events_source_check check (source in (
    'auto_handoff',
    'agent_guard',
    'rule',
    'pipeline_guard',
    'admin',
    'sistema'
  ));
