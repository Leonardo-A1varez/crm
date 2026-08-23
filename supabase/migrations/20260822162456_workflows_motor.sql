-- W2: lo que el motor necesita en la base. Tres cosas y ninguna mas.

create type workflow_concurrencia as enum ('ignorar','reiniciar','permitir');

-- Vive en la VERSION y no en el workflow: es comportamiento, no preferencia.
-- Cambiarlo genera version nueva, igual que max_pasos.
alter table public.workflow_versiones
  add column politica_concurrencia workflow_concurrencia not null default 'ignorar';

-- Capa 3. Vive en agente_config porque esa tabla ya ES la politica de la
-- organizacion, versionada y auditada (tope_gasto_diario_usd, horario).
alter table public.agente_config
  add column max_salientes_automaticos_24h integer not null default 3;
alter table public.agente_config
  add constraint agente_config_max_salientes_rango
  check (max_salientes_automaticos_24h between 1 and 20);

-- Consultar "hay corrida viva?" y despues insertar es una carrera: dos
-- disparos simultaneos ven cero y crean dos corridas, que con salientes
-- habilitados es el doble de mensajes. El advisory lock serializa por
-- (workflow, lead) y hace que decision e insert sean una sola cosa.
create or replace function public.arrancar_workflow_run(
  p_version_id uuid,
  p_lead_id    uuid,
  p_session_id uuid,
  p_contexto   jsonb
)
returns table (run_id uuid, error_code text)
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_workflow_id uuid;
  v_politica    public.workflow_concurrencia;
  v_viva        uuid;
begin
  select wv.workflow_id, wv.politica_concurrencia
    into v_workflow_id, v_politica
    from public.workflow_versiones as wv
   where wv.id = p_version_id;

  if not found then
    return query select null::uuid, 'version_not_found'::text;
    return;
  end if;

  -- hashtextextended da un bigint estable; el lock se suelta al commit.
  perform pg_advisory_xact_lock(
    hashtextextended(v_workflow_id::text || ':' || p_lead_id::text, 0)
  );

  select r.id into v_viva
    from public.workflow_runs as r
    join public.workflow_versiones as v on v.id = r.workflow_version_id
   where v.workflow_id = v_workflow_id
     and r.lead_id = p_lead_id
     and r.estado in ('corriendo','esperando')
   limit 1;

  if v_viva is not null then
    if v_politica = 'ignorar' then
      return query select null::uuid, 'ya_hay_corrida_viva'::text;
      return;
    elsif v_politica = 'reiniciar' then
      update public.workflow_runs
         set estado = 'cancelado',
             ended_at = now(),
             error = 'reiniciado por un disparo nuevo'
       where id = v_viva;
    end if;
  end if;

  return query
  insert into public.workflow_runs (workflow_version_id, lead_id, lead_session_id, contexto)
  values (p_version_id, p_lead_id, p_session_id, coalesce(p_contexto, '{}'::jsonb))
  returning public.workflow_runs.id, null::text;
end;
$function$;

revoke all on function public.arrancar_workflow_run(uuid, uuid, uuid, jsonb) from public, anon;
grant execute on function public.arrancar_workflow_run(uuid, uuid, uuid, jsonb) to service_role;

comment on function public.arrancar_workflow_run(uuid, uuid, uuid, jsonb) is
  'Arranca una corrida aplicando la politica de concurrencia de la version, con advisory lock por (workflow, lead) para que decision e insert sean atomicos.';
