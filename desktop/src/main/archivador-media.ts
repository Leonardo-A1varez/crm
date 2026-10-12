import nodePath from "node:path";

import { rutaDestino, verificarBaseSegura } from "./archivo-media-ruta";
import type { EntornoRuta } from "./archivo-media-ruta";

/**
 * Guarda en la PC una copia permanente de cada archivo del CRM (imagen, video,
 * audio, documento) — desktop/README.md, «Archivo de media».
 *
 * Cómo: el proceso principal consulta cada minuto `GET /api/escritorio/archivos`
 * con la sesión del CRM (la cookie de su partición; no hay token aparte) y baja
 * cada archivo nuevo por `/api/media/<mensajeId>`. **Sin puerta nueva en el
 * renderer**: nada de esto se expone en `window.crmEscritorio`, no hay IPC que
 * validar ni Node en la página. El motor no importa `electron` ni `fs`: recibe
 * todo por puertos y se prueba desde la raíz del repo.
 *
 * Qué garantiza:
 *  - Idempotente. Un cursor que sólo avanza y la lista de lo hecho en la página en
 *    curso: reiniciar la app o repetir un ciclo no baja dos veces el mismo archivo.
 *  - Nada a medias. Se baja a `<destino>.part` y se renombra al terminar.
 *  - Todo adentro de `<USERPROFILE>\CRM Genuino\Archivos`: los nombres (cliente,
 *    archivo) son de terceros y se sanean; la ruta final se verifica.
 *  - Nunca en OneDrive (`verificarBaseSegura`): avisa una vez y no baja nada.
 *  - Un archivo que falla no se saltea: corta el ciclo y se reintenta; recién
 *    después de 5 fallos se abandona y sigue con los demás.
 */
const path = nodePath.win32;

export const LIMITE_POR_PAGINA = 20;
/** Más grande que el tope de lo que guarda el CRM (50 MiB): sólo defiende de un servidor roto. */
export const MAX_BYTES_ARCHIVO = 60 * 1024 * 1024;
export const MAX_INTENTOS = 5;
const MAX_PAGINAS_POR_CICLO = 25;

export interface ItemArchivo {
  mensajeId: string;
  cliente: string;
  /** ISO del mensaje; la carpeta del día se arma con la zona horaria de esta PC. */
  fecha: string;
  archivo: string;
  mime: string;
  bytes: number | null;
}

export interface EstadoArchivador {
  /** Cursor del servidor: dónde empieza la página en curso. */
  cursor: string | null;
  /** Ids ya guardados de ESA página (se vacía al pasar a la siguiente). */
  hechos: string[];
}

export type RespuestaListado =
  | { tipo: "ok"; items: ItemArchivo[]; siguiente: string | null }
  | { tipo: "sin_sesion" }
  | { tipo: "error" };

export interface PuertosArchivador {
  /** Carpeta raíz ya resuelta (`carpetaBase`). */
  base: string;
  listar(cursor: string | null, limite: number): Promise<RespuestaListado>;
  /** Baja el archivo del mensaje a `destino`. Lanza si no pudo. */
  descargar(mensajeId: string, destino: string, maxBytes: number): Promise<void>;
  fs: {
    crearCarpeta(ruta: string): void;
    existe(ruta: string): boolean;
    renombrar(origen: string, destino: string): void;
    borrar(ruta: string): void;
  };
  estado: { leer(): EstadoArchivador; guardar(estado: EstadoArchivador): void };
  entorno: EntornoRuta;
  /** Mensaje para el usuario (el bloqueo por OneDrive). */
  avisar(mensaje: string): void;
  /** Sin nombres de cliente ni de archivo: son datos personales. */
  log(mensaje: string, datos?: Record<string, unknown>): void;
}

