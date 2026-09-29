import fs from "node:fs";
import path from "node:path";

import {
  MAXIMO_CALIBRACIONES,
  RECORTE_MAXIMO,
  anchoAreaValido,
  recorteValido,
} from "./calibracion-recorte";
import type { Calibracion } from "./calibracion-recorte";

export { RECORTE_MAXIMO, recorteValido };
export const RECORTE_POR_DEFECTO = 0;

export interface PreferenciasVista {
  /** De la más vieja a la más nueva, sin anchos repetidos, máximo 20. */
  calibraciones: Calibracion[];
  /**
   * Recorte del formato viejo (un único valor) que todavía no se convirtió en
   * calibración porque no hubo un área reportada. `null` una vez migrado.
   */
  recortePorDefecto: number | null;
}

function preferenciasVacias(): PreferenciasVista {
  return { calibraciones: [], recortePorDefecto: null };
}

function calibracionValida(x: unknown): x is Calibracion {
  if (typeof x !== "object" || x === null) return false;
  const o = x as Record<string, unknown>;
  return anchoAreaValido(o.anchoArea) && recorteValido(o.recorte);
}

/**
 * Lectura tolerante: archivo ausente, ilegible, JSON roto o valores fuera de
 * rango → se descarta lo inválido. Nunca lanza (un archivo corrupto no debe
 * impedir arrancar). Formato viejo `{ recorteIzquierdo }` → `recortePorDefecto`.
 */
export function leerPreferencias(archivo: string): PreferenciasVista {
  try {
    const crudo: unknown = JSON.parse(fs.readFileSync(archivo, "utf8"));
    if (typeof crudo !== "object" || crudo === null) return preferenciasVacias();
    const o = crudo as Record<string, unknown>;
    const porAncho = new Map<number, Calibracion>();
    if (Array.isArray(o.calibraciones)) {
      for (const c of o.calibraciones as unknown[]) {
        if (!calibracionValida(c)) continue;
        // La última aparición del mismo ancho gana y pasa a ser la más nueva.
        porAncho.delete(c.anchoArea);
        porAncho.set(c.anchoArea, { anchoArea: c.anchoArea, recorte: c.recorte });
      }
    }
    const calibraciones = [...porAncho.values()].slice(-MAXIMO_CALIBRACIONES);
    const recortePorDefecto = recorteValido(o.recorteIzquierdo) ? o.recorteIzquierdo : null;
    return { calibraciones, recortePorDefecto };
  } catch {
    return preferenciasVacias();
  }
}

/** Escritura atómica: temporal en la misma carpeta + rename. Devuelve false si falló. */
export function escribirPreferencias(archivo: string, prefs: PreferenciasVista): boolean {
  const temporal = `${archivo}.${process.pid}.tmp`;
  const contenido: Record<string, unknown> = { version: 2, calibraciones: prefs.calibraciones };
  if (prefs.recortePorDefecto !== null) contenido.recorteIzquierdo = prefs.recortePorDefecto;
  try {
    fs.mkdirSync(path.dirname(archivo), { recursive: true });
    fs.writeFileSync(temporal, JSON.stringify(contenido), "utf8");
    fs.renameSync(temporal, archivo);
    return true;
  } catch {
    try {
      fs.unlinkSync(temporal);
    } catch {
      // no quedó temporal
    }
    return false;
  }
}
