-- El motor que drena la cola de difusión.
-- Spec: docs/prd-workflows.md §7 · docs/prd-workflows-difusion.md §4.4, §7.3, §8.4-8.6.
--
-- Aditiva: cuatro columnas en `difusiones`, una en `difusion_envios`, sus
-- CHECK y un índice parcial. No reescribe ninguna función ni trigger: el
-- trigger de transiciones de `difusion_envios` sigue siendo la única puerta
-- entre estados, y reservar un envío no cambia su estado.
--
--   plantilla_idioma      el código con que Meta aprobó la plantilla (`es`,
--                         `es_AR`). Sin él la Cloud API no la encuentra.
--   plantilla_parametros  las variables del cuerpo, en orden: una por `{{n}}`,
--                         cada una `{"valor":"{{lead.nombre}}","respaldo":"..."}`.
--                         La forma completa la valida `ParametrosPlantillaSchema`.
--   motivo_revision       por qué el SISTEMA la pausó (132015, la muestra del
--                         canary). Null = la pausó una persona.
--   canary_revisado_at    la muestra ya salió y se frenó para revisarla: al
--                         reanudar no se vuelve a frenar.
--   intento_at            el envío se reservó para mandarse. Se escribe ANTES de
--                         llamar a Meta: si el proceso muere entre la llamada y
--                         la respuesta, un reintento ve la reserva y no manda
--                         otra vez. Un WhatsApp duplicado no se puede retirar.
--
-- Nada de esto existe en crm-dev todavía: 0 difusiones al 2026-09-25, así que
-- las CHECK nuevas no chocan con filas previas.

-- =========================================================================
-- difusiones
-- =========================================================================

alter table public.difusiones
  add column plantilla_idioma     text,
  add column plantilla_parametros jsonb not null default '[]'::jsonb,
  add column motivo_revision      text,
  add column canary_revisado_at   timestamptz;

alter table public.difusiones
  add constraint difusiones_plantilla_idioma_forma
    check (plantilla_idioma is null or plantilla_idioma ~ '^[a-z]{2,3}(_[A-Z]{2})?$'),
  add constraint difusiones_idioma_con_plantilla
    check (plantilla_idioma is null or plantilla_nombre is not null),
  -- Una difusión que sale necesita con qué salir: nombre e idioma. La
  -- categoría ya va atada al nombre (`difusiones_plantilla_completa`).
  add constraint difusiones_plantilla_lista_al_programar
    check (estado = 'borrador' or (plantilla_nombre is not null and plantilla_idioma is not null)),
  -- Cota defensiva, no un límite documentado de Meta.
  add constraint difusiones_parametros_forma
    check (
      jsonb_typeof(plantilla_parametros) = 'array'
      and jsonb_array_length(plantilla_parametros) <= 20
    ),
  add constraint difusiones_motivo_revision_coherente
    check (
      motivo_revision is null
      or (estado = 'en_revision' and char_length(motivo_revision) between 1 and 500)
    ),
  add constraint difusiones_canary_revisado_coherente
    check (canary_revisado_at is null or canary_tamano is not null);

comment on column public.difusiones.plantilla_parametros is
  'Variables del cuerpo en orden ({{1}}, {{2}}...): [{"valor":"{{lead.nombre}}","respaldo":"..."}]. Validado por ParametrosPlantillaSchema.';
comment on column public.difusiones.motivo_revision is
  'Por que el sistema la paso a revision (132015, canary). Null = la pauso una persona.';

-- =========================================================================
-- difusion_envios
-- =========================================================================

alter table public.difusion_envios
  add column intento_at timestamptz;

-- Un excluido nunca iba a salir: no se reserva. (El motor re-evalúa las bajas
-- ANTES de reservar; una fila reservada sólo termina aceptada, fallida o
-- cancelada.)
alter table public.difusion_envios
  add constraint difusion_envios_intento_no_excluido
    check (intento_at is null or estado <> 'excluido');

comment on column public.difusion_envios.intento_at is
  'Reservado para mandarse: se escribe antes de llamar a Meta. En cola con intento_at = en vuelo o desenlace desconocido; nunca se vuelve a mandar.';

-- Lo que el motor lee en cada lote: lo que sigue en cola de una difusión, por
-- fecha de salida. Parcial: una difusión terminada no deja filas acá.
create index difusion_envios_cola
  on public.difusion_envios (difusion_id, programado_para, id)
  where estado = 'en_cola';