export interface ResultadoCiclo {
  estado: "al_dia" | "parcial" | "error" | "sin_sesion" | "bloqueado";
  descargados: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function itemValido(x: unknown): ItemArchivo | null {
  if (typeof x !== "object" || x === null) return null;
  const o = x as Record<string, unknown>;
  if (typeof o["mensajeId"] !== "string" || !UUID.test(o["mensajeId"])) return null;
  if (typeof o["cliente"] !== "string" || typeof o["archivo"] !== "string") return null;
  if (typeof o["mime"] !== "string") return null;
  if (typeof o["fecha"] !== "string" || Number.isNaN(new Date(o["fecha"]).getTime())) return null;
  const bytes = o["bytes"];
  if (bytes !== null && (typeof bytes !== "number" || !Number.isFinite(bytes))) return null;
  return {
    mensajeId: o["mensajeId"],
    cliente: o["cliente"],
    fecha: o["fecha"],
    archivo: o["archivo"],
    mime: o["mime"],
    bytes,
  };
}

/** La respuesta del servidor no se cree a ciegas: lo que no tiene la forma se descarta. */
export function parsearListado(json: unknown): RespuestaListado {
  if (typeof json !== "object" || json === null) return { tipo: "error" };
  const o = json as Record<string, unknown>;
  if (!Array.isArray(o["items"])) return { tipo: "error" };
  const items = o["items"].map(itemValido).filter((i): i is ItemArchivo => i !== null);
  const siguiente = typeof o["siguiente"] === "string" ? o["siguiente"] : null;
  return { tipo: "ok", items, siguiente };
}

export class ArchivadorMedia {
  private avisoOneDriveDado = false;
  private readonly intentos = new Map<string, number>();

  constructor(private readonly p: PuertosArchivador) {}

  async ciclo(): Promise<ResultadoCiclo> {
    const segura = verificarBaseSegura(this.p.base, this.p.entorno);
    if (!segura.ok) {
      if (!this.avisoOneDriveDado) {
        this.avisoOneDriveDado = true;
        this.p.avisar(segura.motivo);
        this.p.log("archivo de media bloqueado: carpeta dentro de OneDrive");
      }
      return { estado: "bloqueado", descargados: 0 };
    }

    let estado = this.p.estado.leer();
    let descargados = 0;

    for (let pagina = 0; pagina < MAX_PAGINAS_POR_CICLO; pagina++) {
      const r = await this.p.listar(estado.cursor, LIMITE_POR_PAGINA);
      if (r.tipo === "sin_sesion") return { estado: "sin_sesion", descargados };
      if (r.tipo === "error") return { estado: "error", descargados };
      if (r.items.length === 0) return { estado: "al_dia", descargados };

      for (const it of r.items) {
        if (estado.hechos.includes(it.mensajeId)) continue;
        const resultado = await this.guardar(it);
        if (resultado === "fallo") return { estado: "error", descargados };
        if (resultado === "guardado") descargados += 1;
        estado = { cursor: estado.cursor, hechos: [...estado.hechos, it.mensajeId] };
        // Después de cada archivo: si la app se cierra acá, no se repite.
        this.p.estado.guardar(estado);
      }

      estado = { cursor: r.siguiente, hechos: [] };
      this.p.estado.guardar(estado);
    }
    return { estado: "parcial", descargados };
  }

  private async guardar(it: ItemArchivo): Promise<"guardado" | "abandonado" | "fallo"> {
    let destino: string;
    try {
      destino = rutaDestino(this.p.base, it.cliente, it.fecha, it.archivo);
    } catch {
      this.p.log("archivo omitido: ruta de destino inválida", { id: it.mensajeId });
      return "abandonado";
    }
    // Mismo nombre, mismo cliente y mismo día: se distingue con el id, no se pisa.
    if (this.p.fs.existe(destino)) destino = conIdAntesDeLaExtension(destino, it.mensajeId);

    const parcial = `${destino}.part`;
    try {
      this.p.fs.crearCarpeta(path.dirname(destino));
      await this.p.descargar(it.mensajeId, parcial, MAX_BYTES_ARCHIVO);
      this.p.fs.renombrar(parcial, destino);
      this.intentos.delete(it.mensajeId);
      return "guardado";
    } catch (error) {
      try {
        this.p.fs.borrar(parcial);
      } catch {
        // Nada que limpiar.
      }
      const n = (this.intentos.get(it.mensajeId) ?? 0) + 1;
      this.intentos.set(it.mensajeId, n);
      this.p.log("no se pudo guardar un archivo", {
        id: it.mensajeId,
        intento: n,
        error: error instanceof Error ? error.name : "desconocido",
      });
      if (n >= MAX_INTENTOS) {
        this.intentos.delete(it.mensajeId);
        this.p.log("archivo abandonado tras varios intentos", { id: it.mensajeId });
        return "abandonado";
      }
      return "fallo";
    }
  }
}

function conIdAntesDeLaExtension(ruta: string, mensajeId: string): string {
  const ext = path.extname(ruta);
  const sinExt = ext ? ruta.slice(0, -ext.length) : ruta;
  return `${sinExt} [${mensajeId.slice(0, 8)}]${ext}`;
}
