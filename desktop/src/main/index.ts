import fs from "node:fs";
import path from "node:path";

import { app, ipcMain, Menu } from "electron";
import type { BaseWindow, WebContents } from "electron";

import {
  normalizarTelefono,
  remitenteValido,
  ultimos4,
  validarAreaWhatsapp,
  validarCambiosVista,
  validarOpcionesMostrar,
  validarTexto,
} from "./seguridad";
import type { OrigenCrm } from "./seguridad";
import { CoordinadorWhatsapp, pathnameDe } from "./coordinador-whatsapp";
import type { ConfigVistaWhatsapp, EstadoCoordinador } from "./coordinador-whatsapp";
import { chequeosCalibracion } from "./autocheck-calibracion";
import { chequeosRecorte } from "./autocheck-recorte";
import { crearVentana } from "./ventana";
import { crearVistaCrm, resolverOrigenCrm } from "./vista-crm";
import type { ModoUa } from "./vista-whatsapp";

const DEBUG = process.env.DEBUG === "1";
const AUTOCHECK = process.env.SPIKE_AUTOCHECK === "1";
// Default `chrome`: con el UA de Electron, WhatsApp Web responde con la
// pantalla "WhatsApp works with Google Chrome 100+" (ver README, autocheck).
const MODO_UA: ModoUa = process.env.WA_UA === "electron" ? "electron" : "chrome";

function log(mensaje: string, datos: Record<string, unknown> = {}): void {
  // Nunca teléfono ni texto completos acá (regla de PII del proyecto).
  console.info(`[crm-escritorio] ${mensaje}`, JSON.stringify(datos));
}

app.enableSandbox();

// Dos instancias sobre el mismo perfil persistente se pisan la sesión.
const instanciaUnica = app.requestSingleInstanceLock();
if (!instanciaUnica) app.quit();

/**
 * Los 5 canales de invocación que expone `crmEscritorio`. Todos exigen el mismo
 * remitente: frame principal de la vista del CRM, en su origen permitido.
 */
function registrarCanalesCrm(
  crm: WebContents,
  origen: OrigenCrm,
  ventana: BaseWindow,
  coordinador: CoordinadorWhatsapp,
): void {
  ipcMain.handle(
    "crm:abrir-chat",
    async (event, telefono: unknown, texto: unknown) => {
      if (!remitenteValido(event, crm, origen)) {
        log("abrirChat rechazado: remitente no permitido");
        return { ok: false, motivo: "remitente_no_permitido" };
      }
      const tel = normalizarTelefono(telefono);
      if (!tel.ok) return { ok: false, motivo: tel.motivo };
      const txt = validarTexto(texto);
      if (!txt.ok) return { ok: false, motivo: txt.motivo };

      const resultado = await coordinador.abrirChat(tel.valor, txt.valor);
      log("abrirChat", {
        telefono: ultimos4(tel.valor),
        largoTexto: txt.valor.length,
        ...resultado,
      });
      return resultado;
    },
  );

  // Fire-and-forget (ipcRenderer.send): no hay respuesta que mandar, un
  // mensaje inválido simplemente se ignora sin tirar la app.
  ipcMain.on("crm:reportar-area-whatsapp", (event, area: unknown) => {
    if (!remitenteValido(event, crm, origen)) {
      log("reportarAreaWhatsApp rechazado: remitente no permitido");
      return;
    }
    const { width, height } = ventana.getContentBounds();
    const zoom = crm.getZoomFactor();
    const limite = { width: width / zoom, height: height / zoom };
    const validado = validarAreaWhatsapp(area, limite);
    if (!validado.ok) {
      log("reportarAreaWhatsApp rechazado", { motivo: validado.motivo });
      return;
    }
    coordinador.reportarArea(validado.valor);
  });

  ipcMain.handle("crm:mostrar-whatsapp", async (event, opciones: unknown) => {
    if (!remitenteValido(event, crm, origen)) {
      log("mostrarWhatsApp rechazado: remitente no permitido");
      return { ok: false, motivo: "remitente_no_permitido" };
    }
    const validado = validarOpcionesMostrar(opciones);
    if (!validado.ok) return { ok: false, motivo: validado.motivo };
    const resultado = await coordinador.mostrar(validado.valor);
    log("mostrarWhatsApp", resultado);
    return resultado;
  });

  ipcMain.handle("crm:obtener-vista-whatsapp", (event) => {
    if (!remitenteValido(event, crm, origen)) {
      log("obtenerVistaWhatsApp rechazado: remitente no permitido");
      return { ok: false, motivo: "remitente_no_permitido" };
    }
    return coordinador.obtenerConfigVista();
  });

  ipcMain.handle("crm:configurar-vista-whatsapp", (event, cambios: unknown) => {
    if (!remitenteValido(event, crm, origen)) {
      log("configurarVistaWhatsApp rechazado: remitente no permitido");
      return { ok: false, motivo: "remitente_no_permitido" };
    }
    const validado = validarCambiosVista(cambios);
    if (!validado.ok) return { ok: false, motivo: validado.motivo };
    return coordinador.configurarVista(validado.valor);
  });
}

