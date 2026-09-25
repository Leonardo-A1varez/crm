-- Bajas de difusión sin el teléfono en claro: HMAC-SHA256 + versión de clave.
--
-- Decisión del dueño (2026-09-24): el derecho de supresión (docs/data-retention.md
-- §3) pide reemplazar el teléfono por un hash, y las bajas no están entre las
-- excepciones. La baja tiene que seguir bloqueando aunque el lead se borre o se
-- anonimice, pero el número no puede quedar legible.
--
-- Qué cambia:
--   * `telefono` (E.164 en claro) sale. Entran `telefono_hash` (HMAC-SHA256 en
--     hex) y `clave_version` (con qué versión de la clave se calculó).
--   * El índice único parcial pasa de `telefono` a `telefono_hash`.
--   * El trigger de irreversibilidad protege las columnas nuevas.
--   * `difusion_supresiones_activas(text[])`: buscar bajas activas por hash en
--     el cuerpo de un POST. 64 caracteres por hash no entran en un `in.(…)` de
--     URL para una audiencia de miles.
--
-- Qué NO hace, a propósito:
--   * No calcula ningún hash. No puede: la clave vive en el servidor
--     (`DIFUSION_BAJAS_HMAC_CLAVES`) y no llega a la base. Un SHA-256 plano
--     calculable acá se revierte por fuerza bruta en segundos (el universo de
--     teléfonos es chico); eso es exactamente lo que se evita.
--   * No toca las policies: ninguna lee `telefono`. Tampoco
--     `reactivar_supresion_difusion(uuid, text)`: recibe el id de la baja, no un
--     teléfono, y devuelve la fila, que ahora trae el hash en lugar del número.
--   * No toca `difusion_envios.telefono` ni `programar_difusion()`: el cruce
--     audiencia↔bajas lo hace el planificador en TypeScript, no el SQL.
--
-- Por eso, si la tabla tuviera filas, esta migración no puede convertirlas y
-- FALLA EN VOZ ALTA en lugar de perderlas. Al 2026-09-24 crm-dev tenía 0 filas
-- (verificado con `select count(*)`), así que no hay script de backfill. Si
-- alguna vez falla acá: agregar las dos columnas como nullable, completarlas
-- desde la app con `HasherTelefonoBajas.alta()` (el trigger vigente no impide
-- escribirlas) y recién entonces correr esta migración sin el chequeo.

lock table public.difusion_supresiones in access exclusive mode;

do $$
declare
  v_filas bigint;
begin
  select count(*) into v_filas from public.difusion_supresiones;
  if v_filas > 0 then
    raise exception 'difusion_supresiones tiene % filas con el telefono en claro: esta migracion no puede hashearlas (la clave no esta en la base). Ver el encabezado del archivo.', v_filas
      using errcode = '55000';
  end if;
end;
$$;

drop index public.difusion_supresiones_activa_por_telefono;

alter table public.difusion_supresiones
  drop constraint difusion_supresiones_telefono_e164,
  drop column telefono,
  -- Sin default: una baja sin hash no bloquea a nadie, y eso no puede nacer
  -- en silencio.
  add column telefono_hash text not null,
  add column clave_version integer not null,
  add constraint difusion_supresiones_telefono_hash_hex
    check (telefono_hash ~ '^[0-9a-f]{64}$'),
  add constraint difusion_supresiones_clave_version_positiva
    check (clave_version > 0);

comment on table public.difusion_supresiones is
  'Bajas de difusion por telefono, guardado como HMAC-SHA256 (telefono_hash) con la version de la clave. Irreversible por escritura automatica: solo reactivar_supresion_difusion() la levanta, con persona admin y motivo.';
comment on column public.difusion_supresiones.telefono_hash is
  'HMAC-SHA256 en hex del telefono E.164 sin +, calculado en el servidor con la clave clave_version. La clave no esta en la base.';
comment on column public.difusion_supresiones.clave_version is
  'Version de DIFUSION_BAJAS_HMAC_CLAVES con que se hasheo. Una version no se retira mientras haya bajas activas con ella: docs/runbooks/secrets-rotation.md.';

-- Una baja activa por hash. El hash incluye la clave, así que una misma persona
-- podría tener una activa por versión si dos altas concurrentes caen justo en
-- una rotación: la app busca con todas las versiones antes de escribir, y dos
-- filas activas bloquean igual que una.
create unique index difusion_supresiones_activa_por_hash
  on public.difusion_supresiones (telefono_hash)
  where reactivada_at is null;

-- La identidad de una baja ahora es el hash y su versión.
create or replace function public.difusion_supresiones_irreversible()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op in ('DELETE', 'TRUNCATE') then
    raise exception 'una baja no se borra: se reactiva con reactivar_supresion_difusion(), que exige una persona admin y deja auditoria'
      using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    if new.reactivada_at is not null or new.reactivada_por is not null or new.reactivacion_motivo is not null then
      raise exception 'una baja nace activa: la reactivacion es un paso aparte y auditado'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.telefono_hash <> old.telefono_hash
     or new.clave_version <> old.clave_version
     or new.origen <> old.origen
     or new.created_at <> old.created_at
     or new.detalle is distinct from old.detalle then
    raise exception 'la identidad de una baja (telefono_hash, clave_version, origen, fecha, detalle) no se edita'
      using errcode = '42501';
  end if;

  if old.reactivada_at is not null then
    if new.reactivada_at is distinct from old.reactivada_at
       or new.reactivacion_motivo is distinct from old.reactivacion_motivo
       or (new.reactivada_por is distinct from old.reactivada_por and new.reactivada_por is not null) then
      raise exception 'una reactivacion registrada no se edita ni se deshace: una baja nueva es otra fila'
        using errcode = '42501';
    end if;
  elsif new.reactivada_at is not null
        and coalesce(current_setting('crm.reactivacion_supresion', true), '') <> 'on' then
    raise exception 'una baja solo se reactiva con reactivar_supresion_difusion(): ni un import ni la API la reactivan'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.difusion_supresiones_irreversible() from public, anon, authenticated;

-- Las bajas activas de esos hashes. SECURITY INVOKER: corre con el RLS de
-- quien llama (admin y vendedor leen; anon no). Los hashes los calcula el
-- servidor con todas las versiones vigentes de la clave.
--
-- Tope de 1.000 por llamada, en voz alta: PostgREST corta en 1.000 filas sin
-- avisar (AGENTS.md lección 12), y con una activa por hash el resultado nunca
-- pasa de la cantidad de hashes pedidos.
create function public.difusion_supresiones_activas(p_hashes text[])
returns setof public.difusion_supresiones
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if coalesce(cardinality(p_hashes), 0) > 1000 then
    raise exception 'como mucho 1000 hashes por llamada (llegaron %)', cardinality(p_hashes)
      using errcode = '22023';
  end if;

  return query
    select s.*
      from public.difusion_supresiones s
     where s.reactivada_at is null
       and s.telefono_hash = any(p_hashes);
end;
$$;

comment on function public.difusion_supresiones_activas(text[]) is
  'Bajas activas por HMAC del telefono. Hasta 1000 hashes por llamada. El hash lo calcula el servidor: la clave no esta en la base.';

revoke all on function public.difusion_supresiones_activas(text[]) from public, anon;
grant execute on function public.difusion_supresiones_activas(text[]) to authenticated, service_role;
