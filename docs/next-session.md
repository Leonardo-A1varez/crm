# Próxima sesión: cerrar workflows y difusión, y desplegarlos

> **Este documento NO define cómo se trabaja. Eso lo define `AGENTS.md`, que rige el 100% del tiempo.**
>
> Acá solo se dice **dónde** está puesto el foco y qué quedó abierto. Si algo de este archivo pareciera permitir saltarse una regla de `AGENTS.md` —la validación funcional antes que la UI, el paso a paso, la honestidad sobre lo que no se verificó, los skills obligatorios— **el que está mal es este archivo**.
>
> Acotar el foco limita el alcance, nunca el rigor.

Escrito el 2026-09-26. Todo lo que dice "verificado" tiene al lado el comando o la fuente; el resto está marcado como pendiente o sin verificar.

---

## 1. Estado de la rama

| Qué                       | Estado                                                              | Cómo comprobarlo                                                    |
| ------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `feat/workflows-difusion` | 13 commits sobre `master`, **no existe en el remoto**               | `git log --oneline master..HEAD` · `git ls-remote --heads origin`   |
| `master` local            | 27 commits sin pushear sobre `origin/master` (`91de606`)            | `git log --oneline origin/master..master`                           |
| Migraciones               | 88 archivos, las 88 aplicadas en crm-dev                            | `ls supabase/migrations/*.sql \| wc -l` · `supabase migration list` |
| Código en Vercel          | **No desplegado.** Producción corre lo que había en `origin/master` | —                                                                   |

**Falta:** push de `master`, push de la rama y PR contra `master`. Antes del PR, semgrep sobre los archivos tocados (CLAUDE.md global). El PR es grande: conviene que el cuerpo remita a `AGENTS.md` §2 en lugar de repetir la lista.

### Orden del deploy

1. **`db:push` a crm-dev: ya está hecho.** El ledger remoto tiene las 88 y la última es `20260926180000_turnos_interceptados_y_notificaciones`. Antes de cualquier push nuevo, `AGENTS.md` lección 16: frenar a los agentes, `supabase db push --dry-run` y comparar.
2. **Variables en Vercel** (sección 3), antes de que entre el código.
3. **Recién ahí, el código.** Al revés, el código nuevo corre contra columnas y RPC que no existen.

### Copiloto del Inbox: la migración va ANTES del código

`supabase/migrations/20260930120000_copiloto.sql` (tabla `borradores_ia`, RPC `iniciar_borrador_ia`, `conversaciones.modo_respuesta_override`, `agente_config.horario_equipo`) está aplicada **solo en el stack local**, no en crm-dev. Con el código desplegado y la migración sin aplicar:

- `invalidar-borrador-previo` falla en cada entrante. Con el código actual solo se avisa (`borrador.invalidar_previo_fallo`) y el turno sigue si el modo no es Copiloto, pero la lista del Inbox pierde la marca de borrador y **guardar en `/agente` falla** (la columna `horario_equipo` no existe). No es un estado para dejar a propósito.
- **Si un push a `master` despliega solo (Vercel), la migración se aplica antes del push**, no después.

Pasos (lección 16 de `AGENTS.md`): (1) frenar a cualquier agente que pueda estar escribiendo migraciones; (2) `supabase db push --dry-run` y comparar la lista con `ls supabase/migrations/*.sql`; (3) recién ahí `npm run db:push`; (4) `supabase migration list` con local = remoto; (5) después el push del código.

**Requisitos operativos antes de encender el copiloto en crm-dev** (hoy no se cumplen y no están automatizados):

- [ ] Corregir `horario_timezone` a `America/Guayaquil` en la config activa del agente (el horario del equipo se evalúa en esa zona; con una zona inválida el equipo cuenta como cerrado y el modo cae a Automático).
- [ ] Subir `escalar_umbral_intents` a 5 (el de fábrica es 2; requisito de la revisión final de rama del copiloto).
- [ ] Cargar el `horario_equipo` real desde `/agente` → Límites. Vacío = sin equipo = el comportamiento de siempre (Automático).

---

## 2. Qué falta del diseño

La auditoría contra `Workflows y Difusion.dc.html` (2026-09-25) contó 37 faltantes. Las tandas posteriores cerraron casi todos: Importar, ícono del disparador, errores sobre el nodo con arreglos, atajos, chips de variables, vista previa contra un lead real, campos vivos y contador en la condición, cancelar corrida, mensajes y corridas por nodo, intentos, Difusión respondida, prueba a mi número, avance y canary en el envío, exclusiones por motivo, rol por número y Delegar al agente.

