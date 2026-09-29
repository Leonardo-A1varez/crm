import { contextBridge, ipcRenderer } from "electron";
import type { IpcRendererEvent } from "electron";

export interface AreaWhatsapp {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OpcionesMostrarWhatsapp {
  recargar?: boolean;
}

export type ResultadoAbrirChat =
  | { ok: true; ms: number; mostrada: boolean }
  | { ok: false; motivo: string };

export type ResultadoMostrarWhatsapp = { ok: true } | { ok: false; motivo: string };

export interface VistaWhatsappConfig {
  /** Recorte efectivo para el ancho de área actual (interpolado si no hay calibración exacta). */
  recorteIzquierdo: number;
  completo: boolean;
  /** Ancho del área en DIP redondeado a 10; null si todavía no hay área. */
  anchoArea: number | null;
  /** Hay una calibración guardada exactamente para ese ancho. */
  calibrado: boolean;
}

export type ResultadoConfigurarVistaWhatsapp =
  | ({ ok: true } & VistaWhatsappConfig)
  | { ok: false; motivo: string };

/**
 * Único puente entre el CRM y el proceso principal. El main valida remitente
 * y argumentos de cada llamada — nada de lo expuesto acá confía en el
 * renderer. `reportarAreaWhatsApp` es fire-and-forget (`ipcRenderer.send`):
 * el CRM la llama en cada resize del contenedor y no espera respuesta.
 */
export interface CrmEscritorio {
  abrirChat(telefono: string, texto: string): Promise<ResultadoAbrirChat>;
  reportarAreaWhatsApp(area: AreaWhatsapp | null): void;
  mostrarWhatsApp(opciones?: OpcionesMostrarWhatsapp): Promise<ResultadoMostrarWhatsapp>;
  obtenerVistaWhatsApp(): Promise<VistaWhatsappConfig>;
  configurarVistaWhatsApp(cambios: {
    recorteIzquierdo?: number;
    completo?: boolean;
  }): Promise<ResultadoConfigurarVistaWhatsapp>;
  /** El recorte efectivo cambió sin que el CRM lo pidiera (resize, maximizar). Devuelve cómo desuscribirse. */
  alCambiarVistaWhatsApp(cb: (estado: VistaWhatsappConfig) => void): () => void;
}

const CANAL_VISTA_CAMBIO = "crm:vista-whatsapp-cambio";

const puente: CrmEscritorio = {
  abrirChat: (telefono: unknown, texto: unknown): Promise<ResultadoAbrirChat> =>
    ipcRenderer.invoke("crm:abrir-chat", telefono, texto),
  reportarAreaWhatsApp: (area: AreaWhatsapp | null): void => {
    ipcRenderer.send("crm:reportar-area-whatsapp", area);
  },
  mostrarWhatsApp: (opciones?: OpcionesMostrarWhatsapp): Promise<ResultadoMostrarWhatsapp> =>
    ipcRenderer.invoke("crm:mostrar-whatsapp", opciones),
  obtenerVistaWhatsApp: (): Promise<VistaWhatsappConfig> =>
    ipcRenderer.invoke("crm:obtener-vista-whatsapp"),
  configurarVistaWhatsApp: (cambios: unknown): Promise<ResultadoConfigurarVistaWhatsapp> =>
    ipcRenderer.invoke("crm:configurar-vista-whatsapp", cambios),
  alCambiarVistaWhatsApp: (cb: (estado: VistaWhatsappConfig) => void): (() => void) => {
    if (typeof cb !== "function") return () => undefined;
    const oyente = (_evento: IpcRendererEvent, estado: VistaWhatsappConfig): void => cb(estado);
    ipcRenderer.on(CANAL_VISTA_CAMBIO, oyente);
    return () => {
      ipcRenderer.removeListener(CANAL_VISTA_CAMBIO, oyente);
    };
  },
};

contextBridge.exposeInMainWorld("crmEscritorio", puente);
