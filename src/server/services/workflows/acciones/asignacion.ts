import { ValidationError } from "@/lib/errors";
import { profundidadDeContexto } from "@/lib/workflows/cadena";
import { configDeAccion } from "@/lib/workflows/config-nodos";
import type { SessionLock } from "@/server/lock/session-lock";
import type { LeadSessionRepository } from "@/server/repositories/lead-session.repo";
import type { AsignacionService } from "@/server/services/asignacion/asignacion.service";
import type { LeadSession, UUID } from "@/types/entities";
import type { Nodo } from "@/types/workflows";
import type { AccionHandler, EntornoAccion } from "./registro";

/** Lo que viaja cuando una acción le cambia el vendedor a una sesión. */
export interface AvisoVendedorAsignado {
  leadId: UUID;
  sesion: LeadSession;
  vendedorId: UUID;
  /** Para la idempotencia del aviso cuando la sesión no trae `asignado_at`. */
  runId: UUID;
  orden: number;
  /**
   * La profundidad de la cadena del disparo que sale: la de la corrida que
   * asignó más uno (`lib/workflows/cadena.ts`). Es lo que corta dos flujos
   * que se reasignan entre sí.
   */
  profundidad: number;
}

/**
 * Por dónde sale el disparo "vendedor asignado". En producción es un
 * `workflow/disparo.recibido` a Inngest (`inngest/bootstrap.ts`); en "Probar"
 * no sale nada: una prueba no arranca otros flujos.
 */
export interface AvisosDeAsignacion {
  vendedorAsignado(aviso: AvisoVendedorAsignado): Promise<void>;
}

export interface AccionesAsignacionDeps {
  asignacion: Pick<AsignacionService, "asignar" | "asignarPorRoundRobin">;
  sessions: Pick<LeadSessionRepository, "findActiveByLeadId">;
  avisos: AvisosDeAsignacion;
  /**
   * Serializa los repartos. `asignarPorRoundRobin` lee el historial, elige y
   * escribe sin transacción: dos repartos a la vez leen lo mismo y eligen a la
   * misma persona. En producción es un candado de Postgres con vencimiento
   * (`server/lock/lease-lock.ts`), que vale entre instancias.
   */
  candadoReparto: SessionLock;
}

/**
 * Una sola clave para todos los repartos, de cualquier flujo: dos flujos con
 * vendedores en común chocan igual que dos corridas del mismo. La sección
 * crítica son tres consultas, así que serializarlos todos no se nota.
 */
export const CLAVE_CANDADO_REPARTO = "workflow:reparto-round-robin";

/**
 * La sesión ACTIVA del lead, no la de la corrida: la corrida puede haber
 * dormido días y su sesión haber cerrado. Sin sesión activa no hay a quién
 * asignar, y reintentar no la crea.
 */
async function sesionActiva(
  deps: AccionesAsignacionDeps,
  nodo: Nodo,
  entorno: EntornoAccion,
  accion: string,
): Promise<LeadSession> {
  const sesion = await deps.sessions.findActiveByLeadId(entorno.leadId);
  if (!sesion) {
    throw new ValidationError(
      `el nodo "${nodo.id}" (${accion}) necesita una sesión activa y el lead no tiene una`,
      "sin_sesion_activa",
    );
  }
  return sesion;
}

/**
 * "Asignar vendedor": pone a la persona elegida en la sesión activa.
 *
 * Avisa sólo si hubo cambio. Asignar a quien ya la tenía no es una asignación
 * nueva, y avisar despertaría a los flujos "Vendedor asignado" por algo que no
 * pasó. Límite conocido: si el aviso falla después de escribir, el reintento
 * encuentra la sesión ya asignada y no vuelve a avisar.
 */
function crearAsignarVendedor(deps: AccionesAsignacionDeps): AccionHandler {
  return async (nodo, entorno) => {
    const { vendedorId } = configDeAccion("asignar_vendedor", nodo);
    const sesion = await sesionActiva(deps, nodo, entorno, "asignar_vendedor");
    const r = await deps.asignacion.asignar(sesion.id, vendedorId);
    if (r.cambio) {
      await deps.avisos.vendedorAsignado({
        leadId: entorno.leadId,
        sesion: r.session,
        vendedorId,
        runId: entorno.runId,
        orden: entorno.orden,
        profundidad: profundidadDeContexto(entorno.contexto) + 1,
      });
    }
    return {
      puerto: "salida",
      salida: { lead_session_id: sesion.id, vendedor_id: vendedorId, cambio: r.cambio },
    };
  };
}

/**
 * "Round Robin": reparte la sesión activa entre los candidatos del nodo.
 *
 * **Nadie disponible es un resultado, no un error**: sigue por la única salida
 * del nodo, con `asignado: false` y el motivo en el historial del paso. La
 * sesión queda sin vendedor. Cortar el flujo dejaría al lead sin los pasos que
 * siguen —el mensaje de bienvenida, la etiqueta— por un problema de guardia que
 * no es suyo.
 */
function crearRepartirRoundRobin(deps: AccionesAsignacionDeps): AccionHandler {
  return async (nodo, entorno) => {
    const { candidatos, topeSesionesAbiertasPorVendedor } = configDeAccion(
      "repartir_round_robin",
      nodo,
    );
    const sesion = await sesionActiva(deps, nodo, entorno, "repartir_round_robin");
    const r = await deps.candadoReparto.withLock(CLAVE_CANDADO_REPARTO, () =>
      deps.asignacion.asignarPorRoundRobin(sesion.id, {
        candidatos,
        tope: topeSesionesAbiertasPorVendedor,
      }),
    );

    if (r.tipo === "sin_vendedor") {
      return {
        puerto: "salida",
        salida: { asignado: false, motivo: r.motivo, lead_session_id: sesion.id },
      };
    }
    if (r.tipo === "asignada") {
      await deps.avisos.vendedorAsignado({
        leadId: entorno.leadId,
        sesion: r.session,
        vendedorId: r.vendedorId,
        runId: entorno.runId,
        orden: entorno.orden,
        profundidad: profundidadDeContexto(entorno.contexto) + 1,
      });
    }
    return {
      puerto: "salida",
      salida: {
        asignado: true,
        vendedor_id: r.vendedorId,
        lead_session_id: sesion.id,
        ...(r.tipo === "ya_asignada" ? { ya_estaba: true } : {}),
      },
    };
  };
}

export type AccionesDeAsignacion = Record<
  "asignar_vendedor" | "repartir_round_robin",
  AccionHandler
>;

export function crearAccionesDeAsignacion(deps: AccionesAsignacionDeps): AccionesDeAsignacion {
  return {
    asignar_vendedor: crearAsignarVendedor(deps),
    repartir_round_robin: crearRepartirRoundRobin(deps),
  };
}
