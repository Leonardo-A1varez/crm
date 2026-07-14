-- Slice 4a 10.4 — /api/health hace ping DB con client anon (zones prohíben
-- service-role en app/**). server_now() devuelve now(): cero data expuesta.
grant execute on function public.server_now() to anon;
