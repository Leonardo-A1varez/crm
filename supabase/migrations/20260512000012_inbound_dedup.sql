-- 0012_inbound_dedup.sql
-- Atomic dedup de mensajes entrantes via UNIQUE partial sobre meta_message_id.
-- Resuelve TODO docs/idempotency.md §Inbound webhook → recordInbound.
--
-- Problema: 2 webhooks paralelos de Meta con mismo meta_message_id (red flaky,
-- dispatch retry) → 2 invocaciones recordInbound → ambos findByMetaMessageId
-- retornan null → ambos call create → 2 rows duplicadas.
--
-- Mitigación: índice UNIQUE partial WHERE meta_message_id IS NOT NULL. Segundo
-- insert lanza unique_violation (23505) → mapPostgrestError → ConflictError →
-- Inngest retry → ahora findByMetaMessageId retorna existing → return existing.
--
-- Meta garantiza meta_message_id globalmente único (cross-direction y cross-
-- canal), por lo que el partial sin filtro de direction es seguro y simple.
--
-- Nota: Reemplaza el índice non-unique `mensajes_meta_id_idx` creado en 0003
-- (mismo predicado). Postgres usa el UNIQUE para lookups equality igual,
-- evitando índice duplicado.

DROP INDEX IF EXISTS public.mensajes_meta_id_idx;

CREATE UNIQUE INDEX uq_mensajes_meta_message_id
  ON public.mensajes (meta_message_id)
  WHERE meta_message_id IS NOT NULL;

COMMENT ON INDEX public.uq_mensajes_meta_message_id IS
  'Idempotency end-to-end inbound. Bloquea inserts duplicados desde retries Meta o Inngest. Lookups equality usan este índice (reemplaza mensajes_meta_id_idx).';
