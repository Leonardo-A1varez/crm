# Copiloto del Inbox: la IA redacta, la persona envía desde WhatsApp Web

> Foco de sesión: pantalla Inbox (AGENTS.md §5.1). Diseño acordado por chat con el dueño, sección por sección, el 2026-09-30. Se construye sobre la rama `feat/app-escritorio` (Inbox con WhatsApp Web integrado). Esta spec no contiene código.

## 1. Por qué

Desde 2026-10-01 Meta cobra cada mensaje de servicio enviado por la Cloud API: 1.000 gratis por mes por número y, después, US$0,0113 por mensaje para Ecuador. _Las cifras son las que dio el dueño citando la hoja oficial de Meta; no se re-verificaron en esta sesión y hay que contrastarlas contra esa hoja antes de usarlas en un cálculo de negocio._ Lo que una persona envía desde WhatsApp Web no pasa por la API y no se cobra.

Objetivo: cuando hay personas del equipo trabajando, la IA redacta y la persona envía desde WhatsApp Web (costo de API ≈ 0). Cuando no hay equipo pero el agente puede actuar, la IA contesta sola por la API. Hoy el código no distingue "hay equipo" de "el agente puede actuar": existe un solo horario, el del agente (§3.3). Por eso esta spec agrega un segundo horario, el del equipo (decisión 7, §2).

Pendiente externo: la coexistencia de Meta (los mensajes enviados desde la app llegan como ecos `smb_message_echoes`) espera la verificación de la empresa en Meta. Sin ella, el CRM no se entera de lo que la persona mandó por WhatsApp Web (§3.4).

## 2. Decisiones del dueño (aprobadas)

| #   | Pregunta                                         | Decisión                                                                                                                                                                                                                                                                    |
| --- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | ¿Cómo se elige el modo?                          | Por defecto según horarios (§3.2), con override **por conversación** de 3 estados: "Según horario" (default; muestra el modo efectivo, p. ej. "Según horario · ahora Copiloto"), "Copiloto" fijo y "Automático" fijo.                                                       |
| 2   | ¿Cuándo se genera el borrador?                   | Al llegar el mensaje del cliente, en el mismo pipeline, no al abrir el chat. Si el cliente escribe de nuevo antes de usarlo, se regenera y reemplaza al anterior. Botón "Regenerar".                                                                                        |
| 3   | ¿Qué ve la IA de lo que la persona mandó?        | Sin coexistencia, al tocar Insertar / Copiar / Abrir en WhatsApp Web el CRM guarda ese texto en el hilo como saliente "enviado por WhatsApp Web, sin confirmar". Cuando existan los ecos, se reemplaza por el real (fuera de alcance ahora).                                |
| 4   | ¿Dónde vive en la UI?                            | Interruptor de modo en el encabezado; tarjeta del borrador con tres ubicaciones según contexto; marca "Borrador listo" en la lista; Ctrl+Enter (§5).                                                                                                                        |
| 5   | ¿Qué pasa cuando algo falla?                     | Nada se envía solo. Tarjeta de error con Reintentar (§6).                                                                                                                                                                                                                   |
| 6   | Fuera de alcance                                 | Confirmación por ecos de coexistencia; borradores con media, botones o plantillas (solo texto); métricas del copiloto; varios números por vendedor (diseño aparte).                                                                                                         |
| 7   | O1: ¿qué es "horario" para el copiloto?          | Un **horario del equipo** nuevo: campo nuevo en `agente_config` (mismo formato que `horario`, misma `horario_timezone`), editable en `/agente` junto al horario del agente. El del equipo dice cuándo hay personas; el del agente sigue diciendo cuándo la IA puede actuar. |
| 8   | O2: "Copiloto" fijo fuera del horario del agente | Gana: se redacta el borrador y **no** se manda la plantilla. "Automático" fijo sigue al horario del agente (agente cerrado: plantilla o nada, como hoy).                                                                                                                    |

