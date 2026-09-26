-- Texto libre para quien tiene la ventana abierta, y audiencia dinámica.
-- Spec: docs/prd-workflows.md §7.3.5 · decisiones del dueño 2026-09-26 (1 y 4).
--
-- Aditiva: columnas nullable o con default, sus CHECK y una función. No
-- reescribe ninguna función ni trigger existente: el trigger de transiciones
-- de `difusion_envios` sigue siendo la única puerta entre estados.
--
-- difusiones
--   texto_libre               la versión en texto libre del mensaje, con las
--                             mismas variables (`{{lead.nombre}}`…) que
--                             resuelve `interpolarVariables`. Null = todos
--                             reciben la plantilla, como antes. Meta acepta
--                             hasta 4096 caracteres en `text.body` (doc de
--                             "Text messages", leída el 2026-09-26).
--   audiencia_tanda_evaluada  la última tanda antes de la cual el motor volvió
--                             a resolver una audiencia dinámica. Null = nunca.
--
-- difusion_envios
--   salio_como     qué se mandó de verdad: `plantilla` o `texto_libre`. Lo
--                  escribe el motor al reservar el envío, cuando evalúa la
--                  ventana. Null = todavía no salió (o salió antes de esta
--                  migración, siempre por plantilla).
--   alta_dinamica  la fila la sumó la re-evaluación de una audiencia dinámica,
--                  después de programar. La pantalla de envío las cuenta.

-- =========================================================================
-- difusiones
-- =========================================================================

alter table public.difusiones
  add column texto_libre              text,
  add column audiencia_tanda_evaluada integer;

alter table public.difusiones
  add constraint difusiones_texto_libre_len
    check (texto_libre is null or char_length(btrim(texto_libre)) between 1 and 4096),
  add constraint difusiones_tanda_evaluada_no_negativa
    check (audiencia_tanda_evaluada is null or audiencia_tanda_evaluada >= 0),
  -- Sólo una audiencia dinámica se re-evalúa.
  add constraint difusiones_tanda_evaluada_solo_dinamica
    check (audiencia_tanda_evaluada is null or audiencia_modo = 'dinamica');

comment on column public.difusiones.texto_libre is
  'Version en texto libre para quien tiene la ventana de 24 h abierta al mandar. Mismas variables que la plantilla ({{lead.nombre}}). Null = todos reciben la plantilla.';
comment on column public.difusiones.audiencia_tanda_evaluada is
  'Ultima tanda antes de la cual se re-evaluo la audiencia dinamica. Null = nunca.';

-- =========================================================================
-- difusion_envios
-- =========================================================================

alter table public.difusion_envios
  add column salio_como    text,
  add column alta_dinamica boolean not null default false;

alter table public.difusion_envios
  add constraint difusion_envios_salio_como_valores
    check (salio_como is null or salio_como in ('plantilla', 'texto_libre')),
  -- El texto libre sólo sale con la ventana abierta: nunca consume cupo.
  add constraint difusion_envios_texto_libre_en_ventana
    check (salio_como is distinct from 'texto_libre' or ruta = 'ventana_abierta'),
  -- Lo que salió se sabe cómo salió: se escribe junto con la reserva.
  add constraint difusion_envios_salio_como_con_reserva
    check (salio_como is null or intento_at is not null);

comment on column public.difusion_envios.salio_como is
  'Que se mando: plantilla o texto_libre. Lo escribe el motor al reservar. Null = no salio todavia.';
comment on column public.difusion_envios.alta_dinamica is
  'La sumo la re-evaluacion de una audiencia dinamica despues de programar.';

-- La pantalla de envío cuenta las altas. Parcial: casi ninguna fila lo es.
create index difusion_envios_altas
  on public.difusion_envios (difusion_id)
  where alta_dinamica;

