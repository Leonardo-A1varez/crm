# Workflows Unificado — Spec de Diseño

> Reemplaza el enfoque de `docs/superpowers/specs/2026-08-26-workflows-pro-design.md` (canvas visual estilo n8n, 57 tipos de nodo). Ese documento queda como registro histórico de por qué se descartó ese camino — no se borra, no se sigue.

## 0. Por qué este documento reemplaza al anterior

La sesión del 2026-08-26 construyó un canvas visual de arrastrar-y-conectar con 57 tipos de nodo, calcado del estilo n8n. Funcionaba (typecheck limpio, 2213 tests en verde, un flujo simple se pudo armar, guardar y probar de punta a punta), pero el enfoque en sí era el problema: n8n resuelve "motor de integración genérico para cualquier API", y este CRM tiene 3-4 usuarios no técnicos automatizando la venta de repuestos por WhatsApp — un problema mucho más chico y específico que un canvas de 57 nodos abstractos no resuelve mejor, solo más caro.

**Investigación que sustenta el cambio** (n8n, Kommo Salesbot, ManyChat, Intercom Workflows+Fin, Make, Zapier — detalle completo en el hilo de la sesión que originó este spec):

- La queja #1, más citada y específica contra n8n en reviews reales: expresiones JS/JSON como mecanismo primario de lógica, y un catálogo de ~400 tipos de nodo que exige conocimiento previo de APIs. Exactamente lo que un vendedor de repuestos no tiene ni necesita.
- Kommo separa el bot determinístico de la IA generativa como dos productos que no se hablan entre sí — el anti-patrón que este CRM ya evita al tener el agente vendedor y el Lead Twin como piezas centrales, no accesorios.
- ManyChat integra IA pero solo como productor de una variable que el flujo lee después — nunca le cede una rama completa de la conversación. Este CRM ya tiene algo mejor (el agente vendedor real) y el motor nuevo debe explotarlo, no aplanarlo al nivel de ManyChat.
- Intercom (`Let Fin handle` + Procedures) es el patrón más cercano a lo que hace falta: la IA puede tomar control de un tramo de la conversación. Pero tiene una falla documentada — el retorno de control es asimétrico y a veces no vuelve. La lección: todo punto de cesión de control necesita una condición de retorno explícita definida al diseñar el paso, nunca implícita.
- Make es el más fuerte en fiabilidad de producción: debug paso a paso real (no solo la última corrida), 5 directivas de manejo de error con rollback como default, y una cola de "Incomplete Executions" resumible desde el paso que falló — no desde cero.
- Zapier separa draft de published de verdad (editar no toca lo que ya corre) pero su "Replay entire Zap" re-ejecuta también los pasos ya exitosos — antipatrón explícito: en este dominio eso significa volver a mandar el mismo WhatsApp a un lead real.

## 1. Los tres ejes, en orden de prioridad

1. **Simplicidad para vendedores no técnicos.** Nada de canvas libre, nada de expresiones de código, nada de catálogo abierto de integraciones genéricas.
2. **La IA (agente vendedor + Lead Twin) como ciudadana de primera clase del motor**, no un nodo más — el motor orquesta al agente, no compite con él.
3. **Fiabilidad de nivel producción** — esto mueve WhatsApps reales a leads reales; un flujo mal armado o un replay ingenuo cuestan plata y confianza.

## 2. Qué se conserva del trabajo del 2026-08-26, qué se tira

**Se conserva casi intacto** — es capa de motor puro, agnóstica de si el grafo lo dibujó un canvas o lo generó un editor de lista:

