# Cómo retomar la sesión

> Última actualización: **2026-08-13**. El checkpoint QA y el cierre de brechas están en `master`. La investigación actual de Meta API quedó documentada y todavía no autoriza implementación.
> **Siguiente decisión: elegir 1–3 capacidades del reporte Meta. También faltan QA visual, smoke autenticado de `inbox_recent_messages`/`transition_handoff`, medición SQL y una base aislada de integración; no declarar rendimiento ni el lanzamiento completos.**
> Users dev: `admin-dev@crm.local` / `dev-admin-2026!` · `vendedor-dev@crm.local` / `dev-vendedor-2026!`.

> Las migraciones aditivas autorizadas están aplicadas sin reset ni truncate. `test:integration` sigue congelado y `build` no se ejecutó.

---

## ⚠️ Recordatorio crítico de seguridad

**JAMÁS pegar credenciales en chat con el asistente.** Secrets (`OPENAI_API_KEY`, `service_role`, `META_*`) → directo a `.env.local` con editor. Si el asistente "necesita ver" un secret, rechazar: que diagnostique por comportamiento.

---

## Estado real al cierre

| Qué                | Cuánto                                                                      |
| ------------------ | --------------------------------------------------------------------------- |
| Rama               | `master`; al iniciar esta investigación estaba alineada con `origin/master` |
| Investigación Meta | Reporte, ledger y docs operativas actualizados; sin código ni activos Meta  |
| Tests unitarios    | **1617 pasan en 136 archivos** en el último cierre; no se rerun por docs    |
| Coverage           | **87.3 / 79.39 / 82.8 / 88.25** — último corte, no recalculado              |
| Integration        | **congelados, no verdes** — ver bloqueante 1                                |
| Migraciones        | **38 aplicadas a `crm-dev`**, la última `20260813172558`                    |
| Revisión visual    | **ninguna pantalla** se miró con ojos humanos — ver bloqueante 2            |

### Investigación Meta API completada

Leer primero:

1. [`research/meta-api-capabilities-2026-08.md`](./research/meta-api-capabilities-2026-08.md) — reporte negocio+técnico, brechas, matriz ROI y roadmap.
2. [`research/meta-api-source-ledger-2026-08.md`](./research/meta-api-source-ledger-2026-08.md) — fuente, fecha, versión/región y confianza por afirmación.
3. [`meta-platform-limits.md`](./meta-platform-limits.md) — contrato operativo de ventanas, pricing, permisos y límites.
4. [`meta-webhook-payloads.md`](./meta-webhook-payloads.md) — soporte real del parser/cliente y contrato futuro propuesto.

Hallazgos que condicionan lo siguiente:

- WhatsApp es el único canal configurado. Instagram y Messenger son soporte arquitectónico no validado.
- El cliente de salida solo sabe enviar texto; WA media entrante se tipa pero no se descarga; IG/FB descartan attachments, replies, reactions, postbacks y referrals.
- `v21.0` está obsoleto como baseline sin una suite contractual. Una lectura segura aceptó `v25.0` y respondió con header `v26.0`, pero no se cambia el pin por inferencia.
- Pricing WhatsApp vigente es por mensaje entregado, no por conversación. La documentación vieja fue retirada.
- Mayor ROI sin catálogo: health/versionado, media+reply context WA, read/typing, interactivos/Flows y luego Instagram comments/referrals.

Punto de decisión obligatorio antes de código: elegir 1–3 capacidades. Recomendación del reporte:

1. M0 compatibilidad, capability registry y health Meta.
2. WhatsApp media + replies + read/typing.
3. WhatsApp Flow para vehículo, año, motor, pieza, ciudad, urgencia y adjuntos, sin catálogo.

No se enviaron mensajes, no se cambiaron campañas/activos/tokens y no se tocaron schema ni código.

**Qué se hizo.** Además del checkpoint QA, el cierre de brechas corrigió la ventana de doble envío, tipó fallos Graph, instaló una guarda anti-TRUNCATE, fijó `server_now`, eliminó el cierre duplicado y convirtió la aprobación de merges en una RPC Postgres transaccional.

