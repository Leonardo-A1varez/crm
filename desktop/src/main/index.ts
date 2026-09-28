import fs from "node:fs";
import path from "node:path";

import { app, ipcMain, Menu } from "electron";
import type { WebContents } from "electron";

import { hostDe, normalizarTelefono, remitenteValido, ultimos4, validarTexto } from "./seguridad";
import type { OrigenCrm } from "./seguridad";
import { crearVentana } from "./ventana";
import { crearVistaCrm, resolverOrigenCrm } from "./vista-crm";
import { crearVistaWhatsapp, URL_WHATSAPP } from "./vista-whatsapp";
import type { ModoUa, ResultadoCarga, VistaWhatsapp } from "./vista-whatsapp";

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

function registrarAbrirChat(crm: WebContents, origen: OrigenCrm, wa: VistaWhatsapp): void {
  ipcMain.handle(
    "crm:abrir-chat",
    async (event, telefono: unknown, texto: unknown): Promise<ResultadoCarga> => {
      if (!remitenteValido(event, crm, origen)) {
        log("abrirChat rechazado: remitente no permitido");
        return { ok: false, motivo: "remitente_no_permitido" };
      }
      const tel = normalizarTelefono(telefono);
      if (!tel.ok) return { ok: false, motivo: tel.motivo };
      const txt = validarTexto(texto);
      if (!txt.ok) return { ok: false, motivo: txt.motivo };

      const resultado = await wa.abrirChat(tel.valor, txt.valor);
      log("abrirChat", {
        telefono: ultimos4(tel.valor),
        largoTexto: txt.valor.length,
        ...resultado,
      });
      return resultado;
    },
  );
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
  const wa = crearVistaWhatsapp({ particion: "persist:whatsapp", modoUa: MODO_UA });
  const crm = crearVistaCrm({ origen, particion: "persist:crm", devTools: DEBUG });
  registrarAbrirChat(crm.webContents, origen, wa);
  crearVentana(crm, wa.vista);
  log("arranque", { crm: origen.tipo === "spike" ? "spike" : origen.origin, ua: MODO_UA });
  void wa.cargar(URL_WHATSAPP);
});

app.on("window-all-closed", () => app.quit());

// ---------------------------------------------------------------------------
// SPIKE_AUTOCHECK=1: mide la carga de WhatsApp Web sin intervención humana y
// sale. Usa perfiles propios (persist:whatsapp-spike-<modo>) que se borran al
// empezar, así nunca hay sesión iniciada y nunca toca persist:whatsapp.
// ---------------------------------------------------------------------------

const esperar = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Metadatos de una URL sin valores de query (la de /send lleva teléfono y texto). */
function sinValores(url: string): string {
  try {
    const u = new URL(url);
    const claves = [...u.searchParams.keys()];
    return `${u.origin}${u.pathname}${claves.length > 0 ? `?[${claves.join(",")}]` : ""}`;
  } catch {
    return "(url inválida)";
  }
}