- El modelo `Grafo { nodos, aristas }` y los tipos en `src/types/workflows.ts`.
- El motor de ejecución completo: `interpolador-variables.ts`, `evaluador-condicion.ts`, `ejecutar-paso.ts` (reintentos + timeout por nodo), `contexto-ejecucion.ts`, `ejecutar-workflow.ts` (incluye el fix de esta sesión: `encontrarTrigger`/nodo final reconocen el catálogo completo vía `esTrigger`/`esCondicion`/`esEspera`/`esFinal`).
- `validar-grafo.ts`, ya corregido para reconocer ambos catálogos.
- Los repos: `workflows.repo.ts`, `workflow-runs.repo.ts` — este último ya diseñado para segmentos con CAS (`tomarSegmento`, `fallarSiVivo`), pensando en Inngest desde antes de que existiera el wiring.
- `WorkflowsAdminService.probar()` + `probarWorkflowAction` + `ProbarDialog` — el ciclo completo de "Probar" armado hoy no depende de cómo se edite el grafo, solo de que exista uno y un lead.
- `PublishDialog`, `VersionBadge`, `VersionHistory`, `VersionSelector` — no dependen del canvas.
- Los formularios `canvas/config/*.tsx` (ConfigCRM, ConfigMensajeria, ConfigLogica, etc.) — se podan de 57 a ~10 tipos, no se reescriben desde cero.
- `PanelHistorial`/`RunDetail`/`TimelineEjecucion` — reusables, pero definen su propio modelo de datos en español (`iniciado_en`, `nodo_nombre`, `duracion_ms` por paso) que no coincide con lo que el repo real persiste. Se corrige al integrarlos, no se reescriben.

**Se tira sin reemplazo directo**: `CanvasWorkflow.tsx`, `PaletaNodos.tsx`, `CategoriaColapsable.tsx`, `NodoDraggable.tsx`, los 7 componentes `Nodo*.tsx` por categoría, `PanelConfigNodo.tsx` (el panel lateral desaparece, la config pasa a inline por card en el editor de lista).

## 3. Modelo conceptual

- **Plantilla**: definida en código, no en DB, no editable por el usuario — el catálogo curado de qué automatizaciones existen. Nombre, categoría, trigger fijo, formulario de parámetros.
- **Workflow**: la fila en DB de siempre — instancia de una plantilla con sus parámetros llenos y su secuencia de pasos, editable dentro de lo que la plantilla permite. Mismo modelo de versiones (draft/publicada) que ya existe.
- **Paso**: la unidad de la secuencia editable. Internamente sigue siendo un `Nodo` del grafo — la UI nunca deja uno "flotando": cada paso tiene un lugar fijo en el orden, y una condición genera sus dos ramas automáticamente en vez de que el usuario dibuje aristas.
- **Run**: sin cambios — `workflow_runs` + `workflow_run_pasos`.

## 4. Catálogo cerrado de pasos (10, no 57)

| Paso                                                                         | Reemplaza / cubre               |
| ---------------------------------------------------------------------------- | ------------------------------- |
| Enviar mensaje                                                               | ya existe (`enviar_mensaje`)    |
| Esperar (tiempo)                                                             | ya existe                       |
| Condición (campo del Lead Twin, operador fijo, valor)                        | motor de reglas IF/THEN pre-LLM |
| Etiquetar (`modo: "agregar" \| "quitar"`)                                    | `reglas_etiqueta`               |
| Cambiar etapa                                                                | ya existe                       |
| Escalar a humano (con `reason_code`, los 8 ya definidos en `handoff_events`) | `auto-handoff`                  |
| Asignar vendedor (fijo o round robin)                                        | nuevo                           |
| Delegar al agente IA                                                         | nuevo — ver §5                  |
| Notificar vendedor (interno)                                                 | nuevo                           |
| Detener                                                                      | ya existe                       |

Triggers (no son pasos): mensaje recibido, etiqueta asignada/removida, etapa cambiada, programado (cron), inactividad, lead creado, manual.

Nada de HTTP genérico, código JS, Sheets, DB externa — sin caso de uso real en este negocio hoy. Si aparece uno, se agrega como paso curado nuevo; no se reabre un catálogo genérico.

Un trigger tiene una propiedad no negociable, heredada de la decisión de diseño de etiquetas (sesión 2026-08-16): `intercepta_llm: boolean`. Las plantillas que **responden** (ganan una, cortan el LLM ese turno) y las que **etiquetan** (corren todas las que matcheen, no cortan nada) tienen semánticas opuestas y no se modelan con la misma regla de "gana una".

## 5. El paso de delegación a IA

