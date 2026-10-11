# Guía: que la app del CRM sea Tech Provider de Meta (Etapa 1 — WhatsApp)

> Para el dueño. Fuentes: [Get started for Tech Providers](https://developers.facebook.com/docs/whatsapp/solution-providers/get-started-for-tech-providers), [Onboarding WhatsApp Business app users (coexistencia)](https://developers.facebook.com/docs/whatsapp/embedded-signup/custom-flows/onboarding-business-app-users), [App Review](https://developers.facebook.com/docs/resp-plat-initiatives/individual-processes/app-review) — leídas el 2026-10-10/11.
> Los nombres exactos de los menús pueden variar en tu panel: si algo no coincide, mandá captura y seguimos.

## Por qué

Para conectar tu número real en **coexistencia** (sigue en la app WhatsApp Business del teléfono y además entra al CRM) Meta exige: _"You must already be a Solution Partner or Tech Provider."_ Ser Tech Provider es gratis y es lo que vas a necesitar para vender el CRM a otras empresas (cada una conecta su WhatsApp con el mismo botón).

## Estado

| Paso                                              | Estado                      |
| ------------------------------------------------- | --------------------------- |
| 1. Verificación de la empresa                     | ✅ hecho                    |
| 2. Datos básicos de la app                        | ⏳                          |
| 3. Dos videos                                     | ⏳                          |
| 4. Pedir "Advanced access" (App Review)           | ⏳                          |
| 5. Configuración de Embedded Signup (`config_id`) | ⏳ después de la aprobación |

## Paso 2 — Datos básicos de la app

developers.facebook.com → tu app **CRM-genuino-repuestos** → **Configuración de la app → Básica**:

- **Ícono** de la app (Meta pide imagen cuadrada).
- **URL de la política de privacidad:** `https://crm-wine-one-38.vercel.app/privacidad`
- **URL de las condiciones del servicio:** `https://crm-wine-one-38.vercel.app/condiciones`
- **URL de eliminación de datos:** `https://crm-wine-one-38.vercel.app/eliminacion-de-datos`
- **Categoría:** la que mejor describa un sistema de atención y ventas para negocios.

## Paso 3 — Los dos videos

Meta prueba que la app use de verdad cada permiso. Pide dos videos (grabá la pantalla; no hace falta audio):

**Video 1 — mandar un mensaje desde la app y que llegue a WhatsApp** (`whatsapp_business_messaging`)

1. Abrí el CRM (la app de escritorio o `crm-wine-one-38.vercel.app`), entrá al **Inbox** y abrí tu conversación de prueba.
2. Escribí un mensaje en el cuadro de abajo y envialo desde el CRM.
3. Mostrá en el mismo video el teléfono (o WhatsApp Web) recibiendo ese mensaje.

**Video 2 — crear una plantilla de mensaje** (`whatsapp_business_management`)

- Meta acepta hacerlo desde **WhatsApp Manager**: business.facebook.com → WhatsApp Manager → **Plantillas de mensajes → Crear plantilla** → completar (por ejemplo una plantilla de "cotización lista") → **Enviar**.

## Paso 4 — Pedir Advanced access

Panel de la app → **App Review → Permisos y funciones** → pedir **Advanced access** para:

- `whatsapp_business_messaging`
- `whatsapp_business_management`

Subí el video correspondiente a cada uno y pegá la descripción (Meta la pide en inglés):

**whatsapp_business_messaging**

> Our app is a CRM for auto-parts sales teams. It uses whatsapp_business_messaging to send and receive WhatsApp messages on behalf of the businesses that use it: an AI sales assistant answers customer questions with prices and stock from the business catalog, and human sellers reply from the same inbox. The video shows a message written and sent from the app's inbox and received in the WhatsApp client.

**whatsapp_business_management**

> Our app uses whatsapp_business_management to let each business connect its own WhatsApp Business Account through Embedded Signup, read its phone numbers and quality status, subscribe the account to our webhooks, and manage message templates used for quotes and follow-ups. The video shows a message template being created.

Después: **Comenzar revisión (Begin App Review)**. Meta no publica cuánto tarda.

## Paso 5 — Después de la aprobación

Panel de la app → **Facebook Login for Business → Configuraciones → Crear configuración** del tipo **WhatsApp Embedded Signup** (versión 4). Activá la opción de **conectar una cuenta existente de WhatsApp Business** (coexistencia). Copiá el **`config_id`** y pasámelo: el botón **"Conectar WhatsApp"** del CRM lo usa.

> Importante: la versión 2 de Embedded Signup se apaga el **15 de octubre de 2026**; usamos la 4.

## Al conectar tu número (cuando esté todo)

- Tu WhatsApp Business del teléfono tiene que estar en la versión **2.24.17 o más nueva**.
- En la ventana de Meta elegís **conectar tu cuenta existente de WhatsApp Business** y confirmás con el código que llega al teléfono.
- El CRM pide automáticamente tus **contactos** y los **últimos 180 días** de conversaciones (Meta da **24 horas** y **una sola vez**).
- Limitaciones en el teléfono: se apagan mensajes temporales, "ver una vez" y listas de difusión; los grupos no se sincronizan.

## Etapas siguientes (plan del producto)

| Etapa | Qué                                                                 | Permisos (se piden cuando la función ya funciona)             |
| ----- | ------------------------------------------------------------------- | ------------------------------------------------------------- |
| 1     | WhatsApp: agente, Inbox, coexistencia, plantillas, difusión         | `whatsapp_business_messaging`, `whatsapp_business_management` |
| 2     | Instagram y Messenger en el Inbox                                   | mensajería de Instagram y de páginas                          |
| 3     | Gestor de anuncios (campañas, públicos, resultados unidos a ventas) | permisos de Marketing API                                     |
| 4     | Catálogo en Meta, publicaciones, estadísticas                       | catálogo y contenido                                          |

Meta aprueba **permiso por permiso** y prueba que cada uno se use de verdad: por eso cada etapa se presenta cuando ya funciona.