## 3. Comportamiento

### 3.1 Dónde se corta el pipeline

Hoy `on-message-received` (`src/inngest/functions/on-message-received.ts`) hace, en este orden relevante: `leer-config` (:592), `decidir-horario` (:607, llama a `estaAbierto` de `src/lib/agente/horario.ts:84`), interceptor de flujos (:621), rama fuera de horario (:672, plantilla por `metaApi.sendOutbound` en :680), `classify` (:733), `build-turn` (:833), `respond` (:842, `aiAgent.respond`), guarda de descuento (:886–:920) y `send` (:934, `metaApi.sendOutbound`).

`respond` (`src/server/services/ai-agent.service.ts`) ya decide por sí mismo cuándo la IA no contesta: sesión con `ia_pausada` (:128), flag apagado, `evaluarEscalado` (:147) y reglas IF/THEN (:175) antes del LLM (:210). Devuelve `source: "rule" | "llm" | "handoff"`.

El copiloto agrega **un solo punto de decisión**, entre la guarda de descuento y `send`:

- Modo **automático**: todo igual que hoy, `send` llama a `sendOutbound`.
- Modo **copiloto**: no se llama a `sendOutbound`. La respuesta que produjo `respond` (regla o LLM) se guarda en `borradores_ia`.

Nada de lo anterior cambia: BAJA, flujos interceptores, pausa / `ia_pausada`, escalado, guarda de descuento. Si hoy la IA no respondería (`source: "handoff"`, interceptado, descuento excedido), tampoco hay borrador. El costo del LLM se registra igual (`recordLlmUsage`, `src/server/services/llm/openai-ai-agent.ts:180`): el borrador cuesta lo mismo que una respuesta automática; lo que se ahorra es el mensaje de Meta.

### 3.2 Decisión de modo

Dos horarios, ambos en `horario_timezone`:

- **Horario del agente** (`agente_config.horario`, existe hoy): cuándo la IA puede actuar. No cambia.
- **Horario del equipo** (`agente_config.horario_equipo`, nuevo): cuándo hay personas para enviar desde WhatsApp Web.

Función pura `decidirModo({ override, equipoAbierto, agenteAbierto })`, evaluada en un step propio (`decidir-modo`, junto a `decidir-horario`) por la misma razón que el horario: Inngest re-ejecuta el handler en cada paso y una lectura viva cambiaría a mitad del turno. Devuelve uno de tres resultados:

- **Copiloto**: se redacta el borrador; no se manda el mensaje ni la plantilla.
- **Automático**: la IA envía por la API (todo como hoy).
- **Fuera de horario**: comportamiento actual con el agente cerrado: `plantilla_fuera_horario` si hay, y si no, nada; sin LLM.

Tabla de decisión final (las 12 combinaciones):

| Override               | Equipo  | Agente  | Resultado        | Nota                                                                           |
| ---------------------- | ------- | ------- | ---------------- | ------------------------------------------------------------------------------ |
| Según horario (`null`) | abierto | abierto | Copiloto         | Caso típico de día.                                                            |
| Según horario (`null`) | abierto | cerrado | Copiloto         | Hay personas; el agente cerrado no impide redactar (el borrador no sale solo). |
| Según horario (`null`) | cerrado | abierto | Automático       | Caso típico de noche: la IA contesta por la API.                               |
| Según horario (`null`) | cerrado | cerrado | Fuera de horario | Plantilla o nada, como hoy.                                                    |
| Copiloto fijo          | abierto | abierto | Copiloto         | O2: el override fijo manda.                                                    |
| Copiloto fijo          | abierto | cerrado | Copiloto         | O2: borrador sin plantilla.                                                    |
| Copiloto fijo          | cerrado | abierto | Copiloto         |                                                                                |
| Copiloto fijo          | cerrado | cerrado | Copiloto         | O2: borrador sin plantilla.                                                    |
| Automático fijo        | abierto | abierto | Automático       | Igual que hoy.                                                                 |
| Automático fijo        | abierto | cerrado | Fuera de horario | Sigue al agente: plantilla o nada.                                             |
| Automático fijo        | cerrado | abierto | Automático       |                                                                                |
| Automático fijo        | cerrado | cerrado | Fuera de horario |                                                                                |

