import { View } from "electron";
import type { BaseWindow, WebContents } from "electron";

import {
  guardarCalibracion,
  hayCalibracionExacta,
  recorteEfectivo,
  redondearAncho,
} from "./calibracion-recorte";
import type { Calibracion } from "./calibracion-recorte";
import { escribirPreferencias, leerPreferencias } from "./preferencias-vista";
import { crearVistaWhatsapp, URL_WHATSAPP } from "./vista-whatsapp";
import type {
  Bitacora,
  AreaWhatsapp,
  CambiosVistaWhatsapp,
  OpcionesMostrarWhatsapp,
} from "./seguridad";
import type { ModoUa, ResultadoCarga, VistaWhatsapp } from "./vista-whatsapp";

const PREFIJO_SECCION = "/inbox/";

/**
 * La sección es una conversación abierta del Inbox: `/inbox/<algo>`. `/inbox`
 * solo (sin chat) no cuenta. Que el chat sea de WhatsApp y el usuario haya
 * elegido "WhatsApp Web" lo decide la página: reporta el área o `null`.
 */
export function enSeccionWhatsapp(pathname: string): boolean {
  return pathname.startsWith(PREFIJO_SECCION) && pathname.length > PREFIJO_SECCION.length;
}

/** `null` si la URL no se puede parsear (se trata como "fuera de la sección"). */
export function pathnameDe(url: string): string | null {
  try {
    return new URL(url).pathname;
  } catch {
    return null;
  }
}

export type ResultadoMostrar = { ok: true } | { ok: false; motivo: string };
export type ResultadoAbrirChat =
  | { ok: true; ms: number; mostrada: boolean }
  | { ok: false; motivo: string };

export interface ConfigVistaWhatsapp {
  /** Recorte efectivo para el ancho de área actual (interpolado si no hay calibración exacta). */
  recorteIzquierdo: number;
  completo: boolean;
  /** Ancho del área actual en DIP redondeado a 10; `null` si todavía no hay área. */
  anchoArea: number | null;
  /** Hay una calibración guardada exactamente para ese ancho. */
  calibrado: boolean;
}
export type ResultadoConfigurarVista =
  | ({ ok: true } & ConfigVistaWhatsapp)
  | { ok: false; motivo: string };

export interface EstadoCoordinador {
  creada: boolean;
  visible: boolean;
  webContentsId: number | null;
  /** Bounds del contenedor = el área reportada (en DIP, ya con el zoom). */
  bounds: AreaWhatsapp | null;
  /** Bounds de la vista de WhatsApp relativos al contenedor (x = -recorte). */
  boundsVista: AreaWhatsapp | null;
}

export interface OpcionesCoordinador {
  ventana: BaseWindow;
  crmWebContents: WebContents;
  particion: string;
  modoUa: ModoUa;
  bitacora?: Bitacora;
  /** JSON con las calibraciones del recorte; `null` = no persistir (solo memoria). */
  archivoPreferencias: string | null;
  /** Espera antes de escribir el archivo tras el último cambio. Default 300 ms. */
  debounceEscrituraMs?: number;
  /**
   * Se llama cuando el estado de la vista cambia por algo que NO fue un
   * `configurarVista` (resize, área nueva, migración): el CRM lo muestra en
   * vivo. Lo pedido por `configurarVista` ya vuelve en su respuesta y no se
   * notifica (así un evento viejo no pisa el slider mientras se arrastra).
   */
  alCambiarVista?: (estado: ConfigVistaWhatsapp) => void;
}

/**
 * Dueño de la vista de WhatsApp: la crea la primera vez que hace falta (al
 * navegar el CRM a un chat del Inbox, o al pedir mostrarla/abrir un chat), y desde
 * ahí solo la muestra/oculta y reposiciona — nunca la destruye ni la recarga
 * sola. Perder la vista sería perder la sesión de `persist:whatsapp`.
 */
export class CoordinadorWhatsapp {
  private wa: VistaWhatsapp | null = null;
  /**
   * Contenedor con los bounds del área reportada; la vista de WhatsApp es su
   * hija, desplazada `-recorte` en x. Lo que queda fuera del contenedor (la
   * franja izquierda con la barra de íconos y la lista de chats) no se pinta
   * ni recibe clics — verificado en el autocheck (ver README).
   */
  private contenedor: View | null = null;
  private area: AreaWhatsapp | null = null;
  private enSeccion = false;
  private visibleActual = false;
  private calibraciones: Calibracion[] = [];
  /** Recorte del formato viejo, hasta que haya un área para convertirlo en calibración. */
  private recortePorDefecto: number | null = null;
  private completo = false;
  private enConfigurar = false;
  private ultimoNotificado: string | null = null;
  private temporizadorEscritura: NodeJS.Timeout | null = null;
  private escrituraPendiente = false;

