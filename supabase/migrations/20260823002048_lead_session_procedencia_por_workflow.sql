-- Task 8 fix round 1 -- un nodo de workflow tambien puede fijar
-- lead_session.current_stage, y la procedencia tiene que decir la verdad
-- sobre quien lo hizo: no puede seguir mintiendo "humano" ni caer afuera
-- del CHECK.
--
-- El CHECK anterior (20260810150000) solo dejaba pasar "ia"|"humano" en
-- `procedencia.*.por`. Sin este cambio, la primera vez que `cambiar_etapa`
-- (src/server/services/workflows/acciones/internas.ts) escriba
-- `por: "workflow"` en Postgres real, el UPDATE se cae con una violacion de
-- CHECK -- el tipo de TypeScript ya lo permite, la base todavia no.

alter table public.lead_session
  drop constraint lead_session_procedencia_por_valido;

alter table public.lead_session
  add constraint lead_session_procedencia_por_valido
  check (
    not jsonb_path_exists(
      procedencia,
      '$.* ? (!exists(@.por) || (@.por != "ia" && @.por != "humano" && @.por != "workflow"))'
    )
  );

comment on constraint lead_session_procedencia_por_valido on public.lead_session is
  'por es el discriminador de la UI: ia | humano | workflow. Ver ProcedenciaPor en src/types/entities.ts.';
