-- 0008_session_extras.sql
-- Catch-all jsonb para custom fields extraídos por el LLM (preferencias,
-- observaciones libres, notas de uso, datos contextuales no estructurados).
-- Schema rígido pierde insights; este campo absorbe lo que no encaja en columnas tipadas.

ALTER TABLE lead_session
  ADD COLUMN extras jsonb NOT NULL DEFAULT '{}';

CREATE INDEX idx_lead_session_extras_gin
  ON lead_session USING gin (extras);

COMMENT ON COLUMN lead_session.extras IS
  'Custom fields LLM-extracted. Shallow-merged en updates desde LeadTwinUpdate.extras.';
