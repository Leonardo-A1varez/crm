import { IllegalStateError } from "@/lib/errors";
import { descifrarToken, type LlaveroTokens } from "@/lib/meta/token-cifrado";
import type { WhatsAppNumerosRepository } from "@/server/repositories/whatsapp-numeros.repo";

/** El número y el token con que sale un mensaje por un número conectado. */
export interface CredencialesWhatsApp {
  phoneNumberId: string;
  accessToken: string;
}

/**
 * Por qué número sale un WhatsApp. `null` = ese número no está conectado desde
 * Ajustes y el envío usa el de env (`META_WHATSAPP_PHONE_NUMBER_ID`).
 */
export interface ResolverCredencialesWhatsApp {
  para(phoneNumberId: string): Promise<CredencialesWhatsApp | null>;
}

export interface ResolverCredencialesDeps {
  repo: Pick<WhatsAppNumerosRepository, "tokenCifrado">;
  /**
   * Perezoso: sin `META_TOKENS_CLAVE` sólo falla el envío por un número
   * conectado, no el arranque ni los envíos por el número de env.
   */
  llavero: () => LlaveroTokens;
  /** Cuánto se recuerda un token ya descifrado. Default 60 s. */
  ttlMs?: number;
  ahora?: () => number;
}

/**
 * Lee el token cifrado de la base (service role) y lo descifra. Con caché por
 * instancia: un turno manda «escribiendo…» y la respuesta, y un lote de
 * difusión cientos; no hace falta una consulta por mensaje. El token vive sólo
 * en memoria del proceso y nunca se loguea.
 */
export class DefaultResolverCredencialesWhatsApp implements ResolverCredencialesWhatsApp {
  private readonly cache = new Map<
    string,
    { expira: number; valor: CredencialesWhatsApp | null }
  >();
  private readonly ttlMs: number;
  private readonly ahora: () => number;

  constructor(private readonly deps: ResolverCredencialesDeps) {
    this.ttlMs = deps.ttlMs ?? 60_000;
    this.ahora = deps.ahora ?? Date.now;
  }

  async para(phoneNumberId: string): Promise<CredencialesWhatsApp | null> {
    const t = this.ahora();
    const guardado = this.cache.get(phoneNumberId);
    if (guardado && t < guardado.expira) return guardado.valor;

    const cifrado = await this.deps.repo.tokenCifrado(phoneNumberId);
    let valor: CredencialesWhatsApp | null = null;
    if (cifrado !== null) {
      try {
        valor = {
          phoneNumberId,
          accessToken: descifrarToken(cifrado, phoneNumberId, this.deps.llavero()),
        };
      } catch (cause) {
        // Hay un número conectado y no se puede usar su token: caer al de env
        // mandaría la respuesta desde OTRO WhatsApp. Se falla en voz alta.
        throw new IllegalStateError(
          "no se pudo descifrar el token del número conectado (revisar META_TOKENS_CLAVE)",
          "meta_tokens_clave",
          cause,
        );
      }
    }
    this.cache.set(phoneNumberId, { expira: t + this.ttlMs, valor });
    return valor;
  }
}
