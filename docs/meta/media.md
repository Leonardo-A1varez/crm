# Media de WhatsApp (imágenes, video, audio, documentos, stickers)

Escrito el 2026-10-12. Cubre: bajar el archivo de lo que llega (webhook, ecos de la app Business, historial), mostrarlo en el Inbox, mandar archivos desde el composer, la copia permanente en la PC (app de escritorio) y su retención.

**Estado:** probado contra el mock local de la Graph API (`scripts/mock-meta-graph.mjs`), en unit tests, contra el stack local de Supabase (bucket, RLS, columnas) y en el navegador contra la app local (`next dev` + stack + mock, sin Inngest ni LLM: `LLM_MODE=mock`). En el navegador se vio: miniatura de imagen con redirect a la URL firmada (la CSP lo deja pasar), diálogo ampliado que cierra con Escape, tarjeta de documento, reproductor de audio, «Descargando archivo…» y «pesa más de 50 MB»; y se mandó un PDF con texto (vista previa → subida directa a Storage → Meta mock → fila `descargado` en el hilo). `/api/media` y `/api/escritorio/archivos` sin sesión dan 401; con sesión, la paginación por cursor anda contra PostgREST real. **No se verificó en el navegador:** la descarga efectiva del documento ni la nota de voz real (el WAV de prueba reprodujo el control, no el sonido). **Contra Meta real no se probó nunca**: los puntos sin confirmar están en §7. **La app de escritorio no se corrió** (typecheck y tests del motor, no Electron real): el archivado a disco, el diálogo de OneDrive y `session.fetch` contra el CRM real están sin verificar.

## 1. Qué dice la documentación de Meta (leída el 2026-10-11)

Fuentes:

- [A] Referencia de media: <https://developers.facebook.com/docs/whatsapp/cloud-api/reference/media>
- [B] Media (números de teléfono): <https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/media.md>
- [C] Webhooks de mensajes, por tipo: `…/webhooks/reference/messages/{image,audio,video,document,sticker}.md`
- [D] Envío por tipo: <https://developers.facebook.com/docs/whatsapp/cloud-api/messages/{image,audio,video,document}-messages>
- [E] Historial y ecos de la app Business: `…/embedded-signup/onboarding-business-app-users` (ver también `conectar-whatsapp.md`)

| Tema                 | Lo que dice                                                                                                                                                                                                                                         | Fuente    |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| Pedir la URL         | `GET /{media-id}` (opcional `?phone_number_id=`), Bearer. Respuesta `{ messaging_product, url, mime_type, sha256, file_size, id }`                                                                                                                  | [A][B]    |
| Vida de la URL       | **Expira a los 5 minutos**; hay que volver a pedir el id                                                                                                                                                                                            | [A][B]    |
| Descargar            | `GET {url}` **con el Bearer** (sin token «la solicitud falla»); devuelve los bytes con el tipo en `Content-Type`. `404` = pedir otra URL y reintentar; si falla, renovar el token                                                                   | [A][B]    |
| Vida del id          | Los de la API duran **30 días**; los **de webhooks, 7 días**                                                                                                                                                                                        | [A][B]    |
| Subir                | `POST /{phone_number_id}/media`, multipart: `messaging_product=whatsapp`, `file`, `type` (tipo). Respuesta `{ id }`. Lo subido se guarda 30 días                                                                                                    | [A][B]    |
| Imagen               | JPEG, PNG (8 bits RGB/RGBA), **5 MB**                                                                                                                                                                                                               | [A][B][D] |
| Video                | MP4 y 3GP, H.264 + AAC, **16 MB**                                                                                                                                                                                                                   | [A][B][D] |
| Audio                | AAC, AMR, MP3, M4A, OGG (**solo OPUS, mono**), **16 MB**                                                                                                                                                                                            | [A][B][D] |
| Documento            | TXT, XLS, XLSX, DOC, DOCX, PPT, PPTX, PDF, **100 MB**                                                                                                                                                                                               | [A][B]    |
| Sticker              | WebP; animado 500 KB, estático 100 KB                                                                                                                                                                                                               | [A][B]    |
| Entrantes            | Máximo soportado 100 MB (error `131052` si pasa). Tipo que no coincide: `131053`                                                                                                                                                                    | [A][B]    |
| Webhook de imagen    | `messages[].image { id, mime_type, sha256, caption?, url? }`; `url` «se está liberando gradualmente»                                                                                                                                                | [C]       |
| Webhook de audio     | `audio { id, mime_type (p. ej. audio/ogg; codecs=opus), sha256, voice, url? }`; `voice` = grabado con el micrófono de WhatsApp                                                                                                                      | [C]       |
| Webhook de video     | `video { id, mime_type, sha256, caption?, url? }`                                                                                                                                                                                                   | [C]       |
| Webhook de documento | `document { id, mime_type, sha256, filename, caption?, url? }`                                                                                                                                                                                      | [C]       |
| Webhook de sticker   | `sticker { id, mime_type, sha256, animated, url? }`                                                                                                                                                                                                 | [C]       |
| Enviar por id        | Imagen y video `{ id, caption? }` (caption hasta **1024**); documento `{ id, filename?, caption? }`; audio `{ id, voice? }`: **la doc de audio no documenta `caption`**                                                                             | [D]       |
| Voz                  | «Voice messages require .ogg files encoded with the OPUS codec»; sólo con ≤ 512 KB muestra el ícono de reproducir                                                                                                                                   | [D]       |
| Historial con media  | El historial trae los mensajes de media como `type: "media_placeholder"` **sin contenido ni id**. Los ids llegan **en otros webhooks `history` aparte** (`value.messages[]` directo, con `image`, etc.), **sólo para media de los últimos 14 días** | [E]       |
| Ecos con media       | La doc dice que el contenido «varía según el `type`» y no muestra un eco de media                                                                                                                                                                   | [E]       |

