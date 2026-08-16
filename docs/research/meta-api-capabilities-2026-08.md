# Meta API para el CRM — capacidades, brechas y roadmap

> Investigación negocio + técnica. Corte: **2026-08-13**. Fuentes primarias: documentación oficial de Meta y workspaces verificados de Meta en Postman. Ledger verificable: [`meta-api-source-ledger-2026-08.md`](./meta-api-source-ledger-2026-08.md).
>
> **Fuera de alcance:** catálogo, Commerce Manager, inventario, cambios de código, campañas reales, modificación de activos o credenciales y envíos reales.

## Resumen ejecutivo

Meta ofrece bastante más que “recibir y contestar texto”. Para este CRM hay cinco superficies útiles:

1. **Conversación enriquecida:** media, contexto de respuesta, reacciones, botones, listas, quick replies, estados de lectura y typing.
2. **Captura estructurada:** WhatsApp Flows e ice breakers de Instagram para pedir vehículo, pieza, ciudad, urgencia y fotografías sin depender de catálogo.
3. **Adquisición atribuible:** Click-to-Message, referrals de anuncios, comentarios que abren un DM y Lead Ads.
4. **Operación de canales:** calidad del número, estado de templates, policy enforcement, analytics, tokens y suscripciones.
5. **Marketing y contenido:** insights, publicación y administración de campañas. Es posible, pero no es el primer cuello de botella del producto.

La integración actual tiene una base correcta —HMAC sobre el body crudo, deduplicación, outbox, workflows durables, timestamps de origen y estados WhatsApp—, pero su contrato funcional es estrecho. Solo WhatsApp está configurado; la salida real es texto para los tres canales; WhatsApp entrante acepta seis tipos pero no descarga media; Instagram y Messenger descartan todo lo que no sea un mensaje con `mid` y texto.

### Recomendación

No conviene empezar por crear campañas ni por Meta Business Agent. El orden de mayor ROI es:

1. **Fundación Meta multicanal:** versionado, capability registry, evento canónico y health operativo.
2. **WhatsApp enriquecido:** media privada, reply context, read/typing, interactivos y Flows.
3. **Instagram comercial:** comentarios → respuesta privada, adjuntos, quick replies, stories/reels y referrals.
4. **Atribución:** touchpoints de Click-to-Message/Lead Ads y resultados hacia Marketing/Conversions API.
5. **Contenido y campañas:** solo cuando la atribución ya conecte gasto con leads cualificados.

## Diagnóstico sin suavizar

### 1. La documentación local estaba materialmente desactualizada

- **Observación:** `meta-platform-limits.md` describía pricing por conversación 2024–2025, “HSM”, 1.000 conversaciones de servicio gratis y límites comunitarios de Instagram/Messenger como si fueran contrato.
- **Causa raíz:** no existía un ledger por afirmación, versión, región y fecha.
- **Fix:** este reporte separa hechos oficiales, inferencias y disponibilidad por cuenta. WhatsApp cobra actualmente por mensaje entregado y categoría; servicio y ciertas respuestas utility son gratuitas, y un punto de entrada desde Click-to-WhatsApp o CTA de Page abre 72 horas gratuitas.

### 2. “Multicanal” describe la arquitectura, no el producto operativo

- **Observación:** WhatsApp está configurado y probado. Instagram/Messenger tienen variables opcionales, pero no activos validados. `GraphApiMetaClient` solo implementa `sendText`.
- **Causa raíz:** una abstracción común demasiado pequeña hace parecer equivalentes canales con contratos diferentes.
- **Fix futuro:** capability registry por canal y cuenta, con `supported`, `unsupported`, `restricted`, `not_configured` y `degraded`.

### 3. El pin `v21.0` no tiene política de compatibilidad

