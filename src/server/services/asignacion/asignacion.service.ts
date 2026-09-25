import { IllegalStateError, NotFoundError } from "@/lib/errors";
import { elegirVendedorRoundRobin } from "@/lib/round-robin";
import type { MotivoSinVendedor } from "@/lib/round-robin";
import type { LeadSessionRepository } from "@/server/repositories/lead-session.repo";
import type { UsuariosService } from "@/server/services/usuarios/usuarios.service";
import type { LeadSession, UUID } from "@/types/entities";

export interface ResultadoAsignacion {
  session: LeadSession;
  /** `false` = ya estaba así: no hubo escritura ni hay nada que avisar. */
  cambio: boolean;
}

export interface ConfigRoundRobin {
  /** Los vendedores del nodo, en el orden en que los cargó el admin (desempata). */
  candidatos: readonly UUID[];
  /** Máximo de sesiones abiertas a la vez por persona; `null` = sin tope. */
  tope: number | null;
}

export type ResultadoRoundRobin =
  | { tipo: "asignada"; session: LeadSession; vendedorId: UUID }
  | { tipo: "ya_asignada"; session: LeadSession; vendedorId: UUID }
  | { tipo: "sin_vendedor"; session: LeadSession; motivo: MotivoSinVendedor };

/**
 * Quién atiende cada intento de venta.
 *
 * La asignación vive en la sesión y no en el lead (decisión del dueño): si el
 * lead vuelve meses después es otro intento de venta, y el reparto se decide de
 * nuevo. Los "no" de negocio —sesión cerrada, vendedor inactivo— viven acá; el
 * repo solo persiste.
 */
export interface AsignacionService {
  /**
   * Asigna la sesión a `vendedorId`, o la deja sin asignar con `null`.
   *
   * - La asignación que ya tiene es un no-op (`cambio: false`): un retry no
   *   escribe ni cuenta como recepción nueva. Vale aunque la sesión esté
   *   cerrada, porque no la cambia.
   * - Una sesión cerrada no se reasigna (`IllegalStateError`
   *   `sesion_cerrada`): cambiar quién atendió una venta terminada reescribiría
   *   la historia.
   * - El vendedor tiene que existir (`NotFoundError`) y estar activo
   *   (`IllegalStateError` `vendedor_inactivo`): un usuario desactivado no
   *   entra al panel y el lead quedaría huérfano sin que nadie lo note. El rol
   *   no se mira: un admin que vende también recibe.
   */
  asignar(sessionId: UUID, vendedorId: UUID | null): Promise<ResultadoAsignacion>;

  /**
   * Reparte la sesión con `elegirVendedorRoundRobin` sobre el historial real.
   *
   * - Una sesión que ya tiene vendedor no se reparte de nuevo (`ya_asignada`).
   *   Si el paso se reintenta después de haber escrito, el historial ya incluye
   *   esta asignación y otra vuelta elegiría a otra persona.
   * - Sin nadie elegible devuelve `sin_vendedor` con el motivo y **no** lanza:
   *   que estén todos en su tope es un resultado de negocio, no una falla.
   *   Quien llama decide si eso corta el flujo.
   * - Disponible = existe en `usuarios` y está activo.
   *
   * Sin lock: dos repartos simultáneos pueden leer el mismo historial y elegir
   * a la misma persona. Si eso importa, quien lo llame desde Inngest lo tiene
   * que serializar (`concurrency` con una sola key).
   */
  asignarPorRoundRobin(sessionId: UUID, config: ConfigRoundRobin): Promise<ResultadoRoundRobin>;
}

export interface AsignacionDeps {
  sessions: Pick<LeadSessionRepository, "findById" | "asignarVendedor" | "resumenAsignaciones">;
  /** De dónde sale el equipo, tanto para validar una asignación como para repartir. */
  usuarios: Pick<UsuariosService, "listar">;
}

export class DefaultAsignacionService implements AsignacionService {
  constructor(private readonly deps: AsignacionDeps) {}

  async asignar(sessionId: UUID, vendedorId: UUID | null): Promise<ResultadoAsignacion> {
    const session = await this.sesion(sessionId);
    if ((session.vendedor_asignado_id ?? null) === vendedorId) return { session, cambio: false };
    exigirAbierta(session);
    if (vendedorId !== null) await this.exigirActivo(vendedorId);
    const asignada = await this.deps.sessions.asignarVendedor(sessionId, vendedorId);
    return { session: asignada, cambio: true };
  }

  async asignarPorRoundRobin(
    sessionId: UUID,
    config: ConfigRoundRobin,
  ): Promise<ResultadoRoundRobin> {
    const session = await this.sesion(sessionId);
    const actual = session.vendedor_asignado_id ?? null;
    if (actual !== null) return { tipo: "ya_asignada", session, vendedorId: actual };
    exigirAbierta(session);

    // El equipo entero en una consulta: son decenas de filas, y un `findById`
    // por candidato sería un N+1 en cada lead que entra.
    const [equipo, historial] = await Promise.all([
      this.deps.usuarios.listar(),
      this.deps.sessions.resumenAsignaciones([...config.candidatos]),
    ]);
    const activos = new Set(equipo.filter((u) => u.activo).map((u) => u.id));
    const eleccion = elegirVendedorRoundRobin(
      config.candidatos.map((id) => ({ id, disponible: activos.has(id) })),
      historial,
      { tope: config.tope },
    );
    if (eleccion.tipo === "sin_vendedor") {
      return { tipo: "sin_vendedor", session, motivo: eleccion.motivo };
    }
    const asignada = await this.deps.sessions.asignarVendedor(sessionId, eleccion.vendedorId);
    return { tipo: "asignada", session: asignada, vendedorId: eleccion.vendedorId };
  }

  private async sesion(id: UUID): Promise<LeadSession> {
    const session = await this.deps.sessions.findById(id);
    if (!session) {
      throw new NotFoundError(`lead_session no encontrada: ${id}`, "lead_session", id);
    }
    return session;
  }

  private async exigirActivo(vendedorId: UUID): Promise<void> {
    // El equipo entero y no una búsqueda por id: son decenas de filas, y así la
    // asignación a mano y el reparto leen a la gente del mismo lugar.
    const vendedor = (await this.deps.usuarios.listar()).find((u) => u.id === vendedorId);
    if (!vendedor) {
      throw new NotFoundError(`usuario no encontrado: ${vendedorId}`, "usuario", vendedorId);
    }
    if (!vendedor.activo) {
      throw new IllegalStateError(
        `el usuario ${vendedorId} está inactivo: no puede recibir sesiones`,
        "vendedor_inactivo",
      );
    }
  }
}

function exigirAbierta(session: LeadSession): void {
  if (session.resultado !== null) {
    throw new IllegalStateError(
      `la sesión ${session.id} está cerrada: no se reasigna`,
      "sesion_cerrada",
    );
  }
}
