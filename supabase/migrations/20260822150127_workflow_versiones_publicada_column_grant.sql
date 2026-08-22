-- Workflows W1, fix de review: `workflow_versiones` es append-only por
-- diseño -- el comentario de la migración original (20260822044955) dice
-- que la policy de UPDATE "existe sólo para permitir despublicar", pero el
-- grant real de esa migración es sobre la tabla entera. RLS no puede acotar
-- columnas, así que un admin (o un bug futuro que arme el UPDATE mal) puede
-- reescribir `grafo` de una versión que un `workflow_run` ya está corriendo,
-- y ese run asume que su grafo nunca cambia debajo suyo. Esa migración ya
-- está aplicada y en el ledger remoto: no se edita, se corrige acá.
--
-- Column-scoped GRANT/REVOKE en vez de un trigger `before update`: el patrón
-- ya establecido en este repo para toda tabla nueva es exactamente
-- `revoke all ... grant select, insert, update on ... to authenticated`
-- (ver 20260822044955, 20260808213309, y el resto de las migraciones desde
-- slice 3). Ningún trigger de este proyecto rechaza un UPDATE por invariante
-- de negocio -- los que existen (`bump_updated_at`, `handle_new_auth_user`)
-- rellenan una columna, no bloquean la escritura. Extender el GRANT/REVOKE
-- que ya se usa en todos lados a nivel de columna es el cambio de menor
-- superficie y el que sigue el idioma real del proyecto, en vez de
-- introducir un mecanismo nuevo para un solo caso.

revoke update on table public.workflow_versiones from authenticated;
grant update (publicada) on table public.workflow_versiones to authenticated;

comment on table public.workflow_versiones is
  'Definicion versionada de un workflow, append-only. `publicada` es la UNICA columna que un admin autenticado puede modificar despues del INSERT (grant column-scoped) -- grafo/version/workflow_id/max_pasos/created_by/created_at son inmutables una vez escritos, porque un workflow_run les asume estables.';
