# Copiloto del Inbox: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cuando hay personas del equipo de turno, la IA redacta el borrador y la persona lo envía desde WhatsApp Web (costo de API ≈ 0); cuando no hay equipo pero el agente puede actuar, la IA contesta sola por la API como hoy.

**Architecture:** Un segundo horario (`agente_config.horario_equipo`) y un override por conversación (`conversaciones.modo_respuesta_override`) alimentan una función pura `decidirModo`, evaluada en un step propio del pipeline `on-message-received`. En modo Copiloto el pipeline no llama a `sendOutbound`: guarda la respuesta de `respond` en la tabla nueva `borradores_ia` (escrita con service-role, con un RPC atómico que garantiza un borrador vigente por conversación). "Regenerar"/"Reintentar" y la tarjeta del Inbox (3 contextos) salen de un evento Inngest propio y de un `CopilotoService` del panel.

**Tech Stack:** Next.js 16 App Router + Server Actions (Zod primera línea), Supabase (Postgres + RLS + RPC), Inngest, Vitest (jsdom + contract tests InMemory↔Supabase), Tailwind v4 + shadcn (base-ui), app de escritorio Electron (`window.crmEscritorio`).

**Spec:** `docs/superpowers/specs/2026-09-30-copiloto-inbox-design.md` (leerla entera antes de empezar; este plan argumenta desde ella y las tareas citan sus secciones como §n).

## Global Constraints

Toda tarea hereda esta sección. Los valores son los de la spec, copiados tal cual.

- **Regla de la decisión de modo (§3.2):** "Copiloto" fijo es siempre Copiloto; "Automático" fijo es Automático si el agente está abierto y Fuera de horario si no; "Según horario" es Copiloto si el equipo está abierto, si no Automático si el agente está abierto, y si no Fuera de horario. Las 12 combinaciones de la tabla de §3.2 se prueban una por una.
- **Horario del equipo:** campo nuevo `agente_config.horario_equipo` (`jsonb not null`, default `'{"lun":[],"mar":[],"mie":[],"jue":[],"vie":[],"sab":[],"dom":[]}'::jsonb`), mismo formato que `horario` (`Horario`, 7 días con lista de rangos `HH:MM`) y **misma `horario_timezone`**. Sin un solo rango = "nunca hay equipo" (default seguro: desplegar no cambia nada hasta que el dueño lo configure). `equipoAbierto = esTimezoneValida(tz) && tieneAlgunRango(horario_equipo) && estaAbierto(...)`: zona inválida o sin rangos cuenta como equipo cerrado; para el agente `estaAbierto` sigue devolviendo `true` ante zona inválida (no se toca).
- **Override por conversación (§4.1):** `conversaciones.modo_respuesta_override text check (modo_respuesta_override in ('copiloto','automatico'))`; `null` = "Según horario". Sin policy nueva: `conversaciones_update` ya existe para admin y vendedor.
- **`borradores_ia` (§4.2/§4.3):** estados `redactando | listo | usado | error | descartado`; `origen` `ia | regla`; `usado_via` `insertar | copiar | abrir_web | al_composer`; índice único parcial `borradores_ia_vigente_uq on (conversacion_id) where estado in ('redactando','listo','error')`; índices por `lead_session_id` y `mensaje_origen_id`; RLS: `select` para `is_admin() or is_vendedor()`, **sin policy de insert** (lo escribe el pipeline con service-role, como `turnos_interceptados`), update solo para marcar usado. El más viejo nunca pisa al nuevo: la escritura es condicional al último entrante de la conversación. Idempotente por `mensaje_origen_id` (R6).
- **Saliente "sin confirmar" (§3.4):** al tocar Insertar / Copiar / Abrir en WhatsApp Web se guarda en `mensajes`: `direction='out'`, `sender='humano'`, `sender_user_id` = quien tocó, `tipo='text'`, `meta_message_id=null`, `metadata={"origen":"whatsapp_web_sin_confirmar","borrador_id":"<uuid>"}`, `idempotency_key="copiloto:<borrador_id>"`. `sender='humano'` (no `'ia'`) para no consumir `max_salientes_automaticos_24h`. "Al composer" NO guarda este saliente (lo crea `sendMessageAction`).
- **Nada se envía solo en Copiloto** y nada cambia en BAJA, flujos interceptores, pausa/`ia_pausada`, escalado ni guarda de descuento: si hoy la IA no respondería, tampoco hay borrador. El costo del LLM se registra igual (`recordLlmUsage` ya vive dentro de `respond`/`classify`; este plan no agrega ninguna llamada nueva al LLM fuera de esos dos puntos de entrada).
- **Modo decidido una vez por mensaje** (step `decidir-modo`, junto a `decidir-horario`); un cambio de horario u override no toca borradores ya generados.
- **Puente de escritorio:** `window.crmEscritorio.abrirChat(telefono, texto)` acepta texto de hasta 4096 caracteres (`LARGO_MAXIMO_TEXTO`, `desktop/src/main/seguridad.ts:114`) y teléfono de 8–15 dígitos; no se toca el contrato (`src/types/crm-escritorio.d.ts`). El borrador de más de 4096 caracteres se rechaza en la tarjeta (las acciones de envío y Copiar quedan deshabilitadas hasta que se acorte, con el contador visible).
- **URL del navegador (§5):** `https://web.whatsapp.com/send?phone=<E164 sin +>&text=<texto>`.
- **Nunca loguear el texto del borrador** (AGENTS §0.9). Los logs llevan ids, estados y códigos; los errores del proveedor no se guardan (`error_codigo` es un código corto, `^[a-z_]{1,40}$`).
- **Convenciones del repo (AGENTS.md):** capas API/Action → Service → Repository → DB; repos con interface + InMemory + Supabase + contract test reusable; Server Action con `Schema.safeParse/parse` como primera línea; `DomainError` (`src/lib/errors.ts`) en `src/server/**` (prohibido `throw new Error`); `console.log` prohibido en `src/**` (usar `getLogger`/`Logger`); idempotency key explícita en `step.run` de funciones nuevas (`copiloto-borrador-<día>-<borradorId>-<paso>`); `git add` con rutas explícitas (nunca `-A`); tests por ruta explícita (nunca `npm test` completo salvo la Task 14); commits Conventional en español con el trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **El pre-commit (`lefthook.yml`) corre `npm run typecheck` sobre TODO el proyecto:** cada tarea termina con typecheck verde y se commitea sola. Si una tarea rompe el typecheck de código que toca otra tarea, arreglar en esa misma tarea.
- **Migraciones:** NO se aplican a crm-dev dentro de este plan (lo hace el orquestador, con el stack local primero, lección 16). El MCP `mcp__supabase__*` apunta a otro proyecto (lección 15): nunca. Solo lectura sobre crm-dev con `mcp__plugin_supabase_supabase__*` y `project_id` `emubzkouwvuzlrtsgorx`. Los tipos se generan del stack local (`supabase gen types ... --local`) porque crm-dev todavía no tiene la migración (ver Task 1).
- **Diseño (AGENTS §0.11.6):** toda tarea de UI carga antes las skills `frontend-design:frontend-design`, `ui-ux-pro-max:design-system`, `ecc:make-interfaces-feel-better`, `emil-design-eng`, `ecc:accessibility` y `vercel:shadcn` (más `motion-foundations` si algo se mueve) y se verifica **medido en el navegador** (lección 1), no leyendo el diff.

---

## Discrepancias spec ↔ código real (leídas el 2026-09-30, `feat/app-escritorio` @ `0b1d0ed`)

Se resuelven dentro del plan; el orquestador debe conocerlas.

1. **`.claude/rules/` no existe** en el repo (solo `launch.json`, `settings.local.json`, `worktrees`). Las convenciones salen de `AGENTS.md`.
2. **El MCP de crm-dev no puede generar los tipos de una migración que crm-dev todavía no tiene.** El plan genera `types.gen.ts` del stack local (mismo generador del CLI, `--local`) y el orquestador lo verifica contra crm-dev después de aplicar (`generate_typescript_types` con el `project_id` de crm-dev, diff vacío).
3. **Un solo archivo de migración.** La spec (§11) habla de "dos migraciones"; el pedido fue un `<timestamp>_copiloto.sql`. Son un solo archivo con las tres piezas (columna del equipo, columna del override, tabla + RPC).
4. **Los paneles no pueden usar service-role** (ESLint boundaries; `src/server/db/client.ts`). Por eso "Regenerar/Reintentar" (R4) no escribe en `borradores_ia` desde la Server Action: la action emite el evento Inngest `copiloto/borrador.solicitado` y la función (service-role) hace el `iniciar(forzar)`. "Marcar usado" sí lo hace el panel con el cliente autenticado (policy de update + grant por columna, como `notificaciones`).
5. **`ConversationView` no expone la conversación** (id ni modo). Se agrega `conversacionId` (Task 8); sin eso la página no puede leer el override ni el borrador.
6. **`OnMessageReceivedDeps` de 10 archivos de test** construyen sus deps a mano. La dependencia nueva (`borradores`) es **opcional**; si falta y el modo decidido es Copiloto, el turno falla en voz alta (`IllegalStateError`, no reintenta) en vez de mandar por la API lo que el equipo pidió redactar. El bootstrap la wirea y la Task 14 lo comprueba de punta a punta.
7. **Copiloto solo para WhatsApp.** La spec no dice qué pasa con Instagram/Messenger. El plan decide: para `canal !== "wa"` el modo se calcula sin override y sin equipo (`equipoAbierto=false`, `override=null`), o sea exactamente el comportamiento de hoy (las acciones de la tarjeta son de WhatsApp Web y el ahorro de costo es de la API de WhatsApp). **Confirmar con el dueño.**
8. **Borradores obsoletos por mensajes que no llegan a `iniciar`** (BAJA, flujo interceptor, fuera de horario): la spec solo descarta en `handoff`/descuento. El plan agrega un step `invalidar-borrador-previo` que descarta los vigentes apenas llega un entrante no duplicado; sin eso la tarjeta ofrecería la respuesta a un mensaje anterior después de que un flujo ya contestó el nuevo.
9. **"Regla: <nombre>":** las reglas no tienen nombre propio; se usa `nombreDeRegla(respuesta_contenido)` (`src/lib/ui/regla.ts`), el mismo criterio que la auditoría del turno.
10. **R1/R2 son operativas, no de código:** zona horaria de crm-dev (`America/Argentina/Buenos_Aires` vs `America/Guayaquil`) y `escalar_umbral_intents = 2`. El default de `defaults.ts:53` también es Buenos Aires: queda **fuera de este plan** (cambiarlo rompe `defaults.test.ts` y es decisión del dueño).
11. Migraciones en el repo: hoy son **88**; con este plan, 89 (`supabase migration list` / `node scripts/stack-local-db.mjs verificar`).
12. **El triage no cambia.** Una conversación con borrador `listo` y la IA activa cae en el grupo compacto «La IA está manejando» de la lista (no tiene `motivo` de triage). La spec pide solo la marca «Borrador listo»; el plan la pone (ícono en la fila compacta, texto en la completa) y **no** toca el orden ni el triage. Si el dueño quiere que esas conversaciones suban a «Requieren tu atención», es un cambio aparte en `src/lib/triage.ts`.
13. **Texto de más de 4096 caracteres:** la spec dice «truncarse o rechazarse»; el plan rechaza (deshabilita Insertar / Abrir / Al composer / Copiar y muestra el contador), porque truncar una respuesta a mitad de frase sería mandar algo que nadie escribió.

---

## Estructura de archivos

**Crear**

| Archivo                                                                                                                                                                                                                                                                                                                                            | Responsabilidad                                                                                                             |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `supabase/migrations/20260930120000_copiloto.sql`                                                                                                                                                                                                                                                                                                  | columna `horario_equipo`, columna `modo_respuesta_override`, tabla `borradores_ia`, RPC `iniciar_borrador_ia`, RLS y grants |
| `src/types/copiloto.ts`                                                                                                                                                                                                                                                                                                                            | tipos y constantes del dominio copiloto (`ModoOverride`, `ModoDecidido`, `BorradorIa`, vistas para la UI)                   |
| `src/lib/copiloto/modo.ts`                                                                                                                                                                                                                                                                                                                         | `decidirModo`, `equipoAbiertoAhora` (puras)                                                                                 |
| `src/lib/copiloto/errores.ts`                                                                                                                                                                                                                                                                                                                      | `codigoDeErrorBorrador` y los códigos de `borradores_ia.error_codigo` (puras)                                               |
| `src/lib/copiloto/resultado.ts`                                                                                                                                                                                                                                                                                                                    | `resolverResultadoRegenerado` (pura)                                                                                        |
| `src/lib/copiloto/limites.ts`                                                                                                                                                                                                                                                                                                                      | `LARGO_MAXIMO_BORRADOR = 4096`                                                                                              |
| `src/lib/copiloto/whatsapp-web.ts`                                                                                                                                                                                                                                                                                                                 | `urlWhatsAppWeb`, `LARGO_MAXIMO_BORRADOR`, `textoEnviable`                                                                  |
| `src/lib/copiloto/acciones.ts`                                                                                                                                                                                                                                                                                                                     | `accionesDeTarjeta(ubicacion, hayTelefono)`                                                                                 |
| `src/lib/copiloto/etiquetas.ts`                                                                                                                                                                                                                                                                                                                    | copys del interruptor y de los errores del borrador                                                                         |
| `src/lib/validation/copiloto.schema.ts`                                                                                                                                                                                                                                                                                                            | Zod de las 3 Server Actions                                                                                                 |
| `src/server/repositories/borradores-ia.repo.ts`                                                                                                                                                                                                                                                                                                    | interface + InMemory                                                                                                        |
| `src/server/repositories/borradores-ia.supabase.repo.ts`                                                                                                                                                                                                                                                                                           | impl Supabase (RPC + updates condicionales)                                                                                 |
| `src/server/services/agente/conversation-turn.ts`                                                                                                                                                                                                                                                                                                  | `buildConversationTurn` extraído de `on-message-received.ts` (lo usan el pipeline y Regenerar)                              |
| `src/inngest/functions/copiloto-borrador.ts`                                                                                                                                                                                                                                                                                                       | función Inngest de Regenerar/Reintentar                                                                                     |
| `src/server/services/copiloto/copiloto.service.ts`                                                                                                                                                                                                                                                                                                 | `CopilotoService` del panel (estado, cambiar modo, usar, pedir regeneración)                                                |
| `src/server/bootstrap/copiloto-bootstrap.ts`                                                                                                                                                                                                                                                                                                       | composición del service con el cliente autenticado + emisión del evento                                                     |
| `src/app/(panel)/inbox/_actions/cambiar-modo-respuesta.action.ts`                                                                                                                                                                                                                                                                                  | Server Action del interruptor                                                                                               |
| `src/app/(panel)/inbox/_actions/usar-borrador.action.ts`                                                                                                                                                                                                                                                                                           | Server Action de uso                                                                                                        |
| `src/app/(panel)/inbox/_actions/regenerar-borrador.action.ts`                                                                                                                                                                                                                                                                                      | Server Action de Regenerar/Reintentar                                                                                       |
| `src/components/inbox/copiloto/ContextoCopiloto.tsx`                                                                                                                                                                                                                                                                                               | contexto React (ubicación + `insertarEnWhatsApp`)                                                                           |
| `src/components/inbox/copiloto/TarjetaBorrador.tsx`                                                                                                                                                                                                                                                                                                | la tarjeta (4 estados, 3 ubicaciones)                                                                                       |
| `src/components/inbox/copiloto/InterruptorModo.tsx`                                                                                                                                                                                                                                                                                                | interruptor de 3 estados del encabezado                                                                                     |
| Tests: `tests/unit/copiloto/*.test.ts(x)`, `tests/repositories/borradores-ia.contract.ts`, `tests/unit/borradores-ia.in-memory.test.ts`, `tests/integration/borradores-ia.supabase.test.ts`, `tests/integration/copiloto-rls.supabase.test.ts`, `tests/unit/on-message-received-copiloto.test.ts`, `tests/unit/copiloto-borrador-function.test.ts` | ver cada tarea                                                                                                              |

**Modificar** (por tarea): `scripts/gen-types.mjs`, `package.json`, `src/server/db/types.gen.ts`, `src/types/agente.ts`, `src/types/entities.ts`, `src/types/inbox.ts`, `src/lib/agente/defaults.ts`, `src/lib/validation/agente.schema.ts`, `src/lib/validation/schemas.ts`, `src/server/repositories/agente-config.repo.ts`, `…agente-config.supabase.repo.ts`, `src/server/services/agente/{config-provider,agente-config.service}.ts`, `src/server/repositories/conversations.repo.ts` y `.supabase.repo.ts`, `src/inngest/functions/on-message-received.ts`, `src/inngest/events.ts`, `src/inngest/functions/index.ts`, `src/inngest/bootstrap.ts`, `src/server/services/inbox/default-inbox.service.ts`, `src/server/bootstrap/inbox-bootstrap.ts`, `src/components/inbox/{CentroConversacion,InboxListItem,MessageBubble}.tsx`, `src/app/(panel)/inbox/[leadId]/page.tsx`, `src/app/(panel)/agente/_components/{EditorHorario,TabLimites,AgenteConsola,HistorialVersiones}.tsx`, `docs/workflows.md`, `docs/data-model.md`.

## Mapa de tareas y dependencias

```
T1 migración+tipos ─┬─ T2 horario_equipo (dominio) ──────────┐
                    ├─ T4 override en Conversacion (+T3) ────┤
                    └─ T5 repo borradores_ia ────────────────┤
T3 decidirModo (puro, independiente) ────────────────────────┴─ T6 pipeline ─ T7 Regenerar (Inngest) ─ T8 CopilotoService + actions
                                                                                                          │
        ┌─────────────────────────────────────────────────────────────────────────────────────────────────┤ (UI en paralelo)
        ├─ T9  InterruptorModo            ├─ T10 TarjetaBorrador + CentroConversacion
        ├─ T11 Marca en la lista + burbuja├─ T12 Editor del horario del equipo en /agente (solo necesita T2)
        └──────────────── T13 integración en page.tsx + medición en navegador ── T14 E2E + gates + docs
```

Paralelizables: **T1 ∥ T3**; tras T1 (T4 además espera a T3): **T2 ∥ T4 ∥ T5**; tras T8: **T9 ∥ T10 ∥ T11 ∥ T12** (T12 solo necesita T2 y puede arrancar antes). T6 → T7 → T8 son secuenciales: los tres tocan el mismo par de archivos (`on-message-received.ts`, `events.ts`).

---

## Task 1: Migración `copiloto` y tipos de la base

**Worker sugerido:** `worker-high` (SQL con RLS, RPC y concurrencia).
**Depende de:** nada.
**Skills a cargar antes:** `supabase:supabase`, `supabase:supabase-postgres-best-practices`.

**Files:**

- Create: `supabase/migrations/20260930120000_copiloto.sql`
- Modify: `scripts/gen-types.mjs`, `package.json` (script `db:gen-types:local`), `src/server/db/types.gen.ts`

**Interfaces:**

- Produces (para T2/T4/T5): columnas `agente_config.horario_equipo jsonb`, `conversaciones.modo_respuesta_override text`; tabla `public.borradores_ia` con las columnas de §4.2 + `updated_at`; RPC `public.iniciar_borrador_ia(p_conversacion_id uuid, p_lead_session_id uuid, p_mensaje_origen_id uuid, p_forzar boolean default false) returns table (out_id uuid, out_resultado text, out_estado text)` donde `out_resultado ∈ {'creado','existente','obsoleto'}`; tipos regenerados en `Database["public"]`.

- [ ] **Step 1: Confirmar el timestamp y el estado previo**

```bash
ls supabase/migrations | tail -2
ls supabase/migrations/*.sql | wc -l
```

Expected: la última es `20260926180000_turnos_interceptados_y_notificaciones.sql` y el conteo es `88`. Si hay una migración posterior, usar un timestamp mayor que ella en el nombre del archivo (el resto del plan lo llama `20260930120000_copiloto.sql`).

- [ ] **Step 2: Escribir la migración**

Crear `supabase/migrations/20260930120000_copiloto.sql`:

```sql
-- Copiloto del Inbox (spec docs/superpowers/specs/2026-09-30-copiloto-inbox-design.md).
--
-- Tres piezas, todas aditivas y reaplicables (`if not exists`, `drop policy if
-- exists`, `create or replace`): no se reescribe ninguna fila ni ninguna
-- política existente.
--
--   1. `agente_config.horario_equipo`: cuándo hay personas para enviar desde
--      WhatsApp Web. Default = los 7 días vacíos = "nunca hay equipo", así que
--      desplegar esto no cambia el comportamiento hasta que alguien lo
--      configure (§3.2). `agente_config` es append-only y versionada: solo se
--      agrega una columna con default; toda versión previa lee "sin equipo".
--   2. `conversaciones.modo_respuesta_override`: la preferencia por
--      conversación (null = "Según horario").
--   3. `borradores_ia` + RPC `iniciar_borrador_ia`: el borrador vigente de cada
--      conversación y su arranque atómico.

-- =========================================================================
-- 1. Horario del equipo
-- =========================================================================

alter table public.agente_config
  add column if not exists horario_equipo jsonb not null
    default '{"lun":[],"mar":[],"mie":[],"jue":[],"vie":[],"sab":[],"dom":[]}'::jsonb;

-- Los 7 días son obligatorios: un `{}` fallaría al leer la fila con
-- `HorarioSchema`, y un día ausente sería un cierre silencioso. Con el CHECK el
-- error aparece al escribir y no en el pipeline. `jsonb_exists_all` es la forma
-- de función del operador `?&` (se evita el `?` en un archivo que pasan por
-- distintos clientes SQL).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'agente_config_horario_equipo_dias'
  ) then
    alter table public.agente_config
      add constraint agente_config_horario_equipo_dias
      check (
        jsonb_typeof(horario_equipo) = 'object'
        and jsonb_exists_all(horario_equipo, array['lun','mar','mie','jue','vie','sab','dom'])
      );
  end if;
end
$$;

comment on column public.agente_config.horario_equipo is
  'Cuándo hay personas del equipo para enviar desde WhatsApp Web (copiloto). Mismo formato y misma zona (horario_timezone) que horario. Sin ningún rango = nunca hay equipo.';

-- =========================================================================
-- 2. Preferencia de modo por conversación
-- =========================================================================

alter table public.conversaciones
  add column if not exists modo_respuesta_override text
    check (modo_respuesta_override in ('copiloto', 'automatico'));

comment on column public.conversaciones.modo_respuesta_override is
  'Preferencia del equipo para esta conversación: copiloto | automatico. null = "Según horario".';

-- `conversaciones_update` (20260714124024) ya deja actualizar a admin y vendedor
-- sin restringir columnas: el interruptor del encabezado no necesita policy nueva.

-- =========================================================================
-- 3. borradores_ia
-- =========================================================================
--
-- Un borrador por respuesta que la IA redactó en modo Copiloto. Se escribe con
-- service-role desde el pipeline y desde la función de Regenerar (sin policy de
-- INSERT: nadie más puede fabricar borradores). El panel solo lee y marca
-- "usado".
--
-- El texto del borrador (`contenido`) puede traer datos del cliente: nunca se
-- loguea, y se va con la sesión (CASCADE) cuando la purga de 29 días la borra.

create table if not exists public.borradores_ia (
  id                uuid primary key default gen_random_uuid(),
  conversacion_id   uuid not null references public.conversaciones(id) on delete cascade,
  lead_session_id   uuid not null references public.lead_session(id) on delete cascade,
  -- El entrante que lo disparó.
  mensaje_origen_id uuid not null references public.mensajes(id) on delete cascade,
  estado            text not null
    check (estado in ('redactando', 'listo', 'usado', 'error', 'descartado')),
  contenido         text,
  origen            text check (origen in ('ia', 'regla')),
  regla_id          uuid references public.reglas(id) on delete set null,
  -- Código corto (`llm_error`, `tope_diario`…), nunca el texto del proveedor.
  error_codigo      text check (error_codigo is null or error_codigo ~ '^[a-z_]{1,40}$'),
  usado_at          timestamptz,
  usado_via         text check (usado_via in ('insertar', 'copiar', 'abrir_web', 'al_composer')),
  usado_por         uuid references public.usuarios(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint borradores_ia_listo_con_texto
    check (estado <> 'listo' or (contenido is not null and origen is not null)),
  constraint borradores_ia_error_con_codigo
    check (estado <> 'error' or error_codigo is not null),
  constraint borradores_ia_usado_con_via
    check (estado <> 'usado' or (usado_via is not null and usado_at is not null))
);

comment on table public.borradores_ia is
  'Respuesta que la IA redactó en modo Copiloto para que una persona la envíe desde WhatsApp Web. Uno vigente por conversación (redactando|listo|error); usado y descartado quedan de historial.';

-- Un vigente por conversación. "Usado" y "descartado" no compiten por el índice.
create unique index if not exists borradores_ia_vigente_uq
  on public.borradores_ia (conversacion_id)
  where estado in ('redactando', 'listo', 'error');

-- Las FK con cascade/set null necesitan índice: sin ellos el borrado en cascada
-- recorre la tabla (mismo criterio que turnos_interceptados).
create index if not exists borradores_ia_sesion_idx on public.borradores_ia (lead_session_id);
create index if not exists borradores_ia_mensaje_origen_idx
  on public.borradores_ia (mensaje_origen_id);
create index if not exists borradores_ia_regla_idx on public.borradores_ia (regla_id);
create index if not exists borradores_ia_usado_por_idx on public.borradores_ia (usado_por);

alter table public.borradores_ia enable row level security;

drop policy if exists borradores_ia_select on public.borradores_ia;
create policy borradores_ia_select on public.borradores_ia
  for select to authenticated
  using ((select public.is_admin()) or (select public.is_vendedor()));

-- El panel solo puede pasar un borrador `listo` a `usado`. Filtrar por estado en
-- el USING hace que un segundo "usar" afecte 0 filas (sin error) y que el
-- guardado del saliente "sin confirmar" (§3.4) no se repita.
drop policy if exists borradores_ia_update_uso on public.borradores_ia;
create policy borradores_ia_update_uso on public.borradores_ia
  for update to authenticated
  using (((select public.is_admin()) or (select public.is_vendedor())) and estado = 'listo')
  with check (((select public.is_admin()) or (select public.is_vendedor())) and estado = 'usado');

-- Permisos de tabla: los default privileges (20260816042039) otorgan todo; acá
-- se recorta a lo que el panel necesita. service_role conserva todo.
revoke all on public.borradores_ia from anon;
revoke insert, update, delete on public.borradores_ia from authenticated;
grant select on public.borradores_ia to authenticated;
grant update (estado, usado_at, usado_via, usado_por, updated_at)
  on public.borradores_ia to authenticated;

-- =========================================================================
-- 4. RPC: arrancar un borrador de forma atómica
-- =========================================================================
--
-- Lo llama el pipeline (primer intento de un turno) y la función de Regenerar
-- (`p_forzar = true`). Con un lock a la fila de la conversación:
--
--   * 'obsoleto': `p_mensaje_origen_id` ya no es el último entrante de la
--     conversación. El más viejo nunca pisa al nuevo.
--   * 'existente': ya hay un borrador para ese entrante (idempotencia por
--     mensaje_origen_id, R6). Vale también si ya fue usado. Con `p_forzar` se
--     ignora y se crea otro (Regenerar / Reintentar).
--   * 'creado': descartó los vigentes de la conversación y creó uno `redactando`.
--
-- `for no key update` y no `for update`: no choca con el `for key share` que
-- toma cualquier INSERT de `mensajes` (FK a conversaciones), así que no frena la
-- llegada de mensajes mientras se decide.
create or replace function public.iniciar_borrador_ia(
  p_conversacion_id   uuid,
  p_lead_session_id   uuid,
  p_mensaje_origen_id uuid,
  p_forzar            boolean default false
)
returns table (out_id uuid, out_resultado text, out_estado text)
language plpgsql
set search_path = public
as $$
declare
  v_ultimo uuid;
  v_id     uuid;
  v_estado text;
begin
  perform 1 from public.conversaciones c where c.id = p_conversacion_id for no key update;
  if not found then
    raise exception 'conversacion no encontrada: %', p_conversacion_id using errcode = 'P0002';
  end if;

  select m.id into v_ultimo
    from public.mensajes m
   where m.conversacion_id = p_conversacion_id and m.direction = 'in'
   order by m.created_at desc, m.id desc
   limit 1;

  if v_ultimo is distinct from p_mensaje_origen_id then
    return query select null::uuid, 'obsoleto'::text, null::text;
    return;
  end if;

  select b.id, b.estado into v_id, v_estado
    from public.borradores_ia b
   where b.mensaje_origen_id = p_mensaje_origen_id
     and b.estado in ('redactando', 'listo', 'error', 'usado')
   order by b.created_at desc
   limit 1;

  if found and not p_forzar then
    return query select v_id, 'existente'::text, v_estado;
    return;
  end if;

  update public.borradores_ia b
     set estado = 'descartado', updated_at = now()
   where b.conversacion_id = p_conversacion_id
     and b.estado in ('redactando', 'listo', 'error');

  insert into public.borradores_ia (conversacion_id, lead_session_id, mensaje_origen_id, estado)
  values (p_conversacion_id, p_lead_session_id, p_mensaje_origen_id, 'redactando')
  returning id into v_id;

  return query select v_id, 'creado'::text, 'redactando'::text;
end
$$;

-- Solo service_role: el panel no arranca borradores.
revoke execute on function public.iniciar_borrador_ia(uuid, uuid, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.iniciar_borrador_ia(uuid, uuid, uuid, boolean)
  to service_role;
```

- [ ] **Step 3: Aplicar en el stack local y verificar el ledger**

```bash
npm run stack:up
node scripts/stack-local-db.mjs migrar
```

Expected: última línea `repo: 89 · ledger local: 89` y exit 0. (Si el stack ya estaba arriba, `stack:up` es idempotente.) Si falla con `LOCK TABLE ... 25P01` es el problema conocido de `db reset` (AGENTS lección 21), no de esta migración: usar `migrar`, no `db reset`.

- [ ] **Step 4: Verificar el esquema real contra la base local**

```bash
docker exec -i supabase_db_crm psql -U postgres -d postgres -qtA -c "select column_name||':'||data_type from information_schema.columns where table_schema='public' and table_name='borradores_ia' order by ordinal_position;"
```

Expected (14 líneas, en este orden): `id:uuid`, `conversacion_id:uuid`, `lead_session_id:uuid`, `mensaje_origen_id:uuid`, `estado:text`, `contenido:text`, `origen:text`, `regla_id:uuid`, `error_codigo:text`, `usado_at:timestamp with time zone`, `usado_via:text`, `usado_por:uuid`, `created_at:timestamp with time zone`, `updated_at:timestamp with time zone`.

```bash
docker exec -i supabase_db_crm psql -U postgres -d postgres -qtA -c "select indexname from pg_indexes where tablename='borradores_ia' order by 1;"
```

Expected: `borradores_ia_mensaje_origen_idx`, `borradores_ia_pkey`, `borradores_ia_regla_idx`, `borradores_ia_sesion_idx`, `borradores_ia_usado_por_idx`, `borradores_ia_vigente_uq`.

```bash
docker exec -i supabase_db_crm psql -U postgres -d postgres -c "select * from public.iniciar_borrador_ia('00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-000000000000','00000000-0000-0000-0000-000000000000');"
```

Expected: `ERROR:  conversacion no encontrada: 00000000-0000-0000-0000-000000000000`.

- [ ] **Step 5: Comprobar que la migración es reaplicable**

```bash
docker exec -i supabase_db_crm psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < supabase/migrations/20260930120000_copiloto.sql && echo REAPLICADA_OK
```

Expected: imprime `REAPLICADA_OK` (puede mostrar `NOTICE: ... already exists, skipping`, sin `ERROR`).

- [ ] **Step 6: Permitir `--local` en el generador de tipos (escritura segura)**

En `scripts/gen-types.mjs` reemplazar la llamada al CLI para aceptar el flag. Cambiar:

```js
const resultado = spawnSync("supabase", ["gen", "types", "typescript", "--linked"], {
```

por:

```js
// `--local` genera desde el stack de Docker (la migración todavía no está en
// crm-dev cuando se escribe); por defecto sigue siendo `--linked`.
const origen = process.argv.includes("--local") ? "--local" : "--linked";
const resultado = spawnSync("supabase", ["gen", "types", "typescript", origen], {
```

y en `package.json`, junto a `"db:gen-types"`, agregar `"db:gen-types:local": "node scripts/gen-types.mjs --local",`.

- [ ] **Step 7: Regenerar los tipos**

```bash
npm run db:gen-types:local
git diff --stat src/server/db/types.gen.ts
```

Expected: `db:gen-types: src/server/db/types.gen.ts actualizado.` y un diff **solo con líneas agregadas** (la tabla `borradores_ia`, `horario_equipo` en `agente_config`, `modo_respuesta_override` en `conversaciones`, la función `iniciar_borrador_ia`). Si aparecen cambios no relacionados (p. ej. `__InternalSupabase`), descartarlos a mano y dejar solo las adiciones. Verificar:

```bash
grep -n "borradores_ia\|iniciar_borrador_ia\|horario_equipo\|modo_respuesta_override" src/server/db/types.gen.ts | head -20
```

Expected: al menos una coincidencia por cada uno de los cuatro nombres.

- [ ] **Step 8: Typecheck y commit**

```bash
npm run typecheck
```

Expected: exit 0 (la regeneración solo agrega campos opcionales en `Insert`/`Update`; `Row` de `conversaciones` y `agente_config` ganan un campo que ningún código tipado con `Row` construye a mano).

```bash
git add supabase/migrations/20260930120000_copiloto.sql src/server/db/types.gen.ts scripts/gen-types.mjs package.json
git commit -m "feat(db): migración del copiloto (horario, override y borradores)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 2: `horario_equipo` en la config del agente (dominio, schema, repo, provider, servicio)

**Worker sugerido:** `worker-medium`.
**Depende de:** T1.
**Skills a cargar antes:** `superpowers:test-driven-development`.

**Files:**

- Modify: `src/types/agente.ts`, `src/lib/agente/defaults.ts`, `src/lib/validation/agente.schema.ts`, `src/server/repositories/agente-config.repo.ts`, `src/server/repositories/agente-config.supabase.repo.ts`, `src/server/services/agente/config-provider.ts`, `src/server/services/agente/agente-config.service.ts`, `src/app/(panel)/agente/_components/AgenteConsola.tsx` (solo `extraerValores`, para que compile)
- Test: `tests/unit/agente/defaults.test.ts`, `tests/unit/validation/agente.schema.test.ts`, `tests/unit/agente/agente-config.service.test.ts`, `tests/unit/agente/config-provider.test.ts`, `tests/repositories/agente-config.contract.ts`, `tests/integration/agente-config.supabase.test.ts`

**Interfaces:**

- Consumes: columna `horario_equipo` (T1), `Horario`/`DIAS_SEMANA` de `src/types/agente.ts`.
- Produces (T3, T6, T8, T12): `AgenteConfigValores.horario_equipo: Horario`; `CONFIG_DE_FABRICA.horario_equipo` con los 7 días `[]`; `GuardarConfigSchema` exige y normaliza `horario_equipo`; el provider lo entrega en `get()`; el servicio lo compara por valor (auditoría: el nombre `"horario_equipo"` en `campos_cambiados`) y el rollback lo copia.

- [ ] **Step 1: Escribir los tests que fallan**

En `tests/unit/agente/defaults.test.ts`, dentro de `describe("CONFIG_DE_FABRICA", ...)`, después del test del horario 24/7:

```ts
test("el horario del equipo de fabrica no tiene ningun rango: el copiloto no se enciende solo", () => {
  for (const dia of DIAS_SEMANA) {
    expect(CONFIG_DE_FABRICA.horario_equipo[dia]).toEqual([]);
  }
});
```

En `tests/unit/validation/agente.schema.test.ts`, dentro de `describe("GuardarConfigSchema", ...)` (mismo nivel que `describe("horario", ...)`):

```ts
describe("horario_equipo", () => {
  test("acepta los 7 dias vacios: es el default seguro, sin equipo", () => {
    expect(GuardarConfigSchema.safeParse(valores()).success).toBe(true);
  });

  test("exige las 7 claves", () => {
    const incompleto = { ...CONFIG_DE_FABRICA.horario_equipo } as Record<string, unknown>;
    delete incompleto.dom;
    expect(
      GuardarConfigSchema.safeParse(valores({ horario_equipo: incompleto } as never)).success,
    ).toBe(false);
  });

  test("normaliza: fusiona solapados y descarta invertidos, como el horario del agente", () => {
    const horario_equipo = {
      ...CONFIG_DE_FABRICA.horario_equipo,
      lun: [
        { desde: "08:00", hasta: "12:00" },
        { desde: "11:00", hasta: "14:00" },
        { desde: "22:00", hasta: "02:00" },
      ],
    };
    const r = GuardarConfigSchema.parse(valores({ horario_equipo }));
    expect(r.horario_equipo.lun).toEqual([{ desde: "08:00", hasta: "14:00" }]);
  });

  test("rechaza la config sin horario_equipo", () => {
    const sinCampo = { ...valores() } as Record<string, unknown>;
    delete sinCampo.horario_equipo;
    expect(GuardarConfigSchema.safeParse(sinCampo).success).toBe(false);
  });
});
```

En `tests/unit/agente/agente-config.service.test.ts`, dentro de `describe("guardarYActivar", ...)`, después del test del horario anidado:

```ts
test("detecta cambios dentro del horario del equipo y audita solo el nombre del campo", async () => {
  await sembrarActiva();
  await service.guardarYActivar({
    valores: valores({
      horario_equipo: {
        ...CONFIG_DE_FABRICA.horario_equipo,
        lun: [{ desde: "09:00", hasta: "18:00" }],
      },
    }),
    actorUserId: ACTOR,
  });

  const payload = audit.registros[0]?.payload as { campos_cambiados: string[] };
  expect(payload.campos_cambiados).toEqual(["horario_equipo"]);
  expect(JSON.stringify(payload)).not.toContain("09:00");
});
```

y dentro de `describe("rollback", ...)`:

```ts
test("el rollback copia el horario del equipo de la version restaurada", async () => {
  const conEquipo = {
    ...CONFIG_DE_FABRICA.horario_equipo,
    mar: [{ desde: "08:00", hasta: "17:00" }],
  };
  const v1 = await service.guardarYActivar({
    valores: valores({ horario_equipo: conEquipo }),
    actorUserId: ACTOR,
  });
  await service.guardarYActivar({ valores: valores(), actorUserId: ACTOR });

  const v3 = await service.rollback({ configId: v1.id, actorUserId: ACTOR });

  expect(v3.horario_equipo.mar).toEqual([{ desde: "08:00", hasta: "17:00" }]);
});
```

En `tests/unit/agente/config-provider.test.ts`, dentro de `describe("CachedAgentConfigProvider", ...)` después del primer test:

```ts
test("entrega el horario del equipo", async () => {
  const horario_equipo = {
    ...CONFIG_DE_FABRICA.horario_equipo,
    vie: [{ desde: "10:00", hasta: "16:00" }],
  };
  const repo = await repoConActiva({ horario_equipo });
  const config = await new CachedAgentConfigProvider(repo, loggerFalso()).get();
  expect(config.horario_equipo.vie).toEqual([{ desde: "10:00", hasta: "16:00" }]);
});
```

En `tests/repositories/agente-config.contract.ts`, dentro de `describe("crear y leer", ...)`:

```ts
test("el horario del equipo sobrevive el round-trip y las filas nuevas nacen sin equipo", async () => {
  const sinEquipo = await repo.crear(insert({ version: 1 }));
  expect((await repo.findById(sinEquipo.id))?.horario_equipo.lun).toEqual([]);

  const horario_equipo = {
    ...CONFIG_DE_FABRICA.horario_equipo,
    sab: [{ desde: "09:00", hasta: "13:00" }],
  };
  const conEquipo = await repo.crear(insert({ version: 2, horario_equipo }));
  const leida = await repo.findById(conEquipo.id);
  expect(leida?.horario_equipo.sab).toEqual([{ desde: "09:00", hasta: "13:00" }]);
  expect(leida?.horario_equipo.lun).toEqual([]);
});
```

- [ ] **Step 2: Ver fallar**

```bash
npx vitest run tests/unit/agente/defaults.test.ts tests/unit/validation/agente.schema.test.ts tests/unit/agente/agente-config.service.test.ts tests/unit/agente/config-provider.test.ts tests/unit/repositories/agente-config.test.ts 2>&1 | tail -30
```

Expected: FAIL (vitest no typechequea, pero `CONFIG_DE_FABRICA.horario_equipo` es `undefined`: `Cannot read properties of undefined (reading 'lun')` o `expected undefined to ...`).

- [ ] **Step 3: Implementar el tipo y el default**

`src/types/agente.ts`: debajo de `horario_timezone: string;` agregar

```ts
/**
 * Cuándo hay personas del equipo para enviar desde WhatsApp Web (copiloto).
 * Mismo formato y misma zona (`horario_timezone`) que `horario`. Sin un solo
 * rango = "nunca hay equipo": el copiloto no se enciende solo.
 */
horario_equipo: Horario;
```

`src/lib/agente/defaults.ts`: debajo de `horarioAbiertoSiempre`:

```ts
/** Sin ningún rango: "nunca hay equipo". Es el default seguro del copiloto. */
function horarioSinRangos(): Horario {
  const horario = {} as Horario;
  for (const dia of DIAS_SEMANA) horario[dia] = [];
  return horario;
}
```

y en `CONFIG_DE_FABRICA`, después de `horario_timezone: ...,`:

```ts
  // Espeja el default de la columna (migración `20260930120000`): los 7 días
  // vacíos. Con equipo 24/7 por defecto el copiloto se encendería en toda
  // conversación al desplegar y dejarían de salir respuestas por la API sin que
  // nadie lo pidiera.
  horario_equipo: horarioSinRangos(),
```

- [ ] **Step 4: Schema, repos, provider y servicio**

`src/lib/validation/agente.schema.ts`, en `GuardarConfigSchema`, después de `horario: HorarioSchema,`:

```ts
  // Mismas reglas que el horario del agente: 7 claves obligatorias y rangos
  // normalizados. Vacío es válido y significa "sin equipo".
  horario_equipo: HorarioSchema,
```

`src/server/repositories/agente-config.repo.ts` — `clonar` y `crear`:

```ts
function clonar(c: AgenteConfig): AgenteConfig {
  return {
    ...c,
    horario: structuredClone(c.horario),
    horario_equipo: structuredClone(c.horario_equipo),
  };
}
```

y en `crear`, `horario: structuredClone(input.horario),` seguido de `horario_equipo: structuredClone(input.horario_equipo),`.

`src/server/repositories/agente-config.supabase.repo.ts`: en `interface Row` agregar `horario_equipo: unknown;` después de `horario_timezone`; en `aDominio` agregar `horario_equipo: row.horario_equipo as Horario,` después de `horario_timezone`; y en `crear`:

```ts
      .insert({
        ...input,
        horario: input.horario as never,
        horario_equipo: input.horario_equipo as never,
        activa: false,
      })
```

`src/server/services/agente/config-provider.ts`, en `aValores`, después de `horario_timezone: c.horario_timezone,`:

```ts
    horario_equipo: c.horario_equipo,
```

`src/server/services/agente/agente-config.service.ts`:

- el `satisfies` de `CAMPOS_ESCALARES` pasa a `Omit<AgenteConfigValores, "horario" | "horario_equipo" | "escalar_palabras">`;
- en `camposCambiados`, después del `if` de `horario`:

```ts
if (!horariosIguales(actual.horario_equipo, nuevo.horario_equipo)) {
  cambiados.push("horario_equipo");
}
```

- en `soloValores`, después de `horario_timezone: c.horario_timezone,`: `horario_equipo: c.horario_equipo,`.

`src/app/(panel)/agente/_components/AgenteConsola.tsx`, en `extraerValores`, después de `horario_timezone: c.horario_timezone,`: `horario_equipo: c.horario_equipo,`.

- [ ] **Step 5: Ver pasar y typecheck**

```bash
npx vitest run tests/unit/agente/defaults.test.ts tests/unit/validation/agente.schema.test.ts tests/unit/agente/agente-config.service.test.ts tests/unit/agente/config-provider.test.ts tests/unit/repositories/agente-config.test.ts 2>&1 | tail -15
npm run typecheck
```

Expected: todos los archivos en PASS (`tests/unit/repositories/agente-config.test.ts` es el que ejecuta `runAgenteConfigContract` contra el InMemory) y typecheck exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/types/agente.ts src/lib/agente/defaults.ts src/lib/validation/agente.schema.ts src/server/repositories/agente-config.repo.ts src/server/repositories/agente-config.supabase.repo.ts src/server/services/agente/config-provider.ts src/server/services/agente/agente-config.service.ts "src/app/(panel)/agente/_components/AgenteConsola.tsx" tests/unit/agente/defaults.test.ts tests/unit/validation/agente.schema.test.ts tests/unit/agente/agente-config.service.test.ts tests/unit/agente/config-provider.test.ts tests/repositories/agente-config.contract.ts tests/integration/agente-config.supabase.test.ts
git commit -m "feat(agente): horario del equipo en la config versionada" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

En `tests/integration/agente-config.supabase.test.ts`, dentro de `describe("garantias que solo existen contra Postgres", ...)`, agregar el test del CHECK de la migración (el contract reusado ya cubre el round-trip; corre en la Task 14 con `test:integration:local`):

```ts
test("el CHECK rechaza un horario del equipo sin los 7 dias", async () => {
  await expect(repo.crear(insert({ horario_equipo: { lun: [] } as never }))).rejects.toThrow();
  await expect(repo.crear(insert({ horario_equipo: {} as never }))).rejects.toThrow();
});
```

(Y sumarlo al `git add` de este paso: `tests/integration/agente-config.supabase.test.ts`.)

---

## Task 3: `decidirModo` y `equipoAbiertoAhora` (funciones puras)

**Worker sugerido:** `worker-low` (puro, acotado, con tabla de verdad dada).
**Depende de:** nada (puede ir en paralelo con T1; no usa `AgenteConfigValores`, solo `Horario`).
**Skills a cargar antes:** `superpowers:test-driven-development`.

**Files:**

- Create: `src/types/copiloto.ts`, `src/lib/copiloto/modo.ts`
- Test: `tests/unit/copiloto/modo.test.ts`

**Interfaces:**

- Produces (T4, T6, T8, T9): en `src/types/copiloto.ts`: `MODOS_OVERRIDE`, `type ModoOverride = "copiloto" | "automatico"`, `type ModoDecidido = "copiloto" | "automatico" | "fuera_de_horario"`; en `src/lib/copiloto/modo.ts`: `decidirModo(input: { override: ModoOverride | null; equipoAbierto: boolean; agenteAbierto: boolean }): ModoDecidido` y `equipoAbiertoAhora(config: { horario_equipo: Horario; horario_timezone: string }, ahora: Date): boolean`.

- [ ] **Step 1: Escribir el test (las 12 combinaciones de §3.2 + bordes)**

Crear `tests/unit/copiloto/modo.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { estaAbierto } from "@/lib/agente/horario";
import { decidirModo, equipoAbiertoAhora } from "@/lib/copiloto/modo";
import type { ModoDecidido, ModoOverride } from "@/types/copiloto";
import { DIAS_SEMANA, type Horario } from "@/types/agente";

/** Las 12 filas de la tabla de §3.2, en el mismo orden de la spec. */
const TABLA: ReadonlyArray<[ModoOverride | null, boolean, boolean, ModoDecidido]> = [
  [null, true, true, "copiloto"],
  [null, true, false, "copiloto"],
  [null, false, true, "automatico"],
  [null, false, false, "fuera_de_horario"],
  ["copiloto", true, true, "copiloto"],
  ["copiloto", true, false, "copiloto"],
  ["copiloto", false, true, "copiloto"],
  ["copiloto", false, false, "copiloto"],
  ["automatico", true, true, "automatico"],
  ["automatico", true, false, "fuera_de_horario"],
  ["automatico", false, true, "automatico"],
  ["automatico", false, false, "fuera_de_horario"],
];

describe("decidirModo", () => {
  test("la tabla cubre las 12 combinaciones: 3 overrides x equipo x agente", () => {
    expect(TABLA).toHaveLength(12);
    expect(new Set(TABLA.map(([o, e, a]) => `${o}|${e}|${a}`)).size).toBe(12);
  });

  test.each(TABLA)(
    "override=%s equipoAbierto=%s agenteAbierto=%s -> %s",
    (override, equipoAbierto, agenteAbierto, esperado) => {
      expect(decidirModo({ override, equipoAbierto, agenteAbierto })).toBe(esperado);
    },
  );
});

function horarioVacio(): Horario {
  const h = {} as Horario;
  for (const dia of DIAS_SEMANA) h[dia] = [];
  return h;
}

const ZONA = "America/Guayaquil"; // UTC-5, sin horario de verano.
// 2026-09-28 es lunes. 15:00Z = 10:00 en Guayaquil.
const LUNES_10 = new Date("2026-09-28T15:00:00Z");
const LUNES_18_30 = new Date("2026-09-28T23:30:00Z");

describe("equipoAbiertoAhora", () => {
  const conLunes = { ...horarioVacio(), lun: [{ desde: "09:00", hasta: "18:00" }] };

  test("abierto dentro de un rango, en la zona del negocio", () => {
    expect(equipoAbiertoAhora({ horario_equipo: conLunes, horario_timezone: ZONA }, LUNES_10)).toBe(
      true,
    );
  });

  test("cerrado fuera del rango", () => {
    expect(
      equipoAbiertoAhora({ horario_equipo: conLunes, horario_timezone: ZONA }, LUNES_18_30),
    ).toBe(false);
  });

  test("sin un solo rango nunca hay equipo, a ninguna hora de ningun dia", () => {
    const base = Date.parse("2026-09-28T00:00:00Z");
    for (let hora = 0; hora < 24 * 7; hora++) {
      const ahora = new Date(base + hora * 3_600_000);
      expect(
        equipoAbiertoAhora({ horario_equipo: horarioVacio(), horario_timezone: ZONA }, ahora),
      ).toBe(false);
    }
  });

  test("zona invalida cuenta como equipo cerrado, aunque haya rangos", () => {
    expect(
      equipoAbiertoAhora({ horario_equipo: conLunes, horario_timezone: "Marte/Colonia" }, LUNES_10),
    ).toBe(false);
  });

  test("el agente NO cambia: con zona invalida `estaAbierto` sigue devolviendo true", () => {
    // Documenta la asimetria de §3.2: para el agente, zona invalida = abierto
    // (no callar al cliente); para el equipo seria el lado inseguro.
    expect(estaAbierto(conLunes, "Marte/Colonia", LUNES_10)).toBe(true);
  });
});
```

- [ ] **Step 2: Ver fallar**

```bash
npx vitest run tests/unit/copiloto/modo.test.ts 2>&1 | tail -15
```

Expected: FAIL con `Failed to resolve import "@/lib/copiloto/modo"`.

- [ ] **Step 3: Implementar**

Crear `src/types/copiloto.ts`:

```ts
/** Preferencia por conversación. `null` en la base = "Según horario". */
export const MODOS_OVERRIDE = ["copiloto", "automatico"] as const;
export type ModoOverride = (typeof MODOS_OVERRIDE)[number];

/**
 * Qué hace el pipeline con un mensaje entrante (§3.2):
 * - `copiloto`: la IA redacta un borrador; no se manda nada por la API.
 * - `automatico`: la IA contesta por la API, como siempre.
 * - `fuera_de_horario`: plantilla de fuera de horario si hay, o nada; sin LLM.
 */
export type ModoDecidido = "copiloto" | "automatico" | "fuera_de_horario";
```

Crear `src/lib/copiloto/modo.ts`:

```ts
import { esTimezoneValida, estaAbierto, tieneAlgunRango } from "@/lib/agente/horario";
import type { Horario } from "@/types/agente";
import type { ModoDecidido, ModoOverride } from "@/types/copiloto";

/**
 * La regla de §3.2 en una frase: "Copiloto" fijo es siempre Copiloto;
 * "Automático" fijo es Automático si el agente está abierto y Fuera de horario
 * si no; "Según horario" (`override = null`) es Copiloto si el equipo está
 * abierto, si no Automático si el agente está abierto, y si no Fuera de horario.
 */
export function decidirModo(input: {
  override: ModoOverride | null;
  equipoAbierto: boolean;
  agenteAbierto: boolean;
}): ModoDecidido {
  if (input.override === "copiloto") return "copiloto";
  if (input.override === "automatico") {
    return input.agenteAbierto ? "automatico" : "fuera_de_horario";
  }
  if (input.equipoAbierto) return "copiloto";
  return input.agenteAbierto ? "automatico" : "fuera_de_horario";
}

/**
 * ¿Hay personas del equipo ahora? Zona inválida o sin un solo rango cuenta como
 * equipo cerrado: `estaAbierto` devuelve `true` ante una zona inválida (para el
 * agente es lo seguro: no callar al cliente), pero para el equipo sería declarar
 * presencia que nadie tiene y dejar mensajes esperando un borrador que nadie
 * envía.
 */
export function equipoAbiertoAhora(
  config: { horario_equipo: Horario; horario_timezone: string },
  ahora: Date,
): boolean {
  return (
    esTimezoneValida(config.horario_timezone) &&
    tieneAlgunRango(config.horario_equipo) &&
    estaAbierto(config.horario_equipo, config.horario_timezone, ahora)
  );
}
```

- [ ] **Step 4: Ver pasar y commit**

```bash
npx vitest run tests/unit/copiloto/modo.test.ts 2>&1 | tail -8
npm run typecheck
```

Expected: `Tests  18 passed` (12 de la tabla + 1 de cobertura de la tabla + 5 de `equipoAbiertoAhora`) y typecheck exit 0.

```bash
git add src/types/copiloto.ts src/lib/copiloto/modo.ts tests/unit/copiloto/modo.test.ts
git commit -m "feat(copiloto): decidirModo con la tabla de §3.2" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Task 4: El override de modo en `Conversacion` (entidad, repos InMemory y Supabase, contract)

**Worker sugerido:** `worker-medium`.
**Depende de:** T1 (columna y tipos) y T3 (`ModoOverride`).
**Skills a cargar antes:** `superpowers:test-driven-development`.

**Files:**

- Modify: `src/types/entities.ts`, `src/lib/validation/schemas.ts`, `src/server/repositories/conversations.repo.ts`, `src/server/repositories/conversations.supabase.repo.ts`, y los tests que construyan un `Conversacion` literal y rompan el typecheck (se encuentran en el Step 5)
- Test: `tests/repositories/conversations.contract.ts`, `tests/integration/conversations.supabase.test.ts`

**Interfaces:**

- Consumes: `ModoOverride` (T3), columna `conversaciones.modo_respuesta_override` (T1).
- Produces (T6, T8): `Conversacion.modo_respuesta_override: ModoOverride | null`; `ConversationsRepository.update(id, { modo_respuesta_override: ModoOverride | null })` (ya cabe en `ConversacionUpdate`); `ConversacionInsert` **no** incluye el campo (toda conversación nace en `null` = "Según horario").

- [ ] **Step 1: Agregar los tests al contract (fallan)**

En `tests/repositories/conversations.contract.ts`, dentro de `runConversationsContract` (después del test `update throws cuando id falta`):

```ts
test("create arranca sin override: Según horario", async () => {
  const c = await repo.create(baseInsert(fixtures.leadIds.one));
  expect(c.modo_respuesta_override).toBeNull();
  expect((await repo.findById(c.id))?.modo_respuesta_override).toBeNull();
});

test("update fija el override y `null` lo limpia", async () => {
  const c = await repo.create(baseInsert(fixtures.leadIds.one));

  const fijada = await repo.update(c.id, { modo_respuesta_override: "copiloto" });
  expect(fijada.modo_respuesta_override).toBe("copiloto");
  expect((await repo.findById(c.id))?.modo_respuesta_override).toBe("copiloto");

  const limpia = await repo.update(c.id, { modo_respuesta_override: null });
  expect(limpia.modo_respuesta_override).toBeNull();
  expect((await repo.findById(c.id))?.modo_respuesta_override).toBeNull();
});

test("otro update y touch no tocan el override", async () => {
  const c = await repo.create(baseInsert(fixtures.leadIds.one));
  await repo.update(c.id, { modo_respuesta_override: "automatico" });

  await repo.touch(c.id);
  await repo.update(c.id, { lead_id: fixtures.leadIds.one });

  expect((await repo.findById(c.id))?.modo_respuesta_override).toBe("automatico");
});
```

En `tests/integration/conversations.supabase.test.ts`, al final del archivo antes de `async function seedFixtures`:

```ts
describe("modo_respuesta_override (solo Postgres)", () => {
  test("el CHECK de la base rechaza un modo fuera del dominio (23514)", async () => {
    const { data, error } = await client
      .from("conversaciones")
      .insert({
        lead_id: fixtures.leadIds.one,
        canal: "wa",
        canal_thread_id: "check-modo-1",
        modo_respuesta_override: "otro" as never,
      })
      .select();

    expect(data).toBeNull();
    expect(error?.code).toBe("23514");
  });
});
```

- [ ] **Step 2: Ver fallar**

```bash
npx vitest run tests/unit/conversations.in-memory.test.ts 2>&1 | tail -20
```

Expected: FAIL en los tres tests nuevos (`expected undefined to be null` / `Cannot read properties of undefined`).

- [ ] **Step 3: Implementar entidad y repos**

`src/types/entities.ts`: agregar al bloque de imports `import type { ModoOverride } from "./copiloto";` y en `interface Conversacion`:

```ts
export interface Conversacion {
  id: UUID;
  lead_id: UUID;
  canal: Canal;
  canal_thread_id: string;
  ultima_actividad_at: Date;
  /**
   * Preferencia del equipo para esta conversación (`null` = "Según horario").
   * Vive acá y no en la sesión: la sesión se cierra y se purga a los 29 días, y
   * atender un chat a mano tiene que sobrevivir a una sesión nueva del hilo.
   */
  modo_respuesta_override: ModoOverride | null;
}
```

`src/lib/validation/schemas.ts`: importar `MODOS_OVERRIDE` de `@/types/copiloto` y agregar a `ConversacionSchema`: `modo_respuesta_override: z.enum(MODOS_OVERRIDE).nullable(),`.

`src/server/repositories/conversations.repo.ts`:

```ts
export type ConversacionInsert = Insert<
  Conversacion,
  "id" | "ultima_actividad_at" | "modo_respuesta_override"
>;
```

y en `InMemoryConversationsRepository.create`:

```ts
const conv: Conversacion = {
  ...input,
  id: crypto.randomUUID(),
  ultima_actividad_at: new Date(),
  modo_respuesta_override: null,
};
```

`src/server/repositories/conversations.supabase.repo.ts`:

- en `update`, después del bloque de `ultima_actividad_at`:

```ts
// `null` es un valor (vuelve a "Según horario"); `undefined` es "no tocar".
if (patch.modo_respuesta_override !== undefined) {
  updatePayload.modo_respuesta_override = patch.modo_respuesta_override;
}
```

- `interface ConversacionRow` gana `modo_respuesta_override: string | null;` y `mapRow`:

```ts
    modo_respuesta_override:
      row.modo_respuesta_override === "copiloto" || row.modo_respuesta_override === "automatico"
        ? row.modo_respuesta_override
        : null,
```

(El CHECK de la base impide otro valor; el `: null` es el fallback de tipos, no un camino esperado.)

- [ ] **Step 4: Ver pasar el contract InMemory**

```bash
npx vitest run tests/unit/conversations.in-memory.test.ts 2>&1 | tail -10
```

Expected: PASS (todos, incluidos los 3 nuevos).

- [ ] **Step 5: Typecheck y arreglar los literales de `Conversacion`**

```bash
npm run typecheck 2>&1 | tail -30
```

Expected: puede fallar en tests/fixtures que arman un `Conversacion` completo sin `as` (la búsqueda previa solo halló `tests/unit/workflows/disparos-periodicos.test.ts:180`, que ya usa `as Conversacion` y no rompe). Para cada error `Property 'modo_respuesta_override' is missing`, agregar `modo_respuesta_override: null` al literal. Repetir hasta exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/types/entities.ts src/lib/validation/schemas.ts src/server/repositories/conversations.repo.ts src/server/repositories/conversations.supabase.repo.ts tests/repositories/conversations.contract.ts tests/integration/conversations.supabase.test.ts
git commit -m "feat(copiloto): override de modo por conversación en el repo" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(Si el Step 5 tocó otros archivos, agregarlos por ruta explícita.)

---

## Task 5: `BorradoresIaRepository` (interface, InMemory, Supabase, contract, integración y RLS)

**Worker sugerido:** `worker-high` (concurrencia, RPC, RLS).
**Depende de:** T1 (tabla, RPC, tipos).
**Skills a cargar antes:** `superpowers:test-driven-development`, `supabase:supabase`, `supabase:supabase-postgres-best-practices`.

**Files:**

- Modify: `src/types/copiloto.ts`
- Create: `src/server/repositories/borradores-ia.repo.ts`, `src/server/repositories/borradores-ia.supabase.repo.ts`, `tests/repositories/borradores-ia.contract.ts`, `tests/unit/borradores-ia.in-memory.test.ts`, `tests/integration/borradores-ia.supabase.test.ts`, `tests/integration/copiloto-rls.supabase.test.ts`

**Interfaces:**

- Consumes: tabla `borradores_ia` y RPC `iniciar_borrador_ia` (T1).
- Produces (T6, T7, T8, T11): los tipos de abajo y

```ts
export interface BorradoresIaRepository {
  iniciar(input: IniciarBorradorInput): Promise<ResultadoIniciar>;
  completar(id: UUID, input: CompletarBorradorInput): Promise<BorradorIa | null>;
  marcarError(id: UUID, codigo: string): Promise<BorradorIa | null>;
  descartar(id: UUID): Promise<boolean>;
  descartarVigentes(conversacionId: UUID): Promise<number>;
  marcarUsado(id: UUID, input: MarcarUsadoInput): Promise<ResultadoMarcarUsado>;
  findById(id: UUID): Promise<BorradorIa | null>;
  findActualByConversacion(conversacionId: UUID): Promise<BorradorIa | null>;
  listListosPorConversacionIds(conversacionIds: readonly UUID[]): Promise<UUID[]>;
}
export class InMemoryBorradoresIaRepository implements BorradoresIaRepository {
  constructor(ultimoEntrante?: ResolverUltimoEntrante | null);
}
```

- [ ] **Step 1: Tipos del dominio**

Agregar a `src/types/copiloto.ts`:

```ts
import type { UUID } from "./entities";

export const ESTADOS_BORRADOR = ["redactando", "listo", "usado", "error", "descartado"] as const;
export type EstadoBorrador = (typeof ESTADOS_BORRADOR)[number];

/** Los que compiten por el índice único parcial: a lo sumo uno por conversación. */
export const ESTADOS_VIGENTES = ["redactando", "listo", "error"] as const;

export const ORIGENES_BORRADOR = ["ia", "regla"] as const;
export type OrigenBorrador = (typeof ORIGENES_BORRADOR)[number];

export const VIAS_USO_BORRADOR = ["insertar", "copiar", "abrir_web", "al_composer"] as const;
export type ViaUsoBorrador = (typeof VIAS_USO_BORRADOR)[number];

/** Una respuesta que la IA redactó en modo Copiloto (`borradores_ia`). */
export interface BorradorIa {
  id: UUID;
  conversacion_id: UUID;
  lead_session_id: UUID;
  /** El entrante que lo disparó. */
  mensaje_origen_id: UUID;
  estado: EstadoBorrador;
  /** Texto de la respuesta. Nunca se loguea. `null` mientras redacta o si falló. */
  contenido: string | null;
  origen: OrigenBorrador | null;
  regla_id: UUID | null;
  /** Código corto (`llm_error`, `tope_diario`…), nunca texto del proveedor. */
  error_codigo: string | null;
  usado_at: Date | null;
  usado_via: ViaUsoBorrador | null;
  usado_por: UUID | null;
  created_at: Date;
  updated_at: Date;
}
```

- [ ] **Step 2: Escribir el contract reusable (falla: no existe el repo)**

Crear `tests/repositories/borradores-ia.contract.ts`:

```ts
import { beforeEach, describe, expect, test } from "vitest";
import type {
  BorradoresIaRepository,
  ResultadoIniciar,
} from "@/server/repositories/borradores-ia.repo";
import type { UUID } from "@/types/entities";

export interface BorradoresIaContractFixtures {
  conversacionId: UUID;
  otraConversacionId: UUID;
  leadSessionId: UUID;
  otraLeadSessionId: UUID;
  usuarioId: UUID;
  reglaId: UUID;
  /** El entrante con el que arranca `conversacionId` (es el último hasta que llegue otro). */
  primerEntranteId: UUID;
  /** El (único) entrante de `otraConversacionId`. */
  entranteDeOtraId: UUID;
  /** Hace llegar un entrante nuevo a `conversacionId`: pasa a ser el último. */
  nuevoEntrante(): Promise<UUID>;
}

export type BorradoresIaContractFixturesArg =
  | BorradoresIaContractFixtures
  | (() => BorradoresIaContractFixtures | Promise<BorradoresIaContractFixtures>);

function idDe(r: ResultadoIniciar): UUID {
  if (r.resultado === "obsoleto") throw new Error("se esperaba un borrador y salió 'obsoleto'");
  return r.borradorId;
}

export function runBorradoresIaContract(
  makeRepo: () => BorradoresIaRepository,
  fixturesArg: BorradoresIaContractFixturesArg,
) {
  describe("BorradoresIaRepository contract", () => {
    let repo: BorradoresIaRepository;
    let f: BorradoresIaContractFixtures;

    beforeEach(async () => {
      repo = makeRepo();
      f = typeof fixturesArg === "function" ? await fixturesArg() : fixturesArg;
    });

    const arrancar = (mensajeOrigenId?: UUID, extra: { forzar?: boolean } = {}) =>
      repo.iniciar({
        conversacionId: f.conversacionId,
        leadSessionId: f.leadSessionId,
        mensajeOrigenId: mensajeOrigenId ?? f.primerEntranteId,
        ...extra,
      });

    test("iniciar crea un borrador redactando para el último entrante", async () => {
      const r = await arrancar();
      expect(r.resultado).toBe("creado");

      const b = await repo.findById(idDe(r));
      expect(b).toMatchObject({
        estado: "redactando",
        conversacion_id: f.conversacionId,
        lead_session_id: f.leadSessionId,
        mensaje_origen_id: f.primerEntranteId,
        contenido: null,
        origen: null,
        regla_id: null,
        error_codigo: null,
        usado_at: null,
      });
      expect(b?.created_at).toBeInstanceOf(Date);
    });

    test("iniciar es idempotente por mensaje_origen_id (R6)", async () => {
      const primera = await arrancar();
      const segunda = await arrancar();

      expect(segunda).toEqual({
        resultado: "existente",
        borradorId: idDe(primera),
        estado: "redactando",
      });
    });

    test("un borrador ya usado tampoco se vuelve a arrancar solo", async () => {
      const id = idDe(await arrancar());
      await repo.completar(id, { contenido: "Listo", origen: "ia", reglaId: null });
      await repo.marcarUsado(id, { via: "copiar", usuarioId: f.usuarioId });

      const otra = await arrancar();

      expect(otra).toEqual({ resultado: "existente", borradorId: id, estado: "usado" });
    });

    test("forzar descarta el vigente y crea otro para el mismo entrante (Regenerar)", async () => {
      const id1 = idDe(await arrancar());
      const r2 = await arrancar(undefined, { forzar: true });

      expect(r2.resultado).toBe("creado");
      expect(idDe(r2)).not.toBe(id1);
      expect((await repo.findById(id1))?.estado).toBe("descartado");
      expect((await repo.findActualByConversacion(f.conversacionId))?.id).toBe(idDe(r2));
    });

    test("un origen que ya no es el último entrante es obsoleto y no crea nada", async () => {
      await f.nuevoEntrante();

      const r = await arrancar(f.primerEntranteId);

      expect(r).toEqual({ resultado: "obsoleto" });
      expect(await repo.findActualByConversacion(f.conversacionId)).toBeNull();
    });

    test("el borrador del mensaje nuevo reemplaza al vigente y el viejo no puede pisarlo", async () => {
      const id1 = idDe(await arrancar());
      const nuevo = await f.nuevoEntrante();
      const id2 = idDe(await arrancar(nuevo));

      expect((await repo.findById(id1))?.estado).toBe("descartado");
      expect((await repo.findActualByConversacion(f.conversacionId))?.id).toBe(id2);

      // El trabajo del turno viejo termina tarde: no debe resucitar su borrador.
      expect(
        await repo.completar(id1, { contenido: "respuesta vieja", origen: "ia", reglaId: null }),
      ).toBeNull();
      expect((await repo.findById(id1))?.contenido).toBeNull();

      const ok = await repo.completar(id2, {
        contenido: "respuesta nueva",
        origen: "ia",
        reglaId: null,
      });
      expect(ok?.estado).toBe("listo");
    });

    test("completar pasa redactando a listo con texto, origen y regla, y no se repite", async () => {
      const id = idDe(await arrancar());

      const b = await repo.completar(id, {
        contenido: "Hola, tenemos ese filtro.",
        origen: "regla",
        reglaId: f.reglaId,
      });

      expect(b).toMatchObject({
        estado: "listo",
        contenido: "Hola, tenemos ese filtro.",
        origen: "regla",
        regla_id: f.reglaId,
      });
      expect(
        await repo.completar(id, { contenido: "otra", origen: "ia", reglaId: null }),
      ).toBeNull();
      expect((await repo.findById(id))?.contenido).toBe("Hola, tenemos ese filtro.");
    });

    test("marcarError solo desde redactando", async () => {
      const id = idDe(await arrancar());

      const e = await repo.marcarError(id, "llm_error");
      expect(e).toMatchObject({ estado: "error", error_codigo: "llm_error" });
      expect(await repo.marcarError(id, "tope_diario")).toBeNull();
      expect((await repo.findById(id))?.error_codigo).toBe("llm_error");
    });

    test("un borrador en error sigue vigente hasta que Regenerar lo reemplaza", async () => {
      const id1 = idDe(await arrancar());
      await repo.marcarError(id1, "llm_error");

      expect((await repo.findActualByConversacion(f.conversacionId))?.estado).toBe("error");

      const id2 = idDe(await arrancar(undefined, { forzar: true }));
      expect((await repo.findById(id1))?.estado).toBe("descartado");
      expect((await repo.findById(id2))?.estado).toBe("redactando");
    });

    test("marcarUsado funciona una sola vez", async () => {
      const id = idDe(await arrancar());
      await repo.completar(id, { contenido: "Texto", origen: "ia", reglaId: null });

      expect(await repo.marcarUsado(id, { via: "insertar", usuarioId: f.usuarioId })).toBe(
        "marcado",
      );
      expect(await repo.marcarUsado(id, { via: "copiar", usuarioId: f.usuarioId })).toBe(
        "ya_usado",
      );

      const b = await repo.findById(id);
      expect(b).toMatchObject({ estado: "usado", usado_via: "insertar", usado_por: f.usuarioId });
      expect(b?.usado_at).toBeInstanceOf(Date);
    });

    test("marcarUsado sobre un borrador que no está listo (o no existe) es no_disponible", async () => {
      const id = idDe(await arrancar()); // redactando

      expect(await repo.marcarUsado(id, { via: "copiar", usuarioId: f.usuarioId })).toBe(
        "no_disponible",
      );
      expect(
        await repo.marcarUsado(crypto.randomUUID(), { via: "copiar", usuarioId: f.usuarioId }),
      ).toBe("no_disponible");
    });

    test("usado no compite por el índice: después se puede arrancar el siguiente", async () => {
      const id1 = idDe(await arrancar());
      await repo.completar(id1, { contenido: "Uno", origen: "ia", reglaId: null });
      await repo.marcarUsado(id1, { via: "abrir_web", usuarioId: null });

      const nuevo = await f.nuevoEntrante();
      const r2 = await arrancar(nuevo);

      expect(r2.resultado).toBe("creado");
      expect((await repo.findById(id1))?.estado).toBe("usado");
      expect((await repo.findActualByConversacion(f.conversacionId))?.id).toBe(idDe(r2));
    });

    test("descartarVigentes descarta redactando/listo/error y no toca usado", async () => {
      const id1 = idDe(await arrancar());
      expect(await repo.descartarVigentes(f.conversacionId)).toBe(1);
      expect((await repo.findById(id1))?.estado).toBe("descartado");
      expect(await repo.descartarVigentes(f.conversacionId)).toBe(0);

      const nuevo = await f.nuevoEntrante();
      const id2 = idDe(await arrancar(nuevo));
      await repo.completar(id2, { contenido: "Dos", origen: "ia", reglaId: null });
      await repo.marcarUsado(id2, { via: "copiar", usuarioId: f.usuarioId });
      expect(await repo.descartarVigentes(f.conversacionId)).toBe(0);
      expect((await repo.findById(id2))?.estado).toBe("usado");
    });

    test("descartar pasa un vigente a descartado una sola vez", async () => {
      const id = idDe(await arrancar());
      expect(await repo.descartar(id)).toBe(true);
      expect(await repo.descartar(id)).toBe(false);
      expect((await repo.findById(id))?.estado).toBe("descartado");
    });

    test("findActualByConversacion devuelve el más reciente que no está descartado", async () => {
      const id1 = idDe(await arrancar());
      await repo.completar(id1, { contenido: "Uno", origen: "ia", reglaId: null });
      await repo.marcarUsado(id1, { via: "copiar", usuarioId: f.usuarioId });

      const nuevo = await f.nuevoEntrante();
      const id2 = idDe(await arrancar(nuevo));
      expect((await repo.findActualByConversacion(f.conversacionId))?.id).toBe(id2);

      await repo.descartar(id2);
      expect((await repo.findActualByConversacion(f.conversacionId))?.id).toBe(id1);
    });

    test("findById con un id inexistente devuelve null", async () => {
      expect(await repo.findById(crypto.randomUUID())).toBeNull();
      expect(await repo.findById("no-es-un-uuid")).toBeNull();
    });

    test("listListosPorConversacionIds devuelve solo las conversaciones con un borrador listo", async () => {
      const id = idDe(await arrancar());
      await repo.completar(id, { contenido: "Listo", origen: "ia", reglaId: null });
      await repo.iniciar({
        conversacionId: f.otraConversacionId,
        leadSessionId: f.otraLeadSessionId,
        mensajeOrigenId: f.entranteDeOtraId,
      }); // queda redactando

      expect(
        await repo.listListosPorConversacionIds([f.conversacionId, f.otraConversacionId]),
      ).toEqual([f.conversacionId]);
      expect(await repo.listListosPorConversacionIds([])).toEqual([]);
    });

    test("las conversaciones no se pisan entre sí", async () => {
      const a = idDe(await arrancar());
      const b = idDe(
        await repo.iniciar({
          conversacionId: f.otraConversacionId,
          leadSessionId: f.otraLeadSessionId,
          mensajeOrigenId: f.entranteDeOtraId,
        }),
      );

      expect((await repo.findActualByConversacion(f.conversacionId))?.id).toBe(a);
      expect((await repo.findActualByConversacion(f.otraConversacionId))?.id).toBe(b);
    });
  });
}
```

- [ ] **Step 3: Escribir el test InMemory y verlo fallar**

Crear `tests/unit/borradores-ia.in-memory.test.ts`:

```ts
import { InMemoryBorradoresIaRepository } from "@/server/repositories/borradores-ia.repo";
import {
  runBorradoresIaContract,
  type BorradoresIaContractFixtures,
} from "../repositories/borradores-ia.contract";

// Qué entrante es el último de cada conversación: el InMemory no tiene la tabla
// `mensajes`, así que la consulta del RPC se inyecta (mismo idioma que
// `resolverLeadId` del repo de mensajes).
const ultimoPorConversacion = new Map<string, string>();

function fixtures(): BorradoresIaContractFixtures {
  ultimoPorConversacion.clear();
  const f: BorradoresIaContractFixtures = {
    conversacionId: crypto.randomUUID(),
    otraConversacionId: crypto.randomUUID(),
    leadSessionId: crypto.randomUUID(),
    otraLeadSessionId: crypto.randomUUID(),
    usuarioId: crypto.randomUUID(),
    reglaId: crypto.randomUUID(),
    primerEntranteId: crypto.randomUUID(),
    entranteDeOtraId: crypto.randomUUID(),
    nuevoEntrante: async () => {
      const id = crypto.randomUUID();
      ultimoPorConversacion.set(f.conversacionId, id);
      return id;
    },
  };
  ultimoPorConversacion.set(f.conversacionId, f.primerEntranteId);
  ultimoPorConversacion.set(f.otraConversacionId, f.entranteDeOtraId);
  return f;
}

runBorradoresIaContract(
  () =>
    new InMemoryBorradoresIaRepository(
      (conversacionId) => ultimoPorConversacion.get(conversacionId) ?? null,
    ),
  fixtures,
);
```

```bash
npx vitest run tests/unit/borradores-ia.in-memory.test.ts 2>&1 | tail -10
```

Expected: FAIL con `Failed to resolve import "@/server/repositories/borradores-ia.repo"`.

- [ ] **Step 4: Implementar la interface y el InMemory**

Crear `src/server/repositories/borradores-ia.repo.ts`:

```ts
import {
  ESTADOS_VIGENTES,
  type BorradorIa,
  type EstadoBorrador,
  type OrigenBorrador,
  type ViaUsoBorrador,
} from "@/types/copiloto";
import type { UUID } from "@/types/entities";

/** Qué pasó al arrancar un borrador (espeja el RPC `iniciar_borrador_ia`). */
export type ResultadoIniciar =
  /** Descartó los vigentes de la conversación y creó uno `redactando`. */
  | { resultado: "creado"; borradorId: UUID }
  /** Ya había uno para ese entrante (idempotencia por `mensaje_origen_id`). */
  | { resultado: "existente"; borradorId: UUID; estado: EstadoBorrador }
  /** El entrante ya no es el último de la conversación: el más viejo no pisa al nuevo. */
  | { resultado: "obsoleto" };

export interface IniciarBorradorInput {
  conversacionId: UUID;
  leadSessionId: UUID;
  mensajeOrigenId: UUID;
  /** Regenerar / Reintentar: ignora el borrador que ya existe para ese entrante. */
  forzar?: boolean;
}

export interface CompletarBorradorInput {
  contenido: string;
  origen: OrigenBorrador;
  reglaId: UUID | null;
}

export interface MarcarUsadoInput {
  via: ViaUsoBorrador;
  usuarioId: UUID | null;
}

export type ResultadoMarcarUsado =
  /** Esta llamada lo pasó de `listo` a `usado`. */
  | "marcado"
  /** Ya estaba usado (otra llamada llegó antes): no repetir lo que sigue al uso. */
  | "ya_usado"
  /** No existe o no está `listo` (redactando, error, descartado). */
  | "no_disponible";

/**
 * Los borradores del copiloto (`borradores_ia`).
 *
 * Los escribe el pipeline y la función de Regenerar con service-role (`iniciar`,
 * `completar`, `marcarError`, `descartar*`); el panel, con el cliente
 * autenticado, solo lee y usa `marcarUsado` (la policy de update de la tabla
 * solo deja pasar `listo` → `usado`).
 *
 * Invariante: a lo sumo UN borrador vigente (`redactando | listo | error`) por
 * conversación. `completar` y `marcarError` son condicionales al estado
 * `redactando`: un turno viejo que termina tarde no puede resucitar un borrador
 * que otro ya reemplazó.
 */
export interface BorradoresIaRepository {
  iniciar(input: IniciarBorradorInput): Promise<ResultadoIniciar>;
  /** `null` si ya no estaba `redactando` (fue reemplazado o descartado). */
  completar(id: UUID, input: CompletarBorradorInput): Promise<BorradorIa | null>;
  /** `null` si ya no estaba `redactando`. `codigo` es un código corto, no texto libre. */
  marcarError(id: UUID, codigo: string): Promise<BorradorIa | null>;
  /** Pasa un vigente a `descartado`. `false` si ya no era vigente. */
  descartar(id: UUID): Promise<boolean>;
  /** Descarta los vigentes de la conversación. Devuelve cuántos. No toca `usado`. */
  descartarVigentes(conversacionId: UUID): Promise<number>;
  marcarUsado(id: UUID, input: MarcarUsadoInput): Promise<ResultadoMarcarUsado>;
  findById(id: UUID): Promise<BorradorIa | null>;
  /** El más reciente que no está descartado (vigente o usado). */
  findActualByConversacion(conversacionId: UUID): Promise<BorradorIa | null>;
  /** De estas conversaciones, las que tienen un borrador `listo`. */
  listListosPorConversacionIds(conversacionIds: readonly UUID[]): Promise<UUID[]>;
}

/** Quién es el último entrante de una conversación (lo resuelve el RPC en la base). */
export type ResolverUltimoEntrante = (conversacionId: UUID) => Promise<UUID | null> | UUID | null;

function esVigente(estado: EstadoBorrador): boolean {
  return (ESTADOS_VIGENTES as readonly string[]).includes(estado);
}

function copia(b: BorradorIa): BorradorIa {
  return {
    ...b,
    created_at: new Date(b.created_at),
    updated_at: new Date(b.updated_at),
    usado_at: b.usado_at === null ? null : new Date(b.usado_at),
  };
}

export class InMemoryBorradoresIaRepository implements BorradoresIaRepository {
  private readonly store = new Map<UUID, BorradorIa>();
  /** Orden de inserción: desempata `created_at` dentro de la misma milésima. */
  private readonly orden = new Map<UUID, number>();
  private contador = 0;

  /**
   * `ultimoEntrante` es opcional: sin él, cualquier entrante cuenta como el
   * último (no se prueba `obsoleto`). Los tests que sí lo necesitan inyectan la
   * consulta a su repo de mensajes, como hace el RPC con la tabla `mensajes`.
   */
  constructor(private readonly ultimoEntrante: ResolverUltimoEntrante | null = null) {}

  private masNuevoPrimero = (a: BorradorIa, b: BorradorIa): number =>
    (this.orden.get(b.id) ?? 0) - (this.orden.get(a.id) ?? 0);

  async iniciar(input: IniciarBorradorInput): Promise<ResultadoIniciar> {
    if (this.ultimoEntrante !== null) {
      const ultimo = await this.ultimoEntrante(input.conversacionId);
      if (ultimo !== input.mensajeOrigenId) return { resultado: "obsoleto" };
    }

    const previo = [...this.store.values()]
      .filter((b) => b.mensaje_origen_id === input.mensajeOrigenId && b.estado !== "descartado")
      .sort(this.masNuevoPrimero)[0];
    if (previo && input.forzar !== true) {
      return { resultado: "existente", borradorId: previo.id, estado: previo.estado };
    }

    const ahora = new Date();
    for (const b of this.store.values()) {
      if (b.conversacion_id === input.conversacionId && esVigente(b.estado)) {
        b.estado = "descartado";
        b.updated_at = ahora;
      }
    }

    const fila: BorradorIa = {
      id: crypto.randomUUID(),
      conversacion_id: input.conversacionId,
      lead_session_id: input.leadSessionId,
      mensaje_origen_id: input.mensajeOrigenId,
      estado: "redactando",
      contenido: null,
      origen: null,
      regla_id: null,
      error_codigo: null,
      usado_at: null,
      usado_via: null,
      usado_por: null,
      created_at: ahora,
      updated_at: ahora,
    };
    this.store.set(fila.id, fila);
    this.orden.set(fila.id, ++this.contador);
    return { resultado: "creado", borradorId: fila.id };
  }

  async completar(id: UUID, input: CompletarBorradorInput): Promise<BorradorIa | null> {
    const b = this.store.get(id);
    if (!b || b.estado !== "redactando") return null;
    b.estado = "listo";
    b.contenido = input.contenido;
    b.origen = input.origen;
    b.regla_id = input.reglaId;
    b.updated_at = new Date();
    return copia(b);
  }

  async marcarError(id: UUID, codigo: string): Promise<BorradorIa | null> {
    const b = this.store.get(id);
    if (!b || b.estado !== "redactando") return null;
    b.estado = "error";
    b.error_codigo = codigo;
    b.updated_at = new Date();
    return copia(b);
  }

  async descartar(id: UUID): Promise<boolean> {
    const b = this.store.get(id);
    if (!b || !esVigente(b.estado)) return false;
    b.estado = "descartado";
    b.updated_at = new Date();
    return true;
  }

  async descartarVigentes(conversacionId: UUID): Promise<number> {
    let n = 0;
    for (const b of this.store.values()) {
      if (b.conversacion_id === conversacionId && esVigente(b.estado)) {
        b.estado = "descartado";
        b.updated_at = new Date();
        n += 1;
      }
    }
    return n;
  }

  async marcarUsado(id: UUID, input: MarcarUsadoInput): Promise<ResultadoMarcarUsado> {
    const b = this.store.get(id);
    if (!b) return "no_disponible";
    if (b.estado === "usado") return "ya_usado";
    if (b.estado !== "listo") return "no_disponible";
    const ahora = new Date();
    b.estado = "usado";
    b.usado_via = input.via;
    b.usado_por = input.usuarioId;
    b.usado_at = ahora;
    b.updated_at = ahora;
    return "marcado";
  }

  async findById(id: UUID): Promise<BorradorIa | null> {
    const b = this.store.get(id);
    return b ? copia(b) : null;
  }

  async findActualByConversacion(conversacionId: UUID): Promise<BorradorIa | null> {
    const b = [...this.store.values()]
      .filter((x) => x.conversacion_id === conversacionId && x.estado !== "descartado")
      .sort(this.masNuevoPrimero)[0];
    return b ? copia(b) : null;
  }

  async listListosPorConversacionIds(conversacionIds: readonly UUID[]): Promise<UUID[]> {
    const buscadas = new Set(conversacionIds);
    const salida = new Set<UUID>();
    for (const b of this.store.values()) {
      if (b.estado === "listo" && buscadas.has(b.conversacion_id)) salida.add(b.conversacion_id);
    }
    return [...salida];
  }
}
```

- [ ] **Step 5: Ver pasar el contract InMemory**

```bash
npx vitest run tests/unit/borradores-ia.in-memory.test.ts 2>&1 | tail -10
```

Expected: `Tests  18 passed`.

- [ ] **Step 6: Implementar el repo Supabase**

Crear `src/server/repositories/borradores-ia.supabase.repo.ts`:

```ts
import { InfraError, NotFoundError } from "@/lib/errors";
import type { AppClient } from "@/server/db/client";
import { mapPostgrestError } from "@/server/db/postgrest-errors";
import { isUuid } from "@/server/db/uuid";
import {
  ESTADOS_BORRADOR,
  ESTADOS_VIGENTES,
  ORIGENES_BORRADOR,
  VIAS_USO_BORRADOR,
  type BorradorIa,
  type EstadoBorrador,
  type OrigenBorrador,
  type ViaUsoBorrador,
} from "@/types/copiloto";
import type { UUID } from "@/types/entities";
import type {
  BorradoresIaRepository,
  CompletarBorradorInput,
  IniciarBorradorInput,
  MarcarUsadoInput,
  ResultadoIniciar,
  ResultadoMarcarUsado,
} from "./borradores-ia.repo";

const TABLA = "borradores_ia";
/** Mismo criterio que `IDS_POR_TANDA` de conversaciones: 100 uuids caben en cualquier proxy. */
const IDS_POR_TANDA = 100;

interface Row {
  id: string;
  conversacion_id: string;
  lead_session_id: string;
  mensaje_origen_id: string;
  estado: string;
  contenido: string | null;
  origen: string | null;
  regla_id: string | null;
  error_codigo: string | null;
  usado_at: string | null;
  usado_via: string | null;
  usado_por: string | null;
  created_at: string;
  updated_at: string;
}

function enLista<T extends string>(lista: readonly T[], valor: string | null): T | null {
  return valor !== null && (lista as readonly string[]).includes(valor) ? (valor as T) : null;
}

function mapRow(row: Row): BorradorIa {
  const estado = enLista<EstadoBorrador>(ESTADOS_BORRADOR, row.estado);
  // El CHECK de la tabla lo impide: otro valor es la base y el código divergiendo.
  if (estado === null)
    throw new InfraError(`borradores_ia.estado desconocido: ${row.estado}`, TABLA);
  return {
    id: row.id,
    conversacion_id: row.conversacion_id,
    lead_session_id: row.lead_session_id,
    mensaje_origen_id: row.mensaje_origen_id,
    estado,
    contenido: row.contenido,
    origen: enLista<OrigenBorrador>(ORIGENES_BORRADOR, row.origen),
    regla_id: row.regla_id,
    error_codigo: row.error_codigo,
    usado_at: row.usado_at === null ? null : new Date(row.usado_at),
    usado_via: enLista<ViaUsoBorrador>(VIAS_USO_BORRADOR, row.usado_via),
    usado_por: row.usado_por,
    created_at: new Date(row.created_at),
    updated_at: new Date(row.updated_at),
  };
}

/**
 * Supabase impl de `BorradoresIaRepository`.
 *
 * `iniciar` es el RPC `iniciar_borrador_ia` (lock a la conversación + chequeo del
 * último entrante + descarte de vigentes + insert, todo en una transacción). El
 * resto son UPDATE condicionales al estado: la garantía de que un turno viejo no
 * pisa a uno nuevo vive en el `WHERE estado = 'redactando'`, no en el llamador.
 */
export class SupabaseBorradoresIaRepository implements BorradoresIaRepository {
  constructor(private readonly db: AppClient) {}

  async iniciar(input: IniciarBorradorInput): Promise<ResultadoIniciar> {
    const { data, error } = await this.db.rpc("iniciar_borrador_ia", {
      p_conversacion_id: input.conversacionId,
      p_lead_session_id: input.leadSessionId,
      p_mensaje_origen_id: input.mensajeOrigenId,
      p_forzar: input.forzar === true,
    });
    if (error) {
      // P0002 = `no_data_found`: la conversación no existe.
      if (error.code === "P0002") {
        throw new NotFoundError(
          `conversación no encontrada: ${input.conversacionId}`,
          "conversacion",
          input.conversacionId,
        );
      }
      throw mapPostgrestError(error, { resource: "borrador_ia" });
    }
    const fila = (
      data as unknown as
        | { out_id: string | null; out_resultado: string; out_estado: string | null }[]
        | null
    )?.[0];
    if (!fila) throw new InfraError("iniciar_borrador_ia no devolvió fila", TABLA);

    if (fila.out_resultado === "obsoleto" || fila.out_id === null) return { resultado: "obsoleto" };
    if (fila.out_resultado === "existente") {
      const estado = enLista<EstadoBorrador>(ESTADOS_BORRADOR, fila.out_estado);
      if (estado === null) throw new InfraError(`estado desconocido: ${fila.out_estado}`, TABLA);
      return { resultado: "existente", borradorId: fila.out_id, estado };
    }
    return { resultado: "creado", borradorId: fila.out_id };
  }

  async completar(id: UUID, input: CompletarBorradorInput): Promise<BorradorIa | null> {
    if (!isUuid(id)) return null;
    const { data, error } = await this.db
      .from(TABLA)
      .update({
        estado: "listo",
        contenido: input.contenido,
        origen: input.origen,
        regla_id: input.reglaId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("estado", "redactando")
      .select()
      .maybeSingle();
    if (error) throw mapPostgrestError(error, { resource: "borrador_ia" });
    return data ? mapRow(data as Row) : null;
  }

  async marcarError(id: UUID, codigo: string): Promise<BorradorIa | null> {
    if (!isUuid(id)) return null;
    const { data, error } = await this.db
      .from(TABLA)
      .update({ estado: "error", error_codigo: codigo, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("estado", "redactando")
      .select()
      .maybeSingle();
    if (error) throw mapPostgrestError(error, { resource: "borrador_ia" });
    return data ? mapRow(data as Row) : null;
  }

  async descartar(id: UUID): Promise<boolean> {
    if (!isUuid(id)) return false;
    const { data, error } = await this.db
      .from(TABLA)
      .update({ estado: "descartado", updated_at: new Date().toISOString() })
      .eq("id", id)
      .in("estado", [...ESTADOS_VIGENTES])
      .select("id");
    if (error) throw mapPostgrestError(error, { resource: "borrador_ia" });
    return (data ?? []).length > 0;
  }

  async descartarVigentes(conversacionId: UUID): Promise<number> {
    if (!isUuid(conversacionId)) return 0;
    const { data, error } = await this.db
      .from(TABLA)
      .update({ estado: "descartado", updated_at: new Date().toISOString() })
      .eq("conversacion_id", conversacionId)
      .in("estado", [...ESTADOS_VIGENTES])
      .select("id");
    if (error) throw mapPostgrestError(error, { resource: "borrador_ia" });
    return (data ?? []).length;
  }

  async marcarUsado(id: UUID, input: MarcarUsadoInput): Promise<ResultadoMarcarUsado> {
    if (!isUuid(id)) return "no_disponible";
    const ahora = new Date().toISOString();
    // La policy `borradores_ia_update_uso` solo deja pasar `listo` -> `usado`: si
    // otra llamada llegó antes, esta afecta 0 filas sin error.
    const { data, error } = await this.db
      .from(TABLA)
      .update({
        estado: "usado",
        usado_via: input.via,
        usado_por: input.usuarioId,
        usado_at: ahora,
        updated_at: ahora,
      })
      .eq("id", id)
      .eq("estado", "listo")
      .select("id");
    if (error) throw mapPostgrestError(error, { resource: "borrador_ia" });
    if ((data ?? []).length > 0) return "marcado";

    const actual = await this.findById(id);
    return actual?.estado === "usado" ? "ya_usado" : "no_disponible";
  }

  async findById(id: UUID): Promise<BorradorIa | null> {
    if (!isUuid(id)) return null;
    const { data, error } = await this.db.from(TABLA).select().eq("id", id).maybeSingle();
    if (error) throw mapPostgrestError(error, { resource: "borrador_ia" });
    return data ? mapRow(data as Row) : null;
  }

  async findActualByConversacion(conversacionId: UUID): Promise<BorradorIa | null> {
    if (!isUuid(conversacionId)) return null;
    const { data, error } = await this.db
      .from(TABLA)
      .select()
      .eq("conversacion_id", conversacionId)
      .neq("estado", "descartado")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw mapPostgrestError(error, { resource: "borrador_ia" });
    return data ? mapRow(data as Row) : null;
  }

  async listListosPorConversacionIds(conversacionIds: readonly UUID[]): Promise<UUID[]> {
    const limpios = conversacionIds.filter(isUuid);
    const salida = new Set<UUID>();
    for (let i = 0; i < limpios.length; i += IDS_POR_TANDA) {
      const { data, error } = await this.db
        .from(TABLA)
        .select("conversacion_id")
        .eq("estado", "listo")
        .in("conversacion_id", limpios.slice(i, i + IDS_POR_TANDA));
      if (error) throw mapPostgrestError(error, { resource: "borrador_ia" });
      for (const fila of data ?? [])
        salida.add((fila as { conversacion_id: string }).conversacion_id);
    }
    return [...salida];
  }
}
```

- [ ] **Step 7: Integración contra Postgres (contract + garantías que solo existen en la base)**

Crear `tests/integration/borradores-ia.supabase.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { SupabaseBorradoresIaRepository } from "@/server/repositories/borradores-ia.supabase.repo";
import {
  runBorradoresIaContract,
  type BorradoresIaContractFixtures,
} from "../repositories/borradores-ia.contract";
import { sembrarCadena, sembrarIntent, sembrarMensaje, sembrarRegla } from "./fixtures";
import { cleanupTestDb, makeTestSupabaseClient, type TestClient } from "./setup";

let client: TestClient;

beforeAll(async () => {
  client = makeTestSupabaseClient();
  await cleanupTestDb(client);
});

afterAll(async () => {
  await cleanupTestDb(client);
});

/** Cadena nueva por test: cada uno arranca con su "último entrante" propio. */
async function nuevasFixtures(): Promise<BorradoresIaContractFixtures> {
  const a = await sembrarCadena(client, "borr-a");
  const b = await sembrarCadena(client, "borr-b");
  const usuarioId = crypto.randomUUID();
  const { error } = await client.from("usuarios").insert({
    id: usuarioId,
    nombre: "Borradores Fixture",
    email: `borradores-${usuarioId}@test.local`,
    rol: "vendedor" as const,
  });
  if (error) throw new Error(`seed usuarios: ${error.message}`);
  const intentId = await sembrarIntent(client, `borr-${crypto.randomUUID().slice(0, 8)}`);
  const reglaId = await sembrarRegla(client, intentId);
  return {
    conversacionId: a.conversacionId,
    otraConversacionId: b.conversacionId,
    leadSessionId: a.sesionId,
    otraLeadSessionId: b.sesionId,
    usuarioId,
    reglaId,
    primerEntranteId: a.mensajeId,
    entranteDeOtraId: b.mensajeId,
    nuevoEntrante: () => sembrarMensaje(client, a.conversacionId, a.sesionId, "otro mensaje"),
  };
}

describe("SupabaseBorradoresIaRepository (integration)", () => {
  runBorradoresIaContract(() => new SupabaseBorradoresIaRepository(client), nuevasFixtures);
});

describe("garantías que solo existen contra Postgres", () => {
  test("dos iniciar concurrentes para el mismo entrante: uno crea, el otro ve 'existente', y queda UN vigente", async () => {
    const f = await nuevasFixtures();
    const repo = new SupabaseBorradoresIaRepository(client);
    const input = {
      conversacionId: f.conversacionId,
      leadSessionId: f.leadSessionId,
      mensajeOrigenId: f.primerEntranteId,
    };

    const [a, b] = await Promise.all([repo.iniciar(input), repo.iniciar(input)]);

    expect([a.resultado, b.resultado].sort()).toEqual(["creado", "existente"]);
    const { count } = await client
      .from("borradores_ia")
      .select("id", { count: "exact", head: true })
      .eq("conversacion_id", f.conversacionId)
      .in("estado", ["redactando", "listo", "error"]);
    expect(count).toBe(1);
  });

  test("el índice único parcial rechaza un segundo vigente insertado a mano (23505)", async () => {
    const f = await nuevasFixtures();
    const base = {
      conversacion_id: f.conversacionId,
      lead_session_id: f.leadSessionId,
      mensaje_origen_id: f.primerEntranteId,
      estado: "listo" as const,
      contenido: "uno",
      origen: "ia" as const,
    };
    const primero = await client.from("borradores_ia").insert(base);
    expect(primero.error).toBeNull();

    const segundo = await client.from("borradores_ia").insert({ ...base, contenido: "dos" });
    expect(segundo.error?.code).toBe("23505");
  });

  test("los CHECK rechazan estados incoherentes (23514)", async () => {
    const f = await nuevasFixtures();
    const base = {
      conversacion_id: f.conversacionId,
      lead_session_id: f.leadSessionId,
      mensaje_origen_id: f.primerEntranteId,
    };

    const listoSinTexto = await client.from("borradores_ia").insert({ ...base, estado: "listo" });
    expect(listoSinTexto.error?.code).toBe("23514");

    const errorConTextoLibre = await client
      .from("borradores_ia")
      .insert({ ...base, estado: "error", error_codigo: "El proveedor dijo: 500 Internal" });
    expect(errorConTextoLibre.error?.code).toBe("23514");

    const usadoSinVia = await client.from("borradores_ia").insert({ ...base, estado: "usado" });
    expect(usadoSinVia.error?.code).toBe("23514");
  });

  test("borrar la conversación borra sus borradores (CASCADE)", async () => {
    const f = await nuevasFixtures();
    const repo = new SupabaseBorradoresIaRepository(client);
    await repo.iniciar({
      conversacionId: f.conversacionId,
      leadSessionId: f.leadSessionId,
      mensajeOrigenId: f.primerEntranteId,
    });

    const del = await client.from("conversaciones").delete().eq("id", f.conversacionId);
    expect(del.error).toBeNull();

    const { count } = await client
      .from("borradores_ia")
      .select("id", { count: "exact", head: true })
      .eq("conversacion_id", f.conversacionId);
    expect(count).toBe(0);
  });

  test("iniciar sobre una conversación inexistente lanza NotFoundError", async () => {
    const f = await nuevasFixtures();
    const repo = new SupabaseBorradoresIaRepository(client);
    await expect(
      repo.iniciar({
        conversacionId: crypto.randomUUID(),
        leadSessionId: f.leadSessionId,
        mensajeOrigenId: f.primerEntranteId,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
```

- [ ] **Step 8: RLS (vendedor, admin, sin rol) y el RPC cerrado al panel**

Crear `tests/integration/copiloto-rls.supabase.test.ts`:

```ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { SupabaseBorradoresIaRepository } from "@/server/repositories/borradores-ia.supabase.repo";
import type { Database } from "@/server/db/types.gen";
import { sembrarCadena } from "./fixtures";
import { cleanupTestDb, makeTestSupabaseClient, type TestClient } from "./setup";

type Authed = SupabaseClient<Database>;

const PASSWORD = "copiloto-rls-test-2026!secret";
const EMAILS = {
  admin: "copiloto-rls-admin@crm.local",
  vendedor: "copiloto-rls-vendedor@crm.local",
  sinRol: "copiloto-rls-sinrol@crm.local",
} as const;

let service: TestClient;
let admin: Authed;
let vendedor: Authed;
let sinRol: Authed;
let anon: Authed;
let vendedorId: string;
const userIds: string[] = [];

function nuevoCliente(): Authed {
  const url = process.env["SUPABASE_TEST_URL"];
  const key = process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"];
  if (!url || !key)
    throw new Error("RLS tests requieren SUPABASE_TEST_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY");
  return createClient<Database>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

async function crearUsuario(email: string, rol: "admin" | "vendedor" | null): Promise<string> {
  const app_metadata = rol === null ? {} : { rol };
  const { data, error } = await service.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    app_metadata,
  });
  if (!error) return data.user.id;
  if (!error.message.toLowerCase().includes("already"))
    throw new Error(`createUser ${email}: ${error.message}`);
  const { data: lista } = await service.auth.admin.listUsers();
  const existente = lista?.users.find((u) => u.email === email);
  if (!existente) throw new Error(`usuario ${email} existe pero no se encontró`);
  await service.auth.admin.updateUserById(existente.id, { password: PASSWORD, app_metadata });
  return existente.id;
}

async function entrar(email: string): Promise<Authed> {
  const c = nuevoCliente();
  const { error } = await c.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`login ${email}: ${error.message}`);
  return c;
}

beforeAll(async () => {
  service = makeTestSupabaseClient();
  await cleanupTestDb(service);
  userIds.push(await crearUsuario(EMAILS.admin, "admin"));
  vendedorId = await crearUsuario(EMAILS.vendedor, "vendedor");
  userIds.push(vendedorId);
  userIds.push(await crearUsuario(EMAILS.sinRol, null));
  admin = await entrar(EMAILS.admin);
  vendedor = await entrar(EMAILS.vendedor);
  sinRol = await entrar(EMAILS.sinRol);
  anon = nuevoCliente();
}, 120_000);

afterAll(async () => {
  for (const id of userIds) await service.auth.admin.deleteUser(id);
  await service.from("usuarios").delete().in("email", Object.values(EMAILS));
  await cleanupTestDb(service);
}, 120_000);

/** Un borrador `listo` escrito como lo escribe el pipeline: con service-role. */
async function borradorListo() {
  const cadena = await sembrarCadena(service, "copiloto-rls");
  const repo = new SupabaseBorradoresIaRepository(service);
  const r = await repo.iniciar({
    conversacionId: cadena.conversacionId,
    leadSessionId: cadena.sesionId,
    mensajeOrigenId: cadena.mensajeId,
  });
  if (r.resultado !== "creado") throw new Error("fixture: se esperaba 'creado'");
  await repo.completar(r.borradorId, {
    contenido: "Texto del borrador",
    origen: "ia",
    reglaId: null,
  });
  return { ...cadena, borradorId: r.borradorId };
}

describe("RLS — borradores_ia", () => {
  test("admin y vendedor leen; sin rol y anon no ven nada", async () => {
    const { borradorId } = await borradorListo();

    for (const cliente of [admin, vendedor]) {
      const { data, error } = await cliente.from("borradores_ia").select("id").eq("id", borradorId);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    }
    for (const cliente of [sinRol, anon]) {
      const { data } = await cliente.from("borradores_ia").select("id").eq("id", borradorId);
      expect(data ?? []).toHaveLength(0);
    }
  });

  test("nadie del panel inserta: sin policy de INSERT (42501)", async () => {
    const cadena = await sembrarCadena(service, "copiloto-rls-ins");
    const { error } = await vendedor.from("borradores_ia").insert({
      conversacion_id: cadena.conversacionId,
      lead_session_id: cadena.sesionId,
      mensaje_origen_id: cadena.mensajeId,
      estado: "redactando",
    });
    expect(error?.code).toBe("42501");
  });

  test("el vendedor marca usado un borrador listo (y solo las columnas del uso)", async () => {
    const { borradorId } = await borradorListo();

    const { data, error } = await vendedor
      .from("borradores_ia")
      .update({
        estado: "usado",
        usado_via: "copiar",
        usado_por: vendedorId,
        usado_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", borradorId)
      .eq("estado", "listo")
      .select("id");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);

    // Segundo intento: el USING exige `listo`, así que afecta 0 filas sin error.
    const { data: otra, error: e2 } = await vendedor
      .from("borradores_ia")
      .update({ estado: "usado", usado_via: "insertar", usado_at: new Date().toISOString() })
      .eq("id", borradorId)
      .select("id");
    expect(e2).toBeNull();
    expect(otra).toHaveLength(0);
  });

  test("el vendedor NO puede editar el texto ni pasar a otro estado que 'usado'", async () => {
    const { borradorId } = await borradorListo();

    const texto = await vendedor
      .from("borradores_ia")
      .update({ contenido: "manipulado" })
      .eq("id", borradorId);
    expect(texto.error?.code).toBe("42501");

    const descartar = await vendedor
      .from("borradores_ia")
      .update({ estado: "descartado", updated_at: new Date().toISOString() })
      .eq("id", borradorId);
    expect(descartar.error?.code).toBe("42501");
  });

  test("nadie del panel borra", async () => {
    const { borradorId } = await borradorListo();
    const { error } = await vendedor.from("borradores_ia").delete().eq("id", borradorId);
    expect(error?.code).toBe("42501");
  });

  test("el RPC iniciar_borrador_ia está cerrado al panel", async () => {
    const cadena = await sembrarCadena(service, "copiloto-rls-rpc");
    const { error } = await vendedor.rpc("iniciar_borrador_ia", {
      p_conversacion_id: cadena.conversacionId,
      p_lead_session_id: cadena.sesionId,
      p_mensaje_origen_id: cadena.mensajeId,
      p_forzar: false,
    });
    expect(error?.code).toBe("42501");
  });
});

describe("RLS — conversaciones.modo_respuesta_override", () => {
  test("admin y vendedor cambian el modo; sin rol no afecta ninguna fila", async () => {
    const { conversacionId } = await sembrarCadena(service, "copiloto-rls-modo");

    for (const cliente of [admin, vendedor]) {
      const { data, error } = await cliente
        .from("conversaciones")
        .update({ modo_respuesta_override: "copiloto" })
        .eq("id", conversacionId)
        .select("id");
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    }

    const { data: sinPermiso } = await sinRol
      .from("conversaciones")
      .update({ modo_respuesta_override: "automatico" })
      .eq("id", conversacionId)
      .select("id");
    expect(sinPermiso ?? []).toHaveLength(0);

    const { data: fila } = await service
      .from("conversaciones")
      .select("modo_respuesta_override")
      .eq("id", conversacionId)
      .single();
    expect(fila?.modo_respuesta_override).toBe("copiloto");
  });
});
```

- [ ] **Step 9: Correr la integración local de estos dos archivos**

```bash
npm run stack:up
npm run test:integration:local -- tests/integration/borradores-ia.supabase.test.ts tests/integration/copiloto-rls.supabase.test.ts tests/integration/conversations.supabase.test.ts 2>&1 | tail -30
```

Expected: los tres archivos en PASS (contract completo contra Postgres, las 5 garantías, los 7 tests de RLS y el CHECK de conversaciones). **Esto vacía 17 tablas del stack local** y re-siembra al terminar (AGENTS lección 10): no correrlo mientras otro agente prueba E2E ahí. Si un test de RLS falla con un código distinto de `42501` para el `UPDATE` de columnas no concedidas, leer el error real de PostgREST antes de cambiar el esperado y ajustar solo ese código (el punto del test es que **falle**, no el número).

- [ ] **Step 10: Typecheck y commit**

```bash
npm run typecheck
git add src/types/copiloto.ts src/server/repositories/borradores-ia.repo.ts src/server/repositories/borradores-ia.supabase.repo.ts tests/repositories/borradores-ia.contract.ts tests/unit/borradores-ia.in-memory.test.ts tests/integration/borradores-ia.supabase.test.ts tests/integration/copiloto-rls.supabase.test.ts
git commit -m "feat(copiloto): repo de borradores con RPC atómico y RLS" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: typecheck exit 0.

---

## Task 6: El pipeline decide el modo y guarda borradores en vez de enviar

**Worker sugerido:** `worker-high` (archivo de 1.445 líneas con steps memoizados y una carrera por diseño; un error acá manda WhatsApps que nadie pidió).
**Depende de:** T2 (`horario_equipo`), T3 (`decidirModo`), T4 (`modo_respuesta_override`), T5 (`BorradoresIaRepository`).
**Skills a cargar antes:** `superpowers:test-driven-development`, `vercel:workflow` (semántica de steps Inngest).

**Files:**

- Create: `src/lib/copiloto/errores.ts`, `tests/unit/copiloto/errores.test.ts`, `tests/unit/on-message-received-copiloto.test.ts`
- Modify: `src/inngest/functions/on-message-received.ts`, `tests/unit/on-message-received-steps.test.ts`

**Interfaces:**

- Consumes: `decidirModo`, `equipoAbiertoAhora` (T3); `Conversacion.modo_respuesta_override` (T4); `BorradoresIaRepository` (T5); `AgenteConfigValores.horario_equipo` (T2).
- Produces (T7, T14):
  - `OnMessageReceivedDeps.borradores?: Pick<BorradoresIaRepository, "iniciar" | "completar" | "marcarError" | "descartar" | "descartarVigentes">`.
  - `codigoDeErrorBorrador(e: unknown): "tope_diario" | "llm_error"`.
  - Steps nuevos del pipeline: `invalidar-borrador-previo`, `decidir-modo`, `iniciar-borrador`, `guardar-borrador`, `descartar-borrador`, `descartar-borrador-descuento`, `marcar-borrador-error`.

- [ ] **Step 1: Test de `codigoDeErrorBorrador` (falla)**

Crear `tests/unit/copiloto/errores.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { codigoDeErrorBorrador } from "@/lib/copiloto/errores";
import { BudgetExceededError, InfraError } from "@/lib/errors";

describe("codigoDeErrorBorrador", () => {
  test("el tope diario de gasto se distingue de un fallo del modelo", () => {
    expect(codigoDeErrorBorrador(new BudgetExceededError("tope", "llm_diario"))).toBe(
      "tope_diario",
    );
  });

  test("reconoce el tope por nombre cuando Inngest entrega el error serializado", () => {
    // Un error que cruzó el límite de un step llega como `Error` genérico pero
    // conserva `name` (DomainError lo fija a `constructor.name`).
    const serializado = new Error("tope");
    serializado.name = "BudgetExceededError";
    expect(codigoDeErrorBorrador(serializado)).toBe("tope_diario");
  });

  test("cualquier otra cosa es llm_error y nunca arrastra el texto del proveedor", () => {
    expect(codigoDeErrorBorrador(new InfraError("500 del proveedor: detalle con datos"))).toBe(
      "llm_error",
    );
    expect(codigoDeErrorBorrador("string suelto")).toBe("llm_error");
    expect(codigoDeErrorBorrador(undefined)).toBe("llm_error");
  });
});
```

```bash
npx vitest run tests/unit/copiloto/errores.test.ts 2>&1 | tail -8
```

Expected: FAIL `Failed to resolve import "@/lib/copiloto/errores"`.

- [ ] **Step 2: Implementar `errores.ts`**

Crear `src/lib/copiloto/errores.ts`:

```ts
import { BudgetExceededError } from "@/lib/errors";

/**
 * Códigos cortos que se guardan en `borradores_ia.error_codigo`. Nunca texto del
 * proveedor: el CHECK de la tabla exige `^[a-z_]{1,40}$` y el mensaje de un
 * error del LLM puede traer fragmentos de la conversación.
 */
export type CodigoErrorBorrador =
  | "llm_error"
  | "tope_diario"
  | "descuento_excedido"
  | "ia_no_disponible";

/**
 * Qué código de error le toca a un fallo de `respond`. El error de un step de
 * Inngest puede llegar sin su clase original, por eso además de `instanceof`
 * se mira `name` (cada `DomainError` lo fija a `constructor.name`).
 */
export function codigoDeErrorBorrador(e: unknown): "tope_diario" | "llm_error" {
  if (e instanceof BudgetExceededError) return "tope_diario";
  if (e instanceof Error && e.name === "BudgetExceededError") return "tope_diario";
  return "llm_error";
}
```

```bash
npx vitest run tests/unit/copiloto/errores.test.ts 2>&1 | tail -6
```

Expected: `Tests  3 passed`.

- [ ] **Step 3: Escribir los tests del pipeline (fallan)**

Crear `tests/unit/on-message-received-copiloto.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { CONFIG_DE_FABRICA } from "@/lib/agente/defaults";
import { BudgetExceededError, IllegalStateError } from "@/lib/errors";
import {
  onMessageReceivedHandler,
  type EmittedEvent,
  type OnMessageReceivedDeps,
} from "@/inngest/functions/on-message-received";
import type { ParsedMessage } from "@/lib/meta/parse-webhook";
import { InMemoryBorradoresIaRepository } from "@/server/repositories/borradores-ia.repo";
import { InMemoryConversationsRepository } from "@/server/repositories/conversations.repo";
import { InMemoryDifusionSupresionesRepository } from "@/server/repositories/difusion-supresiones.repo";
import { InMemoryIntentsRepository } from "@/server/repositories/intents.repo";
import { InMemoryLeadIdentificadoresRepository } from "@/server/repositories/lead-identificadores.repo";
import { InMemoryLeadSessionRepository } from "@/server/repositories/lead-session.repo";
import { InMemoryLeadsRepository } from "@/server/repositories/leads.repo";
import { InMemoryMessagesRepository } from "@/server/repositories/messages.repo";
import { InMemoryProductsRepository } from "@/server/repositories/productos.repo";
import { InMemoryReglasEtiquetaRepository } from "@/server/repositories/reglas-etiqueta.repo";
import { InMemoryRuleExecutionsRepository } from "@/server/repositories/rule-executions.repo";
import { InMemoryRulesRepository } from "@/server/repositories/rules.repo";
import { InMemoryTagsRepository } from "@/server/repositories/tags.repo";
import { InMemoryTurnClassificationsRepository } from "@/server/repositories/turn-classifications.repo";
import { StaticAgentConfigProvider } from "@/server/services/agente/config-provider";
import { DefaultAiAgentService } from "@/server/services/ai-agent.service";
import { DefaultCatalogMatcherService } from "@/server/services/catalog-matcher.service";
import { DefaultIntentClassifierService } from "@/server/services/intent-classifier.service";
import { DefaultMetaApiService } from "@/server/services/meta-api.service";
import { DefaultRuleEngineService } from "@/server/services/rule-engine.service";
import { DIAS_SEMANA, type AgenteConfigValores, type Horario } from "@/types/agente";
import type { ModoOverride } from "@/types/copiloto";
import { FakeAgentLLM, FakeIntentClassifierLLM } from "../mocks/llm";
import { FakeMetaApiClient } from "../mocks/meta";

function horario(abierto: boolean): Horario {
  const h = {} as Horario;
  for (const dia of DIAS_SEMANA) h[dia] = abierto ? [{ desde: "00:00", hasta: "23:59" }] : [];
  return h;
}

/** Equipo de turno las 24 h: el modo no depende de qué hora sea cuando corre el test. */
const EQUIPO = { horario_equipo: horario(true) };

// Un teléfono válido para la lista de bajas (E.164, 7-15 dígitos).
const TEL = "5491155551234";

function parsed(overrides: Partial<ParsedMessage> = {}): ParsedMessage {
  return {
    canal: "wa",
    canal_thread_id: TEL,
    meta_user_id: TEL,
    meta_message_id: "wamid.IN-1",
    tipo: "text",
    contenido: "Busco filtro de aceite",
    media_url: null,
    nombre_perfil: null,
    raw: { type: "text" },
    ...overrides,
  };
}

function makeCtx(
  config: Partial<AgenteConfigValores> = {},
  opciones: { sinBorradores?: boolean } = {},
) {
  const leads = new InMemoryLeadsRepository();
  const conversations = new InMemoryConversationsRepository();
  const sessions = new InMemoryLeadSessionRepository();
  const messages = new InMemoryMessagesRepository();
  const intents = new InMemoryIntentsRepository();
  const rules = new InMemoryRulesRepository();
  const intentLLM = new FakeIntentClassifierLLM();
  const agentLLM = new FakeAgentLLM();
  const metaClient = new FakeMetaApiClient();
  // El RPC de la base resuelve "¿es el último entrante?" con la tabla `mensajes`.
  // Con empates de milésima (created_at) gana el último insertado.
  const borradores = new InMemoryBorradoresIaRepository(async (conversacionId) => {
    const entrantes = (await messages.listByConversacion(conversacionId, { limit: 200 })).filter(
      (m) => m.direction === "in",
    );
    const tope = entrantes[0]?.created_at.getTime();
    return entrantes.filter((m) => m.created_at.getTime() === tope).at(-1)?.id ?? null;
  });
  const ruleEngine = new DefaultRuleEngineService(
    intents,
    rules,
    new InMemoryReglasEtiquetaRepository(),
  );
  const emitted: EmittedEvent[] = [];
  const deps: OnMessageReceivedDeps = {
    leads,
    conversations,
    sessions,
    messages,
    metaApi: new DefaultMetaApiService(conversations, messages, metaClient),
    intentClassifier: new DefaultIntentClassifierService(intents, intentLLM),
    aiAgent: new DefaultAiAgentService(
      sessions,
      ruleEngine,
      new DefaultCatalogMatcherService(new InMemoryProductsRepository()),
      agentLLM,
    ),
    ruleExecutions: new InMemoryRuleExecutionsRepository(),
    turnClassifications: new InMemoryTurnClassificationsRepository(),
    ruleEngine,
    tags: new InMemoryTagsRepository(),
    intents,
    identificadores: new InMemoryLeadIdentificadoresRepository(),
    supresiones: new InMemoryDifusionSupresionesRepository(),
    respuestaDifusion: { registrar: async () => null },
    plantillasSinSesion: { registrar: async () => 0 },
    ...(opciones.sinBorradores ? {} : { borradores }),
    configProvider: new StaticAgentConfigProvider({ ...CONFIG_DE_FABRICA, ...config }),
    emit: async (e) => {
      emitted.push(e);
    },
  };
  return {
    deps,
    emitted,
    leads,
    conversations,
    sessions,
    messages,
    intents,
    rules,
    intentLLM,
    agentLLM,
    metaClient,
    borradores,
  };
}
type Ctx = ReturnType<typeof makeCtx>;

/** Un lead de WhatsApp con su conversación ya creada y el override que se pide. */
async function conOverride(ctx: Ctx, modo: ModoOverride | null) {
  const lead = await ctx.leads.create({
    nombre: "Ana",
    telefono: TEL,
    email: null,
    direccion: null,
    vehiculo_marca: "",
    vehiculo_modelo: "",
    vehiculo_anio: 0,
    vehiculo_motor: null,
    empresa_id: null,
    canal_origen: "wa",
    meta_user_ids: { wa: TEL },
  });
  const conv = await ctx.conversations.create({
    lead_id: lead.id,
    canal: "wa",
    canal_thread_id: TEL,
  });
  await ctx.conversations.update(conv.id, { modo_respuesta_override: modo });
  return { lead, conv };
}

async function conversacionDe(ctx: Ctx, canal: "wa" | "ig" = "wa", hilo = TEL) {
  const conv = await ctx.conversations.findByCanalThread(canal, hilo);
  if (!conv) throw new Error("la conversación no existe");
  return conv;
}

describe("on-message-received — modo Copiloto", () => {
  test("equipo abierto y agente abierto: no se envía nada y queda un borrador listo", async () => {
    const ctx = makeCtx(EQUIPO);
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueueText("Sí, tenemos filtros de aceite.");

    const r = await onMessageReceivedHandler({ parsed: parsed() }, ctx.deps);

    expect(ctx.metaClient.calls).toHaveLength(0);
    expect(r.sent).toBe(false);
    expect(r.agentSource).toBe("llm");
    const b = await ctx.borradores.findActualByConversacion(r.conversacionId);
    expect(b).toMatchObject({
      estado: "listo",
      contenido: "Sí, tenemos filtros de aceite.",
      origen: "ia",
      regla_id: null,
    });
    const salientes = (await ctx.messages.listByConversacion(r.conversacionId)).filter(
      (m) => m.direction === "out",
    );
    expect(salientes).toHaveLength(0);
  });

  test("el borrador cuelga del entrante que lo disparó", async () => {
    const ctx = makeCtx(EQUIPO);
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueueText("Respuesta.");

    const r = await onMessageReceivedHandler({ parsed: parsed() }, ctx.deps);

    const entrante = (await ctx.messages.listByConversacion(r.conversacionId)).find(
      (m) => m.direction === "in",
    );
    const b = await ctx.borradores.findActualByConversacion(r.conversacionId);
    expect(b?.mensaje_origen_id).toBe(entrante?.id);
    expect(b?.lead_session_id).toBe(r.sessionId);
  });

  test("una respuesta de regla IF/THEN también queda como borrador, con origen regla", async () => {
    const ctx = makeCtx(EQUIPO);
    const intent = await ctx.intents.create({
      nombre: "horario",
      descripcion: "pregunta por el horario",
      ejemplos: [],
      auto_detectado: false,
      activo: true,
    });
    const regla = await ctx.rules.create({
      intent_id: intent.id,
      condiciones_extra: null,
      respuesta_tipo: "text",
      respuesta_contenido: "Abrimos de 9 a 18",
      prioridad: 0,
      activa: true,
    });
    ctx.intentLLM.enqueue({ intent_nombre: "horario", confidence: 0.9 });

    const r = await onMessageReceivedHandler({ parsed: parsed() }, ctx.deps);

    expect(ctx.agentLLM.calls).toHaveLength(0);
    expect(ctx.metaClient.calls).toHaveLength(0);
    expect(r.agentSource).toBe("rule");
    const b = await ctx.borradores.findActualByConversacion(r.conversacionId);
    expect(b).toMatchObject({
      estado: "listo",
      contenido: "Abrimos de 9 a 18",
      origen: "regla",
      regla_id: regla.id,
    });
  });

  test("agente cerrado pero equipo abierto: no se manda la plantilla y sí se redacta", async () => {
    const ctx = makeCtx({
      ...EQUIPO,
      horario: horario(false),
      plantilla_fuera_horario: "Estamos cerrados.",
    });
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueueText("Borrador con el agente cerrado.");

    const r = await onMessageReceivedHandler({ parsed: parsed() }, ctx.deps);

    expect(ctx.metaClient.calls).toHaveLength(0);
    expect(ctx.agentLLM.calls).toHaveLength(1);
    expect((await ctx.borradores.findActualByConversacion(r.conversacionId))?.estado).toBe("listo");
  });

  test("override Copiloto fijo con equipo y agente cerrados (O2): borrador, sin plantilla", async () => {
    const ctx = makeCtx({ horario: horario(false), plantilla_fuera_horario: "Estamos cerrados." });
    await conOverride(ctx, "copiloto");
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueueText("Borrador por override.");

    const r = await onMessageReceivedHandler({ parsed: parsed() }, ctx.deps);

    expect(ctx.metaClient.calls).toHaveLength(0);
    expect((await ctx.borradores.findActualByConversacion(r.conversacionId))?.contenido).toBe(
      "Borrador por override.",
    );
  });

  test("sin repositorio de borradores el turno falla en voz alta y no manda nada por la API", async () => {
    const ctx = makeCtx(EQUIPO, { sinBorradores: true });
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueueText("No debería salir.");

    await expect(onMessageReceivedHandler({ parsed: parsed() }, ctx.deps)).rejects.toBeInstanceOf(
      IllegalStateError,
    );

    expect(ctx.metaClient.calls).toHaveLength(0);
    expect(ctx.agentLLM.calls).toHaveLength(0);
  });
});

describe("on-message-received — los otros modos siguen igual que hoy", () => {
  test("Según horario con equipo cerrado y agente abierto: Automático, sale por la API y no hay borrador", async () => {
    const ctx = makeCtx(); // horario_equipo de fábrica: sin ningún rango
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueueText("Respuesta por la API.");

    const r = await onMessageReceivedHandler({ parsed: parsed() }, ctx.deps);

    expect(ctx.metaClient.calls).toHaveLength(1);
    expect(ctx.metaClient.calls[0]?.text).toBe("Respuesta por la API.");
    expect(r.sent).toBe(true);
    expect(await ctx.borradores.findActualByConversacion(r.conversacionId)).toBeNull();
  });

  test("override Automático con el equipo abierto: sale por la API", async () => {
    const ctx = makeCtx(EQUIPO);
    await conOverride(ctx, "automatico");
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueueText("Automático fijo.");

    const r = await onMessageReceivedHandler({ parsed: parsed() }, ctx.deps);

    expect(ctx.metaClient.calls).toHaveLength(1);
    expect(await ctx.borradores.findActualByConversacion(r.conversacionId)).toBeNull();
  });

  test("equipo y agente cerrados: plantilla de fuera de horario, sin LLM y sin borrador", async () => {
    const ctx = makeCtx({ horario: horario(false), plantilla_fuera_horario: "Estamos cerrados." });

    const r = await onMessageReceivedHandler({ parsed: parsed() }, ctx.deps);

    expect(ctx.agentLLM.calls).toHaveLength(0);
    expect(ctx.metaClient.calls.at(-1)?.text).toBe("Estamos cerrados.");
    expect(await ctx.borradores.findActualByConversacion(r.conversacionId)).toBeNull();
  });

  test("Automático fijo con el agente cerrado: Fuera de horario (plantilla o nada)", async () => {
    const ctx = makeCtx({ ...EQUIPO, horario: horario(false), plantilla_fuera_horario: "" });
    await conOverride(ctx, "automatico");

    const r = await onMessageReceivedHandler({ parsed: parsed() }, ctx.deps);

    expect(ctx.metaClient.calls).toHaveLength(0);
    expect(ctx.agentLLM.calls).toHaveLength(0);
    expect(await ctx.borradores.findActualByConversacion(r.conversacionId)).toBeNull();
  });

  test("Instagram: el copiloto es de WhatsApp, así que el equipo abierto no cambia nada", async () => {
    const ctx = makeCtx(EQUIPO);
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueueText("Respuesta por Instagram.");

    const r = await onMessageReceivedHandler(
      { parsed: parsed({ canal: "ig", canal_thread_id: "IGSID", meta_user_id: "IGSID" }) },
      ctx.deps,
    );

    expect(ctx.metaClient.calls).toHaveLength(1);
    expect(r.sent).toBe(true);
    const conv = await conversacionDe(ctx, "ig", "IGSID");
    expect(await ctx.borradores.findActualByConversacion(conv.id)).toBeNull();
  });
});

describe("on-message-received — cuando la IA no respondería, tampoco hay borrador", () => {
  test("sesión con la IA pausada: el borrador que arrancó se descarta", async () => {
    const ctx = makeCtx(EQUIPO);
    const { lead } = await conOverride(ctx, null);
    await ctx.sessions.create({
      lead_id: lead.id,
      current_stage: "nuevo",
      urgencia: "media",
      consulta: "",
      producto_cotizado_id: null,
      codigo_interno: null,
      precio_cotizado: null,
      cantidad: null,
      bloqueador: null,
      comprobante_pago_url: null,
      metodo_pago: null,
      resultado: null,
      motivo_perdida: null,
      ia_pausada: true,
    });
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });

    const r = await onMessageReceivedHandler({ parsed: parsed() }, ctx.deps);

    expect(r.agentSource).toBe("handoff");
    expect(ctx.metaClient.calls).toHaveLength(0);
    expect(await ctx.borradores.findActualByConversacion(r.conversacionId)).toBeNull();
  });

  test("descuento excedido: la IA se pausa y no queda borrador", async () => {
    const ctx = makeCtx({ ...EQUIPO, descuento_max_pct: 5 });
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueueText("Te hago un 20% de descuento.");

    const r = await onMessageReceivedHandler({ parsed: parsed() }, ctx.deps);

    expect(ctx.metaClient.calls).toHaveLength(0);
    expect(await ctx.borradores.findActualByConversacion(r.conversacionId)).toBeNull();
    const sesion = await ctx.sessions.findById(r.sessionId);
    expect(sesion?.ia_pausada).toBe(true);
  });

  test("BAJA: la confirmación sale por la API como siempre y el borrador anterior se invalida", async () => {
    const ctx = makeCtx(EQUIPO);
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueueText("Borrador previo.");
    const primero = await onMessageReceivedHandler({ parsed: parsed() }, ctx.deps);
    expect((await ctx.borradores.findActualByConversacion(primero.conversacionId))?.estado).toBe(
      "listo",
    );

    await onMessageReceivedHandler(
      { parsed: parsed({ meta_message_id: "wamid.IN-2", contenido: "BAJA" }) },
      ctx.deps,
    );

    expect(ctx.metaClient.calls).toHaveLength(1); // solo la confirmación de baja
    expect(await ctx.borradores.findActualByConversacion(primero.conversacionId)).toBeNull();
  });
});

describe("on-message-received — el borrador del mensaje nuevo reemplaza al anterior", () => {
  test("el segundo mensaje descarta el borrador del primero y deja uno solo vigente", async () => {
    const ctx = makeCtx(EQUIPO);
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueueText("Respuesta al primero.");
    const r1 = await onMessageReceivedHandler({ parsed: parsed() }, ctx.deps);
    const primero = await ctx.borradores.findActualByConversacion(r1.conversacionId);

    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueueText("Respuesta al segundo.");
    await onMessageReceivedHandler(
      { parsed: parsed({ meta_message_id: "wamid.IN-2", contenido: "¿y en stock?" }) },
      ctx.deps,
    );

    const actual = await ctx.borradores.findActualByConversacion(r1.conversacionId);
    expect(actual?.id).not.toBe(primero?.id);
    expect(actual?.contenido).toBe("Respuesta al segundo.");
    expect((await ctx.borradores.findById(primero!.id))?.estado).toBe("descartado");
  });

  test("cambiar el override entre dos mensajes: el segundo sale por la API y el borrador viejo se invalida", async () => {
    const ctx = makeCtx(EQUIPO);
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueueText("Borrador 1.");
    const r1 = await onMessageReceivedHandler({ parsed: parsed() }, ctx.deps);

    await ctx.conversations.update(r1.conversacionId, { modo_respuesta_override: "automatico" });
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueueText("Respuesta 2 por la API.");
    await onMessageReceivedHandler({ parsed: parsed({ meta_message_id: "wamid.IN-2" }) }, ctx.deps);

    expect(ctx.metaClient.calls).toHaveLength(1);
    expect(await ctx.borradores.findActualByConversacion(r1.conversacionId)).toBeNull();
  });
});

describe("on-message-received — si la IA falla, la tarjeta no queda en 'Redactando…'", () => {
  test("un error del modelo deja el borrador en error con llm_error y el turno falla como siempre", async () => {
    const ctx = makeCtx(EQUIPO);
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueue(async () => {
      throw new Error("el proveedor se cayó");
    });

    await expect(onMessageReceivedHandler({ parsed: parsed() }, ctx.deps)).rejects.toThrow(
      "el proveedor se cayó",
    );

    const conv = await conversacionDe(ctx);
    const b = await ctx.borradores.findActualByConversacion(conv.id);
    expect(b).toMatchObject({ estado: "error", error_codigo: "llm_error" });
    expect(JSON.stringify(b)).not.toContain("proveedor");
  });

  test("el tope diario de gasto deja el código tope_diario", async () => {
    const ctx = makeCtx(EQUIPO);
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueue(async () => {
      throw new BudgetExceededError("tope diario alcanzado", "llm_diario");
    });

    await expect(onMessageReceivedHandler({ parsed: parsed() }, ctx.deps)).rejects.toBeInstanceOf(
      BudgetExceededError,
    );

    const conv = await conversacionDe(ctx);
    expect((await ctx.borradores.findActualByConversacion(conv.id))?.error_codigo).toBe(
      "tope_diario",
    );
  });
});
```

```bash
npx vitest run tests/unit/on-message-received-copiloto.test.ts 2>&1 | tail -25
```

Expected: FAIL (el handler ignora el modo: los tests de Copiloto ven `metaClient.calls` con 1 envío y ningún borrador). Los tests de "siguen igual" pueden pasar ya (son regresión).

- [ ] **Step 4: Editar `on-message-received.ts`**

Aplicar estos nueve cambios (anclas por texto; todos dentro de `src/inngest/functions/on-message-received.ts`).

**4.1 Imports.** Reemplazar `import { isNonRetriable, ValidationError } from "@/lib/errors";` por

```ts
import { IllegalStateError, isNonRetriable, ValidationError } from "@/lib/errors";
```

Después de `import { estaAbierto } from "@/lib/agente/horario";` agregar

```ts
import { codigoDeErrorBorrador } from "@/lib/copiloto/errores";
import { decidirModo, equipoAbiertoAhora } from "@/lib/copiloto/modo";
```

Reemplazar `import type { AiAgentService } from "@/server/services/ai-agent.service";` por

```ts
import type { AgentTurnResult, AiAgentService } from "@/server/services/ai-agent.service";
```

y junto a los otros `import type` de repositorios agregar

```ts
import type { BorradoresIaRepository } from "@/server/repositories/borradores-ia.repo";
import type { ModoDecidido } from "@/types/copiloto";
```

**4.2 Dependencia nueva.** En `interface OnMessageReceivedDeps`, justo antes de `configProvider: AgentConfigProvider;`:

```ts
  /**
   * Dónde se guardan los borradores del copiloto (`borradores_ia`). Opcional
   * para que los callers que no usan el copiloto sigan compilando, pero con el
   * modo decidido en Copiloto y sin él el turno **falla en voz alta**
   * (`exigirBorradores`): el fallback silencioso sería mandar por la API lo que
   * el equipo pidió redactar. `bootstrap.ts` lo wirea.
   */
  borradores?: Pick<
    BorradoresIaRepository,
    "iniciar" | "completar" | "marcarError" | "descartar" | "descartarVigentes"
  >;
```

**4.3 Invalidar el borrador previo.** Justo antes del comentario `// El lead tocó un botón o eligió una fila de una lista: el flujo que` (o sea, después del bloque `if (isDuplicate) { ... return {...}; }`):

```ts
// Un entrante nuevo deja viejo el borrador que estaba vigente: ofrecerlo
// después de que llegó otro mensaje sería contestar la pregunta anterior.
// Va acá y no junto a `iniciar-borrador` porque hay turnos que nunca llegan a
// redactar (baja, flujo interceptor, fuera de horario) y el borrador previo
// igual quedó obsoleto.
if (deps.borradores) {
  const borradores = deps.borradores;
  await step.run("invalidar-borrador-previo", () => borradores.descartarVigentes(conv.id));
}
```

**4.4 Config del turno.** En el objeto que devuelve el step `leer-config`, después de `horario_timezone: c.horario_timezone,` agregar `horario_equipo: c.horario_equipo,`.

**4.5 Decidir el modo.** Después del step `decidir-horario` (el `const abierto = await step.run("decidir-horario", ...)`):

```ts
// Step propio por la misma razón que `decidir-horario`: Inngest vuelve a
// correr el handler en cada paso, y una lectura viva del reloj cambiaría el
// modo a mitad del turno. El copiloto es de WhatsApp (las acciones de la
// tarjeta abren WhatsApp Web y el ahorro es de la API de WhatsApp): en
// Instagram y Messenger el modo se calcula sin override y sin equipo, o sea
// el comportamiento de siempre. `agenteAbierto` reusa la decisión de arriba
// para que las dos nunca discrepen.
const modo: ModoDecidido = await step.run("decidir-modo", async () =>
  decidirModo({
    override: parsed.canal === "wa" ? conv.modo_respuesta_override : null,
    equipoAbierto: parsed.canal === "wa" && equipoAbiertoAhora(config, new Date()),
    agenteAbierto: abierto,
  }),
);
```

**4.6 La rama fuera de horario depende del modo, no solo del agente.** Reemplazar `if (!abierto) {` (el que abre la rama "Fuera de horario: no se invoca ningun LLM...") por

```ts
    // La rama corre solo con el resultado Fuera de horario (§3.2). Con Copiloto
    // y el agente cerrado el turno sigue por `classify` / `respond` como en
    // horario: el borrador no sale solo, así que el agente cerrado no lo impide.
    if (modo === "fuera_de_horario") {
```

(El interceptor de flujos sigue dentro de `if (interceptor && abierto)`: no se toca.)

**4.7 Arrancar el borrador y capturar el fallo de `respond`.** Reemplazar el bloque

```ts
    const agentResult = await step.run("respond", () =>
      deps.aiAgent.respond({
        leadSessionId: session.id,
        ...
      }),
    );
```

por

```ts
// En Copiloto el borrador arranca ANTES de `respond` (la tarjeta muestra
// "Redactando…") y es idempotente por entrante. `null` = el entrante ya no
// es el último (llegó otro mientras tanto): el turno sigue pero no hay
// borrador donde escribir.
const borradorId: UUID | null =
  modo === "copiloto"
    ? await step.run("iniciar-borrador", async () => {
        const r = await exigirBorradores(deps).iniciar({
          conversacionId: conv.id,
          leadSessionId: session.id,
          mensajeOrigenId: inbound.id,
        });
        return r.resultado === "obsoleto" ? null : r.borradorId;
      })
    : null;

let agentResult: AgentTurnResult;
try {
  agentResult = await step.run("respond", () =>
    deps.aiAgent.respond({
      leadSessionId: session.id,
      conversationTurn,
      classification,
      mensajeOrigenId: inbound.id,
      ...(tramos.some((t) => t.instrucciones !== null)
        ? {
            instruccionesTramo: tramos.flatMap((t) =>
              t.instrucciones !== null ? [t.instrucciones] : [],
            ),
          }
        : {}),
    }),
  );
} catch (error) {
  // El turno falla igual que siempre, pero la tarjeta no puede quedarse en
  // "Redactando…" para siempre: queda en error con un código corto (nunca el
  // texto del proveedor) y la persona puede reintentar.
  if (borradorId !== null) {
    await step.run("marcar-borrador-error", () =>
      exigirBorradores(deps).marcarError(borradorId, codigoDeErrorBorrador(error)),
    );
  }
  throw error;
}
```

(El contenido del `respond` interno es **el mismo** de hoy: copiar el objeto tal cual estaba, incluido `instruccionesTramo`.)

**4.8 Guardar en vez de enviar.** Tres ediciones dentro del bloque `let sent = false; if (agentResult.source !== "handoff") { ... } else { ... }`:

(a) En la rama del descuento excedido, justo después del step `pausar-por-descuento` y antes de `avisarErrorAlTramo = null;`:

```ts
if (borradorId !== null) {
  await step.run("descartar-borrador-descuento", () =>
    exigirBorradores(deps).descartar(borradorId),
  );
}
```

(b) Reemplazar el trío

```ts
await step.run("send", () =>
  deps.metaApi.sendOutbound({
    conversacionId: conv.id,
    leadSessionId: session.id,
    canal: parsed.canal,
    to: parsed.meta_user_id,
    contenido: agentResult.respuesta_contenido,
    sender: "ia",
    idempotencyKey: claveSaliente(parsed.meta_message_id),
  }),
);
sent = true;
logger.info("send-out");
```

por

```ts
if (modo === "copiloto") {
  // Nada sale por la API: la respuesta (de regla o de LLM) queda como
  // borrador para que una persona la envíe desde WhatsApp Web. El texto
  // no se loguea.
  if (borradorId !== null) {
    await step.run("guardar-borrador", () =>
      exigirBorradores(deps).completar(borradorId, {
        contenido: agentResult.respuesta_contenido,
        origen: agentResult.source === "rule" ? "regla" : "ia",
        reglaId: agentResult.regla_id ?? null,
      }),
    );
  }
  logger.info("borrador-listo", { origen: agentResult.source });
} else {
  await step.run("send", () =>
    deps.metaApi.sendOutbound({
      conversacionId: conv.id,
      leadSessionId: session.id,
      canal: parsed.canal,
      to: parsed.meta_user_id,
      contenido: agentResult.respuesta_contenido,
      sender: "ia",
      idempotencyKey: claveSaliente(parsed.meta_message_id),
    }),
  );
  sent = true;
  logger.info("send-out");
}
```

(La auditoría `auditar-regla` que sigue queda donde está y corre en los dos modos: la regla sí disparó.)

(c) Reemplazar la rama `else { logger.info("send-skipped", { reason: "handoff" }); }` por

```ts
    } else {
      // Si hoy la IA no respondería, tampoco hay borrador (§3.1): el que arrancó
      // como "Redactando…" se descarta.
      if (borradorId !== null) {
        await step.run("descartar-borrador", () => exigirBorradores(deps).descartar(borradorId));
      }
      logger.info("send-skipped", { reason: "handoff" });
    }
```

**4.9 Helper.** Junto a las otras funciones auxiliares del final del archivo (p. ej. antes de `async function resolveLead`):

```ts
/**
 * El repositorio de borradores, o un error que no se reintenta: con el modo
 * decidido en Copiloto, seguir sin él sería mandar por la API lo que el equipo
 * pidió redactar.
 */
function exigirBorradores(
  deps: Pick<OnMessageReceivedDeps, "borradores">,
): NonNullable<OnMessageReceivedDeps["borradores"]> {
  if (!deps.borradores) {
    throw new IllegalStateError(
      "Modo Copiloto sin OnMessageReceivedDeps.borradores: el borrador no tiene dónde guardarse",
      "copiloto_sin_repositorio",
    );
  }
  return deps.borradores;
}
```

- [ ] **Step 5: Ver pasar los tests nuevos y los 10 archivos existentes del pipeline**

```bash
npx vitest run tests/unit/on-message-received-copiloto.test.ts tests/unit/copiloto/errores.test.ts 2>&1 | tail -20
npx vitest run tests/unit/on-message-received.test.ts tests/unit/on-message-received-auto-handoff.test.ts tests/unit/on-message-received-bajas.test.ts tests/unit/on-message-received-delegacion.test.ts tests/unit/on-message-received-difusion.test.ts tests/unit/on-message-received-interceptar.test.ts tests/unit/on-message-received-logger.test.ts tests/unit/on-message-received-steps.test.ts tests/unit/on-message-received-summary.test.ts tests/unit/on-message-received-workflow.test.ts 2>&1 | tail -15
```

Expected: el primer comando `Tests  21 passed` (18 del pipeline + 3 de `errores`); en el segundo, **los 9 archivos existentes restantes en PASS sin tocarlos** (esa es la garantía de "Automático idéntico al actual"; los que arman un `configProvider` propio siguen funcionando porque `horario_equipo` sale de `CONFIG_DE_FABRICA`) y **un solo archivo falla a propósito: `on-message-received-steps.test.ts`**, porque fija la lista ordenada de steps (`expect(spy.steps).toEqual([...])`) y ahora hay un step más. Arreglarlo agregando `"decidir-modo",` inmediatamente después de `"decidir-horario",` en las **dos** listas que lo contienen (los tests «flujo normal LLM ejecuta steps en orden» y «agent source=handoff: skip send pero ejecuta emit»), con este comentario:

```ts
      // Step propio: el modo (Copiloto / Automático / Fuera de horario) no cambia
      // a mitad del turno aunque cruce la hora de cierre del equipo.
      "decidir-modo",
```

`"invalidar-borrador-previo"` **no** entra en esas listas: solo corre con `deps.borradores` wireado y este test no lo wirea. Volver a correr el archivo: PASS.

- [ ] **Step 6: Typecheck y commit**

```bash
npm run typecheck
git add src/lib/copiloto/errores.ts src/inngest/functions/on-message-received.ts tests/unit/copiloto/errores.test.ts tests/unit/on-message-received-copiloto.test.ts tests/unit/on-message-received-steps.test.ts
git commit -m "feat(copiloto): el pipeline guarda borradores en modo Copiloto" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: typecheck exit 0.

---

## Task 7: Regenerar / Reintentar fuera del pipeline (R4): evento, función Inngest y wiring

**Worker sugerido:** `worker-high`.
**Depende de:** T5, T6.
**Skills a cargar antes:** `superpowers:test-driven-development`, `vercel:workflow`.

**Files:**

- Create: `src/lib/copiloto/resultado.ts`, `src/server/services/agente/conversation-turn.ts`, `src/inngest/functions/copiloto-borrador.ts`, `tests/unit/copiloto/resultado.test.ts`, `tests/unit/copiloto-borrador-function.test.ts`
- Modify: `src/inngest/events.ts`, `src/inngest/functions/on-message-received.ts` (extracción de `buildConversationTurn`), `src/inngest/functions/index.ts`, `src/inngest/bootstrap.ts`, `tests/unit/inngest-functions-factory.test.ts`

**Interfaces:**

- Consumes: `BorradoresIaRepository` (T5), `codigoDeErrorBorrador` (T6).
- Produces (T8, T14):
  - Evento `copilotoBorradorSolicitado` = `"copiloto/borrador.solicitado"` con `data: { borradorId: UUID; conversacionId: UUID; solicitadoPor: UUID | null }` (`id` de deduplicación al emitir: `copiloto-regenerar:<borradorId>`).
  - `makeCopilotoBorradorFn(deps: CopilotoBorradorDeps)`, función Inngest `copiloto-borrador`.
  - `buildConversationTurn(conversacionId, messages, contextSummary, limit): Promise<string[]>` en `src/server/services/agente/conversation-turn.ts`.
  - `resolverResultadoRegenerado(respuesta, descuentoMaxPct): ResultadoRegenerado`.
  - `OnMessageReceivedDeps.borradores` queda wireado en `bootstrap.ts`.

- [ ] **Step 1: Test de `resolverResultadoRegenerado` (falla)**

Crear `tests/unit/copiloto/resultado.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { resolverResultadoRegenerado } from "@/lib/copiloto/resultado";

describe("resolverResultadoRegenerado", () => {
  test("una respuesta del LLM es un borrador listo con origen ia", () => {
    expect(resolverResultadoRegenerado({ source: "llm", respuesta_contenido: "Hola" }, 0)).toEqual({
      tipo: "listo",
      contenido: "Hola",
      origen: "ia",
      reglaId: null,
    });
  });

  test("una regla lleva su id y origen regla", () => {
    expect(
      resolverResultadoRegenerado(
        { source: "rule", respuesta_contenido: "Abrimos de 9 a 18", regla_id: "r-1" },
        0,
      ),
    ).toEqual({ tipo: "listo", contenido: "Abrimos de 9 a 18", origen: "regla", reglaId: "r-1" });
  });

  test("handoff (IA pausada o escalada): error ia_no_disponible, no un borrador", () => {
    expect(
      resolverResultadoRegenerado({ source: "handoff", respuesta_contenido: "IA pausada" }, 0),
    ).toEqual({ tipo: "error", codigo: "ia_no_disponible" });
  });

  test("un descuento por encima del tope es error descuento_excedido", () => {
    expect(
      resolverResultadoRegenerado(
        { source: "llm", respuesta_contenido: "Te hago un 20% de descuento." },
        5,
      ),
    ).toEqual({ tipo: "error", codigo: "descuento_excedido" });
  });

  test("un descuento dentro del tope pasa", () => {
    expect(
      resolverResultadoRegenerado(
        { source: "llm", respuesta_contenido: "Te hago un 5% de descuento." },
        5,
      ).tipo,
    ).toBe("listo");
  });
});
```

```bash
npx vitest run tests/unit/copiloto/resultado.test.ts 2>&1 | tail -8
```

Expected: FAIL `Failed to resolve import "@/lib/copiloto/resultado"`.

- [ ] **Step 2: Implementar `resultado.ts`**

Crear `src/lib/copiloto/resultado.ts`:

```ts
import { excedeDescuento } from "@/lib/agente/descuento";
import type { OrigenBorrador } from "@/types/copiloto";

/**
 * Lo mínimo que este módulo necesita de `AgentTurnResult`. Es estructural a
 * propósito: `lib/**` no puede importar de `server/services/**` (boundaries) y
 * `AgentTurnResult` es asignable a esto.
 */
export interface RespuestaDelAgente {
  source: "rule" | "llm" | "handoff";
  respuesta_contenido: string;
  regla_id?: string;
}

export type ResultadoRegenerado =
  | { tipo: "listo"; contenido: string; origen: OrigenBorrador; reglaId: string | null }
  | { tipo: "error"; codigo: "ia_no_disponible" | "descuento_excedido" };

/**
 * Qué hace "Regenerar" / "Reintentar" con lo que devolvió `respond`.
 *
 * En el pipeline, un `handoff` o un descuento excedido **descartan** el borrador
 * (la persona no pidió nada). Acá la persona sí pidió redactar: si no hay
 * borrador tiene que verse por qué, así que queda en `error` con un código
 * corto que la tarjeta traduce. No se pausa la IA por un descuento: quien
 * revisa el borrador es una persona.
 */
export function resolverResultadoRegenerado(
  respuesta: RespuestaDelAgente,
  descuentoMaxPct: number,
): ResultadoRegenerado {
  if (respuesta.source === "handoff") return { tipo: "error", codigo: "ia_no_disponible" };
  if (excedeDescuento(respuesta.respuesta_contenido, descuentoMaxPct) !== null) {
    return { tipo: "error", codigo: "descuento_excedido" };
  }
  return {
    tipo: "listo",
    contenido: respuesta.respuesta_contenido,
    origen: respuesta.source === "rule" ? "regla" : "ia",
    reglaId: respuesta.regla_id ?? null,
  };
}
```

```bash
npx vitest run tests/unit/copiloto/resultado.test.ts 2>&1 | tail -6
```

Expected: `Tests  5 passed`.

- [ ] **Step 3: Extraer `buildConversationTurn`**

Crear `src/server/services/agente/conversation-turn.ts` con el cuerpo que hoy vive (privado) al final de `on-message-received.ts`:

```ts
import type { MessagesRepository } from "@/server/repositories/messages.repo";
import type { UUID } from "@/types/entities";

/**
 * El contexto que ve el agente: el resumen previo (si hay) y los últimos
 * mensajes de la conversación, del más viejo al más nuevo. Lo comparten el
 * pipeline y "Regenerar" del copiloto, que tiene que reconstruir el mismo turno.
 */
export async function buildConversationTurn(
  conversacionId: UUID,
  messages: Pick<MessagesRepository, "listByConversacion">,
  contextSummary: string | null,
  limit: number,
): Promise<string[]> {
  const recent = await messages.listByConversacion(conversacionId, { limit });
  const formatted = recent
    .slice()
    .reverse()
    .map((m) => `${m.sender}: ${m.contenido ?? ""}`);
  if (contextSummary) {
    return [`[Resumen previo]: ${contextSummary}`, ...formatted];
  }
  return formatted;
}
```

En `src/inngest/functions/on-message-received.ts`: **borrar** la función local `async function buildConversationTurn(...)` (está al final, entre `resolveActiveSession` y `adaptInngestStep`) y agregar el import `import { buildConversationTurn } from "@/server/services/agente/conversation-turn";`. Las llamadas (`buildConversationTurn(conv.id, deps.messages, session.context_summary, config.ventana_contexto_mensajes)`) no cambian.

```bash
npx vitest run tests/unit/on-message-received.test.ts tests/unit/on-message-received-summary.test.ts tests/unit/on-message-received-copiloto.test.ts 2>&1 | tail -8
```

Expected: PASS (refactor sin cambio de comportamiento; `on-message-received.test.ts` tiene un test que espía `listByConversacion` con `{ limit: 4 }`).

- [ ] **Step 4: El evento**

En `src/inngest/events.ts`, después de `workflowInactividadRevisar`/antes de la sección de Difusión:

```ts
/**
 * "Regenerar" / "Reintentar" del copiloto: pide volver a redactar el borrador
 * `borradorId` de la conversación con el contexto actual. `respond` solo corría
 * dentro de `on-message-received`; esta es la forma de invocarlo desde el panel
 * sin ejecutar el LLM dentro de una Server Action.
 *
 * Lo emite `copiloto-bootstrap.ts` (la costura que sí puede importar Inngest) y
 * lo consume `copiloto-borrador`.
 *
 * Idempotency key al emitir: `copiloto-regenerar:<borradorId>`. Tras regenerar el
 * borrador es otro (otro id), así que una segunda regeneración sí emite.
 */
export const copilotoBorradorSolicitado = eventType("copiloto/borrador.solicitado", {
  schema: staticSchema<{
    borradorId: UUID;
    conversacionId: UUID;
    solicitadoPor: UUID | null;
  }>(),
});
```

- [ ] **Step 5: Test de la función (falla)**

Crear `tests/unit/copiloto-borrador-function.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { CONFIG_DE_FABRICA } from "@/lib/agente/defaults";
import { BudgetExceededError } from "@/lib/errors";
import { copilotoBorradorHandler } from "@/inngest/functions/copiloto-borrador";
import { InMemoryBorradoresIaRepository } from "@/server/repositories/borradores-ia.repo";
import { InMemoryConversationsRepository } from "@/server/repositories/conversations.repo";
import { InMemoryIntentsRepository } from "@/server/repositories/intents.repo";
import { InMemoryLeadSessionRepository } from "@/server/repositories/lead-session.repo";
import { InMemoryLeadsRepository } from "@/server/repositories/leads.repo";
import { InMemoryMessagesRepository } from "@/server/repositories/messages.repo";
import { InMemoryProductsRepository } from "@/server/repositories/productos.repo";
import { InMemoryReglasEtiquetaRepository } from "@/server/repositories/reglas-etiqueta.repo";
import { InMemoryRulesRepository } from "@/server/repositories/rules.repo";
import { InMemoryTurnClassificationsRepository } from "@/server/repositories/turn-classifications.repo";
import { StaticAgentConfigProvider } from "@/server/services/agente/config-provider";
import { DefaultAiAgentService } from "@/server/services/ai-agent.service";
import { DefaultCatalogMatcherService } from "@/server/services/catalog-matcher.service";
import { DefaultIntentClassifierService } from "@/server/services/intent-classifier.service";
import { DefaultRuleEngineService } from "@/server/services/rule-engine.service";
import type { AgenteConfigValores } from "@/types/agente";
import { FakeAgentLLM, FakeIntentClassifierLLM } from "../mocks/llm";

const TEL = "5491155551234";

async function makeCtx(config: Partial<AgenteConfigValores> = {}) {
  const leads = new InMemoryLeadsRepository();
  const conversations = new InMemoryConversationsRepository();
  const sessions = new InMemoryLeadSessionRepository();
  const messages = new InMemoryMessagesRepository();
  const intents = new InMemoryIntentsRepository();
  const rules = new InMemoryRulesRepository();
  const turnClassifications = new InMemoryTurnClassificationsRepository();
  const intentLLM = new FakeIntentClassifierLLM();
  const agentLLM = new FakeAgentLLM();
  const borradores = new InMemoryBorradoresIaRepository(async (conversacionId) => {
    const entrantes = (await messages.listByConversacion(conversacionId, { limit: 200 })).filter(
      (m) => m.direction === "in",
    );
    const tope = entrantes[0]?.created_at.getTime();
    return entrantes.filter((m) => m.created_at.getTime() === tope).at(-1)?.id ?? null;
  });

  const lead = await leads.create({
    nombre: "Ana",
    telefono: TEL,
    email: null,
    direccion: null,
    vehiculo_marca: "",
    vehiculo_modelo: "",
    vehiculo_anio: 0,
    vehiculo_motor: null,
    empresa_id: null,
    canal_origen: "wa",
    meta_user_ids: { wa: TEL },
  });
  const sesion = await sessions.create({
    lead_id: lead.id,
    current_stage: "nuevo",
    urgencia: "media",
    consulta: "",
    producto_cotizado_id: null,
    codigo_interno: null,
    precio_cotizado: null,
    cantidad: null,
    bloqueador: null,
    comprobante_pago_url: null,
    metodo_pago: null,
    resultado: null,
    motivo_perdida: null,
    ia_pausada: false,
  });
  const conv = await conversations.create({ lead_id: lead.id, canal: "wa", canal_thread_id: TEL });

  async function entrante(contenido: string, wamid: string) {
    return messages.create({
      conversacion_id: conv.id,
      lead_session_id: sesion.id,
      direction: "in",
      sender: "lead",
      sender_user_id: null,
      tipo: "text",
      contenido,
      media_url: null,
      meta_message_id: wamid,
      idempotency_key: null,
      metadata: {},
    });
  }
  const origen = await entrante("Busco filtro de aceite", "wamid.IN-1");

  /** Un borrador ya generado para ese entrante, en el estado pedido. */
  async function borradorEn(estado: "listo" | "error" | "usado", leadSessionId = sesion.id) {
    const r = await borradores.iniciar({
      conversacionId: conv.id,
      leadSessionId,
      mensajeOrigenId: origen.id,
    });
    if (r.resultado !== "creado") throw new Error("fixture");
    if (estado === "error") {
      await borradores.marcarError(r.borradorId, "llm_error");
    } else {
      await borradores.completar(r.borradorId, {
        contenido: "Borrador viejo",
        origen: "ia",
        reglaId: null,
      });
      if (estado === "usado") {
        await borradores.marcarUsado(r.borradorId, { via: "copiar", usuarioId: null });
      }
    }
    return r.borradorId;
  }

  const ruleEngine = new DefaultRuleEngineService(
    intents,
    rules,
    new InMemoryReglasEtiquetaRepository(),
  );
  const deps = {
    borradores,
    conversations,
    sessions,
    messages,
    turnClassifications,
    intentClassifier: new DefaultIntentClassifierService(intents, intentLLM),
    aiAgent: new DefaultAiAgentService(
      sessions,
      ruleEngine,
      new DefaultCatalogMatcherService(new InMemoryProductsRepository()),
      agentLLM,
    ),
    configProvider: new StaticAgentConfigProvider({ ...CONFIG_DE_FABRICA, ...config }),
  };
  return {
    deps,
    conv,
    sesion,
    origen,
    borradores,
    borradorEn,
    entrante,
    intentLLM,
    agentLLM,
    turnClassifications,
    sessions,
    intents,
  };
}

describe("copilotoBorradorHandler (Regenerar / Reintentar)", () => {
  test("regenera: descarta el borrador anterior y deja uno nuevo con el texto nuevo", async () => {
    const ctx = await makeCtx();
    const viejo = await ctx.borradorEn("listo");
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueueText("Texto nuevo.");

    const r = await copilotoBorradorHandler(
      { borradorId: viejo, conversacionId: ctx.conv.id },
      ctx.deps,
    );

    expect(r).toEqual({ estado: "listo" });
    expect((await ctx.borradores.findById(viejo))?.estado).toBe("descartado");
    const actual = await ctx.borradores.findActualByConversacion(ctx.conv.id);
    expect(actual).toMatchObject({ estado: "listo", contenido: "Texto nuevo.", origen: "ia" });
    expect(actual?.id).not.toBe(viejo);
    expect(ctx.agentLLM.calls).toHaveLength(1);
  });

  test("reusa la clasificación ya auditada del turno y no vuelve a llamar al clasificador", async () => {
    const ctx = await makeCtx();
    await ctx.turnClassifications.create({
      mensaje_id: ctx.origen.id,
      intent_id: null,
      intent_nombre: null,
      confidence: 0.42,
    });
    const viejo = await ctx.borradorEn("listo");
    ctx.agentLLM.enqueueText("Sin volver a clasificar.");

    await copilotoBorradorHandler({ borradorId: viejo, conversacionId: ctx.conv.id }, ctx.deps);

    expect(ctx.intentLLM.calls).toHaveLength(0);
    expect(ctx.agentLLM.calls[0]?.classification).toEqual({
      intent_nombre: null,
      confidence: 0.42,
    });
  });

  test("Reintentar desde un borrador en error", async () => {
    const ctx = await makeCtx();
    const fallido = await ctx.borradorEn("error");
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueueText("Esta vez salió.");

    const r = await copilotoBorradorHandler(
      { borradorId: fallido, conversacionId: ctx.conv.id },
      ctx.deps,
    );

    expect(r.estado).toBe("listo");
    expect((await ctx.borradores.findActualByConversacion(ctx.conv.id))?.contenido).toBe(
      "Esta vez salió.",
    );
  });

  test("un borrador ya usado no se regenera", async () => {
    const ctx = await makeCtx();
    const usado = await ctx.borradorEn("usado");

    const r = await copilotoBorradorHandler(
      { borradorId: usado, conversacionId: ctx.conv.id },
      ctx.deps,
    );

    expect(r).toEqual({ estado: "omitido", motivo: "borrador_no_vigente" });
    expect(ctx.agentLLM.calls).toHaveLength(0);
  });

  test("si la sesión del borrador ya no es la activa, se omite", async () => {
    const ctx = await makeCtx();
    const deOtraSesion = await ctx.borradorEn("listo", crypto.randomUUID());

    const r = await copilotoBorradorHandler(
      { borradorId: deOtraSesion, conversacionId: ctx.conv.id },
      ctx.deps,
    );

    expect(r).toEqual({ estado: "omitido", motivo: "sesion_cerrada" });
    expect(ctx.agentLLM.calls).toHaveLength(0);
  });

  test("si llegó otro mensaje del cliente, el pedido es obsoleto y no toca nada", async () => {
    const ctx = await makeCtx();
    const viejo = await ctx.borradorEn("listo");
    await ctx.entrante("¿y en stock?", "wamid.IN-2");

    const r = await copilotoBorradorHandler(
      { borradorId: viejo, conversacionId: ctx.conv.id },
      ctx.deps,
    );

    expect(r).toEqual({ estado: "omitido", motivo: "obsoleto" });
    expect((await ctx.borradores.findById(viejo))?.estado).toBe("listo");
    expect(ctx.agentLLM.calls).toHaveLength(0);
  });

  test("un error del modelo deja el borrador nuevo en error con llm_error y la función falla", async () => {
    const ctx = await makeCtx();
    const viejo = await ctx.borradorEn("listo");
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueue(async () => {
      throw new Error("proveedor caído");
    });

    await expect(
      copilotoBorradorHandler({ borradorId: viejo, conversacionId: ctx.conv.id }, ctx.deps),
    ).rejects.toThrow("proveedor caído");

    const actual = await ctx.borradores.findActualByConversacion(ctx.conv.id);
    expect(actual).toMatchObject({ estado: "error", error_codigo: "llm_error" });
  });

  test("el tope diario deja tope_diario", async () => {
    const ctx = await makeCtx();
    const viejo = await ctx.borradorEn("listo");
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueue(async () => {
      throw new BudgetExceededError("tope", "llm_diario");
    });

    await expect(
      copilotoBorradorHandler({ borradorId: viejo, conversacionId: ctx.conv.id }, ctx.deps),
    ).rejects.toBeInstanceOf(BudgetExceededError);

    expect((await ctx.borradores.findActualByConversacion(ctx.conv.id))?.error_codigo).toBe(
      "tope_diario",
    );
  });

  test("con la IA pausada no hay borrador: queda en error ia_no_disponible para que se vea por qué", async () => {
    const ctx = await makeCtx();
    const viejo = await ctx.borradorEn("listo");
    await ctx.sessions.update(ctx.sesion.id, { ia_pausada: true });
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });

    const r = await copilotoBorradorHandler(
      { borradorId: viejo, conversacionId: ctx.conv.id },
      ctx.deps,
    );

    expect(r).toEqual({ estado: "error", motivo: "ia_no_disponible" });
    expect((await ctx.borradores.findActualByConversacion(ctx.conv.id))?.error_codigo).toBe(
      "ia_no_disponible",
    );
  });

  test("un descuento por encima del tope queda en error descuento_excedido", async () => {
    const ctx = await makeCtx({ descuento_max_pct: 5 });
    const viejo = await ctx.borradorEn("listo");
    ctx.intentLLM.enqueue({ intent_nombre: null, confidence: 0 });
    ctx.agentLLM.enqueueText("Te hago un 20% de descuento.");

    const r = await copilotoBorradorHandler(
      { borradorId: viejo, conversacionId: ctx.conv.id },
      ctx.deps,
    );

    expect(r).toEqual({ estado: "error", motivo: "descuento_excedido" });
  });
});
```

```bash
npx vitest run tests/unit/copiloto-borrador-function.test.ts 2>&1 | tail -8
```

Expected: FAIL `Failed to resolve import "@/inngest/functions/copiloto-borrador"`.

- [ ] **Step 6: Implementar la función**

Crear `src/inngest/functions/copiloto-borrador.ts`:

```ts
import { NonRetriableError } from "inngest";
import { inngest } from "@/inngest/client";
import { copilotoBorradorSolicitado } from "@/inngest/events";
import { passthroughStep, type StepRunner } from "@/inngest/functions/on-message-received";
import { codigoDeErrorBorrador } from "@/lib/copiloto/errores";
import { resolverResultadoRegenerado } from "@/lib/copiloto/resultado";
import { isNonRetriable } from "@/lib/errors";
import { NoopLogger, type Logger } from "@/lib/observability/logger";
import type { IntentClassification } from "@/lib/validation/ai";
import type { BorradoresIaRepository } from "@/server/repositories/borradores-ia.repo";
import type { ConversationsRepository } from "@/server/repositories/conversations.repo";
import type { LeadSessionRepository } from "@/server/repositories/lead-session.repo";
import type { MessagesRepository } from "@/server/repositories/messages.repo";
import type { TurnClassificationsRepository } from "@/server/repositories/turn-classifications.repo";
import type { AgentConfigProvider } from "@/server/services/agente/config-provider";
import { buildConversationTurn } from "@/server/services/agente/conversation-turn";
import type { AiAgentService } from "@/server/services/ai-agent.service";
import type { IntentClassifierService } from "@/server/services/intent-classifier.service";
import type { UUID } from "@/types/entities";

export interface CopilotoBorradorDeps {
  borradores: Pick<BorradoresIaRepository, "findById" | "iniciar" | "completar" | "marcarError">;
  conversations: Pick<ConversationsRepository, "findById">;
  sessions: Pick<LeadSessionRepository, "findActiveByLeadId">;
  messages: Pick<MessagesRepository, "findById" | "listByConversacion">;
  turnClassifications: Pick<TurnClassificationsRepository, "findByMensajeId">;
  intentClassifier: IntentClassifierService;
  aiAgent: AiAgentService;
  configProvider: AgentConfigProvider;
  logger?: Logger;
}

export interface CopilotoBorradorInput {
  borradorId: UUID;
  conversacionId: UUID;
}

export type ResultadoCopilotoBorrador = {
  estado: "listo" | "error" | "omitido";
  motivo?: string;
};

/**
 * Vuelve a redactar el borrador de una conversación con el contexto actual
 * (R4: `respond` solo corría dentro de `on-message-received`).
 *
 * Reconstruye lo que el pipeline le pasa a `respond`: el turno (últimos
 * mensajes + resumen) y la clasificación del entrante. La clasificación se
 * reusa de `turn_classifications` si el turno original la auditó; si no (lo
 * resolvió una regla, o falló antes), se vuelve a clasificar —es barato y queda
 * atribuido al mismo mensaje en `llm_usage`—.
 *
 * El texto del borrador nunca se loguea: los logs llevan ids, estados y códigos.
 */
export async function copilotoBorradorHandler(
  input: CopilotoBorradorInput,
  deps: CopilotoBorradorDeps,
  step: StepRunner = passthroughStep,
  idPaso: (paso: string) => string = (paso) => paso,
): Promise<ResultadoCopilotoBorrador> {
  const logger = (deps.logger ?? new NoopLogger()).child({
    workflow: "copiloto-borrador",
    borrador_id: input.borradorId,
  });

  const previo = await step.run(idPaso("cargar"), async () => {
    const b = await deps.borradores.findById(input.borradorId);
    if (!b) return { omitir: "borrador_inexistente" as const };
    if (b.conversacion_id !== input.conversacionId)
      return { omitir: "conversacion_distinta" as const };
    // Regenerar un borrador `usado` o `redactando` no tiene sentido: el primero ya se
    // envió y el segundo ya se está redactando.
    if (b.estado !== "listo" && b.estado !== "error")
      return { omitir: "borrador_no_vigente" as const };
    const conv = await deps.conversations.findById(b.conversacion_id);
    if (!conv) return { omitir: "conversacion_inexistente" as const };
    const sesion = await deps.sessions.findActiveByLeadId(conv.lead_id);
    if (!sesion || sesion.id !== b.lead_session_id) return { omitir: "sesion_cerrada" as const };
    return {
      omitir: null,
      leadId: conv.lead_id,
      leadSessionId: b.lead_session_id,
      mensajeOrigenId: b.mensaje_origen_id,
    };
  });
  if (previo.omitir !== null) {
    logger.info("copiloto-omitido", { motivo: previo.omitir });
    return { estado: "omitido", motivo: previo.omitir };
  }

  const nuevo = await step.run(idPaso("iniciar"), () =>
    deps.borradores.iniciar({
      conversacionId: input.conversacionId,
      leadSessionId: previo.leadSessionId,
      mensajeOrigenId: previo.mensajeOrigenId,
      forzar: true,
    }),
  );
  if (nuevo.resultado !== "creado") {
    logger.info("copiloto-omitido", { motivo: nuevo.resultado });
    return { estado: "omitido", motivo: nuevo.resultado };
  }
  const borradorId = nuevo.borradorId;

  try {
    const config = await step.run(idPaso("leer-config"), async () => {
      const c = await deps.configProvider.get();
      return {
        ventana_contexto_mensajes: c.ventana_contexto_mensajes,
        descuento_max_pct: c.descuento_max_pct,
      };
    });

    const clasificacion = await step.run(
      idPaso("clasificar"),
      async (): Promise<IntentClassification> => {
        const auditada = await deps.turnClassifications.findByMensajeId(previo.mensajeOrigenId);
        if (auditada) {
          return { intent_nombre: auditada.intent_nombre, confidence: auditada.confidence };
        }
        const origen = await deps.messages.findById(previo.mensajeOrigenId);
        return deps.intentClassifier.classify(origen?.contenido ?? "", {
          mensajeId: previo.mensajeOrigenId,
          leadSessionId: previo.leadSessionId,
        });
      },
    );

    const turno = await step.run(idPaso("armar-turno"), async () => {
      const sesion = await deps.sessions.findActiveByLeadId(previo.leadId);
      return buildConversationTurn(
        input.conversacionId,
        deps.messages,
        sesion?.context_summary ?? null,
        config.ventana_contexto_mensajes,
      );
    });

    const respuesta = await step.run(idPaso("responder"), () =>
      deps.aiAgent.respond({
        leadSessionId: previo.leadSessionId,
        conversationTurn: turno,
        classification: clasificacion,
        mensajeOrigenId: previo.mensajeOrigenId,
      }),
    );

    const resultado = resolverResultadoRegenerado(respuesta, config.descuento_max_pct);
    if (resultado.tipo === "error") {
      await step.run(idPaso("marcar-error"), () =>
        deps.borradores.marcarError(borradorId, resultado.codigo),
      );
      logger.info("copiloto-borrador-error", { codigo: resultado.codigo });
      return { estado: "error", motivo: resultado.codigo };
    }

    await step.run(idPaso("guardar"), () =>
      deps.borradores.completar(borradorId, {
        contenido: resultado.contenido,
        origen: resultado.origen,
        reglaId: resultado.reglaId,
      }),
    );
    logger.info("copiloto-borrador-listo", { origen: resultado.origen });
    return { estado: "listo" };
  } catch (error) {
    await step.run(idPaso("marcar-error-llm"), () =>
      deps.borradores.marcarError(borradorId, codigoDeErrorBorrador(error)),
    );
    logger.error("copiloto-borrador-fallo", {
      error_name: error instanceof Error ? error.name : typeof error,
    });
    throw error;
  }
}

function pasoDeInngest(step: {
  run: <U>(name: string, fn: () => Promise<U>) => Promise<unknown>;
}): StepRunner {
  return {
    run: <T>(name: string, fn: () => Promise<T>): Promise<T> => step.run(name, fn) as Promise<T>,
  };
}

export function makeCopilotoBorradorFn(deps: CopilotoBorradorDeps) {
  return inngest.createFunction(
    {
      id: "copiloto-borrador",
      // Dos pedidos sobre la misma conversación no corren a la vez; el lock del
      // RPC `iniciar_borrador_ia` cubre la carrera contra el pipeline.
      concurrency: { key: "event.data.conversacionId", limit: 1 },
      triggers: [{ event: copilotoBorradorSolicitado }],
    },
    async ({ event, step }) => {
      // Ids de step explícitos por pedido (AGENTS §0.10): el reintento de un
      // step no rehace lo que ya hizo, y dos pedidos no comparten memoización.
      const dia = new Date(event.ts).toISOString().slice(0, 10);
      try {
        return await copilotoBorradorHandler(
          event.data,
          deps,
          pasoDeInngest(step),
          (paso) => `copiloto-borrador-${dia}-${event.data.borradorId}-${paso}`,
        );
      } catch (e) {
        if (isNonRetriable(e)) {
          throw new NonRetriableError((e as Error).message, { cause: e });
        }
        throw e;
      }
    },
  );
}
```

```bash
npx vitest run tests/unit/copiloto-borrador-function.test.ts 2>&1 | tail -15
```

Expected: `Tests  10 passed`.

- [ ] **Step 7: Registrar la función y wirear los borradores**

`src/inngest/functions/index.ts`: agregar

```ts
import type { CopilotoBorradorDeps } from "@/inngest/functions/copiloto-borrador";
import { makeCopilotoBorradorFn } from "@/inngest/functions/copiloto-borrador";
```

`CrmInngestDeps` gana `copilotoBorrador: CopilotoBorradorDeps;` y el arreglo de `makeCrmInngestFunctions` gana al final `makeCopilotoBorradorFn(deps.copilotoBorrador),`.

`src/inngest/bootstrap.ts`:

- import `import { SupabaseBorradoresIaRepository } from "@/server/repositories/borradores-ia.supabase.repo";`
- con los otros repos: `const borradores = new SupabaseBorradoresIaRepository(db);`
- en `deps.onMessageReceived` agregar `borradores,` (junto a `turnClassifications,`);
- en `deps`, después de `drenarDifusiones: { motor: motorDifusion, logger },`:

```ts
    copilotoBorrador: {
      borradores,
      conversations,
      sessions,
      messages,
      turnClassifications,
      intentClassifier,
      aiAgent,
      configProvider: agenteConfigProvider,
      logger,
    },
```

`tests/unit/inngest-functions-factory.test.ts`: agregar `import { InMemoryBorradoresIaRepository } from "@/server/repositories/borradores-ia.repo";` y `InMemoryTurnClassificationsRepository` ya está importado; en la llamada a `makeCrmInngestFunctions` agregar al final de las deps:

```ts
      copilotoBorrador: {
        borradores: new InMemoryBorradoresIaRepository(),
        conversations,
        sessions,
        messages,
        turnClassifications: new InMemoryTurnClassificationsRepository(),
        intentClassifier,
        aiAgent,
        configProvider: new StaticAgentConfigProvider(CONFIG_DE_FABRICA),
      },
```

y cambiar `expect(fns).toHaveLength(18);` por `toHaveLength(19)`, el título `"produce 17 InngestFunction..."` por `"produce 19 InngestFunction con IDs esperados"`, y agregar a la lista `expect.stringContaining("copiloto-borrador"),`.

- [ ] **Step 8: Verificar, typecheck y commit**

```bash
npx vitest run tests/unit/inngest-functions-factory.test.ts tests/unit/copiloto-borrador-function.test.ts tests/unit/copiloto/resultado.test.ts 2>&1 | tail -10
npm run typecheck
git add src/lib/copiloto/resultado.ts src/server/services/agente/conversation-turn.ts src/inngest/functions/copiloto-borrador.ts src/inngest/functions/on-message-received.ts src/inngest/events.ts src/inngest/functions/index.ts src/inngest/bootstrap.ts tests/unit/copiloto/resultado.test.ts tests/unit/copiloto-borrador-function.test.ts tests/unit/inngest-functions-factory.test.ts
git commit -m "feat(copiloto): Regenerar y Reintentar como función Inngest propia" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: tests PASS y typecheck exit 0.

---

## Task 8: `CopilotoService` del panel, Server Actions y `ConversationView.conversacionId`

**Worker sugerido:** `worker-medium`.
**Depende de:** T4, T5, T7 (evento `copilotoBorradorSolicitado`).
**Skills a cargar antes:** `superpowers:test-driven-development`.

**Files:**

- Modify: `src/types/copiloto.ts`, `src/types/inbox.ts`, `src/server/services/inbox/default-inbox.service.ts`
- Create: `src/lib/copiloto/limites.ts`, `src/lib/validation/copiloto.schema.ts`, `src/server/services/copiloto/copiloto.service.ts`, `src/server/bootstrap/copiloto-bootstrap.ts`, `src/app/(panel)/inbox/_actions/cambiar-modo-respuesta.action.ts`, `src/app/(panel)/inbox/_actions/usar-borrador.action.ts`, `src/app/(panel)/inbox/_actions/regenerar-borrador.action.ts`
- Test: `tests/unit/copiloto/schema.test.ts`, `tests/unit/copiloto-service.test.ts`, `tests/unit/inbox-service.test.ts` (un caso)

**Interfaces:**

- Consumes: `BorradoresIaRepository` (T5), `ConversationsRepository.update` (T4), `decidirModo`/`equipoAbiertoAhora` (T3), evento (T7).
- Produces (T9–T13): en `src/types/copiloto.ts` `BorradorVista` y `EstadoCopiloto`; `LARGO_MAXIMO_BORRADOR = 4096`; `ConversationView.conversacionId: UUID | null`;

```ts
export interface CopilotoService {
  estado(input: { conversacionId: UUID; ultimoEntranteId: UUID | null }): Promise<EstadoCopiloto>;
  cambiarModo(input: { conversacionId: UUID; override: ModoOverride | null }): Promise<void>;
  usar(input: {
    borradorId: UUID;
    via: ViaUsoBorrador;
    texto: string;
    userId: UUID | null;
  }): Promise<{ yaUsado: boolean }>;
  solicitarRegeneracion(input: { borradorId: UUID; userId: UUID | null }): Promise<void>;
}
```

y las tres Server Actions `cambiarModoRespuestaAction(raw)`, `usarBorradorAction(raw)`, `regenerarBorradorAction(raw)` (todas `Promise<ActionResult>`).

- [ ] **Step 1: Tipos de vista y límite**

Agregar a `src/types/copiloto.ts`:

```ts
/** El borrador como lo consume la UI: sin ids internos de FK y con fechas en ISO (viajan a componentes cliente). */
export interface BorradorVista {
  id: UUID;
  estado: EstadoBorrador;
  contenido: string | null;
  origen: OrigenBorrador | null;
  /** "Regla: <nombre>" cuando `origen = "regla"`; `null` si la regla ya no existe. */
  reglaNombre: string | null;
  errorCodigo: string | null;
  usadoVia: ViaUsoBorrador | null;
  creadoAt: string;
}

export interface EstadoCopiloto {
  conversacionId: UUID;
  /** `null` = "Según horario". */
  override: ModoOverride | null;
  /** Lo que el pipeline haría si llegara un mensaje ahora (§3.2). */
  modoEfectivo: ModoDecidido;
  borrador: BorradorVista | null;
}
```

Crear `src/lib/copiloto/limites.ts`:

```ts
/**
 * Largo máximo de un borrador: el mismo que acepta `abrirChat` del puente de
 * escritorio (`LARGO_MAXIMO_TEXTO`, `desktop/src/main/seguridad.ts`) y el límite
 * del composer (`SendMessageSchema`). Un borrador más largo no se puede enviar
 * por ningún camino.
 */
export const LARGO_MAXIMO_BORRADOR = 4096;
```

- [ ] **Step 2: Test de los schemas (falla) e implementación**

Crear `tests/unit/copiloto/schema.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import {
  CambiarModoRespuestaSchema,
  RegenerarBorradorSchema,
  UsarBorradorSchema,
} from "@/lib/validation/copiloto.schema";

const LEAD = "11111111-1111-4111-8111-111111111111";
const CONV = "22222222-2222-4222-8222-222222222222";
const BORRADOR = "33333333-3333-4333-8333-333333333333";

describe("CambiarModoRespuestaSchema", () => {
  test.each(["segun_horario", "copiloto", "automatico"] as const)("acepta %s", (modo) => {
    expect(
      CambiarModoRespuestaSchema.safeParse({ leadId: LEAD, conversacionId: CONV, modo }).success,
    ).toBe(true);
  });

  test("rechaza un modo inventado y ids que no son uuid", () => {
    expect(
      CambiarModoRespuestaSchema.safeParse({ leadId: LEAD, conversacionId: CONV, modo: "manual" })
        .success,
    ).toBe(false);
    expect(
      CambiarModoRespuestaSchema.safeParse({ leadId: "x", conversacionId: CONV, modo: "copiloto" })
        .success,
    ).toBe(false);
  });
});

describe("UsarBorradorSchema", () => {
  test("acepta el texto editado y lo trimea", () => {
    const r = UsarBorradorSchema.parse({
      leadId: LEAD,
      borradorId: BORRADOR,
      via: "insertar",
      texto: "  Hola  ",
    });
    expect(r.texto).toBe("Hola");
  });

  test("rechaza texto vacío, de más de 4096 caracteres y una vía inventada", () => {
    const base = { leadId: LEAD, borradorId: BORRADOR, via: "copiar" as const };
    expect(UsarBorradorSchema.safeParse({ ...base, texto: "   " }).success).toBe(false);
    expect(UsarBorradorSchema.safeParse({ ...base, texto: "a".repeat(4097) }).success).toBe(false);
    expect(UsarBorradorSchema.safeParse({ ...base, texto: "a".repeat(4096) }).success).toBe(true);
    expect(UsarBorradorSchema.safeParse({ ...base, via: "telepatia", texto: "hola" }).success).toBe(
      false,
    );
  });
});

describe("RegenerarBorradorSchema", () => {
  test("pide lead y borrador", () => {
    expect(RegenerarBorradorSchema.safeParse({ leadId: LEAD, borradorId: BORRADOR }).success).toBe(
      true,
    );
    expect(RegenerarBorradorSchema.safeParse({ leadId: LEAD }).success).toBe(false);
  });
});
```

Crear `src/lib/validation/copiloto.schema.ts`:

```ts
import { z } from "zod";
import { LARGO_MAXIMO_BORRADOR } from "@/lib/copiloto/limites";
import { UUIDSchema } from "@/lib/validation/schemas";
import { VIAS_USO_BORRADOR } from "@/types/copiloto";

// Inputs de las Server Actions del copiloto. Regla §0.9.3: parse en la línea 1.

/** `segun_horario` es `null` en la base; acá tiene nombre para que el cliente no mande `null`. */
export const CambiarModoRespuestaSchema = z.object({
  leadId: UUIDSchema,
  conversacionId: UUIDSchema,
  modo: z.enum(["segun_horario", "copiloto", "automatico"]),
});
export type CambiarModoRespuestaInput = z.infer<typeof CambiarModoRespuestaSchema>;

/** `texto` es el texto final (quizá editado en la tarjeta): es lo que queda en el hilo. */
export const UsarBorradorSchema = z.object({
  leadId: UUIDSchema,
  borradorId: UUIDSchema,
  via: z.enum(VIAS_USO_BORRADOR),
  texto: z.string().trim().min(1).max(LARGO_MAXIMO_BORRADOR),
});
export type UsarBorradorInput = z.infer<typeof UsarBorradorSchema>;

export const RegenerarBorradorSchema = z.object({
  leadId: UUIDSchema,
  borradorId: UUIDSchema,
});
export type RegenerarBorradorInput = z.infer<typeof RegenerarBorradorSchema>;
```

```bash
npx vitest run tests/unit/copiloto/schema.test.ts 2>&1 | tail -8
```

Expected: `Tests  7 passed` (primero verlo fallar con `Failed to resolve import` antes de crear el schema).

- [ ] **Step 3: Test del servicio (falla)**

Crear `tests/unit/copiloto-service.test.ts`:

```ts
import { describe, expect, test, vi } from "vitest";
import { CONFIG_DE_FABRICA } from "@/lib/agente/defaults";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { InMemoryBorradoresIaRepository } from "@/server/repositories/borradores-ia.repo";
import { InMemoryConversationsRepository } from "@/server/repositories/conversations.repo";
import { InMemoryMessagesRepository } from "@/server/repositories/messages.repo";
import { InMemoryRulesRepository } from "@/server/repositories/rules.repo";
import { StaticAgentConfigProvider } from "@/server/services/agente/config-provider";
import { DefaultCopilotoService } from "@/server/services/copiloto/copiloto.service";
import { DIAS_SEMANA, type AgenteConfigValores, type Horario } from "@/types/agente";
import type { Canal } from "@/types/domain";

const USER = "99999999-9999-4999-8999-999999999999";
const SESION = "88888888-8888-4888-8888-888888888888";
const LEAD = "77777777-7777-4777-8777-777777777777";

function horario(abierto: boolean): Horario {
  const h = {} as Horario;
  for (const dia of DIAS_SEMANA) h[dia] = abierto ? [{ desde: "00:00", hasta: "23:59" }] : [];
  return h;
}

async function makeCtx(config: Partial<AgenteConfigValores> = {}, canal: Canal = "wa") {
  const conversations = new InMemoryConversationsRepository();
  const messages = new InMemoryMessagesRepository();
  const rules = new InMemoryRulesRepository();
  const borradores = new InMemoryBorradoresIaRepository();
  const solicitarRegeneracion = vi.fn(async () => {});
  const service = new DefaultCopilotoService({
    borradores,
    conversations,
    messages,
    rules,
    configProvider: new StaticAgentConfigProvider({ ...CONFIG_DE_FABRICA, ...config }),
    solicitarRegeneracion,
    now: () => new Date("2026-09-28T15:00:00Z"),
  });
  const conv = await conversations.create({
    lead_id: LEAD,
    canal,
    canal_thread_id: "5491155551234",
  });
  const entrante = await messages.create({
    conversacion_id: conv.id,
    lead_session_id: SESION,
    direction: "in",
    sender: "lead",
    sender_user_id: null,
    tipo: "text",
    contenido: "Busco filtro",
    media_url: null,
    meta_message_id: "wamid.IN-1",
    idempotency_key: null,
    metadata: {},
  });

  async function borradorListo(
    texto = "Borrador de la IA",
    origen: "ia" | "regla" = "ia",
    reglaId: string | null = null,
  ) {
    const r = await borradores.iniciar({
      conversacionId: conv.id,
      leadSessionId: SESION,
      mensajeOrigenId: entrante.id,
    });
    if (r.resultado !== "creado") throw new Error("fixture");
    await borradores.completar(r.borradorId, { contenido: texto, origen, reglaId });
    return r.borradorId;
  }
  return {
    service,
    conversations,
    messages,
    rules,
    borradores,
    conv,
    entrante,
    borradorListo,
    solicitarRegeneracion,
  };
}

describe("CopilotoService.estado", () => {
  test("sin borrador: modo efectivo según los horarios (equipo de turno = Copiloto)", async () => {
    const ctx = await makeCtx({ horario_equipo: horario(true) });

    const e = await ctx.service.estado({
      conversacionId: ctx.conv.id,
      ultimoEntranteId: ctx.entrante.id,
    });

    expect(e).toEqual({
      conversacionId: ctx.conv.id,
      override: null,
      modoEfectivo: "copiloto",
      borrador: null,
    });
  });

  test("con el equipo sin rangos y el agente abierto el modo efectivo es Automático", async () => {
    const ctx = await makeCtx();
    expect(
      (await ctx.service.estado({ conversacionId: ctx.conv.id, ultimoEntranteId: null }))
        .modoEfectivo,
    ).toBe("automatico");
  });

  test("el override manda sobre los horarios", async () => {
    const ctx = await makeCtx({ horario_equipo: horario(true) });
    await ctx.service.cambiarModo({ conversacionId: ctx.conv.id, override: "automatico" });

    const e = await ctx.service.estado({ conversacionId: ctx.conv.id, ultimoEntranteId: null });

    expect(e.override).toBe("automatico");
    expect(e.modoEfectivo).toBe("automatico");
  });

  test("en Instagram el copiloto no aplica: ni el override ni el equipo cambian el modo", async () => {
    const ctx = await makeCtx({ horario_equipo: horario(true) }, "ig");
    await ctx.service.cambiarModo({ conversacionId: ctx.conv.id, override: "copiloto" });

    const e = await ctx.service.estado({ conversacionId: ctx.conv.id, ultimoEntranteId: null });

    expect(e.modoEfectivo).toBe("automatico");
  });

  test("devuelve el borrador listo con el nombre de la regla cuando el origen es una regla", async () => {
    const ctx = await makeCtx();
    const regla = await ctx.rules.create({
      intent_id: crypto.randomUUID(),
      condiciones_extra: null,
      respuesta_tipo: "text",
      respuesta_contenido: "Abrimos de 9 a 18\nLunes a viernes",
      prioridad: 0,
      activa: true,
    });
    const id = await ctx.borradorListo("Abrimos de 9 a 18", "regla", regla.id);

    const e = await ctx.service.estado({
      conversacionId: ctx.conv.id,
      ultimoEntranteId: ctx.entrante.id,
    });

    expect(e.borrador).toMatchObject({
      id,
      estado: "listo",
      contenido: "Abrimos de 9 a 18",
      origen: "regla",
      reglaNombre: "Abrimos de 9 a 18",
    });
    expect(typeof e.borrador?.creadoAt).toBe("string");
  });

  test("un borrador usado cuyo entrante ya no es el último no se muestra", async () => {
    const ctx = await makeCtx();
    const id = await ctx.borradorListo();
    await ctx.borradores.marcarUsado(id, { via: "copiar", usuarioId: USER });

    const vigente = await ctx.service.estado({
      conversacionId: ctx.conv.id,
      ultimoEntranteId: ctx.entrante.id,
    });
    const viejo = await ctx.service.estado({
      conversacionId: ctx.conv.id,
      ultimoEntranteId: crypto.randomUUID(),
    });

    expect(vigente.borrador?.estado).toBe("usado");
    expect(viejo.borrador).toBeNull();
  });

  test("una conversación inexistente es NotFoundError", async () => {
    const ctx = await makeCtx();
    await expect(
      ctx.service.estado({ conversacionId: crypto.randomUUID(), ultimoEntranteId: null }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("CopilotoService.cambiarModo", () => {
  test("fija el override y null vuelve a Según horario", async () => {
    const ctx = await makeCtx();
    await ctx.service.cambiarModo({ conversacionId: ctx.conv.id, override: "copiloto" });
    expect((await ctx.conversations.findById(ctx.conv.id))?.modo_respuesta_override).toBe(
      "copiloto",
    );

    await ctx.service.cambiarModo({ conversacionId: ctx.conv.id, override: null });
    expect((await ctx.conversations.findById(ctx.conv.id))?.modo_respuesta_override).toBeNull();
  });
});

describe("CopilotoService.usar", () => {
  test("Insertar guarda el texto final como saliente humano 'sin confirmar' y marca el borrador usado", async () => {
    const ctx = await makeCtx();
    const id = await ctx.borradorListo("Texto original");

    const r = await ctx.service.usar({
      borradorId: id,
      via: "insertar",
      texto: "  Texto editado  ",
      userId: USER,
    });

    expect(r).toEqual({ yaUsado: false });
    const saliente = await ctx.messages.findByIdempotencyKey(`copiloto:${id}`);
    expect(saliente).toMatchObject({
      conversacion_id: ctx.conv.id,
      lead_session_id: SESION,
      direction: "out",
      sender: "humano",
      sender_user_id: USER,
      tipo: "text",
      contenido: "Texto editado",
      meta_message_id: null,
      metadata: { origen: "whatsapp_web_sin_confirmar", borrador_id: id },
    });
    expect(await ctx.borradores.findById(id)).toMatchObject({
      estado: "usado",
      usado_via: "insertar",
      usado_por: USER,
    });
  });

  test("tocar dos botones sobre el mismo borrador no duplica el mensaje", async () => {
    const ctx = await makeCtx();
    const id = await ctx.borradorListo();

    await ctx.service.usar({ borradorId: id, via: "copiar", texto: "Hola", userId: USER });
    const segunda = await ctx.service.usar({
      borradorId: id,
      via: "abrir_web",
      texto: "Hola",
      userId: USER,
    });

    expect(segunda).toEqual({ yaUsado: true });
    const salientes = (await ctx.messages.listByConversacion(ctx.conv.id)).filter(
      (m) => m.direction === "out",
    );
    expect(salientes).toHaveLength(1);
  });

  test("si el saliente ya existía (reintento tras un corte), no falla y igual marca usado", async () => {
    const ctx = await makeCtx();
    const id = await ctx.borradorListo();
    await ctx.messages.create({
      conversacion_id: ctx.conv.id,
      lead_session_id: SESION,
      direction: "out",
      sender: "humano",
      sender_user_id: USER,
      tipo: "text",
      contenido: "Hola",
      media_url: null,
      meta_message_id: null,
      idempotency_key: `copiloto:${id}`,
      metadata: { origen: "whatsapp_web_sin_confirmar", borrador_id: id },
    });

    const r = await ctx.service.usar({
      borradorId: id,
      via: "copiar",
      texto: "Hola",
      userId: USER,
    });

    expect(r).toEqual({ yaUsado: false });
    expect((await ctx.borradores.findById(id))?.estado).toBe("usado");
  });

  test("'Al composer' no guarda el saliente sin confirmar: lo crea sendMessageAction", async () => {
    const ctx = await makeCtx();
    const id = await ctx.borradorListo();

    await ctx.service.usar({ borradorId: id, via: "al_composer", texto: "Hola", userId: USER });

    expect(await ctx.messages.findByIdempotencyKey(`copiloto:${id}`)).toBeNull();
    expect((await ctx.borradores.findById(id))?.usado_via).toBe("al_composer");
  });

  test("un borrador que no está listo es ConflictError", async () => {
    const ctx = await makeCtx();
    const r = await ctx.borradores.iniciar({
      conversacionId: ctx.conv.id,
      leadSessionId: SESION,
      mensajeOrigenId: ctx.entrante.id,
    });
    if (r.resultado !== "creado") throw new Error("fixture");

    await expect(
      ctx.service.usar({ borradorId: r.borradorId, via: "copiar", texto: "Hola", userId: USER }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  test("texto vacío o de más de 4096 caracteres es ValidationError y no consume el borrador", async () => {
    const ctx = await makeCtx();
    const id = await ctx.borradorListo();

    await expect(
      ctx.service.usar({ borradorId: id, via: "copiar", texto: "   ", userId: USER }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      ctx.service.usar({ borradorId: id, via: "copiar", texto: "a".repeat(4097), userId: USER }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect((await ctx.borradores.findById(id))?.estado).toBe("listo");
  });

  test("un borrador inexistente es NotFoundError", async () => {
    const ctx = await makeCtx();
    await expect(
      ctx.service.usar({
        borradorId: crypto.randomUUID(),
        via: "copiar",
        texto: "Hola",
        userId: USER,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("CopilotoService.solicitarRegeneracion", () => {
  test("un borrador listo emite el pedido con los ids y quién lo pidió", async () => {
    const ctx = await makeCtx();
    const id = await ctx.borradorListo();

    await ctx.service.solicitarRegeneracion({ borradorId: id, userId: USER });

    expect(ctx.solicitarRegeneracion).toHaveBeenCalledWith({
      borradorId: id,
      conversacionId: ctx.conv.id,
      solicitadoPor: USER,
    });
  });

  test("un borrador en error se puede reintentar", async () => {
    const ctx = await makeCtx();
    const r = await ctx.borradores.iniciar({
      conversacionId: ctx.conv.id,
      leadSessionId: SESION,
      mensajeOrigenId: ctx.entrante.id,
    });
    if (r.resultado !== "creado") throw new Error("fixture");
    await ctx.borradores.marcarError(r.borradorId, "llm_error");

    await ctx.service.solicitarRegeneracion({ borradorId: r.borradorId, userId: null });

    expect(ctx.solicitarRegeneracion).toHaveBeenCalledTimes(1);
  });

  test("uno ya usado o que se está redactando es ConflictError y no emite", async () => {
    const ctx = await makeCtx();
    const id = await ctx.borradorListo();
    await ctx.borradores.marcarUsado(id, { via: "copiar", usuarioId: USER });

    await expect(
      ctx.service.solicitarRegeneracion({ borradorId: id, userId: USER }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(ctx.solicitarRegeneracion).not.toHaveBeenCalled();
  });
});
```

```bash
npx vitest run tests/unit/copiloto-service.test.ts 2>&1 | tail -8
```

Expected: FAIL `Failed to resolve import "@/server/services/copiloto/copiloto.service"`.

- [ ] **Step 4: Implementar el servicio**

Crear `src/server/services/copiloto/copiloto.service.ts`:

```ts
import { estaAbierto } from "@/lib/agente/horario";
import { LARGO_MAXIMO_BORRADOR } from "@/lib/copiloto/limites";
import { decidirModo, equipoAbiertoAhora } from "@/lib/copiloto/modo";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { nombreDeRegla } from "@/lib/ui/regla";
import type { BorradoresIaRepository } from "@/server/repositories/borradores-ia.repo";
import type { ConversationsRepository } from "@/server/repositories/conversations.repo";
import type { MessagesRepository } from "@/server/repositories/messages.repo";
import type { RulesRepository } from "@/server/repositories/rules.repo";
import type { AgentConfigProvider } from "@/server/services/agente/config-provider";
import type {
  BorradorIa,
  BorradorVista,
  EstadoCopiloto,
  ModoOverride,
  ViaUsoBorrador,
} from "@/types/copiloto";
import type { UUID } from "@/types/entities";

/**
 * Pide volver a redactar un borrador. Es una función inyectada y no una llamada
 * a Inngest porque `server/services/**` no puede importar `src/inngest/**`
 * (boundaries); la arma `server/bootstrap/copiloto-bootstrap.ts`.
 */
export type SolicitarRegeneracionFn = (input: {
  borradorId: UUID;
  conversacionId: UUID;
  solicitadoPor: UUID | null;
}) => Promise<void>;

export interface CopilotoService {
  estado(input: { conversacionId: UUID; ultimoEntranteId: UUID | null }): Promise<EstadoCopiloto>;
  cambiarModo(input: { conversacionId: UUID; override: ModoOverride | null }): Promise<void>;
  /**
   * Marca el borrador usado y, salvo "Al composer", guarda el texto final en el
   * hilo como saliente "enviado por WhatsApp Web, sin confirmar" (§3.4).
   */
  usar(input: {
    borradorId: UUID;
    via: ViaUsoBorrador;
    texto: string;
    userId: UUID | null;
  }): Promise<{ yaUsado: boolean }>;
  solicitarRegeneracion(input: { borradorId: UUID; userId: UUID | null }): Promise<void>;
}

export interface CopilotoServiceDeps {
  borradores: Pick<BorradoresIaRepository, "findById" | "findActualByConversacion" | "marcarUsado">;
  conversations: Pick<ConversationsRepository, "findById" | "update" | "touch">;
  messages: Pick<MessagesRepository, "create">;
  rules: Pick<RulesRepository, "findById">;
  configProvider: AgentConfigProvider;
  solicitarRegeneracion: SolicitarRegeneracionFn;
  /** Inyectable para fijar la hora en los tests. */
  now?: () => Date;
}

export class DefaultCopilotoService implements CopilotoService {
  constructor(private readonly deps: CopilotoServiceDeps) {}

  private ahora(): Date {
    return this.deps.now ? this.deps.now() : new Date();
  }

  async estado(input: {
    conversacionId: UUID;
    ultimoEntranteId: UUID | null;
  }): Promise<EstadoCopiloto> {
    const conv = await this.deps.conversations.findById(input.conversacionId);
    if (!conv) {
      throw new NotFoundError(
        `conversación no encontrada: ${input.conversacionId}`,
        "conversacion",
        input.conversacionId,
      );
    }
    const [config, actual] = await Promise.all([
      this.deps.configProvider.get(),
      this.deps.borradores.findActualByConversacion(conv.id),
    ]);

    const ahora = this.ahora();
    // El copiloto es de WhatsApp: en otros canales el modo no mira override ni equipo.
    const esWa = conv.canal === "wa";
    const modoEfectivo = decidirModo({
      override: esWa ? conv.modo_respuesta_override : null,
      equipoAbierto: esWa && equipoAbiertoAhora(config, ahora),
      agenteAbierto: estaAbierto(config.horario, config.horario_timezone, ahora),
    });

    // Un borrador `usado` se queda atenuado solo mientras siga siendo la
    // respuesta al último mensaje del cliente: si llegó otro, ya es historia.
    const visible =
      actual !== null &&
      (actual.estado !== "usado" || actual.mensaje_origen_id === input.ultimoEntranteId);

    return {
      conversacionId: conv.id,
      override: conv.modo_respuesta_override,
      modoEfectivo,
      borrador: visible ? await this.vista(actual) : null,
    };
  }

  async cambiarModo(input: { conversacionId: UUID; override: ModoOverride | null }): Promise<void> {
    await this.deps.conversations.update(input.conversacionId, {
      modo_respuesta_override: input.override,
    });
  }

  async usar(input: {
    borradorId: UUID;
    via: ViaUsoBorrador;
    texto: string;
    userId: UUID | null;
  }): Promise<{ yaUsado: boolean }> {
    const borrador = await this.requerirBorrador(input.borradorId);
    if (borrador.estado === "usado") return { yaUsado: true };
    if (borrador.estado !== "listo") {
      throw new ConflictError(
        `el borrador ${borrador.id} no está listo (${borrador.estado})`,
        "borrador_no_disponible",
      );
    }

    const texto = input.texto.trim();
    if (texto.length === 0 || texto.length > LARGO_MAXIMO_BORRADOR) {
      throw new ValidationError(
        `el texto del borrador tiene que tener entre 1 y ${LARGO_MAXIMO_BORRADOR} caracteres`,
        "borrador_texto_invalido",
      );
    }

    if (input.via !== "al_composer") {
      // Primero el saliente y después la marca: si el proceso muere entre los
      // dos, el reintento no duplica el mensaje (misma `idempotency_key`) y
      // termina de marcar. Al revés, un borrador usado podría quedar sin su
      // saliente en el hilo.
      try {
        await this.deps.messages.create({
          conversacion_id: borrador.conversacion_id,
          lead_session_id: borrador.lead_session_id,
          direction: "out",
          sender: "humano",
          sender_user_id: input.userId,
          tipo: "text",
          contenido: texto,
          media_url: null,
          meta_message_id: null,
          idempotency_key: `copiloto:${borrador.id}`,
          metadata: { origen: "whatsapp_web_sin_confirmar", borrador_id: borrador.id },
        });
        await this.deps.conversations.touch(borrador.conversacion_id);
      } catch (e) {
        if (!(e instanceof ConflictError)) throw e;
      }
    }

    const resultado = await this.deps.borradores.marcarUsado(borrador.id, {
      via: input.via,
      usuarioId: input.userId,
    });
    return { yaUsado: resultado === "ya_usado" };
  }

  async solicitarRegeneracion(input: { borradorId: UUID; userId: UUID | null }): Promise<void> {
    const borrador = await this.requerirBorrador(input.borradorId);
    if (borrador.estado !== "listo" && borrador.estado !== "error") {
      throw new ConflictError(
        `el borrador ${borrador.id} no se puede regenerar (${borrador.estado})`,
        "borrador_no_disponible",
      );
    }
    await this.deps.solicitarRegeneracion({
      borradorId: borrador.id,
      conversacionId: borrador.conversacion_id,
      solicitadoPor: input.userId,
    });
  }

  private async requerirBorrador(id: UUID): Promise<BorradorIa> {
    const borrador = await this.deps.borradores.findById(id);
    if (!borrador) throw new NotFoundError(`borrador no encontrado: ${id}`, "borrador_ia", id);
    return borrador;
  }

  private async vista(b: BorradorIa): Promise<BorradorVista> {
    let reglaNombre: string | null = null;
    if (b.origen === "regla" && b.regla_id !== null) {
      const regla = await this.deps.rules.findById(b.regla_id);
      reglaNombre = regla ? nombreDeRegla(regla.respuesta_contenido) : null;
    }
    return {
      id: b.id,
      estado: b.estado,
      contenido: b.contenido,
      origen: b.origen,
      reglaNombre,
      errorCodigo: b.error_codigo,
      usadoVia: b.usado_via,
      creadoAt: b.created_at.toISOString(),
    };
  }
}
```

```bash
npx vitest run tests/unit/copiloto-service.test.ts 2>&1 | tail -10
```

Expected: `Tests  18 passed`.

- [ ] **Step 5: Bootstrap, Server Actions y `conversacionId` en la vista**

Crear `src/server/bootstrap/copiloto-bootstrap.ts`:

```ts
import { inngest } from "@/inngest/client";
import { copilotoBorradorSolicitado } from "@/inngest/events";
import { getLogger } from "@/lib/observability/get-logger";
import { createSupabaseServerClient } from "@/server/auth/supabase-ssr";
import type { AppClient } from "@/server/db/client";
import { SupabaseAgenteConfigRepository } from "@/server/repositories/agente-config.supabase.repo";
import { SupabaseBorradoresIaRepository } from "@/server/repositories/borradores-ia.supabase.repo";
import { SupabaseConversationsRepository } from "@/server/repositories/conversations.supabase.repo";
import { SupabaseMessagesRepository } from "@/server/repositories/messages.supabase.repo";
import { SupabaseRulesRepository } from "@/server/repositories/rules.supabase.repo";
import { CachedAgentConfigProvider } from "@/server/services/agente/config-provider";
import {
  DefaultCopilotoService,
  type CopilotoService,
  type SolicitarRegeneracionFn,
} from "@/server/services/copiloto/copiloto.service";

/**
 * Encola "Regenerar / Reintentar". Vive acá y no en el servicio ni en la Server
 * Action porque `server/services/**` y `app/**` no pueden importar
 * `src/inngest/**` (boundaries): esta es la costura, igual que
 * `inbox-bootstrap.ts` con el recordatorio.
 *
 * El `id` es la deduplicación de Inngest: dos clics sobre la misma tarjeta son
 * un solo pedido. Tras regenerar el borrador es otro (otro id), así que una
 * segunda regeneración sí sale.
 */
const solicitarRegeneracion: SolicitarRegeneracionFn = async (input) => {
  await inngest.send({
    name: copilotoBorradorSolicitado.name,
    data: input,
    id: `copiloto-regenerar:${input.borradorId}`,
  });
};

/** Composición pura sobre un client dado (authed en el panel). */
export function makeCopilotoService(db: AppClient): CopilotoService {
  return new DefaultCopilotoService({
    borradores: new SupabaseBorradoresIaRepository(db),
    conversations: new SupabaseConversationsRepository(db),
    messages: new SupabaseMessagesRepository(db),
    rules: new SupabaseRulesRepository(db),
    configProvider: new CachedAgentConfigProvider(
      new SupabaseAgenteConfigRepository(db),
      getLogger({ scope: "copiloto" }),
    ),
    solicitarRegeneracion,
  });
}

/** El panel consume la DB con el client autenticado del request (RLS real). */
export async function getCopilotoServiceForRequest(): Promise<CopilotoService> {
  const db = await createSupabaseServerClient();
  return makeCopilotoService(db);
}
```

Crear las tres Server Actions (`"use server"`, Zod en la primera línea, usuario del request, errores curados con `toActionError`):

`src/app/(panel)/inbox/_actions/cambiar-modo-respuesta.action.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { CambiarModoRespuestaSchema } from "@/lib/validation/copiloto.schema";
import { getCopilotoServiceForRequest } from "@/server/bootstrap/copiloto-bootstrap";
import { toActionError } from "./action-error";
import type { ActionResult } from "@/types/inbox";

/**
 * El interruptor de 3 estados del encabezado. `segun_horario` vuelve el
 * override a `null`. No toca borradores ya generados: el modo se decide al
 * llegar cada mensaje.
 */
export async function cambiarModoRespuestaAction(raw: unknown): Promise<ActionResult> {
  const parsed = CambiarModoRespuestaSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Modo inválido: refrescá la página." };

  try {
    const svc = await getCopilotoServiceForRequest();
    await svc.cambiarModo({
      conversacionId: parsed.data.conversacionId,
      override: parsed.data.modo === "segun_horario" ? null : parsed.data.modo,
    });
  } catch (e) {
    return toActionError(e, "cambiar-modo-respuesta");
  }

  revalidatePath(`/inbox/${parsed.data.leadId}`);
  return { ok: true };
}
```

`src/app/(panel)/inbox/_actions/usar-borrador.action.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { UsarBorradorSchema } from "@/lib/validation/copiloto.schema";
import { getAuthenticatedUser } from "@/server/auth/supabase-ssr";
import { getCopilotoServiceForRequest } from "@/server/bootstrap/copiloto-bootstrap";
import { toActionError } from "./action-error";
import type { ActionResult } from "@/types/inbox";

/**
 * La persona usó el borrador (Insertar / Copiar / Abrir en WhatsApp Web / Al
 * composer). Guarda el texto final en el hilo como "enviado por WhatsApp Web,
 * sin confirmar" (salvo "Al composer", que envía `sendMessageAction`) y marca el
 * borrador usado una sola vez.
 */
export async function usarBorradorAction(raw: unknown): Promise<ActionResult> {
  const parsed = UsarBorradorSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Borrador inválido: revisá el texto (1-4096 caracteres)." };
  }

  try {
    const user = await getAuthenticatedUser();
    if (!user) return { ok: false, error: "Tu sesión expiró. Volvé a iniciar sesión." };
    const svc = await getCopilotoServiceForRequest();
    await svc.usar({
      borradorId: parsed.data.borradorId,
      via: parsed.data.via,
      texto: parsed.data.texto,
      userId: user.id,
    });
  } catch (e) {
    return toActionError(e, "usar-borrador", {
      conflicto: "El borrador ya no está disponible. Refrescá la página.",
    });
  }

  revalidatePath(`/inbox/${parsed.data.leadId}`);
  return { ok: true };
}
```

`src/app/(panel)/inbox/_actions/regenerar-borrador.action.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { RegenerarBorradorSchema } from "@/lib/validation/copiloto.schema";
import { getAuthenticatedUser } from "@/server/auth/supabase-ssr";
import { getCopilotoServiceForRequest } from "@/server/bootstrap/copiloto-bootstrap";
import { toActionError } from "./action-error";
import type { ActionResult } from "@/types/inbox";

/**
 * "Regenerar" (borrador listo) y "Reintentar" (borrador en error). No ejecuta el
 * LLM acá: encola el pedido y la función `copiloto-borrador` redacta; la tarjeta
 * vuelve a "Redactando…" cuando la función arranca el borrador nuevo.
 */
export async function regenerarBorradorAction(raw: unknown): Promise<ActionResult> {
  const parsed = RegenerarBorradorSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Borrador inválido: refrescá la página." };

  try {
    const user = await getAuthenticatedUser();
    if (!user) return { ok: false, error: "Tu sesión expiró. Volvé a iniciar sesión." };
    const svc = await getCopilotoServiceForRequest();
    await svc.solicitarRegeneracion({ borradorId: parsed.data.borradorId, userId: user.id });
  } catch (e) {
    return toActionError(e, "regenerar-borrador", {
      conflicto: "Ese borrador ya no se puede regenerar. Refrescá la página.",
    });
  }

  revalidatePath(`/inbox/${parsed.data.leadId}`);
  return { ok: true };
}
```

`ConversationView.conversacionId`: en `src/types/inbox.ts`, dentro de `ConversationView`, después de `canalActivo: Canal;`:

```ts
/**
 * La conversación del canal activo (la de actividad más reciente), o `null`
 * si el lead no tiene ninguna. Es sobre la que operan el interruptor de modo y
 * la tarjeta del copiloto.
 */
conversacionId: UUID | null;
```

y en `DefaultInboxService.getConversation`, en el objeto que retorna, después de `canalActivo,`: `conversacionId: masReciente?.id ?? null,`. Agregar a `tests/unit/inbox-service.test.ts`, dentro de `describe("DefaultInboxService.getConversation", ...)` (después del test `"sin conversaciones: canalActivo cae a canal_origen"`; usa los `leads`, `sessions`, `convs` y helpers `makeLead`/`makeSession` de ese archivo):

```ts
test("expone la conversación del canal activo para el copiloto, o null sin conversaciones", async () => {
  const sinConversacion = await makeLead(leads);
  await makeSession(sessions, sinConversacion.id);
  expect((await svc.getConversation(sinConversacion.id)).conversacionId).toBeNull();

  const lead = await makeLead(leads);
  await makeSession(sessions, lead.id);
  await convs.create({ lead_id: lead.id, canal: "wa", canal_thread_id: "wa-1" });
  await new Promise((r) => setTimeout(r, 5));
  const convIg = await convs.create({ lead_id: lead.id, canal: "ig", canal_thread_id: "ig-1" });

  // La más reciente por actividad: la misma que decide `canalActivo`.
  expect((await svc.getConversation(lead.id)).conversacionId).toBe(convIg.id);
});
```

- [ ] **Step 6: Verificar, typecheck y commit**

```bash
npx vitest run tests/unit/copiloto/schema.test.ts tests/unit/copiloto-service.test.ts tests/unit/inbox-service.test.ts tests/unit/inbox-consultas.test.ts 2>&1 | tail -10
npm run typecheck
git add src/types/copiloto.ts src/types/inbox.ts src/lib/copiloto/limites.ts src/lib/validation/copiloto.schema.ts src/server/services/copiloto/copiloto.service.ts src/server/bootstrap/copiloto-bootstrap.ts "src/app/(panel)/inbox/_actions/cambiar-modo-respuesta.action.ts" "src/app/(panel)/inbox/_actions/usar-borrador.action.ts" "src/app/(panel)/inbox/_actions/regenerar-borrador.action.ts" src/server/services/inbox/default-inbox.service.ts tests/unit/copiloto/schema.test.ts tests/unit/copiloto-service.test.ts tests/unit/inbox-service.test.ts
git commit -m "feat(copiloto): servicio del panel y actions de modo y uso" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: tests PASS y typecheck exit 0. (`inbox-consultas.test.ts` clava cuántas consultas hace `getConversation`: esta tarea no agrega ninguna; si falla, la causa es otra y hay que leerla.)

---

# Parte UI (las cuatro tareas T9–T12 son independientes entre sí y van en paralelo cuando T8 esté commiteada)

**Reglas comunes de las tareas de UI (T9–T13):**

1. **Skills de diseño primero, antes de escribir un estilo** (AGENTS §0.11.6): `frontend-design:frontend-design`, `ui-ux-pro-max:design-system`, `ecc:make-interfaces-feel-better`, `emil-design-eng`, `ecc:accessibility` (o `ecc:a11y-architect`), `vercel:shadcn` (antes de crear algo que ya existe vendorizado) y `motion-foundations` si algo se mueve. Tokens: los semánticos del repo (`bg-surface-*`, `border-line-*`, `text-ink-*`, `bg-brand text-brand-ink`, `text-ok|warn|danger`); nunca hex sueltos.
2. **El código de estos pasos fija el contrato** (props, roles ARIA, textos, comportamiento); el ejecutor puede ajustar clases, espaciados y microinteracciones para que se vea bien, **sin cambiar el contrato ni romper los tests de la tarea**.
3. **Medir en el navegador, no leer el diff** (lección 1). El preview `crm-dev` (`.claude/launch.json`, puerto 3001) no sirve para el panel porque exige sesión y no hay credenciales: la verificación medida se hace en la **Task 13** contra el **stack local** (`npm run dev:local`, `http://localhost:3002`, runbook §4.1), cuyos usuarios de prueba salen de `.env.stack-local` (`admin-local@crm.local` + `SEED_ADMIN_PASSWORD`; no repetir la contraseña en ningún reporte). Las tareas T9–T12 cierran con tests de componente (jsdom) + typecheck + lint; lo medido queda a cargo de T13 y el ejecutor de cada una deja anotado qué medidas espera que se verifiquen.
4. La app de escritorio **real** no se puede automatizar en el stack local: T10 la cubre con el fake `tests/helpers/crm-escritorio-fake.ts` y deja la prueba manual con la app corriendo como pendiente explícito.
5. Tests: `npx vitest run <ruta>` por archivo; `npm run typecheck`; `npx eslint <archivos tocados>`. Nunca la suite completa.

---

## Task 9: Interruptor de modo del encabezado

**Worker sugerido:** `worker-medium`.
**Depende de:** T8 (`cambiarModoRespuestaAction`, tipos, `CambiarModoRespuestaInput`).

**Files:**

- Create: `src/lib/copiloto/etiquetas.ts`, `src/components/inbox/copiloto/InterruptorModo.tsx`
- Test: `tests/unit/copiloto/etiquetas.test.ts`, `tests/unit/copiloto/interruptor-modo.test.tsx`

**Interfaces:**

- Consumes: `CambiarModoRespuestaInput` (`@/lib/validation/copiloto.schema`), `ModoOverride`, `ModoDecidido` (`@/types/copiloto`), `SelectOpciones` (`@/components/shared/SelectOpciones` — es el único punto autorizado a importar el Select de shadcn; lo vigila `tests/unit/select-opciones.test.tsx`).
- Produces (T13 y T10 en `etiquetas.ts`):

```ts
// src/lib/copiloto/etiquetas.ts
export type OpcionInterruptor = "segun_horario" | ModoOverride;
export function etiquetaModo(modo: ModoDecidido): string; // "Copiloto" | "Automático" | "Fuera de horario"
export function etiquetaOpcionModo(opcion: OpcionInterruptor, efectivo: ModoDecidido): string;
export function mensajeDeErrorBorrador(codigo: string | null): string;
export function etiquetaUso(via: ViaUsoBorrador | null): string;
// src/components/inbox/copiloto/InterruptorModo.tsx
export function InterruptorModo(props: {
  leadId: UUID;
  conversacionId: UUID;
  override: ModoOverride | null;
  modoEfectivo: ModoDecidido;
  onCambiar: (input: CambiarModoRespuestaInput) => Promise<ActionResult>;
}): JSX.Element;
```

- [ ] **Step 1: Test de los copys (falla)**

Crear `tests/unit/copiloto/etiquetas.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import {
  etiquetaModo,
  etiquetaOpcionModo,
  etiquetaUso,
  mensajeDeErrorBorrador,
} from "@/lib/copiloto/etiquetas";

describe("etiquetaModo", () => {
  test("nombra los tres resultados de §3.2", () => {
    expect(etiquetaModo("copiloto")).toBe("Copiloto");
    expect(etiquetaModo("automatico")).toBe("Automático");
    expect(etiquetaModo("fuera_de_horario")).toBe("Fuera de horario");
  });
});

describe("etiquetaOpcionModo", () => {
  test("'Según horario' muestra el modo efectivo: «Según horario · ahora Copiloto»", () => {
    expect(etiquetaOpcionModo("segun_horario", "copiloto")).toBe("Según horario · ahora Copiloto");
    expect(etiquetaOpcionModo("segun_horario", "fuera_de_horario")).toBe(
      "Según horario · ahora Fuera de horario",
    );
  });

  test("los fijos no dependen del horario", () => {
    expect(etiquetaOpcionModo("copiloto", "automatico")).toBe("Copiloto");
    expect(etiquetaOpcionModo("automatico", "copiloto")).toBe("Automático");
  });
});

describe("mensajeDeErrorBorrador", () => {
  test("traduce cada código a una frase accionable", () => {
    expect(mensajeDeErrorBorrador("llm_error")).toMatch(/No se pudo redactar/);
    expect(mensajeDeErrorBorrador("tope_diario")).toMatch(/tope de gasto diario/);
    expect(mensajeDeErrorBorrador("descuento_excedido")).toMatch(/descuento/);
    expect(mensajeDeErrorBorrador("ia_no_disponible")).toMatch(/pausada o escalada/);
  });

  test("un código desconocido o ausente no muestra el código crudo", () => {
    expect(mensajeDeErrorBorrador("algo_nuevo")).toBe("No se pudo redactar. Reintentá.");
    expect(mensajeDeErrorBorrador(null)).toBe("No se pudo redactar. Reintentá.");
  });
});

describe("etiquetaUso", () => {
  test("dice cómo se usó, en la voz de la tarjeta", () => {
    expect(etiquetaUso("insertar")).toBe("Ya usado · insertado en WhatsApp");
    expect(etiquetaUso("copiar")).toBe("Ya usado · copiado");
    expect(etiquetaUso("abrir_web")).toBe("Ya usado · abierto en WhatsApp Web");
    expect(etiquetaUso("al_composer")).toBe("Ya usado · enviado desde el CRM");
    expect(etiquetaUso(null)).toBe("Ya usado");
  });
});
```

```bash
npx vitest run tests/unit/copiloto/etiquetas.test.ts 2>&1 | tail -6
```

Expected: FAIL `Failed to resolve import "@/lib/copiloto/etiquetas"`.

- [ ] **Step 2: Implementar `etiquetas.ts`**

```ts
import type { ModoDecidido, ModoOverride, ViaUsoBorrador } from "@/types/copiloto";

/** Las tres opciones del interruptor: `segun_horario` es el `null` de la base. */
export type OpcionInterruptor = "segun_horario" | ModoOverride;

export function etiquetaModo(modo: ModoDecidido): string {
  if (modo === "copiloto") return "Copiloto";
  if (modo === "automatico") return "Automático";
  return "Fuera de horario";
}

/** El texto de cada opción. "Según horario" muestra lo que haría hoy, para que el equipo lo vea sin abrir Ajustes. */
export function etiquetaOpcionModo(opcion: OpcionInterruptor, efectivo: ModoDecidido): string {
  if (opcion === "segun_horario") return `Según horario · ahora ${etiquetaModo(efectivo)}`;
  return opcion === "copiloto" ? "Copiloto" : "Automático";
}

const ERRORES: Record<string, string> = {
  llm_error: "No se pudo redactar. Reintentá.",
  tope_diario: "Se alcanzó el tope de gasto diario de la IA. Redactá a mano o reintentá más tarde.",
  descuento_excedido: "La IA ofreció un descuento mayor al permitido. Redactá a mano.",
  ia_no_disponible: "La IA no redacta en esta conversación (pausada o escalada).",
};

/** El código corto de `borradores_ia.error_codigo` como frase. Nunca se muestra el código crudo. */
export function mensajeDeErrorBorrador(codigo: string | null): string {
  return (codigo !== null ? ERRORES[codigo] : undefined) ?? ERRORES["llm_error"]!;
}

export function etiquetaUso(via: ViaUsoBorrador | null): string {
  switch (via) {
    case "insertar":
      return "Ya usado · insertado en WhatsApp";
    case "copiar":
      return "Ya usado · copiado";
    case "abrir_web":
      return "Ya usado · abierto en WhatsApp Web";
    case "al_composer":
      return "Ya usado · enviado desde el CRM";
    default:
      return "Ya usado";
  }
}
```

```bash
npx vitest run tests/unit/copiloto/etiquetas.test.ts 2>&1 | tail -6
```

Expected: `Tests  6 passed`.

- [ ] **Step 3: Test del componente (falla)**

Crear `tests/unit/copiloto/interruptor-modo.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { InterruptorModo } from "@/components/inbox/copiloto/InterruptorModo";

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: toastError, success: vi.fn() } }));

afterEach(() => {
  cleanup();
  toastError.mockClear();
});

const LEAD = "11111111-1111-4111-8111-111111111111";
const CONV = "22222222-2222-4222-8222-222222222222";

function montar(
  props: Partial<React.ComponentProps<typeof InterruptorModo>> = {},
  resultado: { ok: true } | { ok: false; error: string } = { ok: true },
) {
  const onCambiar = vi.fn().mockResolvedValue(resultado);
  render(
    <InterruptorModo
      leadId={LEAD}
      conversacionId={CONV}
      override={null}
      modoEfectivo="copiloto"
      onCambiar={onCambiar}
      {...props}
    />,
  );
  return { onCambiar, disparador: screen.getByRole("combobox", { name: "Modo de respuesta" }) };
}

async function elegir(disparador: HTMLElement, nombre: string) {
  fireEvent.mouseDown(disparador);
  const opcion = await screen.findByRole("option", { name: nombre });
  fireEvent.keyDown(opcion, { key: "Shift" });
  fireEvent.click(opcion);
}

describe("InterruptorModo", () => {
  it("en Según horario muestra el modo efectivo", () => {
    const { disparador } = montar();
    expect(disparador.textContent).toContain("Según horario · ahora Copiloto");
  });

  it("con un override fijo muestra solo ese modo", () => {
    const { disparador } = montar({ override: "automatico", modoEfectivo: "automatico" });
    expect(disparador.textContent).toContain("Automático");
    expect(disparador.textContent).not.toContain("Según horario");
  });

  it("elegir Automático llama a la action con el modo nombrado", async () => {
    const { onCambiar, disparador } = montar();
    await elegir(disparador, "Automático");
    await waitFor(() =>
      expect(onCambiar).toHaveBeenCalledWith({
        leadId: LEAD,
        conversacionId: CONV,
        modo: "automatico",
      }),
    );
  });

  it("volver a Según horario manda segun_horario (no null)", async () => {
    const { onCambiar, disparador } = montar({ override: "copiloto" });
    await elegir(disparador, "Según horario · ahora Copiloto");
    await waitFor(() =>
      expect(onCambiar).toHaveBeenCalledWith({
        leadId: LEAD,
        conversacionId: CONV,
        modo: "segun_horario",
      }),
    );
  });

  it("si la action falla avisa con un toast", async () => {
    const { disparador } = montar({}, { ok: false, error: "No se pudo completar la acción." });
    await elegir(disparador, "Copiloto");
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("No se pudo completar la acción."));
  });
});
```

```bash
npx vitest run tests/unit/copiloto/interruptor-modo.test.tsx 2>&1 | tail -6
```

Expected: FAIL `Failed to resolve import`.

- [ ] **Step 4: Implementar `InterruptorModo`**

Crear `src/components/inbox/copiloto/InterruptorModo.tsx`:

```tsx
"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { SelectOpciones, type OpcionSelect } from "@/components/shared/SelectOpciones";
import { etiquetaOpcionModo, type OpcionInterruptor } from "@/lib/copiloto/etiquetas";
import type { CambiarModoRespuestaInput } from "@/lib/validation/copiloto.schema";
import type { ModoDecidido, ModoOverride } from "@/types/copiloto";
import type { UUID } from "@/types/entities";
import type { ActionResult } from "@/types/inbox";

const ORDEN: readonly OpcionInterruptor[] = ["segun_horario", "copiloto", "automatico"];

/**
 * Interruptor de modo de respuesta de la conversación (§5): "Según horario"
 * (default, muestra lo que haría ahora), "Copiloto" fijo y "Automático" fijo.
 *
 * Es un select y no tres botones: el encabezado del chat ya lleva avatar,
 * nombre, etapa y el chip de "IA activa", y a 520 px de ancho un segmentado de
 * tres textos no entra. `SelectOpciones` es el envoltorio del repo que evita
 * que Base UI pinte el valor crudo en el disparador.
 */
export function InterruptorModo({
  leadId,
  conversacionId,
  override,
  modoEfectivo,
  onCambiar,
}: {
  leadId: UUID;
  conversacionId: UUID;
  override: ModoOverride | null;
  modoEfectivo: ModoDecidido;
  onCambiar: (input: CambiarModoRespuestaInput) => Promise<ActionResult>;
}) {
  const [pendiente, startTransition] = useTransition();

  const opciones: OpcionSelect<OpcionInterruptor>[] = ORDEN.map((value) => ({
    value,
    label: etiquetaOpcionModo(value, modoEfectivo),
  }));

  return (
    <SelectOpciones<OpcionInterruptor>
      aria-label="Modo de respuesta"
      opciones={opciones}
      value={override ?? "segun_horario"}
      disabled={pendiente}
      size="sm"
      className="border-line-card bg-surface-elevated text-ink-secondary h-[30px] max-w-[240px] rounded-[9px] px-2.5 text-[11.5px] font-semibold"
      onValueChange={(modo) => {
        startTransition(async () => {
          const r = await onCambiar({ leadId, conversacionId, modo });
          if (!r.ok) toast.error(r.error);
        });
      }}
    />
  );
}
```

```bash
npx vitest run tests/unit/copiloto/interruptor-modo.test.tsx tests/unit/select-opciones.test.tsx 2>&1 | tail -8
```

Expected: ambos archivos en PASS (`select-opciones.test.tsx` incluye la guarda de "nadie importa el Select crudo": el componente nuevo no lo importa).

- [ ] **Step 5: Lint, typecheck y commit**

```bash
npx eslint src/lib/copiloto/etiquetas.ts src/components/inbox/copiloto/InterruptorModo.tsx
npm run typecheck
git add src/lib/copiloto/etiquetas.ts src/components/inbox/copiloto/InterruptorModo.tsx tests/unit/copiloto/etiquetas.test.ts tests/unit/copiloto/interruptor-modo.test.tsx
git commit -m "feat(copiloto): interruptor de modo de respuesta del encabezado" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: eslint sin errores, typecheck exit 0. Medidas que T13 debe verificar: el disparador no desborda el encabezado a 520 px de columna central y su texto más largo («Según horario · ahora Fuera de horario») no se corta sin `title`.

---

## Task 10: La tarjeta del borrador (4 estados, 3 ubicaciones) y el contexto de `CentroConversacion`

**Worker sugerido:** `worker-high` (estado delicado: texto editable que sobrevive al refresco de 5 s, orquestación puente + hilo + server action, carrera de modos).
**Depende de:** T8.
**Skills a cargar antes:** las de diseño (ver reglas comunes) + `superpowers:test-driven-development`.

**Files:**

- Create: `src/lib/copiloto/whatsapp-web.ts`, `src/lib/copiloto/acciones.ts`, `src/components/inbox/copiloto/ContextoCopiloto.tsx`, `src/components/inbox/copiloto/TarjetaBorrador.tsx`
- Modify: `src/components/icons.ts` (dos alias nuevos), `src/components/inbox/CentroConversacion.tsx`
- Test: `tests/unit/copiloto/whatsapp-web.test.ts`, `tests/unit/copiloto/acciones.test.ts`, `tests/unit/copiloto/tarjeta-borrador.test.tsx`, `tests/unit/copiloto/centro-con-tarjeta.test.tsx`

**Interfaces:**

- Consumes: `BorradorVista`, `ViaUsoBorrador` (`@/types/copiloto`), `UsarBorradorInput`/`RegenerarBorradorInput` (`@/lib/validation/copiloto.schema`), `SendMessageInput` (`@/lib/validation/inbox.schema`), `etiquetaUso`/`mensajeDeErrorBorrador` (T9), `LARGO_MAXIMO_BORRADOR` (T8), `motivoLegible` (`@/lib/whatsapp/chat`), `useEscritorio`, `usePreferenciaVistaCentro`.
- Produces (T13):

```ts
// src/lib/copiloto/acciones.ts
export type UbicacionTarjeta = "escritorio-whatsapp" | "escritorio-hilo" | "navegador";
export type AccionPrincipal = "insertar" | "abrir_web";
export const ETIQUETA_PRINCIPAL: Record<AccionPrincipal, string>;
export function accionesDeTarjeta(
  ubicacion: UbicacionTarjeta | null,
  hayTelefono: boolean,
): { principal: AccionPrincipal | null; alComposer: boolean };
// src/lib/copiloto/whatsapp-web.ts
export function urlWhatsAppWeb(telefono: string, texto: string): string | null;
export type TextoEnviable =
  | { ok: true; texto: string }
  | { ok: false; motivo: "vacio" | "largo"; exceso: number };
export function textoEnviable(crudo: string): TextoEnviable;
// src/components/inbox/copiloto/ContextoCopiloto.tsx
export const ContextoCopiloto: React.Context<ContextoCopilotoValor>;
export function useContextoCopiloto(): ContextoCopilotoValor;
// src/components/inbox/copiloto/TarjetaBorrador.tsx
export function TarjetaBorrador(props: {
  leadId: UUID;
  sessionId: UUID;
  canal: Canal;
  borrador: BorradorVista;
  onUsar: (i: UsarBorradorInput) => Promise<ActionResult>;
  onRegenerar: (i: RegenerarBorradorInput) => Promise<ActionResult>;
  onEnviar: (i: SendMessageInput) => Promise<ActionResult>; // "Al composer" = sendMessageAction
}): JSX.Element;
// CentroConversacion gana la prop opcional `tarjeta?: React.ReactNode` y provee el contexto.
```

- [ ] **Step 1: Tests de las funciones puras (fallan)**

Crear `tests/unit/copiloto/whatsapp-web.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { LARGO_MAXIMO_BORRADOR } from "@/lib/copiloto/limites";
import { textoEnviable, urlWhatsAppWeb } from "@/lib/copiloto/whatsapp-web";

describe("urlWhatsAppWeb", () => {
  test("arma la URL de §5: teléfono E.164 sin + y texto codificado", () => {
    expect(urlWhatsAppWeb("593979932363", "Hola, ¿tienen filtro? & más")).toBe(
      "https://web.whatsapp.com/send?phone=593979932363&text=Hola%2C%20%C2%BFtienen%20filtro%3F%20%26%20m%C3%A1s",
    );
  });

  test("los saltos de línea viajan codificados", () => {
    expect(urlWhatsAppWeb("593979932363", "uno\ndos")).toContain("text=uno%0Ados");
  });

  test("un teléfono que no es E.164 (con +, placeholder de Instagram, corto) no produce URL", () => {
    expect(urlWhatsAppWeb("+593979932363", "hola")).toBeNull();
    expect(urlWhatsAppWeb("ig:12345", "hola")).toBeNull();
    expect(urlWhatsAppWeb("12345", "hola")).toBeNull();
  });
});

describe("textoEnviable", () => {
  test("trimea y acepta hasta 4096 caracteres", () => {
    expect(textoEnviable("  hola  ")).toEqual({ ok: true, texto: "hola" });
    expect(textoEnviable("a".repeat(LARGO_MAXIMO_BORRADOR)).ok).toBe(true);
  });

  test("vacío y demasiado largo se rechazan con el motivo y cuánto se pasa", () => {
    expect(textoEnviable("   ")).toEqual({ ok: false, motivo: "vacio", exceso: 0 });
    expect(textoEnviable("a".repeat(LARGO_MAXIMO_BORRADOR + 5))).toEqual({
      ok: false,
      motivo: "largo",
      exceso: 5,
    });
  });
});
```

Crear `tests/unit/copiloto/acciones.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { ETIQUETA_PRINCIPAL, accionesDeTarjeta } from "@/lib/copiloto/acciones";

describe("accionesDeTarjeta (tabla de §5)", () => {
  test("app de escritorio en WhatsApp Web: Insertar, sin Al composer", () => {
    expect(accionesDeTarjeta("escritorio-whatsapp", true)).toEqual({
      principal: "insertar",
      alComposer: false,
    });
  });

  test("app de escritorio en Hilo del CRM: Insertar y Al composer", () => {
    expect(accionesDeTarjeta("escritorio-hilo", true)).toEqual({
      principal: "insertar",
      alComposer: true,
    });
  });

  test("navegador con teléfono: Abrir en WhatsApp Web", () => {
    expect(accionesDeTarjeta("navegador", true)).toEqual({
      principal: "abrir_web",
      alComposer: false,
    });
  });

  test("navegador sin teléfono válido: no hay a dónde abrir, queda Al composer", () => {
    expect(accionesDeTarjeta("navegador", false)).toEqual({ principal: null, alComposer: true });
  });

  test("mientras no se sabe dónde corre (primer render) no hay acción de envío", () => {
    expect(accionesDeTarjeta(null, true)).toEqual({ principal: null, alComposer: false });
  });

  test("los textos de las acciones principales", () => {
    expect(ETIQUETA_PRINCIPAL.insertar).toBe("Insertar en WhatsApp");
    expect(ETIQUETA_PRINCIPAL.abrir_web).toBe("Abrir en WhatsApp Web");
  });
});
```

```bash
npx vitest run tests/unit/copiloto/whatsapp-web.test.ts tests/unit/copiloto/acciones.test.ts 2>&1 | tail -6
```

Expected: FAIL (`Failed to resolve import`).

- [ ] **Step 2: Implementar las funciones puras**

`src/lib/copiloto/whatsapp-web.ts`:

```ts
import { LARGO_MAXIMO_BORRADOR } from "@/lib/copiloto/limites";
import { TELEFONO_WHATSAPP } from "@/lib/difusion/telefono";

/**
 * La URL que abre el chat en WhatsApp Web con el texto precargado (§5).
 *
 * El texto viaja solo en `send?text`: nunca se loguea ni va a un header. Que una
 * URL pueda terminar en el historial del navegador de la persona es una decisión
 * consciente del dueño para el contexto "navegador" (§6).
 *
 * `null` si el teléfono no es E.164 sin `+` (8–15 dígitos, sin 0 inicial): un
 * lead de Instagram guarda `ig:<id>` de relleno y eso no abre ningún chat.
 * Se usa `encodeURIComponent` y no `URLSearchParams` para que el espacio salga
 * como `%20` y no como `+`.
 */
export function urlWhatsAppWeb(telefono: string, texto: string): string | null {
  if (!TELEFONO_WHATSAPP.test(telefono)) return null;
  return `https://web.whatsapp.com/send?phone=${telefono}&text=${encodeURIComponent(texto)}`;
}

export type TextoEnviable =
  | { ok: true; texto: string }
  | { ok: false; motivo: "vacio" | "largo"; exceso: number };

/**
 * Lo que se puede mandar por cualquier camino: sin espacios de las puntas, no
 * vacío y de hasta `LARGO_MAXIMO_BORRADOR` (el tope de `abrirChat` y del
 * composer). Un borrador más largo se rechaza en vez de truncarse: cortar una
 * respuesta a mitad de frase sería mandarle algo que nadie escribió.
 */
export function textoEnviable(crudo: string): TextoEnviable {
  const texto = crudo.trim();
  if (texto.length === 0) return { ok: false, motivo: "vacio", exceso: 0 };
  if (texto.length > LARGO_MAXIMO_BORRADOR) {
    return { ok: false, motivo: "largo", exceso: texto.length - LARGO_MAXIMO_BORRADOR };
  }
  return { ok: true, texto };
}
```

`src/lib/copiloto/acciones.ts`:

```ts
/** Dónde se dibuja la tarjeta (§5). `null` mientras no se sabe si hay app de escritorio. */
export type UbicacionTarjeta = "escritorio-whatsapp" | "escritorio-hilo" | "navegador";
export type AccionPrincipal = "insertar" | "abrir_web";

export const ETIQUETA_PRINCIPAL: Record<AccionPrincipal, string> = {
  insertar: "Insertar en WhatsApp",
  abrir_web: "Abrir en WhatsApp Web",
};

/**
 * Qué acciones de envío ofrece la tarjeta en cada contexto. Copiar y Regenerar
 * están siempre; acá solo se decide la principal y si hay "Al composer" (que
 * envía por la API, con costo: es un saliente humano normal).
 */
export function accionesDeTarjeta(
  ubicacion: UbicacionTarjeta | null,
  hayTelefono: boolean,
): { principal: AccionPrincipal | null; alComposer: boolean } {
  switch (ubicacion) {
    case "escritorio-whatsapp":
      return { principal: "insertar", alComposer: false };
    case "escritorio-hilo":
      return { principal: "insertar", alComposer: true };
    case "navegador":
      return hayTelefono
        ? { principal: "abrir_web", alComposer: false }
        : { principal: null, alComposer: true };
    default:
      return { principal: null, alComposer: false };
  }
}
```

```bash
npx vitest run tests/unit/copiloto/whatsapp-web.test.ts tests/unit/copiloto/acciones.test.ts 2>&1 | tail -6
```

Expected: `Tests  11 passed`.

- [ ] **Step 3: Íconos y contexto**

En `src/components/icons.ts`, agregar en el `export { ... } from "lucide-react"` (en orden alfabético por alias): `ExternalLink as OpenInNew,` y `RefreshCw as Refresh,`.

Crear `src/components/inbox/copiloto/ContextoCopiloto.tsx`:

```tsx
"use client";

import { createContext, useContext } from "react";
import type { UbicacionTarjeta } from "@/lib/copiloto/acciones";

export type ResultadoInsertar = { ok: true } | { ok: false; error: string };

export interface ContextoCopilotoValor {
  /** `null` mientras no se sabe si la página corre en la app de escritorio (primer render). */
  ubicacion: UbicacionTarjeta | null;
  /** E.164 sin `+`, o `null` si el chat no se puede abrir en WhatsApp Web. */
  telefono: string | null;
  /**
   * Abre el chat en la vista de WhatsApp de la app de escritorio con el texto
   * precargado. Lo implementa `CentroConversacion`, que es el dueño del puente y
   * de la vista: si se está en "Hilo del CRM" pasa también a "WhatsApp Web".
   */
  insertarEnWhatsApp(texto: string): Promise<ResultadoInsertar>;
}

const POR_DEFECTO: ContextoCopilotoValor = {
  ubicacion: null,
  telefono: null,
  insertarEnWhatsApp: async () => ({
    ok: false,
    error: "La app de escritorio no está disponible.",
  }),
};

export const ContextoCopiloto = createContext<ContextoCopilotoValor>(POR_DEFECTO);

export function useContextoCopiloto(): ContextoCopilotoValor {
  return useContext(ContextoCopiloto);
}
```

- [ ] **Step 4: Tests de la tarjeta (fallan)**

Crear `tests/unit/copiloto/tarjeta-borrador.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  ContextoCopiloto,
  type ContextoCopilotoValor,
} from "@/components/inbox/copiloto/ContextoCopiloto";
import { TarjetaBorrador } from "@/components/inbox/copiloto/TarjetaBorrador";
import type { BorradorVista } from "@/types/copiloto";

const { toastError, toastSuccess } = vi.hoisted(() => ({
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { error: toastError, success: toastSuccess } }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  toastError.mockClear();
  toastSuccess.mockClear();
});

const LEAD = "lead-1";
const SESION = "sesion-1";
const TEL = "593979932363";
const TEXTO = "Hola, sí tenemos ese filtro.";
const URL_ESPERADA = `https://web.whatsapp.com/send?phone=${TEL}&text=Hola%2C%20s%C3%AD%20tenemos%20ese%20filtro.`;

function contexto(parcial: Partial<ContextoCopilotoValor> = {}): ContextoCopilotoValor {
  return {
    ubicacion: "navegador",
    telefono: TEL,
    insertarEnWhatsApp: vi.fn().mockResolvedValue({ ok: true }),
    ...parcial,
  };
}

function borrador(parcial: Partial<BorradorVista> = {}): BorradorVista {
  return {
    id: "b-1",
    estado: "listo",
    contenido: TEXTO,
    origen: "ia",
    reglaNombre: null,
    errorCodigo: null,
    usadoVia: null,
    creadoAt: "2026-09-30T15:00:00.000Z",
    ...parcial,
  };
}

function montar(ctx: ContextoCopilotoValor, b: BorradorVista = borrador()) {
  const onUsar = vi.fn().mockResolvedValue({ ok: true });
  const onRegenerar = vi.fn().mockResolvedValue({ ok: true });
  const onEnviar = vi.fn().mockResolvedValue({ ok: true });
  const elemento = (bor: BorradorVista) => (
    <ContextoCopiloto.Provider value={ctx}>
      <TarjetaBorrador
        leadId={LEAD}
        sessionId={SESION}
        canal="wa"
        borrador={bor}
        onUsar={onUsar}
        onRegenerar={onRegenerar}
        onEnviar={onEnviar}
      />
    </ContextoCopiloto.Provider>
  );
  const utils = render(elemento(b));
  return {
    onUsar,
    onRegenerar,
    onEnviar,
    rerender: (bor: BorradorVista) => utils.rerender(elemento(bor)),
  };
}

const areaTexto = () =>
  screen.getByRole("textbox", { name: "Texto del borrador" }) as HTMLTextAreaElement;

describe("TarjetaBorrador — navegador", () => {
  it("la acción principal es un enlace a WhatsApp Web con el texto precargado; usarlo marca abrir_web", async () => {
    const { onUsar } = montar(contexto());

    const enlace = screen.getByRole("link", { name: /Abrir en WhatsApp Web/ });
    expect(enlace.getAttribute("href")).toBe(URL_ESPERADA);
    expect(enlace.getAttribute("target")).toBe("_blank");
    expect(enlace.getAttribute("rel")).toContain("noopener");
    expect(screen.queryByRole("button", { name: /Al composer/ })).toBeNull();

    fireEvent.click(enlace);
    await waitFor(() =>
      expect(onUsar).toHaveBeenCalledWith({
        leadId: LEAD,
        borradorId: "b-1",
        via: "abrir_web",
        texto: TEXTO,
      }),
    );
  });

  it("el enlace usa el texto editado, no el original", () => {
    montar(contexto());
    fireEvent.change(areaTexto(), { target: { value: "Texto editado" } });
    expect(screen.getByRole("link", { name: /Abrir en WhatsApp Web/ }).getAttribute("href")).toBe(
      `https://web.whatsapp.com/send?phone=${TEL}&text=Texto%20editado`,
    );
  });

  it("Copiar escribe en el portapapeles y marca copiar", async () => {
    const escribir = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: escribir },
      configurable: true,
    });
    const { onUsar } = montar(contexto());

    fireEvent.click(screen.getByRole("button", { name: /Copiar/ }));

    await waitFor(() => expect(escribir).toHaveBeenCalledWith(TEXTO));
    await waitFor(() =>
      expect(onUsar).toHaveBeenCalledWith({
        leadId: LEAD,
        borradorId: "b-1",
        via: "copiar",
        texto: TEXTO,
      }),
    );
  });

  it("si el portapapeles falla lo dice y no marca usado", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockRejectedValue(new Error("denegado")) },
      configurable: true,
    });
    const { onUsar } = montar(contexto());

    fireEvent.click(screen.getByRole("button", { name: /Copiar/ }));

    await screen.findByText(/No se pudo copiar/);
    expect(onUsar).not.toHaveBeenCalled();
  });

  it("Ctrl+Enter ejecuta la acción principal (abre el enlace)", async () => {
    const { onUsar } = montar(contexto());
    fireEvent.keyDown(areaTexto(), { key: "Enter", ctrlKey: true });
    await waitFor(() =>
      expect(onUsar).toHaveBeenCalledWith(expect.objectContaining({ via: "abrir_web" })),
    );
  });

  it("sin teléfono válido no hay enlace: queda Al composer, que envía por la API y luego marca al_composer", async () => {
    const { onUsar, onEnviar } = montar(contexto({ telefono: null }));

    expect(screen.queryByRole("link")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Al composer/ }));

    await waitFor(() =>
      expect(onEnviar).toHaveBeenCalledWith({
        leadId: LEAD,
        sessionId: SESION,
        canal: "wa",
        body: TEXTO,
      }),
    );
    await waitFor(() =>
      expect(onUsar).toHaveBeenCalledWith({
        leadId: LEAD,
        borradorId: "b-1",
        via: "al_composer",
        texto: TEXTO,
      }),
    );
  });

  it("si el envío por la API falla no marca usado", async () => {
    const { onUsar, onEnviar } = montar(contexto({ telefono: null }));
    onEnviar.mockResolvedValue({ ok: false, error: "Ventana cerrada" });

    fireEvent.click(screen.getByRole("button", { name: /Al composer/ }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Ventana cerrada"));
    expect(onUsar).not.toHaveBeenCalled();
  });
});

describe("TarjetaBorrador — app de escritorio", () => {
  it("en WhatsApp Web: Insertar pasa el texto al puente y luego marca insertar; no hay Al composer", async () => {
    const insertar = vi.fn().mockResolvedValue({ ok: true });
    const { onUsar } = montar(
      contexto({ ubicacion: "escritorio-whatsapp", insertarEnWhatsApp: insertar }),
    );

    expect(screen.queryByRole("button", { name: /Al composer/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Insertar en WhatsApp" }));

    await waitFor(() => expect(insertar).toHaveBeenCalledWith(TEXTO));
    await waitFor(() =>
      expect(onUsar).toHaveBeenCalledWith({
        leadId: LEAD,
        borradorId: "b-1",
        via: "insertar",
        texto: TEXTO,
      }),
    );
  });

  it("en Hilo del CRM hay Insertar y Al composer", () => {
    montar(contexto({ ubicacion: "escritorio-hilo" }));
    expect(screen.getByRole("button", { name: "Insertar en WhatsApp" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Al composer/ })).toBeTruthy();
  });

  it("si la app no puede insertar muestra el motivo, sugiere Copiar y NO marca usado", async () => {
    const insertar = vi
      .fn()
      .mockResolvedValue({ ok: false, error: "WhatsApp Web tardó más de 30 segundos en cargar." });
    const { onUsar } = montar(
      contexto({ ubicacion: "escritorio-whatsapp", insertarEnWhatsApp: insertar }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Insertar en WhatsApp" }));

    const alerta = await screen.findByRole("alert");
    expect(alerta.textContent).toContain("tardó más de 30 segundos");
    expect(alerta.textContent).toContain("Copiar");
    expect(onUsar).not.toHaveBeenCalled();
  });

  it("Ctrl+Enter inserta", async () => {
    const insertar = vi.fn().mockResolvedValue({ ok: true });
    montar(contexto({ ubicacion: "escritorio-whatsapp", insertarEnWhatsApp: insertar }));
    fireEvent.keyDown(areaTexto(), { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(insertar).toHaveBeenCalledWith(TEXTO));
  });
});

describe("TarjetaBorrador — texto", () => {
  it("un borrador de más de 4096 caracteres se rechaza: ninguna acción de envío (ni Copiar) queda habilitada y se ve el contador", () => {
    montar(
      contexto({ ubicacion: "escritorio-whatsapp" }),
      borrador({ contenido: "a".repeat(4100) }),
    );

    expect(
      (screen.getByRole("button", { name: "Insertar en WhatsApp" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect((screen.getByRole("button", { name: /Copiar/ }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.getByText(/4100\s*\/\s*4096/)).toBeTruthy();
    expect(areaTexto().getAttribute("aria-invalid")).toBe("true");
  });

  it("lo editado sobrevive a un refresco con el mismo borrador (el poller de 5 s) y se resetea con otro", () => {
    const { rerender } = montar(contexto());
    fireEvent.change(areaTexto(), { target: { value: "Mi versión" } });

    rerender(borrador({ creadoAt: "2026-09-30T15:00:05.000Z" }));
    expect(areaTexto().value).toBe("Mi versión");

    rerender(borrador({ id: "b-2", contenido: "Borrador nuevo" }));
    expect(areaTexto().value).toBe("Borrador nuevo");
  });

  it("muestra el origen y la hora: «IA» o «Regla: <nombre>»", () => {
    const { rerender } = montar(contexto());
    expect(screen.getByRole("region", { name: "Borrador de la IA" }).textContent).toContain("IA");

    rerender(borrador({ origen: "regla", reglaNombre: "Abrimos de 9 a 18" }));
    expect(screen.getByRole("region", { name: "Borrador de la IA" }).textContent).toContain(
      "Regla: Abrimos de 9 a 18",
    );
  });
});

describe("TarjetaBorrador — estados", () => {
  it("redactando: estado anunciado y sin acciones", () => {
    montar(contexto(), borrador({ estado: "redactando", contenido: null, origen: null }));
    expect(screen.getByRole("status").textContent).toContain("Redactando…");
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("usado: atenuado, de solo lectura, dice cómo se usó y no ofrece enviar de nuevo", () => {
    montar(contexto(), borrador({ estado: "usado", usadoVia: "copiar" }));
    expect(screen.getByText("Ya usado · copiado")).toBeTruthy();
    expect(areaTexto().readOnly).toBe(true);
    expect(screen.queryByRole("button", { name: /Copiar/ })).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("error: alerta con la frase del código y Reintentar", async () => {
    const { onRegenerar } = montar(
      contexto(),
      borrador({ estado: "error", contenido: null, origen: null, errorCodigo: "tope_diario" }),
    );

    expect(screen.getByRole("alert").textContent).toContain("tope de gasto diario");
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await waitFor(() =>
      expect(onRegenerar).toHaveBeenCalledWith({ leadId: LEAD, borradorId: "b-1" }),
    );
  });

  it("Regenerar pide la regeneración y pasa a 'Redactando…' enseguida, sin esperar al refresco", async () => {
    const { onRegenerar } = montar(contexto());

    fireEvent.click(screen.getByRole("button", { name: /Regenerar/ }));

    await waitFor(() =>
      expect(onRegenerar).toHaveBeenCalledWith({ leadId: LEAD, borradorId: "b-1" }),
    );
    expect((await screen.findByRole("status")).textContent).toContain("Redactando…");
  });

  it("si Regenerar falla avisa y deja el borrador como estaba", async () => {
    const { onRegenerar } = montar(contexto());
    onRegenerar.mockResolvedValue({ ok: false, error: "Ese borrador ya no se puede regenerar." });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Regenerar/ }));
    });

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Ese borrador ya no se puede regenerar."),
    );
    expect(screen.queryByRole("status")).toBeNull();
    expect(areaTexto().value).toBe(TEXTO);
  });
});
```

```bash
npx vitest run tests/unit/copiloto/tarjeta-borrador.test.tsx 2>&1 | tail -6
```

Expected: FAIL `Failed to resolve import "@/components/inbox/copiloto/TarjetaBorrador"`.

- [ ] **Step 5: Implementar `TarjetaBorrador`**

Crear `src/components/inbox/copiloto/TarjetaBorrador.tsx`:

```tsx
"use client";

import { format } from "date-fns";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  AutoAwesome,
  DuplicateIcon,
  OpenInNew,
  Refresh,
  SendIcon,
  Warning,
} from "@/components/icons";
import { useContextoCopiloto } from "@/components/inbox/copiloto/ContextoCopiloto";
import { Textarea } from "@/components/ui/textarea";
import { ETIQUETA_PRINCIPAL, accionesDeTarjeta } from "@/lib/copiloto/acciones";
import { etiquetaUso, mensajeDeErrorBorrador } from "@/lib/copiloto/etiquetas";
import { LARGO_MAXIMO_BORRADOR } from "@/lib/copiloto/limites";
import { textoEnviable, urlWhatsAppWeb } from "@/lib/copiloto/whatsapp-web";
import type { RegenerarBorradorInput, UsarBorradorInput } from "@/lib/validation/copiloto.schema";
import type { SendMessageInput } from "@/lib/validation/inbox.schema";
import { cn } from "@/lib/utils";
import type { BorradorVista } from "@/types/copiloto";
import type { Canal } from "@/types/domain";
import type { UUID } from "@/types/entities";
import type { ActionResult } from "@/types/inbox";

/** Cuánto esperar a que aparezca el borrador regenerado antes de dejar de mostrar "Redactando…". */
const ESPERA_REGENERAR_MS = 45_000;

const BASE_BOTON =
  "focus-visible:ring-ring/50 inline-flex h-8 items-center gap-1.5 rounded-[9px] px-3 text-[11.5px] font-semibold whitespace-nowrap transition-colors focus-visible:ring-3 focus-visible:outline-none disabled:opacity-45";
const BOTON_PRINCIPAL = cn(BASE_BOTON, "bg-brand text-brand-ink");
const BOTON_SECUNDARIO = cn(
  BASE_BOTON,
  "border-line-card text-ink-secondary hover:bg-surface-elevated border bg-transparent",
);

interface Props {
  leadId: UUID;
  sessionId: UUID;
  canal: Canal;
  borrador: BorradorVista;
  onUsar: (input: UsarBorradorInput) => Promise<ActionResult>;
  onRegenerar: (input: RegenerarBorradorInput) => Promise<ActionResult>;
  /** "Al composer": el mismo envío por la API que el composer (`sendMessageAction`). */
  onEnviar: (input: SendMessageInput) => Promise<ActionResult>;
}

/**
 * La tarjeta del copiloto (§5): el borrador que la IA redactó, editable, con las
 * acciones que correspondan al contexto (app de escritorio en WhatsApp Web, app
 * de escritorio en Hilo del CRM, o navegador).
 *
 * El texto que la persona edita vive acá, en el estado del cuerpo, **atado al id
 * del borrador** (`key`): el refresco de 5 s del Inbox vuelve a renderizar con un
 * objeto nuevo del mismo borrador y no puede pisar lo que se está escribiendo;
 * un borrador distinto sí resetea el texto.
 */
export function TarjetaBorrador(props: Props) {
  const { borrador } = props;
  // Regenerar es asíncrono (la función Inngest arranca el borrador nuevo unos
  // segundos después): hasta que llegue uno con otro id se muestra "Redactando…".
  const [regenerandoDe, setRegenerandoDe] = useState<string | null>(null);
  const regenerando = regenerandoDe === borrador.id;

  useEffect(() => {
    if (!regenerando) return;
    const t = setTimeout(() => setRegenerandoDe(null), ESPERA_REGENERAR_MS);
    return () => clearTimeout(t);
  }, [regenerando]);

  const [, startTransition] = useTransition();
  const pedirRegenerar = () => {
    setRegenerandoDe(borrador.id);
    startTransition(async () => {
      const r = await props.onRegenerar({ leadId: props.leadId, borradorId: borrador.id });
      if (!r.ok) {
        setRegenerandoDe(null);
        toast.error(r.error);
      }
    });
  };

  const hora = (
    <time
      dateTime={borrador.creadoAt}
      suppressHydrationWarning
      className="text-ink-faint font-mono text-[9.5px]"
    >
      {format(new Date(borrador.creadoAt), "HH:mm")}
    </time>
  );
  const origen =
    borrador.origen === "regla" ? `Regla: ${borrador.reglaNombre ?? "sin nombre"}` : "IA";

  return (
    <section
      role="region"
      aria-label="Borrador de la IA"
      className={cn(
        "border-line-layout bg-surface-panel shrink-0 border-t px-[26px] py-3",
        borrador.estado === "usado" && "opacity-60",
      )}
    >
      <div className="mb-1.5 flex items-center gap-2">
        <AutoAwesome size={13} className="text-brand shrink-0" aria-hidden />
        <span className="text-ink-secondary text-[11.5px] font-semibold">
          Borrador de la IA · {origen}
        </span>
        {hora}
      </div>

      {regenerando || borrador.estado === "redactando" ? (
        <Redactando />
      ) : borrador.estado === "error" ? (
        <Fallo borrador={borrador} onReintentar={pedirRegenerar} />
      ) : (
        <Cuerpo key={borrador.id} {...props} onRegenerar={pedirRegenerar} />
      )}
    </section>
  );
}

function Redactando() {
  return (
    <div role="status" className="flex flex-col gap-1.5" aria-live="polite">
      <span className="text-ink-dim text-[12px]">Redactando…</span>
      <div aria-hidden className="flex flex-col gap-1.5 motion-safe:animate-pulse">
        <div className="bg-surface-elevated h-2.5 w-[80%] rounded-full" />
        <div className="bg-surface-elevated h-2.5 w-[55%] rounded-full" />
      </div>
    </div>
  );
}

function Fallo({ borrador, onReintentar }: { borrador: BorradorVista; onReintentar: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3">
      <Warning size={14} className="text-danger shrink-0" aria-hidden />
      <p className="text-danger min-w-0 flex-1 text-[12px]">
        {mensajeDeErrorBorrador(borrador.errorCodigo)}
      </p>
      <button type="button" onClick={onReintentar} className={BOTON_SECUNDARIO}>
        <Refresh size={13} aria-hidden />
        Reintentar
      </button>
    </div>
  );
}

function Cuerpo({ leadId, sessionId, canal, borrador, onUsar, onEnviar, onRegenerar }: Props) {
  const { ubicacion, telefono, insertarEnWhatsApp } = useContextoCopiloto();
  const usado = borrador.estado === "usado";
  const [texto, setTexto] = useState(borrador.contenido ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pendiente, startTransition] = useTransition();
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const enlaceRef = useRef<HTMLAnchorElement>(null);

  // El foco va al texto del borrador (§5), pero sin robárselo a otro campo: el
  // refresco no remonta este componente (misma `key`), así que solo corre al
  // aparecer un borrador nuevo.
  useEffect(() => {
    if (!usado && document.activeElement === document.body) areaRef.current?.focus();
  }, [usado]);

  const acciones = accionesDeTarjeta(ubicacion, telefono !== null);
  const valido = textoEnviable(texto);
  const enviable = valido.ok && !pendiente && !usado;
  const textoFinal = valido.ok ? valido.texto : "";
  const url =
    acciones.principal === "abrir_web" && telefono !== null && valido.ok
      ? urlWhatsAppWeb(telefono, valido.texto)
      : null;

  const marcar = (via: UsarBorradorInput["via"]) =>
    onUsar({ leadId, borradorId: borrador.id, via, texto: textoFinal });

  const insertar = () => {
    if (!enviable) return;
    setError(null);
    startTransition(async () => {
      const r = await insertarEnWhatsApp(textoFinal);
      if (!r.ok) {
        setError(`${r.error} Podés usar Copiar.`);
        return;
      }
      const u = await marcar("insertar");
      if (!u.ok) toast.error(u.error);
    });
  };

  const abrirWeb = () => {
    if (!enviable) return;
    void marcar("abrir_web").then((u) => {
      if (!u.ok) toast.error(u.error);
    });
  };

  const copiar = () => {
    if (!enviable) return;
    setError(null);
    startTransition(async () => {
      try {
        await navigator.clipboard.writeText(textoFinal);
      } catch {
        setError("No se pudo copiar al portapapeles. Seleccioná el texto y copialo a mano.");
        return;
      }
      const u = await marcar("copiar");
      if (!u.ok) toast.error(u.error);
      else toast.success("Copiado");
    });
  };

  const alComposer = () => {
    if (!enviable) return;
    startTransition(async () => {
      const e = await onEnviar({ leadId, sessionId, canal, body: textoFinal });
      if (!e.ok) {
        toast.error(e.error);
        return;
      }
      const u = await marcar("al_composer");
      if (!u.ok) toast.error(u.error);
    });
  };

  /** Ctrl+Enter = la acción principal; sin ninguna, la más segura que exista. */
  const accionDeTeclado = () => {
    if (acciones.principal === "insertar") return insertar();
    if (acciones.principal === "abrir_web") return enlaceRef.current?.click();
    if (acciones.alComposer) return alComposer();
    return copiar();
  };

  const idAyuda = `${borrador.id}-ayuda`;
  const largo = texto.trim().length;
  const conContador = largo > LARGO_MAXIMO_BORRADOR - 200;

  return (
    <div className="flex flex-col gap-2">
      <Textarea
        ref={areaRef}
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            accionDeTeclado();
          }
        }}
        readOnly={usado}
        aria-label="Texto del borrador"
        aria-invalid={!valido.ok && valido.motivo === "largo" ? true : undefined}
        aria-describedby={idAyuda}
        disabled={pendiente}
        // Como en `MessageInput`: hay que apagar las variantes `dark:` del primitivo de shadcn
        // (`dark:bg-input/30`, `dark:disabled:bg-input/80`) con la misma variante.
        className="text-ink-body border-line-input bg-surface-input dark:bg-surface-input dark:disabled:bg-surface-input max-h-40 min-h-[56px] w-full resize-none rounded-[12px] border px-3 py-2 text-[12.5px] md:text-[12.5px]"
      />
      <p id={idAyuda} className="text-ink-ghost font-mono text-[10px]">
        {usado ? etiquetaUso(borrador.usadoVia) : "Ctrl+Enter ejecuta la acción principal"}
        {conContador ? (
          <span className={cn("ml-2", !valido.ok && valido.motivo === "largo" && "text-danger")}>
            {largo} / {LARGO_MAXIMO_BORRADOR}
          </span>
        ) : null}
      </p>

      {error ? (
        <p role="alert" className="text-danger text-[11.5px]">
          {error}
        </p>
      ) : null}

      {usado ? null : (
        <div className="flex flex-wrap items-center gap-2">
          {acciones.principal === "insertar" ? (
            <button
              type="button"
              onClick={insertar}
              disabled={!enviable}
              className={BOTON_PRINCIPAL}
            >
              <SendIcon size={13} aria-hidden />
              {ETIQUETA_PRINCIPAL.insertar}
            </button>
          ) : null}
          {acciones.principal === "abrir_web" ? (
            <a
              ref={enlaceRef}
              href={url ?? undefined}
              target="_blank"
              rel="noopener noreferrer"
              aria-disabled={url === null}
              onClick={(e) => {
                if (url === null || !enviable) {
                  e.preventDefault();
                  return;
                }
                abrirWeb();
              }}
              className={cn(BOTON_PRINCIPAL, url === null && "pointer-events-none opacity-45")}
            >
              <OpenInNew size={13} aria-hidden />
              {ETIQUETA_PRINCIPAL.abrir_web}
            </a>
          ) : null}
          {acciones.alComposer ? (
            <button
              type="button"
              onClick={alComposer}
              disabled={!enviable}
              className={BOTON_SECUNDARIO}
            >
              Al composer
            </button>
          ) : null}
          <button type="button" onClick={copiar} disabled={!enviable} className={BOTON_SECUNDARIO}>
            <DuplicateIcon size={13} aria-hidden />
            Copiar
          </button>
          <button
            type="button"
            onClick={onRegenerar}
            disabled={pendiente}
            className={BOTON_SECUNDARIO}
          >
            <Refresh size={13} aria-hidden />
            Regenerar
          </button>
        </div>
      )}
    </div>
  );
}
```

```bash
npx vitest run tests/unit/copiloto/tarjeta-borrador.test.tsx 2>&1 | tail -15
```

Expected: `Tests  19 passed`. (`Textarea` es un componente de función de React 19: `ref` viaja como prop normal, verificado en `src/components/ui/textarea.tsx`.)

- [ ] **Step 6: `CentroConversacion` provee el contexto y aloja la tarjeta (tests con el fake del puente, fallan)**

Crear `tests/unit/copiloto/centro-con-tarjeta.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CentroConversacion } from "@/components/inbox/CentroConversacion";
import { TarjetaBorrador } from "@/components/inbox/copiloto/TarjetaBorrador";
import type { BorradorVista } from "@/types/copiloto";
import { crmEscritorioFake, ResizeObserverMock } from "../../helpers/crm-escritorio-fake";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const TEL = "593979932363";
const TEXTO = "Hola, sí tenemos ese filtro.";
const CLAVE_U1 = "crm:inbox:vista-centro:usuario-1";

afterEach(() => {
  cleanup();
  delete window.crmEscritorio;
  window.localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function conEscritorio(overrides?: Parameters<typeof crmEscritorioFake>[0]) {
  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  const crm = crmEscritorioFake(overrides);
  window.crmEscritorio = crm;
  return crm;
}

const borrador: BorradorVista = {
  id: "b-1",
  estado: "listo",
  contenido: TEXTO,
  origen: "ia",
  reglaNombre: null,
  errorCodigo: null,
  usadoVia: null,
  creadoAt: "2026-09-30T15:00:00.000Z",
};

function montar() {
  const onUsar = vi.fn().mockResolvedValue({ ok: true });
  const tarjeta = (
    <TarjetaBorrador
      leadId="lead-a"
      sessionId="s-1"
      canal="wa"
      borrador={borrador}
      onUsar={onUsar}
      onRegenerar={vi.fn().mockResolvedValue({ ok: true })}
      onEnviar={vi.fn().mockResolvedValue({ ok: true })}
    />
  );
  // Igual que la página: la misma tarjeta va dentro del hilo (sobre el composer) y
  // como prop del centro (entre la barra y la vista de WhatsApp).
  render(
    <CentroConversacion
      leadId="lead-a"
      usuarioId="usuario-1"
      telefono={TEL}
      tarjeta={tarjeta}
      hilo={
        <>
          <p>hilo del CRM</p>
          {tarjeta}
        </>
      }
    />,
  );
  return { onUsar };
}

describe("CentroConversacion con la tarjeta del copiloto", () => {
  it("en WhatsApp Web la tarjeta va entre la barra y la vista, y Insertar precarga el texto con el puente", async () => {
    const crm = conEscritorio();
    const { onUsar } = montar();
    await waitFor(() => expect(crm.abrirChat).toHaveBeenCalledWith(TEL, ""));

    const barra = screen.getByRole("group", { name: "Qué mostrar de la conversación" });
    const tarjeta = screen.getByRole("region", { name: "Borrador de la IA" });
    expect(barra.compareDocumentPosition(tarjeta) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText("hilo del CRM")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Insertar en WhatsApp" }));

    await waitFor(() => expect(crm.abrirChat).toHaveBeenLastCalledWith(TEL, TEXTO));
    await waitFor(() =>
      expect(onUsar).toHaveBeenCalledWith(
        expect.objectContaining({ via: "insertar", texto: TEXTO }),
      ),
    );
  });

  it("en Hilo del CRM Insertar abre el chat con el texto y pasa a WhatsApp Web sin recargarlo vacío", async () => {
    window.localStorage.setItem(CLAVE_U1, "hilo");
    const crm = conEscritorio();
    montar();
    await act(async () => {});
    expect(screen.getByText("hilo del CRM")).toBeTruthy();
    expect(crm.abrirChat).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Insertar en WhatsApp" }));

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "WhatsApp Web" }).getAttribute("aria-pressed"),
      ).toBe("true"),
    );
    // Una sola llamada, con el texto: el efecto de "abrir al entrar" no pisa lo precargado con "".
    expect(crm.abrirChat).toHaveBeenCalledTimes(1);
    expect(crm.abrirChat).toHaveBeenCalledWith(TEL, TEXTO);
  });

  it("si la app rechaza el pedido lo muestra en texto humano y no marca usado ni cambia de vista", async () => {
    window.localStorage.setItem(CLAVE_U1, "hilo");
    const crm = conEscritorio({
      abrirChat: vi.fn().mockResolvedValue({ ok: false, motivo: "timeout_30s" }),
    });
    const { onUsar } = montar();

    fireEvent.click(screen.getByRole("button", { name: "Insertar en WhatsApp" }));

    const alerta = await screen.findByRole("alert");
    expect(alerta.textContent).toContain("más de 30 segundos");
    expect(onUsar).not.toHaveBeenCalled();
    expect(screen.getByText("hilo del CRM")).toBeTruthy();
    expect(crm.abrirChat).toHaveBeenCalledTimes(1);
  });

  it("en el navegador (sin app de escritorio) la acción principal es el enlace a WhatsApp Web", async () => {
    montar();
    await act(async () => {});
    expect(screen.getByRole("link", { name: /Abrir en WhatsApp Web/ })).toBeTruthy();
  });
});
```

```bash
npx vitest run tests/unit/copiloto/centro-con-tarjeta.test.tsx 2>&1 | tail -10
```

Expected: FAIL (`CentroConversacion` no acepta `tarjeta` ni provee el contexto: el botón "Insertar en WhatsApp" no existe).

- [ ] **Step 7: Modificar `CentroConversacion`**

En `src/components/inbox/CentroConversacion.tsx`:

1. Imports nuevos: `useMemo` en el `import { useCallback, useEffect, useMemo, useRef, useState } from "react";` y

```tsx
import {
  ContextoCopiloto,
  type ContextoCopilotoValor,
  type ResultadoInsertar,
} from "@/components/inbox/copiloto/ContextoCopiloto";
import type { UbicacionTarjeta } from "@/lib/copiloto/acciones";
```

2. Firma: agregar `tarjeta = null` y su tipo:

```tsx
export function CentroConversacion({
  leadId,
  usuarioId,
  telefono,
  hilo,
  tarjeta = null,
}: {
  /* …props existentes… */
  /**
   * La tarjeta del copiloto para el modo WhatsApp Web: va entre la barra y la
   * vista nativa (que se achica). En "Hilo del CRM" la tarjeta ya viene adentro
   * de `hilo`, sobre el composer; es la misma tarjeta y solo hay una montada.
   */
  tarjeta?: React.ReactNode;
}) {
```

3. Después de `abrir`, agregar el puente con texto:

```tsx
/**
 * "Insertar en WhatsApp" de la tarjeta: abre el chat con el texto precargado.
 * Va acá porque este componente es el dueño del puente y de la vista. Si se
 * está en "Hilo del CRM" se marca el chat como ya abierto ANTES de cambiar a
 * "WhatsApp Web": sin eso el efecto de abajo lo recargaría vacío (`abrirChat(n,
 * "")`) y pisaría el texto recién precargado.
 */
const insertarEnWhatsApp = useCallback(
  async (texto: string): Promise<ResultadoInsertar> => {
    const puente = window.crmEscritorio;
    if (!puente || telefono === null) {
      return { ok: false, error: "La app de escritorio no está disponible." };
    }
    const yaEstabaEnWhatsApp = modo === "whatsapp";
    abierto.current = leadId;
    const r = await puente.abrirChat(telefono, texto).catch(() => null);
    if (r === null || r.ok === false) {
      if (!yaEstabaEnWhatsApp) abierto.current = null;
      const error = r === null ? "No se pudo abrir la conversación." : motivoLegible(r.motivo);
      setResultado({ leadId, error });
      return { ok: false, error };
    }
    setResultado({ leadId, error: null });
    if (!yaEstabaEnWhatsApp) cambiarModo("whatsapp");
    return { ok: true };
  },
  [leadId, telefono, modo, cambiarModo],
);

const ubicacion: UbicacionTarjeta | null =
  escritorio === null
    ? null
    : escritorio && telefono !== null
      ? enWhatsApp
        ? "escritorio-whatsapp"
        : "escritorio-hilo"
      : "navegador";
const valorContexto = useMemo<ContextoCopilotoValor>(
  () => ({ ubicacion, telefono, insertarEnWhatsApp }),
  [ubicacion, telefono, insertarEnWhatsApp],
);
```

4. El `return` se envuelve en el proveedor y aloja la tarjeta:

```tsx
return (
  <ContextoCopiloto.Provider value={valorContexto}>
    <div className="bg-surface-chat flex min-w-[520px] flex-1 flex-col overflow-hidden">
      {conVista ? <BarraVistaWhatsApp /* …props sin cambios… */ /> : null}
      {enWhatsApp ? (
        <>
          {tarjeta}
          <div className="min-h-0 flex-1">
            <AreaWhatsApp />
          </div>
        </>
      ) : (
        hilo
      )}
    </div>
  </ContextoCopiloto.Provider>
);
```

(La barra mantiene sus props exactas de hoy; solo cambia el envoltorio. Importante: la vista nativa se superpone al hueco de `AreaWhatsApp`, que ahora queda debajo de la tarjeta: el `ResizeObserver` existente reporta el rect nuevo solo.)

- [ ] **Step 8: Ver pasar, regresión del centro, lint, typecheck y commit**

```bash
npx vitest run tests/unit/copiloto/centro-con-tarjeta.test.tsx tests/unit/inbox-centro-conversacion.test.tsx tests/unit/copiloto/tarjeta-borrador.test.tsx 2>&1 | tail -10
npx eslint src/components/inbox/CentroConversacion.tsx src/components/inbox/copiloto src/lib/copiloto src/components/icons.ts
npm run typecheck
git add src/lib/copiloto/whatsapp-web.ts src/lib/copiloto/acciones.ts src/components/icons.ts src/components/inbox/copiloto/ContextoCopiloto.tsx src/components/inbox/copiloto/TarjetaBorrador.tsx src/components/inbox/CentroConversacion.tsx tests/unit/copiloto/whatsapp-web.test.ts tests/unit/copiloto/acciones.test.ts tests/unit/copiloto/tarjeta-borrador.test.tsx tests/unit/copiloto/centro-con-tarjeta.test.tsx
git commit -m "feat(copiloto): tarjeta del borrador en los tres contextos del Inbox" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: los 3 archivos de test en PASS (el de `inbox-centro-conversacion` es la regresión: no cambia), eslint limpio, typecheck exit 0.

Medidas que T13 debe verificar: la tarjeta ocupa el ancho completo de la columna central; su alto con 3 líneas de texto no deja a la vista de WhatsApp por debajo de una altura útil (anotar el número); el texto largo no desborda; a 1164 y 1600 px de ancho de ventana no hay scroll horizontal nuevo. **Pendiente explícito:** probar **a mano con la app de escritorio real** que Insertar precarga el texto en WhatsApp Web (no hay forma de automatizarlo).

---

## Task 11: Marca «Borrador listo» en la lista y «enviado por WhatsApp Web, sin confirmar» en el hilo

**Worker sugerido:** `worker-medium`.
**Depende de:** T5, T8.

**Files:**

- Modify: `src/types/inbox.ts`, `src/types/entities.ts` (campos tipados de `MensajeMetadata`), `src/server/services/inbox/default-inbox.service.ts`, `src/server/bootstrap/inbox-bootstrap.ts`, `src/components/inbox/InboxListItem.tsx`, `src/components/inbox/MessageBubble.tsx`, y los tests que construyan un `InboxItem` literal y rompan el typecheck
- Test: `tests/unit/inbox-service.test.ts` (casos nuevos), `tests/unit/copiloto/lista-borrador.test.tsx`, `tests/unit/copiloto/burbuja-sin-confirmar.test.tsx`

**Interfaces:**

- Consumes: `BorradoresIaRepository.listListosPorConversacionIds` (T5), `Conversacion` (T4).
- Produces (T13): `InboxItem.borradorListo: boolean`; `DefaultInboxServiceDeps.borradores?: Pick<BorradoresIaRepository, "listListosPorConversacionIds">`; `MensajeMetadata.origen?: "whatsapp_web_sin_confirmar"` y `borrador_id?: string`.

- [ ] **Step 1: Tests del servicio (fallan)**

En `tests/unit/inbox-service.test.ts`: importar `import { InMemoryBorradoresIaRepository } from "@/server/repositories/borradores-ia.repo";` y agregar, dentro de `describe("DefaultInboxService.listActiveLeads", ...)` (usa los helpers `makeLead`, `makeSession`, `msgInsert`, `makeReadOnlyDeps` del archivo):

```ts
test("borradorListo marca las conversaciones con un borrador listo sin usar", async () => {
  const leads = new InMemoryLeadsRepository();
  const sessions = new InMemoryLeadSessionRepository();
  const convs = new InMemoryConversationsRepository();
  const messages = new InMemoryMessagesRepository();
  const borradores = new InMemoryBorradoresIaRepository();
  const svc = new DefaultInboxService({
    ...makeReadOnlyDeps(leads, sessions, convs, messages),
    borradores,
  });

  const conBorrador = await makeLead(leads, { nombre: "Con borrador" });
  const sesionA = await makeSession(sessions, conBorrador.id);
  const convA = await convs.create({
    lead_id: conBorrador.id,
    canal: "wa",
    canal_thread_id: "wa-a",
  });
  const entrante = await messages.create(msgInsert(convA.id, sesionA.id));
  const r = await borradores.iniciar({
    conversacionId: convA.id,
    leadSessionId: sesionA.id,
    mensajeOrigenId: entrante.id,
  });
  if (r.resultado !== "creado") throw new Error("fixture");
  await borradores.completar(r.borradorId, { contenido: "Hola", origen: "ia", reglaId: null });

  const sinBorrador = await makeLead(leads, { nombre: "Sin borrador" });
  const sesionB = await makeSession(sessions, sinBorrador.id);
  const convB = await convs.create({
    lead_id: sinBorrador.id,
    canal: "wa",
    canal_thread_id: "wa-b",
  });
  await messages.create(msgInsert(convB.id, sesionB.id));

  const items = await svc.listActiveLeads();

  expect(items.find((i) => i.leadId === conBorrador.id)?.borradorListo).toBe(true);
  expect(items.find((i) => i.leadId === sinBorrador.id)?.borradorListo).toBe(false);
});

test("un borrador usado o todavía redactando no marca la fila", async () => {
  const leads = new InMemoryLeadsRepository();
  const sessions = new InMemoryLeadSessionRepository();
  const convs = new InMemoryConversationsRepository();
  const messages = new InMemoryMessagesRepository();
  const borradores = new InMemoryBorradoresIaRepository();
  const svc = new DefaultInboxService({
    ...makeReadOnlyDeps(leads, sessions, convs, messages),
    borradores,
  });
  const lead = await makeLead(leads);
  const sesion = await makeSession(sessions, lead.id);
  const conv = await convs.create({ lead_id: lead.id, canal: "wa", canal_thread_id: "wa-c" });
  const entrante = await messages.create(msgInsert(conv.id, sesion.id));
  const r = await borradores.iniciar({
    conversacionId: conv.id,
    leadSessionId: sesion.id,
    mensajeOrigenId: entrante.id,
  });
  if (r.resultado !== "creado") throw new Error("fixture");

  expect((await svc.listActiveLeads())[0]?.borradorListo).toBe(false); // redactando

  await borradores.completar(r.borradorId, { contenido: "Hola", origen: "ia", reglaId: null });
  await borradores.marcarUsado(r.borradorId, { via: "copiar", usuarioId: null });
  expect((await svc.listActiveLeads())[0]?.borradorListo).toBe(false); // usado
});

test("sin el repositorio de borradores inyectado, borradorListo es false (comportamiento de antes)", async () => {
  const leads = new InMemoryLeadsRepository();
  const sessions = new InMemoryLeadSessionRepository();
  const convs = new InMemoryConversationsRepository();
  const messages = new InMemoryMessagesRepository();
  const svc = new DefaultInboxService(makeReadOnlyDeps(leads, sessions, convs, messages));
  const lead = await makeLead(leads);
  const sesion = await makeSession(sessions, lead.id);
  const conv = await convs.create({ lead_id: lead.id, canal: "wa", canal_thread_id: "wa-d" });
  await messages.create(msgInsert(conv.id, sesion.id));

  expect((await svc.listActiveLeads())[0]?.borradorListo).toBe(false);
});
```

```bash
npx vitest run tests/unit/inbox-service.test.ts 2>&1 | tail -10
```

Expected: FAIL en los 3 (`borradorListo` es `undefined`).

- [ ] **Step 2: Tipos y servicio**

`src/types/inbox.ts`, dentro de `InboxItem`, después de `recordatorio`:

```ts
/**
 * Hay un borrador del copiloto `listo` y sin usar en alguna conversación del
 * lead: la persona todavía tiene que enviarlo. Marca la fila con "Borrador listo".
 */
borradorListo: boolean;
```

`src/types/entities.ts`, en `MensajeMetadata`, después de `respuesta_interactiva`:

```ts
  /**
   * Saliente que la persona mandó desde WhatsApp Web con un borrador del
   * copiloto. El CRM lo anota al tocar Insertar / Copiar / Abrir, no cuando el
   * mensaje realmente sale: por eso el hilo dice "sin confirmar". Punto de
   * enganche para reemplazarlo por el eco real cuando exista la coexistencia.
   */
  origen?: "whatsapp_web_sin_confirmar";
  borrador_id?: string;
```

`src/server/services/inbox/default-inbox.service.ts`:

- import `import type { BorradoresIaRepository } from "@/server/repositories/borradores-ia.repo";`
- en `DefaultInboxServiceDeps`, junto a `turnosInterceptados?`:

```ts
  /**
   * Para marcar "Borrador listo" en la bandeja. Opcional: sin él la marca no
   * aparece, como antes del copiloto.
   */
  borradores?: Pick<BorradoresIaRepository, "listListosPorConversacionIds">;
```

- en `listActiveLeads`, justo después del `Promise.all` que trae `leadsFilas, convsFilas, mensajes, vivos`:

```ts
// Una consulta más (las conversaciones salen de la ola anterior): solo las
// de estas filas con un borrador `listo`. El índice parcial
// `borradores_ia_vigente_uq` la sirve.
const conBorrador = new Set<UUID>(
  this.deps.borradores
    ? await this.deps.borradores.listListosPorConversacionIds(convsFilas.map((c) => c.id))
    : [],
);
```

- en el `items.push({...})`, después de `recordatorio: recordatorioDe(...)`: `borradorListo: convs.some((c) => conBorrador.has(c.id)),`.

`src/server/bootstrap/inbox-bootstrap.ts`: import `SupabaseBorradoresIaRepository` y agregar en el `new DefaultInboxService({...})`: `borradores: new SupabaseBorradoresIaRepository(db),` (solo lectura desde el panel).

```bash
npx vitest run tests/unit/inbox-service.test.ts tests/unit/inbox-consultas.test.ts 2>&1 | tail -10
npm run typecheck 2>&1 | tail -20
```

Expected: PASS; el typecheck puede fallar donde se arme un `InboxItem` completo a mano (`tests/unit/inbox-seguimiento.test.ts`, `sin-responder.test.ts` u otros): agregar `borradorListo: false` a esos literales hasta exit 0.

- [ ] **Step 3: Tests de componentes (fallan)**

Crear `tests/unit/copiloto/lista-borrador.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { InboxListItem } from "@/components/inbox/InboxListItem";
import type { InboxItem } from "@/types/inbox";

vi.mock("next/navigation", () => ({ usePathname: () => "/inbox" }));

afterEach(cleanup);

function item(parcial: Partial<InboxItem> = {}): InboxItem {
  return {
    leadId: "lead-1",
    sessionId: "s-1",
    nombre: "Ana Prueba",
    currentStage: "nuevo",
    iaPausada: false,
    ultimaActividad: new Date("2026-09-30T15:00:00Z"),
    ultimoMensaje: {
      body: "Busco filtro",
      direction: "in",
      createdAt: new Date("2026-09-30T15:00:00Z"),
    },
    canales: ["wa"],
    canalActivo: "wa",
    sinResponder: 1,
    esperandoDesde: null,
    urgencia: "media",
    motivo: null,
    recordatorio: null,
    borradorListo: false,
    ...parcial,
  };
}

describe.each(["completa", "compacta"] as const)(
  "InboxListItem (%s) y el borrador del copiloto",
  (variante) => {
    it("con un borrador listo muestra la marca «Borrador listo»", () => {
      render(<InboxListItem item={item({ borradorListo: true })} variante={variante} />);
      expect(screen.getByLabelText("Borrador listo")).toBeTruthy();
    });

    it("sin borrador no hay marca", () => {
      render(<InboxListItem item={item()} variante={variante} />);
      expect(screen.queryByLabelText("Borrador listo")).toBeNull();
    });
  },
);

describe("InboxListItem completa", () => {
  it("la marca se lee como texto, no solo como ícono", () => {
    render(<InboxListItem item={item({ borradorListo: true })} variante="completa" />);
    expect(screen.getByText("Borrador listo")).toBeTruthy();
  });
});
```

Crear `tests/unit/copiloto/burbuja-sin-confirmar.test.tsx`:

```tsx
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MessageBubble } from "@/components/inbox/MessageBubble";
import type { Mensaje } from "@/types/entities";

afterEach(cleanup);

function saliente(parcial: Partial<Mensaje> = {}): Mensaje {
  return {
    id: "m1",
    conversacion_id: "c1",
    lead_session_id: "s1",
    direction: "out",
    sender: "humano",
    sender_user_id: "u1",
    tipo: "text",
    contenido: "Hola, sí tenemos ese filtro.",
    media_url: null,
    meta_message_id: null,
    idempotency_key: "copiloto:b-1",
    metadata: { origen: "whatsapp_web_sin_confirmar", borrador_id: "b-1" },
    created_at: new Date("2026-09-30T15:00:00Z"),
    estado_entrega: null,
    estado_entrega_at: null,
    error_entrega: null,
    ...parcial,
  };
}

describe("MessageBubble — enviado por WhatsApp Web, sin confirmar", () => {
  it("dice que se envió por WhatsApp Web sin confirmar y no pinta el reloj de 'sin acuse'", () => {
    render(<MessageBubble message={saliente()} />);
    expect(screen.getByText("Enviado por WhatsApp Web, sin confirmar")).toBeTruthy();
    expect(screen.queryByLabelText("Sin acuse todavia")).toBeNull();
    expect(screen.getByText("Hola, sí tenemos ese filtro.")).toBeTruthy();
  });

  it("un saliente humano normal sigue mostrando su acuse", () => {
    render(
      <MessageBubble
        message={saliente({
          metadata: {},
          idempotency_key: null,
          meta_message_id: "wamid.1",
          estado_entrega: "entregado",
        })}
      />,
    );
    expect(screen.queryByText(/sin confirmar/)).toBeNull();
    expect(screen.getByLabelText("Entregado")).toBeTruthy();
  });
});
```

```bash
npx vitest run tests/unit/copiloto/lista-borrador.test.tsx tests/unit/copiloto/burbuja-sin-confirmar.test.tsx 2>&1 | tail -10
```

Expected: FAIL (no existe la marca ni la etiqueta).

- [ ] **Step 4: Implementar las dos marcas**

`src/components/inbox/InboxListItem.tsx`:

- Fila completa (`FilaCompleta`), en el `div` de "StageBadge + IA pausada + rayo" (`mt-1.5 flex items-center gap-1.5`), después del bloque de `item.iaPausada`:

```tsx
{
  item.borradorListo ? (
    <span
      aria-label="Borrador listo"
      className="text-brand bg-brand/12 inline-flex shrink-0 items-center gap-1 rounded-md px-[7px] py-[2.5px] text-[10px] font-semibold"
    >
      <AutoAwesome size={12} className="shrink-0" aria-hidden />
      Borrador listo
    </span>
  ) : null;
}
```

- Fila compacta (`FilaCompacta`), después de `<StageBadge …/>`: solo el ícono (la fila tiene 322 px y se midió al milímetro, ver el comentario del `max-w-[68px]`):

```tsx
{
  item.borradorListo ? (
    <AutoAwesome size={12} className="text-brand shrink-0" aria-label="Borrador listo" />
  ) : null;
}
```

Importar `AutoAwesome` en el `import { Bolt, PanTool, ReceiptLong, Schedule, Warning } from "@/components/icons";`.

`src/components/inbox/MessageBubble.tsx`: en el pie de la burbuja (`<div className="mt-1 flex items-center justify-end gap-1">`), reemplazar `<AcuseEntrega … />` por

```tsx
{
  message.metadata.origen === "whatsapp_web_sin_confirmar" ? (
    <MonoMeta className="text-[9.5px] italic">Enviado por WhatsApp Web, sin confirmar</MonoMeta>
  ) : (
    <AcuseEntrega mensaje={message} claro={message.sender === "humano"} />
  );
}
```

(No tiene estados de entrega: el reloj de "sin acuse" sería mentira; el texto dice lo que se sabe.) Si el color del `MonoMeta` sobre la burbuja clara del vendedor no contrasta, usar `text-background/60`, como el acuse `claro`: verificar contraste en T13.

```bash
npx vitest run tests/unit/copiloto/lista-borrador.test.tsx tests/unit/copiloto/burbuja-sin-confirmar.test.tsx tests/unit/inbox-burbuja-rica.test.tsx 2>&1 | tail -10
```

Expected: PASS.

- [ ] **Step 5: Lint, typecheck y commit**

```bash
npx eslint src/components/inbox/InboxListItem.tsx src/components/inbox/MessageBubble.tsx src/server/services/inbox/default-inbox.service.ts src/server/bootstrap/inbox-bootstrap.ts
npm run typecheck
git add src/types/inbox.ts src/types/entities.ts src/server/services/inbox/default-inbox.service.ts src/server/bootstrap/inbox-bootstrap.ts src/components/inbox/InboxListItem.tsx src/components/inbox/MessageBubble.tsx tests/unit/inbox-service.test.ts tests/unit/copiloto/lista-borrador.test.tsx tests/unit/copiloto/burbuja-sin-confirmar.test.tsx
git commit -m "feat(copiloto): marca de borrador listo y saliente sin confirmar" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(Agregar por ruta explícita cualquier test que se haya tocado por el `borradorListo: false`.) Medidas que T13 debe verificar: la fila compacta (322 px) **no desborda** con el ícono y la fila completa no rompe línea con la marca; el texto de la burbuja «Enviado por WhatsApp Web, sin confirmar» cabe en `max-w-[62%]` sin tapar la hora.

---

## Task 12: Editor del horario del equipo en `/agente` (pestaña Límites)

**Worker sugerido:** `worker-medium`.
**Depende de:** T2 (campo y schema).

**Files:**

- Modify: `src/app/(panel)/agente/_components/EditorHorario.tsx`, `src/app/(panel)/agente/_components/TabLimites.tsx`, `src/app/(panel)/agente/_components/HistorialVersiones.tsx`
- Test: `tests/unit/agente/editor-horario.test.tsx`, `tests/unit/agente/tab-limites-equipo.test.tsx`

**Interfaces:**

- Consumes: `AgenteConfigValores.horario_equipo` (T2).
- Produces: `EditorHorario` gana la prop opcional `mostrarZona?: boolean` (default `true`); `TabLimites` renderiza la tarjeta «Horario del equipo» que emite `onChange({ horario_equipo })`.

- [ ] **Step 1: Tests (fallan)**

Crear `tests/unit/agente/editor-horario.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { EditorHorario } from "@/app/(panel)/agente/_components/EditorHorario";
import { CONFIG_DE_FABRICA } from "@/lib/agente/defaults";

afterEach(cleanup);

describe("EditorHorario", () => {
  it("por defecto muestra y edita la zona horaria", () => {
    render(
      <EditorHorario
        horario={CONFIG_DE_FABRICA.horario}
        timezone="America/Guayaquil"
        onChange={vi.fn()}
      />,
    );
    const zona = screen.getByPlaceholderText("America/Argentina/Buenos_Aires") as HTMLInputElement;
    expect(zona.value).toBe("America/Guayaquil");
  });

  it("con mostrarZona={false} no hay campo de zona (la zona es una sola para los dos horarios)", () => {
    render(
      <EditorHorario
        horario={CONFIG_DE_FABRICA.horario_equipo}
        timezone="America/Guayaquil"
        mostrarZona={false}
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByPlaceholderText("America/Argentina/Buenos_Aires")).toBeNull();
    expect(screen.getAllByText("Cerrado")).toHaveLength(7);
  });
});
```

Crear `tests/unit/agente/tab-limites-equipo.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { TabLimites } from "@/app/(panel)/agente/_components/TabLimites";
import { CONFIG_DE_FABRICA } from "@/lib/agente/defaults";

afterEach(cleanup);

function seccion(titulo: string): HTMLElement {
  const h = screen.getByRole("heading", { name: titulo });
  return h.closest("section") as HTMLElement;
}

describe("TabLimites — horario del equipo", () => {
  it("hay dos tarjetas de horario, con los subtítulos de §5", () => {
    render(<TabLimites valores={CONFIG_DE_FABRICA} onChange={vi.fn()} />);

    const equipo = seccion("Horario del equipo");
    expect(
      within(equipo).getByText(
        "Cuándo hay personas para enviar desde WhatsApp Web. En este horario la IA redacta y vos enviás.",
      ),
    ).toBeTruthy();
    expect(within(equipo).getByText(/Vacío = sin equipo: la IA responde sola/)).toBeTruthy();
    expect(seccion("Horario del agente")).toBeTruthy();
  });

  it("la zona horaria se edita una sola vez, en la tarjeta del agente; la del equipo la nombra", () => {
    render(<TabLimites valores={CONFIG_DE_FABRICA} onChange={vi.fn()} />);

    expect(
      within(seccion("Horario del agente")).getByPlaceholderText("America/Argentina/Buenos_Aires"),
    ).toBeTruthy();
    const equipo = seccion("Horario del equipo");
    expect(within(equipo).queryByPlaceholderText("America/Argentina/Buenos_Aires")).toBeNull();
    expect(equipo.textContent).toContain(CONFIG_DE_FABRICA.horario_timezone);
  });

  it("agregar un rango en el equipo emite horario_equipo y NO toca el horario del agente", () => {
    const onChange = vi.fn();
    render(<TabLimites valores={CONFIG_DE_FABRICA} onChange={onChange} />);
    const equipo = seccion("Horario del equipo");

    const [desde, hasta] = Array.from(
      equipo.querySelectorAll<HTMLInputElement>('input[type="time"]'),
    );
    fireEvent.change(desde!, { target: { value: "09:00" } });
    fireEvent.change(hasta!, { target: { value: "18:00" } });
    fireEvent.click(within(equipo).getAllByRole("button", { name: "Agregar" })[0]!);

    expect(onChange).toHaveBeenCalledTimes(1);
    const patch = onChange.mock.calls[0]![0] as Record<string, unknown>;
    expect(Object.keys(patch)).toEqual(["horario_equipo"]);
    expect((patch.horario_equipo as { lun: unknown }).lun).toEqual([
      { desde: "09:00", hasta: "18:00" },
    ]);
  });

  it("recomienda dejar el agente 24/7 y explica qué pasa si se cierra de noche", () => {
    render(<TabLimites valores={CONFIG_DE_FABRICA} onChange={vi.fn()} />);
    const texto = seccion("Horario del equipo").textContent ?? "";
    expect(texto).toContain("24/7");
    expect(texto).toContain("plantilla");
  });

  it("la tarjeta del agente aclara que es cuándo la IA puede actuar", () => {
    render(<TabLimites valores={CONFIG_DE_FABRICA} onChange={vi.fn()} />);
    expect(seccion("Horario del agente").textContent).toContain("Cuándo la IA puede actuar");
  });
});
```

```bash
npx vitest run tests/unit/agente/editor-horario.test.tsx tests/unit/agente/tab-limites-equipo.test.tsx 2>&1 | tail -10
```

Expected: FAIL (`mostrarZona` ignorado, no existe la tarjeta del equipo).

- [ ] **Step 2: `EditorHorario` con zona opcional**

En `src/app/(panel)/agente/_components/EditorHorario.tsx`:

- firma: agregar `mostrarZona = true` y el tipo `mostrarZona?: boolean;` (documentar: «la zona es una sola para los dos horarios; quien edita el segundo horario la oculta»);
- envolver el bloque del input de timezone:

```tsx
{
  mostrarZona ? (
    <div>
      <Eyebrow>Timezone</Eyebrow>
      {/* …input y mensaje de error exactamente como están… */}
    </div>
  ) : null;
}
```

- `const tzValida = esTimezoneValida(timezone);` queda (solo se usa dentro del bloque).

- [ ] **Step 3: La tarjeta del equipo en `TabLimites`**

En `src/app/(panel)/agente/_components/TabLimites.tsx`, reemplazar la tarjeta «Horario del agente» por estas dos (la segunda es nueva y va **inmediatamente después**, antes de «Plantilla fuera de horario»):

```tsx
        <TarjetaConsola
          titulo="Horario del agente"
          subtitulo="Cuándo la IA puede actuar por su cuenta. Fuera de este horario responde con plantilla y no genera con LLM, salvo que el equipo esté de turno y la IA solo redacte."
        >
          <EditorHorario
            horario={valores.horario}
            timezone={valores.horario_timezone}
            onChange={onChange}
            disabled={disabled}
          />
        </TarjetaConsola>

        <TarjetaConsola
          titulo="Horario del equipo"
          subtitulo="Cuándo hay personas para enviar desde WhatsApp Web. En este horario la IA redacta y vos enviás."
        >
          <p className="text-ink-dim mb-3 text-[11px]">
            Vacío = sin equipo: la IA responde sola por la API, según el horario del agente.
          </p>
          <EditorHorario
            horario={valores.horario_equipo}
            timezone={valores.horario_timezone}
            mostrarZona={false}
            onChange={(patch) => {
              if (patch.horario) onChange({ horario_equipo: patch.horario });
            }}
            disabled={disabled}
          />
          <p className="text-ink-faint mt-3 text-[10.5px]">
            Usa la misma zona horaria que el horario del agente:{" "}
            <span className="font-mono">{valores.horario_timezone}</span>.
          </p>
          <p className="text-caution mt-2 text-[10.5px]">
            Recomendado: dejar el horario del agente abierto 24/7, así de noche, con el equipo
            cerrado, la IA contesta por la API. Si el agente se cierra de noche, esas
            conversaciones reciben la plantilla en lugar de una respuesta.
          </p>
        </TarjetaConsola>
```

- [ ] **Step 4: Aviso en el rollback**

En `HistorialVersiones.tsx`, el párrafo «Restaurar crea una versión nueva…» pasa a:

```tsx
        Restaurar crea una versión nueva con esos valores — nunca revive la fila vieja. Una versión
        anterior al horario del equipo lo trae vacío: al restaurarla el copiloto queda apagado hasta
        que lo vuelvas a configurar.
```

- [ ] **Step 5: Ver pasar, lint, typecheck y commit**

```bash
npx vitest run tests/unit/agente/editor-horario.test.tsx tests/unit/agente/tab-limites-equipo.test.tsx 2>&1 | tail -10
npx eslint "src/app/(panel)/agente/_components/EditorHorario.tsx" "src/app/(panel)/agente/_components/TabLimites.tsx" "src/app/(panel)/agente/_components/HistorialVersiones.tsx"
npm run typecheck
git add "src/app/(panel)/agente/_components/EditorHorario.tsx" "src/app/(panel)/agente/_components/TabLimites.tsx" "src/app/(panel)/agente/_components/HistorialVersiones.tsx" tests/unit/agente/editor-horario.test.tsx tests/unit/agente/tab-limites-equipo.test.tsx
git commit -m "feat(agente): editor del horario del equipo en la pestaña Límites" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: `Tests  7 passed`, eslint limpio, typecheck exit 0. Medida que T13 debe verificar: las dos tarjetas de horario caben en la columna izquierda de 1.35fr sin desbordar y «Guardar» persiste `horario_equipo` (se ve en `agente_config` de la base local).

---

## Task 13: Integrar en la página del lead y verificar medido en el navegador

**Worker sugerido:** `worker-high` (integra T9–T11 en un RSC compartido y mide; un defecto de layout solo aparece midiendo).
**Depende de:** T9, T10, T11 (T12 es independiente y se verifica en T14).
**Skills a cargar antes:** las de diseño + `chrome-devtools-mcp:chrome-devtools` o el Browser pane (`mcp__Claude_Browser__*`) para medir; `superpowers:verification-before-completion`.

**Files:**

- Modify: `src/app/(panel)/inbox/[leadId]/page.tsx`

**Interfaces:**

- Consumes: `getCopilotoServiceForRequest` y las tres actions (T8), `InterruptorModo` (T9), `TarjetaBorrador` y `CentroConversacion.tarjeta` (T10), `ConversationView.conversacionId` (T8).

- [ ] **Step 1: Cablear la página**

En `src/app/(panel)/inbox/[leadId]/page.tsx`:

Imports nuevos:

```tsx
import { InterruptorModo } from "@/components/inbox/copiloto/InterruptorModo";
import { TarjetaBorrador } from "@/components/inbox/copiloto/TarjetaBorrador";
import { getCopilotoServiceForRequest } from "@/server/bootstrap/copiloto-bootstrap";
import { cambiarModoRespuestaAction } from "../_actions/cambiar-modo-respuesta.action";
import { regenerarBorradorAction } from "../_actions/regenerar-borrador.action";
import { usarBorradorAction } from "../_actions/usar-borrador.action";
```

Después de calcular `ultimoEntrante` y `ventana`:

```tsx
// El copiloto es de WhatsApp: solo ahí hay interruptor y tarjeta. Sin sesión
// activa no hay hilo ni conversación a la que atender.
const estadoCopiloto =
  view.session && view.conversacionId && view.canalActivo === "wa"
    ? await (
        await getCopilotoServiceForRequest()
      ).estado({
        conversacionId: view.conversacionId,
        ultimoEntranteId: ultimoEntrante?.id ?? null,
      })
    : null;

// La misma tarjeta se monta en dos lugares según el modo del centro (entre la
// barra y la vista de WhatsApp, o sobre el composer) y solo hay una a la vez.
const tarjeta =
  view.session && estadoCopiloto?.borrador ? (
    <TarjetaBorrador
      leadId={view.lead.id}
      sessionId={view.session.id}
      canal={view.canalActivo}
      borrador={estadoCopiloto.borrador}
      onUsar={usarBorradorAction}
      onRegenerar={regenerarBorradorAction}
      onEnviar={sendMessageAction}
    />
  ) : null;
```

`<CentroConversacion … tarjeta={tarjeta} hilo={…}>`: en el encabezado, el slot `actions` pasa a

```tsx
              actions={
                view.session ? (
                  <div className="flex min-w-0 items-center gap-2">
                    {estadoCopiloto ? (
                      <InterruptorModo
                        leadId={view.lead.id}
                        conversacionId={estadoCopiloto.conversacionId}
                        override={estadoCopiloto.override}
                        modoEfectivo={estadoCopiloto.modoEfectivo}
                        onCambiar={cambiarModoRespuestaAction}
                      />
                    ) : null}
                    <HandoffToggle
                      leadId={view.lead.id}
                      sessionId={view.session.id}
                      iaPausada={view.session.ia_pausada}
                      onToggle={toggleHandoffAction}
                      handoffStatus={view.handoffStatus}
                    />
                  </div>
                ) : null
              }
```

y en el hilo, justo encima de `<MessageInput …/>`: `{tarjeta}`.

```bash
npm run typecheck
npx eslint "src/app/(panel)/inbox/[leadId]/page.tsx"
```

Expected: exit 0 y sin errores.

- [ ] **Step 2: Levantar el stack local con un borrador real**

Seguir `docs/runbooks/como-correr-el-crm.md` §4.1 (cada proceso en su terminal):

```bash
npm run stack:up && npm run stack:seed
npm run mock:meta        # terminal 1
npm run dev:local        # terminal 2  (http://localhost:3002)
npm run inngest:local    # terminal 3  (reiniciarlo si ya estaba: hay una función nueva)
```

Activar el equipo 24/7 **solo en el stack local** (es desechable; el orquestador configurará crm-dev por la UI):

```bash
docker exec -i supabase_db_crm psql -U postgres -d postgres -c "update public.agente_config set horario_equipo = '{\"lun\":[{\"desde\":\"00:00\",\"hasta\":\"23:59\"}],\"mar\":[{\"desde\":\"00:00\",\"hasta\":\"23:59\"}],\"mie\":[{\"desde\":\"00:00\",\"hasta\":\"23:59\"}],\"jue\":[{\"desde\":\"00:00\",\"hasta\":\"23:59\"}],\"vie\":[{\"desde\":\"00:00\",\"hasta\":\"23:59\"}],\"sab\":[{\"desde\":\"00:00\",\"hasta\":\"23:59\"}],\"dom\":[{\"desde\":\"00:00\",\"hasta\":\"23:59\"}]}'::jsonb where activa;"
curl -s -X POST http://127.0.0.1:55390/__mock/entrante -H 'content-type: application/json' -d '{"from":"12025550110","texto":"Busco filtro de aceite","nombre":"Pedro Prueba"}'
```

Esperar unos segundos y confirmar que hay un borrador (sin leer su texto):

```bash
docker exec -i supabase_db_crm psql -U postgres -d postgres -qtA -c "select estado, origen, length(contenido) from public.borradores_ia order by created_at desc limit 1;"
```

Expected: `listo|ia|<n>` con `n > 0`.

- [ ] **Step 3: Medir en el navegador (criterios de aceptación)**

Abrir `http://localhost:3002`, iniciar sesión con `admin-local@crm.local` (contraseña: `SEED_ADMIN_PASSWORD` de `.env.stack-local`), abrir el lead «Pedro Prueba» en `/inbox/<id>`. Si el panel del navegador no compone frames (`document.hidden`, lección 6), medir pidiendo el HTML por `fetch` e inyectando la raíz en el slot. Con `javascript_tool` (o `mcp__Claude_Browser__javascript_tool`):

```js
(() => {
  const r = (el) => (el ? el.getBoundingClientRect().toJSON() : null);
  const tarjeta = document.querySelector('section[aria-label="Borrador de la IA"]');
  const centro = tarjeta?.parentElement;
  const header = document.querySelector("header");
  return {
    viewport: { w: innerWidth, h: innerHeight },
    tarjeta: r(tarjeta),
    centro: r(centro),
    header: r(header),
    interruptor: r(document.querySelector('[aria-label="Modo de respuesta"]')),
    desbordeHorizontalPagina:
      document.documentElement.scrollWidth > document.documentElement.clientWidth,
    desbordeTarjeta: tarjeta ? tarjeta.scrollWidth > tarjeta.clientWidth : null,
    desbordeHeader: header ? header.scrollWidth > header.clientWidth : null,
  };
})();
```

Criterios (anotar los números reales medidos en el reporte, no "se ve bien"):

1. **Navegador (sin puente):** la tarjeta está sobre el composer, ocupa el ancho de la columna central (`tarjeta.width === centro.width`), su acción principal es el enlace «Abrir en WhatsApp Web» con `href` que empieza en `https://web.whatsapp.com/send?phone=12025550110&text=`; `desbordeTarjeta=false`, `desbordeHeader=false`, `desbordePagina=false` a **1164 px** (mínimo del shell) y a **1600 px** (`resize_window`).
2. **Encabezado:** el interruptor muestra «Según horario · ahora Copiloto» y cabe junto a «IA activa» a 1164 px sin cortar el chip (`header.scrollWidth <= header.clientWidth`); cambiarlo a «Automático» y volver funciona y el valor persiste al recargar (`select modo_respuesta_override from conversaciones`).
3. **Lista:** la fila del lead muestra la marca «Borrador listo» (completa) o el ícono (compacta) **sin desbordar** los 322 px (medir `scrollWidth <= clientWidth` de la fila).
4. **Usar:** «Copiar» deja el borrador «Ya usado · copiado», aparece el saliente «Enviado por WhatsApp Web, sin confirmar» en el hilo (sin reloj de acuse) y la tarjeta queda atenuada; un segundo refresco no duplica el mensaje (`select count(*) from mensajes where idempotency_key like 'copiloto:%'` = 1).
5. **Regenerar:** «Regenerar» pasa a «Redactando…» enseguida y, tras unos segundos (Inngest local), muestra un borrador nuevo con otro id.
6. **Puente de escritorio (con un stub, no con la app real):** en la consola del navegador definir

```js
window.crmEscritorio = {
  abrirChat: async (t, x) => {
    window.__ultimoAbrirChat = [t, x];
    return { ok: true, ms: 1, mostrada: true };
  },
  reportarAreaWhatsApp() {},
  mostrarWhatsApp: async () => ({ ok: true }),
  obtenerVistaWhatsApp: async () => ({ recorteIzquierdo: 0, completo: false }),
  configurarVistaWhatsApp: async (c) => ({ ok: true, recorteIzquierdo: 0, completo: false, ...c }),
};
```

y navegar (navegación blanda: clic en otra conversación de la lista y volver) para que los componentes monten con el puente presente. Verificar: la barra del selector aparece, la tarjeta queda **entre la barra y el hueco de WhatsApp**, «Insertar en WhatsApp» deja `window.__ultimoAbrirChat` = `["12025550110", "<texto del borrador>"]`, y medir el alto útil que le queda al hueco (`[data-...]` del `AreaWhatsApp`: `getBoundingClientRect().height`) con la ventana a 800 px de alto; anotarlo. Cambiar el selector a «Hilo del CRM»: la tarjeta queda sobre el composer y aparece «Al composer». 7. **Consola limpia:** `read_console_messages` sin errores de hidratación (la hora de la tarjeta lleva `suppressHydrationWarning`).

Si una medida falla, corregir en el componente (T9–T11), volver a correr sus tests y repetir la medida; no relajar el criterio.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(panel)/inbox/[leadId]/page.tsx"
git commit -m "feat(copiloto): interruptor y tarjeta en la página del lead" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Reportar las medidas reales y lo que no se pudo verificar (la app de escritorio real).

---

## Task 14: E2E en el stack local, integración, gates y docs

**Worker sugerido:** `worker-high` (probar de punta a punta es la única verificación que vale, lección 14; un resultado "verde" mal leído cierra la feature en falso).
**Depende de:** T1–T13 (T12 incluida).
**Skills a cargar antes:** `superpowers:verification-before-completion`, `security-review`, `ecc:update-docs`.

**Files:**

- Modify: `docs/workflows.md`, `docs/data-model.md`, `docs/runbooks/como-correr-el-crm.md`

**Interfaces:** ninguna nueva. Esta tarea **no escribe código de producción**: si una verificación falla, se arregla en la tarea dueña del defecto (volviendo a correr sus tests) y se repite acá.

- [ ] **Step 1: Levantar el stack local limpio**

```bash
npm run stack:up
npm run stack:reset
```

(`stack:reset` = base vacía + las 89 migraciones + seed; **nunca** `db reset` a secas ni `db:push`.) En tres terminales: `npm run mock:meta`, `npm run dev:local`, `npm run inngest:local` (reiniciar este último: hay una función Inngest nueva, `copiloto-borrador`). Verificar:

```bash
node scripts/stack-local-db.mjs verificar
```

Expected: `repo: 89 · ledger local: 89`.

- [ ] **Step 2: Caso A — Copiloto: se crea el borrador y NO sale ningún envío**

```bash
docker exec -i supabase_db_crm psql -U postgres -d postgres -c "update public.agente_config set horario_equipo = '{\"lun\":[{\"desde\":\"00:00\",\"hasta\":\"23:59\"}],\"mar\":[{\"desde\":\"00:00\",\"hasta\":\"23:59\"}],\"mie\":[{\"desde\":\"00:00\",\"hasta\":\"23:59\"}],\"jue\":[{\"desde\":\"00:00\",\"hasta\":\"23:59\"}],\"vie\":[{\"desde\":\"00:00\",\"hasta\":\"23:59\"}],\"sab\":[{\"desde\":\"00:00\",\"hasta\":\"23:59\"}],\"dom\":[{\"desde\":\"00:00\",\"hasta\":\"23:59\"}]}'::jsonb where activa;"
curl -s -X POST http://127.0.0.1:55390/__mock/reset
curl -s -X POST http://127.0.0.1:55390/__mock/entrante -H 'content-type: application/json' -d '{"from":"12025550120","texto":"Busco filtro de aceite","nombre":"Copiloto Prueba"}'
```

Esperar ~10 s (Inngest local) y mirar la base **sin leer el texto** del borrador:

```bash
docker exec -i supabase_db_crm psql -U postgres -d postgres -qtA -c "select estado, origen, length(contenido) > 0 as con_texto from public.borradores_ia order by created_at desc limit 3;"
docker exec -i supabase_db_crm psql -U postgres -d postgres -qtA -c "select count(*) from public.mensajes where direction = 'out';"
```

Expected: una fila `listo|ia|t` y un conteo de salientes `0`. Y el log del mock:

```bash
curl -s http://127.0.0.1:55390/__mock/log | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const l=JSON.parse(s);const a=Array.isArray(l)?l:(l.log??l.entradas??[]);console.log('envios a Meta:',a.filter(e=>String(e.tipo).startsWith('graph.envio')).length)})"
```

Expected: `envios a Meta: 0`. (Si el JSON del mock tiene otra forma que `Array`/`{log}`/`{entradas}`, ajustar el acceso leyendo la respuesta real: lo que se cuenta son las entradas cuyo `tipo` empieza con `graph.envio`; el mock las registra como `graph.envio.text`, `graph.envio.interactive`, etc.)

- [ ] **Step 3: Caso B — control: sin equipo el mismo mensaje SÍ sale por la API (prueba que el conteo de arriba mide algo)**

```bash
docker exec -i supabase_db_crm psql -U postgres -d postgres -c "update public.agente_config set horario_equipo = '{\"lun\":[],\"mar\":[],\"mie\":[],\"jue\":[],\"vie\":[],\"sab\":[],\"dom\":[]}'::jsonb where activa;"
curl -s -X POST http://127.0.0.1:55390/__mock/reset
curl -s -X POST http://127.0.0.1:55390/__mock/entrante -H 'content-type: application/json' -d '{"from":"12025550121","texto":"Busco pastillas de freno","nombre":"Automatico Prueba"}'
```

Esperar ~10 s y repetir el conteo de envíos del Step 2.

Expected: `envios a Meta: 1` (una entrada `graph.envio.text`) y **ningún** borrador nuevo para ese teléfono:

```bash
docker exec -i supabase_db_crm psql -U postgres -d postgres -qtA -c "select count(*) from public.borradores_ia b join public.conversaciones c on c.id = b.conversacion_id where c.canal_thread_id = '12025550121';"
```

Expected: `0`.

- [ ] **Step 4: Caso C — Regenerar / Reintentar disparan la función y el mock sigue sin envíos**

Con el equipo abierto otra vez (repetir el `update` del Step 2) y un mensaje nuevo del teléfono `12025550120`, tomar el borrador vigente y pedir la regeneración con el mismo evento que emite la Server Action:

```bash
docker exec -i supabase_db_crm psql -U postgres -d postgres -qtA -c "select id, conversacion_id from public.borradores_ia where estado = 'listo' order by created_at desc limit 1;"
curl -s -X POST http://127.0.0.1:8298/e/dev_key -H 'content-type: application/json' -d '{"name":"copiloto/borrador.solicitado","data":{"borradorId":"<id del paso anterior>","conversacionId":"<conversacion_id>","solicitadoPor":null}}'
```

Esperar ~10 s y:

```bash
docker exec -i supabase_db_crm psql -U postgres -d postgres -qtA -c "select estado, count(*) from public.borradores_ia where conversacion_id = '<conversacion_id>' group by estado order by estado;"
```

Expected: `descartado|1` y `listo|1` (el viejo descartado, uno nuevo listo) y, en el log del mock, **0** envíos nuevos. Una segunda emisión con el **mismo** `borradorId` no crea otro (el viejo ya no es `listo`: la función sale como `omitido`/`borrador_no_vigente`; verlo en el run de `http://127.0.0.1:8298`).

- [ ] **Step 5: Casos de UI y puente (ya medidos en T13)**

Confirmar que la Task 13 dejó registradas las medidas y que el Step 6 de la corrida de abajo no las contradice. Nada se repite acá salvo que T13 haya quedado incompleta.

- [ ] **Step 6: Integración completa contra Postgres real**

```bash
npm run test:integration:local 2>&1 | tail -30
```

Expected: todos los archivos en PASS, incluidos los nuevos `borradores-ia.supabase`, `copiloto-rls.supabase` y las filas nuevas de `conversations.supabase` y `agente-config.supabase` (este último corre el contract con `horario_equipo`). Reportar el número real de pasan/fallan/saltados. **Vacía 17 tablas del stack local y re-siembra al terminar**: va después de los casos A–C.

- [ ] **Step 7: Typecheck, lint y los tests de lo tocado (por ruta)**

```bash
npm run typecheck
npm run lint
npx vitest run tests/unit/copiloto tests/unit/agente tests/unit/validation tests/unit/repositories tests/unit/on-message-received tests/unit/inbox tests/unit/conversations tests/unit/inngest-functions-factory.test.ts tests/unit/copiloto-service.test.ts tests/unit/copiloto-borrador-function.test.ts tests/unit/borradores-ia.in-memory.test.ts tests/unit/select-opciones.test.tsx 2>&1 | tail -20
```

Expected: typecheck exit 0, lint exit 0 (solo los warnings deprecados de boundaries), y todos los archivos en PASS. **No** correr `npm test` completo (AGENTS §"Tests"): la suite completa la pide el orquestador al cerrar la feature.

- [ ] **Step 8: semgrep sobre los archivos tocados (regla de commit)**

```bash
git diff --name-only 0b1d0ed..HEAD -- "*.ts" "*.tsx" "*.sql" "*.mjs" > /tmp/copiloto-tocados.txt
semgrep scan --config p/typescript --config p/react --config p/security-audit --error $(cat /tmp/copiloto-tocados.txt | tr '\n' ' ')
```

Expected: 0 hallazgos bloqueantes. Cada hallazgo se resuelve o se justifica por escrito en el reporte (p. ej. `dangerouslySetInnerHTML`: el plan no lo usa; `target="_blank"`: el enlace lleva `rel="noopener noreferrer"`). Si semgrep no puede bajar reglas (sin red), usar la herramienta del plugin `semgrep` (`mcp__plugin_semgrep_guardian__get_semgrep_sast_findings`) y dejar dicho qué camino se usó.

- [ ] **Step 9: Docs**

`docs/workflows.md`:

1. En `### 1. on-message-received`, reemplazar la línea `- Acción:` por:

```md
- Acción: deduplica el entrante, resuelve lead/conversación/sesión, persiste el mensaje, cancela recordatorios vivos, **descarta el borrador vigente de la conversación** (`invalidar-borrador-previo`), aplica horario y guardas, **decide el modo** (`decidir-modo`: Copiloto, Automático o Fuera de horario, según `agente_config.horario` + `horario_equipo` y `conversaciones.modo_respuesta_override`), clasifica intent, ejecuta regla o LLM y, según el modo, **envía la respuesta por la API (Automático) o la guarda como borrador en `borradores_ia` (Copiloto)**; luego publica eventos posteriores.
```

2. Después de `### 12. dispatch-outbox-events` agregar:

```md
### 13. `copiloto-borrador`

- Archivo: `copiloto-borrador.ts`.
- Trigger: `copiloto/borrador.solicitado` (lo emite `copiloto-bootstrap.ts` al tocar "Regenerar" o "Reintentar" en la tarjeta del Inbox).
- Concurrencia: `limit: 1` por `event.data.conversacionId`; el RPC `iniciar_borrador_ia` (lock a la conversación) cubre la carrera contra `on-message-received`.
- Acción: valida que el borrador siga vigente (`listo` o `error`) y que su sesión siga activa, arranca uno nuevo con `forzar` (descarta el anterior), reusa la clasificación auditada del turno (o vuelve a clasificar), arma el turno con `buildConversationTurn` y llama a `aiAgent.respond`. `handoff` → borrador en `error` con `ia_no_disponible`; descuento excedido → `error` con `descuento_excedido`; fallo del modelo → `error` con `llm_error` / `tope_diario` y la función falla.
- Ids de step: `copiloto-borrador-<día>-<borradorId>-<paso>`.
- No envía nada por Meta.
```

3. En la tabla **Catálogo de eventos**, agregar la fila:

```md
| `copiloto/borrador.solicitado` | Server Action del Inbox | `copiloto-borrador` |
```

`docs/data-model.md`:

1. En la tabla de migraciones, agregar al final la fila de `20260930120000_copiloto.sql` (contenido: `agente_config.horario_equipo` + CHECK de los 7 días, `conversaciones.modo_respuesta_override`, tabla `borradores_ia`, RPC `iniciar_borrador_ia`, RLS y grants).
2. En `#### conversaciones` agregar el bullet: `- modo_respuesta_override text nullable CHECK ('copiloto','automatico') — null = "Según horario". Lo cambia el interruptor del encabezado del Inbox.`
3. En `#### agente_config` agregar: `- horario_equipo jsonb NOT NULL (7 días, default sin rangos = "nunca hay equipo"): cuándo hay personas para enviar desde WhatsApp Web. Misma zona que horario_timezone.`
4. Después de `#### handoff_events` agregar:

```md
#### `borradores_ia`

- Respuesta que la IA redactó en modo Copiloto: `conversacion_id`, `lead_session_id`, `mensaje_origen_id` (CASCADE los tres), `estado` (`redactando | listo | usado | error | descartado`), `contenido` (texto; nunca se loguea), `origen` (`ia | regla`), `regla_id`, `error_codigo` (código corto, nunca texto del proveedor), `usado_at/usado_via/usado_por`.
- UNIQUE parcial `borradores_ia_vigente_uq (conversacion_id) WHERE estado IN ('redactando','listo','error')`: un vigente por conversación.
- RPC `iniciar_borrador_ia` (solo service_role): lock a la conversación, `obsoleto` si el entrante ya no es el último, idempotente por `mensaje_origen_id`, `forzar` para Regenerar/Reintentar.
- RLS: SELECT admin/vendedor; sin INSERT (lo escribe el pipeline); el panel solo puede pasar `listo → usado` (policy + grant por columna).
```

5. En la tabla **RLS aplicadas** agregar `| borradores_ia | R | R (marca "usado") |`.

`docs/runbooks/como-correr-el-crm.md`: al final de la §4.1 (antes de "### Integration tests") agregar un párrafo «Probar el copiloto» con los Steps 2–4 de esta tarea condensados (activar `horario_equipo` por SQL en el stack local, simular un entrante, mirar `borradores_ia` sin leer el texto y contar `graph.envio*` en el log del mock).

- [ ] **Step 10: Commit**

```bash
git add docs/workflows.md docs/data-model.md docs/runbooks/como-correr-el-crm.md
git commit -m "docs: copiloto del Inbox en workflows, modelo de datos y runbook" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

`AGENTS.md` (estado de la fase, 88 → 89 migraciones, lecciones) **no** lo edita este worker: lo actualiza el orquestador con `claude-md-management`.

- [ ] **Step 11: Reporte final de la tarea**

Incluir: salida real de los Steps 2–4 (conteos), `test:integration:local` (pasan/fallan/saltados), typecheck/lint, hallazgos de semgrep y qué quedó **sin verificar**: la app de escritorio real, la aplicación de la migración en crm-dev, el diff de tipos contra crm-dev, y la corrida de la suite completa.

---

## A cargo del orquestador (fuera de las tareas)

1. **Aplicar la migración a crm-dev** con el protocolo de la lección 16: frenar a los agentes, `supabase db push --dry-run`, comparar con la lista de archivos, recién ahí `npm run db:push`. (El stack local ya la probó en T1/T5/T14.)
2. **Verificar los tipos contra crm-dev:** `mcp__plugin_supabase_supabase__generate_typescript_types` con `project_id` `emubzkouwvuzlrtsgorx` y comparar con `src/server/db/types.gen.ts` (diff esperado: vacío).
3. **Operativo antes de usar el copiloto (R1/R2):** corregir `horario_timezone` de la config activa de crm-dev a `America/Guayaquil`, subir `escalar_umbral_intents` a 5, dejar el horario del agente en 24/7 y **recién entonces** cargar el `horario_equipo` desde `/agente`. Hasta cargarlo, el comportamiento de crm-dev no cambia.
4. **Decisiones del dueño que el plan tomó por defecto** (ver «Discrepancias» 7, 8 y la nota de la lista): Instagram/Messenger quedan fuera del copiloto; un borrador `listo` marca la fila con un ícono pero no cambia el triage (la conversación sigue en el grupo «La IA está manejando»); y el borrador de más de 4096 caracteres se rechaza en vez de truncarse.
5. **Suite completa** (`npm test`) y `AGENTS.md` (con `claude-md-management`) al cerrar la feature.
6. **Prueba manual con la app de escritorio real** (Insertar precarga el texto en WhatsApp Web).

---

## Cobertura de la spec (auto-revisión)

| Spec                                                                                                                                       | Dónde se implementa                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| §3.1 un solo punto de decisión entre la guarda de descuento y `send`; nada cambia en BAJA/flujos/pausa/escalado/descuento                  | T6 (edits 4.7–4.8) y sus tests «cuando la IA no respondería, tampoco hay borrador»                                    |
| §3.2 `decidirModo` + las 12 combinaciones + regla en una frase                                                                             | T3 (tabla de 12 filas)                                                                                                |
| §3.2 step propio `decidir-modo`; rama fuera de horario solo con resultado Fuera de horario                                                 | T6 (4.5 y 4.6)                                                                                                        |
| §3.2 default seguro (sin rangos = sin equipo) y zona inválida = equipo cerrado                                                             | T2 (`CONFIG_DE_FABRICA`, CHECK de la migración), T3 (`equipoAbiertoAhora`)                                            |
| §3.2 modo decidido al llegar cada mensaje; cambio de horario/override no toca borradores                                                   | T6 (test «cambiar el override entre dos mensajes»)                                                                    |
| §3.3/§3.4 contexto de la IA sin coexistencia: saliente `humano` sin confirmar, idempotente                                                 | T8 (`usar`), T11 (etiqueta en la burbuja)                                                                             |
| §4.0 `horario_equipo`: los 6 sitios + rollback                                                                                             | T1 (columna + CHECK), T2 (tipo, defaults, repo x2, provider, schema, servicio, rollback), T12 (aviso en el historial) |
| §4.1 `modo_respuesta_override` y RLS de `conversaciones_update`                                                                            | T1, T4, T5 (test RLS vendedor/admin/sin rol)                                                                          |
| §4.2 tabla, índices, RLS, sin insert                                                                                                       | T1, T5                                                                                                                |
| §4.3 ciclo de vida, el más viejo no pisa al nuevo, usado una sola vez, Regenerar                                                           | T1 (RPC), T5 (contract), T6, T7                                                                                       |
| §5 interruptor de 3 estados + «Según horario · ahora X»                                                                                    | T9, T13                                                                                                               |
| §5 tarjeta en 3 contextos, acciones, Ctrl+Enter, foco, 4096, errores del puente                                                            | T10, T13                                                                                                              |
| §5 marca «Borrador listo» en la lista                                                                                                      | T11                                                                                                                   |
| §5 `/agente` Límites: editor del equipo, subtítulos, «vacío = sin equipo», recomendación 24/7, zona única                                  | T12                                                                                                                   |
| §6 LLM falla / tope diario → error + Reintentar; descuento; varios mensajes; cambio a Automático con borrador pendiente; puente falla; PII | T6, T7, T10, Global Constraints                                                                                       |
| §7 R3 (tope de salientes)                                                                                                                  | sin cambios: `sender='humano'` no cuenta (T8)                                                                         |
| §7 R4 Regenerar fuera del pipeline                                                                                                         | T7 (evento + función)                                                                                                 |
| §7 R6 doble proceso de redacción                                                                                                           | T1 (`out_resultado='existente'`), T5                                                                                  |
| §7 R1/R2                                                                                                                                   | operativo: «A cargo del orquestador»                                                                                  |
| §8 plan de pruebas (modo 12 casos, pipeline, repo, contrato PG, agente_config, UI, E2E, desktop)                                           | T3, T6, T5, T5+T14, T2, T9–T12, T14; desktop real: pendiente explícito                                                |
| §9 fuera de alcance                                                                                                                        | respetado (ecos de coexistencia, media/botones/plantillas, métricas, varios números)                                  |

**Huecos que la spec no cubría y el plan cerró:** (1) `ConversationView` no exponía la conversación (T8); (2) los paneles no pueden escribir con service-role, así que Regenerar va por evento (T7/T8); (3) un entrante que no llega a `iniciar` (baja, flujo, fuera de horario) dejaba un borrador viejo vigente (`invalidar-borrador-previo`, T6); (4) «Insertar» desde Hilo del CRM recargaba el chat vacío y pisaba el texto (T10, `insertarEnWhatsApp` marca el chat como abierto); (5) qué hacer en Instagram/Messenger (decisión 7 de las discrepancias); (6) Regenerar con la IA pausada no puede dejar la tarjeta vacía: queda en `error/ia_no_disponible` (T7); (7) el texto editado vive atado al id del borrador para que el refresco de 5 s no lo pise (T10); (8) el CHECK de los 7 días en `horario_equipo` (T1) en vez de depender solo del Zod.

**Escaneo de placeholders:** ningún paso dice «TBD»/«implementar después»/«similar a la tarea N»; los pasos de código llevan el código. Las dos referencias a «adaptar a los fixtures de ese archivo» se resolvieron con tests concretos (T8 Step 5, T11 Step 1). Las tareas de UI fijan el contrato y dejan el pulido visual al ejecutor con las skills de diseño **y criterios medibles** (T13).

**Consistencia de firmas:** `BorradoresIaRepository` (T5) es la misma en T6 (`Pick` de 5 métodos), T7 (`Pick` de 4), T8 (`Pick` de 3) y T11 (`Pick` de 1); `ResultadoIniciar`/`out_resultado` coinciden entre el SQL (T1), el repo (T5) y los consumidores; `EstadoCopiloto`/`BorradorVista` (T8) son lo que consumen T9, T10 y T13; `UsarBorradorInput`/`RegenerarBorradorInput`/`CambiarModoRespuestaInput` salen de `copiloto.schema.ts` (T8) y las usan T9/T10; `UbicacionTarjeta` vive en `acciones.ts` (T10) y la provee `CentroConversacion` (T10).
