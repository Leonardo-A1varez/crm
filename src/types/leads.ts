import type { Canal, CurrentStage, MotivoPerdida, Resultado, TagSource } from "./domain";
import type { Lead, LeadSession, UUID } from "./entities";

/**
 * Ventanas del filtro de última actividad, medidas sobre `leads.updated_at`.
 *
 * Son tres y no un rango libre porque las tres son las preguntas que se hace un
 * vendedor: qué toqué hoy, qué se movió esta semana y qué quedó abandonado.
 * `mas_30` es la única que mira hacia atrás y por eso es una cota superior.
 */
export const VENTANA_ACTIVIDAD = ["hoy", "semana", "mas_30"] as const;
export type VentanaActividad = (typeof VENTANA_ACTIVIDAD)[number];

/**
 * Formas derivadas para las vistas `/leads` y `/leads/[id]` (fase 10). Viven en
 * types/ porque UI (components/) y service (server-services/) las comparten —
 * boundaries no permite components→server-services.
 */
export interface LeadListItem {
  leadId: UUID;
  nombre: string;
  telefono: string;
  canalOrigen: Canal;
  vehiculo: string; // "marca modelo anio" trim; "" si todo vacío
  sesionActiva: boolean;
  /**
   * Etapa de la sesión abierta. `null` sin sesión activa: la etapa de una
   * sesión cerrada quedó congelada donde terminó y mostrarla como vigente
   * miente sobre el estado del lead.
   */
  currentStage: CurrentStage | null;
  /**
   * Cómo terminó la última sesión cerrada del lead. Es lo que se muestra en la
   * columna de etapa cuando no hay sesión abierta: sin esto, un lead perdido y
   * uno que nunca abrió sesión se leen igual (una raya).
   */
  resultado: Resultado | null;
  /** Solo con `resultado === "perdido"`. `null` en las filas viejas sin motivo. */
  motivoPerdida: MotivoPerdida | null;
  /** Alta del lead. Es lo que cuenta el "nuevos esta semana" del encabezado. */
  createdAt: Date;
  updatedAt: Date;
}

export interface LeadsPage {
  items: LeadListItem[];
  pendingPairs: number; // candidates pending totales (banner admin)
  /**
   * Marcas y modelos que aparecen en el resultado, para poblar el selector de
   * vehículo. Salen de las filas ya traídas y no de un `distinct` aparte: una
   * consulta menos, y las opciones ofrecidas son las que dan resultado.
   * `modelos` se acota a la marca elegida cuando hay una.
   */
  marcas: string[];
  modelos: string[];
  /**
   * Catálogo completo de etiquetas, para poblar el chip de filtro. Sale del
   * catálogo y no de los leads del resultado: si saliera del resultado, filtrar
   * por una etiqueta dejaría el selector con esa sola y no habría con qué
   * cambiarla — el mismo problema que resuelve `marcas` mirando el pre-filtro.
   */
  etiquetas: EtiquetaOpcion[];
}

export interface EtiquetaOpcion {
  id: UUID;
  nombre: string;
  color: string;
}

export interface LeadTagView {
  id: UUID;
  nombre: string;
  color: string;
  source: TagSource;
}

export interface DuplicadoPendiente {
  candidateId: UUID;
  otherLead: Lead;
  reasons: string[];
  score: number;
  createdAt: Date;
}

export interface LeadDetail {
  lead: Lead;
  tags: LeadTagView[];
  sesiones: LeadSession[]; // started_at DESC (orden del repo)
  sesionActiva: LeadSession | null;
  duplicados: DuplicadoPendiente[]; // pending que involucran al lead
}
