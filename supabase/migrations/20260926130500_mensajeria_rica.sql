-- 20260926130500_mensajeria_rica.sql
-- Tanda 4a: bloques de mensajería de los flujos (botones, lista, imagen,
-- ubicación).
--
-- 1. `interactive` en `tipo_mensaje_enum`: los salientes con botones o de
--    lista. Su forma va en `mensajes.metadata.rico`. Las respuestas del lead a
--    esos mensajes entran como `text` (el título elegido), con la opción en
--    `metadata.respuesta_interactiva`.
-- 2. Índice para encontrar la respuesta a un saliente por su wamid
--    (`findRespuestaInteractiva`): lo usa un flujo cuya espera venció, para no
--    perder una respuesta que llegó antes de que la espera quedara registrada.
-- 3. Subida de imágenes de flujos: un admin puede escribir en `mensajes_media`,
--    sólo bajo `flujos/<uuid>.<jpg|png>`. El resto del bucket lo sigue
--    escribiendo sólo el service-role (media entrante del pipeline).

alter type public.tipo_mensaje_enum add value if not exists 'interactive';

create index if not exists mensajes_respuesta_interactiva_idx
  on public.mensajes ((metadata -> 'respuesta_interactiva' ->> 'responde_a'))
  where (metadata -> 'respuesta_interactiva' ->> 'responde_a') is not null;

-- Idempotente: se puede reaplicar sin error (el `create policy` no tiene
-- `if not exists`).
drop policy if exists storage_mensajes_media_insert_flujos_admin on storage.objects;
create policy storage_mensajes_media_insert_flujos_admin on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'mensajes_media'
    and (select public.is_admin())
    and name ~ '^flujos/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png)$'
  );