```
config:
  instrucciones_adicionales?: string      // se suma al prompt base del agente para ese tramo

  // Corta antes si el contenido de la conversación lo resuelve. Opcional:
  // sin esto, el paso solo depende del timeout de resguardo.
  condicion_contenido?:
    | { tipo: "intent_detectado", intents: string[] }
    | { tipo: "campo_twin", campo, operador, valor }      // mismos operadores que el paso Condición
  al_retornar_por_contenido: "continuar" | "escalar_humano"

  // SIEMPRE presente, nunca opcional: nada de este motor deja una corrida
  // esperando indefinidamente. Default 1440 (24h) si no se toca.
  timeout_minutos: number
  al_retornar_por_timeout: "continuar" | "escalar_humano"
```

Mientras este paso está activo, el agente vendedor de siempre sigue respondiendo cada mensaje — el workflow no lo reemplaza, solo lo observa. El paso no ejecuta nada activo: devuelve `esperar: { tipo: "evento" }`, el mismo mecanismo ya construido para `logica_esperar_evento`. El evento que lo despierta es "se cumplió `condicion_contenido`", evaluado en cada turno por el pipeline que ya corre hoy (`on-message-received` ya clasifica intent y actualiza el Twin en cada mensaje) — o, si nadie la cumple antes, el timeout de resguardo.

El timeout no es una alternativa entre varias opciones de retorno — es el piso obligatorio de todo paso de delegación, con o sin `condicion_contenido` configurada. Así se cierra la falla documentada de Intercom (Fin escala desde una Procedure y el retorno a veces no vuelve): acá no hay forma de dejar un tramo sin un destino final definido al diseñar el paso.

## 6. Plantillas de arranque

| Plantilla                   | Trigger              | Pasos                                                                                                                | Reemplaza                         |
| --------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| Responder automático        | Mensaje recibido     | Condición (intent) → Enviar mensaje → Detener                                                                        | Reglas IF/THEN — corta el LLM     |
| Etiquetar automáticamente   | Mensaje recibido     | Condición (intent/Twin) → Etiquetar                                                                                  | `reglas_etiqueta` — no corta nada |
| Escalar a humano            | Mensaje recibido     | Condición (N intents desconocidos / palabra sensible / límite) → Escalar → Notificar vendedor                        | `auto-handoff`                    |
| Reactivación de perdidos    | Programado (semanal) | Condición (motivo_perdida + cooldown) → Enviar plantilla HSM → Etiquetar                                             | `reactivation-predictor.cron`     |
| Bienvenida + agente         | Lead creado          | Enviar bienvenida → Delegar a IA (retorno: intent=consulta_producto \| timeout 24h→escalar)                          | — nueva                           |
| Seguimiento post-cotización | Etapa → cotización   | Esperar 2d → Condición (sigue en cotización) → Enviar seguimiento → Esperar 3d → Condición → Escalar si no respondió | — nueva                           |

## 7. El editor — lista vertical, no canvas

- **Listado `/workflows`**: sin cambios estructurales. El modal "Nuevo workflow" abre directo en la galería de las 6 plantillas; "empezar en blanco" queda como opción secundaria para el admin avanzado, nunca la opción por defecto.
- **Header del editor**: nombre + trigger heredado de la plantilla (solo sus parámetros son editables, el tipo de trigger no cambia a mitad de camino).
- **Cuerpo**: pasos como cards apiladas (ícono + resumen legible, ej. `Enviar mensaje: "Hola {{lead.nombre}}..."`), reordenables con ↑↓ — sin drag-and-drop, innecesario con secuencias de 5-10 pasos.
- Un paso **Condición** se abre en dos sub-listas indentadas ("Si"/"No"), cada una con sus propios pasos — recursivo. El orden de la lista es la conexión; nadie dibuja una arista a mano.
- Cada card se expande inline para editar su config — sin panel lateral aparte.
- Toolbar sin cambios: Guardar / Probar / Publicar.

## 8. Fiabilidad

Ya resuelto en el modelo de datos actual, sin tocar nada:

- **Draft/publish real**: `WorkflowRun.workflow_version_id` ya es inmutable — publicar una versión nueva no mueve las corridas en curso.
- **Reintento por paso, nunca por flujo entero**: `ejecutar-paso.ts` ya reintenta por nodo con backoff; `reanudarWorkflow` ya reanuda siempre desde `nodoActual` guardado, jamás desde el trigger.
- **Protección equivalente a idempotency-key**: `tomarSegmento`/`fallarSiVivo` en el repo ya hacen CAS por `pasos_ejecutados` — cuando se cablee Inngest (§9, Paso 0), cada `step.run()` solo necesita ese runId+paso como idempotency-key.