  constructor(private readonly opciones: OpcionesCoordinador) {
    if (opciones.archivoPreferencias !== null) {
      const prefs = leerPreferencias(opciones.archivoPreferencias);
      this.calibraciones = prefs.calibraciones;
      this.recortePorDefecto = prefs.recortePorDefecto;
    }
    this.ultimoNotificado = JSON.stringify(this.obtenerConfigVista());
  }

  /** Ancho del área actual en DIP (ya con el zoom), redondeado a 10. */
  private anchoAreaActual(): number | null {
    if (this.area === null) return null;
    const zoom = this.opciones.crmWebContents.getZoomFactor();
    return redondearAncho(Math.round(this.area.width * zoom));
  }

  private recorteActual(): number {
    return recorteEfectivo(this.calibraciones, this.anchoAreaActual(), this.recortePorDefecto ?? 0);
  }

  /**
   * Formato viejo (un solo valor): al haber por primera vez un área, ese valor
   * pasa a ser la calibración de ese ancho.
   */
  private migrarFormatoViejo(): void {
    const ancho = this.anchoAreaActual();
    if (ancho === null || this.recortePorDefecto === null) return;
    if (this.calibraciones.length === 0) {
      this.calibraciones = guardarCalibracion([], {
        anchoArea: ancho,
        recorte: this.recortePorDefecto,
      });
    }
    this.recortePorDefecto = null;
    this.programarEscritura();
  }

  private asegurarVista(): VistaWhatsapp {
    if (this.wa === null) {
      const wa = crearVistaWhatsapp({
        particion: this.opciones.particion,
        modoUa: this.opciones.modoUa,
        bitacora: this.opciones.bitacora,
      });
      const contenedor = new View();
      contenedor.addChildView(wa.vista);
      contenedor.setVisible(false);
      wa.vista.setVisible(false);
      this.opciones.ventana.contentView.addChildView(contenedor);
      this.contenedor = contenedor;
      this.wa = wa;
      void wa.cargar(URL_WHATSAPP);
    }
    return this.wa;
  }

  /**
   * Navegación del CRM (`did-navigate` / `did-navigate-in-page` del frame
   * principal). Entrar a la sección crea la vista si todavía no existe — el
   * orden respecto a `reportarArea` no importa, `actualizar` mira ambos.
   */
  reportarNavegacion(pathname: string | null): void {
    this.enSeccion = pathname !== null && enSeccionWhatsapp(pathname);
    if (this.enSeccion) this.asegurarVista();
    this.actualizar();
  }

  /** `null` = la página se desmontó (dejó de mostrar WhatsApp Web sin cambiar de ruta, p. ej. por error). */
  reportarArea(area: AreaWhatsapp | null): void {
    this.area = area;
    this.actualizar();
  }

  private actualizar(): void {
    // Sin vista todavía (nadie abrió un chat del Inbox) no hay bounds que aplicar,
    // pero el área y las calibraciones siguen valiendo para el estado.
    this.migrarFormatoViejo();
    const wa = this.wa;
    const contenedor = this.contenedor;
    if (wa !== null && contenedor !== null) {
      const area = this.area;
      const visible = this.enSeccion && area !== null;
      if (visible && area !== null) {
        const zoom = this.opciones.crmWebContents.getZoomFactor();
        const ancho = Math.round(area.width * zoom);
        const alto = Math.round(area.height * zoom);
        // El recorte ya viene en DIP: no se multiplica por el zoom del CRM.
        const recorte = this.completo ? 0 : this.recorteActual();
        contenedor.setBounds({
          x: Math.round(area.x * zoom),
          y: Math.round(area.y * zoom),
          width: ancho,
          height: alto,
        });
        wa.vista.setBounds({ x: -recorte, y: 0, width: ancho + recorte, height: alto });
      }
      contenedor.setVisible(visible);
      wa.vista.setVisible(visible);
      this.visibleActual = visible;
    }
    this.notificarSiCambio();
  }

