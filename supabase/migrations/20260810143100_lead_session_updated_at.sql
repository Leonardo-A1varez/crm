-- `updated_at` en lead_session: el encabezado del Lead Twin (handoff §1.4)
-- dice "hace 40 s" para contar cuándo el extractor tocó la ficha por última
-- vez, y la tabla solo tenía `started_at` (cuándo empezó la sesión) y
-- `closed_at`. Con eso el encabezado mentía o no se podía dibujar.
--
-- Trigger genérico `public.bump_updated_at()`, el mismo que ya usan `leads` y
-- `productos` desde 0004: escribe `now()` en cada UPDATE.

alter table public.lead_session
  add column updated_at timestamptz not null default now();

-- Sin esto toda sesión vieja diría "hace 0 s" al aplicar la migración.
-- `started_at` es el piso conocido: no sabemos cuándo se tocó la ficha por
-- última vez, pero sí que no pudo ser antes de que la sesión existiera.
update public.lead_session
  set updated_at = coalesce(closed_at, started_at);

create trigger lead_session_bump_updated_at
  before update on public.lead_session
  for each row execute function public.bump_updated_at();

comment on column public.lead_session.updated_at is
  'Ultimo UPDATE de la fila (trigger bump_updated_at). Alimenta el "hace X" del encabezado del Twin.';
