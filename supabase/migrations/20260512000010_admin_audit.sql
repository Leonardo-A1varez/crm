-- 0010_admin_audit.sql
-- Audit log de acciones admin: activar intent, merge leads, pause IA manual,
-- editar reglas, importar productos, etc. Provee trazabilidad ops.
-- Entity_id nullable (no toda acción aplica a entidad puntual; e.g. bulk import).

CREATE TABLE admin_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  payload jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_admin_actions_created
  ON admin_actions (created_at DESC);

CREATE INDEX idx_admin_actions_entity
  ON admin_actions (entity_type, entity_id, created_at DESC);

CREATE INDEX idx_admin_actions_actor
  ON admin_actions (actor_user_id, created_at DESC);

ALTER TABLE admin_actions ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE admin_actions IS
  'Audit trail de acciones admin (intent toggle, lead merge, manual handoff, rule CRUD, etc).';
