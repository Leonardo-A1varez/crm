# PRD — Motor de Workflows, Comunicación y Difusión

> **Producto:** CRM conversacional para venta de repuestos automotrices en Latam.
> **Alcance:** el producto completo, con foco en workflows, comunicación y difusión.
> **Fecha:** 2026-08-28.

---

## 0. Cómo leer este documento

Cada afirmación está marcada:

- **[VERIFICADO]** — comprobado contra el código de este repositorio, contra documentación oficial de un vendor, o contra la documentación de Meta. Con archivo y línea, o con URL.
- **[DECISIÓN]** — una elección de producto tomada acá. Se discute, pero mientras no se cambie en este documento, manda.
- **[SIN VERIFICAR]** — hipótesis o dato de segunda mano. **No construir encima sin confirmar.**

La distinción no es burocracia. La §3 documenta tres fallas graves que sobrevivieron meses porque nadie separó "el archivo existe" de "el sistema funciona". Y durante la redacción de este PRD un dato de segunda mano ("Meta empieza a cobrar los utility en octubre") **se cayó al verificarlo contra la fuente primaria** — la doc de Meta solo anuncia ajustes de tarifa en nueve mercados, ninguno latinoamericano, y sigue diciendo textual que _"All non-template messages are free"_ dentro de la ventana de servicio.

**Base de investigación:** ocho investigaciones contra documentación primaria de 25+ plataformas (WhatsApp BSPs, journey builders de marketing, motores de workflow genéricos, vendors Latam), más la documentación de Meta y ~200 reseñas de usuarios reales en español, portugués e inglés. Lo que quedó fuera de alcance está en §14.

---

## 1. El producto en una página

Un CRM donde **la conversación es el producto**, no un módulo. Un negocio de repuestos recibe consultas por WhatsApp, Instagram y Facebook Messenger; un agente de IA con el catálogo conectado atiende, identifica vehículo y pieza, cotiza, y escala a una persona cuando corresponde.

Lo que lo separa de un CRM tradicional:

- **Sin kanban manual.** La etapa la clasifica la IA después de cada turno.
- **Lead Twin.** Ficha estructurada de la sesión activa, mantenida por un LLM campo por campo, **con procedencia**: se sabe si cada dato lo puso la IA, una persona o el catálogo.
- **El agente vende.** Tiene el catálogo como herramienta y cierra cotizaciones.

**Despliegue [VERIFICADO]:** single-org self-hosted white-label. Una instalación por empresa. No es SaaS multi-tenant.

**Escala objetivo:** 30 vendedores por instancia, pico 50 msg/s, ~5.000 leads/mes.

---

## 2. Usuarios

### 2.1 El vendedor

No es técnico. Su día es una bandeja donde algunas conversaciones las lleva la IA sola y otras necesitan que intervenga. **Del subsistema de workflows necesita que funcione sin configurarlo**, y entender por qué un lead recibió cierto mensaje.

### 2.2 El administrador

Configura el agente, define automatizaciones, arma difusiones. **Tampoco es técnico.**

**[DECISIÓN]** Este usuario gobierna el diseño del constructor. Cualquier mecanismo que exija escribir una expresión o código está fuera del producto — no porque sea difícil de construir, sino porque no lo va a usar. Respaldo empírico en §5.4.

### 2.3 Quien opera la difusión

**Lo que necesita, y ninguna de las 25 plataformas investigadas le da:** saber, _antes_ de apretar enviar, qué le va a pasar a su número, a quién le va a llegar exactamente, y cuánto va a costar.

---

## 3. Estado verificado del sistema

El subsistema de workflows **parece terminado y no funciona**. Verificado contra la rama `workflows-fundacion` (HEAD `9fe030e`).

### 3.1 Lo que sí funciona

| Pieza                           | Estado                                                                             |
| ------------------------------- | ---------------------------------------------------------------------------------- |
| Pipeline conversacional         | **Funciona.** Probado con WhatsApp real: 21 mensajes, tool calls, costo persistido |
| Agente vendedor con catálogo    | **Funciona.** Configurable desde `/agente` sin tocar código                        |
| Lead Twin con procedencia       | **Funciona.** Campo por campo                                                      |
| Etiquetado automático por regla | **Funciona.** Verificado contra Postgres real                                      |
| Escalado a humano               | **Funciona.** 8 `reason_code` tipados                                              |
| Canvas visual                   | **Se dibuja y se guarda.** `@xyflow/react` 12.11.5, 21 tipos, 6 formularios        |
| Motor con reintentos            | **Existe y está testeado.** 21 handlers, cobertura 21/21                           |

### 3.2 Los tres cortes

**[VERIFICADO] Corte 1 — dos motores que no se hablan.** `engine/handlers/` registra 21 handlers; su único consumidor es `workflows-admin.service.ts`, el botón **Probar**. Producción va por `workflow-segmento.ts` → `ejecutor.service.ts` → un registro con **cuatro** entradas. **Lo que el administrador prueba no es lo que corre.**

El comentario sobre `ACCIONES` en `src/lib/workflows/catalogo.ts` advierte textual que si las listas no se mueven juntas _"el motor tira `accion_desconocida` en la corrida"_. Alguien vio venir la divergencia, la documentó, y divergieron igual.

**[VERIFICADO] Corte 2 — un grafo del canvas no arranca.** `src/lib/workflows/recorrer.ts:8`:

```ts
return grafo.nodos.find((n) => n.tipo === "disparador");
```

Busca el tipo _legacy_. La paleta inserta `trigger_mensaje` y siete más. El run muere con `grafo_sin_disparador`. El ejecutor real reconoce 3 disparadores contra 8 de la paleta.

**[VERIFICADO] Corte 3 — nadie dispara nada.** `workflow/disparo.recibido` tiene consumidor y **cero emisores**. Un `grep` sobre `src/` y `tests/` devuelve su propia definición en `src/inngest/events.ts:139`.

### 3.3 Por qué los 2.241 tests pasan igual

Cada mitad se testea contra sí misma. `catalogo-vs-handlers.test.ts` verifica 21 handlers para 21 tipos — correcto, verdadero, y ciego a que producción usa otro registro. **Los criterios de §13 exigen ejecución real. Nunca cobertura.**

### 3.4 Construido y desconectado

**[VERIFICADO]** Sin un solo importador: `PublishDialog`, `VersionHistory`, `VersionSelector`, `VersionBadge`, y las ocho piezas de `components/workflows/history/`. Cuatro Server Actions existen sin consumidor. **El historial de ejecuciones y el versionado ya están escritos.** Falta cablearlos.

### 3.5 La difusión no existe