/** Sin <title>, Chromium usa la URL como título: también hay que sacarle la query. */
function tituloSinValores(titulo: string): string {
  const corte = titulo.indexOf("?");
  return corte === -1 ? titulo : `${titulo.slice(0, corte)}?[omitido]`;
}

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
  const navegaciones: unknown[] = [];
  const redirecciones: unknown[] = [];
  const principales: unknown[] = [];
  const cabecerasEnviadas: unknown[] = [];
  const bloqueadas: string[] = [];
  const hostsSubrecursos = new Map<string, number>();

  const origen = resolverOrigenCrm("spike");
  const wa = crearVistaWhatsapp({
    particion: `persist:${nombreParticion}`,
    modoUa: MODO_UA,
    bitacora: { navegacionBloqueada: (host) => bloqueadas.push(host) },
  });
  informe.ua = wa.ua;

  // Solo metadatos de red: status, host, nombres de cabecera de UA. Nunca cuerpos.
  const filtroPrincipal = { urls: ["<all_urls>"], types: ["mainFrame" as const] };
  wa.sesion.webRequest.onSendHeaders(filtroPrincipal, (d) => {
    const h = Object.fromEntries(
      Object.entries(d.requestHeaders).filter(([k]) => /^(user-agent|sec-ch-ua.*)$/i.test(k)),
    );
    cabecerasEnviadas.push({ url: sinValores(d.url), cabeceras: h });
  });
  wa.sesion.webRequest.onBeforeRedirect(filtroPrincipal, (d) => {
    redirecciones.push({
      desde: sinValores(d.url),
      hacia: sinValores(d.redirectURL),
      status: d.statusCode,
    });
  });
  wa.sesion.webRequest.onCompleted((d) => {
    if (d.resourceType === "mainFrame") {
      principales.push({ url: sinValores(d.url), status: d.statusCode, desdeCache: d.fromCache });
    } else {
      const host = hostDe(d.url);
      hostsSubrecursos.set(host, (hostsSubrecursos.get(host) ?? 0) + 1);
    }
  });
  wa.vista.webContents.on("did-navigate", (_e, url, codigo, texto) => {
    navegaciones.push({ url: sinValores(url), http: codigo, estado: texto });
  });

  const crm = crearVistaCrm({ origen, particion: "persist:crm-spike", devTools: false });
  const crmListo = new Promise<void>((r) => crm.webContents.once("did-finish-load", () => r()));
  registrarAbrirChat(crm.webContents, origen, wa);
  const ventana = crearVentana(crm, wa.vista);

  const capturar = async (
    nombre: string,
  ): Promise<{ png: string | null; erroresCaptura: string[] }> => {
    const erroresCaptura: string[] = [];
    // Perfil recién borrado = sin sesión = pantalla de login/QR, no hay chats.
    if (!perfilNuevo) return { png: null, erroresCaptura: ["perfil_no_nuevo"] };
    // capturePage falló de a ratos con UnknownVizError tras navegar a /send;
    // se reintenta y se registra cada fallo en vez de cortar el autocheck.
    for (let intento = 1; intento <= 3; intento++) {
      try {
        const imagen = await wa.vista.webContents.capturePage();
        const archivo = path.join(salida, nombre);
        fs.writeFileSync(archivo, imagen.toPNG());
        return { png: archivo, erroresCaptura };
      } catch (err) {
        erroresCaptura.push(
          `intento${intento}:${err instanceof Error ? err.message : String(err)}`,
        );
        await esperar(1_500);
      }
    }
    return { png: null, erroresCaptura };
  };

  try {
    const inicial = await wa.cargar(URL_WHATSAPP);
    await esperar(10_000);
    informe.cargaInicial = {
      ...inicial,
      urlFinal: sinValores(wa.vista.webContents.getURL()),
      titulo: tituloSinValores(wa.vista.webContents.getTitle()),
      ...(await capturar(`whatsapp-${MODO_UA}-inicio.png`)),
    };

    await crmListo;
    const js = (tel: string, txt: string): string =>
      `window.crmEscritorio.abrirChat(${JSON.stringify(tel)}, ${JSON.stringify(txt)})`;

    // Camino inválido primero: el main tiene que rechazarlo sin navegar.
    informe.abrirChatInvalido = await crm.webContents.executeJavaScript(js("123", "x"));

    const t0 = performance.now();
    const resultado = (await crm.webContents.executeJavaScript(
      js("15550000000", "prueba spike"),
    )) as ResultadoCarga;
    const idaYVuelta = Math.round(performance.now() - t0);
    await esperar(10_000);
    informe.abrirChat = {
      ...resultado,
      msIdaYVueltaIpc: idaYVuelta,
      urlFinal: sinValores(wa.vista.webContents.getURL()),
      titulo: tituloSinValores(wa.vista.webContents.getTitle()),
      ...(await capturar(`whatsapp-${MODO_UA}-send.png`)),
    };
  } catch (err) {
    informe.error = err instanceof Error ? err.message : String(err);
  }

  Object.assign(informe, {
    navegaciones,
    redirecciones,
    principales,
    cabecerasEnviadas,
    navegacionesBloqueadas: bloqueadas,
    hostsSubrecursos: Object.fromEntries(hostsSubrecursos),
  });
  const archivo = path.join(salida, `autocheck-${MODO_UA}.json`);
  fs.writeFileSync(archivo, JSON.stringify(informe, null, 2));
  log("autocheck terminado", { archivo, error: informe.error ?? null });
  ventana.close();
  app.exit(informe.error === undefined ? 0 : 1);
}
