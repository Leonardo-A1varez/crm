-- Versionado de workflows con nota. Es lo que necesita la pantalla "Publicar
-- la versión N" (DiffPublicacion) y las dos acciones de versión que existían
-- sin llamador: crear una versión desde otra y restaurar una vieja.
--
-- Todo aditivo. Nada de acá toca `workflow_runs`: publicar sigue sin mover ni
-- romper las corridas en curso, que terminan en la versión con la que
-- arrancaron -- `workflow_runs.workflow_version_id` no cambia nunca y el motor
-- lee siempre esa versión, no la publicada (`workflow-segmento.ts`).

-- =========================================================================
-- 1. La nota de la versión
-- =========================================================================
-- Prosa para humanos: por qué se hizo el cambio. El motor no la lee nunca, y
-- por eso es la única columna, además de `publicada`, que un admin puede
-- modificar después del INSERT (grant por columna, mismo mecanismo que
-- 20260822150127). grafo, max_pasos y el resto siguen inmutables: una corrida
-- los da por fijos.

alter table public.workflow_versiones add column nota text;

alter table public.workflow_versiones
  add constraint workflow_versiones_nota_largo
  check (nota is null or char_length(nota) between 1 and 500);

grant update (nota) on table public.workflow_versiones to authenticated;

comment on column public.workflow_versiones.nota is
  'Por que existe esta version, en prosa. Se escribe al publicar o al restaurar. El motor no la lee.';

comment on table public.workflow_versiones is
  'Definicion versionada de un workflow, append-only. `publicada` y `nota` son las UNICAS columnas que un admin autenticado puede modificar despues del INSERT (grant column-scoped); grafo/version/workflow_id/max_pasos/politica_concurrencia/created_by/created_at son inmutables una vez escritos, porque un workflow_run les asume estables.';

-- =========================================================================
-- 2. Publicar con nota
-- =========================================================================
-- Expand/contract. `publicar_workflow_version(uuid)` queda exactamente como
-- está -- firma, cuerpo, grants y comentario de 20260822151229 --: la app ya
-- desplegada la llama, y esta migración se aplica antes de desplegar el código
-- nuevo. La que guarda la nota es otra función, con otro nombre, y el código
-- nuevo llama sólo a ésta.
--
-- Otro nombre y no otra firma con el mismo nombre: con dos
-- `publicar_workflow_version` una llamada con sólo `p_version_id` calzaría en
-- la de un argumento y en la de dos con default, y PostgREST no elige entre
-- dos candidatas.
--
-- CONTRACT PENDIENTE: `drop function public.publicar_workflow_version(uuid)`
-- va en una migración posterior, después del próximo deploy, cuando ya no
-- quede ninguna instancia desplegada que la llame. No antes.
--
-- El cuerpo es el de 20260822151229 más la nota: los mismos locks en el mismo
-- orden (todas las versiones del workflow, por id), así que la vieja y la
-- nueva pueden correr a la vez sin trabarse entre sí. Sin nota, o con una en
-- blanco, la que ya tuviera la versión no se toca.

create function public.publicar_workflow_version_con_nota(
  p_version_id uuid,
  p_nota       text default null
)
returns table (
  version_id uuid,
  error_code text
)
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_workflow_id uuid;
begin
  if not coalesce(public.is_admin(), false) then
    raise exception 'solo un admin puede publicar una version de workflow' using errcode = '42501';
  end if;

  select wv.workflow_id
    into v_workflow_id
    from public.workflow_versiones as wv
   where wv.id = p_version_id;

  if not found then
    return query select null::uuid, 'version_not_found'::text;
    return;
  end if;

  perform wv.id
    from public.workflow_versiones as wv
   where wv.workflow_id = v_workflow_id
   order by wv.id
     for update;

  update public.workflow_versiones
     set publicada = false
   where workflow_id = v_workflow_id
     and publicada = true;

  -- Una nota en blanco no pisa la que hubiera: nullif + coalesce.
  update public.workflow_versiones
     set publicada = true,
         nota = coalesce(nullif(btrim(p_nota), ''), nota)
   where id = p_version_id;

  return query select p_version_id, null::text;
end;
$function$;

revoke all on function public.publicar_workflow_version_con_nota(uuid, text) from public, anon;
grant execute on function public.publicar_workflow_version_con_nota(uuid, text) to authenticated, service_role;

comment on function public.publicar_workflow_version_con_nota(uuid, text) is
  'Publica una version de workflow y despublica la que estuviera publicada, en una sola transaccion y con locks en orden de id. Con p_nota escribe la nota de la version. No toca workflow_runs: las corridas en curso terminan en su version. Reemplaza a publicar_workflow_version(uuid), que se conserva hasta que no quede codigo desplegado que la llame.';