/** El recorte efectivo cambió por un resize (no por el CRM): el CRM lo muestra en vivo. */
function avisarCambioVista(crm: WebContents, estado: ConfigVistaWhatsapp): void {
  if (!crm.isDestroyed()) crm.send("crm:vista-whatsapp-cambio", estado);
}

function archivoPreferenciasVista(): string {
  return path.join(app.getPath("userData"), "vista-whatsapp.json");
}

app.whenReady().then(async () => {
  if (!instanciaUnica) return;
  Menu.setApplicationMenu(null);
  app.on("web-contents-created", (_event, contents) => {
    contents.on("will-attach-webview", (e) => e.preventDefault());
  });

  if (AUTOCHECK) {
    await correrAutocheck();
    return;
  }

  const origen = resolverOrigenCrm(process.env.CRM_URL);
  const crm = crearVistaCrm({ origen, particion: "persist:crm", devTools: DEBUG });
  const ventana = crearVentana(crm);
  const coordinador = new CoordinadorWhatsapp({
    ventana,
    crmWebContents: crm.webContents,
    particion: "persist:whatsapp",
    modoUa: MODO_UA,
    archivoPreferencias: archivoPreferenciasVista(),
    alCambiarVista: (estado) => avisarCambioVista(crm.webContents, estado),
  });
  ventana.on("resize", () => coordinador.recalcular());
  ventana.on("closed", () => {
    crm.webContents.close();
    coordinador.cerrar();
  });

  if (origen.tipo === "remoto") {
    // Next.js navega client-side: did-navigate-in-page cubre esos cambios de
    // ruta, did-navigate la carga inicial y cualquier navegación dura.
    crm.webContents.on("did-navigate", (_e, url) => coordinador.reportarNavegacion(pathnameDe(url)));
    crm.webContents.on("did-navigate-in-page", (_e, url, isMainFrame) => {
      if (isMainFrame) coordinador.reportarNavegacion(pathnameDe(url));
    });
  } else {
    // Spike: página estática sin router, no hay una ruta de chat real.
    // Se la trata como si ya estuviera en la sección (ver README).
    coordinador.reportarNavegacion("/inbox/spike");
  }

  registrarCanalesCrm(crm.webContents, origen, ventana, coordinador);
  log("arranque", { crm: origen.tipo === "spike" ? "spike" : origen.origin, ua: MODO_UA });
});

app.on("window-all-closed", () => app.quit());

// ---------------------------------------------------------------------------
// SPIKE_AUTOCHECK=1: prueba sin sesión ni intervención humana el contrato de
// mostrar/ocultar WhatsApp contra la sección del CRM, y sale. Usa perfiles
// propios (persist:whatsapp-spike-<modo>) que se borran al empezar, así nunca
// hay sesión iniciada y nunca toca persist:whatsapp.
// ---------------------------------------------------------------------------

