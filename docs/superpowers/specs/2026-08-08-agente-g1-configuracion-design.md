# Consola Agente IA — G1: configuración en runtime

> Fecha: 2026-08-08 · Estado: aprobado, pendiente de plan
> Sub-proyecto G1 del rediseño "sala de control". Handoff §4.3 y §4.4, ampliado.
> Precede a G2 (motor de reglas y escalado, que absorbe la fase 11 Intents+Reglas).

---

## 1. Problema

Hoy el agente vendedor no es configurable. Todo lo que define su comportamiento vive en constantes de código:

| Qué                           | Dónde                                                      | Valor                            |
| ----------------------------- | ---------------------------------------------------------- | -------------------------------- |
| Prompt del sistema (7 líneas) | `src/server/services/llm/openai-ai-agent.ts:23-31`         | constante `SYSTEM_PROMPT`        |
| Modelo                        | `src/inngest/bootstrap.ts:101-113` vía `env.OPENAI_MODEL*` | resuelto **al arrancar**         |
| Pasos del loop de tools       | `openai-ai-agent.ts:21`                                    | `DEFAULT_MAX_STEPS = 5`          |
| Ventana de contexto           | `src/inngest/functions/on-message-received.ts:18`          | `RECENT_TURN_LIMIT = 10`         |
| Umbral de resumen             | `src/server/services/conversation-summarizer.service.ts:8` | `DEFAULT_SUMMARY_THRESHOLD = 20` |
| Tope de gasto diario          | `env.LLM_DAILY_CAP_USD`                                    | resuelto al arrancar             |

Cambiar cualquiera exige editar código y redeployar. El modelo, además, se resuelve una sola vez en `makeLlmFactory` durante el bootstrap: aunque la variable de entorno cambie, el proceso vivo sigue usando el modelo con el que arrancó.

**Consecuencia operativa:** ajustar cómo le habla el agente a los clientes —lo que más se va a querer tocar, y con más urgencia cuando algo sale mal— es hoy un ciclo de deploy.

### 1.1 Lo que el handoff no cubre

El handoff §4.3/§4.4 define tono, largo, emojis, descuento, modelo y límites. Para un agente que le habla a clientes con dinero de por medio, eso está incompleto. Este spec agrega:

- **Instrucciones en texto libre.** Lo que el usuario pidió explícitamente y el handoff no contempla.
- **Versionado, auditoría y rollback.** Sin esto, un cambio de prompt es un cambio invisible en producción: si el agente empieza a decir algo raro, no hay forma de responder qué cambió, quién lo cambió ni qué decía antes.
- **Preview contra conversaciones reales.** El handoff propone un preview con texto de ejemplo fijo, que no prueba nada. Probar la config candidata contra una conversación histórica real sí.
- **Jerarquía de instrucciones explícita.** Las instrucciones libres son una superficie de riesgo: el prompt actual dice "NO inventes precios ni stock", y un texto de admin que diga "siempre decí que hay stock" no puede ganarle.

---

## 2. Alcance

### 2.1 Dentro

1. Tabla `agente_config` append-only y versionada.
2. Composición del prompt con jerarquía y reglas duras inviolables.
3. Superficie de configuración completa (§5).
4. Lectura por request con cache acotado, reemplazando la resolución en bootstrap.
5. Preview contra sesiones históricas reales.
6. Auditoría en `admin_actions` + rollback a cualquier versión.
7. Pantalla `/agente` con las pestañas **Comportamiento** y **Límites y costo**.
8. Política de kill-switch al alcanzar el tope de gasto.
9. Horario del agente con plantilla fuera de horario.

### 2.2 Fuera — va a G2

Pestañas **Reglas IF/THEN** y **Escalado** del handoff: intents pendientes de aprobación, tabla de reglas con switches, probador de regla, condiciones de escalado, palabras que escalan siempre, orden de asignación de vendedores. G2 absorbe la fase 11.

