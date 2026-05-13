-- 0005_storage_buckets.sql
-- 3 buckets privados. Policies de storage.objects en Fase 13.
-- Recordar (skill supabase): upsert requiere INSERT + SELECT + UPDATE policies.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'comprobantes_pago',
    'comprobantes_pago',
    false,
    5242880,  -- 5 MB
    array['image/jpeg','image/png','image/webp','application/pdf']
  ),
  (
    'productos',
    'productos',
    false,
    3145728,  -- 3 MB
    array['image/jpeg','image/png','image/webp']
  ),
  (
    'mensajes_media',
    'mensajes_media',
    false,
    20971520, -- 20 MB
    array[
      'image/jpeg','image/png','image/webp','image/gif',
      'audio/mpeg','audio/ogg','audio/wav','audio/webm',
      'video/mp4','video/webm','video/quicktime',
      'application/pdf'
    ]
  )
on conflict (id) do nothing;
