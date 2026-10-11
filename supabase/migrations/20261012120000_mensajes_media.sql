-- Media de los mensajes de WhatsApp (docs/meta/media.md).
--
-- 1. `mensajes` guarda dónde quedó la copia propia del archivo (imagen, video,
--    audio, documento, sticker) y en qué estado está la descarga. La copia vive
--    en el bucket PRIVADO `mensajes_media`; la URL que Meta da expira a los 5
--    minutos y el id de media del webhook a los 7 días, así que lo que no se
--    baja a tiempo se pierde.
-- 2. El bucket `mensajes_media` (ya existía, privado, para las imágenes de los
--    flujos) amplía tipos y tope para aceptar lo que mandan los clientes.
--
-- Quién escribe qué (se prueba en tests/integration/mensajes-media.supabase.test.ts):
--   - Objetos nuevos en `sesiones/`: sólo service role (descarga entrante, envío
--     del composer). `authenticated` no tiene policy de INSERT/UPDATE/DELETE
--     ahí; la única excepción previa es `flujos/<uuid>.(jpg|png)` para un admin.
--   - Lectura: la policy `storage_mensajes_media_select` (admin y vendedor) ya
--     existente. El panel nunca expone una URL permanente: firma una de pocos
--     segundos en el servidor (`/api/media/[mensajeId]`).

alter table public.mensajes
  add column if not exists media_estado text,
  add column if not exists media_meta_id text,
  add column if not exists media_path text,
  add column if not exists media_mime text,
  add column if not exists media_bytes bigint,
  add column if not exists media_nombre text,
  add column if not exists media_error text,
  add column if not exists media_descargado_at timestamptz;

comment on column public.mensajes.media_estado is
  'null = el mensaje no lleva archivo. pendiente = falta bajarlo; descargado = media_path listo; fallido = se agotaron los reintentos (media_error); omitido = a propósito no se guarda (muy grande, historial viejo).';
comment on column public.mensajes.media_meta_id is
  'Id de media que dio Meta (webhook). Idempotencia de la descarga. Vence a los 7 días.';
comment on column public.mensajes.media_path is
  'Ruta dentro del bucket mensajes_media: sesiones/<lead_session_id>/<mensaje_id>.<ext>. La purga de sesiones la borra.';
comment on column public.mensajes.media_mime is
  'Tipo real del archivo guardado (sin parámetros: audio/ogg, no audio/ogg; codecs=opus).';
comment on column public.mensajes.media_nombre is
  'Nombre original (sólo documentos). Es dato del cliente: se muestra como texto, nunca se usa como ruta.';

alter table public.mensajes
  add constraint mensajes_media_estado_check
    check (media_estado is null or media_estado in ('pendiente', 'descargado', 'fallido', 'omitido')),
  add constraint mensajes_media_bytes_check
    check (media_bytes is null or media_bytes >= 0),
  -- La ruta sólo puede tener esta forma: ni `..` ni barras de más ni nombres libres.
  add constraint mensajes_media_path_check
    check (
      media_path is null
      or media_path ~ '^sesiones/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,8}$'
    ),
  -- Un archivo "descargado" sin ruta no se puede mostrar ni purgar.
  add constraint mensajes_media_descargado_coherente
    check (media_estado is distinct from 'descargado' or (media_path is not null and media_mime is not null));

-- La app de escritorio pregunta "¿qué archivos nuevos hay?" en orden de bajada.
create index if not exists mensajes_media_descargada_idx
  on public.mensajes (media_descargado_at, id)
  where media_estado = 'descargado';

-- Bucket: mismos privados, más tipos y 50 MiB (el tope global del proyecto en
-- supabase/config.toml). Meta acepta documentos de hasta 100 MB; lo que pase
-- de 50 MiB no se guarda (estado `omitido`) y el hilo lo dice.
-- `application/octet-stream` es el tipo con el que se guarda lo que no se
-- reconoce: no se renderiza en línea, sólo se descarga.
update storage.buckets
set
  file_size_limit = 52428800,
  allowed_mime_types = array[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'audio/aac', 'audio/amr', 'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/webm',
    'video/mp4', 'video/3gpp', 'video/webm', 'video/quicktime',
    'application/pdf', 'text/plain',
    'application/msword',
    'application/vnd.ms-excel',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/octet-stream'
  ]
where id = 'mensajes_media';
