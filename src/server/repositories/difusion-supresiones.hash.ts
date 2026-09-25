import { createHmac, randomBytes } from "node:crypto";
import { parsearClavesBajas, type ClavesBajas } from "@/lib/difusion/claves-bajas";
import { normalizarTelefonoWhatsApp } from "@/lib/difusion/telefono";
import { env } from "@/lib/env";
import { IllegalStateError, ValidationError } from "@/lib/errors";

/** Lo que se guarda de una baja en lugar del teléfono. */
export interface HashDeBaja {
  /** HMAC-SHA256 del número E.164 sin `+`, en hex. */
  telefono_hash: string;
  clave_version: number;
}

/**
 * El teléfono de una baja, hasheado con HMAC-SHA256 y una clave del servidor.
 *
 * No un SHA-256 plano: los números de un país son pocos millones y se
 * recorren por fuerza bruta en segundos. Con HMAC, quien lea la tabla sin la
 * clave no recupera el número; quien tenga la clave sí puede confirmar un
 * número que ya sabe, y eso es lo que la lista de bajas necesita.
 *
 * Se calcula acá, en el servidor, y nunca en SQL ni en el cliente: la clave no
 * llega a la base.
 */
export class HasherTelefonoBajas {
  constructor(private readonly claves: ClavesBajas) {}

  get versionActiva(): number {
    return this.claves.activa;
  }

  /** El hash para escribir una baja: con la versión activa. `ValidationError` si no es un número de WhatsApp. */
  alta(crudo: string): HashDeBaja {
    const telefono = normalizarTelefonoWhatsApp(crudo);
    if (telefono === null) {
      throw new ValidationError("una baja es de un número de WhatsApp en formato internacional");
    }
    return this.con(this.claves.activa, telefono);
  }

  /**
   * Los hashes para buscar una baja: uno por cada versión vigente, así una
   * baja escrita antes de rotar sigue bloqueando. `[]` si no es un número de
   * WhatsApp —no puede tener baja—.
   */
  busqueda(crudo: string): HashDeBaja[] {
    const telefono = normalizarTelefonoWhatsApp(crudo);
    if (telefono === null) return [];
    return [...this.claves.claves.keys()].map((v) => this.con(v, telefono));
  }

  private con(version: number, telefono: string): HashDeBaja {
    const clave = this.claves.claves.get(version);
    // Inalcanzable: `activa` y las versiones de `busqueda` salen del mismo mapa.
    if (clave === undefined) {
      throw new IllegalStateError(`no hay clave para la versión ${version}`, "clave_bajas_ausente");
    }
    return {
      telefono_hash: createHmac("sha256", clave).update(telefono, "utf8").digest("hex"),
      clave_version: version,
    };
  }
}

/** Lo que hace falta para armar el hasher; en producción, las dos vars de `env`. */
export interface ConfigClavesBajas {
  DIFUSION_BAJAS_HMAC_CLAVES?: string | undefined;
  DIFUSION_BAJAS_HMAC_VERSION_ACTIVA?: number | undefined;
}

/**
 * El hasher de una configuración. Sin claves lanza `IllegalStateError`, en voz
 * alta y sin fallback: una lista de bajas que no se puede consultar no puede
 * responder "no hay bajas". Quien busca o registra una baja falla, y todo
 * envío que dependa de esa consulta no sale.
 */
export function hasherBajasDesde(config: ConfigClavesBajas): HasherTelefonoBajas {
  const claves = config.DIFUSION_BAJAS_HMAC_CLAVES;
  const activa = config.DIFUSION_BAJAS_HMAC_VERSION_ACTIVA;
  if (claves === undefined || activa === undefined) {
    throw new IllegalStateError(
      "las bajas de difusión no se pueden registrar ni consultar: faltan DIFUSION_BAJAS_HMAC_CLAVES y DIFUSION_BAJAS_HMAC_VERSION_ACTIVA (docs/runbooks/secrets-rotation.md)",
      "claves_bajas_no_configuradas",
    );
  }
  return new HasherTelefonoBajas(parsearClavesBajas(claves, activa));
}

let desdeEnv: HasherTelefonoBajas | null = null;

/**
 * El hasher con las claves de `DIFUSION_BAJAS_HMAC_*`. Se arma en el primer
 * uso y no al boot: que falten las claves apaga las bajas, no el panel.
 */
export function hasherBajasDesdeEnv(): HasherTelefonoBajas {
  desdeEnv ??= hasherBajasDesde(env);
  return desdeEnv;
}

/**
 * Una clave al azar que vive lo que vive el proceso. Para el repo in-memory:
 * sus filas tampoco sobreviven al proceso, y así no hace falta ninguna clave
 * escrita en el código.
 */
export function hasherBajasEfimero(): HasherTelefonoBajas {
  return new HasherTelefonoBajas({ activa: 1, claves: new Map([[1, randomBytes(32)]]) });
}
