import type { AudienciaCompilada } from "@/lib/difusion/audiencia";
import type { EstadoConversacional } from "@/lib/difusion/planificador";
import type { CurrentStage } from "@/types/domain";
import type { UUID } from "@/types/entities";

/**
 * Quién coincide con una audiencia, con lo que el planificador necesita de
 * cada uno (`src/lib/difusion/planificador.ts`, `CandidatoDifusion`).
 *
 * **Sin implementación en memoria, a propósito.** Resolver el árbol en
 * TypeScript sería un segundo motor de condiciones, y dos motores que se
 * prueban cada uno contra sí mismo se separan en silencio: es la lección del
 * Corte 1 del PRD. El que manda es el SQL (`difusion_resolver_audiencia`), y
 * su semántica se prueba contra Postgres —la réplica de la migración, con más
 * de 1.000 leads—. Los servicios se prueban con un doble de test que devuelve
 * candidatos fijos (`tests/helpers/difusion-fakes.ts`).
 */

export interface CandidatoResuelto {
  leadId: UUID;
  /** `leads.nombre`, o el de WhatsApp si el lead no tiene uno cargado. Vacío si no hay ninguno. */
  nombre: string;
  /** Tal como está en `leads.telefono`: el planificador lo normaliza. */
  telefono: string;
  /** `current_stage` de la sesión activa (`resultado is null`); `null` sin sesión abierta. */
  etapaActiva: CurrentStage | null;
  /** Último entrante por WhatsApp: abre la ventana de servicio de 24 h. */
  ultimoEntranteAt: Date | null;
  /** Salientes de la IA y del sistema en las 24 h anteriores a `ahora`. */
  salientesAutomaticos24h: number;
  /** El vehículo principal, "marca modelo año"; `null` si no hay. */
  vehiculo: string | null;
}

/**
 * Cuántos leads se resuelven como mucho en una pasada. Confirmado por el dueño
 * 2026-09-24. Protege la memoria del proceso (la audiencia entera se planifica
 * de una vez) con un margen amplio sobre el piloto del PRD (~5.000 leads/mes).
 * Una audiencia más grande se rechaza con un mensaje, no se trunca.
 */
export const MAX_AUDIENCIA = 50_000;

export interface DifusionAudienciaRepository {
  /**
   * Todos los leads que coinciden, pidiendo páginas a la base hasta que una
   * vuelve vacía. `ValidationError` si la audiencia no se puede resolver o si
   * pasa de `MAX_AUDIENCIA`.
   */
  resolver(audiencia: AudienciaCompilada, ahora: Date): Promise<CandidatoResuelto[]>;
  /**
   * Leads distintos a los que les salió una plantilla desde este CRM desde
   * `desde`. Meta no expone el uso del límite: esto es lo que se sabe acá.
   */
  usoCupoDesde(desde: Date): Promise<number>;
  /**
   * Lo mismo que `resolver` trae como `etapaActiva` y `ultimoEntranteAt`, para
   * unos leads puntuales: lo que el motor vuelve a mirar justo antes de mandar
   * (§8.6). Sólo cuenta entrantes por WhatsApp desde `entranteDesde`: la regla
   * de conversación activa no mira más atrás, y así la consulta trae pocas
   * filas. Un lead sin sesión abierta ni entrante reciente no aparece.
   */
  estadoConversacional(
    leadIds: readonly UUID[],
    entranteDesde: Date,
  ): Promise<Map<UUID, EstadoConversacional>>;
}
