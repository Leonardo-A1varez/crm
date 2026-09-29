import { app, session, WebContentsView } from "electron";
import type { Session } from "electron";

import { endurecerContenido, limitarPermisos, politicaWhatsapp } from "./seguridad";
import type { Bitacora } from "./seguridad";

export const URL_WHATSAPP = "https://web.whatsapp.com/";
const TIMEOUT_CARGA_MS = 30_000;

export type ModoUa = "electron" | "chrome";

export type ResultadoCarga = { ok: true; ms: number } | { ok: false; motivo: string };

function escaparRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * UA de Chrome derivado del que arma Electron: se sacan solo los tokens
 * `Electron/<ver>` y `<nombre-app>/<ver>`. El resto (versión de Chrome,
 * plataforma) queda como lo reporta el runtime, sin strings pegados a mano.
 */
export function uaSinElectron(uaBase: string): string {
  const tokenApp = new RegExp(`\\s${escaparRegex(app.getName())}/\\S+`);
  return uaBase
    .replace(/\sElectron\/\S+/, "")
    .replace(tokenApp, "")
    .replace(/\s{2,}/g, " ");
}

export interface OpcionesVistaWhatsapp {
  particion: string;
  modoUa: ModoUa;
  bitacora?: Bitacora;
}

export interface VistaWhatsapp {
  vista: WebContentsView;
  sesion: Session;
  ua: string;
  cargar(url: string): Promise<ResultadoCarga>;
  abrirChat(telefono: string, texto: string): Promise<ResultadoCarga>;
}

export function crearVistaWhatsapp(opciones: OpcionesVistaWhatsapp): VistaWhatsapp {
  const sesion = session.fromPartition(opciones.particion);
  if (opciones.modoUa === "chrome") {
    sesion.setUserAgent(uaSinElectron(sesion.getUserAgent()));
  }
  // Notificaciones y copiar al portapapeles: lo mínimo para usar WhatsApp Web.
  // Micrófono, cámara, geolocalización y el resto quedan negados en el spike.
  limitarPermisos(sesion, new Set(["notifications", "clipboard-sanitized-write"]));

  const vista = new WebContentsView({
    webPreferences: {
      session: sesion,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      devTools: false,
    },
  });
  const wc = vista.webContents;
  endurecerContenido(wc, politicaWhatsapp, opciones.bitacora);

  async function cargar(url: string): Promise<ResultadoCarga> {
    opciones.bitacora?.cargaIniciada?.();
    const inicio = performance.now();
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<ResultadoCarga>((resolve) => {
      timer = setTimeout(() => resolve({ ok: false, motivo: "timeout_30s" }), TIMEOUT_CARGA_MS);
    });
    // loadURL resuelve en did-finish-load y rechaza en did-fail-load.
    const carga = wc.loadURL(url).then(
      (): ResultadoCarga => ({ ok: true, ms: Math.round(performance.now() - inicio) }),
      (err: unknown): ResultadoCarga => ({
        ok: false,
        motivo: `carga_fallida:${(err as { code?: string }).code ?? "desconocido"}`,
      }),
    );
    try {
      return await Promise.race([carga, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    vista,
    sesion,
    ua: sesion.getUserAgent(),
    cargar,
    abrirChat(telefono, texto) {
      // URL oficial de click-to-chat; armada con URL/URLSearchParams, nunca
      // concatenando lo que manda el renderer.
      const destino = new URL("/send", URL_WHATSAPP);
      destino.searchParams.set("phone", telefono);
      if (texto.length > 0) destino.searchParams.set("text", texto);
      return cargar(destino.href);
    },
  };
}