- **Observación:** `META_GRAPH_API_VERSION` cae por defecto en `v21.0`. Una lectura segura realizada el 2026-08-13 contra el phone number configurado aceptó `v25.0` y devolvió header `facebook-api-version: v26.0`.
- **Causa raíz:** la versión es configuración, pero no existe suite contractual ni calendario de deprecación.
- **Fix futuro:** inventario de endpoints por versión, fixtures oficiales, contract tests y upgrade escalonado. El header observado prueba compatibilidad de esa lectura, no autoriza un cambio global.

### 4. Se pierde contexto que Meta ya entrega

- **Observación:** Instagram/Messenger quedan reducidos a `{sender, mid, text}`. Se descartan attachments, reply context, quick replies, postbacks, reactions, deletes, echoes, shares, stories y referrals de anuncios. WhatsApp ignora interactive, button, contact, sticker, reaction y contexto de reply.
- **Causa raíz:** `ParsedMessage` y `tipo_mensaje_enum` nacieron text-first.
- **Fix futuro:** evento canónico discriminado y versionado; preservar solo campos de negocio necesarios y no el payload completo indefinidamente.

### 5. Media entrante no es funcional

- **Observación:** WhatsApp reconoce image/audio/video/document, pero `media_url` siempre queda `null`; adjuntos IG/FB ni siquiera entran.
- **Causa raíz:** falta la segunda llamada autorizada a Meta y un pipeline de almacenamiento.
- **Fix futuro:** resolver media ID/URL efímera, validar MIME/tamaño/hash, almacenar en bucket privado Supabase y exponer signed URLs. No persistir URLs efímeras de Meta como fuente final.

### 6. No hay centro de salud de la integración

- **Observación:** el CRM no consume quality updates, estados de templates, account review/ban, policy enforcement, suscripciones ni expiración de tokens.
- **Causa raíz:** los webhooks se modelaron solo como mensajes o delivery de WhatsApp.
- **Fix futuro:** eventos operativos separados, read model de salud, alertas y runbook por fallo.

### 7. La atribución se pierde en la puerta

- **Observación:** referrals de ads, comentarios, story/reel context y parámetros de entrada no se convierten en touchpoints.
- **Causa raíz:** `canal_thread_id` identifica la conversación, pero no conserva el origen comercial.
- **Fix futuro:** touchpoints append-only con fuente, campaña/ad cuando Meta lo entregue, timestamp, canal y nivel de confianza. Nunca inventar una atribución ausente.

## Inventario de capacidades

Leyenda: impacto y riesgo de 1 (bajo) a 5 (alto). Esfuerzo S/M/L/XL. “Producción” significa que existe contrato oficial; no implica que los activos actuales tengan permisos.

### WhatsApp Business Platform