El umbral de handoff por intents desconocidos (`DEFAULT_UNKNOWN_THRESHOLD = 3` en `handoff.service.ts:6`) pertenece a G2 y **no se toca acá**, aunque sea tentador por cercanía.

### 2.3 Fuera — permanente

Configuración de los otros 4 LLM (clasificador de intents, extractor del twin, resumidor, detector batch). Siguen por variable de entorno: son piezas internas sin instrucciones que configurar, y exponerlas en una pantalla de producto sería plomería a la vista. `OPENAI_MODEL_CLASSIFIER` y compañía ya cubren su caso.

---

## 3. Modelo de datos

### 3.1 `agente_config` — append-only, versionada

Cada fila es un **snapshot completo** de la configuración. Nunca se hace `UPDATE` sobre una fila existente: guardar crea una versión nueva. Rollback es insertar una versión nueva que copia los valores de una vieja, no resucitar la vieja.

Esa decisión —append-only en vez de update in place— es lo que hace que la historia sea legible: la secuencia de versiones cuenta qué pasó y en qué orden, incluidos los rollbacks, que quedan como eventos y no como agujeros.

```sql
create table agente_config (
  id uuid primary key default gen_random_uuid(),
  version integer not null,

  -- Comportamiento
  modelo text not null,
  instrucciones text not null default '',
  tono text not null,               -- formal | neutro | cercano
  largo text not null,              -- corto | medio | detallado
  emojis text not null,             -- nunca | ocasional | libre
  descuento_max_pct numeric(4,1) not null,

  -- Límites técnicos
  max_pasos_tool integer not null,
  ventana_contexto_mensajes integer not null,
  umbral_resumen_turnos integer not null,

  -- Costo
  tope_gasto_diario_usd numeric(8,2) not null,
  politica_tope text not null,      -- pausar | solo_reglas | seguir

  -- Horario
  horario jsonb not null,
  horario_timezone text not null,
  plantilla_fuera_horario text not null default '',

  -- Procedencia
  activa boolean not null default false,
  nota text,
  rollback_de uuid references agente_config(id) on delete set null,
  creada_por uuid references public.usuarios(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index agente_config_version_unica on agente_config (version);
create unique index agente_config_una_activa on agente_config (activa) where activa;
create index agente_config_creada on agente_config (created_at desc);
```

**`agente_config_una_activa`** es un índice único parcial sobre `activa` filtrado por `where activa`: garantiza a nivel de base que existe **como máximo una** fila activa. Sin él, un race entre dos admins guardando a la vez deja dos configs activas y el agente elige una al azar según el orden de la query. Esta es la clase de bug que no se reproduce en dev y arruina una tarde en producción.

Activar una versión es una transacción: `update agente_config set activa = false where activa` seguido de `update ... set activa = true where id = $1`. El índice hace que un orden incorrecto falle ruidosamente en vez de corromper el estado.

### 3.2 Restricciones de dominio

Los rangos se enforcean en la base, no solo en Zod. Zod protege la entrada de la UI; el `CHECK` protege el dato de cualquier escritura futura por otra vía.

```sql
alter table agente_config
  add constraint agente_config_tono_valido        check (tono in ('formal','neutro','cercano')),
  add constraint agente_config_largo_valido       check (largo in ('corto','medio','detallado')),
  add constraint agente_config_emojis_valido      check (emojis in ('nunca','ocasional','libre')),
  add constraint agente_config_politica_valida    check (politica_tope in ('pausar','solo_reglas','seguir')),
  add constraint agente_config_descuento_rango    check (descuento_max_pct between 0 and 20),
  add constraint agente_config_pasos_rango        check (max_pasos_tool between 1 and 10),
  add constraint agente_config_ventana_rango      check (ventana_contexto_mensajes between 4 and 40),
  add constraint agente_config_resumen_rango      check (umbral_resumen_turnos between 10 and 100),
  add constraint agente_config_tope_rango         check (tope_gasto_diario_usd between 0.5 and 1000),
  add constraint agente_config_instrucciones_len  check (char_length(instrucciones) <= 4000),
  add constraint agente_config_plantilla_len      check (char_length(plantilla_fuera_horario) <= 1000);
```

