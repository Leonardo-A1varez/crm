import { ValidationError } from "@/lib/errors";

/**
 * Las claves HMAC con las que se hashea el teléfono de una baja de difusión
 * (`difusion_supresiones.telefono_hash`).
 *
 * Formato de `DIFUSION_BAJAS_HMAC_CLAVES`: `version:claveBase64` separadas por
 * coma, p. ej. `1:<base64>,2:<base64>`. `DIFUSION_BAJAS_HMAC_VERSION_ACTIVA`
 * dice con cuál se escriben las altas; para buscar se usan todas. Rotación:
 * `docs/runbooks/secrets-rotation.md`.
 *
 * Este archivo sólo valida y decodifica. El hash se calcula en el servidor
 * (`server/repositories/difusion-supresiones.hash.ts`) y la clave nunca viaja
 * a la base. Ningún mensaje de error de acá incluye material de una clave: el
 * error termina en el log del boot.
 */

/** 256 bits: el tamaño del bloque de salida de SHA-256. Menos no suma seguridad y sí la resta. */
export const LARGO_MINIMO_CLAVE_BYTES = 32;

export interface ClavesBajas {
  /** La versión con la que se escriben las altas. */
  activa: number;
  /** Todas las versiones vigentes: con todas se busca. */
  claves: ReadonlyMap<number, Buffer>;
}

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const VERSION = /^[1-9][0-9]{0,4}$/;

export function parsearClavesBajas(claves: string, versionActiva: string | number): ClavesBajas {
  const mapa = new Map<number, Buffer>();
  const entradas = claves
    .split(",")
    .map((e) => e.trim())
    .filter((e) => e.length > 0);
  if (entradas.length === 0) {
    invalida("no hay ninguna clave");
  }

  for (const [i, entrada] of entradas.entries()) {
    const sep = entrada.indexOf(":");
    const version = sep === -1 ? "" : entrada.slice(0, sep).trim();
    const b64 = sep === -1 ? "" : entrada.slice(sep + 1).trim();
    // La posición y no el contenido: el contenido puede ser la clave.
    if (!VERSION.test(version)) invalida(`la entrada ${i + 1} no empieza con "version:"`);
    const n = Number(version);
    if (mapa.has(n)) invalida(`la versión ${n} está repetida`);
    if (!BASE64.test(b64) || b64.length % 4 !== 0) {
      invalida(`la clave de la versión ${n} no es base64`);
    }
    const bytes = Buffer.from(b64, "base64");
    if (bytes.length < LARGO_MINIMO_CLAVE_BYTES) {
      invalida(
        `la clave de la versión ${n} tiene ${bytes.length} bytes; el mínimo es ${LARGO_MINIMO_CLAVE_BYTES}`,
      );
    }
    mapa.set(n, bytes);
  }

  const activa = Number(versionActiva);
  if (!Number.isInteger(activa) || !mapa.has(activa)) {
    invalida("la versión activa no está entre las claves");
  }
  return { activa, claves: mapa };
}

function invalida(detalle: string): never {
  throw new ValidationError(`claves HMAC de bajas de difusión inválidas: ${detalle}`);
}
