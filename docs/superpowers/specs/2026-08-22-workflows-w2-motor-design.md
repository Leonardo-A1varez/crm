# W2 — El motor: compilar el grafo, correrlo, y que no se descontrole

> Segundo sub-proyecto de cinco. W1 entregó el modelo de datos, el validador y el versionado; **no ejecuta nada**. W2 lo pone a correr de verdad, con salientes reales a clientes reales. Spec de W1: `2026-08-19-workflows-w1-grafo-design.md`.

## 1. Qué entrega W2

Un workflow publicado se dispara solo, recorre su grafo, ejecuta acciones, espera cuando tiene que esperar, y termina. Incluye **mandar WhatsApp al cliente** — decisión explícita del dueño, tomada sabiendo que abre la puerta que el proyecto mantenía cerrada a propósito (ver la cabecera de `src/inngest/functions/recordatorio-seguimiento.ts`).

Esa decisión es la que le da peso al resto del spec. Con salientes reales, las tres capas de protección dejan de ser buena práctica y pasan a ser lo único que separa un flujo con un bug de un número de WhatsApp quemado. El spam-block de Meta no se revierte.

## 2. Decisiones tomadas

| Pregunta                                            | Decisión                                         | Por qué                                                                                                                                |
| --------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| ¿El motor manda mensajes al cliente?                | **Sí**                                           | Decisión del dueño. Máxima capacidad, máximo riesgo, asumido.                                                                          |
| ¿Cómo se ejecuta un grafo con ciclos sobre Inngest? | **Segmentos entre esperas**                      | §3. El subgrafo sin esperas es acíclico por construcción — lo demuestra el validador de W1.                                            |
| ¿Dos corridas del mismo workflow sobre un lead?     | **Configurable por workflow**, default `ignorar` | Es comportamiento, no preferencia: vive en `workflow_versiones`, versionado.                                                           |
| ¿Qué pasa con las corridas vivas al despublicar?    | **Nada. Siguen**                                 | Cada corrida usa su `workflow_version_id` pinneado. Despublicar = "no acepto disparos nuevos". Cierra la pregunta que W1 dejó abierta. |
| ¿Qué cuenta el tope de mensajes?                    | **Global por lead, todo saliente automático**    | §7. Un tope por workflow no protege: tres workflows de 3 mensajes mandan 9.                                                            |
| ¿Lenguaje de expresiones para condiciones?          | **Ninguno**                                      | §9. La queja concreta contra Kommo fue su lenguaje propio. No se hace uno mejor: no se hace.                                           |
| ¿Ramificación por error?                            | **No**                                           | §8. El modelo de puertos de W1 no lo tiene. Inventarlo sin un caso real es adivinar.                                                   |

## 3. Arquitectura: segmentos entre esperas

Una ejecución de Inngest corre nodos **inline** hasta toparse con una `espera`. Ahí termina, persiste `nodo_actual` + `contexto` en Postgres, y programa el evento que arranca el segmento siguiente.

El argumento que la sostiene, y que no es estético:

> **El subgrafo sin esperas es acíclico por construcción — es exactamente la propiedad que el validador de W1 demuestra.** Un segmento no puede ciclar ni en teoría: recorre un DAG y termina en a lo sumo N nodos, con N ≤ 200 por el tope de tamaño del grafo.

La capa 1 deja de ser higiene y pasa a ser lo que hace acotado al runtime. Validador y motor son la misma idea.

Consecuencias que caen solas:

- El estado memoizado de Inngest **se resetea en cada espera**. Un ciclo de 40 iteraciones nunca acumula.
- Entre segmentos el estado vive en Postgres: consultable (W4 sale casi gratis), cancelable, inspeccionable.
- Dentro del segmento hay retry y durabilidad de Inngest gratis.
- `pasos_ejecutados` acumula a lo largo de **toda la corrida**, no por segmento.

**Alternativas descartadas.** _Una corrida = una ejecución de Inngest con el loop adentro_: Inngest memoiza cada paso y reenvía el estado acumulado en cada request; con `max_pasos` en 500 el peor caso arrastra 500 resultados, y `workflow_runs.nodo_actual`/`contexto` quedarían de adorno. _Un nodo = una invocación_: un round trip y un evento por nodo, con un flujo de 12 nodos sin esperas costando 12 invocaciones, más un cron barredor para corridas clavadas por un evento perdido.

## 4. Piezas

