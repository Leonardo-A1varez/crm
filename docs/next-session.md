# Próxima sesión: cerrar workflows y difusión, y desplegarlos

> **Este documento NO define cómo se trabaja. Eso lo define `AGENTS.md`, que rige el 100% del tiempo.**
>
> Acá solo se dice **dónde** está puesto el foco y qué quedó abierto. Si algo de este archivo pareciera permitir saltarse una regla de `AGENTS.md` —la validación funcional antes que la UI, el paso a paso, la honestidad sobre lo que no se verificó, los skills obligatorios— **el que está mal es este archivo**.
>
> Acotar el foco limita el alcance, nunca el rigor.

Actualizado el 2026-10-02 (el resto del archivo es del 2026-09-26 y puede estar viejo). Todo lo que dice "verificado" tiene al lado el comando o la fuente; el resto está marcado como pendiente o sin verificar.

## PAUSA 2026-10-06 — retomar acá

Rama `feat/catalogo-compatibilidad` (pusheada, sin PR). Nada aplicado en crm-dev todavía.

**Hecho en la rama:** traductor `src/lib/catalogo/traducir-descripcion.ts` (93,8 % de una muestra de 2000 productos reales con vehículo) · `catalogo_modelos` + `buscar_productos` con filtro de modelo/año/cilindrada y `diferencias` (migraciones `20261005120000`, `20261005120100`) · scripts `scripts/catalogo/cargar-modelos.mjs` y `rellenar-compatibilidad.mjs` (dry-run por defecto, `--aplicar` exige `CONFIRMO_ESCRITURA=1`) · reglas §12 en el prompt · una sola forma de `CompatibilidadEntry` · `docs/catalogo/diccionario-modelos-sugerido.csv` (401 siglas, 316 alta) · `docs/catalogo/investigacion-modelos.md` (dudas resueltas con fuentes web). Eval con 3 repeticiones: gpt-4o-mini 22/30, gpt-4.1 29/30.

**En pausa (WIP en ramas `worktree-agent-*`, ver `git branch`):** integración del ERP Oracle — contrato en `C:\Users\Tinki\Documents\Archivos para Claude\crm_erp_oracle_contrato.md`, datos `crm_catalogo_erp.csv` (27.187 ítems). Migraciones previstas `20261006130000_productos_erp`, `…130100_erp_sync` (RPC con clave, patrón de `bodega_web/supabase/migrations/20261005120000_erp_oracle_sync.sql`), `…130200_usuarios_empresa`; UI de 4 precios + empresa del vendedor; cron que recalcula compatibilidad.

**Decisiones del dueño:** el agente cotiza el precio más barato distinto de 0 de las 4 empresas · ítems sin stock se cargan · código de fábrica = el de SAS (empresa 6; fallback a Matriz sin confirmar, preguntado a la sesión de Bodega Web) · sin vehículo guardado ni nombrado el agente pregunta; si nombra el modelo busca y pregunta solo lo que difiere · modelos: confirmados + sugeridos de confianza alta · **aprobado (2026-10-06): juntar todo, aplicar en crm-dev, cambiar el modelo del agente a `gpt-4.1` y desplegar; avisar al dueño para su prueba de cotización.**

**Siguiente:** terminar/revisar las ramas WIP del ERP (security review de las RPC anon) → mergear en `feat/catalogo-compatibilidad` → dry-run de migraciones → aplicar → cargar modelos → rellenar compatibilidad (dry-run sobre todo el catálogo primero) → `gpt-4.1` en `/agente` → PR + deploy → pasarle a Bodega Web `docs/integraciones/erp-oracle-contrato-crm.md` → guiar al dueño para generar la clave del extractor (`scripts/erp/configurar-clave.mjs`), sin que la clave pase por el chat.

**Lección nueva:** un agente creó un junction a `node_modules` dentro de su worktree y `git worktree remove` vació el `node_modules` del repo principal (se recuperó con `npm ci`). Antes de borrar un worktree: buscar reparse points; los agentes no crean enlaces.

---

## 1. Estado de la rama

| Qué         | Estado                                                                                                                                                     | Cómo comprobarlo                                                                                       |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `master`    | = `origin/master` = `7173f87`                                                                                                                              | `git rev-parse master origin/master`                                                                   |
| Producción  | Desplegada en `https://crm-wine-one-38.vercel.app`; `/api/health` ok (db/inngest/openai)                                                                   | Vercel + `curl /api/health`                                                                            |
| Migraciones | 91 archivos, 91 en el ledger de crm-dev; última `20261001130000`                                                                                           | `ls supabase/migrations/*.sql \| wc -l` · `select count(*) from supabase_migrations.schema_migrations` |
| Catálogo    | 21.009 filas en `productos` (ya no está vacío)                                                                                                             | `select count(*) from productos`                                                                       |
| Sin mergear | `feat/costos-meta-oct` (migración `20260927180000_costos_meta.sql` no aplicada) · `workflows-fundacion` (sin revisar) · suite de evals del agente en curso | `git branch -vv`                                                                                       |

**Falta:** ver "Siguiente sub-paso" en `AGENTS.md` §2. El orden del deploy ya se cumplió; antes de cualquier migración nueva, `AGENTS.md` lección 16 (frenar agentes, `supabase db push --dry-run`, comparar).

### Copiloto del Inbox

`20260930120000_copiloto.sql` aplicada en crm-dev y código desplegado (PR #1). Regla que queda: **si un push a `master` despliega solo (Vercel), la migración se aplica antes del push** (lección 16).

Config activa del agente (versión 2, leída el 2026-10-02): `horario_timezone = America/Guayaquil` ✅ · `escalar_umbral_intents = 5` ✅ · `horario_equipo` vacío en los 7 días ⏳ — falta que el dueño cargue el horario real desde `/agente` → Límites; mientras esté vacío el modo es Automático, como antes.

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