| Capacidad                                          | Estado / requisitos                                                  | Uso sin catálogo                                   | Soporte actual                                  | Esf. | Impacto | Riesgo | Decisión            |
| -------------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------- | ---- | ------: | -----: | ------------------- |
| Texto, preview URL y replies                       | Producción; `whatsapp_business_messaging`                            | Responder con contexto verificable                 | Texto, sin preview ni reply context             | M    |       4 |      2 | Ahora               |
| Imagen, audio, video, documento y sticker          | Producción; media ID o URL                                           | Fotos de pieza/VIN, audios, presupuestos           | Inbound parcial; no descarga; outbound ausente  | L    |       5 |      3 | Ahora               |
| Location y contacts                                | Producción                                                           | Dirección de entrega/taller y contacto             | Location se tipa sin contenido útil             | M    |       3 |      3 | Siguiente           |
| Reacciones                                         | Producción                                                           | Confirmación ligera y UX natural                   | Ausente                                         | S    |       2 |      1 | Después             |
| Read receipt y typing indicator                    | Producción                                                           | Feedback inmediato y menor abandono                | Estados entrantes sí; acciones ausentes         | S    |       4 |      1 | Ahora               |
| Mensajes interactivos y botones/listas             | Producción; sujetos a ventana/política                               | Guiar marca/modelo/año, urgencia y ciudad          | Ausente                                         | M    |       5 |      2 | Ahora               |
| Templates                                          | Producción; aprobación y categoría                                   | Seguimientos, avisos y reapertura válida           | Se modela tipo, no CRUD/selección/envío general | L    |       5 |      4 | Ahora               |
| WhatsApp Flows                                     | Producción; Flow publicado y endpoint opcional                       | Formulario guiado de solicitud de repuesto         | Ausente                                         | L    |       5 |      3 | Ahora               |
| Estados sent/delivered/read/failed                 | Producción por webhook                                               | SLA y diagnóstico de entrega                       | Implementado para WA                            | S    |       4 |      1 | Conservar           |
| Perfil comercial                                   | Producción; management permission                                    | Identidad white-label y auditoría de configuración | Ausente                                         | S    |       2 |      2 | Siguiente           |
| Analytics y billing                                | Producción; WABA y management permission                             | Entregas, coste y comparación Meta vs CRM          | Ausente                                         | M    |       4 |      2 | Siguiente           |
| Calidad, nombre, cuenta y template-status webhooks | Producción                                                           | Prevenir bloqueos y degradaciones silenciosas      | Ausente                                         | M    |       5 |      2 | Ahora               |
| QR codes y click-to-chat                           | Producción                                                           | Captación desde mostrador, packaging o web         | Ausente                                         | S    |       3 |      2 | Siguiente           |
| Block/unblock users                                | Producción                                                           | Abuso, spam y seguridad del equipo                 | Ausente                                         | M    |       2 |      4 | Después             |
| Embedded Signup                                    | Producción para partners/tech providers; App Review                  | Onboarding white-label de nuevos clientes          | Ausente                                         | XL   |       5 |      4 | Después del piloto  |
| Calling                                            | Rollout/partner/cuenta/región; no asumir Latam global                | Escalar consultas complejas a voz                  | Ausente                                         | XL   |       3 |      5 | Investigar después  |
| Payments                                           | Colecciones oficiales específicas para India/Singapur                | Cobro dentro del chat                              | No aplicable al mercado inicial                 | XL   |       2 |      5 | Descartar por ahora |
| Groups                                             | No aparece como API Cloud pública general en las fuentes verificadas | Grupos de talleres                                 | No disponible como contrato productivo general  | —    |       1 |      5 | No prometer         |

Notas críticas:

- Cloud API es el camino vigente; On-Premises aparece deprecado.
- Flows ya vive dentro de la colección Cloud API. Casos oficiales incluyen `LEAD_GENERATION`, `CONTACT_US`, `CUSTOMER_SUPPORT`, `SURVEY` y `APPOINTMENT_BOOKING`.
- La colección oficial expone payments para SG/IN. No hay base para venderlo como capacidad Latam.
- Las llamadas fueron anunciadas con despliegue y partners; requieren verificación por activo y país antes de diseñar.

### Instagram API