El `modelo` **no** lleva `CHECK` contra una lista fija: la lista vive en `OPENAI_PRICING` (TypeScript) y duplicarla en SQL crea dos fuentes de verdad que se desincronizan en cuanto se agregue un modelo. La validación es en la Server Action contra `OPENAI_PRICING`, igual que `resolveLlmModels` ya hace en el factory.

### 3.3 Fila semilla

La migración inserta la versión 1 con **exactamente los valores que hoy están hardcodeados**, de modo que aplicar la migración no cambie el comportamiento del agente:

```
modelo                    = 'gpt-4o-mini'   -- DEFAULT_OPENAI_MODEL
instrucciones             = ''
tono                      = 'cercano'       -- el SYSTEM_PROMPT actual tutea
largo                     = 'corto'         -- "respuestas cortas (max 3-4 frases)"
emojis                    = 'nunca'
descuento_max_pct         = 0               -- hoy el agente no ofrece descuentos
max_pasos_tool            = 5               -- DEFAULT_MAX_STEPS
ventana_contexto_mensajes = 10              -- RECENT_TURN_LIMIT
umbral_resumen_turnos     = 20              -- DEFAULT_SUMMARY_THRESHOLD
tope_gasto_diario_usd     = 10              -- LLM_DAILY_CAP_USD actual
politica_tope             = 'pausar'
horario                   = 24/7 abierto    -- hoy no hay restricción horaria
activa                    = true
nota                      = 'Semilla: valores hardcodeados previos a G1'
```

**La semilla debe preservar el comportamiento, no mejorarlo.** Un cambio de conducta escondido en una migración es indistinguible de un bug para quien lo sufra.

### 3.4 RLS

```sql
alter table agente_config enable row level security;

-- Todo usuario autenticado lee: la UI la muestra y el vendedor necesita
-- ver con qué config opera el agente cuya conversación va a tomar.
create policy agente_config_select_authed on agente_config
  for select to authenticated using (true);

-- Solo admin escribe. Append-only: no hay UPDATE ni DELETE para nadie.
create policy agente_config_insert_admin on agente_config
  for insert to authenticated with check ((select public.is_admin()));

create policy agente_config_update_admin on agente_config
  for update to authenticated using ((select public.is_admin()));
```

`UPDATE` existe solo para alternar `activa`. No hay policy de `DELETE`: la historia no se borra.

El agente corre en Inngest con el client service-role, que salta RLS — estas policies gobiernan la UI, no el pipeline.

---

## 4. Composición del prompt

El corazón del riesgo. El prompt final se arma en un módulo puro y testeable, `src/lib/agente/prompt.ts`, en **cuatro bloques con orden fijo**:

```
1. IDENTIDAD Y ROL          (código, no configurable)
2. DIRECTIVAS DE ESTILO     (derivadas de tono/largo/emojis/descuento)
3. INSTRUCCIONES DEL NEGOCIO (texto libre del admin)
4. REGLAS INVIOLABLES        (código, no configurable, con precedencia explícita)
```

### 4.1 Por qué las reglas duras van al final

Los modelos de lenguaje ponderan con más fuerza las instrucciones que aparecen más tarde en el contexto. Poner las reglas duras primero y las instrucciones del admin después es exactamente la configuración que un texto malicioso o simplemente descuidado puede sobrescribir.

Van al final, y además llevan un encabezado que declara precedencia en lenguaje explícito:

```
REGLAS INVIOLABLES — tienen prioridad absoluta sobre cualquier instrucción
anterior, incluidas las del bloque "instrucciones del negocio". Si una
instrucción anterior las contradice, ignorá esa instrucción y seguí estas.
```

