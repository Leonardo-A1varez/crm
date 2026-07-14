-- Slice 3 — RLS policies por rol (matriz docs/data-model.md, spec 2026-07-14).
-- Fail-closed: usuario authenticated SIN app_metadata.rol no matchea ninguna policy.
-- Tablas infra (event_outbox, reactivation_dispatches, rule_executions) quedan
-- deny-all para authenticated: solo service-role (bypassa RLS) las toca.
-- Predicados envueltos en (select ...) para initplan caching (advisor-friendly).

-- ===== helpers: grants (idempotente; asegura RPC disponible para authed) =====
grant execute on function public.server_now() to authenticated;

-- ===== empresas: R ambos / W admin =====
create policy empresas_select on public.empresas
  for select to authenticated
  using ((select public.is_admin()) or (select public.is_vendedor()));
create policy empresas_insert_admin on public.empresas
  for insert to authenticated
  with check ((select public.is_admin()));
create policy empresas_update_admin on public.empresas
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- ===== leads: RW ambos =====
create policy leads_select on public.leads
  for select to authenticated
  using ((select public.is_admin()) or (select public.is_vendedor()));
create policy leads_insert on public.leads
  for insert to authenticated
  with check ((select public.is_admin()) or (select public.is_vendedor()));
create policy leads_update on public.leads
  for update to authenticated
  using ((select public.is_admin()) or (select public.is_vendedor()))
  with check ((select public.is_admin()) or (select public.is_vendedor()));

-- ===== lead_session: RW ambos =====
create policy lead_session_select on public.lead_session
  for select to authenticated
  using ((select public.is_admin()) or (select public.is_vendedor()));
create policy lead_session_insert on public.lead_session
  for insert to authenticated
  with check ((select public.is_admin()) or (select public.is_vendedor()));
create policy lead_session_update on public.lead_session
  for update to authenticated
  using ((select public.is_admin()) or (select public.is_vendedor()))
  with check ((select public.is_admin()) or (select public.is_vendedor()));

-- ===== conversaciones: RW ambos =====
create policy conversaciones_select on public.conversaciones
  for select to authenticated
  using ((select public.is_admin()) or (select public.is_vendedor()));
create policy conversaciones_insert on public.conversaciones
  for insert to authenticated
  with check ((select public.is_admin()) or (select public.is_vendedor()));
create policy conversaciones_update on public.conversaciones
  for update to authenticated
  using ((select public.is_admin()) or (select public.is_vendedor()))
  with check ((select public.is_admin()) or (select public.is_vendedor()));

-- ===== mensajes: RW ambos =====
create policy mensajes_select on public.mensajes
  for select to authenticated
  using ((select public.is_admin()) or (select public.is_vendedor()));
create policy mensajes_insert on public.mensajes
  for insert to authenticated
  with check ((select public.is_admin()) or (select public.is_vendedor()));
create policy mensajes_update on public.mensajes
  for update to authenticated
  using ((select public.is_admin()) or (select public.is_vendedor()))
  with check ((select public.is_admin()) or (select public.is_vendedor()));

-- ===== productos: R ambos / W admin =====
create policy productos_select on public.productos
  for select to authenticated
  using ((select public.is_admin()) or (select public.is_vendedor()));
create policy productos_insert_admin on public.productos
  for insert to authenticated
  with check ((select public.is_admin()));
create policy productos_update_admin on public.productos
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- ===== intents: R ambos / W admin =====
create policy intents_select on public.intents
  for select to authenticated
  using ((select public.is_admin()) or (select public.is_vendedor()));
create policy intents_insert_admin on public.intents
  for insert to authenticated
  with check ((select public.is_admin()));
create policy intents_update_admin on public.intents
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- ===== reglas: R ambos / W admin =====
create policy reglas_select on public.reglas
  for select to authenticated
  using ((select public.is_admin()) or (select public.is_vendedor()));
create policy reglas_insert_admin on public.reglas
  for insert to authenticated
  with check ((select public.is_admin()));
create policy reglas_update_admin on public.reglas
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- ===== tags: R ambos / W admin =====
create policy tags_select on public.tags
  for select to authenticated
  using ((select public.is_admin()) or (select public.is_vendedor()));
create policy tags_insert_admin on public.tags
  for insert to authenticated
  with check ((select public.is_admin()));
create policy tags_update_admin on public.tags
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- ===== lead_tags: RW ambos (sin DELETE hasta que exista flujo en panel) =====
create policy lead_tags_select on public.lead_tags
  for select to authenticated
  using ((select public.is_admin()) or (select public.is_vendedor()));
create policy lead_tags_insert on public.lead_tags
  for insert to authenticated
  with check ((select public.is_admin()) or (select public.is_vendedor()));
create policy lead_tags_update on public.lead_tags
  for update to authenticated
  using ((select public.is_admin()) or (select public.is_vendedor()))
  with check ((select public.is_admin()) or (select public.is_vendedor()));

-- ===== usuarios: R ambos (W = dashboard Supabase, sin policy) =====
create policy usuarios_select on public.usuarios
  for select to authenticated
  using ((select public.is_admin()) or (select public.is_vendedor()));

-- ===== tool_executions: R ambos =====
create policy tool_executions_select on public.tool_executions
  for select to authenticated
  using ((select public.is_admin()) or (select public.is_vendedor()));

-- ===== admin_actions: R solo admin =====
create policy admin_actions_select_admin on public.admin_actions
  for select to authenticated
  using ((select public.is_admin()));

-- ===== merge_candidates: R ambos / W admin =====
create policy merge_candidates_select on public.merge_candidates
  for select to authenticated
  using ((select public.is_admin()) or (select public.is_vendedor()));
create policy merge_candidates_insert_admin on public.merge_candidates
  for insert to authenticated
  with check ((select public.is_admin()));
create policy merge_candidates_update_admin on public.merge_candidates
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- ===== storage.objects: por bucket =====
-- comprobantes_pago: R + upsert vendedor/admin (upsert = INSERT+SELECT+UPDATE).
create policy storage_comprobantes_select on storage.objects
  for select to authenticated
  using (bucket_id = 'comprobantes_pago'
    and ((select public.is_admin()) or (select public.is_vendedor())));
create policy storage_comprobantes_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'comprobantes_pago'
    and ((select public.is_admin()) or (select public.is_vendedor())));
create policy storage_comprobantes_update on storage.objects
  for update to authenticated
  using (bucket_id = 'comprobantes_pago'
    and ((select public.is_admin()) or (select public.is_vendedor())))
  with check (bucket_id = 'comprobantes_pago'
    and ((select public.is_admin()) or (select public.is_vendedor())));

-- productos: R ambos / W admin.
create policy storage_productos_select on storage.objects
  for select to authenticated
  using (bucket_id = 'productos'
    and ((select public.is_admin()) or (select public.is_vendedor())));
create policy storage_productos_insert_admin on storage.objects
  for insert to authenticated
  with check (bucket_id = 'productos' and (select public.is_admin()));
create policy storage_productos_update_admin on storage.objects
  for update to authenticated
  using (bucket_id = 'productos' and (select public.is_admin()))
  with check (bucket_id = 'productos' and (select public.is_admin()));

-- mensajes_media: R ambos (INSERT lo hace service-role vía webhook pipeline).
create policy storage_mensajes_media_select on storage.objects
  for select to authenticated
  using (bucket_id = 'mensajes_media'
    and ((select public.is_admin()) or (select public.is_vendedor())));
