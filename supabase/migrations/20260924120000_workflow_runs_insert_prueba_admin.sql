-- "Probar" desde el editor escribía contra una pared: un admin autenticado no
-- podía crear la corrida ni sus pasos. `workflow_runs` y `workflow_run_pasos`
-- nacieron (20260822044955) con policies de SELECT y, en corridas, de UPDATE
-- admin; ninguna de INSERT, porque las escribe el motor con service-role.
-- "Probar" corre en una Server Action con el client de la sesión (el panel es
-- 100% authed, docs/security-threat-model.md), así que `arrancar_workflow_run`
-- —SECURITY INVOKER— rebotaba con 42501 "new row violates row-level security
-- policy for table workflow_runs". En crm-dev no hay una sola corrida con
-- `$prueba`: el botón nunca funcionó.
--
-- Por qué policies y no service-role: el panel no usa service-role nunca (zona
-- de ESLint + threat model: "panel 100% authed client per-request"). Y por qué
-- no una función SECURITY DEFINER como `relanzar_workflow_run`: la prueba
-- escribe paso a paso —la pantalla la sigue por Realtime— y terminarla o
-- fallarla ya pasa por `workflow_runs_update_admin`; lo único que falta es el
-- INSERT, y RLS lo expresa acotado sin abrir otra función con privilegios.
--
-- Nota: el comentario de `relanzar_workflow_run` (20260913232100) dice que
-- authenticated "no tiene INSERT sobre workflow_runs ni EXECUTE sobre
-- arrancar_workflow_run". Los grants sí los tiene (20260816042039 otorga todo
-- a authenticated, y así está crm-dev); lo que lo frena es RLS. Por eso estas
-- policies son la barrera entera y van tan acotadas:
--
--  - sólo admin;
--  - sólo corridas con `$prueba: true` en el contexto —las que
--    `reanudar_workflow_run` y `relanzar_workflow_run` se niegan a continuar
--    con el motor de producción—; una corrida de producción no se puede crear
--    desde la API REST;
--  - la corrida nace `corriendo`, como la crea `arrancar_workflow_run`;
--  - un paso sólo entra en una corrida de prueba que sigue viva: no se le
--    agrega historia a una corrida de producción ni a una prueba cerrada.

create policy workflow_runs_insert_prueba_admin on public.workflow_runs
  for insert to authenticated
  with check (
    (select public.is_admin())
    and contexto @> '{"$prueba": true}'::jsonb
    and estado = 'corriendo'
  );

create policy workflow_run_pasos_insert_prueba_admin on public.workflow_run_pasos
  for insert to authenticated
  with check (
    (select public.is_admin())
    and exists (
      select 1
        from public.workflow_runs as r
       where r.id = run_id
         and r.contexto @> '{"$prueba": true}'::jsonb
         and r.estado in ('corriendo', 'esperando')
    )
  );

comment on policy workflow_runs_insert_prueba_admin on public.workflow_runs is
  'Probar desde el editor: un admin crea sólo corridas de prueba ($prueba en el contexto), que nacen corriendo. Las de producción las crea el motor con service-role.';

comment on policy workflow_run_pasos_insert_prueba_admin on public.workflow_run_pasos is
  'Probar desde el editor: un admin agrega pasos sólo a una corrida de prueba viva.';