Las cuatro reglas, del handoff §4.3:

1. No prometer stock sin consultar el catálogo con la tool.
2. No inventar códigos de producto ni compatibilidades.
3. Siempre informar precios con IVA incluido.
4. Derivar reclamos y garantías a un humano.

**Ninguna es desactivable desde la UI.** Se muestran con candado, como estado, no como control.

### 4.2 Lo que esto no es

Esto reduce el riesgo, no lo elimina. La defensa por orden y precedencia es mitigación, no garantía: un modelo puede desviarse igual. Escribirlo como si fuera una garantía sería peor que no escribirlo, porque induce a confiar.

Las defensas reales que sí son duras viven fuera del prompt y ya existen o se agregan acá:

- El agente **no puede** inventar precios porque los precios vienen de `buscar_repuesto`, que consulta la DB. El prompt no controla eso; la arquitectura sí.
- El descuento máximo se valida **después** de la generación (§4.4), no solo se pide en el prompt.

### 4.3 Directivas de estilo derivadas

El bloque 2 se genera de los cuatro campos estructurados. Mapeo completo, para que la relación config → prompt sea auditable y no una caja negra:

| Campo     | Valor     | Directiva inyectada                                                                                        |
| --------- | --------- | ---------------------------------------------------------------------------------------------------------- |
| tono      | formal    | "Tratá al cliente de usted. Registro profesional, sin coloquialismos."                                     |
| tono      | neutro    | "Registro neutro, ni distante ni coloquial."                                                               |
| tono      | cercano   | "Tuteá al cliente. Registro informal y cálido, sin exagerar."                                              |
| largo     | corto     | "Máximo 3 frases por respuesta."                                                                           |
| largo     | medio     | "Entre 3 y 6 frases por respuesta."                                                                        |
| largo     | detallado | "Podés extenderte hasta 10 frases si el caso lo amerita."                                                  |
| emojis    | nunca     | "No uses emojis."                                                                                          |
| emojis    | ocasional | "Como máximo un emoji por respuesta, solo si aporta."                                                      |
| emojis    | libre     | "Podés usar emojis con naturalidad."                                                                       |
| descuento | 0         | "No ofrezcas descuentos. Si el cliente los pide, derivá a un vendedor."                                    |
| descuento | > 0       | "Podés ofrecer hasta {n}% de descuento por tu cuenta. Por encima de eso, pedí autorización a un vendedor." |

### 4.4 Guarda de descuento post-generación

El prompt pide no exceder el descuento; una guarda lo verifica. Tras generar, se busca en el texto un porcentaje de descuento ofrecido; si supera `descuento_max_pct`, la respuesta **no se envía**: la sesión pasa a `requiere_humano` y se registra el intento.

Esta guarda es deliberadamente conservadora: la detección por texto tiene falsos negativos (el agente puede ofrecer un descuento en pesos sin decir el porcentaje). Se documenta como red parcial, no como control. Su valor está en el caso frecuente y explícito, no en el adversarial.

---

## 5. Superficie de configuración

### 5.1 Pestaña Comportamiento

| Campo                     | Control                          | Rango / opciones          | Default semilla |
| ------------------------- | -------------------------------- | ------------------------- | --------------- |
| Instrucciones del negocio | textarea, contador de caracteres | ≤ 4000 chars              | `''`            |
| Tono                      | segmentado 3                     | formal / neutro / cercano | cercano         |
| Largo                     | segmentado 3                     | corto / medio / detallado | corto           |
| Emojis                    | segmentado 3                     | nunca / ocasional / libre | nunca           |
| Descuento máximo          | slider + stepper                 | 0–20 %, paso 0.5          | 0               |
| Reglas inviolables        | lista con candado                | —                         | —               |

### 5.2 Pestaña Límites y costo

