-- Sub-proyecto E — procedencia por campo del Lead Twin.
--
-- El Twin lo llena un extractor LLM sobre lo que dice el cliente. Hasta ahora
-- no había forma de distinguir un dato que dedujo el modelo de uno que corrigió
-- una persona, así que la UI no podía marcar cuáles son confiables ni evitar
-- que el extractor pisara una corrección humana.
--
-- Un jsonb y no una columna por campo: el Twin tiene 12 campos y sigue
-- creciendo, y "una migración por campo nuevo" es un costo que se paga para
-- siempre. La forma es
--   { "<campo>": { "por": "humano", "at": "<iso>", "user_id": "<uuid|null>" } }
-- y la ausencia de una clave significa que el dato vino del extractor. Se
-- guarda solo la intervención humana porque es la excepción: anotar cada campo
-- que tocó la IA sería escribir el caso normal en cada turno.
--
-- OBSOLETO desde 20260810150000: esa migración cambia el contrato. `por` pasa a
-- ser "ia" | "humano", el extractor también deja su entrada (con el mensaje del
-- que salió el dato y el valor que pisó), y la ausencia de clave ya no
-- significa "lo puso la IA" sino "nadie escribió ese campo todavía". La forma
-- vigente está documentada allá y en `ProcedenciaCampo` (src/types/entities.ts).

alter table public.lead_session
  add column procedencia jsonb not null default '{}'::jsonb;

comment on column public.lead_session.procedencia is
  'Campos del Twin corregidos por una persona. Clave ausente = el dato lo puso el extractor.';

-- Guarda de forma: sin esto un bug de escritura puede dejar un array o un
-- escalar adentro y romper la lectura de toda la ficha.
alter table public.lead_session
  add constraint lead_session_procedencia_es_objeto
  check (jsonb_typeof(procedencia) = 'object');
