/**
 * Contrato que expone la app de escritorio (Electron) en `window.crmEscritorio`.
 * No existe en el navegador normal — todo consumo debe chequear presencia antes
 * de usarlo. Lo implementa el proceso de escritorio; acá solo se declara el tipo.
 */

/** `abrirChat`: `mostrada` es `false` si el CRM todavía no reportó dónde ponerla. */
export type ResultadoAbrirChat =
  | { ok: true; ms: number; mostrada: boolean }
  | { ok: false; motivo: string };

export interface VistaWhatsApp {
  /**
   * Píxeles CSS que la app recorta del borde izquierdo de WhatsApp Web (0–1200)
   * para el ancho de ventana actual: la app guarda una calibración por ancho y
   * interpola entre ellas.
   */
  recorteIzquierdo: number;
  /** `true`: WhatsApp Web entero, sin recorte. */
  completo: boolean;
  /** Ancho del área en px CSS (redondeado a 10); `null` si todavía no hay área. Ausente en apps viejas. */
  anchoArea?: number | null;
  /** Hay una calibración guardada exactamente para ese ancho. Ausente en apps viejas. */
  calibrado?: boolean;
}

export type ResultadoConfigurarVista =
  | ({ ok: true } & VistaWhatsApp)
  | { ok: false; motivo: string };

export interface CrmEscritorio {
  abrirChat(telefono: string, texto: string): Promise<ResultadoAbrirChat>;
  reportarAreaWhatsApp(area: { x: number; y: number; width: number; height: number } | null): void;
  mostrarWhatsApp(opciones?: {
    recargar?: boolean;
  }): Promise<{ ok: true } | { ok: false; motivo: string }>;
  obtenerVistaWhatsApp(): Promise<VistaWhatsApp>;
  configurarVistaWhatsApp(cambios: {
    recorteIzquierdo?: number;
    completo?: boolean;
  }): Promise<ResultadoConfigurarVista>;
  /**
   * La app avisa cuando el recorte efectivo cambia sin que el CRM lo pidiera
   * (la ventana cambió de tamaño). Devuelve la función para desuscribirse.
   * Opcional: las apps viejas no lo tienen.
   */
  alCambiarVistaWhatsApp?(cb: (estado: VistaWhatsApp) => void): () => void;
}

declare global {
  interface Window {
    crmEscritorio?: CrmEscritorio;
  }
}
