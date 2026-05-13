-- 0013_reactivation_dispatches.sql
-- Tracking de envíos de reactivación. Resuelve TODO docs/idempotency.md §Reactivation cron.
--
-- Problema: el cron `reactivation-predictor.cron` corre semanal. Lead perdido a -8d
-- entra en window [-60d, -7d) varios lunes seguidos = templates Meta repetidos
-- al mismo lead. UX horrible + posible spam-block Meta.
--
-- Mitigación: tabla append-only de dispatches. Cooldown vía
-- `findLatestBySessionId(sessionId)` antes de cada envío.
--
-- History-friendly (no columna boolean): permite múltiples reactivaciones por sesión
-- (estrategia "3 intentos espaciados 30d") + analytics post-mortem (cuál motivo
-- responde mejor a qué template).
--
-- CASCADE con lead_session: cuando purge cron borra sesión cerrada >29d,
-- dispatches asociados van con ella.

CREATE TABLE reactivation_dispatches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_session_id uuid NOT NULL REFERENCES lead_session(id) ON DELETE CASCADE,
  motivo motivo_perdida_enum,
  template_name text NOT NULL,
  meta_message_id text,
  status text NOT NULL DEFAULT 'sent',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_reactivation_dispatches_session_created
  ON reactivation_dispatches (lead_session_id, created_at DESC);

CREATE INDEX idx_reactivation_dispatches_status_created
  ON reactivation_dispatches (status, created_at DESC);

ALTER TABLE reactivation_dispatches ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE reactivation_dispatches IS
  'Audit + cooldown enforcement de templates Meta de reactivación enviados a leads perdidos. Append-only, CASCADE con sesión.';

COMMENT ON COLUMN reactivation_dispatches.status IS
  'sent | failed | bounced. Service-level enum (no DB enum) para evolución sin migration.';
