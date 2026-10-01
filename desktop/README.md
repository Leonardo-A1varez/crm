# CRM de escritorio — spike

Prueba técnica, no la app final. Una ventana de Windows con el **CRM ocupando toda la ventana**. La vista de **WhatsApp Web original** se crea recién la primera vez que hace falta (lazy) y se superpone al área que el Inbox reserva en `/inbox/<leadId>` cuando el chat abierto es de WhatsApp y el usuario eligió "WhatsApp Web" — la barra lateral queda siempre visible. Al salir de la sección la vista se **oculta, no se destruye**: nunca pierde la sesión ni recarga sola. Desde el CRM se puede además abrir un chat con un texto precargado; **lo envía una persona presionando Enter**. La app no automatiza nada dentro de WhatsApp Web: solo le cambia la URL (`loadURL`), la posiciona (`setBounds`) y la muestra/oculta (`setVisible`).

Por qué hace falta: `web.whatsapp.com` responde `X-Frame-Options: DENY`, así que no entra en un iframe del CRM.

## El puente `window.crmEscritorio`

Expuesto por `src/preload/crm.ts` (interfaz `CrmEscritorio` ahí documentada). Todo mensaje se valida en el main (`src/main/seguridad.ts`) contra el frame principal de la vista del CRM y su origen; lo inválido se ignora o se rechaza, nunca tira la app.

| Función                                | Tipo                     | Qué hace                                                                                                                                                          |
| --------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `abrirChat(telefono, texto)`            | `invoke` (con respuesta) | Crea la vista si hace falta y navega a `/send?phone=…&text=…`. Si el CRM no está en un chat del Inbox, navega pero no la muestra. Devuelve `{ok:true, ms, mostrada}` o `{ok:false, motivo}`. |
| `reportarAreaWhatsApp(area \| null)`    | `send` (fire-and-forget) | El CRM manda el rect (`getBoundingClientRect()`, CSS px) del contenedor donde va WhatsApp cada vez que cambia (ResizeObserver/resize), y `null` al desmontarse. |
| `mostrarWhatsApp(opciones?)`            | `invoke` (con respuesta) | Crea la vista si hace falta, la muestra si el CRM está en `/inbox/<leadId>` con área reportada. `{recargar:true}` fuerza un `loadURL` a WhatsApp Web (sin cerrar sesión). Devuelve `{ok:true}` o `{ok:false, motivo}`. |
| `obtenerVistaWhatsApp()` | `invoke` | Devuelve `{ recorteIzquierdo, completo, anchoArea, calibrado }`: el recorte **efectivo** para el ancho de área actual (ver "Recorte izquierdo"). |
| `configurarVistaWhatsApp({ recorteIzquierdo?, completo? })` | `invoke` | `recorteIzquierdo`: entero 0-1200 (DIP); se guarda como la **calibración del ancho de área actual**, sin área reportada se rechaza con `sin_area`. `completo`: booleano en memoria, sin recorte. Aplica los bounds al instante. Devuelve `{ ok:true, recorteIzquierdo, completo, anchoArea, calibrado }` o `{ ok:false, motivo }` (clave desconocida, tipo o rango inválido: rechaza todo el mensaje y el estado no cambia). |
| `alCambiarVistaWhatsApp(cb)` | evento main → CRM (`crm:vista-whatsapp-cambio`) | `cb({ recorteIzquierdo, completo, anchoArea, calibrado })` cuando el recorte efectivo cambia **sin que el CRM lo pidiera** (resize, maximizar). Los cambios pedidos por `configurarVistaWhatsApp` no generan evento. Devuelve la función para desuscribirse. |

Regla de visibilidad: la vista de WhatsApp es visible **si y solo si** el CRM está en `/inbox/<algo>` (pathname que empieza con `/inbox/` y tiene algo después; `/inbox` solo no cuenta) **y** hay un área reportada no nula. El orden entre navegación y área reportada no importa — `CoordinadorWhatsapp` (`src/main/coordinador-whatsapp.ts`) reevalúa ambas condiciones en cada evento. El rect que llega en CSS px se multiplica por el `zoomFactor` de la vista del CRM para convertirlo a los DIP que usa `setBounds`; en el resize de la ventana se reaplica el último área conocida (el CRM además va a re-reportar la suya).

La navegación se detecta con `did-navigate` (carga dura / inicial) y `did-navigate-in-page` (navegación client-side de Next.js), ambos del frame principal de la vista del CRM — nunca de un `<iframe>` embebido.

## Recorte izquierdo (solo el panel de conversación)

