-- Saca del ledger tres anotaciones que nunca debieron estar ahí.
--
-- Al probar el etiquetado automático se cargaron una etiqueta, un intent y una
-- regla de ejemplo, y después se marcó y se restauró la etiqueta a mano para
-- verificar que una regla no revive lo que sacó una persona. Son operaciones de
-- DATOS, no de estructura, pero quedaron registradas como migraciones porque el
-- MCP de Supabase solo escribe por `apply_migration` —`execute_sql` es de solo
-- lectura—.
--
-- El resultado era un ledger remoto con tres entradas sin archivo en
-- `supabase/migrations/`: exactamente la divergencia repo↔base que
-- `AGENTS.md` documenta como trampa recurrente de este MCP.
--
-- Borra la anotación, no los datos: la etiqueta "Pide factura", el intent
-- `pide_factura` y su regla siguen en `crm-dev` como ejemplo vivo.
--
-- Sobre una base nueva esto es un no-op: las filas no existen.
delete from supabase_migrations.schema_migrations
where name in (
  'seed_prueba_etiquetado_automatico',
  'prueba_descarte_manual_etiqueta',
  'restaurar_etiqueta_tras_prueba'
);