| Pieza                                                | Responsabilidad                                                           | Depende de                       |
| ---------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------- |
| `src/lib/workflows/recorrer.ts`                      | Lógica pura: dado grafo + nodo + puerto, cuál sigue. Sin DB, sin Inngest. | nada                             |
| `src/server/services/workflows/ejecutor.service.ts`  | Corre **un segmento**: nodos inline hasta `espera`, `fin` o tope.         | registro de acciones (inyectado) |
| `src/server/services/workflows/acciones/`            | Las acciones concretas. W3 amplía este directorio y nada más.             | repos                            |
| `src/server/services/workflows/simulador.service.ts` | Corre el grafo entero con reloj virtual y acciones que anotan.            | el mismo ejecutor                |
| `src/inngest/functions/workflow-disparar.ts`         | Decide si arranca una corrida y la crea.                                  | repos                            |
| `src/inngest/functions/workflow-segmento.ts`         | Corre un segmento, persiste, programa el siguiente.                       | ejecutor                         |

El ejecutor **no sabe que existe Inngest** y no sabe persistir. Recibe grafo + nodo de arranque + contexto y devuelve:

```ts
type ResultadoSegmento =
  | { tipo: "espera"; nodoId: string; hasta: Date }
  | { tipo: "fin" }
  | { tipo: "fallado"; nodoId: string; error: string };
```

Eso es lo que hace que el simulador sea el mismo código y no una segunda implementación que se desincroniza.

## 5. El recorrido de un disparo

```
evento de dominio  (lead/tag.asignada, mensaje/recibido, lead/etapa.cambiada)
  |
  +- workflow-disparar
  |    . busca versiones publicadas de workflows activos con ese disparador
  |    . aplica politica de concurrencia   <- RPC con advisory lock, §6
  |    . crea workflow_runs (corriendo, pasos_ejecutados = 0)
  |    +- emite workflow/segmento.pendiente { runId, desdePaso: 0 }
  |
  +- workflow-segmento
       . CAS sobre el run (§6) -- si no matchea, sale callado
       . lee el grafo de la version PINNEADA, no de la publicada
       . el ejecutor corre inline: nodo -> accion -> puerto -> siguiente...
       . escribe workflow_run_pasos por cada nodo, actualiza el run
       . espera -> estado=esperando + emite el evento con delay
       . fin    -> estado=terminado + ended_at
```

## 6. Las dos guardas

### 6.1 Idempotencia entre segmentos

Inngest garantiza _at-least-once_: un evento se puede entregar dos veces, y correr el segmento dos veces significa mandar el mensaje dos veces. El evento lleva `desdePaso` y el segmento arranca con un compare-and-swap:

```sql
update public.workflow_runs
   set estado = 'corriendo'
 where id = $1
   and pasos_ejecutados = $2
   and estado in ('corriendo','esperando')
returning *;
```

Cero filas = ya corrió, o lo cancelaron. Sale sin ruido. Funciona porque `pasos_ejecutados` es estrictamente creciente: un segmento siempre ejecuta al menos el nodo en el que arranca.

**`pasos_ejecutados` se incrementa por nodo, no por segmento.** Es lo que hace que el CAS del segmento siguiente tenga contra qué comparar, y que la capa 2 mida bien en el medio de un segmento largo. Escribirlo recién al terminar el segmento deja dos agujeros: un segmento que muere a la mitad reintenta desde cero y reenvía lo ya enviado, y un ciclo que gasta 300 pasos dentro de un mismo segmento no topa nunca.

Dentro del segmento cada nodo es su propio `step.run`, así que Inngest memoiza los nodos ya completados y un reintento del segmento no los vuelve a ejecutar. Igual, **cada acción debe ser idempotente por su cuenta**: `step.run` también es _at-least-once_, y la memoización protege del reintento del segmento, no del reintento del step.

### 6.2 Concurrencia sin carrera

`politica_concurrencia` va en `workflow_versiones` — append-only, igual que `max_pasos`, porque es comportamiento y no preferencia. Enum `ignorar | reiniciar | permitir`, default `ignorar`.

Consultar "¿hay corrida viva?" y después insertar es una carrera clásica: dos disparos simultáneos ven cero y crean dos corridas, que con salientes habilitados es el doble de mensajes. La decisión y el insert van juntos en una función Postgres con advisory lock sobre `(workflow_id, lead_id)`, mismo patrón que `publicar_workflow_version` y `approve_lead_merge`.

`reiniciar` tiene un riesgo propio que hay que documentar en la UI de W5: cada corrida arranca con `pasos_ejecutados` en cero, así que un disparador ruidoso reinicia en loop sin que la capa 2 lo vea nunca. La capa 3 sí lo ve, porque cuenta por lead y no por corrida.

## 7. Las tres capas