WhatsApp Web dibuja a la izquierda una barra de íconos y la lista de chats. Dentro del área reportada se muestra **solo el panel de conversación**: la vista de WhatsApp es hija de un `View` contenedor (`new View()`, bounds = área reportada × zoom) y se posiciona con `x = -recorteIzquierdo`, `width = area.width + recorteIzquierdo`. Lo que cae fuera del contenedor **no se dibuja y no recibe clics**. No se inyecta ni se lee nada de WhatsApp Web: solo `loadURL`, bounds y visibilidad.

- **Calibración por ancho.** Un único recorte no sirve: el ancho de la lista de chats de WhatsApp Web depende del ancho total de la vista (área + recorte), que no se puede leer. Se guarda una lista de calibraciones `{ anchoArea, recorte }` (`anchoArea` = ancho del contenedor en DIP redondeado a 10; máx. 20, reemplaza la del mismo ancho y descarta la más vieja). Recorte efectivo: 0 calibraciones → 0; 1 → ese valor; 2 o más → interpolación lineal entre las dos más cercanas que rodean el ancho, y fuera del rango la más cercana (sin extrapolar); entero, 0-1200. Se recalcula en cada cambio de área o resize. Lógica pura en `src/main/calibracion-recorte.ts`.
- `recorteIzquierdo` (DIP, no se multiplica por el zoom del CRM). Se persiste en `%APPDATA%\crm-escritorio\vista-whatsapp.json` como `{ version: 2, calibraciones: [...] }` (escritura atómica temp + rename, debounce de 300 ms; lectura tolerante: archivo ausente o corrupto → sin calibraciones, entradas inválidas se descartan). También se vuelca al cerrar la ventana.
- **Migración:** el formato viejo `{ recorteIzquierdo }` se conserva como valor por defecto hasta que el CRM reporta la primera área; ahí pasa a ser la calibración de ese ancho y el archivo se reescribe.
- `completo`: solo en memoria, default `false`. Con `true` la vista ocupa exactamente el área (sin recorte) y el valor de `recorteIzquierdo` se conserva.
- La documentación de Electron (`View`, `addChildView`, `setBounds`) no dice que el padre recorte a sus hijos; se **midió** (autocheck (k), abajo) en Electron 44.4.5.

## Instalar

Requiere Node 22.12 o superior.

```powershell
cd desktop
npm install
```

Electron 44 descarga su binario (~400 MB en `desktop/node_modules`) **la primera vez que se ejecuta**, no durante `npm install`.

## Correr

| Variable          | Valores                                    | Efecto                                                                                              |
| ----------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `CRM_URL`         | vacío · `spike` · URL https                | Vacío: producción. `spike`: carga `spike/prueba.html`. http solo contra `localhost`/`127.0.0.1`.    |
| `WA_UA`           | `chrome` (default) · `electron`            | UA que ve WhatsApp. `chrome` es el de Electron sin los tokens `Electron/…` ni `crm-escritorio/…`.    |
| `DEBUG`           | `1`                                        | Abre DevTools **solo** de la vista del CRM. La de WhatsApp nunca tiene DevTools.                    |
| `SPIKE_AUTOCHECK` | `1` (+ `SPIKE_SALIDA=<carpeta>`)           | Medición automática sin sesión (ver abajo) y sale.                                                  |

Modo prueba (formulario local en lugar del CRM), en PowerShell:

```powershell
cd desktop
$env:CRM_URL = "spike"; npm start
```

Contra el CRM de producción: `Remove-Item Env:CRM_URL -ErrorAction SilentlyContinue; npm start`. El CRM real todavía **no** llama a `window.crmEscritorio` (ni `abrirChat` ni el resto del puente); eso es trabajo del agente que construye la integración en `/inbox/<leadId>` en `src/`. En modo `CRM_URL=spike` no hay router ni ruta de chat, así que `spike/prueba.html` simula estar siempre en la sección (el main la trata así al arrancar) y reporta un área fija con `reportarAreaWhatsApp` para que WhatsApp siga apareciendo a la derecha, igual que en el spike original de dos paneles.

