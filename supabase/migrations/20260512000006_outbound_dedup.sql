-- 0006_outbound_dedup.sql
-- Outbound idempotency. Garantiza que retry Inngest no duplica mensaje out.
-- Key convention: "out:<meta_message_id_inbound>" (1 inbound → 1 outbound dedup).

ALTER TABLE mensajes ADD COLUMN idempotency_key text;

-- Unique solo cuando key presente Y direction = out.
-- Inbound y outbound sin key (legacy/manual) NO compiten.
CREATE UNIQUE INDEX uq_mensajes_outbound_idempotency
  ON mensajes (idempotency_key)
  WHERE direction = 'out'::direction_enum AND idempotency_key IS NOT NULL;

COMMENT ON COLUMN mensajes.idempotency_key IS
  'Dedup key for outbound retries. Format: out:<inbound_meta_message_id>.';