Falta construir (patrón Make — cola de fallidas revisable):

- Filtro "Fallidas" en el historial — `obtenerHistorialWorkflowAction` ya acepta `estado` como filtro, falta exponerlo como atajo en la UI.
- Acción "Reintentar desde el paso que falló" — el schema `ReejecutarDesdeErrorSchema` (runId + nodoId) ya existe sin Server Action ni UI. Se cablea llamando a `reanudarWorkflow`, que ya existe.

## 9. Plan de migración incremental

**Paso 0 (fundación técnica, una sola vez, antes de migrar nada)**: función `workflow-segmento` de Inngest que ejecuta un tramo del motor usando el CAS existente (`tomarSegmento`) con idempotency-key `workflow-segmento-${runId}-${pasosEjecutados}`, más un dispatcher que, ante cada evento relevante, encuentra los workflows activos con ese trigger y arranca o despierta su corrida. Se construye y verifica contra un workflow de prueba, no contra ninguno de los 4 sistemas reales.

**Orden, de menor a mayor riesgo:**

1. **Etiquetado automático** — no contesta, no corta el LLM; el peor caso de un bug es una etiqueta de más. Ya validado una vez con datos reales (2026-08-16).
2. **Reactivación de perdidos** — cron, no compite con conversaciones en curso, auditable en aislamiento.
3. **Escalado a humano** — hot-path pero lógica acotada (condición → escalar).
4. **Reglas de respuesta automática** — mayor riesgo (compite con el LLM en cada mensaje); sin urgencia porque hoy `crm-dev` tiene 0 reglas activas.

Cada migración: la plantilla nueva corre en paralelo al sistema viejo → se dispara al menos una vez contra el pipeline real (Inngest dev + Postgres) → se verifica el resultado → se apaga el sistema viejo con período de gracia, no borrado inmediato. Cada migración es su propia sesión con su propio plan de implementación — no se agrupan.

## 10. Testing

- El motor de ejecución y `validar-grafo.ts` siguen el mismo patrón TDD ya aplicado hoy: casos reales primero (RED), fix mínimo (GREEN) — ver `tests/unit/workflows/engine/` y `tests/unit/workflows/validar-grafo.test.ts` como referencia de estilo.
- Cada plantilla nueva necesita al menos un test de integración del motor que la ejecute de punta a punta con fixtures reales (igual que `GRAFO_PROBAR_SIMPLE`/`GRAFO_PROBAR_CON_ESPERA` en `tests/unit/workflows-admin-service.test.ts`).
- El paso de delegación a IA necesita un test específico del mecanismo de espera/reanudación por evento (`logica_esperar_evento`), verificando tanto el retorno por `condicion_contenido` como el retorno por `timeout_minutos` cuando nadie la cumple antes.
- Cada migración (§9) se verifica contra Postgres real antes de apagar el sistema viejo — no alcanza con tests unitarios, mismo criterio que ya rige el resto del proyecto (AGENTS.md §0.5).

## 11. Criterios de aceptación

- [ ] Las 6 plantillas de §6 existen, cada una arranca desde un formulario de parámetros, no desde un canvas vacío.
- [ ] El editor de lista permite armar y reordenar una secuencia de hasta 10 pasos sin necesitar arrastrar ni conectar nada a mano.
- [ ] Un paso Condición genera sus dos ramas automáticamente y cada rama es una sub-lista editable.
- [ ] El paso "Delegar a IA" exige `timeout_minutos` + `al_retornar_por_timeout` al guardarse — no se puede dejar un tramo delegado sin destino final definido.
- [ ] "Probar" (ya cableado) sigue funcionando contra el nuevo editor sin cambios en el motor.
- [ ] El filtro "Fallidas" del historial y "Reintentar desde el paso que falló" funcionan contra una corrida real fallada.
- [ ] Cada uno de los 4 sistemas migra según el orden y el criterio de §9, verificado contra Postgres real antes de apagar el sistema viejo.
