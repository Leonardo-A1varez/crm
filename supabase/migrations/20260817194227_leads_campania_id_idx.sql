-- Postgres NO indexa solo las columnas de una FK: indexa la referenciada, no la
-- que referencia. Sin este índice, `on delete set null` de campanias tiene que
-- hacer un seq scan de leads por cada borrado, y el futuro corte "leads de esta
-- campaña" tampoco tiene por dónde entrar.
--
-- Parcial porque hoy la columna es 100% NULL —nadie la escribe todavía— y va a
-- seguir siendo mayoritariamente NULL cuando la atribución de Meta entre: el
-- índice solo guarda las filas que efectivamente vienen de una campaña.
create index leads_campania_id_idx
  on public.leads (campania_id)
  where campania_id is not null;