- **Instrumentación** — el sistema dejó de descartar lo que el handoff pide medir: autoría real en `mensajes.sender_user_id`, clasificación del turno en `turn_classifications`, procedencia por campo del Twin con el mensaje del que salió cada dato, `etapa_alcanzada` para congelar el rail en los desvíos, y condiciones de escalado configurables en `agente_config`.
- **Costo de IA** persistido por turno (`llm_usage`) y agregado por conversación y por lead.
- **Inbox y Leads** — buscador de conversaciones y buscador dentro del hilo, filtros combinables que viven en la URL, ficha del lead editable, etiquetas, cierre de venta con motivo obligatorio, auditoría por turno, y recordatorios de seguimiento con workflow durable.

### Migraciones recientes

| Migración                                                | Qué hace                                                                           |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `20260810011500_mensajes_estado_entrega`                 | enum `enviado/entregado/leido/fallido` + `error_entrega` en `mensajes`             |
| `20260810011600_lead_session_procedencia`                | `procedencia` jsonb: de dónde salió cada campo del Twin                            |
| `20260810143000_turn_classifications`                    | qué intent resolvió cada turno del LLM; `mensaje_id` UNIQUE contra replays         |
| `20260810143100_lead_session_updated_at`                 | `updated_at` de la sesión — el "hace 40 s" del encabezado del Twin                 |
| `20260810150000_procedencia_extractor_y_etapa_alcanzada` | `mensaje_origen_id` + `valor_anterior` por campo, y `etapa_alcanzada`              |
| `20260810161500_agente_config_escalado`                  | umbral de intents, palabras que escalan siempre, cotización desde, timeout de tool |
| `20260810190000_llm_usage`                               | costo de IA por turno, con índices por sesión y por fecha                          |
| `20260810200000_tags_delete_admin`                       | policy DELETE de `tags`, solo admin                                                |
| `20260810210000_lead_tags_delete`                        | policy DELETE de `lead_tags` — sacarle una etiqueta a un lead                      |
| `20260810230000_leads_nombre_perfil_y_datos_extra`       | `nombre_perfil` que manda Meta + `datos_extra` jsonb                               |
| `20260811120000_session_recordatorios`                   | recordatorios de seguimiento con fecha + índice de vencidos                        |
| `20260811160000_mensajes_contenido_trgm`                 | índice GIN trigram sobre `mensajes.contenido` para el buscador del Inbox           |
| `20260812170131_inbox_active_summary`                    | RPC acotada del Inbox + índice `(lead_session_id, created_at DESC)`                |
| `20260812222808_qa_handoff_metrics`                      | timestamps Meta, handoff transaccional, template de escalado y perfil nullable     |
| `20260813090000_server_now_search_path`                  | `search_path` seguro del helper de tiempo                                          |
| `20260813163957_approve_lead_merge_transaction`          | merge administrativo atómico, RLS-aware y auditable                                |
| `20260813172558_fix_approve_lead_merge_lint`             | reemplaza la RPC sin la variable muerta detectada por `db lint`                    |

---

## 🔴 Bloqueantes de método — no son bugs de código

### 1. `SUPABASE_TEST_URL` apunta al mismo proyecto Supabase que la app

`npm run test:integration` llama a `cleanupTestDb`, que hace TRUNCATE. Desde el cierre de brechas, `assertBaseDeTestsAislada` aborta si detecta que la URL de tests coincide con la de la app. La bomba accidental está desactivada, pero la suite sigue sin tener dónde correr.

La consecuencia no es solo perder los datos de prueba: hay **contract tests que nunca corrieron contra Postgres real** —`turn-classifications`, `llm-usage`, `session-recordatorios`, `handoff-events` y los de `agente_config` posteriores a G1—. Todo lo que sabemos de esos repos lo sabemos por la implementación in-memory, que no tiene constraints, ni FKs, ni RLS. Un `not null` mal puesto o una policy que rechaza un insert no lo ve nadie hasta producción.