## 2. Cómo está armado

```
Entrante / eco / historial ──► parser (id de media, tipo, nombre) ──► mensaje en el hilo con
                                                                       media_estado = 'pendiente'
        │                                                                  │
        └── evento meta/media.descargar (id = media-descargar:<mensaje>) ◄─┘
                         │
              descargar-media-mensaje (Inngest, 5 reintentos, concurrencia 5)
              GET /{id} → GET url (Bearer del número) → verifica firma → sharp → Storage
                         │
                 mensajes.media_estado = 'descargado' (+ path, mime, bytes)
```

- **Migración** `supabase/migrations/20261012120000_mensajes_media.sql`: columnas `media_estado / media_meta_id / media_path / media_mime / media_bytes / media_nombre / media_error / media_descargado_at` en `mensajes` (CHECK de estado, de tamaño y de **forma de la ruta**: `sesiones/<sesión>/<uuid>.<ext>`, sin `..`), un índice para la app de escritorio, y el bucket `mensajes_media` (ya existía, privado) ampliado a 50 MiB y a los tipos de WhatsApp. **No se aplicó en crm-dev ni producción**: sólo en el stack local.
- **Estados:** `pendiente` (falta bajarlo) → `descargado` | `fallido` (reintentos agotados o id vencido) | `omitido` (a propósito: más de 50 MiB, historial de más de 14 días). El hilo dice cuál y por qué.
- **Idempotencia:** el evento lleva `id` por mensaje (Inngest descarta el duplicado), el paso lleva la clave `descargar-media-mensaje-<fecha>-<mensaje>` (AGENTS.md §0.9), el servicio sólo actúa sobre `pendiente` y la ruta del objeto es determinística (`rutaDeMedia`), así que reintentar sobrescribe el mismo archivo. Si el registro falla después de subir, el reintento no deja un huérfano.
- **URL vencida:** un `404` al bajar hace volver a pedir `GET /{id}` y bajar de nuevo, una vez; si tampoco, error reintentable y Inngest vuelve a empezar. Un `400/404` al pedir el id (vencido a los 7 días) no se reintenta: queda `fallido` con «media_no_disponible».
- **Token:** el del número de la conversación (`whatsapp_numeros_credenciales`), o el de env si no hay número conectado. Un número conectado cuyo token no se descifra **falla** (no cae al de env).
- **Compresión de imágenes entrantes** (`comprimir-imagen.ts`, `sharp@0.34.5`, dependencia directa nueva): JPEG/PNG → WebP calidad 80, lado máximo 1600 px, sin EXIF (se va la ubicación de la foto), orientación aplicada; tope de 100 Mpx contra bombas de descompresión. Si no mejora o falla, **se guarda el original**. Stickers, GIF y todo lo que no sea JPEG/PNG no se tocan.
- **Tipo real, no el declarado** (`detectar-mime.ts`): se mira la firma de los bytes. Lo que coincide con lo declarado se guarda con su tipo; **lo que no (un HTML que dice ser `image/png`) se guarda como `application/octet-stream`** y el hilo lo ofrece como descarga, nunca en línea. Sólo imagen, audio y video reconocidos se muestran en la página.
- **Stickers:** antes se descartaban sin guardar. Ahora entran como mensaje de tipo `image` con `metadata.sticker = true`. **Cambio de comportamiento:** como cualquier imagen, un sticker de un cliente pasa por el pipeline y el agente puede contestarlo (antes ni se enteraba). Si el dueño no lo quiere, hay que cortar el turno en `on-message-received` para `metadata.sticker`.
- **Nombres de archivo:** son datos de terceros. `sanearNombreArchivo` los deja como un nombre (sin `/`, `\`, `..`, control, reservados de Windows). **La ruta en Storage nunca los usa**: sólo ids.

### Historial y ecos

- Los `history` con `value.messages[]` (el follow-up con ids) ahora se leen (`parse-coexistencia.ts`): antes se tiraban. Quedan en la **sesión importada** del lead y se encolan igual.
- El follow-up de la doc no muestra `to`. Si lo mandó el cliente, el cliente es `from`; si lo mandó el negocio (`from` = `display_phone_number`) hace falta `to`, y sin él **se descarta** en vez de adivinar el hilo.
- Una reentrega (o un reintento tras fallar el `send` a Inngest) de un mensaje cuyo archivo sigue `pendiente` **vuelve a encolar**: si no, el archivo quedaba sin pedir para siempre.

## 3. Mostrar y mandar en el Inbox

**Ver** (`MediaDelMensaje.tsx`): imagen con miniatura que abre un diálogo accesible (foco atrapado, Escape, botón de cerrar, descarga), audio y video con reproductor nativo (`preload` mínimo, etiquetado «Nota de voz» cuando corresponde), documento como tarjeta con nombre, tamaño y «Descargar»; estados de «Descargando…» (`role="status"`), error con «Reintentar» y omitido con motivo. Todo pide `/api/media/<mensajeId>`: una **ruta con sesión** (Zod en el id) que redirige a una **URL firmada de 5 minutos** (`SEGUNDOS_DE_FIRMA`). Es ruta y no Server Action porque es una lectura idempotente disparada por `<img src>` y las acciones se encolan una a una. Si la RLS no deja ver el mensaje, es un 404 (no se distingue «no hay» de «no es tuyo»). El redirect se cachea 240 s en el navegador (`private`) para que el refresco de 5 s del hilo no vuelva a firmar. Los documentos y los binarios sin tipo **siempre** salen como descarga (`Content-Disposition` vía `download=`). La CSP ya permitía `https://*.supabase.co` en `img-src` y `media-src`; se sumó el Storage local en desarrollo.

**Mandar** (`MessageInput.tsx`, sólo WhatsApp): botón de adjuntar (`accept` = lo que Meta acepta), vista previa con nombre y tamaño, texto opcional (un audio va sin texto). Flujo en tres pasos porque **una función de Vercel no recibe más de 4,5 MB de cuerpo** (verificado 2026-10-12, vercel.com/docs/functions/limitations) y los archivos llegan a 16 MB:

1. `prepararAdjuntoAction` valida tipo y tamaño (mismas reglas que el navegador), sesión, canal y **ventana de 24 h** (estrictamente: cerrada = no se sube nada) y devuelve una ruta nueva `sesiones/<sesión>/<uuid>.<ext>` y el token de subida firmada (`createSignedUploadUrl`, válida 2 h según la doc de supabase-js). El panel no tiene permiso de escritura en el bucket; el token es lo único que autoriza _esa_ ruta, sin pisar.
2. El navegador sube **directo a Storage**.
3. `enviarAdjuntoAction` baja el objeto, **revalida por los bytes** (el tipo sale de la extensión de la ruta y se verifica contra la firma; ruta de otra sesión o con `..` se rechaza), sube a Meta (`POST /{phone_number_id}/media`, token del número de la conversación), manda `{type, <type>: {id, caption?, filename?}}`, y deja el mensaje en el hilo con la copia propia. Idempotente por `adjunto:<uuid del objeto>` (doble clic no manda dos veces).

- **Fotos de más de 5 MB:** una foto de teléfono pesa 5-12 MB y Meta acepta 5. Se aceptan JPEG/PNG de hasta **25 MB** y el servidor las reduce a JPEG ≤ 5 MB (2048 px, calidad 85→40). Si no se puede, error claro. Se guarda en el hilo la que se mandó.
- **Límites propios:** 50 MiB por archivo (el tope global de Storage del plan Free es 50 MB; verificado 2026-10-12, supabase.com/docs/guides/storage/uploads/file-limits), así que un documento de 50-100 MB que Meta aceptaría **no se puede mandar** desde el CRM.
- Audio: se manda como audio común (sin `voice`); una nota de voz «de verdad» requeriría OGG/OPUS mono ≤ 512 KB y no se implementó.

## 4. Copia permanente en la PC (app de escritorio)

Ver `desktop/README.md` «Archivo de media». Resumen: el proceso principal consulta `GET /api/escritorio/archivos` (sesión del CRM, cursor `(descargado_at, id)`, Zod) y baja cada archivo por `/api/media/<id>?descargar=1` a `<USERPROFILE>\CRM Genuino\Archivos\<cliente>\<YYYY-MM-DD>\`, **sin IPC nuevo ni Node en el renderer**. Se negó a guardar en OneDrive (variables `OneDrive*`, tramos de la ruta, junctions): avisa una vez y no baja nada. La respuesta lleva el nombre del cliente: sin caché y sin log.

## 5. Retención (decidido por el dueño el 2026-10-11)

| Qué                                     | Cuándo se borra                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Copia en el bucket de una sesión normal | Con la **purga de sesiones** (29 días después del cierre): `purge-session` borra `media_path` de cada mensaje **y barre la carpeta `sesiones/<sesión>/`** (cubre huérfanos y sesiones de más de 1000 mensajes). Un fallo de Storage avisa y no frena el borrado de la sesión (política existente)                                                                             |
| Archivo de **historial importado**      | **Nunca, mientras la purga siga saltándose esas sesiones** (decisión pendiente del dueño, `conectar-whatsapp.md` §5). Por eso **no se guarda media de historial de más de 14 días** (`HISTORIAL_MAX_DIAS`, estado `omitido` / «historial_viejo») y Meta sólo da ids de los últimos 14 días. Los de ≤ 14 días SÍ se guardan y quedan sin vencimiento hasta que el dueño decida |
| Copia en la PC                          | Nunca la borra el CRM: es la copia permanente                                                                                                                                                                                                                                                                                                                                 |

La purga NO se probó contra un Storage real con objetos (sí con el fake y la carpeta en memoria); `borrarCarpeta` pagina de a 1000.

## 6. Seguridad (revisión)

- **Lectura:** bucket privado; sólo `authenticated` admin/vendedor leen (policy existente `storage_mensajes_media_select`); URL firmada de 5 min por servidor; nada de URL permanente en el cliente ni en la base. Probado contra el stack local: anónimo no firma ni lee, el token adulterado no abre, no hay URL pública.
- **Escritura:** sólo service role, salvo la excepción previa de imágenes de flujos del admin (`flujos/<uuid>.jpg|png`). Probado: vendedor y admin no pueden subir, pisar ni borrar en `sesiones/`.
- **Contenido de terceros:** tipo verificado por firma; no se confía en `mime_type`; sólo imagen/audio/video reconocidos en línea; sin SVG ni HTML; `sharp` con tope de píxeles; nombres saneados; React escapa todo (hay test con un nombre `<img onerror>`).
- **SSRF / filtración de token:** al bajar, el Bearer sólo viaja a `https` + dominios de Meta (o al origen del mock local); las redirecciones se siguen a mano validando cada salto (máx. 3). El id de media se valida antes de armar la ruta.
- **Autorización:** `enviar` revalida sesión abierta del lead, canal, ventana, que la ruta sea de ESA sesión y tenga la forma exacta. El service role en el panel está acotado a ese service (misma idea que `whatsapp-credenciales-bootstrap.ts`).
- **Logs:** nunca teléfonos, nombres de cliente ni de archivo; sólo ids y cantidades (AGENTS.md §0.8). Sin LLM: nada de esto llama a OpenAI.
- **semgrep** (`p/typescript`, `p/security-audit`, `p/react`, `p/nodejs`) sin hallazgos sobre los archivos tocados.

## 7. Sin confirmar / riesgos / pendiente

1. **Dominios de descarga de Meta.** La lista (`*.fbsbx.com`, `*.facebook.com`, `*.fbcdn.net`, `*.whatsapp.net`, `*.whatsapp.com`) sale de los ejemplos de la doc y de la CSP; **Meta no publica la lista**. Si un archivo real llega por otro dominio, la descarga falla con «media_url_inesperada» y hay que sumarlo en `graph-api-media.ts`.
2. **La `url` del webhook** («en liberación gradual») no se usa: el flujo confirmado es `GET /{id}`.
3. **`sha256`:** la doc no dice la codificación; no se verifica contra los bytes.
4. **Error de id vencido:** se asume HTTP 400 (o 404) → no reintentable; el formato exacto de Meta no está en la doc leída.
5. **Eco de media:** la doc no muestra un ejemplo; se asumió la misma forma que el follow-up del historial.
6. **Follow-up del historial sin `to`:** ver §2; la dirección sale de comparar `from` con `display_phone_number`.
7. **Audio con `caption`:** no documentado → no se manda; el composer lo bloquea.
8. **Volumen del historial:** un chat con cientos de fotos recientes encola cientos de descargas; la función corre con concurrencia 5 y hasta 50 MiB en memoria cada una (la función de Vercel tiene 2 GB por defecto). No se midió con volumen real.
9. **Leads nuevos por historial:** Métricas ya no cuenta las sesiones importadas (ni sus mensajes), pero **«Leads nuevos» sigue contando los leads que nacen del historial y de los contactos** (no son sesiones). Fuera de alcance; se marca.
10. **Sin barrido de `pendiente`:** si un evento de Inngest se pierde antes de encolarse (no hay forma de saberlo desde acá), el mensaje queda «Descargando…» para siempre. El reintento de Meta del webhook y el re-encolado de ecos/historial cubren los casos conocidos.
11. **Migración sin aplicar** en crm-dev/producción; el bucket `mensajes_media` se actualiza con ella. Sin la migración el código falla al leer las columnas nuevas.

## 8. Qué tiene que hacer el dueño

- Aplicar `20261012120000_mensajes_media.sql` en crm-dev y producción (`npm run db:push` con la regla de siempre: nadie escribiendo migraciones en paralelo).
- Decidir la retención del historial importado (ver §5) y si un sticker puede disparar al agente.
- Probar con Meta real un archivo de cada tipo (entrante y saliente) en cuanto el número real esté verificado, y avisar si algún dominio de descarga cae en el punto 1 de §7.
- Reiniciar la app de escritorio (`npm run build` en `desktop/`) para que archive; revisar que `C:\Users\<usuario>\CRM Genuino` no esté dentro de OneDrive.

## 9. Cómo probarlo sin Meta

```bash
# unit + E2E contra el mock (sin Supabase)
npx vitest run tests/unit/media tests/unit/meta tests/unit/desktop tests/e2e/media.mock-meta.test.ts

# bucket, RLS, columnas y filtros del historial importado, contra el stack local
node scripts/con-stack-local.mjs --perfil test --resembrar -- \
  npx vitest run -c vitest.integration.config.ts \
  tests/integration/mensajes-media.supabase.test.ts \
  tests/integration/historial-importado.supabase.test.ts \
  tests/integration/messages.supabase.test.ts
```

A mano con el stack completo (`docs/runbooks/como-correr-el-crm.md` §4.1) y el mock corriendo:

```bash
# una foto entrante (base64 de cualquier JPEG)
curl -s -X POST http://127.0.0.1:55390/__mock/media/entrante -H 'content-type: application/json' \
  -d '{"from":"12025550190","tipo":"image","mime":"image/jpeg","base64":"<...>","caption":"esta pieza","urlsVencidas":1}'
# un eco con documento y el follow-up del historial
curl -s -X POST http://127.0.0.1:55390/__mock/media/eco -H 'content-type: application/json' \
  -d '{"to":"12025550190","tipo":"document","mime":"application/pdf","base64":"<...>","nombre":"lista.pdf"}'
curl -s -X POST http://127.0.0.1:55390/__mock/media/historial -H 'content-type: application/json' \
  -d '{"from":"12025550190","tipo":"image","mime":"image/jpeg","base64":"<...>"}'
```