| Capacidad                            | Estado / requisitos                                              | Uso sin catálogo                             | Soporte actual                         | Esf. | Impacto | Riesgo | Decisión              |
| ------------------------------------ | ---------------------------------------------------------------- | -------------------------------------------- | -------------------------------------- | ---- | ------: | -----: | --------------------- |
| Send API texto y media               | Producción; cuenta profesional, token y manage messages          | Atender DMs con fotos, audio/video y assets  | Texto teórico; activos no configurados | L    |       5 |      3 | Siguiente             |
| Reply, reaction, delete/echo context | Producción por mensajes/webhooks                                 | Hilo coherente y deduplicación correcta      | Descartado                             | M    |       4 |      2 | Siguiente             |
| Quick replies                        | Producción; hasta 13 opciones documentadas                       | Calificar vehículo/urgencia/canal preferido  | Ausente                                | M    |       5 |      2 | Siguiente             |
| Ice breakers / persistent menu       | Producción; Messenger Profile API                                | Iniciar conversaciones con preguntas útiles  | Ausente                                | M    |       4 |      2 | Siguiente             |
| Welcome Message Flows                | Producción en colección actual                                   | Captura estructurada temprana                | Ausente                                | L    |       4 |      3 | Después               |
| Comments y private replies           | Producción; permisos de comments                                 | Convertir comentario en conversación privada | Ausente                                | L    |       5 |      4 | Siguiente             |
| Live comments                        | Producción con ventana limitada al live                          | Triage en lanzamientos/eventos               | Ausente                                | L    |       2 |      4 | Después               |
| Story/reel/share/mention context     | Producción; campos/eventos específicos                           | Saber qué pieza/publicación originó el DM    | Descartado                             | M    |       5 |      2 | Siguiente             |
| Referrals desde links y ads          | Producción por webhook                                           | Atribución Click-to-Instagram Direct         | Descartado                             | M    |       5 |      3 | Siguiente             |
| Conversations API                    | Producción; Standard/Advanced Access                             | Reconciliación/backfill de hilos             | Ausente                                | M    |       4 |      3 | Siguiente             |
| Content Publishing                   | Producción para cuentas profesionales; Stories con restricciones | Publicar reels/posts desde operaciones       | Ausente                                | L    |       3 |      4 | Después               |
| Account/media insights               | Producción; ventanas y métricas variables                        | Medir contenido que genera leads             | Ausente                                | M    |       4 |      3 | Después de atribución |

Instagram ofrece dos modelos de login. “Instagram Login” no requiere Page vinculada, pero no da acceso a ads/tagging; “Facebook Login” usa Page vinculada y permisos de Pages. Para un producto white-label la elección debe fijarse antes de implementar onboarding.

La respuesta privada a un comentario tiene una ventana documentada de siete días y solo un primer mensaje; seguimientos dependen de que la persona responda y luego aplican las reglas de mensajería. Esto exige un policy engine, no un `if ventana24h` global.

### Messenger Platform y Facebook Pages

| Capacidad                                   | Estado / requisitos                                      | Uso sin catálogo                             | Soporte actual                | Esf. | Impacto | Riesgo | Decisión                  |
| ------------------------------------------- | -------------------------------------------------------- | -------------------------------------------- | ----------------------------- | ---- | ------: | -----: | ------------------------- |
| Texto y media                               | Producción; Page, token y `pages_messaging`              | Canal adicional de atención                  | Texto teórico; no configurado | L    |       3 |      3 | Después de Instagram      |
| Templates, buttons y quick replies          | Producción                                               | Calificación guiada y links/acciones         | Ausente                       | M    |       3 |      2 | Después                   |
| Sender actions `mark_seen`, `typing_on/off` | Producción                                               | Feedback y UX de atención                    | Ausente                       | S    |       2 |      1 | Después                   |
| Delivery/read/echo/edit/reaction            | Producción por webhook                                   | Estado y reconciliación                      | Descartado                    | M    |       3 |      2 | Después                   |
| Postbacks, referrals y Get Started/menu     | Producción                                               | Origen de campaña y navegación guiada        | Descartado                    | M    |       4 |      2 | Después                   |
| Handover Protocol/standby                   | Producción                                               | Coordinar app/IA/humano sin doble respuesta  | Ausente                       | L    |       4 |      4 | Siguiente si FB se activa |
| Policy enforcement y template status        | Producción por webhook                                   | Salud de cuenta y alertas                    | Ausente                       | M    |       4 |      2 | Obligatorio al activar    |
| Utility Messages                            | Disponibilidad regional limitada en documentación actual | Notificaciones fuera de ventana              | Ausente                       | L    |       1 |      5 | No priorizar Latam        |
| Comments/private replies/Page insights      | APIs de Pages/Graph con permisos propios                 | Convertir engagement en leads y medir origen | Ausente                       | L    |       3 |      4 | Después                   |