**[VERIFICADO]** `campanias` es `{ nombre, desde, hasta }` — un rango de fechas para **atribuir** resultados en `/metricas`. No hay audiencia, plantilla, envío, programación ni opt-out.

Tampoco estaba en el catálogo de 57 que la rama podó: ese tenía HTTP Request, código JavaScript, Google Sheets y base de datos externa — plomería de n8n — y no tenía difusión. **El diagnóstico correcto no es "57 era mucho" ni "21 es poco": es que el catálogo tenía nodos de otro producto y le faltaban los propios.**

---

## 4. Las restricciones de Meta

El marco físico del producto.

### 4.1 Límites de mensajería

**[VERIFICADO — [messaging-limits](https://developers.facebook.com/docs/whatsapp/messaging-limits)]**

Tiers: **250 → 2.000 → 10.000 → 100.000 → ilimitado**. Números **únicos** contactables **fuera de la ventana de servicio**, en **ventana móvil de 24 horas**.

**[VERIFICADO — [upcoming-messaging-limits-changes](https://developers.facebook.com/documentation/business-messaging/whatsapp/upcoming-messaging-limits-changes/)]** El **7 de octubre de 2025** los límites pasaron **de por número a por business portfolio**. Todos los números comparten el cupo. **Comprar números no multiplica nada** — invalida el workaround más difundido del mercado Latam.

**Para subir de tier:** calidad alta en todos los números y plantillas **y** haber usado **≥50% del cupo en 7 días**. Upgrade en ~6 horas. Las caídas de calidad **no bajan el tier**; pausan el escalado.

**[DECISIÓN]** Existe un **ramp óptimo**: enviar poco congela el tier, enviar mal quema la calidad. Es un problema de control con realimentación y todo el mercado lo trata como un botón.

**[SIN VERIFICAR]** ManyChat lista el segundo escalón en 2.000, Kommo en 1.000. **No hardcodear: leer el tier real por API.**

### 4.2 Throughput

**[VERIFICADO]** 80 mensajes/segundo por número (hasta 1.000 por upgrade). **1 mensaje cada 6 segundos al mismo destinatario.** Ráfaga de 45 en 6 segundos pidiendo prestado. Backoff desde 4 segundos.

El límite por destinatario es la clave del diseño. Ver §6.1.

### 4.3 El cap de marketing de Meta — entre negocios y por orden de llegada

**[VERIFICADO — [per-user-limits](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/marketing-templates/per-user-limits)]**

`131049` no es un tope propio: **una persona recibe plantillas de marketing de una cantidad limitada de negocios** en una ventana móvil de **7 días**, repartida **por orden de llegada** y calibrada según su read rate reciente. Rebota con `131049` y hay que esperar ≥24h.

**No aplica en el EEE, Reino Unido, Japón ni Corea del Sur — o sea que aplica en toda Latam.** Los mensajes dentro de una ventana de servicio abierta **no cuentan** contra ese límite.

**[DECISIÓN]** De acá sale un requisito que ninguna plataforma modela: **la hora a la que sale la difusión decide si entrás o si otro negocio ya consumió el cupo de esa persona.** Ver §7.3.

### 4.4 Códigos de error y política de reintento

**[VERIFICADO — [error-codes](https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes/)]**

| Código              | Significado                                          | ¿Reintentable?                |
| ------------------- | ---------------------------------------------------- | ----------------------------- |
| `130429`            | Throughput de Cloud API alcanzado                    | **Sí**                        |
| `131056`            | Demasiados mensajes al mismo destinatario            | **Sí**, a otros destinatarios |
| `131064`            | Límite por violaciones de clasificación de plantilla | **Sí**, tras el período       |
| `131047`            | Pasaron >24h desde la última respuesta               | **No** — mandar plantilla     |
| `131049`            | Cap de marketing por usuario                         | **No** dentro de la ventana   |
| `131050`            | **El usuario se dio de baja de marketing**           | **No. Nunca.**                |
| `131048`            | Calidad del emisor degradada por bloqueos previos    | **No** — alerta               |
| `132015` / `132016` | Plantilla pausada / deshabilitada permanentemente    | **No**                        |
| `368` / `131031`    | WABA restringida por política                        | **No** — kill switch          |

**[DECISIÓN]** Esta tabla **es** la política de reintento del planificador, no una referencia.

### 4.5 Template pausing y pacing — el canary que Meta hace y los vendors no

**[VERIFICADO — [template-pausing](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-pausing/)]**

- **Pausado escalonado:** primera pausa **3 horas**, segunda **6 horas**, tercera **deshabilitado permanentemente**. Webhook `message_template_status_update`.
- **Pacing:** plantillas nuevas, recién despausadas o sin calidad verde se entregan en lote con revisión de calidad entre tandas. **Si el feedback es negativo, los mensajes siguientes se dropean.**
- **Un template pausado por pacing no se auto-despausa.** Requiere `POST /{id}/unpause` a mano o queda bloqueado.

**[SIN VERIFICAR — fuente tercera, Infobip]** Existe _business portfolio pacing_ para portfolios con **<500.000 mensajes de plantilla en 365 días**. Ese es exactamente el volumen de este producto. **Si se confirma, las difusiones van a salir paceadas por Meta sí o sí**, y el planificador tiene que cooperar con ese pacing, no pelearse. **Confirmar antes de diseñar contra esto.**

### 4.6 La escalera de sanciones

**[VERIFICADO — [policy-enforcement](https://developers.facebook.com/docs/whatsapp/overview/policy-enforcement)]**

Advertencia → bloqueo de **1 o 3 días** para plantillas → bloqueo de **5, 7 o 30 días** para todo mensaje **y para agregar números** → **lock indefinido** → deshabilitación permanente. Apelación en 24-48h, y _no todas las violaciones de spam son apelables_.

**[DECISIÓN]** El producto muestra en qué escalón está la cuenta y qué la llevó ahí.

### 4.7 Escalada humana obligatoria

**[VERIFICADO — política vigente desde 2020-10-30]** Todo flujo automatizado **debe** ofrecer al menos una vía a una persona. Sin ella el quality rating cae a "low", y **si no se resuelve en 7 días se restringen las notificaciones**.

Este CRM ya lo cumple. Ahora está registrado como requisito de política, no como preferencia de producto.

### 4.8 Ventanas y costo

**[VERIFICADO — [pricing](https://developers.facebook.com/docs/whatsapp/pricing/)]**

- **Por mensaje entregado desde 2025-07-01**, no por conversación.
- _"All non-template messages are free"_ dentro de la ventana de servicio de 24h.
- _"Utility templates delivered within an open customer service window are free."_
- **Free Entry Point: 72 horas** tras Click-to-WhatsApp Ad o CTA de Página — _"you can send any type of message to the user at no charge."_
- Marketing **siempre se cobra**.
- Cambios de tarifa el **1-oct-2026** en Bangladesh, Irak, Nepal, Sri Lanka, Kazajistán, Kuwait, Marruecos, Omán y Ucrania. **Ninguno de Latam.**

**[DECISIÓN]** El FEP de 72h es un objeto **distinto** de la ventana de 24h y casi nadie los separa. Para venta de repuestos vía Click-to-WhatsApp Ads es el canal de adquisición más barato disponible.

### 4.9 Otros límites

**[VERIFICADO]** 250 plantillas por WABA sin verificar, 6.000 verificado, **máximo 100 creaciones por hora**.

### 4.10 Sin verificar

**[SIN VERIFICAR]** Enumeración completa de `quality_rating` (confirmados `GREEN`, `NA`, `UNKNOWN`). Definición y duración del estado "Flagged". Esquema del webhook `user_preferences`. Elegibilidad de la Marketing Messages API. Ventana exacta del quality rating del número.

---

## 5. Análisis competitivo

25+ plataformas contra documentación primaria. Lo que sigue es lo que cambia decisiones.

### 5.1 Qué pasa cuando se excede el cupo — nueve de nueve fallan

| Plataforma                               | Comportamiento                                                                                                                                                           |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **respond.io**                           | _"If you exceed the number of broadcast messages allowed, **the entire broadcast will not be sent**."_ Sin cola, sin envío parcial                                       |
| **Wati**                                 | Ante `132015`: campaña a **"Stopped"**, _"all message sending is immediately halted"_. **No encola ni reintenta.** Email a admins, recreación manual con sufijo `_retry` |
| **Twilio**                               | **Encola** hasta 4h (WhatsApp) o 10h (SMS) y después **falla** con `30001`/`63018`. Sin pacing contra el tier                                                            |
| **Take Blip**                            | **Expone** quality rating y tier, educa sobre bloqueos — **no tiene pacing**. Avisa; no administra                                                                       |
| **Callbell**                             | **Ni menciona los tiers.** Su artículo se titula _"sin limitaciones"_ y no cubre el tema                                                                                 |
| **Zenvia**                               | Única primitiva real: _"Enviar mensajes por lotes"_. **Manual, no consciente del tier**                                                                                  |
| **Braze**                                | Throttling 10–500.000 msg/min, **aborta a las 72h**                                                                                                                      |
| **Infobip / Zoko / ManyChat / Intercom** | **No documentan el comportamiento**                                                                                                                                      |
| **Meta, por debajo**                     | **Falla mensaje por mensaje** (`131064`, `130429`). No encola nada                                                                                                       |

**Nadie encola y drena respetando el tier.** El único control de ritmo expuesto al usuario en todo el set es el **Custom Send Rate de respond.io** — y es add-on pago.

### 5.2 Defaults inseguros, medidos

| Plataforma         | Default                                                                                                                             |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| **MoEngage**       | 🚨 _"All the Flows created by default ignore both FC and DND settings."_ Los journeys ignoran los caps salvo que los actives a mano |
| **Customer.io**    | _"By default, no workflow counts towards a limit"_                                                                                  |
| **ActiveCampaign** | Re-entrada en **"any number of times"** por default                                                                                 |
| **Twilio**         | Advanced Opt-Out (que **sí cubre WhatsApp**) viene **apagado**, y una vez activado **solo se desactiva contactando a soporte**      |
| **MoEngage**       | Deduplicación por identificador: **default OFF**                                                                                    |
| **Braze**          | ✅ Re-entrada **OFF**, cap de workspace **ON**                                                                                      |
| **CleverTap**      | ✅ _"The Global Campaign Limit is enabled by default"_                                                                              |
| **Klaviyo**        | ✅ Smart Sending **ON** en todas las campañas (16h email / 24h SMS)                                                                 |

**[DECISIÓN]** Este producto es **seguro por defecto**, y lo declara en la UI. Ver §7.4.

### 5.3 El mercado abandonó el retorno de control de la IA

| Plataforma       | Modelo                                                                                                                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **respond.io**   | _"The Workflow stops once the AI Agent takes over."_ **El control no vuelve.** Su único diseño con retorno determinístico (`AI Objective`, 5 ramas) está marcado _"will be removed in the near future"_ |
| **Intercom Fin** | _"Reassigning the conversation, changing the ticket state, or leaving an internal note **does not stop Fin** — only a reply visible to the customer ends Fin's session"_                                |
| **Infobip**      | _"When you redirect to an agent, the agent takes over the chat. **Chats cannot be sent back to the chatbot.**"_ **Terminal**                                                                            |
| **Take Blip**    | El AI Agent se queda con la conversación. Condición de retorno **no documentada**                                                                                                                       |
| **Wati**         | El mejor: la IA emite **4 eventos semánticos** capturables — _unable to answer_, _intent to speak with a human_, _chat resolved_, _no response_                                                         |
| **Zenvia**       | El más limpio de Latam: documenta **transferencia de chatbot de IA generativa → chatbot de flujos** como operación de primera clase                                                                     |
| **Callbell**     | La IA es un **nodo** que produce una variable. El control nunca sale del flujo. Usa el token OpenAI del cliente                                                                                         |
| **Twilio**       | `Live Agent Handoff` **es una transición** que retorna al Studio Flow                                                                                                                                   |

**[VERIFICADO] Ninguno publica umbral de confianza, máximo de intentos ni keyword de escape.**

La arquitectura de este CRM —intents y reglas antes del LLM, extractor como paso propio, agente con tool calling que devuelve al pipeline— es el modelo que el mercado abandonó.

### 5.4 La queja #1 contra n8n son las expresiones

**[VERIFICADO]** Con causa raíz identificable: **Switch, Code y Merge rompen el `pairedItem`**, y el workaround real es intercalar nodos `Set` redundantes por todo el flujo. Su sandbox de expresiones tuvo un **RCE (CVE-2026-27577)**.

Respalda §2.2 y §9.5: **ninguna condición del producto se expresa como código.**

### 5.5 Lo que ninguna plataforma hace

1. **Mostrar la lista exacta de destinatarios.** Braze samplea con IC 95% ±1%. Nadie ofrece un diff contra el envío anterior.
2. **Previsualizar el costo.** Con facturación por mensaje entregado, _"vas a impactar 4.000 leads"_ debería decir cuánto cuesta y en qué categoría. **Ningún vendor lo hace en el builder.**
3. **Modelar la ventana de 24h como decisión de ruteo.** Sesión gratis vs plantilla paga es una decisión por destinatario y por momento; todos tratan WhatsApp como un canal más.
4. **Canary propio.** Meta lo hace (template pacing). Ningún vendor ofrece _"mandá a 200, mirá bloqueos, seguí o abortá"_.
5. **Sacar del journey a quien el cap saltó.** Braze textual: _"global frequency capping alone doesn't exit users from a Canvas"_ — el usuario avanza en silencio y el paso siguiente le pega.
6. **Detener de verdad.** Braze documenta que un Canvas parado **sigue enviando**: lo entregado al proveedor no se recupera.
7. **Re-evaluar el segmento al enviar diferido.** Braze: los retenidos por quiet hours salen **todos juntos** al abrir la ventana, y **la pertenencia al segmento no se re-evalúa**.
8. **Resolver identidad completa.** Klaviyo deduplica SMS por número entre perfiles, pero email por perfil: dos perfiles de la misma persona reciben dos veces.
9. **Cumplir Latam.** De 25+ plataformas, **solo Take Blip tiene material real de LGPD** (DPO nombrado, _"não realiza transferência internacional de dados"_, datos en Brasil, 15 días). **Ley 25.326, LFPDPPP, Ley 19.628 y Ley 1581 no las menciona ninguna.**

### 5.6 Fallas reales documentadas

**[VERIFICADO] `accepted` ≠ entregado.** La queja técnica más reproducible que existe. La API devuelve 200 y un `wamid` y el mensaje nunca llega. Cinco hilos independientes: _"WhatsApp accepts the request and returns a `wamid`, but it silently blocks delivery"_ · _"only means the WhatsApp API accepted the request — it doesn't mean the message was actually delivered"_. **Ningún vendor lo expone en su UI.**

**[VERIFICADO] El bot pisa al agente humano.** _"if I reply manually, user gets double message (bot + me)"_ · _"Human takeover is also messy"_. La solución que circula en la comunidad es una tabla `human_mode` con `active_until` que **auto-resetea a 24h porque el dueño se olvida de desbloquear**.

**[VERIFICADO] Webhooks duplicados.** _"When one customer sends a message, it executes 50 times."_ Causa: **Meta reintenta si no recibe 200 rápido**. Mitigación documentada: responder 200 antes de procesar.

**[VERIFICADO] Fuga de contexto entre clientes.** _"Simple Memory bleeds context across users"_ — si el `sessionId` no está estrictamente scopeado por persona, la IA mezcla conversaciones.

**[VERIFICADO] Postmortem real (Buttondown, 16-oct-2025, 10:39–10:47).** Un bug de rate limiting a nivel dominio rompió una invariante y disparó duplicados masivos en 5 newsletters. Mitigación: feature flag, rollback, pausa total, fix en 23 minutos. **El fix estructural es barato y copiable:** un chequeo de que **los destinatarios filtrados nunca superen el lote inicial** (M ≤ N), más alertas por entrega duplicada al mismo destinatario y por conteo de eventos muy por encima del de suscriptores.

**[VERIFICADO] "Le mandamos a toda la base": la causa #1 es lógica booleana** — condiciones OR fuera de paréntesis y negaciones demasiado amplias.

**[VERIFICADO] Journeys que fallan en silencio.** En SFMC el contacto entra bien y falla en el paso 5 tres días después; **el journey figura en verde mientras dropea contactos**.

**[VERIFICADO] Editar una plantilla detiene campañas.** CleverTap: _"If you edit a template, then all the campaigns and journeys using this template will be stopped."_ Y solo se puede editar una vez cada 24h.

**[VERIFICADO] Números baneados, con testimonio de clientes reales.** 18 reportes fechados. Casos extremos: _"Mande 7 mensajes y whataspp me bloqueo la cuenta"_ (Leadsales, Chile) · _"nos cobraron cerca de 500€ por rompernos un número"_ (Callbell) · _"our Meta Business was restricted and one of our telephone numbers was permanently blocked… Meta specifically referred to apparent automation that did not comply"_ (Wati).

**[VERIFICADO] Lock-in.** 360dialog: la función de migrar el número **no funciona** (_"feature that is supposed to enable you to migrate your number... does not work"_). Wati: _"They're holding my business phone number hostage"_ y _"I only have READ-ONLY access to MY OWN business accounts"_.

### 5.7 El QR no oficial es endémico en la PyME latinoamericana

**[VERIFICADO]** Whaticket ofrece conexión por QR junto a la API oficial, y **su propio blog recomienda la API oficial** _"para evitar bloqueos o baneos de tu número por parte de Meta"_. Leadsales usa API no oficial en su plan de US$97. Blip advierte que usar herramientas no autorizadas _"viola las políticas de la plataforma"_.

**[DECISIÓN]** Ser **BSP-oficial-only** es un diferenciador defendible en Latam, no una limitación. El número baneado es la pérdida más cara del segmento y el mercado ya lo sabe.

### 5.8 Precio del "unlock" — contexto para la licencia

**[VERIFICADO]**

| Plataforma       | Precio para workflows + difusión                                                                               |
| ---------------- | -------------------------------------------------------------------------------------------------------------- |
| **Infobip**      | Moments Scale €1.499 + Answers Scale €1.259 + 5×€131 Conversations ≈ **US$3.700/mes antes de un solo mensaje** |
| **Twilio**       | 5 seats Flex US$750 + TaskRouter ~US$258 (a $0,06/task, 1.000 leads/semana) ≈ **US$1.010/mes** + $0,005/msg    |
| **respond.io**   | **US$159/mes** (Growth); US$279 si necesitás HTTP o webhooks                                                   |
| **Wati**         | ~US$119/mes + Astra AI aparte (US$99–399)                                                                      |
| **Kommo**        | US$25/usuario/mes → **US$35 desde 2026-09-01**. Salesbot y Broadcasting **no están en el plan Base**           |
| **Intercom**     | US$29–132/seat + Fin a **$0,99 por outcome** ($9,99 por qualification)                                         |
| **Zenvia**       | R$600–3.900/mes según plan + canales aparte                                                                    |
| **Take Blip Go** | R$299/mes + R$0,60 por disparo                                                                                 |
| **360dialog**    | €49–99 por número, **zero markup** sobre Meta                                                                  |

**[VERIFICADO]** La única palanca de residencia de datos entre los vendors globales es el **dedicated hosting de Wati a US$1.000/mes**. Lo que la competencia vende como add-on caro, acá es la arquitectura por default.

---

## 6. La tesis: qué hace a este producto mejor

Seis ventajas. Las cuatro primeras salen de una propiedad que la competencia no tiene: **acá la conversación, la automatización y la difusión son un solo sistema con una sola base de datos.**

### 6.1 Difusión y agente no se pisan

Meta permite **1 mensaje cada 6 segundos al mismo destinatario**. Una difusión y el agente respondiendo a esa persona **compiten por la misma cuota**; cuando chocan, sale `131056`. Donde campañas y bot son módulos separados, el choque es estructural. El síntoma que ve el cliente es peor que un error técnico: recibe una promoción genérica en medio de una negociación de precio.

**[DECISIÓN]** La difusión consulta el estado conversacional antes de encolar:

- Lead con **sesión activa** y entrante reciente → **no sale**. Se pospone o se descarta, según lo elija la campaña.
- Lead en `negociando` o `esperando_pago` → **excluido por defecto**. Forzable con confirmación explícita.
- Lead en `requiere_humano` → **excluido siempre**. Hay una persona a cargo.

### 6.2 El presupuesto de riesgo del número, administrado

**[DECISIÓN]** El cupo y la calidad son un recurso escaso con realimentación, no un botón. Si la campaña excede el cupo, **no se manda igual ni falla**: se reparte en el tiempo respetando la ventana móvil, y se dice antes de arrancar.

**Respaldo:** nueve de nueve plataformas fallan acá (§5.1).

### 6.3 Opt-out reconciliado, e irreversible

**[DECISIÓN]** Lista de supresión propia **más** las señales de Meta (`131050` y el webhook `user_preferences`), reconciliadas **antes de encolar**.

**La supresión es irreversible por escritura automática** — modelo Zoko, no modelo Wati. Ni un import de CSV ni la API reactivan a quien se dio de baja; solo una acción humana explícita y auditada.

**[DECISIÓN]** Keywords en **español y portugués**: BAJA, SALIR, PARAR, CANCELAR, SAIR, PARE. **Ninguna de las 25 plataformas las documenta** — todas asumen STOP en inglés.

### 6.4 Un solo motor, sin simulador paralelo

**[DECISIÓN]** "Probar" ejecuta **el mismo motor** que producción, con los efectos externos interceptados. La causa raíz del Corte 1 fue tener dos.

### 6.5 La IA devuelve el control, siempre

**[DECISIÓN]** Todo tramo delegado tiene un destino final definido **al diseñarlo**. `timeout_minutos` es obligatorio y el nodo no se guarda sin él.

**[DECISIÓN]** La pausa manual de la IA lleva **timeout de reactivación configurable**. La comunidad lo aprendió a los golpes: sin él, alguien se olvida de desbloquear y el lead queda huérfano.

### 6.6 Honestidad sobre la entrega

**[DECISIÓN]** El producto **nunca llama "enviado" a un HTTP 200**. Los estados son: _encolado_ → _aceptado por Meta_ → _entregado_ → _leído_, más _falló, y por qué_. `accepted` es un estado propio y visible, no un sinónimo de éxito.

Es la queja técnica más reproducible del mercado (§5.6) y **ningún vendor la expone**. Y es la misma clase de bug que ya mordió a este proyecto: PostgREST cortaba en 1.000 filas sin un error en ningún log.

---

## 7. El motor unificado

### 7.1 Reunificación — antes de cualquier capacidad nueva

**[DECISIÓN]**

1. **Un solo registro de acciones.** El de `engine/handlers/` absorbe al de `acciones/registro.ts`.
2. **Un solo mecanismo de disparo.** `disparadorDe()` reconoce los `trigger_*` vía `esTrigger()`. Los 5 tipos legacy se migran y se eliminan del schema.
3. **Emisores reales.** `on-message-received`, cambio de etiqueta y cambio de etapa emiten `workflow/disparo.recibido`.

**Criterio no negociable:** un workflow armado en el canvas, publicado, se dispara con un mensaje real de WhatsApp y deja filas en `workflow_runs` y `workflow_run_pasos`. Verificado con `SELECT`.

### 7.2 Modelo

**[VERIFICADO]** El modelo actual es correcto y se conserva.

```ts
interface Grafo {
  nodos: Nodo[];
  aristas: Arista[];
}
interface Nodo {
  id: string;
  tipo: NodoTipo;
  config: Record<string, unknown>;
  posicion: { x; y };
}
interface Arista {
  desde: string;
  hasta: string;
  puerto: "salida" | "verdadero" | "falso";
}
```

Tablas existentes: `workflows`, `workflow_versiones`, `workflow_runs`, `workflow_run_pasos`, con CAS por `pasos_ejecutados` y política de concurrencia.

**[DECISIÓN]** `max_salientes_automaticos_24h` (default 3) ya está en el schema y **se aplica también a la difusión**.

### 7.3 El planificador de envío

**[DECISIÓN]** Ninguna difusión escribe directo a Meta. Todas pasan por un planificador que:

1. Consulta el cupo restante de la ventana móvil de 24h, **leído por API, no hardcodeado**.
2. Resta la reserva para conversaciones vivas.
3. Excluye por supresión propia, señales de Meta, y las reglas conversacionales de §6.1.
4. Aplica el frequency cap propio.
5. **Prefiere la ventana de servicio abierta sobre la plantilla paga** cuando ambas son posibles — decisión por destinatario, gratis en vez de paga, y no cuenta contra `131049`. Ninguna plataforma lo hace.
6. **Ordena por urgencia del cupo de marketing:** el cap de `131049` se reparte por orden de llegada entre negocios (§4.3), así que la hora de envío importa.
7. Reparte respetando 80 msg/s global y 1 msg/6s por destinatario, **cooperando con el pacing de Meta** en vez de pelearse con él.
8. Reacciona a errores en vuelo según la tabla de §4.4: `132015` saca la plantilla **y avisa que requiere despausado manual**; `131048` alerta; `368` frena todo.

**[DECISIÓN] Invariante del pipeline**, tomada del postmortem de Buttondown: **los destinatarios finales nunca pueden superar el tamaño del lote inicial.** Si la invariante se rompe, el envío se aborta antes de la primera llamada a Meta. Más alertas por entrega duplicada al mismo destinatario y por conteo de eventos muy por encima del de destinatarios.

### 7.4 Seguro por defecto

**[DECISIÓN]**, contra los defaults medidos en §5.2:

- Re-entrada a un workflow: **apagada**, con ventana numérica configurable.
- Frequency caps: **aplican a los workflows por defecto**. La exención es explícita, por campaña, y **queda en la auditoría**.
- Deduplicación por identificador (teléfono, email): **encendida**. Dos leads que comparten teléfono reciben **uno**.
- Opt-out: **encendido**, irreversible por escritura automática.
- Cuando un cap salta un mensaje, **el lead sale del workflow** en vez de avanzar en silencio al paso siguiente. Es el bug que Braze documenta contra sí mismo.
- Cada mensaje saltado deja un **evento con motivo** (`cap_frecuencia`, `opt_out`, `sin_ventana`, `conversacion_activa`, `saturado_meta`). Sin esto no se puede auditar por qué alguien no recibió.

---

## 8. Difusión — el subsistema nuevo

### 8.1 Modelo

- **Audiencia** — conjunto de leads por filtros. Dinámica o congelada.
- **Difusión** — audiencia + plantilla + plan de envío + ventana horaria.
- **Envío** — una fila por destinatario, con estado de entrega y motivo de exclusión.

### 8.2 El constructor de audiencia

**[DECISIÓN]** Filtros visuales anidables con Y/O. Campos: etapa, etiquetas, motivo de pérdida, vehículo, última actividad, canal, vendedor, campos del Twin, campañas previas.

**[DECISIÓN]** El agrupamiento booleano es **explícito y visual** — cajas anidadas, no texto. La causa #1 de "le mandamos a toda la base" es un OR fuera de paréntesis (§5.6).

**[DECISIÓN]** Separar **"los que ya matchean"** de **"los que matcheen de ahora en más"**. Es el footgun que manda a toda la base histórica.

El tamaño se muestra en vivo mientras se editan los filtros, con desglose de exclusiones y su causa.

### 8.3 La pantalla de pre-vuelo

**[DECISIÓN]** El diferenciador más visible. Antes de confirmar:

- **La lista exacta de destinatarios**, no un estimado muestreado, con **diff contra el envío anterior**. Ninguna plataforma lo ofrece.
- Desglose de exclusiones: baja propia, baja en Meta (`131050`), saturados (`131049`), en conversación activa, en negociación, sin ventana abierta, duplicados por teléfono.
- **Cupo:** restante de la ventana móvil, consumo de esta difusión, reserva para conversaciones.
- **Si no entra**, el plan de reparto: cuántos hoy, cuántos mañana, cuándo termina.
- **Costo estimado**, por categoría y mercado, separando lo que sale gratis por ventana abierta de lo que se cobra. **Ningún vendor previsualiza el costo.**
- **Salud:** quality rating, escalón de sanción, plantillas pausadas y cuáles requieren despausado manual.
- **Canary:** enviar a los primeros N, revisar bloqueos y calidad, y recién entonces continuar o abortar. Meta hace esto con sus plantillas; ningún vendor lo ofrece.
- Envío de prueba a un número propio.

### 8.4 Después del envío

**[DECISIÓN]** La respuesta entra al pipeline conversacional normal: abre ventana de 24h, el agente puede atenderla, y dispara el trigger "Difusión respondida". **No hay bandeja separada de respuestas de campaña.**

**[DECISIÓN]** Se adopta el mejor patrón encontrado (Wati): si la plantilla tiene botones de respuesta rápida, **cada botón se configura con su propia acción dentro del mismo wizard de campaña**.

### 8.5 Frenar en curso

**[DECISIÓN]** Botón siempre visible. Detiene lo pendiente y **dice con precisión qué ya no se puede recuperar** — a diferencia de Braze, que deja creer que detuvo. Nunca reintenta lo enviado. Se activa solo ante `368`, `131031` o `131048`.

### 8.6 Envío diferido

**[DECISIÓN]** Los mensajes retenidos por ventana horaria **se re-evalúan contra el segmento al momento de salir**, y **salen escalonados**, no todos juntos. Braze documenta las dos fallas: estampida al abrir la ventana, y audiencia podrida por no re-evaluar.

---

## 9. Catálogo de nodos

**[DECISIÓN]** El criterio no es "cuántos", es **de qué producto es este nodo**. Entra comunicación, difusión y gestión del lead. Queda fuera la plomería genérica de integración.

### 9.1 Disparadores

Mensaje recibido · Etiqueta asignada/removida · Etapa cambiada · Lead creado · Inactividad · Programado · Manual · Vendedor asignado · **Difusión respondida** · **Baja de marketing** (dispara con `131050`).

**[DECISIÓN]** Todo disparador lleva `intercepta_llm: boolean`. Los que **responden** ganan uno y cortan el LLM ese turno; los que **etiquetan** corren todos y no cortan nada.

### 9.2 Mensajería

Enviar mensaje · Enviar plantilla · Mensaje con botones · Mensaje de lista · Imagen / documento · Ubicación · Reacción.

**[DECISIÓN]** Cada nodo declara si es de servicio o de marketing. El motor **rechaza al validar**, no en ejecución, un envío de marketing fuera de ventana sin plantilla aprobada.

### 9.3 Difusión

Definir audiencia · Enviar difusión · Excluir · Esperar respuesta de difusión · Dividir audiencia (A/B con grupo de control).

### 9.4 CRM

Etiquetar · Cambiar etapa · Asignar vendedor · Round robin · Actualizar campo del Twin · Agregar nota · Escalar a humano (8 `reason_code`) · Marcar spam · Archivar.

### 9.5 Lógica

Condición · Switch · Esperar tiempo · Esperar respuesta · Esperar evento · Iterar · Ir a nodo · Detener · Manejador de error.

**[DECISIÓN]** La condición **nunca** se expresa como código. Siempre `campo → operador → valor`.

### 9.6 IA

Delegar al agente · Clasificar intent · Extraer datos al Twin · Analizar sentimiento · Resumir conversación · Verificar spam.

**El nodo de delegación** [VERIFICADO — ya existe como `ia_delegar`]:

```
instrucciones_adicionales?: string
condicion_contenido?: { intent_detectado } | { campo_twin }
al_retornar_por_contenido: "continuar" | "escalar_humano"
timeout_minutos: number          // SIEMPRE presente. Default 1440
al_retornar_por_timeout: "continuar" | "escalar_humano"
```

**[DECISIÓN]** Ramas de salida explícitas — el modelo del `AI Objective` que respond.io está eliminando, más los eventos semánticos de Wati: resuelto por contenido, pidió humano, no pudo responder, sin respuesta del lead, error técnico.

**[DECISIÓN]** El `sessionId` de toda memoria conversacional se scopea **estrictamente por lead**. La fuga de contexto entre clientes está documentada como falla real (§5.6).

### 9.7 Internos

Notificar vendedor · Notificar grupo · Comentario interno.

---

## 10. Pantallas

**[VERIFICADO]** Barra lateral de 222px con 7 entradas: Inbox, Leads, Productos, "OpenAI settings" (`/agente`), "Flujos" (`/workflows`), Métricas, Ajustes.

### 10.1 Estado actual

| Pantalla                           | Estado                                                                      |
| ---------------------------------- | --------------------------------------------------------------------------- |
| `/inbox` + `/inbox/[leadId]`       | Implementada. Tres paneles, `min-w-[1164px]`. La más completa               |
| `/leads` + `/leads/[id]`           | Implementada                                                                |
| `/productos` + `/productos/import` | Implementada. **Catálogo vacío a propósito**                                |
| `/agente`                          | Implementada. 4 pestañas                                                    |
| `/workflows`                       | Implementada                                                                |
| `/workflows/[id]`                  | Canvas implementado. **Ejecuta contra un motor que no es el de producción** |
| `/metricas`                        | Implementada. 3 cortes                                                      |
| `/ajustes`                         | **Placeholder**                                                             |

### 10.2 Cambios requeridos

**[DECISIÓN]** Renombrar **"OpenAI settings" a "Agente"** — nombra al proveedor en vez de a la función.

**[DECISIÓN]** Entrada nueva: **"Difusión"**. La barra pasa a 8.

**[DECISIÓN]** Cablear lo ya construido (§3.4): historial de ejecuciones, versionado con rollback, diálogo de publicación.

### 10.3 El editor de workflows

**[DECISIÓN] Se conserva el canvas visual.** Es la representación correcta de un grafo con ramas y ya está construido. Lo que lo hacía difícil no era el canvas: era el catálogo prestado y las expresiones de código.

**Las cinco capacidades que ninguna herramienta tiene juntas:**

**1. Draft real + versión pinneada + diff visual sobre el canvas.**
Zapier tiene draft sin diff; n8n **no tiene draft** (se edita producción, historial de 24h en el plan base, con issues de pérdida de trabajo); Temporal tiene el versionado impecable pero no tiene canvas. Acá: el flujo vivo sigue corriendo mientras se edita el borrador; publicar crea una versión inmutable; **las corridas en vuelo terminan en la versión donde arrancaron** (modelo Pinned); y antes de publicar se muestra un **diff sobre el propio canvas**.

**2. Reanudar desde el paso fallido, con la memoización visible.**
Inngest ya memoiza por step ID (_"completed steps are never re-executed, even across deployments"_). Falta **mostrarlo**: pintar los nodos memoizados en gris ("se reusa el resultado del 14:32") y los que van a re-correr en color, **antes** de confirmar.

**[DECISIÓN]** Dos verbos distintos, con dos íconos distintos: **"Reanudar desde el fallo"** y **"Ejecutar de nuevo desde el principio"**. El segundo pide confirmación enumerando qué efectos externos se repiten. _El antipatrón de Zapier no es re-ejecutar todo: es llamar igual a las dos cosas — hay un hilo en su propio foro titulado "Replay Zap Run is misleading"._

**[DECISIÓN]** Y el arreglo tiene que llegar al run roto. La queja #1 de Make es que editás el escenario y la ejecución incompleta guardada sigue con el módulo viejo: _"build the fixes twice"_.

**3. Ejecuciones de producción en vivo sobre el canvas.**
El agujero de n8n: sus ejecuciones disparadas no actualizan el canvas porque _"non-manual executions don't have access to the Websocket/SSE connection"_ — justo cuando más se necesita ver el flujo corriendo. Este proyecto ya tiene Inngest emitiendo por step y Supabase Realtime.

**4. Mapeo de datos sin JavaScript.**
IDs estables internos mostrando el nombre (renombrar no rompe nada). Fan-out/fan-in **explícito en el modelo**, no item-linking mágico que se corta en silencio. Selector visual con **preview evaluado en vivo contra un payload real**.

**5. Errores accionables con el arreglo a un clic.**
En vez de _"Can't get data for expression"_: _"El nodo 'Buscar producto' no recibe `lead.vehiculo.marca` porque 'Clasificar intent' no lo emite. [Ver su salida] [Agregar el campo]"_.

**Mecánicas de base:**

- **Auto-layout de una tecla**, algoritmo layered (elkjs sobre dagre), **respetando la selección**, con **preview y undo de un paso** — el "Tidy Up" de n8n apiló los nodos y dejó el editor inusable.
- **Layout determinista.** Mismo grafo → mismas coordenadas. Precondición del diff visual.
- **Soltar un nodo sobre una arista lo inserta**; borrar uno del medio cose la arista y marca como _stale_ lo que dependía de él.
- **Arrastrar un cable al vacío abre la paleta filtrada** por tipo compatible.
- **Copiar/pegar nodos como JSON al portapapeles del sistema.**
- **Grupos colapsables anidables, guardados en el documento** — no en `localStorage`, como n8n, donde el compañero abre el flujo y ve otra cosa.
- **Reroute points** que solo doblan un cable y desaparecen en runtime.
- **Validación de tres severidades sobre el nodo.** Las 7 reglas ya existen en `REGLAS_VALIDACION`.
- **Prevenir la conexión inválida antes de soltarla.**
- **"Ejecutar hasta acá"** y **pin/mock de la salida de un paso** válido también en producción para dry-runs.
- **Orden de reglas explícito y reordenable.** Blip evalúa las reglas por orden de creación y **no se pueden reordenar** — trampa documentada por el propio vendor.
- Deshacer/rehacer sobre layout y configuración. Hit-areas gordas en los cables.
- **Plantillas de arranque:** crear un workflow abre una galería, no un lienzo vacío.

**[DECISIÓN] Presupuesto de rendimiento: 80 nodos a 60fps, medido en CI.** n8n se degrada a los ~50 y congela el navegador con 100+; ninguna herramienta publica un número. Si un flujo pasa de ~20 nodos en pantalla, la UI empuja a extraer un subflujo.

### 10.4 Ajustes

**[DECISIÓN]** Deja de ser placeholder: datos de la empresa, usuarios y roles, horario de atención, y **el panel de salud de WhatsApp** — números, quality rating, tier actual y progreso al siguiente, plantillas con su estado (marcando cuáles requieren despausado manual), escalón de sanción.

### 10.5 Retención de historial

**[DECISIÓN]** El historial de ejecuciones y de envíos **no caduca a los 30 días**. Braze retiene Messaging History 30 días; n8n retiene 24h en su plan base. Acá los datos son del cliente y viven en su propio Supabase — no hay razón de negocio para borrarlos, más allá de la purga de sesiones a 29 días que ya existe por diseño de privacidad.

---

## 11. Sistema de diseño

**[VERIFICADO]** `src/app/globals.css` (398 líneas), Tailwind v4 CSS-first sin archivo de configuración.

- **Familias:** `surface-*` (10), `line-*` (6), `ink-*` (8), `brand-*` (4), semánticos `ok/warn/caution/danger/info/special`.
- **Marca:** `--brand: #d61f1f`. **No se invierte entre temas.**
- **Radio base:** `0.5625rem`.
- **Ocho colores de etapa**, consumidos por `src/lib/ui/stage.ts`. El badge pinta texto sobre `color-mix` al 13% del propio color.
- **Tipografía:** Geist y Geist Mono. Regla del sistema: **todo dato que se compara o se escanea va en mono**.
- **Íconos:** alias sobre lucide en `src/components/icons.ts`.
- **13 componentes shadcn** vendorizados, estilo `base-nova`.
- **Escala de 2px.** `gap` en flex y grid, nunca márgenes por elemento.
- **Sin layout móvil.** El panel asume escritorio y scrollea horizontalmente bajo 1164px.

**[DECISIÓN]** El diseño de los nodos y de las pantallas de difusión usa **estos** tokens. Existe un `docs/design-system/workflow-nodes.md` sin commitear con una paleta propia por categoría que **no sale de los tokens del sistema**. Reconciliarlo antes de implementar, no después.

---

## 12. Riesgos

| Riesgo                                                                               | Mitigación                                                                                                  |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| **Bloqueo del número** — la pérdida más cara del segmento, con 18 casos documentados | Planificador con presupuesto de riesgo (§7.3), canary (§8.3), BSP oficial únicamente (§5.7)                 |
| **Enviar dos veces**                                                                 | Invariante M ≤ N, dedup por identificador encendida, alerta por entrega duplicada (§7.3, §7.4)              |
| **Enviar a toda la base**                                                            | Agrupamiento booleano visual, separación "ya matchean" vs "futuros", lista exacta en pre-vuelo (§8.2, §8.3) |
| **El bot pisa al humano**                                                            | Pausa con timeout de reactivación (§6.5); la difusión respeta conversaciones vivas (§6.1)                   |
| **`accepted` tomado por entregado**                                                  | Estados de entrega honestos (§6.6)                                                                          |
| **Webhook duplicado de Meta**                                                        | 200 inmediato antes de procesar, idempotencia por `meta_message_id` (ya existe en el schema)                |
| **Fuga de contexto entre clientes**                                                  | `sessionId` scopeado por lead (§9.6)                                                                        |
| **Plantilla pausada que nadie despausa**                                             | Alerta en el panel de salud, marcada como acción manual requerida (§10.4)                                   |
| **Catálogo vacío**                                                                   | Bloqueante declarado: sin catálogo el agente no vende y una difusión no tiene sentido                       |

---

## 13. Criterios de aceptación

Ninguno se cumple con tests unitarios.

### Motor

- [ ] Un workflow del canvas, publicado, se dispara con un mensaje real de WhatsApp y deja filas en `workflow_runs` y `workflow_run_pasos`. Verificado con `SELECT`.
- [ ] "Probar" ejecuta el mismo motor que producción. Existe un test que falla si reaparecen dos registros de acciones.
- [ ] Los 5 tipos legacy ya no están en el schema.
- [ ] Publicar no altera las corridas en curso.
- [ ] Un paso que falla se reintenta solo a sí mismo. Reanudar arranca desde `nodo_actual`.
- [ ] Editar un workflow y reanudar una corrida rota aplica el arreglo a esa corrida.

### Difusión

- [ ] 5.000 destinatarios con tier de 2.000 se reparte en el tiempo, no falla, y muestra el plan antes de arrancar.
- [ ] Un lead con conversación activa **no recibe** la difusión. Demostrado con una corrida real.
- [ ] Un lead que disparó `131050` queda suprimido y no vuelve a entrar a ninguna audiencia, **ni por import de CSV ni por API**.
- [ ] Dos leads que comparten teléfono reciben **un** mensaje.
- [ ] La invariante M ≤ N aborta el envío antes de la primera llamada a Meta si se rompe.
- [ ] El pre-vuelo muestra la **lista exacta**, exclusiones con motivo, cupo, costo y salud.
- [ ] Existe canary: enviar a N, revisar, continuar o abortar.
- [ ] Detener frena lo pendiente y **dice qué ya no se puede recuperar**.
- [ ] `132015` saca la plantilla y avisa que requiere despausado manual.
- [ ] Un mensaje saltado por cap deja evento con motivo, y el lead **sale** del workflow.
- [ ] "BAJA", "SALIR", "PARAR", "SAIR" dan de baja y responden confirmación.

### Constructor

- [ ] Un administrador no técnico arma una automatización de 6 pasos con dos ramas, sin escribir una expresión y sin ayuda.
- [ ] Ninguna condición se expresa como código.
- [ ] Insertar un nodo sobre una arista lo conecta solo; borrar uno del medio cose la arista.
- [ ] Los errores de validación se ven sobre el nodo culpable.
- [ ] Una ejecución de producción se ve en vivo sobre el canvas.
- [ ] "Reanudar desde el fallo" y "Ejecutar de nuevo" son dos acciones distintas con nombres e íconos distintos.
- [ ] Un nodo de delegación a IA no se guarda sin `timeout_minutos`.
- [ ] 80 nodos a 60fps, medido en CI.

### Salud y entrega

- [ ] `/ajustes` muestra tier, progreso al siguiente, quality rating y escalón de sanción.
- [ ] `phone_number_quality_update` y `message_template_status_update` están suscritos y alertan.
- [ ] La UI distingue _aceptado por Meta_ de _entregado_. Un 200 nunca se muestra como "enviado".

---

## 14. Lo que este documento no resuelve

1. **Cinco valores de Meta sin confirmar** (§4.10), más el _business portfolio pacing_ de §4.5, que viene de fuente tercera y **cambia el diseño del planificador si se confirma**. Verificarlo es la primera tarea.
2. **Fuentes inaccesibles en esta investigación:** Reddit, G2, Capterra, Gartner y Reclame Aqui bloquearon el acceso automatizado. Las quejas documentadas salen de Trustpilot (es/br/com), foros oficiales de vendor, GitHub y Hacker News. **Reclame Aqui es donde vive el volumen real de quejas brasileñas** y quedó sin leer.
3. **Comportamiento de las corridas en vuelo al publicar, en la competencia**: solo Temporal e Inngest lo documentan. Para el resto habría que probarlo a mano.
4. **SFMC**: los modos de re-entrada no se pudieron confirmar en fuente primaria y **no se afirman**.
5. **El catálogo de productos está vacío a propósito.** Espera el documento de siglas del dueño. Sin catálogo el agente no vende, y una difusión sobre un catálogo vacío no tiene sentido.
6. **No hay layout móvil** y este documento no lo define.
7. **Los integration tests siguen congelados** por falta de un proyecto Supabase aislado.