**El arreglo pendiente es un proyecto Supabase aparte** (free tier alcanza), con `SUPABASE_TEST_URL` y `SUPABASE_TEST_SERVICE_KEY` apuntando ahí y las 38 migraciones aplicadas. Es la única forma de volver a tener esa suite. Requiere que el dueño cree el proyecto.

Hasta entonces: **no correr `test:integration`**. Está anotado en `AGENTS.md` §6.

### 2. Ninguna pantalla fue revisada visualmente

El panel del navegador **no compuso frames en toda la sesión**. Todo lo que se afirma sobre las pantallas está medido sobre el DOM y cubierto por tests. Eso encuentra estructura y no encuentra apariencia.

El dato duro: **cada vez que el dueño mandó una captura aparecieron cosas que ninguna medición había detectado.** Espacios muertos, rótulos de más, controles que se pisan. Un test que pregunta "¿el nodo existe y mide 322px?" contesta que sí de todas maneras.

Pendientes de mirar, en orden de riesgo:

1. **Leads** con sus filtros nuevos — es la pantalla que más cambió.
2. **Métricas** — tres cortes con datos reales, y varios cuadros dependen de datos que recién se empezaron a registrar.
3. **La consola del agente** (`/agente`) — cuatro pestañas.
4. **`/tags`**.
5. **El buscador del Inbox.**
6. **El flujo de reprogramar un seguimiento.**

El método que sí funciona con el panel roto está en `AGENTS.md` §2 lección 6: pedir el HTML renderizado al server por `fetch` e inyectar la raíz en el DOM con el CSS real. Sirve para medir; **no sustituye a mirar**.

---

## 🟢 Decisiones de producto cerradas para esta implementación

### 3. Una sola puerta de cierre

**Aplicado:** el único cierre queda en el rail del Twin. `CloseSessionButton.tsx`, que ya no tenía consumidores, fue eliminado.

### 4. Qué pasa cuando la IA escala y no hay nadie

El dueño dijo que **no quiere vendedores humanos**. Pero el sistema escala a `requiere_humano` —por pedido explícito del cliente, por intents desconocidos seguidos, por palabras de la lista, por cotización alta— y pausa la IA. Con nadie del otro lado, **esas conversaciones quedan detenidas**: el cliente escribió, la IA no contesta, nadie la toma.

**Decisión 2026-08-12:** el sistema envía un aviso neutral, marca revisión administrativa y pausa la IA. La causa se persiste con código tipado, nunca con el mensaje del cliente. Una pausa manual no envía nada por omisión.

### 5. Upstash sigue sin configurar

`UPSTASH_REDIS_REST_URL` y `UPSTASH_REDIS_REST_TOKEN` están comentadas en `.env.local`. El dueño **no quiere tope de gasto**, así que esto **no es bloqueante** y no hay que insistir con eso.

Lo que sí hay que dejar dicho: el **costo por lead y por conversación sí se persiste y se ve** —eso vive en `llm_usage`, no en Upstash—, así que la visibilidad del gasto no depende de esta decisión. Lo que no existe es el **corte**. Sin tope, un bucle descontrolado —un webhook que reintenta, una sesión que no cierra— **factura sin límite y nadie lo frena.** El pedido del dueño es legítimo; el riesgo también, y no se va solo.

---

## 🟡 Trabajo técnico pendiente

### 6. Rendimiento — read path corregido, aún sin medición representativa

**Es lo que el dueño pidió al principio y lo que más se fue postergando.** Se está eliminando el N+1 del read path, pero no hay una medición contra Postgres ni datos representativos; no declarar el problema cerrado todavía.

Sospechoso concreto, `listActiveLeads` en `src/server/services/inbox/default-inbox.service.ts`:

- por cada sesión activa: un `leads.findById` y un `convs.findByLeadId`;
- por cada conversación de ese lead: un `messages.listByConversacion`;
- y después un `messages.listBySessionId` más.