### Marketing, Ads y crecimiento

| Capacidad                                  | Estado / requisitos                                  | Valor para el CRM                               | Soporte actual                       | Esf. | Impacto | Riesgo | Decisión                       |
| ------------------------------------------ | ---------------------------------------------------- | ----------------------------------------------- | ------------------------------------ | ---- | ------: | -----: | ------------------------------ |
| Campaign/ad set/ad/creative CRUD           | Producción; ad account, token, permisos y App Review | Gestionar campañas desde el CRM                 | Ausente                              | XL   |       3 |      5 | Después                        |
| Ads Insights                               | Producción; `ads_read`/`ads_management` según caso   | Gasto, reach, clicks, acciones y coste          | Ausente                              | M    |       4 |      3 | Después de touchpoints         |
| Click-to-Message                           | Producción vía Ads Manager/Marketing surfaces        | Llevar tráfico a WA/IG/Messenger                | Solo recibe mensaje, pierde referral | L    |       5 |      3 | Siguiente                      |
| Lead Ads                                   | Producción; Page/ad permissions y webhook leadgen    | Crear leads sin esperar un DM                   | Ausente                              | L    |       4 |      5 | Experimento posterior          |
| Custom/Lookalike Audiences                 | Producción; base legal y hashing/normalización       | Retargeting de leads cualificados               | Ausente                              | XL   |       3 |      5 | Después; revisión legal        |
| Offline Conversions / Conversions API      | Producción; dataset/pixel y eventos válidos          | Informar lead cualificado/venta y optimizar ads | Ausente                              | L    |       5 |      5 | Después de fuente de resultado |
| Centralized campaigns / WhatsApp placement | Rollout anunciado; disponibilidad por cuenta         | Unificar presupuesto Meta                       | Ausente                              | XL   |       2 |      5 | No asumir disponible           |

No tiene sentido automatizar campañas antes de capturar `ad/referral → conversación → lead cualificado → resultado`. Sin ese hilo, el CRM podría gastar dinero pero no demostrar ROI.

## Permisos y activos

| Superficie                   | Activos mínimos                                        | Permisos representativos                                                                                                                     | App Review / acceso                                                             |
| ---------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| WhatsApp messaging           | Business Portfolio, WABA, phone number, app, token     | `whatsapp_business_messaging`                                                                                                                | Activos propios en desarrollo; producción/terceros según configuración y review |
| WhatsApp management          | WABA y system user/token                               | `whatsapp_business_management`, frecuentemente `business_management`                                                                         | Advanced Access para Embedded Signup/terceros                                   |
| Instagram Login              | Cuenta profesional y app                               | `instagram_business_basic`, `instagram_business_manage_messages`, `instagram_business_manage_comments`, `instagram_business_content_publish` | Advanced Access si atiende cuentas ajenas                                       |
| Instagram con Facebook Login | Cuenta profesional vinculada a Page                    | `instagram_basic`, `instagram_manage_messages`, `instagram_manage_comments`, `instagram_content_publish`, permisos Pages                     | Review según cuentas servidas                                                   |
| Messenger/Page               | Facebook Page, app y Page access token                 | `pages_messaging` más permisos específicos de Pages                                                                                          | Review/Advanced Access para activos ajenos                                      |
| Marketing                    | Ad account, Business Portfolio, app, user/system token | `ads_read` o `ads_management`; permisos adicionales por producto                                                                             | Revisión y controles de negocio                                                 |

Principio obligatorio: tokens separados por función y mínimo privilegio. Un token capaz de gestionar campañas no debe ser el mismo usado por el webhook o por envío conversacional.

## Ventanas, pricing y disponibilidad

