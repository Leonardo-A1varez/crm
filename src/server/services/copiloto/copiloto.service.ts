import { estaAbierto } from "@/lib/agente/horario";
import { LARGO_MAXIMO_BORRADOR } from "@/lib/copiloto/limites";
import { decidirModo, equipoAbiertoAhora } from "@/lib/copiloto/modo";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { nombreDeRegla } from "@/lib/ui/regla";
import type { BorradoresIaRepository } from "@/server/repositories/borradores-ia.repo";
import type { ConversationsRepository } from "@/server/repositories/conversations.repo";
import type { MessagesRepository } from "@/server/repositories/messages.repo";
import type { RulesRepository } from "@/server/repositories/rules.repo";
import type { AgentConfigProvider } from "@/server/services/agente/config-provider";
import type {
  BorradorIa,
  BorradorVista,
  EstadoCopiloto,
  ModoOverride,
  ViaUsoBorrador,
} from "@/types/copiloto";
import type { UUID } from "@/types/entities";

/**
 * Pide volver a redactar un borrador. Es una función inyectada y no una llamada
 * a Inngest porque `server/services/**` no puede importar `src/inngest/**`
 * (boundaries); la arma `server/bootstrap/copiloto-bootstrap.ts`.
 */
export type SolicitarRegeneracionFn = (input: {
  borradorId: UUID;
  conversacionId: UUID;
  solicitadoPor: UUID | null;
}) => Promise<void>;

export interface CopilotoService {
  estado(input: { conversacionId: UUID; ultimoEntranteId: UUID | null }): Promise<EstadoCopiloto>;
  cambiarModo(input: { conversacionId: UUID; override: ModoOverride | null }): Promise<void>;
  /**
   * Marca el borrador usado y, salvo "Al composer", guarda el texto final en el
   * hilo como saliente "enviado por WhatsApp Web, sin confirmar" (§3.4).
   */
  usar(input: {
    borradorId: UUID;
    via: ViaUsoBorrador;
    texto: string;
    /** Siempre hay usuario: la policy de uso exige `usado_por = auth.uid()`. */
    userId: UUID;
  }): Promise<{ yaUsado: boolean }>;
  solicitarRegeneracion(input: { borradorId: UUID; userId: UUID | null }): Promise<void>;
}

export interface CopilotoServiceDeps {
  borradores: Pick<BorradoresIaRepository, "findById" | "findActualByConversacion" | "marcarUsado">;
  conversations: Pick<ConversationsRepository, "findById" | "update" | "touch">;
  messages: Pick<MessagesRepository, "create">;
  rules: Pick<RulesRepository, "findById">;
  configProvider: AgentConfigProvider;
  solicitarRegeneracion: SolicitarRegeneracionFn;
  /** Inyectable para fijar la hora en los tests. */
  now?: () => Date;
}

export class DefaultCopilotoService implements CopilotoService {
  constructor(private readonly deps: CopilotoServiceDeps) {}

  private ahora(): Date {
    return this.deps.now ? this.deps.now() : new Date();
  }

  async estado(input: {
    conversacionId: UUID;
    ultimoEntranteId: UUID | null;
  }): Promise<EstadoCopiloto> {
    const conv = await this.deps.conversations.findById(input.conversacionId);
    if (!conv) {
      throw new NotFoundError(
        `conversación no encontrada: ${input.conversacionId}`,
        "conversacion",
        input.conversacionId,
      );
    }
    const [config, actual] = await Promise.all([
      this.deps.configProvider.get(),
      this.deps.borradores.findActualByConversacion(conv.id),
    ]);

    const ahora = this.ahora();
    // El copiloto es de WhatsApp: en otros canales el modo no mira override ni equipo.
    const esWa = conv.canal === "wa";
    const modoEfectivo = decidirModo({
      override: esWa ? conv.modo_respuesta_override : null,
      equipoAbierto: esWa && equipoAbiertoAhora(config, ahora),
      agenteAbierto: estaAbierto(config.horario, config.horario_timezone, ahora),
    });

    // Un borrador `usado` se queda atenuado solo mientras siga siendo la
    // respuesta al último mensaje del cliente: si llegó otro, ya es historia.
    const visible =
      actual !== null &&
      (actual.estado !== "usado" || actual.mensaje_origen_id === input.ultimoEntranteId);

    return {
      conversacionId: conv.id,
      override: conv.modo_respuesta_override,
      modoEfectivo,
      borrador: visible ? await this.vista(actual) : null,
    };
  }