La implementación histórica hacía `3N + NC` consultas secuenciales y **el poller la re-ejecuta cada 5 segundos** (`RefreshPoller` montado en `src/app/(panel)/inbox/layout.tsx`). La corrección debe evitar también traer el historial completo de todas las sesiones activas: el presupuesto correcto es un resumen paginado por lead con último mensaje y datos de triage, no `select *` de mensajes cada cinco segundos.

**Aplicado 2026-08-12:** `20260812170131_inbox_active_summary.sql` está en `crm-dev`, con `inbox_recent_messages(...)` (`security invoker`), grants mínimos e índice `(lead_session_id, created_at DESC)`. El repositorio pide únicamente seis columnas y hasta 50 mensajes por sesión; los tests fijan cinco consultas en dos oleadas con 20 y 60 leads. Sigue pendiente ejecutarla con la sesión autenticada del admin y medir `EXPLAIN (ANALYZE, BUFFERS)` sobre el volumen disponible. Sin datos representativos no se afirma rendimiento a escala.

**Para medirlo hace falta `npm run build`**, porque en dev todo está instrumentado y los números no significan nada. Y **no se puede buildear con el dev server vivo: corrompe `.next/`** y el navegador queda colgado con skeletons de `loading.tsx` en rutas que nadie tocó. Matar el árbol de procesos y borrar `.next` antes de buildear.

### 7. Filtrar por más de una etiqueta

`LeadsListInput.etiquetaId` y `BusquedaInput.etiquetaId` son un `UUID` suelto, no un array (`src/server/services/leads/leads.service.ts:16`, `src/server/services/busqueda/busqueda.service.ts:18`). La UI ofrece elegir una sola porque el service no sabe hacer más. Pasar a `etiquetaIds: UUID[]` con intersección toca service, schema Zod, el parser de la URL en `src/lib/ui/filtros-leads.ts` y los dos componentes de filtros.

### 8. `leads.list()` topea en 1000 filas

`LIST_LIMIT = 1000` en `src/server/services/leads/default-leads.service.ts:23`. Dos consecuencias, y la segunda es la que muerde: **las listas de opciones de los filtros salen de esas mismas 1000 filas.** Un vehículo que solo aparece en el lead 1001 no es ofrecible como filtro, así que el usuario no puede llegar a él ni sabe que existe. A ~5K leads/mes se cruza el umbral el primer mes.

### 9. El índice trigram no se verificó bajo volumen

`20260811160000_mensajes_contenido_trgm` crea un GIN sobre `mensajes.contenido`. Está bien razonado y con 3 mensajes en la base no prueba nada: no se sabe si el planner lo elige, ni cuánto cuesta el insert de cada mensaje con el índice puesto. Verificarlo pide volumen sintético y `explain analyze`.

### 10. Recordatorios: cancelación durable aplicada

`recordatorio-seguimiento.ts` conserva `sleepUntil`, pero ahora tiene `cancelOn` sobre `lead-session/recordatorio.cancelado`, comparando **ID y fecha anterior**. Reprogramar, cancelar manualmente o recibir respuesta del cliente emite la cancelación concreta; la ejecución nueva no coincide. La comparación de fecha en Postgres permanece como segunda barrera ante carreras entre steps. Pendiente de la próxima sesión: observar una ejecución real en el dashboard local de Inngest.

### 11. Ideas de Inbox sin decidir

El dueño no se pronunció sobre **notas internas** (comentarios en la conversación que el cliente no ve) ni **respuestas rápidas** (el botón `bolt` del composer, que el handoff maqueta y hoy no hace nada). Las dos son features, no deuda: no empezar sin que las pida.

---

## Datos viejos sin arreglo posible

**No son bugs. No hay nada que reparar: la información no se guardó y no se puede reconstruir.** Documentarlos como límites de lectura, y que ninguna pantalla los presente como ceros.

