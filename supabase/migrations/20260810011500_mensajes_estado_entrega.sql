-- Sub-proyecto C — estados de entrega de los mensajes salientes.
--
-- Meta manda los cambios de estado por el mismo webhook que los mensajes, en
-- `value.statuses`, y hasta ahora el parser los descartaba: la UI no tenía cómo
-- saber si un mensaje salió, llegó o se leyó.
--
-- Las columnas van en `mensajes` y no en una tabla aparte porque el estado es
-- un atributo del mensaje, no un historial consultable: Meta manda la
-- progresión sent → delivered → read y solo interesa el último escalón.

create type estado_entrega_enum as enum ('enviado', 'entregado', 'leido', 'fallido');

alter table public.mensajes
  add column estado_entrega    estado_entrega_enum,
  add column estado_entrega_at timestamptz,
  add column error_entrega     text;

comment on column public.mensajes.estado_entrega is
  'Solo salientes. NULL en entrantes, y en salientes cuyo webhook de status todavia no llego.';
comment on column public.mensajes.estado_entrega_at is
  'Timestamp que reporto Meta para el ultimo estado, no el momento en que lo escribimos.';
comment on column public.mensajes.error_entrega is
  'Titulo del error de Meta cuando estado_entrega = fallido. NULL en el resto.';

-- El update de estado busca por `meta_message_id`. El índice parcial existente
-- (`mensajes_meta_id_idx`) ya cubre ese lookup: no hace falta uno nuevo.
