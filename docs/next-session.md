# Próxima sesión: pantalla de Métricas

**Solo Métricas.** Si aparece algo de otra pantalla, se anota y se deja. Método completo en `AGENTS.md §5.1`.

---

## Antes de tocar nada

1. `AGENTS.md` entero — reglas y estado.
2. `docs/runbooks/como-correr-el-crm.md` — cómo levantarlo y por qué cada proceso está ahí.
3. `docs/handoff-rediseno-README.md` — la spec de diseño de esta pantalla. **Si el código no coincide con ese archivo, el que está mal es el código.**

Para ver la pantalla alcanza con `npm run dev` (queda en `http://localhost:3001/metricas`). Inngest y ngrok **no hacen falta**: Métricas solo lee.

---

## Dónde está parada la pantalla

Existe y funciona. Tiene tres cortes —Total, Vendedores, Agente— y es **honesta**: donde no puede calcular algo no inventa un número, dibuja un bloque punteado con `Faltante.tsx` que dice qué iba ahí y qué falta para poder medirlo.

Esos bloques son el punto de partida, porque **dos de los cuatro ya están vencidos**.

---

## Lo primero: dos huecos que ya no son huecos

Verificado contra `crm-dev` el 2026-08-16.

### 1. "1ra respuesta" — el dato ya existe

`PanelTotal.tsx` dice que no se puede medir porque _"mensajes.created_at es la hora en que el webhook insertó la fila, no la hora en que el cliente escribió"_.

**Eso dejó de ser cierto.** `mensajes.platform_created_at` existe desde la migración `20260812222808` y ya tiene **8 filas con la hora real de Meta**. La métrica se puede calcular: es el tiempo entre el entrante y el saliente que lo contesta.

Cuidado con lo que sigue siendo verdad: `platform_created_at` es **nullable** —los mensajes viejos no la tienen y algunos payloads no la traen— así que el corte tiene que excluir los nulos y **decir sobre cuántos mensajes se calculó**. Un promedio sobre 8 de 20 mensajes que se presenta como "el promedio" es peor que no mostrarlo.

### 2. "Por qué se escaló a humano" — la tabla ya existe

`PanelVendedores.tsx` dice que _"la sesión termina en requiere_humano sin guardar qué lo disparó"_.

**Tampoco es cierto.** `handoff_events` guarda `reason_code` con ocho valores posibles (`unknown_intents`, `sensitive_keyword`, `quote_limit`, `discount_limit`, `rule_handoff`, `manual_pause`, `manual_resume`, `other`), `action` (`pause`/`resume`) y `previous_stage`. El repo tiene contract test contra Postgres desde el 2026-08-16.

Hoy tiene **0 filas** porque nadie escaló todavía, no porque no se guarde. La pantalla tiene que distinguir esos dos casos: "todavía no pasó" no es lo mismo que "no se puede medir", y hoy dice lo segundo.

### Los otros dos siguen siendo ciertos

- **Costo por lead** — el gasto está en `llm_usage`, pero falta el denominador: leads del período.
- **Ticket promedio** — `lead_session.precio_cotizado` es lo que se cotizó, no lo que se facturó. No hay tabla de venta ni de orden. Este necesita una decisión de producto, no código.

---

## Lo que hay para trabajar

`metrics.repo.ts` ya expone once lecturas: sesiones, mensajes, leads, ejecuciones de regla, clasificaciones de turno, tool calls, gasto de IA y handoffs desde una fecha, más los catálogos de intents, reglas activas y usuarios. **Tiene contract test contra Postgres** (`tests/repositories/metrics.contract.ts`), que verifica el corte por fecha de las ocho series.

O sea: los datos están y el repo está probado. Lo que falta es de la pantalla para arriba.

---

## Advertencia sobre los datos

`crm-dev` tiene **un solo lead real** con 20 mensajes, y nada más. Con ese volumen **casi toda métrica va a dar cero, uno, o un porcentaje sin sentido**.

No confundir "la métrica está mal" con "no hay datos". Antes de dar por roto un número, contar las filas de la tabla que lo alimenta. Si hace falta volumen para ver algo, se siembra a propósito y **se borra al terminar** — no se deja tirado como pasó con los dos "Carlos Gómez".

---

## Al cerrar la pantalla

Cuando el dueño diga que Métricas está terminada, preparar el cierre sin que lo pida (`AGENTS.md §5.1`): todo commiteado, `typecheck` + `lint` + `test` corridos **con el número real reportado**, `test:integration` si se tocó SQL o repos, y decir en voz alta lo que quedó sin verificar.

---

## Deuda que NO se toca en esta sesión

Se anota y se deja:

- **Ninguna pantalla se revisó visualmente** en toda la sesión anterior. El panel del navegador nunca estuvo desplegado, así que todo se verificó leyendo el HTML del servidor: prueba que el contenido llega, no que se vea bien.
- **El catálogo está vacío a propósito**, esperando el documento de siglas y abreviaturas del dueño.
- **Productos** necesita el filtrado y los parámetros de cuánta información se procesa. Va después de Métricas.
- **`/ajustes`** sigue siendo `PantallaPendiente`.
- **Sin deploy.** El webhook depende de un túnel ngrok que hay que levantar y re-apuntar a mano en cada arranque.
