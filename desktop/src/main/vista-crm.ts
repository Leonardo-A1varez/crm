import path from "node:path";
import { pathToFileURL } from "node:url";

import { session, WebContentsView } from "electron";

import { endurecerContenido, limitarPermisos, politicaCrm } from "./seguridad";
import type { OrigenCrm } from "./seguridad";

const CRM_URL_PRODUCCION = "https://crm-wine-one-38.vercel.app";
const HOSTS_LOCALES = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * `CRM_URL`: vacío → producción; `spike` → página local de prueba; cualquier
 * otra cosa tiene que ser https, o http solo contra loopback (dev local).
 */
export function resolverOrigenCrm(valor: string | undefined): OrigenCrm {
  if (valor === "spike") {
    const archivo = path.join(__dirname, "..", "..", "spike", "prueba.html");
    return { tipo: "spike", url: pathToFileURL(archivo).href };
  }
  const url = new URL(valor && valor.length > 0 ? valor : CRM_URL_PRODUCCION);
  const esLoopback = url.protocol === "http:" && HOSTS_LOCALES.has(url.hostname);
  if (url.protocol !== "https:" && !esLoopback) {
    throw new Error("CRM_URL tiene que ser https (o http contra localhost)");
  }
  return { tipo: "remoto", origin: url.origin, url: url.href };
}

export interface OpcionesVistaCrm {
  origen: OrigenCrm;
  particion: string;
  devTools: boolean;
}

export function crearVistaCrm(opciones: OpcionesVistaCrm): WebContentsView {
  const sesion = session.fromPartition(opciones.particion);
  limitarPermisos(sesion, new Set(["clipboard-sanitized-write"]));

  const vista = new WebContentsView({
    webPreferences: {
      session: sesion,
      preload: path.join(__dirname, "..", "preload", "crm.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      devTools: opciones.devTools,
    },
  });
  endurecerContenido(vista.webContents, politicaCrm(opciones.origen));
  void vista.webContents.loadURL(opciones.origen.url);
  if (opciones.devTools) vista.webContents.openDevTools({ mode: "detach" });
  return vista;
}