**Siguen abiertos:**

- **Bloques que no corren:** Clasificar, Extraer, Sentimiento, Spam y Enviar documento. Los 5 bloques de Difusión existen en la paleta pero quedan "no disponibles", porque el motor corre un flujo por lead y esos operan sobre un grupo.
- **"Faltan N días para subir de nivel":** no se puede calcular. Meta pide haber usado al menos la mitad del límite en 7 días; es una condición, no una cuenta de días, y la API no expone el uso del portfolio. Queda vacío a propósito.
- **Columna "resp." del listado de Difusiones:** sin tocar. Hace falta una RPC para no caer en N+1.
- **Aviso de sanción de Meta:** está en `/difusion` y en Ajustes, pero **no** en `/difusion/nueva` ni en `/difusion/[id]`.

**Del QA visual quedaron sin arreglar** (los números son de ese QA, medidos con el panel oculto):

- C3: una corrida `esperando` mostraba el nodo "Detener" como "Ejecutando".
- C4: la corrida cancelada no muestra el motivo, que sí está en `workflow_runs.error`.
- D3: el diff de publicación tiene un párrafo que le habla al equipo, no al usuario.
- E2: la paleta corta con elipsis los nombres largos de los bloques.
- E7: las conexiones tienen `aria-label` en inglés y con ids internos, y los nodos no tienen `aria-label`.
- E11: los avisos de error del lienzo quedan debajo de la barra de zoom.
- T1: `/difusion`, `/difusion/[id]` y `/ajustes` no tienen `loading.tsx` (`find "src/app/(panel)" -name loading.tsx`).

**Nunca se miró:**

- La **comparación visual humana** de ninguna pantalla nueva.
- Los pasos 2 y 3 del asistente de difusión, porque avanzar escribe en la base.
- Una difusión «enviando» con el botón Detener.
- El Realtime de la campanita de avisos en vivo.
- El diff y la corrida con el `colorMode` nuevo.
- El bloque CSS de React Flow sin inyectarlo a mano: el dev server no recompiló `globals.css`.

---

## 3. Pendientes del dueño

- [ ] **Suscribir `account_update` en Meta.** Sin eso, la escalera de sanciones de Ajustes no recibe eventos reales. Solo se probó con un webhook firmado a mano contra el stack local.
- [ ] **Cargar `DIFUSION_BAJAS_HMAC_CLAVES` y `DIFUSION_BAJAS_HMAC_VERSION_ACTIVA` en `.env.local` y en Vercel antes del deploy.** Sin ellas, las bajas de difusión no se pueden registrar ni consultar (`src/server/repositories/difusion-supresiones.hash.ts`). Van las dos juntas; con una sola, `env.ts` rechaza el arranque. El formato está en `.env.local.example` y la rotación en `docs/runbooks/secrets-rotation.md`.
- [ ] **Agregar `META_GRAPH_API_BASE_URL` a `.env.local.example`** como opcional, con default `https://graph.facebook.com`. Un hook bloquea que un agente edite ese archivo («contiene secretos»).
- [ ] **Puertos de Inngest local expuestos.** `inngest:local` bindea la API (8298) a `127.0.0.1`, pero el gateway de Connect (8299) y sus gRPC (50062/50063) quedan en todas las interfaces: el CLI 1.45.1 no tiene flag para eso. Si la red no es de confianza, hay que bloquearlos con el firewall de Windows. Es decisión del dueño; ningún agente toca el firewall.
- [ ] **Confirmar las decisiones pendientes** de «Delegar al agente» y del auto-handoff: tabla en `docs/prd-workflows.md` §16, la misma que `docs/prd-workflows-difusion.md` §15.

---

## 4. Hallazgos abiertos

Formato de `AGENTS.md` §0.4: observación → causa → fix. Ninguno se arregló.

