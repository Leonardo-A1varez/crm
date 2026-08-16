-- `revert_lead_merge` no podía funcionar. Nunca.
--
-- La función arranca bloqueando la fila de auditoría que va a deshacer:
--
--   select a.* into v_accion from public.admin_actions as a
--    where a.id = p_merge_action_id
--    for update;
--
-- Bajo RLS, un `SELECT ... FOR UPDATE` no alcanza con la policy de SELECT:
-- Postgres exige además una de UPDATE sobre esa tabla, porque bloquear una fila
-- es adquirir el derecho a modificarla. `admin_actions` tiene policies de SELECT
-- y de INSERT y **ninguna de UPDATE**, a propósito: es una bitácora append-only
-- y darle UPDATE destruiría esa garantía.
--
-- Resultado: la fila existe y se lee perfecto desde la app —`listByLeadId` la
-- devuelve— pero el `for update` de adentro de la función no encuentra nada
-- bloqueable, cae en `not found` y la función contesta `action_not_found`. La
-- pantalla decía "esa fusión ya no existe" sobre una fusión que estaba ahí.
--
-- Se descubrió al escribir su primer test: la función está en la base desde el
-- 2026-08-14 y nunca se había ejecutado ni una vez.
--
-- Arreglo: `SECURITY DEFINER`. La función ya hace su propia autorización en la
-- primera sentencia —`if not coalesce(public.is_admin(), false) then raise`— y
-- ya tiene `search_path` fijado en vacío, que son las dos condiciones para que
-- definir privilegios acá sea seguro. Es el patrón estándar de Supabase para
-- un RPC que necesita saltear RLS haciendo su propio control de acceso.
--
-- Se prefiere esto antes que agregarle una policy de UPDATE a `admin_actions`:
-- eso abriría la bitácora a modificaciones para arreglar un bloqueo interno de
-- una sola función.
--
-- `approve_lead_merge` sigue siendo INVOKER y no hace falta tocarla: su único
-- `for update` es sobre `leads`, que sí tiene policy de UPDATE para admin.

alter function public.revert_lead_merge(uuid) security definer;

comment on function public.revert_lead_merge(uuid) is
  'Deshace una fusion aprobada. SECURITY DEFINER porque bloquea la fila de admin_actions, que no tiene policy de UPDATE por ser append-only; autoriza por su cuenta con is_admin() en la primera sentencia.';
