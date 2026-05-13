-- 0009_session_summary.sql
-- Rolling summary de conversación. Cuando sesión tiene >N msgs el contexto excede
-- ventana económica LLM. Summarizer condensa msgs antiguos en texto rolling.
-- buildConversationTurn prefija "[Resumen previo]: ..." + últimos 10 msgs literales.

ALTER TABLE lead_session
  ADD COLUMN context_summary text;

COMMENT ON COLUMN lead_session.context_summary IS
  'Rolling summary LLM-generated. Reemplaza msgs antiguos en el contexto del agente para limitar tokens.';