  async cambiarModo(input: { conversacionId: UUID; override: ModoOverride | null }): Promise<void> {
    await this.deps.conversations.update(input.conversacionId, {
      modo_respuesta_override: input.override,
    });
  }

  async usar(input: {
    borradorId: UUID;
    via: ViaUsoBorrador;
    texto: string;
    /** Siempre hay usuario: la policy de uso exige `usado_por = auth.uid()`. */
    userId: UUID;
  }): Promise<{ yaUsado: boolean }> {
    const borrador = await this.requerirBorrador(input.borradorId);
    if (borrador.estado === "usado") return { yaUsado: true };
    if (borrador.estado !== "listo") {
      throw new ConflictError(
        `el borrador ${borrador.id} no está listo (${borrador.estado})`,
        "borrador_no_disponible",
      );
    }

    const texto = input.texto.trim();
    if (texto.length === 0 || texto.length > LARGO_MAXIMO_BORRADOR) {
      throw new ValidationError(
        `el texto del borrador tiene que tener entre 1 y ${LARGO_MAXIMO_BORRADOR} caracteres`,
        "borrador_texto_invalido",
      );
    }

    if (input.via !== "al_composer") {
      // Primero el saliente y después la marca: si el proceso muere entre los
      // dos, el reintento no duplica el mensaje (misma `idempotency_key`) y
      // termina de marcar. Al revés, un borrador usado podría quedar sin su
      // saliente en el hilo.
      try {
        await this.deps.messages.create({
          conversacion_id: borrador.conversacion_id,
          lead_session_id: borrador.lead_session_id,
          direction: "out",
          sender: "humano",
          sender_user_id: input.userId,
          tipo: "text",
          contenido: texto,
          media_url: null,
          meta_message_id: null,
          idempotency_key: `copiloto:${borrador.id}`,
          metadata: { origen: "whatsapp_web_sin_confirmar", borrador_id: borrador.id },
        });
        await this.deps.conversations.touch(borrador.conversacion_id);
      } catch (e) {
        // Solo el saliente duplicado es un reintento tolerable; una FK rota u
        // otro conflicto es un error real y no se disfraza de "ya usado".
        if (!(e instanceof ConflictError && e.conflictType === "duplicate_idempotency_key")) {
          throw e;
        }
      }
    }

    const resultado = await this.deps.borradores.marcarUsado(borrador.id, {
      via: input.via,
      usuarioId: input.userId,
    });
    // `no_disponible` acá es una carrera: otro lo usó o lo descartó entre la
    // lectura y la marca. Es el mismo resultado benigno que `ya_usado`.
    return { yaUsado: resultado !== "marcado" };
  }

  async solicitarRegeneracion(input: { borradorId: UUID; userId: UUID | null }): Promise<void> {
    const borrador = await this.requerirBorrador(input.borradorId);
    if (borrador.estado !== "listo" && borrador.estado !== "error") {
      throw new ConflictError(
        `el borrador ${borrador.id} no se puede regenerar (${borrador.estado})`,
        "borrador_no_disponible",
      );
    }
    await this.deps.solicitarRegeneracion({
      borradorId: borrador.id,
      conversacionId: borrador.conversacion_id,
      solicitadoPor: input.userId,
    });
  }

  private async requerirBorrador(id: UUID): Promise<BorradorIa> {
    const borrador = await this.deps.borradores.findById(id);
    if (!borrador) throw new NotFoundError(`borrador no encontrado: ${id}`, "borrador_ia", id);
    return borrador;
  }

  private async vista(b: BorradorIa): Promise<BorradorVista> {
    let reglaNombre: string | null = null;
    if (b.origen === "regla" && b.regla_id !== null) {
      const regla = await this.deps.rules.findById(b.regla_id);
      reglaNombre = regla ? nombreDeRegla(regla.respuesta_contenido) : null;
    }
    return {
      id: b.id,
      estado: b.estado,
      contenido: b.contenido,
      origen: b.origen,
      reglaNombre,
      errorCodigo: b.error_codigo,
      usadoVia: b.usado_via,
      creadoAt: b.created_at.toISOString(),
    };
  }
}
