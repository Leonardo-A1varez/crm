-- Fase 10 merge: el executor registra audit (lead.merge) con el client authed
-- del request — sin policy INSERT el paso audit-first falla 42501 y el merge
-- aborta. INSERT solo admin (las acciones auditadas son admin-only hoy;
-- ampliar si una fase futura audita acciones de vendedor).
create policy admin_actions_insert_admin on public.admin_actions
  for insert to authenticated
  with check ((select public.is_admin()));