  private notificarSiCambio(): void {
    const estado = this.obtenerConfigVista();
    const firma = JSON.stringify(estado);
    if (firma === this.ultimoNotificado) return;
    this.ultimoNotificado = firma;
    if (!this.enConfigurar) this.opciones.alCambiarVista?.(estado);
  }

  /** La ventana cambió de tamaño: reaplica el último área conocida (en DIP recalculados). */
  recalcular(): void {
    this.actualizar();
  }

  obtenerConfigVista(): ConfigVistaWhatsapp {
    const anchoArea = this.anchoAreaActual();
    return {
      recorteIzquierdo: this.recorteActual(),
      completo: this.completo,
      anchoArea,
      calibrado: hayCalibracionExacta(this.calibraciones, anchoArea),
    };
  }

  /**
   * `cambios` ya viene validado. Un `recorteIzquierdo` se guarda como la
   * calibración del ancho de área actual; sin área reportada se rechaza
   * (`sin_area`) y no cambia nada. Los bounds se aplican al instante (el
   * slider del CRM manda muchos cambios seguidos); solo la escritura del
   * archivo se agrupa con debounce.
   */
  configurarVista(cambios: CambiosVistaWhatsapp): ResultadoConfigurarVista {
    const ancho = this.anchoAreaActual();
    if (cambios.recorteIzquierdo !== undefined && ancho === null) {
      return { ok: false, motivo: "sin_area" };
    }
    if (cambios.completo !== undefined) this.completo = cambios.completo;
    if (cambios.recorteIzquierdo !== undefined && ancho !== null) {
      const previa = this.calibraciones.find((c) => c.anchoArea === ancho);
      if (previa === undefined || previa.recorte !== cambios.recorteIzquierdo) {
        this.calibraciones = guardarCalibracion(this.calibraciones, {
          anchoArea: ancho,
          recorte: cambios.recorteIzquierdo,
        });
        this.recortePorDefecto = null;
        this.programarEscritura();
      }
    }
    this.enConfigurar = true;
    try {
      this.actualizar();
    } finally {
      this.enConfigurar = false;
    }
    return { ok: true, ...this.obtenerConfigVista() };
  }

  private programarEscritura(): void {
    if (this.opciones.archivoPreferencias === null) return;
    this.escrituraPendiente = true;
    if (this.temporizadorEscritura !== null) clearTimeout(this.temporizadorEscritura);
    this.temporizadorEscritura = setTimeout(
      () => this.volcarPreferencias(),
      this.opciones.debounceEscrituraMs ?? 300,
    );
  }

  /** Escribe ya lo pendiente (cierre de la app, tests). */
  volcarPreferencias(): void {
    if (this.temporizadorEscritura !== null) clearTimeout(this.temporizadorEscritura);
    this.temporizadorEscritura = null;
    if (!this.escrituraPendiente || this.opciones.archivoPreferencias === null) return;
    this.escrituraPendiente = false;
    escribirPreferencias(this.opciones.archivoPreferencias, {
      calibraciones: this.calibraciones,
      recortePorDefecto: this.recortePorDefecto,
    });
  }

  async mostrar(opciones: OpcionesMostrarWhatsapp): Promise<ResultadoMostrar> {
    const wa = this.asegurarVista();
    if (opciones.recargar) {
      const resultado = await wa.cargar(URL_WHATSAPP);
      if (!resultado.ok) return resultado;
    }
    this.actualizar();
    return { ok: true };
  }

  async abrirChat(telefono: string, texto: string): Promise<ResultadoAbrirChat> {
    const wa = this.asegurarVista();
    const resultado: ResultadoCarga = await wa.abrirChat(telefono, texto);
    this.actualizar();
    if (!resultado.ok) return resultado;
    return { ...resultado, mostrada: this.visibleActual };
  }

  /** Cierra el webContents al cerrar la ventana (no-op si nunca se creó la vista). */
  cerrar(): void {
    this.volcarPreferencias();
    this.wa?.vista.webContents.close();
  }

  /** Solo para tests/autocheck: estado observable sin exponer el webContents. */
  estado(): EstadoCoordinador {
    return {
      creada: this.wa !== null,
      visible: this.visibleActual,
      webContentsId: this.wa?.vista.webContents.id ?? null,
      bounds: this.contenedor?.getBounds() ?? null,
      boundsVista: this.wa?.vista.getBounds() ?? null,
    };
  }
}