- **`tool_executions.mensaje_id` en `null`** en todas las filas anteriores al fix. El agente ahora la carga, pero lo escrito entre Slice 1 y ese arreglo se queda así. La auditoría por turno las ata **por ventana temporal** en vez de por id (`listBySessionEntre`); funciona, y es una aproximación.
- **Salientes de fuera de horario previos sin la marca.** `mensajes.metadata.plantilla` distingue lo que contestó la plantilla fija de lo que contestó el agente. Los salientes anteriores a esa marca caen en `sin_medicion`, y **eso es correcto**: de esos efectivamente no se sabe.
- **Sesiones cerradas sin motivo de pérdida.** `motivo_perdida` es obligatorio desde el cierre nuevo, pero las sesiones viejas lo tienen en `null` y las métricas las agrupan bajo `sin_motivo`.

---

## ⚠️ Footguns de entorno

**1. `npm run test:integration` está congelado.** La guarda nueva corta si tests y app comparten URL, pero no correrlo hasta disponer de un proyecto aislado y confirmar que la guarda dispara en ese entorno.

> Excepción: `tests/integration/agente-config.supabase.test.ts` NO llama a `cleanupTestDb`. Limpia solo `agente_config` y restaura la config activa al terminar.

**2. `npm run build` con el dev server levantado corrompe `.next/`.** El navegador queda colgado con skeletons de `loading.tsx` en rutas no relacionadas. Se arregla matando el árbol de procesos y borrando `.next`.

**3. `deleteUser` de Supabase Auth no cascadea a `public.usuarios`.** Verificado el 2026-08-09: borrar de `auth.users` deja huérfana la fila que creó el trigger. Todo test que cree usuarios borra de las dos tablas.

**4. El panel del navegador puede no componer frames.** Con `document.hidden`, React no revela los boundaries de Suspense y `/inbox/[leadId]` se queda clavado en el skeleton para siempre. **No es `.next/` corrupto.** Se mide igual pidiendo el HTML del server por `fetch` e inyectando la raíz en el slot del panel con el CSS real.

**5. Con un agente trabajando en el árbol, `git add` va con rutas explícitas.** `-A` se lleva archivos ajenos a medio escribir y el hook `pre-commit` typechequea todo el proyecto y frena el commit.

**6. `core.autocrlf=true` + `endOfLine: lf`.** Resuelto con `.gitattributes` (`a458811`).

---

## Comandos útiles

```powershell
npm run dev              # puerto 3001
npm run inngest:dev      # dev server Inngest (ya lleva -u al puerto 3001)
npx --yes cloudflared tunnel --url http://localhost:3001   # túnel público
npm run ci               # typecheck + lint + format + coverage
npm test                 # solo unit; si npm global falla, usar node node_modules\vitest\vitest.mjs run
supabase migration list --linked
# npm run test:integration  ⛔ NO CORRER: no existe una base aislada
```

---

## Conexión Supabase

- Proyecto `crm-dev`, ref `emubzkouwvuzlrtsgorx`, Postgres 17, plan Free.
- **38 migraciones aplicadas**, la última `20260813172558`.
- ⚠️ Free tier auto-pausa tras ~1 semana idle: el DNS deja de resolver y `/api/health` da `db: fail`. Se restaura desde el dashboard.
- **Falta un segundo proyecto para tests.** Ver bloqueante 1.
- Remoto: `https://github.com/Leonardo-A1varez/crm.git` (privado). Verificar `git rev-list --count origin/master..HEAD` al retomar.

---

## Lo que sigue faltando de antes

- **Catálogo vacío.** `productos` en 0: el agente llama a `buscar_repuesto`, recibe cero resultados y responde "no lo tenemos" siempre. `empresas` también en 0, con el schema declarando single-org. **Esto impide que el producto haga lo que promete** — es independiente de todo lo demás y se resuelve cargando datos.
- **Túnel cloudflared efímero.** Al reiniciarlo cambia la URL y hay que reconfigurar el webhook en Meta. El deploy a Vercel lo resuelve.
- **Sentry sin cuenta.** Está cableado y env-gated; sin DSN no reporta.
- **Número real de WhatsApp** para el soft launch: el de prueba solo mensajea a 5 destinatarios verificados.
- **E2E real de WhatsApp sobre la config del agente**: cambiar el tono a formal desde `/agente`, mandar un mensaje real y verificar que trate de usted. Nunca se hizo; la CI no lo cubre.
- **`/ajustes` sigue siendo un `PantallaPendiente`.** Es la única de las 7 del panel sin construir, y el handoff nunca la diseñó (`README §Pendientes de diseño`): no hay contra qué compararla. Antes de construirla hay que definir qué va adentro.

