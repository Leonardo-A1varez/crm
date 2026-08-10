-- lead_tags: policy DELETE.
--
-- La migración de RLS de Slice 3 dejó lead_tags con SELECT/INSERT/UPDATE y
-- anotó "sin DELETE hasta que exista flujo en panel". El flujo existe: la
-- sección de etiquetas del Lead Twin tiene una × por chip. Sin esta policy el
-- DELETE no falla, borra cero filas — la UI diría "listo" sobre un no-op.
--
-- Alcance igual al del INSERT que ya está: admin y vendedor. Sacarle una
-- etiqueta a un lead es parte de atenderlo, no administración del catálogo;
-- borrar la etiqueta en sí sigue siendo del admin (tags no tiene policy DELETE).

drop policy if exists lead_tags_delete on public.lead_tags;

create policy lead_tags_delete on public.lead_tags
  for delete to authenticated
  using ((select public.is_admin()) or (select public.is_vendedor()));