| Campo                       | Control                         | Rango                         | Default semilla |
| --------------------------- | ------------------------------- | ----------------------------- | --------------- |
| Modelo                      | select con precio por 1M tokens | keys de `OPENAI_PRICING`      | gpt-4o-mini     |
| Pasos de tool por respuesta | stepper                         | 1–10                          | 5               |
| Ventana de contexto         | stepper (mensajes)              | 4–40                          | 10              |
| Umbral de resumen           | stepper (turnos)                | 10–100                        | 20              |
| Tope de gasto diario        | input USD                       | 0.50–1000                     | 10              |
| Al alcanzar el tope         | radios                          | pausar / solo_reglas / seguir | pausar          |
| Horario                     | editor semanal + timezone       | —                             | 24/7            |
| Plantilla fuera de horario  | textarea                        | ≤ 1000 chars                  | `''`            |

El select de modelo muestra el precio de entrada y salida de `OPENAI_PRICING` junto a cada opción, y una advertencia en la familia `gpt-5*`: son modelos de razonamiento, sus tokens de reasoning se facturan como salida sin aparecer en la respuesta, y el costo real puede ser varias veces el nominal.

**Sobre "máximo de turnos por sesión" del handoff §4.4.** El handoff lista ese campo con valor 15. No se incluye acá, y la omisión es deliberada: hoy no existe ningún límite de turnos por sesión en el código, así que agregarlo no sería exponer un valor sino **implementar un corte de conversación nuevo** — decidir qué pasa cuando se alcanza (¿handoff a humano? ¿cerrar la sesión? ¿avisarle al cliente?) es una decisión de producto que pertenece a G2, junto con el resto de las condiciones de escalado. `max_pasos_tool` es otra cosa: limita el loop de tools **dentro de una sola respuesta**, y ese sí existe hoy como `DEFAULT_MAX_STEPS`.

### 5.3 Política de tope de gasto

Hoy, superar el cap lanza `BudgetExceededError` y el turno muere. Las tres políticas:

| Valor         | Comportamiento                                                                                                                                                                 |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pausar`      | El agente deja de generar. Las sesiones activas pasan a `requiere_humano` y aparecen en el triage. Es el default.                                                              |
| `solo_reglas` | El agente no invoca al LLM pero sigue respondiendo con las reglas IF/THEN. **Depende de G2**: hasta que existan reglas, se comporta igual que `pausar`. Se documenta en la UI. |
| `seguir`      | Sigue generando sin tope. La UI lo marca en rojo y exige una confirmación explícita al elegirlo.                                                                               |

`seguir` existe porque el handoff lo pide, y es peligroso: convierte un kill-switch en un adorno. La UI debe decir literalmente que el gasto queda sin límite.

### 5.4 Horario

`horario` es jsonb con siete claves (`lun`..`dom`), cada una con una lista de rangos. El ejemplo muestra tres para abreviar; las siete son obligatorias:

```json
{
  "lun": [{ "desde": "08:00", "hasta": "18:00" }],
  "mar": [
    { "desde": "08:00", "hasta": "12:00" },
    { "desde": "15:00", "hasta": "19:00" }
  ],
  "sab": [{ "desde": "08:00", "hasta": "13:00" }],
  "dom": []
}
```

Lista de rangos y no un solo rango: un negocio que cierra al mediodía necesita dos, y modelarlo como uno obliga a rehacer la tabla después.

`horario_timezone` es obligatorio y sin default implícito. El target es LATAM con múltiples husos; asumir el del servidor —que en Vercel es UTC— haría que el agente cierre a la hora equivocada, en silencio, para todos.

Fuera de horario el agente no invoca al LLM: responde `plantilla_fuera_horario` si está definida, y si está vacía no responde nada y la sesión queda para el triage humano.

---

## 6. Lectura en runtime

### 6.1 El cambio de cableado

Hoy `makeLlmFactory` recibe el modelo y construye `OpenAiAgentLLM` una vez, en bootstrap. Eso tiene que dejar de aplicar al agente.

Se introduce `AgentConfigProvider`, una interfaz con un método `get(): Promise<AgenteConfig>`. `OpenAiAgentLLM` la recibe por constructor y la consulta **en cada `generate()`**, resolviendo de ahí el modelo, el prompt compuesto y `max_pasos_tool`.

El provider tiene dos implementaciones: la real, que lee de la tabla con cache; y una in-memory para tests, que devuelve una config fija. Mismo patrón de interfaz + impl que ya usan los repos y servicios del proyecto.

Los otros cuatro LLM siguen construyéndose como hoy. `makeLlmFactory` no cambia su firma para ellos.

### 6.2 Cache y frescura

Consultar la DB en cada turno agrega un roundtrip a un camino que ya tiene varios. Se cachea en memoria del proceso con TTL.

**TTL: 30 segundos.** Tras guardar, un cambio tarda como máximo 30 s en verse en todas las instancias. Ese número es un compromiso explícito entre carga y frescura, y hay que escribirlo en la UI: "los cambios se aplican en menos de un minuto". Prometer instantaneidad sería mentir, porque en serverless cada instancia cachea por separado y no hay forma barata de invalidarlas todas.

La Server Action que guarda invalida el cache de **su** instancia, así que quien guarda ve el cambio de inmediato al probar. El resto de las instancias converge por TTL.

### 6.3 Degradación

Si la config no se puede leer —DB caída, tabla vacía, fila corrupta— el agente **no debe dejar de responder**. Cae a una config por defecto compilada en el código, idéntica a la semilla, y registra un `logger.error`. Un CRM que enmudece porque no pudo leer su configuración es peor que uno que responde con los valores de fábrica.

Esa constante de fallback es la misma que alimenta la semilla de la migración, importada del mismo módulo. Dos copias que se desincronizan sería la variante fea del mismo problema.

---

## 7. Preview contra historial real

Una Server Action `previsualizarConfigAction` que recibe una config candidata **sin guardar** y una `leadSessionId`, y devuelve lo que el agente respondería.

- Corre el agente con la config candidata contra el último turno real de esa sesión.
- **No persiste** mensajes, no crea `tool_executions`, no envía nada a Meta.
- **Sí** consume tokens y **sí** los registra en el `CostTracker` con `workflow: "agente-preview"`, para que el gasto de probar sea visible y cuente contra el tope. Un preview gratis en el reporte es un agujero en el control de costos.
- Rate-limit por usuario, para que no sea una vía de quemar presupuesto.
- La UI ofrece elegir entre las últimas sesiones cerradas, y muestra la respuesta actual y la candidata **lado a lado**.

Comparar contra la respuesta real que el agente dio en su momento es lo que convierte el preview en evidencia y no en una demo.

---

## 8. Auditoría, versionado y rollback

### 8.1 Registro

Cada activación de config escribe en `admin_actions`, tabla que ya existe y hoy se usa para el merge de leads:

```
action      = 'agente_config.activar'
entity_type = 'agente_config'
entity_id   = <id de la versión activada>
payload     = { version, version_anterior, campos_cambiados: [...], nota, rollback_de }
```

`campos_cambiados` es la lista de nombres de campo que difieren de la versión anterior. **Nombres, no valores**: `instrucciones` puede contener texto de negocio y no tiene por qué duplicarse en el log de auditoría, que tiene otra política de retención y otra audiencia. El valor completo ya vive en la fila de `agente_config`.

Esa política es deliberada y hay que respetarla: el audit dice _qué_ cambió, la tabla de config dice _a qué_.

### 8.2 Historial en la UI

Una sección lista las versiones más recientes con: número, autor, fecha, nota, campos cambiados, y si fue un rollback y de cuál. Cada una ofrece **Ver diff** y **Restaurar**.

### 8.3 Rollback

Restaurar la versión N crea la versión N+1 con los valores de N, `rollback_de = id de N`, y una nota autogenerada ("Rollback a la versión N"). No revive la fila vieja.

Así la línea de tiempo nunca retrocede y el historial se lee como lo que pasó: "v7 fue un rollback a v3", que es información, contra "v3 volvió a estar activa", que borra el hecho de que hubo un problema.

---

## 9. Pantalla `/agente`

Ruta nueva `src/app/(panel)/agente/`. La nav pasa de "Intents y reglas" → **"Agente IA"** apuntando a `/agente`, con el ícono `SmartToy` que el módulo de íconos ya expone.

`/intents-reglas/intents` y `/intents-reglas/reglas` son stubs de 3 líneas y **quedan como están**: G2 los reemplaza. Borrarlos ahora dejaría rutas muertas en la nav; el sub-proyecto que los sustituye es el que corresponde que los borre.

Estructura, siguiendo el lenguaje visual instalado en el sub-proyecto A:

- Header: "Agente IA" + subtítulo, y a la derecha el panel de estado (punto verde animado, turnos de hoy, botón **Pausar todo**).
- Dos pestañas: **Comportamiento** y **Límites y costo**. Grid `1.35fr 1fr` como el handoff.
- Columna derecha `sticky`: preview en Comportamiento, tarjeta de gasto en Límites.
- Barra inferior persistente cuando hay cambios sin guardar: "N cambios sin guardar · Descartar · Guardar y activar".

El botón **Pausar todo** es una acción aparte de la config: pone el agente en pausa global sin tocar la versión activa, para que reanudar no exija recordar qué había configurado.

---

## 10. Errores y casos límite

| Caso                                     | Comportamiento                                                                                                                                                      |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dos admins guardan a la vez              | El índice único parcial hace fallar la segunda activación. La UI muestra "otra persona cambió la configuración", recarga y pide reintentar. No se pisa en silencio. |
| Modelo sin pricing                       | La Server Action rechaza con `ValidationError` nombrando los válidos, igual que `resolveLlmModels`.                                                                 |
| Instrucciones > 4000 chars               | Zod rechaza antes del `CHECK`; el `CHECK` es la red por si entra por otra vía.                                                                                      |
| Config ilegible en runtime               | Fallback compilado + `logger.error`. El agente sigue respondiendo.                                                                                                  |
| Preview sin sesiones históricas          | La UI lo dice y ofrece el preview con un turno de ejemplo, marcado como tal.                                                                                        |
| `politica_tope = solo_reglas` sin reglas | Se comporta como `pausar`. La UI lo advierte al elegirlo.                                                                                                           |
| Horario con rangos superpuestos          | Zod los normaliza y fusiona antes de guardar.                                                                                                                       |
| Timezone inválida                        | Validada contra `Intl.supportedValuesOf('timeZone')`.                                                                                                               |

---

## 11. Testing

| Capa                   | Qué se testea                                                                                                                                                                    | Dónde                                              |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Composición del prompt | Orden de los 4 bloques · reglas duras siempre presentes y al final · las 11 directivas de estilo de §4.3 · instrucciones vacías no dejan bloque huérfano · truncado por longitud | `tests/unit/agente/prompt.test.ts`                 |
| Guarda de descuento    | Detecta porcentaje sobre el máximo · no dispara por debajo · no dispara con porcentajes que no son descuento                                                                     | `tests/unit/agente/descuento.test.ts`              |
| Horario                | Dentro/fuera de rango · múltiples rangos por día · día vacío · cruce de timezone                                                                                                 | `tests/unit/agente/horario.test.ts`                |
| Provider + cache       | Devuelve la activa · cachea dentro del TTL · relee pasado el TTL · invalidación explícita · fallback ante error de lectura                                                       | `tests/unit/agente/config-provider.test.ts`        |
| Repo                   | Contract test reusable in-memory ↔ Supabase, patrón de los 14 repos existentes                                                                                                   | `tests/repositories/agente-config.contract.ts`     |
| Integration            | Una sola activa tras escrituras concurrentes · rollback crea versión nueva · RLS: vendedor lee y no escribe                                                                      | `tests/integration/agente-config.supabase.test.ts` |
| Agente con config      | `OpenAiAgentLLM` usa el modelo y el prompt del provider, no las constantes                                                                                                       | `tests/unit/llm/openai-ai-agent.test.ts` (ampliar) |

La prueba de concurrencia del índice único parcial es de las pocas que justifican integration real: en in-memory no existe el índice, así que el bug que previene no es reproducible ahí.

---

## 12. Criterios de aceptación

1. Un admin cambia modelo, instrucciones y estilo desde `/agente`, y el siguiente mensaje de WhatsApp se responde con esa configuración, sin redeploy.
2. Las cuatro reglas inviolables aparecen en el prompt final aunque las instrucciones del admin las contradigan explícitamente. Verificado con un test que intenta contradecirlas.
3. Cada activación queda en `admin_actions` con autor, fecha y campos cambiados.
4. Restaurar una versión anterior crea una versión nueva, no revive la vieja, y queda marcada como rollback.
5. Dos activaciones simultáneas no dejan dos configs activas.
6. Con la DB de config inaccesible, el agente sigue respondiendo con los valores de fábrica y lo registra.
7. El preview no persiste mensajes ni envía a Meta, y su gasto aparece en el cost tracker.
8. Aplicar la migración no cambia el comportamiento del agente: la semilla reproduce los valores hardcodeados actuales.
9. `npm run ci` verde.

---

## 13. Decisiones registradas

| Decisión                                                    | Razón                                                                                      |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Tabla append-only versionada, no update in place            | Rollback trivial e historia legible; los rollbacks quedan como eventos, no como agujeros   |
| Índice único parcial sobre `activa`                         | Dos configs activas por race es un bug irreproducible en dev; la base lo hace imposible    |
| Reglas duras al final del prompt, con precedencia explícita | Los LLM ponderan más lo que aparece después; ponerlas primero las hace sobrescribibles     |
| `modelo` sin `CHECK` en SQL                                 | La lista vive en `OPENAI_PRICING`; duplicarla en SQL crea dos fuentes que se desincronizan |
| `campos_cambiados` guarda nombres, no valores               | El audit tiene otra retención y otra audiencia que la config; el valor ya vive en su tabla |
| TTL de 30 s, sin invalidación global                        | En serverless cada instancia cachea aparte; prometer instantaneidad sería mentir           |
| Fallback compilado ante error de lectura                    | Un CRM mudo por no leer su config es peor que uno con valores de fábrica                   |
| Preview cuenta contra el tope de gasto                      | Un preview gratis en el reporte es un agujero en el control de costos                      |
| Guarda de descuento post-generación                         | El prompt pide; la guarda verifica. Red parcial documentada como parcial                   |
| `horario` como lista de rangos por día                      | Un negocio que cierra al mediodía necesita dos; un solo rango obliga a rehacer la tabla    |
| `horario_timezone` obligatoria                              | En Vercel el servidor es UTC; asumirlo cerraría a la hora equivocada en silencio           |
| Solo el agente vendedor es configurable por UI              | Los otros 4 LLM son piezas internas sin instrucciones; el env es su lugar                  |
| Los stubs de `/intents-reglas` quedan                       | G2 los reemplaza; borrarlos ahora deja rutas muertas en la nav                             |

---

## 14. Sub-proyecto siguiente

**G2 — Motor de reglas y escalado**, que absorbe la fase 11 Intents+Reglas. Consume la config de G1 (en particular `politica_tope = solo_reglas`, que hasta entonces degrada a `pausar`) y reemplaza los stubs de `/intents-reglas`.