**Capa 1 — estática, ya entregada en W1.** Todo ciclo contiene una espera. Con la arquitectura de segmentos es además lo que prueba que un segmento termina. Cero código nuevo.

**Capa 2 — tope de pasos por corrida.** `max_pasos` en `workflow_versiones`, default 500, CHECK ya aplicado. `pasos_ejecutados` acumula a lo largo de toda la corrida. **Se chequea antes de ejecutar el nodo, no después**: chequear después manda el mensaje 501 y recién ahí se entera. Al topar: `estado='fallado'` con el nodo donde se descontroló.

**Capa 3 — tope de salientes automáticos por lead.** Un contador, global por lead, sobre todo lo que sale sin que lo escriba un humano:

```sql
select count(*)
  from public.mensajes m
  join public.conversaciones c on c.id = m.conversacion_id
 where c.lead_id = $1
   and m.direction = 'out'
   and m.sender in ('ia','sistema')      -- 'humano' NO cuenta
   and m.created_at > now() - interval '24 hours';
```

Tres propiedades que salen de elegir esta consulta y no otra:

- **`humano` queda afuera.** Un vendedor tipeando a mano no gasta el presupuesto automático.
- **La reactivación predictiva entra en la cuenta sin tocarla**, siempre que grabe en `mensajes` como `sistema`. Es lo que hace que el tope sea real y no una ilusión por-subsistema. **Verificar en la implementación**: si reactivación manda sin grabar, la cuenta miente, y el arreglo es que grabe.
- **Ventana móvil, no día calendario.** 3 mensajes a las 23:00 y 3 a las 00:05 serían 6 en 65 minutos con un corte por día.

**El número: 3 por lead por 24 h**, en `agente_config` (`max_salientes_automaticos_24h`, CHECK 1–20). Va ahí porque `agente_config` ya es la política de la organización, versionada, con rollback y auditoría — `tope_gasto_diario_usd`, `politica_tope` y `horario` viven ahí. Una segunda tabla versionada y auditada para guardar un entero es abstracción prematura.

Por qué 3: el caso de negocio real ("insistir cada 2 días") consume 1. Con 3 no se toca legítimamente nunca. **Por eso al topar falla la corrida en voz alta** (`fallado`, con el motivo) y no se saltea en silencio: saltear deja un flujo que "anduvo" y un lead que nunca recibió nada, que es peor que un error visible.

## 8. Errores por nodo

| Qué pasó                                                                   | Qué hace el motor                                                               |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `InfraError`, `RateLimitError` (retriable)                                 | Inngest reintenta el step. Agotados los reintentos, corrida `fallado`.          |
| `ValidationError`, `NotFoundError`, `PermissionDeniedError` (no retriable) | `NonRetriableError` a Inngest. Corrida `fallado` de una, sin quemar reintentos. |
| Tope de capa 2 o 3                                                         | `fallado` con el motivo y el nodo. No es excepción de infra.                    |

**No existe ramificación por error.** El modelo de puertos de W1 tiene `salida`, `verdadero`, `falso`; no hay puerto `error`. Un nodo que falla mata la corrida y queda en `workflow_run_pasos` con su `error`. Agregar un puerto de error es un cambio de schema del grafo y le corresponde a W3 o W5 si aparece el caso real.

## 9. Contexto y condiciones — sin lenguaje de expresiones

`workflow_runs.contexto` (jsonb, ya existe) lo siembra el disparador y lo amplían las acciones. Los nodos `condicion` leen de ahí.

La `config` de un `condicion` es una comparación estructurada, no una cadena que alguien parsea:

```ts
{ campo: "lead.etapa", operador: "es", valor: "cotizado" }
```

`campo` sale de una lista blanca. Sin parser, sin `eval`, sin precedencia de operadores, sin errores de sintaxis en runtime. Zod lo valida al guardar y el canvas de W5 lo dibuja con dos selects. W3 amplía la lista blanca; nadie amplía una gramática.

Esto es respuesta directa a la queja del dueño sobre Kommo: inventaron su propio lenguaje, es malo, y con flujos grandes no funciona. La forma de no repetirlo no es hacer un lenguaje mejor.

## 10. Catálogo mínimo

W3 es dueño del catálogo completo. W2 lleva lo justo para probar el motor de punta a punta **incluyendo el saliente**:

| Disparadores        | Acciones                                |
| ------------------- | --------------------------------------- |
| `etiqueta_asignada` | `poner_etiqueta`                        |
| `mensaje_recibido`  | `enviar_mensaje` — el que gasta el tope |
| `etapa_cambiada`    | `cambiar_etapa`                         |
|                     | `escalar_a_humano`                      |

