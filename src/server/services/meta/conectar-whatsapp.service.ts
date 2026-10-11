import { ValidationError } from "@/lib/errors";
import { NoopLogger, type Logger } from "@/lib/observability/logger";
import { cifrarToken, type LlaveroTokens } from "@/lib/meta/token-cifrado";
import type { WhatsAppNumerosRepository } from "@/server/repositories/whatsapp-numeros.repo";
import type { GraphApiOnboarding } from "@/server/services/meta/graph-api-onboarding";
import type { ModoNumero } from "@/types/whatsapp-numeros";

/**
 * Los `event` de éxito del registro insertado que este botón acepta
 * (embedded-signup/implementation, leída 2026-10-11). Coexistencia es
 * `FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING`; `FINISH` es un número nuevo de
 * Cloud API.
 */
export const EVENTOS_DE_EXITO = ["FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING", "FINISH"] as const;
export type EventoDeExito = (typeof EVENTOS_DE_EXITO)[number];

export interface ConectarWhatsAppInput {
  /** El código del popup. Vive 30 s: se canjea primero. */
  code: string;
  wabaId: string;
  /** El evento de coexistencia trae sólo `waba_id`; `FINISH` trae también este. */
  phoneNumberId: string | null;
  evento: EventoDeExito;
}

export interface NumeroConectado {
  phoneNumberId: string;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  modo: ModoNumero;
}

export interface ConectarWhatsAppDeps {
  graph: Pick<GraphApiOnboarding, "canjearCodigo" | "numerosDeWaba" | "suscribirApp">;
  /** Con el client authed del admin: el alta va por el RPC que exige admin. */
  numeros: Pick<WhatsAppNumerosRepository, "conectar">;
  llavero: () => LlaveroTokens;
  /** Arranca la sincronización (Inngest). Sin el token: lo lee el backend. */
  emitirConectado: (e: { phoneNumberId: string; conectadoAt: string }) => Promise<void>;
  logger?: Logger;
}

export interface ConectarWhatsAppService {
  conectar(input: ConectarWhatsAppInput): Promise<NumeroConectado>;
}

/**
 * El alta de un número desde el botón "Conectar WhatsApp". Todo del lado del
 * servidor: el código del popup se canjea con el secreto de la app y el token
 * del negocio no vuelve nunca al navegador.
 *
 * Orden pensado para no dejar nada a medias:
 *   1. La clave de cifrado se resuelve ANTES de canjear: el código vive 30 s y
 *      una configuración incompleta no tiene que gastarlo.
 *   2. Canjear → validar que el número es de esa WABA con el token recién
 *      obtenido → suscribir la app a la WABA (sin esto no llegan webhooks).
 *   3. Recién ahí se guarda (cifrado) y se avisa a Inngest. Si algo de 2 falla
 *      no hay fila: el admin repite el flujo de cero.
 *
 * En coexistencia NO se registra el número (`/register`): ya está registrado
 * en la app (doc de Meta). Para `FINISH` (número nuevo) el registro con PIN no
 * está implementado: queda en modo `cloud` y la pantalla lo avisa.
 */
export class DefaultConectarWhatsAppService implements ConectarWhatsAppService {
  private readonly logger: Logger;

  constructor(private readonly deps: ConectarWhatsAppDeps) {
    this.logger = deps.logger ?? new NoopLogger();
  }

  async conectar(input: ConectarWhatsAppInput): Promise<NumeroConectado> {
    const llavero = this.deps.llavero();

    const token = await this.deps.graph.canjearCodigo(input.code);

    const numeros = await this.deps.graph.numerosDeWaba(input.wabaId, token);
    const numero = input.phoneNumberId
      ? numeros.find((n) => n.id === input.phoneNumberId)
      : numeros.length === 1
        ? numeros[0]
        : undefined;
    if (!numero) {
      throw new ValidationError(
        input.phoneNumberId
          ? "El número elegido no pertenece a la cuenta de WhatsApp Business que se conectó."
          : numeros.length === 0
            ? "La cuenta de WhatsApp Business conectada no tiene números."
            : "La cuenta de WhatsApp Business tiene varios números: volvé a conectar eligiendo uno.",
      );
    }

    await this.deps.graph.suscribirApp(input.wabaId, token);

    const modo: ModoNumero =
      input.evento === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING" ? "coexistencia" : "cloud";
    const { conectado_at } = await this.deps.numeros.conectar({
      waba_id: input.wabaId,
      phone_number_id: numero.id,
      display_phone_number: numero.display_phone_number,
      verified_name: numero.verified_name,
      modo,
      token_cifrado: cifrarToken(token, numero.id, llavero),
    });

    await this.deps.emitirConectado({
      phoneNumberId: numero.id,
      conectadoAt: conectado_at.toISOString(),
    });
    this.logger.info("whatsapp.numero.conectado", { phone_number_id: numero.id, modo });

    return {
      phoneNumberId: numero.id,
      displayPhoneNumber: numero.display_phone_number,
      verifiedName: numero.verified_name,
      modo,
    };
  }
}
