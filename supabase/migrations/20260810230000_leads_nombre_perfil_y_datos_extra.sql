-- Nombre de perfil de Meta y datos libres del lead.
--
-- 1. `nombre_perfil`
--
-- El webhook de WhatsApp manda `value.contacts[].profile.name` en cada mensaje
-- entrante y lo veniamos tirando: el parser solo leia `value.messages`. Por eso
-- todos los leads nacen con `nombre = ''`.
--
-- Va en columna nueva y no en `nombre` porque son dos datos distintos con dos
-- duenos distintos: `nombre` es como identifica la casa al lead y lo escribe el
-- vendedor desde el Twin; `nombre_perfil` es como se llama a si mismo en Meta y
-- lo pisa el pipeline cada vez que cambia. Meterlos en la misma columna haria
-- que un cambio de alias del cliente borrara la correccion del vendedor.
--
-- Nullable a proposito: Instagram y Messenger no mandan el campo en el webhook
-- (hace falta una llamada aparte a la Graph API), asi que el null significa "no
-- lo sabemos" y no "no tiene".
--
-- 2. `datos_extra`
--
-- Campos libres que el vendedor carga desde el `+` de la ficha ("Cumpleanos" /
-- "12/03"). Un jsonb y no una tabla aparte porque son datos sin esquema, sin
-- consultas por valor y de a un punado por lead: una tabla clave/valor seria
-- una join por ficha para leer lo mismo.
--
-- Aditiva: no toca ni borra nada existente.

alter table public.leads
  add column nombre_perfil text,
  add column datos_extra jsonb not null default '{}'::jsonb;

comment on column public.leads.nombre_perfil is
  'Nombre de perfil que reporta Meta (WhatsApp `contacts[].profile.name`). Lo escribe el pipeline; nunca pisa `nombre`. Null = el canal no lo manda.';

comment on column public.leads.datos_extra is
  'Campos libres cargados a mano desde el Twin: { "<clave>": "<valor>" }. Las claves que colisionan con columnas reales se rechazan en la Server Action.';

-- Guarda de forma: sin esto un bug de escritura puede dejar un array o un
-- escalar adentro y romper la lectura de toda la ficha.
alter table public.leads
  add constraint leads_datos_extra_es_objeto
  check (jsonb_typeof(datos_extra) = 'object');