- WhatsApp cobra por **mensaje entregado**, mercado y categoría: marketing, utility, authentication y service.
- Service messages dentro de la ventana de 24 horas abierta por el usuario no tienen cargo; la ventana se reinicia con cada mensaje del usuario.
- Meta declara gratuitas ciertas utility responses al usuario y 72 horas gratuitas para todos los mensajes tras entrada desde Click-to-WhatsApp o CTA de una Facebook Page.
- Fuera de la ventana WhatsApp se requiere un template aprobado cuando la política lo permita.
- Instagram y Messenger tienen sus propias reglas, tags y casos de inicio. No deben heredar la decisión de elegibilidad de WhatsApp.
- Precios exactos deben consultarse en la rate card por mercado/categoría. No se hardcodean en documentación ni producto.
- Rate limits dependen del producto, permiso, cuenta y headers de uso. El CRM debe leer headers y aplicar backoff; no usar cifras comunitarias fijas.

## Seguridad y compliance Latam

Toda ampliación debe mantener:

- HMAC sobre bytes crudos antes de parsear webhooks.
- Respuesta rápida y procesamiento durable/deduplicado.
- Cero PII en logs; IDs Meta pseudonimizados cuando no sean necesarios.
- Minimización: guardar el evento canónico; conservar raw payload solo si hay finalidad, retención y acceso definidos.
- Media en Supabase Storage privado, validada y servida con signed URLs.
- Consentimiento/opt-in y evidencia de origen para mensajes iniciados por negocio.
- Opt-out central por canal; block API no reemplaza el registro interno de supresión.
- Separación entre datos de servicio y datos usados para audiencias/optimización publicitaria.
- Borrado, retención y exportación compatibles con LGPD, Ley 25.326, LFPDPPP, Ley 19.628 y Ley 1581.
- Rotación de secretos, mínimo privilegio, auditoría de cambios y alertas por expiración/revocación.

## Meta Business Agent: build vs buy

Meta anunció Business Agent y Business Agent Platform para WhatsApp, Messenger e Instagram. Promete preguntas de negocio, calificación de leads, handoff, cierre, idiomas, tono, integraciones y resúmenes. El propio anuncio mezcla disponibilidad global, selección de cuentas, expansión futura y futuras suscripciones; debe tratarse como oferta en rollout, no como contrato uniforme.

| Criterio                  | Meta Business Agent                     | CRM propio                                         |
| ------------------------- | --------------------------------------- | -------------------------------------------------- |
| Arranque                  | Más rápido si la cuenta está habilitada | Requiere implementación/onboarding                 |
| White-label               | Control limitado por Meta               | Control completo por instalación                   |
| Datos y modelo de negocio | Dependencia de políticas/producto Meta  | Modelo, retención y auditoría propios              |
| Canales externos/ERP      | Según integraciones de la plataforma    | Integración arbitraria y específica del cliente    |
| Guardrails y auditoría    | Según capacidades ofrecidas             | Handoff, reglas, outbox y trazabilidad controlados |
| Diferenciación vertical   | Genérica; catálogo es parte fuerte      | Twin, reglas, operación Latam y workflows propios  |
| Riesgo                    | Lock-in, pricing y rollout              | Coste de ingeniería y operación                    |

Decisión recomendada: seguir construyendo la capa CRM y evaluar Business Agent como proveedor/opción futura, nunca como dependencia central. La diferenciación defendible está en datos operativos, auditabilidad, flujos y conexiones empresariales, no en “tener un bot”.

## Arquitectura futura propuesta — no implementada

1. **`MetaCapabilityRegistry`** por cuenta/canal/versión: declara lectura, envío, media, interactivos, comentarios, referrals y ops.
2. **`MetaInboundEvent`** discriminado: message, status, reaction, postback, referral, comment, policy, account y template update.
3. **`MetaOutboundCommand`** discriminado: text, media, reply, reaction, interactive, template, read y typing.
4. **Policy engine por canal:** determina elegibilidad, ventana, template/tag permitido y motivo de bloqueo.
5. **Media ingestion service:** descarga efímera, validación, storage privado y auditoría.
6. **Touchpoint ledger:** origen append-only separado del estado mutable del lead.
7. **Integration health read model:** versión, token, permisos, suscripciones, calidad, templates y último webhook.

