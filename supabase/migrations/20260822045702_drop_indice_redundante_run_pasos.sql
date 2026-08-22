-- El unique (run_id, orden) de workflow_run_pasos ya se apoya en su propio
-- btree sobre esas dos columnas en ese orden, asi que el indice
-- workflow_run_pasos_recorrido era una copia exacta: no aportaba ninguna
-- consulta y cobraba mantenimiento y espacio en la tabla que mas escribe el
-- motor (una fila por nodo por corrida).
drop index if exists public.workflow_run_pasos_recorrido;