Regla en una frase: "Copiloto" fijo es siempre Copiloto; "Automático" fijo es Automático si el agente está abierto y Fuera de horario si no; "Según horario" es Copiloto si el equipo está abierto, si no Automático si el agente está abierto, y si no Fuera de horario.

El modo se decide **al llegar cada mensaje**; un cambio de horario o de override no toca borradores ya generados.

**Cambio en el pipeline:** la rama fuera de horario (:672) deja de depender solo de `!abierto` y pasa a ejecutarse cuando el resultado es **Fuera de horario**. Con resultado Copiloto y agente cerrado, el turno sigue por `classify` / `respond` como en horario. El interceptor de flujos (:621) sigue consultándose solo con el agente abierto, como hoy ("fuera de horario nunca hay turno interceptado"); en Copiloto con agente cerrado los flujos no interceptan.

**Horario del equipo no configurado (default seguro):** `horario_equipo` sin un solo rango (los 7 días vacíos) significa "nunca hay equipo", así que "Según horario" nunca da Copiloto y el comportamiento es el de hoy (Automático con el agente abierto). Se eligió por seguridad: desplegar la migración no cambia nada hasta que el dueño configure el horario del equipo, y el copiloto solo se enciende a propósito. El default contrario (equipo 24/7) activaría el copiloto en toda conversación al desplegar y dejaría de salir respuestas por la API sin que nadie lo pidiera.

**Zona horaria inválida:** `estaAbierto` devuelve `true` ante una zona inválida (`src/lib/agente/horario.ts:84`, decisión de no callar al cliente). Para el agente eso sigue igual. Para el equipo sería el lado inseguro (declararía equipo presente y dejaría mensajes esperando un borrador que nadie envía), así que `equipoAbierto = esTimezoneValida(tz) && tieneAlgunRango(horario_equipo) && estaAbierto(...)`: zona inválida o sin rangos cuenta como equipo cerrado.

**Recomendación operativa:** poner el horario del agente en 24/7 (es la semilla actual), para que de noche, con el equipo cerrado, la IA conteste por la API. Si el agente se cierra de noche, esas conversaciones reciben la plantilla en lugar de una respuesta.

### 3.3 Hallazgo: hoy existe un solo horario, el del agente, y fuera de él la IA NO contesta

Contexto de la decisión O1. Hechos leídos en el código:

- `estaAbierto(config.horario, config.horario_timezone, …)` decide en `on-message-received.ts:607`. Si `!abierto` (:672), el pipeline **no invoca ningún LLM**: manda `plantilla_fuera_horario` si está configurada y, si no, no responde nada. El comentario del propio código lo dice ("Fuera de horario: no se invoca ningún LLM").
- Es decir: no hay forma de expresar "hay personas" distinto de "la IA puede actuar". De ahí sale el segundo horario de §3.2.

### 3.4 Contexto de la IA sin coexistencia

Lo que la persona manda desde WhatsApp Web no llega al CRM. Para que la IA no conteste el turno siguiente como si nada hubiera pasado, al tocar **Insertar**, **Copiar** o **Abrir en WhatsApp Web** el CRM guarda el texto en `mensajes` como saliente:

- `direction = 'out'`, `sender = 'humano'`, `sender_user_id` = quien tocó el botón, `tipo = 'text'`, `meta_message_id = null`.
- `metadata = { "origen": "whatsapp_web_sin_confirmar", "borrador_id": "<uuid>" }`.
- `idempotency_key = "copiloto:<borrador_id>"`: tocar dos botones sobre el mismo borrador no duplica el mensaje.
- El hilo lo muestra como "enviado por WhatsApp Web, sin confirmar". No tiene estados de entrega.

