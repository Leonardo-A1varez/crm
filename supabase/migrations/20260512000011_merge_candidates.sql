-- 0011_merge_candidates.sql
-- Detector auto de leads potencialmente duplicados (e.g., mismo human writing por WA real +
-- IG con placeholder telefono). Heurística mantiene status=pending; admin aprueba en UI.

CREATE TYPE merge_candidate_status_enum AS ENUM (
  'pending',
  'approved',
  'rejected',
  'superseded'
);

CREATE TABLE merge_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  src_lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  dst_lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  similarity_score numeric(4, 3) NOT NULL,
  reasons jsonb NOT NULL DEFAULT '[]',
  status merge_candidate_status_enum NOT NULL DEFAULT 'pending',
  resolved_by uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT merge_candidates_no_self CHECK (src_lead_id <> dst_lead_id)
);

-- Evita duplicar candidato pendiente entre el mismo par (orden-independiente).
-- Hash combinando LEAST/GREATEST asegura simetría.
CREATE UNIQUE INDEX uq_merge_candidates_pending_pair
  ON merge_candidates (LEAST(src_lead_id, dst_lead_id), GREATEST(src_lead_id, dst_lead_id))
  WHERE status = 'pending';

CREATE INDEX idx_merge_candidates_status_created
  ON merge_candidates (status, created_at DESC);

ALTER TABLE merge_candidates ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE merge_candidates IS
  'Pares de leads detectados como posible duplicado. Admin aprueba via UI Fase 8.';
