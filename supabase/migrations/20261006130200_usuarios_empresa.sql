-- A qué empresa del ERP pertenece cada usuario, para destacar su precio.
--
-- Empresas del ERP: 1 Matriz, 3 Magdalena, 5 El Genuino Repuestos Koreanos SAS,
-- 6 El Genuino Repuestos SAS. NULL = sin asignar (la pantalla muestra los cuatro
-- precios sin destacar ninguno).
--
-- Quién la fija: el admin. Hasta acá `usuarios` no tenía ninguna policy de UPDATE
-- (verificado en el stack local el 2026-10-06: solo `usuarios_select`), así que
-- ningún usuario autenticado podía cambiar nada. Se agrega una policy de UPDATE
-- para admin y se limita por columna: `authenticated` pierde el UPDATE de tabla
-- (que la RLS ya dejaba sin efecto) y recibe UPDATE solo sobre `empresa_erp`. Así
-- abrir esta columna no abre `rol`, `email` ni `activo`.

alter table public.usuarios
  add column if not exists empresa_erp smallint;

alter table public.usuarios
  drop constraint if exists usuarios_empresa_erp_check;
alter table public.usuarios
  add constraint usuarios_empresa_erp_check check (empresa_erp in (1, 3, 5, 6));

comment on column public.usuarios.empresa_erp is
  'Empresa del ERP del usuario: 1 Matriz, 3 Magdalena, 5 Koreanos SAS, 6 SAS Repuestos. NULL = sin asignar.';

revoke update on public.usuarios from anon, authenticated;
grant update (empresa_erp) on public.usuarios to authenticated;

drop policy if exists usuarios_update_admin on public.usuarios;
create policy usuarios_update_admin on public.usuarios
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));