-- =========================================================================
-- Las altas de una audiencia dinámica
-- =========================================================================
--
-- El motor re-evalúa la audiencia antes de cada tanda y planifica a los que
-- empezaron a coincidir con el mismo planificador (bajas, dedup por teléfono,
-- todos los motivos). Esto las escribe:
--
-- - `on conflict do nothing` sin columna: cubre las dos unicidades. Un lead
--   que ya está en la difusión (por `difusion_envios_un_lead_por_difusion`)
--   no se vuelve a sumar ni pisa lo que avanzó.
-- - Un alta en cola cuyo teléfono ya tiene un envío vivo en esta difusión se
--   escribe excluida por `duplicado_telefono`: una persona recibe UNA vez por
--   difusión (§7.4), y dejarla afuera en silencio haría que se re-evalúe en
--   cada tanda sin que nadie vea por qué no recibe.
-- - Sólo una difusión dinámica que no terminó.
--
-- SECURITY INVOKER: la llama el motor con el service-role. Pasa por los mismos
-- CHECK y el trigger de transiciones que cualquier otra escritura.

create function public.difusion_sumar_altas(p_difusion_id uuid, p_envios jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_modo      public.difusion_audiencia_modo;
  v_estado    public.difusion_estado;
  v_insertadas integer;
begin
  if jsonb_typeof(p_envios) is distinct from 'array' then
    raise exception 'las altas no tienen la forma esperada' using errcode = '23514';
  end if;

  select d.audiencia_modo, d.estado into v_modo, v_estado
    from public.difusiones as d
   where d.id = p_difusion_id
     for update;
  if not found then
    raise exception 'no hay una difusion con id %', p_difusion_id using errcode = 'P0002';
  end if;
  if v_modo <> 'dinamica' then
    raise exception 'la difusion % tiene la audiencia congelada: no suma altas', p_difusion_id
      using errcode = '23514';
  end if;
  if v_estado not in ('programada', 'enviando', 'en_revision') then
    raise exception 'la difusion % esta %: ya no suma altas', p_difusion_id, v_estado
      using errcode = '23514';
  end if;

  with filas as (
    select x.lead_id, x.telefono, x.estado, x.motivo_exclusion, x.ruta, x.tanda, x.programado_para
      from jsonb_to_recordset(p_envios) as x(
        lead_id          uuid,
        telefono         text,
        estado           public.difusion_envio_estado,
        motivo_exclusion public.difusion_motivo_exclusion,
        ruta             public.difusion_ruta,
        tanda            integer,
        programado_para  timestamptz
      )
  ),
  ajustadas as (
    select f.lead_id,
           f.telefono,
           case when vivo.id is null then f.estado else 'excluido' end            as estado,
           case when vivo.id is null then f.motivo_exclusion
                else 'duplicado_telefono'::public.difusion_motivo_exclusion end    as motivo_exclusion,
           case when vivo.id is null then f.ruta else null end                     as ruta,
           case when vivo.id is null then f.tanda else null end                    as tanda,
           case when vivo.id is null then f.programado_para else null end          as programado_para
      from filas as f
      left join lateral (
        select e.id
          from public.difusion_envios as e
         where e.difusion_id = p_difusion_id
           and f.estado = 'en_cola'
           and e.telefono = f.telefono
           and e.estado <> 'excluido'
         limit 1
      ) as vivo on true
  )
  insert into public.difusion_envios (
    difusion_id, lead_id, telefono, estado, motivo_exclusion, ruta, tanda, programado_para, alta_dinamica
  )
  select p_difusion_id, a.lead_id, a.telefono, a.estado, a.motivo_exclusion, a.ruta, a.tanda,
         a.programado_para, true
    from ajustadas as a
  on conflict do nothing;

  get diagnostics v_insertadas = row_count;
  return v_insertadas;
end;
$$;

comment on function public.difusion_sumar_altas(uuid, jsonb) is
  'Suma a una difusion dinamica los leads que empezaron a coincidir. Idempotente: un lead ya presente no se toca; un telefono con envio vivo entra excluido por duplicado_telefono. SECURITY INVOKER (service-role).';

revoke all on function public.difusion_sumar_altas(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.difusion_sumar_altas(uuid, jsonb) to service_role;
