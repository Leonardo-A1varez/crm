# Correcciones QA, flujos y métricas reales

> Estado: **checkpoint implementado; QA visual pendiente**. El trabajo se detuvo por decisión del dueño para continuar en otra sesión. No confundir este corte con cierre total del plan.

## Corte real al pausar

Completado y aplicado:

- `/inbox` recuperado: RPC directa sin perder el contexto de Supabase, read model acotado e índice por sesión/fecha. Migración `20260812170131` aplicada a `crm-dev`.
- `/agente` desacoplado del agregado completo del Inbox. El preview degrada localmente sin tumbar configuración ni reglas.
- Handoff transaccional e idempotente con `handoff_events`, etapa previa restaurable, motivos sin PII y aviso durable configurable para escalados automáticos. Pausa manual silenciosa.
- Reprogramación/cancelación de recordatorios emite `lead-session/recordatorio.cancelado` por ID + fecha; `cancelOn` no alcanza la ejecución nueva y la guarda de Postgres permanece.
- Edición de perfil del lead con Zod, RLS autenticada, no-op sin escritura, auditoría de nombres de campos y teléfono/identificadores Meta de solo lectura.
- Timestamp original de Meta persistido, tiempos de primera respuesta con mediana y cobertura, y separación semántica entre sesiones sin intervención, resueltas por IA, escaladas y tomadas.
- Búsqueda GET con botón/Enter, una sola puerta de cierre, copy `Cerrar`, plurales centrales y logo eager.
- Migración `20260812222808` aplicada a `crm-dev`. Antes del push se guardaron dumps de esquema y datos en `backups/`, ignorados por Git.

Verificado al checkpoint:

- `crm-dev` registra **35/35 migraciones**.
- **1595/1595 tests** en 133 archivos, ambos typechecks, lint y formato verdes.

Pendiente para la siguiente sesión:

- Smoke de `inbox_recent_messages` y `transition_handoff` usando la sesión autenticada del admin, no service role.
- Regenerar tipos Supabase desde el schema remoto y comprobar que no exista diff semántico.
- `EXPLAIN (ANALYZE, BUFFERS)` sobre el volumen disponible, sin afirmar escala que la base no tiene.
- QA visual de las rutas y viewports acordados, incluida degradación del preview de Agente.
- Mostrar las razones de escalado como desglose visible en Métricas; el contrato y los datos ya viajan, falta decidir su ubicación final.
- Reconciliación final de cobertura y documentación después del QA visual.

## Qué entra

- Recuperar `/inbox`, `/inbox/[leadId]` y `/agente` corrigiendo el RPC de resumen y desacoplando el preview de la consola.
- Handoff administrativo transaccional, auditable e idempotente, con etapa previa restaurable y aviso neutral al cliente solo para escalados automáticos.
- Cancelación real de workflows Inngest al cancelar o reprogramar un recordatorio.
- Edición segura del perfil del lead; teléfono e identificadores Meta siguen inmutables desde UI.
- Timestamp de origen de Meta, métricas de respuesta con cobertura explícita y semántica correcta para sesiones resueltas/sin intervención/escaladas.
- Correcciones QA de búsqueda, cierre duplicado, pluralización, accesibilidad y LCP.

## Qué no entra

- Catálogo, proyecto Supabase de tests, ticket promedio sin ERP/ventas, `/ajustes`, deploy o benchmark representativo bajo carga.
- `npm run test:integration`, `npm run build`, reset/truncate de `crm-dev` o mensajes Meta reales sin autorización específica.

## Decisiones cerradas

1. Solo queda la acción de cierre en el rail del Twin; se elimina la del header.
2. Un escalado automático avisa al cliente, pausa la IA y sube la conversación a revisión administrativa. Una pausa manual es silenciosa.
3. Se persisten datos reales nuevos; filas históricas sin timestamp o motivo quedan como **sin medición**, nunca se rellenan con valores inventados.
4. Se permiten migraciones **aditivas** en `crm-dev` después de respaldo y revisión del diff. No se reconstruye la base.

## Orden y puertas de aceptación

1. Documentación y baseline del árbol sucio.
2. Inbox/RPC y aislamiento de `/agente`.
3. Handoff y recordatorios.
4. Leads y búsqueda.
5. Métricas e instrumentación.
6. Migraciones aditivas en `crm-dev` y smoke autenticado.
7. Unit tests, typecheck, lint, format check y QA visual.

No se declara completo si una de las rutas críticas sigue lanzando excepciones, si el handoff duplica eventos/mensajes, si una reprogramación puede cancelar la ejecución nueva o si las métricas presentan datos ausentes como cero.