Los perfiles quedan en `%APPDATA%\crm-escritorio\Partitions\`: `whatsapp` (sesión de WhatsApp, persistente) y `crm`. El autocheck usa perfiles aparte (`whatsapp-spike-*`, `crm-spike`) y nunca toca `whatsapp`.

## Autocheck

`SPIKE_AUTOCHECK=1` corre sin sesión (perfil `whatsapp-spike-<modo>` borrado al inicio, nunca toca `persist:whatsapp`) y prueba de punta a punta el contrato de mostrar/ocultar de `CoordinadorWhatsapp` contra `spike/prueba.html`, usando el puente real (`window.crmEscritorio.*` vía `executeJavaScript`, no llamadas directas al coordinador salvo para simular navegación — el spike no tiene router). Sale solo y deja un JSON en `SPIKE_SALIDA` con un booleano `pasa` y el estado completo por chequeo:

- **(a)** en la sección sin área reportada: la vista se crea (la navegación a `/inbox/<leadId>` la crea sola) pero no es visible.
- **(b)** con área reportada por el puente + en la sección: visible, `bounds = área × zoomFactor`.
- **(c0)** navegar de `/inbox/lead-b` a otro lead no oculta ni recrea (mismo `webContents.id`); `/inbox` sin chat oculta sin recrear.
- **(c)** salir de la sección: oculta, mismo `webContents.id` (no se recreó).
- **(d)** `mostrarWhatsApp({recargar:true})`: recarga de verdad — se cuenta vía una bitácora en `cargar()`, no solo el `ok:true` de la respuesta.
- **(e)** rect inválido (`x` negativo): se ignora, el estado no cambia.
- **(f)** sin archivo de preferencias: `{recorteIzquierdo:0, completo:false, anchoArea, calibrado:false}` y la vista ocupa exactamente el contenedor.
- **(g)** ráfaga de `configurarVistaWhatsApp` (slider): `boundsVista = {x:-300, ...}`, el contenedor no se mueve.
- **(h)** `completo:true` quita el recorte sin perderlo; `false` lo restaura.
- **(i)** 14 entradas inválidas (null, tipos, negativos, 1201, decimales, NaN/Infinity, claves desconocidas) rechazadas sin cambiar el estado; 0 y 1200 aceptados.
- **(j)** persistencia: no escribe antes del debounce, escribe sin `.tmp` sobrantes, un coordinador nuevo lee lo escrito; archivo corrupto / fuera de rango / ausente → 0. Usa un archivo propio en `SPIKE_SALIDA/prefs-autocheck/`, nunca el real (el coordinador del autocheck recibe esa ruta).
- **(j2)** migración del formato viejo `{recorteIzquierdo:550}`: sin área rige como valor por defecto, `configurarVistaWhatsApp` con recorte devuelve `sin_area`, con la primera área pasa a calibración de ese ancho y el archivo queda sin `recorteIzquierdo`.
- **calibracion_\*** matemática y archivo (`src/main/autocheck-calibracion.ts`, sin electron; también corre con `node` sobre `dist/`): 0/1/2/3 calibraciones, dentro/fuera de rango, redondeo, tope de 20, reemplazo, archivo corrupto, entradas inválidas y duplicadas.
- **(l)** resize real: `setContentSize` con un listener que re-reporta el área (emula el ResizeObserver del CRM); el recorte efectivo se interpola/clampa/es exacto según el ancho, los bounds lo aplican y `alCambiarVistaWhatsApp` recibe el evento; un cambio por `configurarVistaWhatsApp` no emite; tras desuscribirse no llegan eventos.
- **(k)** recorte **real**: a la vista de la partición de spike se le carga una página de prueba (franja roja de 300 px a la izquierda, resto azul). Se captura **solo la ventana de la app** (`desktopCapturer`, fuente `window`) y se cuentan píxeles: con recorte 300 hay 0 píxeles rojos puros, con `completo:true` hay más de 0 (control de que la captura sirve). Clics: mensajes `WM_MOUSEMOVE/LBUTTONDOWN/LBUTTONUP` enviados al HWND de la ventana (mismo camino de hit-testing de Chromium; no mueven el cursor ni dependen de qué ventana esté al frente). Un clic en la franja recortada llega al CRM y **no** a WhatsApp; tres clics dentro del área llegan a WhatsApp con `clientX = clic − area.x + recorte`. Guarda `recorte-con-recorte-300.png` y `recorte-completo.png` en `SPIKE_SALIDA`.

Reproducir (Git Bash; cerrar antes cualquier `electron.exe` que corra desde `desktop/node_modules`):

```bash
cd desktop && npm run build
SPIKE_AUTOCHECK=1 WA_UA=chrome SPIKE_SALIDA="C:\\ruta\\salida" npx electron .
```

**Última corrida (2026-09-29, Electron 44.4.5 / Chromium 152.0.7977.130, `WA_UA=chrome`, con la calibración por ancho): (a)-(e), (f)-(l), j2 y calibracion_* pasaron todos en la misma corrida.** Antes de la calibración, (k) había pasado en 2 corridas seguidas. (d) pasó en unas corridas y falló en otra con `carga_fallida:` (la recarga se intentó, `cargasDespues` = `cargasAntes + 1`, pero la carga de red de `web.whatsapp.com` no terminó bien); igual que el `abrirChat` de regresión, que también devolvió `carga_fallida:` en una corrida anterior. Son fallos de red, no del contrato de mostrar/ocultar ni del recorte; no se investigaron.

Antes de este cambio (2026-09-28) el autocheck medía en cambio la pantalla de login de WhatsApp Web según `WA_UA` (con el UA de Electron aparece "WhatsApp works with Google Chrome 100+"; con el derivado `chrome`, el QR) — esa instrumentación (hooks de `webRequest`, capturas de pantalla) se sacó del script para dejar lugar a los chequeos (a)-(e); la conclusión de esa medición sigue siendo válida pero ya no se reproduce en cada corrida.

## Checklist manual (lo corre el dueño)

Preparación: `cd desktop; npm install; $env:CRM_URL = "spike"; npm start`. Se abre la ventana con el formulario ocupándola entera; apenas la página reporta su área fija, WhatsApp Web aparece superpuesto a la derecha (mismo resultado visual que el spike original de dos paneles, ahora vía el puente `reportarAreaWhatsApp`).

| #   | Paso                                                                                                                                                 | Qué mirar                                                                                        | Resultado |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | --------- |
| 1   | En el celular: WhatsApp → Dispositivos vinculados → Vincular. Escanear el QR de la derecha.                                                          | Carga la lista de chats. ¿Aparece algún aviso de navegador no soportado después del login?      |           |
| 2   | Cerrar la app. Volver a correr `npm start` (con `$env:CRM_URL = "spike"`).                                                                           | Abre directo en los chats, sin pedir QR.                                                         |           |
| 3a  | En el formulario: un número real suyo (con código de país) y un texto de varias palabras con tilde, `+` y `&` (p. ej. `Hola José, repuesto A+B & C`). Tocar "Abrir chat". | El chat se abre y el texto aparece **igual** en el cuadro, **sin enviarse**. Anotar el `ms` que muestra el formulario. |           |
| 3b  | Mirar el cuadro durante 10 s sin tocar nada.                                                                                                         | No se envía solo.                                                                                |           |
| 3c  | Repetir 3a con el cuadro vacío de texto.                                                                                                             | Abre el chat sin texto.                                                                          |           |
| 4   | Con la app abierta, abrir `https://web.whatsapp.com` en Chrome con la misma cuenta ya vinculada o vinculándola.                                      | ¿Qué pasa en la app y en Chrome? ("usar aquí", desconexión, conviven…)                           |           |
| 5   | En la app, escribir y enviar a mano un mensaje a un número propio.                                                                                   | Llega al otro teléfono.                                                                          |           |
| 6   | Tocar un link externo dentro de un chat (p. ej. un https que le hayan mandado).                                                                      | Se abre en el navegador del sistema, no dentro de la app.                                        |           |