Los cuatro reusan camino ya probado: `assignToLead` (que ya escribió filas `source='workflow'` contra Postgres real), el handoff, y el envío de Meta. No se construye ninguna integración nueva.

**Restricción real de `enviar_mensaje`:** fuera de la ventana de 24 h de WhatsApp, Meta rechaza texto libre; solo pasan plantillas aprobadas. La acción chequea la ventana y **falla en voz alta** si le piden texto libre afuera. No degrada a plantilla por su cuenta: elegir qué plantilla se le manda a un cliente no es decisión del motor.

## 11. Modo simulación

Sale casi gratis de cómo quedó partido el ejecutor: las acciones se inyectan, así que simular es pasarle un registro de acciones que anota en vez de hacer. Mismo `recorrer.ts`, mismo `ejecutor.service.ts`, mismo grafo. No hay segunda implementación que se desincronice — que es cómo mueren los simuladores.

La pieza que lo hace valioso: **la espera adelanta un reloj virtual en vez de programar un evento.** Un flujo que espera 2 días y cicla 40 veces se simula entero en milisegundos y devuelve el recorrido completo, con el reloj virtual y el consumo del tope en cada paso.

El caso que justifica todo el trabajo:

```
TOPE: max_pasos 500 alcanzado en el nodo "enviar", dia 998
      este flujo cicla para siempre y manda 250 mensajes
```

**Ese flujo pasa el validador** — tiene una espera en el ciclo, la capa 1 está conforme — y sin embargo está roto. La simulación lo dice antes de que exista un lead. Es lo que Kommo no da y por lo que sus flujos grandes son inmanejables.

Siempre termina: corre hasta `fin`, `fallado` o `max_pasos`.

Entrega en W2: el servicio + `scripts/simular-workflow.mjs`, para poder correrlo desde la terminal antes de que exista el canvas de W5. Mismo hábito que `scripts/smoke-meta-send.mjs`.

## 12. Schema — una migración

- `workflow_versiones.politica_concurrencia` — enum nuevo `workflow_concurrencia` (`ignorar|reiniciar|permitir`), default `ignorar`, not null.
- `agente_config.max_salientes_automaticos_24h` — integer, default 3, CHECK entre 1 y 20. Append-only: la columna entra en el INSERT versionado y en la auditoría.
- Función `arrancar_workflow_run(...)` — advisory lock + política de concurrencia + insert, atómico. `security invoker`, `search_path = ''`, mismo patrón que `publicar_workflow_version`.

Timestamp mayor a `20260822151229` (última aplicada). **Aplicar con el MCP y renombrar el archivo al número que el MCP registre**: la divergencia repo/ledger ya se pagó seis veces en este proyecto.

## 13. Cómo se prueba

1. **`recorrer.ts` y el ejecutor con acciones falsas** — el grueso. Ciclos, condiciones, topes, cancelación, CAS de idempotencia.
2. **El simulador como herramienta de test** — grafo pinneado, se afirma el recorrido completo. Un test que dice "este flujo manda 250 mensajes" es más fuerte que uno que dice "el nodo 3 devolvió true".
3. **Contract tests** del repo nuevo, in-memory. Contra Postgres siguen congelados hasta que exista la base aislada — se dice ahora para que no aparezca como sorpresa al cerrar.
4. **Un solo E2E real al final**: flujo de 2 nodos, disparo → mensaje, contra el número de prueba, una vez, a propósito. AGENTS.md lección 14.

## 14. No entra

El catálogo completo de disparadores y acciones (W3), la observabilidad y la reejecución (W4), el canvas (W5), y **ninguna pantalla** — W2 no tiene UI. Se maneja por tests y por el script del simulador.

Tampoco entra: ramificación por error (§8), lenguaje de expresiones (§9), y elegir plantilla automáticamente fuera de la ventana de 24 h (§10).

## 15. Preguntas abiertas

- **La reactivación predictiva, ¿graba en `mensajes` como `sistema`?** De eso depende que la capa 3 cuente de verdad. Se verifica en la implementación; si no graba, el arreglo es que grabe.
- **Qué hace `reiniciar` con los salientes ya mandados por la corrida cancelada.** Hoy: nada, quedan mandados y contados por la capa 3. Alcanza porque el tope es por lead, pero conviene mirarlo cuando exista el primer flujo real que use esa política.
- **El horario de `agente_config` — ¿lo respeta un workflow?** El agente no le escribe a un cliente fuera de horario. Un workflow que manda a las 3 AM es el mismo problema. Se decide al implementar `enviar_mensaje`; la inclinación es que sí lo respete y difiera hasta la hora hábil siguiente.