-- =========================================================================
-- 3. Clonar una versión: borrador nuevo, o restauración publicada
-- =========================================================================
-- "Crear versión desde" y "restaurar una versión vieja" son la misma
-- operación: copiar el grafo a una versión NUEVA -- número nuevo, fila nueva --
-- y, al restaurar, publicarla. Nunca revive la fila vieja: una versión
-- restaurada es otra versión, con su propia nota.
--
-- Una sola transacción: el número de versión se calcula con las versiones del
-- workflow bloqueadas (mismo lock y mismo orden que publicar), así que dos
-- clonaciones simultáneas no pueden tomar el mismo número, y una restauración
-- nunca deja una versión creada sin publicar si la publicación falla.
--
-- Copia también `politica_concurrencia`: restaurar tiene que devolver el
-- comportamiento completo de la versión, no sólo su grafo.

create function public.clonar_workflow_version(
  p_version_id uuid,
  p_publicar   boolean,
  p_nota       text default null,
  p_created_by uuid default null
)
returns table (
  version_id uuid,
  error_code text
)
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_origen public.workflow_versiones%rowtype;
  v_numero integer;
  v_nueva  uuid;
begin
  if not coalesce(public.is_admin(), false) then
    raise exception 'solo un admin puede crear versiones de workflow' using errcode = '42501';
  end if;

  select wv.* into v_origen
    from public.workflow_versiones as wv
   where wv.id = p_version_id;

  if not found then
    return query select null::uuid, 'version_not_found'::text;
    return;
  end if;

  perform wv.id
    from public.workflow_versiones as wv
   where wv.workflow_id = v_origen.workflow_id
   order by wv.id
     for update;

  select coalesce(max(wv.version), 0) + 1
    into v_numero
    from public.workflow_versiones as wv
   where wv.workflow_id = v_origen.workflow_id;

  insert into public.workflow_versiones
    (workflow_id, version, grafo, max_pasos, politica_concurrencia, publicada, created_by, nota)
  values
    (v_origen.workflow_id, v_numero, v_origen.grafo, v_origen.max_pasos,
     v_origen.politica_concurrencia, false, p_created_by, nullif(btrim(p_nota), ''))
  returning id into v_nueva;

  if p_publicar then
    update public.workflow_versiones
       set publicada = false
     where workflow_id = v_origen.workflow_id
       and publicada = true;

    update public.workflow_versiones
       set publicada = true
     where id = v_nueva;
  end if;

  return query select v_nueva, null::text;
end;
$function$;

revoke all on function public.clonar_workflow_version(uuid, boolean, text, uuid) from public, anon;
grant execute on function public.clonar_workflow_version(uuid, boolean, text, uuid) to authenticated, service_role;

comment on function public.clonar_workflow_version(uuid, boolean, text, uuid) is
  'Copia una version (grafo, max_pasos, politica_concurrencia) a una version nueva con el proximo numero; con p_publicar la publica en la misma transaccion (restaurar). Nunca revive la fila vieja.';

-- =========================================================================
-- 4. Cuántas corridas siguen vivas
-- =========================================================================
-- La pantalla de publicación dice "las N corridas en marcha siguen en vX".
-- Por versión y no un total: una corrida vieja puede seguir viva en una
-- versión anterior a la publicada.
--
-- El índice parcial hace que contar sea proporcional a las corridas vivas y no
-- a todo el historial de cada versión, que es lo único que crece.

create index workflow_runs_vivas_por_version
  on public.workflow_runs (workflow_version_id)
  where estado in ('corriendo', 'esperando');

create function public.contar_corridas_vivas(p_workflow_id uuid)
returns table (
  version_id uuid,
  cantidad   bigint
)
language sql
stable
security invoker
set search_path = ''
as $function$
  select r.workflow_version_id, count(*)
    from public.workflow_runs as r
    join public.workflow_versiones as v on v.id = r.workflow_version_id
   where v.workflow_id = p_workflow_id
     and r.estado in ('corriendo', 'esperando')
   group by r.workflow_version_id;
$function$;

revoke all on function public.contar_corridas_vivas(uuid) from public, anon;
grant execute on function public.contar_corridas_vivas(uuid) to authenticated, service_role;

comment on function public.contar_corridas_vivas(uuid) is
  'Corridas vivas (corriendo/esperando) de un workflow, por version. SECURITY INVOKER: cuenta lo que el rol que llama puede ver.';