## Seguridad (lo que hace el spike)

- Las dos vistas: `contextIsolation`, `sandbox`, sin `nodeIntegration`, `app.enableSandbox()` global. Ventanas nuevas denegadas; los links `https:` van a `shell.openExternal`.
- Vista WhatsApp: sin preload, sin DevTools, navegación del frame principal solo a `web.whatsapp.com`; permisos concedidos solo `notifications` y `clipboard-sanitized-write` (micrófono y cámara negados: las notas de voz no van a andar en el spike). Nunca se le llama `executeJavaScript`, ni se automatiza ni se lee nada de su contenido — la app solo la carga, la posiciona y la muestra/oculta.
- Vista CRM: navegación solo al origen de `CRM_URL`; preload que expone el puente `crmEscritorio` (arriba).
- Los 5 canales IPC (`crm:abrir-chat`, `crm:reportar-area-whatsapp`, `crm:mostrar-whatsapp`, `crm:obtener-vista-whatsapp`, `crm:configurar-vista-whatsapp`) exigen el mismo remitente: frame principal de la vista CRM, en su origen. `abrirChat` valida además teléfono E.164 (8–15 dígitos) y texto ≤ 4096 caracteres, y arma la URL con `URL`/`URLSearchParams`; `reportarAreaWhatsApp` valida 4 números finitos no negativos que quepan en el contenido de la ventana; `mostrarWhatsApp` solo acepta `{recargar?: boolean}`; `configurarVistaWhatsApp` solo `recorteIzquierdo` (entero 0-1200) y `completo` (booleano). Los logs muestran solo los últimos 4 dígitos del teléfono y el largo del texto, nunca el contenido.
- La partición `persist:whatsapp` nunca se borra ni se le cierra la sesión por código: cerrar la ventana cierra el `webContents` (libera el proceso) pero no toca el perfil en disco.