**Por qué `sender = 'humano'` y no `'ia'`:** `contarSalientesAutomaticos` (`src/server/repositories/messages.supabase.repo.ts:297`) cuenta `sender in ('ia','sistema')` contra `agente_config.max_salientes_automaticos_24h` (hoy 3). Un saliente `humano` no consume ese tope, que es lo correcto: lo envió una persona. Los borradores en sí tampoco son salientes (no hay mensaje hasta que la persona toca algo).

Cuando existan los ecos, el eco real reemplaza a esta fila (correlación por texto + ventana de tiempo, a diseñar entonces). Fuera de alcance ahora; la marca `origen` deja el punto de enganche.

Limitación asumida: el CRM registra "la persona lo envió" cuando toca el botón, no cuando realmente lo envía. Si la persona inserta y no presiona Enter, el hilo dice algo que no pasó. Por eso la marca dice "sin confirmar" y por eso es una solución transitoria.

## 4. Modelo de datos (propuesta a validar con `supabase` antes de la migración)

> Nada de esto se aplicó. Antes de escribir la migración hay que inspeccionar el esquema real de crm-dev por el CLI o con `mcp__plugin_supabase_supabase__execute_sql` pasando el `project_id` de crm-dev (lección 15: el MCP `mcp__supabase__*` de esta máquina apunta a otro proyecto) y revisar con `supabase:supabase-postgres-best-practices`.

### 4.0 Horario del equipo: columna nueva en `agente_config`

```sql
alter table public.agente_config
  add column horario_equipo jsonb not null
    default '{"lun":[],"mar":[],"mie":[],"jue":[],"vie":[],"sab":[],"dom":[]}'::jsonb;
```

- **Mismo formato que `horario`** (`Horario` de `src/types/agente.ts`: los 7 días con una lista de rangos `HH:MM`) y **misma `horario_timezone`**: no hay una segunda zona. El default lleva los 7 días con lista vacía y no `'{}'` porque `HorarioSchema` (`src/lib/validation/agente.schema.ts`) exige las 7 claves; un `{}` fallaría al leer la fila.
- **Coherente con el versionado:** `agente_config` es append-only, una fila por versión. La migración solo agrega una columna con default: ninguna fila existente se reescribe ni se toca su historia, y toda versión previa (incluida la activa) lee "sin equipo", que es el default seguro de §3.2.
- **Sitios que hay que tocar** (todos son la misma lista de campos de la config; se enumeran para que el plan no olvide ninguno): el tipo `AgenteConfigValores`, `CONFIG_DE_FABRICA` en `src/lib/agente/defaults.ts` (la migración de la semilla dice que deben coincidir), el repo (`agente-config.supabase.repo.ts`) y su espejo InMemory, `config-provider.ts` (el `leer-config` del pipeline solo copia los campos que lee: hay que agregar `horario_equipo`), el schema Zod y el servicio (`agente-config.service.ts`), donde `horario` está **excluido** de la lista de campos escalares porque se compara por valor, día a día y rango a rango; `horario_equipo` recibe el mismo trato. La auditoría guarda nombres de campos y nunca valores, así que solo suma el nombre.
- **Rollback:** el rollback crea una versión nueva copiando los campos de la versión elegida. Volver a una versión anterior a esta migración copia "sin equipo" y apaga el copiloto hasta reconfigurar. Es coherente con "la versión es la config completa" y se documenta en la UI del rollback; la alternativa (excluir `horario_equipo` del rollback) rompería esa regla y no se adopta.

### 4.1 Preferencia de modo: columna en `conversaciones`

```sql
alter table public.conversaciones
  add column modo_respuesta_override text
    check (modo_respuesta_override in ('copiloto','automatico'));
-- null = "Según horario"
```

Decisión: **columna nullable en `conversaciones`**, no tabla ni columna en `lead_session`. Justificación:

