import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { app, dialog } from "electron";
import type { Session } from "electron";

import { ArchivadorMedia, MAX_BYTES_ARCHIVO, parsearListado } from "./archivador-media";
import type { EstadoArchivador, PuertosArchivador, RespuestaListado } from "./archivador-media";
import { carpetaBase } from "./archivo-media-ruta";
import type { EntornoRuta } from "./archivo-media-ruta";

/**
 * Adaptador de Electron del archivo de media (ver `archivador-media.ts`): HTTP con
 * la sesión del CRM (la partición `persist:crm`), disco real y un diálogo para el
 * aviso. Corre sólo en el proceso principal; no expone nada al renderer.
 */

const PRIMER_CICLO_MS = 20_000;
const ENTRE_CICLOS_MS = 60_000;

const ENTORNO: EntornoRuta = {
  homedir: os.homedir(),
  env: process.env,
  realpath: (ruta) => {
    try {
      return fs.realpathSync(ruta);
    } catch {
      return null;
    }
  },
};

function archivoDeEstado(): string {
  return path.join(app.getPath("userData"), "archivo-media.json");
}

function leerEstado(archivo: string): EstadoArchivador {
  try {
    const o = JSON.parse(fs.readFileSync(archivo, "utf8")) as Record<string, unknown>;
    const cursor = typeof o["cursor"] === "string" ? o["cursor"] : null;
    const hechos = Array.isArray(o["hechos"])
      ? o["hechos"].filter((x): x is string => typeof x === "string")
      : [];
    return { cursor, hechos };
  } catch {
    // Ausente o corrupto: se empieza de cero. Es seguro: lo que ya está en disco
    // se reconoce por el nombre y no se pisa.
    return { cursor: null, hechos: [] };
  }
}

/** Escritura atómica (temp + rename): un corte de luz no deja el estado a medias. */
function guardarEstado(archivo: string, estado: EstadoArchivador): void {
  const temporal = `${archivo}.tmp`;
  fs.writeFileSync(temporal, JSON.stringify(estado), "utf8");
  fs.renameSync(temporal, archivo);
}

export interface OpcionesArchivoMedia {
  /** `https://crm…`: sólo el origen del CRM. */
  origin: string;
  sesion: Session;
  log: (mensaje: string, datos?: Record<string, unknown>) => void;
}

/** Arranca el archivado. Devuelve cómo detenerlo. */
export function iniciarArchivoMedia(o: OpcionesArchivoMedia): () => void {
  const archivoEstado = archivoDeEstado();
  const base = carpetaBase(ENTORNO);

  const listar = async (cursor: string | null, limite: number): Promise<RespuestaListado> => {
    const url = new URL("/api/escritorio/archivos", o.origin);
    url.searchParams.set("limite", String(limite));
    if (cursor !== null) url.searchParams.set("despues", cursor);
    try {
      const res = await o.sesion.fetch(url.href, {
        credentials: "include",
        redirect: "manual",
        headers: { Accept: "application/json" },
      });
      // 401: sin sesión. Una redirección (al login) es lo mismo.
      if (res.status === 401 || res.status === 403 || res.type === "opaqueredirect") {
        return { tipo: "sin_sesion" };
      }
      if (!res.ok) return { tipo: "error" };
      return parsearListado(await res.json());
    } catch {
      return { tipo: "error" };
    }
  };

  const descargar = async (mensajeId: string, destino: string, maxBytes: number): Promise<void> => {
    const url = new URL(`/api/media/${encodeURIComponent(mensajeId)}`, o.origin);
    url.searchParams.set("descargar", "1");
    const res = await o.sesion.fetch(url.href, { credentials: "include" });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    // Tras el redirect a la URL firmada del Storage: sólo https (o el mismo origen
    // en desarrollo local).
    const final = new URL(res.url);
    if (final.protocol !== "https:" && final.origin !== o.origin) {
      throw new Error("destino de descarga inesperado");
    }
    const declarado = Number(res.headers.get("content-length"));
    if (Number.isFinite(declarado) && declarado > maxBytes) throw new Error("archivo demasiado grande");

    let total = 0;
    const origen = Readable.fromWeb(res.body as import("node:stream/web").ReadableStream);
    origen.on("data", (trozo: Buffer) => {
      total += trozo.length;
      if (total > maxBytes) origen.destroy(new Error("archivo demasiado grande"));
    });
    await pipeline(origen, fs.createWriteStream(destino, { flags: "wx" }));
  };

  const puertos: PuertosArchivador = {
    base,
    listar,
    descargar,
    fs: {
      crearCarpeta: (ruta) => void fs.mkdirSync(ruta, { recursive: true }),
      existe: (ruta) => fs.existsSync(ruta),
      renombrar: (a, b) => fs.renameSync(a, b),
      borrar: (ruta) => fs.rmSync(ruta, { force: true }),
    },
    estado: {
      leer: () => leerEstado(archivoEstado),
      guardar: (e) => guardarEstado(archivoEstado, e),
    },
    entorno: ENTORNO,
    avisar: (mensaje) => {
      void dialog.showMessageBox({
        type: "warning",
        title: "Archivos del CRM",
        message: "No se guardan los archivos en esta PC",
        detail: mensaje,
        buttons: ["Entendido"],
      });
    },
    log: o.log,
  };

  const archivador = new ArchivadorMedia(puertos);
  let temporizador: NodeJS.Timeout | null = null;
  let detenido = false;

  // Un ciclo a la vez: el siguiente se programa cuando termina el anterior.
  const programar = (ms: number): void => {
    if (detenido) return;
    temporizador = setTimeout(() => {
      void archivador
        .ciclo()
        .then((r) => {
          if (r.descargados > 0) o.log("archivos guardados", { cantidad: r.descargados });
        })
        .catch((error: unknown) => {
          o.log("el archivado falló", { error: error instanceof Error ? error.name : "desconocido" });
        })
        .finally(() => programar(ENTRE_CICLOS_MS));
    }, ms);
  };
  programar(PRIMER_CICLO_MS);
  o.log("archivo de media activo", { maxMb: Math.round(MAX_BYTES_ARCHIVO / 1024 / 1024) });

  return () => {
    detenido = true;
    if (temporizador) clearTimeout(temporizador);
  };
}