No se debe extender `sendText` con veinte parámetros opcionales. Eso produciría estados inválidos y escondería diferencias entre canales.

## Roadmap recomendado

### Slice M0 — compatibilidad y observabilidad

- Matriz endpoint × versión y upgrade escalonado desde `v21.0`.
- Registry por canal/cuenta y health read-only.
- Fixtures oficiales para mensajes/eventos hoy descartados.
- Eventos operativos y alertas sin PII.
- Criterio: saber qué puede hacer cada activo y por qué está degradado antes de habilitar features.

### Slice M1 — WhatsApp enriquecido

- Media entrante/saliente privada.
- Contexto de replies y tipos faltantes.
- Read receipt, typing e interactivos.
- Primer Flow de solicitud de repuesto sin catálogo: vehículo, año, motor, pieza, ciudad, urgencia y adjuntos.
- Criterio: el agente/admin ve el mismo contexto que el cliente y no pierde datos.

### Slice M2 — Instagram comercial

- Onboarding de una cuenta profesional de prueba y permisos mínimos.
- DMs con media/contexto, quick replies e ice breakers.
- Comentario → respuesta privada y story/reel/ad referral → touchpoint.
- Conversations API para reconciliación.
- Criterio: un comentario o referral llega al Inbox con origen verificable.

### Slice M3 — atribución

- Touchpoints append-only para campañas/referrals.
- Lectura de Ads Insights.
- Lead Ads como experimento aislado.
- Envío de resultados solo cuando exista definición real de lead cualificado/venta y base legal.
- Criterio: medir coste por lead cualificado sin inventar atribución.

### Slice M4 — contenido y administración de campañas

- Publicación/insights de Instagram/Pages.
- CRUD de campañas solo con aprobaciones, límites de gasto, auditoría y separación de roles.
- Criterio: ningún cambio de presupuesto o audiencia ocurre sin autorización y trazabilidad.

## Shortlist para decisión del dueño

| Opción                              | Resultado visible                                     | Dependencias                              | ROI | Recomendación |
| ----------------------------------- | ----------------------------------------------------- | ----------------------------------------- | --: | ------------- |
| M0 + media/replies WA               | Inbox realmente conversacional y base segura          | Activo WA actual                          | 5/5 | **Primera**   |
| WhatsApp Flow de solicitud          | Lead llega estructurado antes de IA                   | Template/Flow aprobado                    | 5/5 | **Primera**   |
| Instagram comments → DM + referrals | Convierte engagement y atribuye origen                | Cuenta profesional y App Review           | 5/5 | **Segunda**   |
| Health de Meta                      | Detecta calidad/token/policy antes de perder mensajes | Management permissions                    | 5/5 | **Primera**   |
| Ads Insights + touchpoints          | Coste por fuente/campaña                              | Ad account y taxonomía de resultados      | 4/5 | Tercera       |
| Publicador de contenido             | Operación social centralizada                         | Content permissions                       | 3/5 | Después       |
| Campaign manager completo           | Compra de medios desde CRM                            | App Review, RBAC, guardrails y atribución | 2/5 | No ahora      |
| Calling/payments/groups             | Capacidad llamativa pero incierta/regional            | Cuenta, partner y país                    | 1/5 | No ahora      |

## Punto de decisión

Antes de escribir código, elegir entre una y tres capacidades. La recomendación es aprobar conjuntamente:

1. M0 compatibilidad/health.
2. WhatsApp media + replies + read/typing.
3. WhatsApp Flow de solicitud de repuesto sin catálogo.

Instagram comments/referrals sería el siguiente experimento, condicionado a disponer de una cuenta profesional y permisos de prueba. Cada slice requiere su propio diseño, estructura de archivos, confirmación, tests contractuales y verificación funcional antes de UI.
