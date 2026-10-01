import { shell } from "electron";
import type { IpcMainInvokeEvent, Session, WebContents } from "electron";

import { recorteValido } from "./preferencias-vista";

// Hosts a los que la vista de WhatsApp puede navegar en el frame principal.
// Medido con SPIKE_AUTOCHECK antes del login (autocheck-*.json, campos
// `redirecciones` y `navegacionesBloqueadas`): ni `/` ni `/send` redirigen a
// otro host. Después del login no se midió. Los subrecursos (en la medición:
// static.whatsapp.net) no pasan por will-navigate y no se listan acá.
export const HOSTS_WHATSAPP = new Set(["web.whatsapp.com"]);

export type PoliticaNavegacion = (url: string) => boolean;

export interface Bitacora {
  navegacionBloqueada?: (host: string) => void;
  /** Se dispara al empezar cada `cargar()` de la vista de WhatsApp (para tests/autocheck). */
  cargaIniciada?: () => void;
}

function parsear(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

export function hostDe(url: string): string {
  return parsear(url)?.host ?? "(url inválida)";
}

export const politicaWhatsapp: PoliticaNavegacion = (url) => {
  const u = parsear(url);
  return u !== null && u.protocol === "https:" && HOSTS_WHATSAPP.has(u.hostname);
};

export type OrigenCrm =
  | { tipo: "remoto"; origin: string; url: string }
  | { tipo: "spike"; url: string };

export function politicaCrm(origen: OrigenCrm): PoliticaNavegacion {
  return (url) => {
    const u = parsear(url);
    if (u === null) return false;
    if (origen.tipo === "spike") {
      // Solo la página de prueba exacta; cualquier otro file:// queda afuera.
      return u.protocol === "file:" && u.href.split("#")[0] === origen.url;
    }
    return u.origin === origen.origin;
  };
}

function abrirAfueraSiEsHttps(url: string): void {
  const u = parsear(url);
  if (u !== null && u.protocol === "https:") {
    void shell.openExternal(u.href);
  }
}

/**
 * Navegación del frame principal restringida a la política; ventanas nuevas
 * siempre denegadas (un link https se manda al navegador del sistema).
 */
export function endurecerContenido(
  wc: WebContents,
  permitido: PoliticaNavegacion,
  bitacora: Bitacora = {},
): void {
  const cortar = (details: {
    url: string;
    isMainFrame: boolean;
    preventDefault: () => void;
  }): void => {
    if (!details.isMainFrame || permitido(details.url)) return;
    details.preventDefault();
    bitacora.navegacionBloqueada?.(hostDe(details.url));
    abrirAfueraSiEsHttps(details.url);
  };
  wc.on("will-navigate", (details) => cortar(details));
  wc.on("will-redirect", (details) => cortar(details));
  wc.setWindowOpenHandler(({ url }) => {
    abrirAfueraSiEsHttps(url);
    return { action: "deny" };
  });
}

type Permiso = Parameters<NonNullable<Parameters<Session["setPermissionRequestHandler"]>[0]>>[1];

/** Todo lo que no esté en `permitidos` se niega, tanto el pedido como el chequeo. */
export function limitarPermisos(ses: Session, permitidos: ReadonlySet<Permiso>): void {
  ses.setPermissionRequestHandler((_wc, permiso, callback) => callback(permitidos.has(permiso)));
  ses.setPermissionCheckHandler((_wc, permiso) => permitidos.has(permiso));
}

/**
 * El IPC solo se acepta si viene del frame principal de la vista del CRM y ese
 * frame está en el origen permitido. Se valida `origin` (y la URL exacta en el
 * caso file://, cuyo origin es opaco) y no solo el webContents, porque un
 * iframe dentro del CRM comparte webContents con el frame principal.
 */
export function remitenteValido(
  event: IpcMainInvokeEvent,
  crm: WebContents,
  origen: OrigenCrm,
): boolean {
  const frame = event.senderFrame;
  if (frame === null || frame.isDestroyed()) return false;
  if (event.sender !== crm || frame.parent !== null) return false;
  if (origen.tipo === "spike") return frame.url.split("#")[0] === origen.url;
  return frame.origin === origen.origin;
}

const LARGO_MAXIMO_TEXTO = 4096;

export type Validado<T> = { ok: true; valor: T } | { ok: false; motivo: string };

/** E.164 sin el "+": 8 a 15 dígitos después de sacar "+", espacios y guiones. */
export function normalizarTelefono(entrada: unknown): Validado<string> {
  if (typeof entrada !== "string") return { ok: false, motivo: "telefono_no_es_texto" };
  const digitos = entrada.replace(/[+\s-]/g, "");
  if (!/^\d{8,15}$/.test(digitos)) return { ok: false, motivo: "telefono_invalido" };
  return { ok: true, valor: digitos };
}

export function validarTexto(entrada: unknown): Validado<string> {
  if (typeof entrada !== "string") return { ok: false, motivo: "texto_no_es_texto" };
  if (entrada.length > LARGO_MAXIMO_TEXTO) return { ok: false, motivo: "texto_muy_largo" };
  return { ok: true, valor: entrada };
}

/** Para logs: nunca el número completo (regla de PII del proyecto). */
export function ultimos4(telefono: string): string {
  return `…${telefono.slice(-4)}`;
}

export interface AreaWhatsapp {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LimiteArea {
  width: number;
  height: number;
}

/**
 * El área llega en CSS px del renderer (`getBoundingClientRect()`), o `null`
 * al desmontarse. Se valida: 4 números finitos no negativos, y que el
 * rectángulo quepa dentro del contenido de la ventana (mismas unidades CSS —
 * el caller ya dividió por el zoom antes de armar `limite`).
 */
export function validarAreaWhatsapp(
  entrada: unknown,
  limite: LimiteArea,
): Validado<AreaWhatsapp | null> {
  if (entrada === null) return { ok: true, valor: null };
  if (typeof entrada !== "object") return { ok: false, motivo: "area_no_es_objeto" };
  const o = entrada as Record<string, unknown>;
  const valores = [o.x, o.y, o.width, o.height];
  if (!valores.every((n) => typeof n === "number" && Number.isFinite(n))) {
    return { ok: false, motivo: "area_numeros_invalidos" };
  }
  const [x, y, width, height] = valores as [number, number, number, number];
  if (x < 0 || y < 0 || width < 0 || height < 0) return { ok: false, motivo: "area_negativa" };
  if (x + width > limite.width || y + height > limite.height) {
    return { ok: false, motivo: "area_fuera_de_ventana" };
  }
  return { ok: true, valor: { x, y, width, height } };
}

export interface OpcionesMostrarWhatsapp {
  recargar: boolean;
}

/** Único campo aceptado: `recargar` booleano opcional. Cualquier otra clave rechaza el mensaje. */
export function validarOpcionesMostrar(entrada: unknown): Validado<OpcionesMostrarWhatsapp> {
  if (entrada === undefined) return { ok: true, valor: { recargar: false } };
  if (typeof entrada !== "object" || entrada === null) {
    return { ok: false, motivo: "opciones_invalidas" };
  }
  const o = entrada as Record<string, unknown>;
  if (Object.keys(o).some((clave) => clave !== "recargar")) {
    return { ok: false, motivo: "opciones_invalidas" };
  }
  if (o.recargar !== undefined && typeof o.recargar !== "boolean") {
    return { ok: false, motivo: "recargar_invalido" };
  }
  return { ok: true, valor: { recargar: o.recargar === true } };
}

export interface CambiosVistaWhatsapp {
  recorteIzquierdo?: number;
  completo?: boolean;
}

/**
 * `configurarVistaWhatsApp`: solo `recorteIzquierdo` (entero 0–1200 DIP) y
 * `completo` (booleano). Cualquier otra clave, o un tipo/rango incorrecto,
 * rechaza el mensaje entero. `{}` es válido y no cambia nada.
 */
export function validarCambiosVista(entrada: unknown): Validado<CambiosVistaWhatsapp> {
  if (typeof entrada !== "object" || entrada === null || Array.isArray(entrada)) {
    return { ok: false, motivo: "cambios_invalidos" };
  }
  const o = entrada as Record<string, unknown>;
  if (Object.keys(o).some((c) => c !== "recorteIzquierdo" && c !== "completo")) {
    return { ok: false, motivo: "cambios_invalidos" };
  }
  const cambios: CambiosVistaWhatsapp = {};
  if (o.recorteIzquierdo !== undefined) {
    if (!recorteValido(o.recorteIzquierdo)) return { ok: false, motivo: "recorte_invalido" };
    cambios.recorteIzquierdo = o.recorteIzquierdo;
  }
  if (o.completo !== undefined) {
    if (typeof o.completo !== "boolean") return { ok: false, motivo: "completo_invalido" };
    cambios.completo = o.completo;
  }
  return { ok: true, valor: cambios };
}
