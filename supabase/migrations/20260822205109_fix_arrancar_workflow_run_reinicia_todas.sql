-- W2 fix de review: `reiniciar` cancelaba solo la corrida que el `limit 1`
-- del chequeo de existencia encontraba, pero ese chequeo hace join contra
-- TODAS las versiones del workflow (via workflow_id), no solo la version que
-- dispara. Una version publicada en su momento con `politica_concurrencia =
-- 'permitir'` puede haber dejado, legitimamente, varias corridas vivas para
-- el mismo lead. Si despues se publica una version `reiniciar`, el `limit 1`
-- cancelaba una sola y dejaba el resto vivas: exactamente lo que la politica
-- promete evitar ("a lo sumo una"), y con salientes automaticos habilitados
-- eso es WhatsApp duplicado a un cliente real.
--
-- El chequeo de existencia se deja como esta -- solo necesita saber si hay
-- ALGUNA corrida viva, `limit 1` alcanza. Lo que se vuelve set-based es el
-- UPDATE de `reiniciar`: cancela todas las corridas vivas de ese
-- (workflow_id, lead_id), con el mismo join y el mismo filtro de estado que
-- ya usa el chequeo.
--
-- La migracion `20260822162456_workflows_motor.sql` ya esta aplicada y en el
-- ledger remoto -- no se edita. La funcion se repite completa porque
-- `create or replace function` reemplaza el cuerpo entero; mismo patron que
-- `20260813172558_fix_approve_lead_merge_lint.sql`.

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
      -- Set-based: cancela TODAS las corridas vivas de este (workflow, lead),
      -- no solo la que encontro el `limit 1` de arriba. Mismo join y mismo
      -- filtro de estado que el chequeo de existencia.
      update public.workflow_runs as r
         set estado = 'cancelado',
             ended_at = now(),
             error = 'reiniciado por un disparo nuevo'
        from public.workflow_versiones as v
       where v.id = r.workflow_version_id
         and v.workflow_id = v_workflow_id
         and r.lead_id = p_lead_id
         and r.estado in ('corriendo','esperando');
    end if;
  end if;

  return query
  insert into public.workflow_runs (workflow_version_id, lead_id, lead_session_id, contexto)
  values (p_version_id, p_lead_id, p_session_id, coalesce(p_contexto, '{}'::jsonb))
  returning public.workflow_runs.id, null::text;
end;
$function$;

comment on function public.arrancar_workflow_run(uuid, uuid, uuid, jsonb) is
  'Arranca una corrida aplicando la politica de concurrencia de la version, con advisory lock por (workflow, lead) para que decision e insert sean atomicos. reiniciar cancela TODAS las corridas vivas del workflow para ese lead, no solo una.';
