-- Topes de seguridad del motor de workflows (PRD workflows §6.6).
--
-- Cuando un tope salta un mensaje —tope de frecuencia, lead dado de baja,
-- ventana de 24 h de Meta cerrada, lead en "requiere humano"— el lead sale del
-- flujo y la corrida TERMINA (no falla) con ese motivo. Cada mensaje saltado
-- deja un registro auditable: el paso de la corrida, con su motivo.
--
-- De dónde sale el motivo: el motor lo escribe en `workflow_run_pasos.salida`
-- (clave `motivo_salto`, `CLAVE_MOTIVO_SALTO` en `src/types/workflows.ts`),
-- que es lo único del paso que persiste quien corre el segmento. La base lo
-- saca de ahí a una columna generada —así se cuenta e indexa sin leer jsonb— y
-- un trigger lo copia a la corrida, para que el historial la muestre como
-- "saltada" sin tener que leer sus pasos.
--
-- `conversacion_activa` está en la lista porque el PRD la nombra, pero hoy
-- ninguna acción la produce: el PRD no define qué es una conversación activa
-- para un flujo.

-- =========================================================================
-- El paso: motivo generado desde la salida
-- =========================================================================

alter table public.workflow_run_pasos
  add column motivo_salto text
    generated always as (salida ->> 'motivo_salto') stored;

alter table public.workflow_run_pasos
  add constraint workflow_run_pasos_motivo_salto_valido check (
    motivo_salto is null or motivo_salto in (
      'tope_frecuencia', 'dado_de_baja', 'sin_ventana', 'conversacion_activa', 'requiere_humano'
    )
  );

-- Un paso saltado es una decisión, no un error: los dos a la vez es un paso
-- que se contradice.
alter table public.workflow_run_pasos
  add constraint workflow_run_pasos_salto_sin_error check (
    motivo_salto is null or error is null
  );

comment on column public.workflow_run_pasos.motivo_salto is
  'Por que un tope de seguridad salto este paso (PRD 6.6). Generada desde salida->>motivo_salto. NULL = no salto.';

-- Para el conteo de los últimos 7 días de Ajustes: sólo los pasos saltados,
-- que son una fracción mínima de la tabla.
create index workflow_run_pasos_saltos
  on public.workflow_run_pasos (created_at)
  where motivo_salto is not null;

-- =========================================================================
-- La corrida: motivo copiado desde el paso
-- =========================================================================

alter table public.workflow_runs
  add column motivo_salto text;

alter table public.workflow_runs
  add constraint workflow_runs_motivo_salto_valido check (
    motivo_salto is null or motivo_salto in (
      'tope_frecuencia', 'dado_de_baja', 'sin_ventana', 'conversacion_activa', 'requiere_humano'
    )
  );

-- Sin CHECK que ate `motivo_salto` a `estado = 'terminado'`, a propósito: entre
-- que el paso se registra y el segmento cierra la corrida, ésta sigue viva, y
-- ahí la puede cancelar un disparo nuevo (política `reiniciar`) o marcar
-- fallada el `onFailure` de Inngest si `terminar` no llegó a escribirse. Un
-- CHECK haría fallar esas dos escrituras legítimas y dejaría la corrida viva
-- para siempre. Que un salto no se muestre como fallo lo decide la app.

comment on column public.workflow_runs.motivo_salto is
  'Por que termino antes de tiempo: un tope de seguridad salto un mensaje y el lead salio del flujo (PRD 6.6). Lo escribe el trigger workflow_run_pasos_marca_salto. NULL = no salto.';

create function public.workflow_run_pasos_marca_salto()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  update public.workflow_runs
     set motivo_salto = new.motivo_salto
   where id = new.run_id;
  return null;
end;
$function$;

revoke all on function public.workflow_run_pasos_marca_salto() from public, anon, authenticated;

comment on function public.workflow_run_pasos_marca_salto() is
  'Copia el motivo de un paso saltado a su corrida. Corre con el rol que inserta el paso (el motor, service-role).';

create trigger workflow_run_pasos_marca_salto
  after insert on public.workflow_run_pasos
  for each row
  when (new.motivo_salto is not null)
  execute function public.workflow_run_pasos_marca_salto();

-- =========================================================================
-- Conteo por motivo, en la base
-- =========================================================================
-- Contar en JS chocaría con el corte de 1.000 filas de PostgREST. Excluye las
-- corridas de "Probar" (`$prueba`): no se le iba a mandar nada a nadie.

create function public.contar_saltos_workflow(p_desde timestamptz)
returns table (
  motivo   text,
  cantidad bigint
)
language sql
stable
security invoker
set search_path = ''
as $function$
  select p.motivo_salto, count(*)
    from public.workflow_run_pasos as p
    join public.workflow_runs as r on r.id = p.run_id
   where p.motivo_salto is not null
     and p.created_at >= p_desde
     and not (r.contexto @> '{"$prueba": true}'::jsonb)
   group by p.motivo_salto;
$function$;

revoke all on function public.contar_saltos_workflow(timestamptz) from public, anon;
grant execute on function public.contar_saltos_workflow(timestamptz) to authenticated, service_role;

comment on function public.contar_saltos_workflow(timestamptz) is
  'Mensajes saltados por un tope de seguridad desde p_desde, por motivo. Sin corridas de Probar. SECURITY INVOKER: cuenta lo que el rol que llama puede ver.';
