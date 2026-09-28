# CRM de escritorio — spike

Prueba técnica, no la app final. Una ventana de Windows con el CRM a la izquierda y **WhatsApp Web original** a la derecha. Desde el CRM se abre un chat con un texto precargado; **lo envía una persona presionando Enter**. La app no automatiza nada dentro de WhatsApp Web: solo le cambia la URL (`loadURL`) a la oficial `https://web.whatsapp.com/send?phone=<E164 sin +>&text=<texto>`.

Por qué hace falta: `web.whatsapp.com` responde `X-Frame-Options: DENY`, así que no entra en un iframe del CRM.

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

Contra el CRM de producción: `Remove-Item Env:CRM_URL -ErrorAction SilentlyContinue; npm start`. El CRM todavía **no** llama a `window.crmEscritorio.abrirChat`; eso es trabajo posterior al spike.

Los perfiles quedan en `%APPDATA%\crm-escritorio\Partitions\`: `whatsapp` (sesión de WhatsApp, persistente) y `crm`. El autocheck usa perfiles aparte (`whatsapp-spike-*`, `crm-spike`) y nunca toca `whatsapp`.

## Resultado del autocheck (2026-09-28, Electron 44.4.5 / Chromium 152.0.7977.130)

Ejecutado sin sesión, con perfil borrado al inicio. Solo metadatos de red; nunca cuerpos.

| Medición                              | `WA_UA=electron`                                   | `WA_UA=chrome`                         |
| ------------------------------------- | -------------------------------------------------- | -------------------------------------- |
| Pantalla                              | "WhatsApp works with Google Chrome 100+" (rechazo) | QR "Scan to log in"                    |
| HTTP de `/` y de `/send`              | 200 · 200                                          | 200 · 200                              |
| Redirecciones del frame principal     | ninguna                                            | ninguna                                |
| `did-finish-load` de `/`              | 944 ms                                             | 1659 ms                                |
| `abrirChat` (IPC + carga de `/send`)  | 305 ms                                             | 1155 ms                                |
| Hosts de subrecursos                  | static.whatsapp.net                                | static.whatsapp.net, web.whatsapp.com (incl. :5222) |

Conclusión: **con el UA de Electron, WhatsApp Web no se puede usar**; con el UA derivado `chrome` carga la pantalla de login. Los tiempos son de una sola corrida por modo y sin sesión: la carga real con sesión (sincronización de chats) no se midió.

Reproducir (Git Bash):

```bash
cd desktop && npm run build
SPIKE_AUTOCHECK=1 WA_UA=chrome SPIKE_SALIDA="C:\\ruta\\salida" npx electron .
```

## Checklist manual (lo corre el dueño)

Preparación: `cd desktop; npm install; $env:CRM_URL = "spike"; npm start`. Se abre la ventana: formulario a la izquierda, WhatsApp Web a la derecha.

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
- Vista WhatsApp: sin preload, sin DevTools, navegación del frame principal solo a `web.whatsapp.com`; permisos concedidos solo `notifications` y `clipboard-sanitized-write` (micrófono y cámara negados: las notas de voz no van a andar en el spike).
- Vista CRM: navegación solo al origen de `CRM_URL`; preload que expone únicamente `abrirChat(telefono, texto)`.
- IPC `crm:abrir-chat`: valida que venga del frame principal de la vista CRM y de su origen, teléfono E.164 (8–15 dígitos) y texto ≤ 4096 caracteres; arma la URL con `URL`/`URLSearchParams`. Los logs muestran solo los últimos 4 dígitos y el largo del texto.