| #   | Observación                                                                  | Causa (leída en el código)                                                                                                                                                                                                                               | Fix propuesto                                                                                                                                                                                                                                                                |
| --- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **`difusion_envios.telefono` guarda el teléfono en claro.**                  | La migración `20260925040000` pasó a HMAC solo `difusion_supresiones`; su encabezado dice que no toca `difusion_envios.telefono` ni `programar_difusion()`.                                                                                              | Decidir si el envío necesita el teléfono después de mandar (reintentos, estados). Si no, borrarlo al cerrar la difusión o guardar solo el hash. Es PII bajo las leyes de §0.9.                                                                                               |
| 2   | **El tope de gasto diario del agente no se aplica.**                         | `CostTracker.exceedsCap` no tiene ningún llamador fuera de su definición (`grep -rn exceedsCap src`). Solo «Delegar al agente» respeta `tope_gasto_diario_usd`; el pipeline no.                                                                          | Consultar el tope antes de cada llamada LLM del pipeline y decidir qué pasa al superarlo (política de kill switch de `agente_config`). Choca con la decisión del dueño de no usar Upstash: con el tracker en memoria, en serverless el tope no se comparte entre instancias. |
| 3   | **Inbox, Twin y Métricas muestran horas en la zona del navegador.**          | `format(…, "HH:mm")` de date-fns sin zona en `MessageBubble.tsx`, `AuditoriaTurno.tsx`, `TwinPanel.tsx`; `Intl`/`toLocaleDateString` sin `timeZone` en `IntentsSinRegla.tsx` y `GestionCampanias.tsx`. Workflows ya usa la zona del negocio (`f760483`). | Reusar el helper de zona del negocio de workflows en esas pantallas. Leads: no encontré el formateo de horas en `src/components/leads`; falta ubicarlo.                                                                                                                      |
| 4   | **Inputs sin foco visible en Inbox, Leads y Twin.**                          | Reportado por el pulido del 2026-09-26, fuera de su alcance. No lo medí.                                                                                                                                                                                 | Mismo patrón que se aplicó en Workflows: `focus-visible:outline-solid`, o anillo en el contenedor con `has-[input:focus-visible]`.                                                                                                                                           |
| 5   | **La línea de «Ir a» no se dibuja en el lienzo.**                            | El salto vive en la config del nodo, no en `grafo.aristas`. `aristasDeSalto`, que lo traduce a arista, solo lo usan el validador, el ejecutor y `pasos.ts` (historial); ningún componente del lienzo. Leído en el código, no mirado en el navegador.     | Dibujar una arista punteada, no editable, desde el nodo «Ir a» hasta su destino.                                                                                                                                                                                             |
| 6   | **La reactivación semanal podría mandar texto fuera de la ventana de 24 h.** | `src/inngest/callbacks/send-reactivation.ts` manda con `metaApi.sendOutbound` (texto libre) a leads perdidos, que por definición suelen tener la ventana cerrada. Meta solo acepta plantillas fuera de la ventana. No se probó contra Meta.              | Mandar plantilla cuando la ventana esté cerrada, igual que hace «Reactivar perdidos» de workflows con `workflow_plantillas_sin_sesion`.                                                                                                                                      |
| 7   | **El detector de duplicados puede no ver el mismo teléfono con y sin `+`.**  | `leads_que_comparten_identificador` compara `valor` exacto (migración `20260814250000`). No verifiqué cómo se normaliza el valor al escribirlo.                                                                                                          | **Tarea aparte:** normalizar a E.164 sin `+` al escribir y hacer un backfill, o comparar sobre una columna normalizada.                                                                                                                                                      |

---

## 5. Cómo levantar lo necesario

- Pantallas y flujos sin tocar crm-dev ni Meta: stack local, `docs/runbooks/como-correr-el-crm.md` §4.1.
- Integration tests: `npm run test:integration:local`. Vacía el stack local; no se corre si otro agente está haciendo E2E ahí.
- crm-dev: CLI enlazado, o lectura con `mcp__plugin_supabase_supabase__execute_sql` y `project_id` `emubzkouwvuzlrtsgorx`. **No con `mcp__supabase__*`**, que apunta a otro proyecto (`AGENTS.md` lección 15).

---

## Deuda que sigue de antes

- **El catálogo está vacío a propósito**, esperando el documento de siglas del dueño. Sin catálogo, el agente no vende y una difusión de repuestos no tiene qué ofrecer.
- **Productos** necesita el filtrado y los parámetros de cuánta información se procesa. Está bloqueada por lo anterior.
- **Métricas** se trabajó en `master` (ventas, rango libre, campañas), pero no hay registro de cierre.
- **`revert_lead_merge` nunca se ejecutó.**
- **Sin `EXPLAIN` con volumen representativo.**