- Es 1:1 con la conversación y el pipeline ya carga `conv` (step `upsert-conv`, :270) antes de decidir: cero lecturas adicionales ni joins.
- La decisión 1 dice "por conversación". `lead_session` se cierra y se purga a los 29 días; la preferencia de atender un chat a mano tiene que sobrevivir a una sesión nueva del mismo hilo.
- `null` como "Según horario" evita un valor mágico y un default que hubiera que migrar si cambia la semántica.
- RLS: `conversaciones_update` ya existe para admin y vendedor (`supabase/migrations/20260714124024_slice3_rls_policies.sql:53`), así que el interruptor del encabezado no necesita policy nueva. **A verificar** que esa policy permita actualizar esta columna desde el cliente autenticado y que la Server Action valide con Zod (regla 9).
- Alternativa descartada: tabla `preferencias_conversacion`. Agrega una FK, una policy y un join para guardar un solo valor.

### 4.2 `borradores_ia`

| Columna                    | Tipo / regla                                                                                        |
| -------------------------- | --------------------------------------------------------------------------------------------------- |
| `id`                       | `uuid` PK `gen_random_uuid()`                                                                       |
| `conversacion_id`          | `uuid not null` FK `conversaciones` `on delete cascade`                                             |
| `lead_session_id`          | `uuid not null` FK `lead_session` `on delete cascade` (la purga de 29 días se lleva los borradores) |
| `mensaje_origen_id`        | `uuid not null` FK `mensajes` `on delete cascade`: el entrante que lo disparó                       |
| `estado`                   | `text not null` check en `('redactando','listo','usado','error','descartado')`                      |
| `contenido`                | `text` null mientras redacta o si falló; no loguear nunca                                           |
| `origen`                   | `text` check en `('ia','regla')`; null mientras redacta                                             |
| `regla_id`                 | `uuid` FK `reglas` `on delete set null`; para "Regla: …"                                            |
| `error_codigo`             | `text`: `llm_error`, `tope_diario`, etc. Sin texto libre del proveedor                              |
| `usado_at`                 | `timestamptz`                                                                                       |
| `usado_via`                | `text` check en `('insertar','copiar','abrir_web','al_composer')`                                   |
| `usado_por`                | `uuid` FK `usuarios` `on delete set null`                                                           |
| `created_at`, `updated_at` | `timestamptz not null default now()`                                                                |

Índices:

- **Un vigente por conversación:** `create unique index borradores_ia_vigente_uq on borradores_ia (conversacion_id) where estado in ('redactando','listo','error');`. "Usado" y "descartado" quedan como historial y no compiten por el índice.
- Índice por `lead_session_id` (FK con `cascade`) y por `mensaje_origen_id`, por el mismo motivo que los índices de `turnos_interceptados` (sin ellos el borrado en cascada recorre la tabla).

RLS: `enable row level security`; `select` para `is_admin() or is_vendedor()`; **update** limitado a admin y vendedor solo para marcar usado o editar el texto (lo edita la persona en la tarjeta); **sin policy de insert**: lo escribe el pipeline con service-role, igual que `turnos_interceptados` (`supabase/migrations/20260926180000_turnos_interceptados_y_notificaciones.sql`). Se prefiere pasar el "marcar usado" por una Server Action con service-role, si `supabase` confirma que una policy de update por columna es más frágil.

### 4.3 Ciclo de vida y carrera del reemplazo

