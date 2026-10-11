import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { IllegalStateError, ValidationError } from "@/lib/errors";

/**
 * Cifrado del token de negocio de cada número conectado
 * (`whatsapp_numeros_credenciales.token_cifrado`).
 *
 * AES-256-GCM en la app y no Vault en la base: la clave vive en el entorno
 * (`META_TOKENS_CLAVE`), separada de los datos, así que un dump o un backup de
 * la base no alcanza para mandar mensajes en nombre del negocio, y lo que se
 * prueba en un unit test es lo mismo que corre en producción. El número
 * (`phone_number_id`) va como dato asociado: el cifrado de un número no sirve
 * pegado en la fila de otro.
 *
 * Formato `v1.<kid>.<iv>.<tag>.<cifrado>` (base64url). `kid` son los primeros
 * 8 hex del SHA-256 de la clave: permite rotar (la nueva cifra, la anterior
 * todavía descifra) sin guardar ningún dato de la clave.
 */

const VERSION = "v1";
const LARGO_CLAVE = 32;
const LARGO_IV = 12;
const LARGO_TAG = 16;

export interface LlaveroTokens {
  /** La que cifra. */
  activa: { kid: string; clave: Buffer };
  /** Todas las que descifran, por kid (incluida la activa). */
  porKid: ReadonlyMap<string, Buffer>;
}

export function claveDesdeBase64(valor: string): Buffer {
  const clave = Buffer.from(valor.trim(), "base64");
  if (clave.length !== LARGO_CLAVE) {
    // Sin el valor en el mensaje: termina en logs.
    throw new IllegalStateError(
      `la clave de tokens debe decodificar a ${LARGO_CLAVE} bytes (openssl rand -base64 32)`,
      "meta_tokens_clave",
    );
  }
  return clave;
}

function kidDe(clave: Buffer): string {
  return createHash("sha256").update(clave).digest("hex").slice(0, 8);
}

/**
 * El llavero desde las variables. `META_TOKENS_CLAVE` es obligatoria donde se
 * usa (conectar un número o mandar por uno conectado), no al arrancar: que
 * falte no puede tumbar el panel entero.
 */
export function llaveroDesdeEnv(env: {
  META_TOKENS_CLAVE?: string;
  META_TOKENS_CLAVE_ANTERIOR?: string;
}): LlaveroTokens {
  if (!env.META_TOKENS_CLAVE) {
    throw new IllegalStateError(
      "falta META_TOKENS_CLAVE: sin ella no se puede guardar ni usar el token de un número conectado",
      "meta_tokens_clave",
    );
  }
  const activa = claveDesdeBase64(env.META_TOKENS_CLAVE);
  const porKid = new Map<string, Buffer>([[kidDe(activa), activa]]);
  if (env.META_TOKENS_CLAVE_ANTERIOR) {
    const anterior = claveDesdeBase64(env.META_TOKENS_CLAVE_ANTERIOR);
    porKid.set(kidDe(anterior), anterior);
  }
  return { activa: { kid: kidDe(activa), clave: activa }, porKid };
}

export function cifrarToken(token: string, phoneNumberId: string, llavero: LlaveroTokens): string {
  const iv = randomBytes(LARGO_IV);
  const cipher = createCipheriv("aes-256-gcm", llavero.activa.clave, iv, {
    authTagLength: LARGO_TAG,
  });
  cipher.setAAD(Buffer.from(phoneNumberId, "utf8"));
  const cifrado = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    llavero.activa.kid,
    iv.toString("base64url"),
    tag.toString("base64url"),
    cifrado.toString("base64url"),
  ].join(".");
}

export function descifrarToken(
  cifrado: string,
  phoneNumberId: string,
  llavero: LlaveroTokens,
): string {
  const partes = cifrado.split(".");
  if (partes.length !== 5 || partes[0] !== VERSION) {
    throw new ValidationError("token cifrado con formato desconocido");
  }
  const [, kid, ivB64, tagB64, ctB64] = partes as [string, string, string, string, string];
  const clave = llavero.porKid.get(kid);
  if (!clave) {
    throw new ValidationError(
      "el token se cifró con una clave que ya no está configurada (META_TOKENS_CLAVE / _ANTERIOR)",
    );
  }
  try {
    // Largo del tag fijo: sin esto Node acepta un tag recortado (4 bytes) y
    // verifica contra él, que es como se falsifica un cifrado GCM.
    const decipher = createDecipheriv("aes-256-gcm", clave, Buffer.from(ivB64, "base64url"), {
      authTagLength: LARGO_TAG,
    });
    decipher.setAAD(Buffer.from(phoneNumberId, "utf8"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(ctB64, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch (cause) {
    throw new ValidationError("el token cifrado no se pudo verificar", undefined, cause);
  }
}