const esperar = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function borrarParticionSpike(nombre: string): boolean {
  if (!/^whatsapp-spike-(electron|chrome)$/.test(nombre)) {
    throw new Error("nombre de partición de spike inesperado");
  }
  const base = path.join(app.getPath("userData"), "Partitions");
  const destino = path.resolve(base, nombre);
  if (!destino.startsWith(base + path.sep) || path.basename(destino) !== nombre) {
    throw new Error("ruta de partición fuera de Partitions");
  }
  fs.rmSync(destino, { recursive: true, force: true });
  return !fs.existsSync(destino);
}

function mismoEstado(a: EstadoCoordinador, b: EstadoCoordinador): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function correrAutocheck(): Promise<void> {
  const salida = process.env.SPIKE_SALIDA;
  if (salida === undefined || salida.trim() === "") {
    log("SPIKE_SALIDA vacío: no hay dónde guardar el resultado");
    app.exit(2);
    return;
  }
  fs.mkdirSync(salida, { recursive: true });

  const nombreParticion = `whatsapp-spike-${MODO_UA}`;
  const perfilNuevo = borrarParticionSpike(nombreParticion);

  const informe: Record<string, unknown> = {
    fecha: new Date().toISOString(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    modoUa: MODO_UA,
    particion: `persist:${nombreParticion}`,
    perfilNuevo,
  };
  const chequeos: Record<string, unknown> = {};
  let cargasIniciadas = 0;

  // Preferencias propias del autocheck: nunca el vista-whatsapp.json real.
  const archivoPrefsAutocheck = path.join(salida, "prefs-autocheck", "vista-whatsapp.json");
  fs.rmSync(path.dirname(archivoPrefsAutocheck), { recursive: true, force: true });
  const origen = resolverOrigenCrm("spike");
  const crm = crearVistaCrm({ origen, particion: "persist:crm-spike", devTools: false });
  const ventana = crearVentana(crm);
  const coordinador = new CoordinadorWhatsapp({
    ventana,
    crmWebContents: crm.webContents,
    particion: `persist:${nombreParticion}`,
    modoUa: MODO_UA,
    archivoPreferencias: archivoPrefsAutocheck,
    alCambiarVista: (estado) => avisarCambioVista(crm.webContents, estado),
    bitacora: {
      cargaIniciada: () => {
        cargasIniciadas += 1;
      },
    },
  });
  ventana.on("resize", () => coordinador.recalcular());
  ventana.on("closed", () => {
    crm.webContents.close();
    coordinador.cerrar();
  });
  registrarCanalesCrm(crm.webContents, origen, ventana, coordinador);

  const crmListo = new Promise<void>((r) => crm.webContents.once("did-finish-load", () => r()));

  function invocarPuente<T>(expresion: string): Promise<T> {
    return crm.webContents.executeJavaScript(expresion) as Promise<T>;
  }

  try {
    await crmListo;

    // (a) En la sección pero sin área reportada todavía: la vista se crea
    // (la navegación a /inbox/<leadId> la crea sola) pero no es visible.
    coordinador.reportarNavegacion("/inbox/lead-a");
    await esperar(300);
    const estadoA = coordinador.estado();
    chequeos.a_sin_area_no_visible = { pasa: estadoA.creada && !estadoA.visible, estado: estadoA };

    // (b) Con área reportada por el puente real (no llamando al coordinador
    // directo) y en la sección: visible, con bounds = área × zoom.
    const areaEnviada = { x: 10, y: 20, width: 300, height: 400 };
    await invocarPuente(`window.crmEscritorio.reportarAreaWhatsApp(${JSON.stringify(areaEnviada)})`);
    await esperar(300);
    const zoom = crm.webContents.getZoomFactor();
    const boundsEsperado = {
      x: Math.round(areaEnviada.x * zoom),
      y: Math.round(areaEnviada.y * zoom),
      width: Math.round(areaEnviada.width * zoom),
      height: Math.round(areaEnviada.height * zoom),
    };
    const estadoB = coordinador.estado();
    chequeos.b_con_area_y_seccion_visible = {
      pasa: estadoB.visible && JSON.stringify(estadoB.bounds) === JSON.stringify(boundsEsperado),
      estado: estadoB,
      boundsEsperado,
    };
    const webContentsIdOriginal = estadoB.webContentsId;

    // (c0) Navegar entre leads dentro de /inbox/…: no se destruye ni se oculta;
    // /inbox sin chat sí oculta (sin recrear).
    coordinador.reportarNavegacion("/inbox/lead-b");
    await esperar(200);
    const estadoC0 = coordinador.estado();
    coordinador.reportarNavegacion("/inbox");
    await esperar(200);
    const estadoC0b = coordinador.estado();
    chequeos.c0_entre_leads_no_destruye = {
      pasa:
        estadoC0.visible &&
        estadoC0.webContentsId === webContentsIdOriginal &&
        !estadoC0b.visible &&
        estadoC0b.webContentsId === webContentsIdOriginal,
      estado: estadoC0,
      estadoInboxSinChat: estadoC0b,
    };
    coordinador.reportarNavegacion("/inbox/lead-a");
    await esperar(200);

    // (c) Salir de la sección: se oculta, mismo webContents.id (no se recreó).
    coordinador.reportarNavegacion("/leads");
    await esperar(300);
    const estadoC = coordinador.estado();
    chequeos.c_salir_de_seccion_oculta_sin_recrear = {
      pasa: !estadoC.visible && estadoC.webContentsId === webContentsIdOriginal,
      estado: estadoC,
    };

    // (e) Rect inválido: se rechaza y el estado no cambia. Se vuelve a la
    // sección primero para que un rect válido hubiese tenido efecto visible.
    coordinador.reportarNavegacion("/inbox/lead-a");
    await esperar(300);
    const estadoAntesInvalido = coordinador.estado();
    await invocarPuente(
      "window.crmEscritorio.reportarAreaWhatsApp({ x: -1, y: 0, width: 10, height: 10 })",
    );
    await esperar(300);
    const estadoDespuesInvalido = coordinador.estado();
    chequeos.e_rect_invalido_rechazado = {
      pasa: mismoEstado(estadoAntesInvalido, estadoDespuesInvalido),
      estadoAntes: estadoAntesInvalido,
      estadoDespues: estadoDespuesInvalido,
    };

    // (d) mostrarWhatsApp({recargar:true}) recarga de verdad (se cuenta vía
    // la bitácora de `cargar()`, no solo el `ok:true` de la respuesta).
    const cargasAntes = cargasIniciadas;
    const resultadoMostrar = await invocarPuente<{ ok: boolean }>(
      "window.crmEscritorio.mostrarWhatsApp({ recargar: true })",
    );
    await esperar(300);
    chequeos.d_mostrar_recargar_recarga = {
      pasa: resultadoMostrar.ok === true && cargasIniciadas === cargasAntes + 1,
      resultadoMostrar,
      cargasAntes,
      cargasDespues: cargasIniciadas,
    };

    // Calibración por ancho: matemática pura y archivo de preferencias.
    Object.assign(chequeos, chequeosCalibracion(path.join(salida, "prefs-calibracion")));

    // Recorte izquierdo: bounds, completo, validación, persistencia y evidencia real.
    Object.assign(
      chequeos,
      await chequeosRecorte({
        ventana,
        crm: crm.webContents,
        coordinador,
        invocarPuente,
        salida,
        archivoPreferencias: archivoPrefsAutocheck,
        particion: `persist:${nombreParticion}`,
        modoUa: MODO_UA,
      }),
    );

    // Regresión del spike original: abrirChat sigue funcionando (rechaza lo
    // inválido, navega con lo válido) y ahora devuelve `mostrada`.
    chequeos.abrirChat = {
      invalido: await invocarPuente('window.crmEscritorio.abrirChat("123", "x")'),
      resultado: await invocarPuente(
        'window.crmEscritorio.abrirChat("15550000000", "prueba spike")',
      ),
    };
  } catch (err) {
    informe.error = err instanceof Error ? err.message : String(err);
  }

  informe.chequeos = chequeos;
  const archivo = path.join(salida, `autocheck-${MODO_UA}.json`);
  fs.writeFileSync(archivo, JSON.stringify(informe, null, 2));
  log("autocheck terminado", { archivo, error: informe.error ?? null });
  ventana.close();
  app.exit(informe.error === undefined ? 0 : 1);
}