- Pipeline en modo copiloto: antes de `respond`, `insertar/upsert` una fila `redactando` (la UI muestra "Redactando…"). Si `respond` devuelve `handoff`, o la guarda de descuento descarta, la fila pasa a `descartado` (no hay borrador que mostrar). Si devuelve texto, pasa a `listo` con `contenido` y `origen`.
- **El más viejo nunca pisa al nuevo:** la escritura es condicional al mensaje de origen. Un borrador solo puede reemplazar al vigente si su `mensaje_origen_id` es el último entrante de la conversación (el repo ya tiene `findUltimoEntranteAt`, `messages.supabase.repo.ts:310`). Mecánica exacta (RPC atómica con el índice parcial, o compare-and-set por `mensaje_origen_id`) a fijar en el plan con `supabase`.
- Varios mensajes seguidos del cliente: un solo borrador, con el último contexto.
- Al Insertar o Copiar, el borrador pasa a `usado` una sola vez (`update … where estado = 'listo'`; si ya no está `listo`, no se repite el guardado del saliente de §3.4).
- Regenerar: marca el vigente `descartado`, crea uno `redactando` y vuelve a correr `respond` con el contexto actual (ver riesgo R4 sobre cómo se dispara fuera del pipeline).

## 5. Interfaz

Reglas comunes: el texto de la tarjeta es editable; la tarjeta muestra el origen ("IA" o "Regla: <nombre>") y la hora; estados **Redactando…**, **listo**, **Ya usado** (atenuada) y **error** con Reintentar.

| Contexto                                      | Ubicación de la tarjeta                                                              | Acción principal                                                                                                                                               | Secundarias       |
| --------------------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| App de escritorio, modo "WhatsApp Web"        | Entre la barra superior (`BarraVistaWhatsApp`) y la vista de WhatsApp, que se achica | **Insertar en WhatsApp** → `window.crmEscritorio.abrirChat(telefono, texto)`: la app recarga el chat 1–2 s con el texto precargado y la persona presiona Enter | Copiar, Regenerar |
| App de escritorio, modo "Hilo del CRM"        | Sobre el composer (`MessageInput`)                                                   | **Insertar en WhatsApp** (mismo puente) y **Al composer** (envía por API, con costo: es un saliente humano normal de `sendMessageAction`)                      | Copiar, Regenerar |
| Navegador normal (sin `window.crmEscritorio`) | Sobre el composer                                                                    | **Abrir en WhatsApp Web** → pestaña nueva a `https://web.whatsapp.com/send?phone=<E164 sin +>&text=<texto>`                                                    | Copiar, Regenerar |

Además:

- **Encabezado del chat:** interruptor de modo junto a "IA activa" (`HandoffToggle`), de 3 estados; en "Según horario" muestra el modo efectivo ("Según horario · ahora Copiloto").
- **Lista del Inbox:** marca "Borrador listo" en las conversaciones con un borrador `listo` sin usar.
- **Teclado:** Ctrl+Enter ejecuta la acción principal de la tarjeta; el foco va al texto del borrador.

**`/agente`, pestaña Límites (`TabLimites.tsx`):** el editor del horario del equipo va **junto al del agente**, con su propio subtítulo: "Cuándo hay personas para enviar desde WhatsApp Web. En este horario la IA redacta y vos enviás." Reutiliza `EditorHorario` (`src/app/(panel)/agente/_components/EditorHorario.tsx`). Hoy ese componente recibe `horario` y `timezone` juntos y edita ambos; como la zona es **una sola** para los dos horarios, el plan debe generalizarlo (por ejemplo, zona de solo lectura o editada una vez para ambos) en lugar de duplicarlo. El editor del equipo debe decir explícitamente que vacío significa "sin equipo: la IA responde sola", y la pestaña muestra la recomendación operativa de §3.2 (horario del agente 24/7).

Restricción del puente de escritorio: `abrirChat(telefono, texto)` acepta texto de hasta 4096 caracteres (`LARGO_MAXIMO_TEXTO`, `desktop/src/main/seguridad.ts:114`) y el teléfono se normaliza a 8–15 dígitos (`normalizarTelefono`, mismo archivo). Hoy `CentroConversacion.tsx:74` lo llama con texto vacío (`abrirChat(numero, "")`) solo para abrir el chat; el copiloto lo reutiliza con texto sin tocar el contrato (`src/types/crm-escritorio.d.ts`, `desktop/src/preload/crm.ts:57`). El borrador debe truncarse o rechazarse en la tarjeta si supera 4096 (hoy el límite del composer también es 4096 según el mensaje de `send-message.action.ts`).