---

## Prompt de arranque — copiar y pegar

```text
Repo: C:\Users\Tinki\Proyectos\crm. Rama master. El checkpoint QA y el cierre
de brechas de auditoría quedaron implementados y documentados el 2026-08-13.

Leé primero, en este orden:
1. AGENTS.md completo — reglas de oro, estado y lecciones de proceso.
2. docs/next-session.md (este archivo) — bloqueantes y prioridades.
3. docs/implementation-qa-2026-08-12.md — corte exacto implementado y pendientes.
4. docs/handoff-rediseno-README.md — spec visual/producto.

Estado del repo:
- Consultá AGENTS.md para el conteo exacto del último CI.
- 38 migraciones aplicadas a crm-dev.
- `20260812170131` recupera/acota Inbox; `20260812222808` agrega handoff,
  timestamps Meta, template de aviso y perfil de lead nullable.
- `20260813163957` ejecuta el merge administrativo dentro de una transacción
  Postgres; no volver a introducir NoopSessionLock en ese camino.
- `20260813172558` conserva esa RPC y elimina la variable muerta señalada por
  `db lint`; lint remoto limpio.
- Primera acción: revisar `git status`, `git log --oneline -15` y migraciones.

Lo que NO está verificado, y quiero que lo trates como no verificado:
- Los integration tests NO corren: SUPABASE_TEST_URL apunta al mismo proyecto
  Supabase que la app. El guard agregado el 2026-08-13 ahora aborta antes de
  cualquier escritura; la suite sigue congelada hasta disponer de una base
  aislada. Hay contract tests de varios repos que nunca tocaron Postgres real.
- `approve_lead_merge` tuvo smoke admin no destructivo; `inbox_recent_messages`
  y `transition_handoff` todavía no.
- Los tipos se contrastaron contra el schema remoto después del push. La firma
  coincide; se conservó nulabilidad explícita en el resultado porque la RPC usa
  `null` para las salidas de error y el generador no lo infiere.
- No se corrió EXPLAIN ni hay volumen representativo: el coste constante está
  probado en unitarias, no el rendimiento a escala.
- Las pantallas del checkpoint no se revisaron visualmente en los tres viewports.
- El desglose de motivos de escalado viaja en el contrato de métricas, pero aún
  no tiene una ubicación final visible.

Panel: admin-dev@crm.local / dev-admin-2026!
Arrancar: npm run dev (puerto 3001). El backend lo levanto yo.

NO corras npm run test:integration (borra la base de dev).
NO corras npm run build con el dev server vivo (corrompe .next/).

Lo más valioso por hacer, en orden:

1. Leer `docs/research/meta-api-capabilities-2026-08.md` y elegir 1–3
   capacidades. No implementar antes de esa decisión.
2. Para las capacidades elegidas, verificar activo/país/permisos y redactar un
   plan técnico separado con estructura de archivos, contratos y tests.
3. Verificar `inbox_recent_messages` y `transition_handoff` con la sesión
   autenticada del admin. No enviar mensajes reales por Meta.
4. Ejecutar EXPLAIN (ANALYZE, BUFFERS) sobre datos disponibles, sin extrapolar.
5. Revisar visualmente /leads, detalle/edición, /metricas, /agente, /tags,
   /inbox, detalle, handoff y reprogramación en 1440x900, 1024x768 y login móvil.
6. Crear un proyecto Supabase aparte para tests cuando yo lo autorice/cree.

Antes de escribir código, decime qué vas a hacer, qué no, y esperá que
confirme.
```
