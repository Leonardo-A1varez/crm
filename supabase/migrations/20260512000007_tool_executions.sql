-- 0007_tool_executions.sql
-- Audit trail de tool calls del agente IA. Permite ver "qué buscó el agente"
-- y diagnosticar respuestas incorrectas (precio, stock, alucinaciones).
-- mensaje_id nullable: persistimos PRE-send. Linking opcional vía cron o consulta por tiempo.

CREATE TABLE tool_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_session_id uuid NOT NULL REFERENCES lead_session(id) ON DELETE CASCADE,
  mensaje_id uuid REFERENCES mensajes(id) ON DELETE SET NULL,
  tool_name text NOT NULL,
  args jsonb NOT NULL,
  result jsonb,
  error text,
  duration_ms int,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_tool_executions_session_created
  ON tool_executions (lead_session_id, created_at DESC);

CREATE INDEX idx_tool_executions_tool_name
  ON tool_executions (tool_name, created_at DESC);

ALTER TABLE tool_executions ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE tool_executions IS
  'Audit log de tool calls (buscar_repuesto, etc). CASCADE con sesión para purge.';
