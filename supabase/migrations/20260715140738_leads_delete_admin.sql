-- Merge de leads (fase 10): el executor borra el lead perdedor post-reasignación.
-- DELETE solo admin — vendedor no puede fusionar (backstop del gate de UI/action).
create policy leads_delete_admin on public.leads
  for delete to authenticated
  using ((select public.is_admin()));
