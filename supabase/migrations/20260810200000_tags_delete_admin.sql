-- Pantalla /tags (fase 12): el admin puede dar de baja una etiqueta.
-- Hasta acá `tags` tenía policies SELECT/INSERT/UPDATE pero ninguna de DELETE,
-- así que el borrado no fallaba: afectaba 0 filas en silencio.
-- DELETE solo admin — el vendedor tiene lectura sobre tags (§3 RLS del AGENTS.md).
--
-- `lead_tags` no necesita policy propia: el CASCADE de la FK lo ejecuta el
-- motor con los permisos del dueño de la tabla y no pasa por RLS.
create policy tags_delete_admin on public.tags
  for delete to authenticated
  using ((select public.is_admin()));