## 6. Errores y casos borde

- **LLM falla o tope diario de gasto:** la tarjeta dice "No se pudo redactar" con Reintentar. No se envía nada. El borrador queda en `error` con `error_codigo`.
- **Guarda de descuento:** igual que hoy: la IA se pausa y se escala; no hay borrador.
- **Varios mensajes seguidos:** un borrador con el último contexto (§4.3).
- **Cambiar a Automático con un borrador pendiente:** no se envía solo; queda en la tarjeta hasta que la persona lo use o llegue otro mensaje.
- **Cambio de modo a mitad de turno:** el modo se decidió al llegar el mensaje; no se re-evalúa.
- **La app no puede insertar** (vista ausente, teléfono inválido, `motivo` en la respuesta de `abrirChat`): error claro con el `motivoLegible` ya existente y botón Copiar.
- **PII:** el texto del borrador nunca se loguea (regla 9). En la URL de §5 el texto viaja solo en `send?text`, nunca se escribe en un log ni en un header de la app; el teléfono en la URL es E.164 sin `+`. Conviene anotarlo porque una URL sí puede terminar en el historial del navegador de la persona, y eso es una decisión consciente del dueño para el contexto navegador.

## 7. Riesgos y requisitos previos (hallazgos)

Leídos el 2026-09-30 contra crm-dev, salvo donde se aclara.

- **R1. Zona horaria equivocada.** La `agente_config` activa de crm-dev tiene `horario_timezone = America/Argentina/Buenos_Aires` y el negocio está en Ecuador (`America/Guayaquil`). El modo "Según horario" depende del horario: hay que corregirlo **antes** de usar el copiloto, o el modo cambiará a la hora equivocada. _Dato de crm-dev reportado por el orquestador; el default del código en `src/lib/agente/defaults.ts:53` también es `America/Argentina/Buenos_Aires`, verificado en esta sesión._ Revisar también ese default: toda instalación nueva nace con esa zona. Con el horario del equipo la zona pesa más: define a qué hora empieza y termina el copiloto.
- **R2. `escalar_umbral_intents = 2`.** Hace que la IA escale casi siempre (ocurrió en la prueba real del 2026-09-30), y un escalado significa `source: "handoff"`, o sea **sin borrador**. El copiloto se vería roto sin estarlo. Recomendado 5. _Valor activo reportado por el orquestador; el default del código es 2 (`defaults.ts:45`)._
- **R3. `max_salientes_automaticos_24h = 3`.** Cuenta salientes `ia` y `sistema` (`messages.supabase.repo.ts:297`). Interacción con el copiloto: los borradores no cuentan porque no son mensajes; el saliente "sin confirmar" (§3.4) y "Al composer" son `humano` y tampoco cuentan. Definido: el copiloto no consume ni exige cambiar ese tope. Sigue aplicando a workflows y difusión como hoy.
- **R4. Regenerar fuera del pipeline.** `respond` hoy solo corre dentro de `on-message-received`. "Regenerar" y "Reintentar" necesitan volver a invocar la generación desde una Server Action o un evento Inngest propio, reconstruyendo `conversationTurn` y `classification` del último entrante. Esa forma de invocarlo no existe; es un requisito de diseño del plan, no algo resuelto acá.
- **R5. Dos horarios distintos.** El horario del agente y el del equipo pueden contradecirse (equipo abierto con agente cerrado, por ejemplo). §3.2 fija el resultado de las 12 combinaciones; la UI de `/agente` tiene que dejar claro cuál es cuál. Si el agente se cierra de noche, esas conversaciones reciben la plantilla y no una respuesta de la IA.
- **R6. Doble proceso de redacción.** El pipeline puede reintentar pasos. La escritura del borrador tiene que ser idempotente (clave por `mensaje_origen_id`), igual que `turn_classifications` (UNIQUE por mensaje).

## 8. Plan de pruebas

- **Decisión de modo** (unit, puro): la matriz completa de §3.2, **3 overrides x equipo abierto/cerrado x agente abierto/cerrado = 12 casos**, uno por fila de la tabla. Además: horario del equipo vacío nunca da Copiloto con "Según horario"; zona horaria inválida cuenta como equipo cerrado pero el agente sigue "abierto" (comportamiento actual de `estaAbierto`); cambio de horario o de override entre dos mensajes.
- **Pipeline** (unit sobre `on-message-received`, dobles en memoria): en copiloto `sendOutbound` no se llama y se crea un borrador; con resultado Copiloto y agente cerrado no se manda la plantilla y sí se redacta el borrador; con resultado Fuera de horario sale la plantilla o nada, como hoy; en automático el comportamiento es idéntico al actual (los tests existentes no cambian); no hay borrador cuando `respond` devuelve `handoff` ni con descuento excedido ni con BAJA ni interceptado.
- **Repositorio de borradores:** reemplazo (el más viejo no pisa al nuevo), "usado" una sola vez, idempotencia por `mensaje_origen_id`, contrato reusable `runBorradoresIaContract(makeRepo)` (InMemory ↔ Supabase).
- **Contrato contra Postgres real:** `npm run test:integration:local` (stack local, lección 10), incluyendo el índice único parcial y las policies RLS admin y vendedor (con la matriz que ya usa la suite RLS).
- **`agente_config`:** la columna `horario_equipo` round-trip por repo InMemory y Supabase (contrato existente), default de las filas previas, comparación por valor en el servicio de config y rollback que la copia.
- **UI:** el editor del horario del equipo en `/agente` (guardar, vacío = sin equipo); la tarjeta en los 3 contextos (escritorio WhatsApp Web, escritorio Hilo del CRM, navegador), sus estados (redactando, listo, usado, error) y el teclado (Ctrl+Enter, foco).
- **E2E en el stack local** con un mensaje simulado (`docs/runbooks/como-correr-el-crm.md` §4.1): se crea el borrador y el mock de la Graph API **no** recibe ningún envío. Es la prueba que vale (lección 14): dispararlo de verdad, con `SELECT` a la base y el log del mock.
- **Con la app de escritorio real:** Insertar precarga el texto en WhatsApp Web. Esto solo se puede comprobar a mano con la app corriendo; no hay forma de automatizarlo en el stack local.

## 9. Fuera de alcance

- Confirmación por ecos de coexistencia (`smb_message_echoes`) y reemplazo del saliente "sin confirmar".
- Borradores con media, botones, listas o plantillas: solo texto.
- Métricas del copiloto (borradores usados / editados / descartados, ahorro de API).
- Varios números de WhatsApp por vendedor (diseño aparte).
- Cambiar la plantilla o la semántica del horario del agente: sigue siendo "cuándo la IA puede actuar".

## 10. Preguntas abiertas para el dueño

Ninguna. O1 y O2 quedaron resueltas el 2026-09-30 y están en §2 (decisiones 7 y 8) y §3.2.

## 11. Auto-revisión

Hecha el 2026-09-30 al incorporar O1 y O2: sin marcadores pendientes ni preguntas abiertas; la tabla de §3.2 cubre las 12 combinaciones y coincide con la regla en una frase, con §2 (decisiones 7 y 8), con el pipeline (rama fuera de horario solo con resultado Fuera de horario) y con la matriz de pruebas de §8; el default del equipo (vacío) es el mismo en §3.2 y en el SQL de §4.0 (7 días con lista vacía). Alcance acotado a la pantalla Inbox más la pestaña Límites de `/agente` (un editor), dos migraciones (columna en `agente_config`, tabla y columna del copiloto) y un paso nuevo del pipeline. Los números de línea son de la rama `feat/app-escritorio` al 2026-09-30 y se reproducen con `grep -n` sobre los archivos citados.
