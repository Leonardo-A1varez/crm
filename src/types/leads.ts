import type { Canal, CurrentStage, MotivoPerdida, Resultado, TagSource } from "./domain";
import type { Lead, LeadSession, UUID } from "./entities";

/**
 * Ventanas del filtro de última actividad, medidas sobre `leads.updated_at`.
 *
 * Son tres y no un rango libre porque las tres son las preguntas que se hace un
 * vendedor: qué toqué hoy, qué se movió esta semana y qué quedó abandonado.
 * `mas_30` es la única que mira hacia atrás y por eso es una cota superior.
 *
 * Sin consumidor desde que el filtro salió de la barra: `cotasActividad` y
 * `LeadsListInput.actividad` lo siguen entendiendo, pero ninguna pantalla lo
 * produce. Queda como el resto de las listas de dominio —es lo que respalda el
 * tipo— y porque el criterio no dejó de ser cierto, no porque alguien lo use.
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

/**
 * Un vehículo que aparece en los datos, tal como se lee en la mini-pantalla.
 *
 * Marca, modelo y año viajan juntos y separados a la vez: juntos en `texto`,
 * que es lo que se busca y se lee, y separados porque cada uno es un param de
 * la URL y una columna distinta de `leads`.
 */
export interface VehiculoOpcion {
  /** Identifica la opción en la lista. No viaja a la URL. */
  clave: string;
  /** "Toyota Corolla 2018". Sin el año cuando el lead no lo tiene cargado. */
  texto: string;
  marca: string;
  modelo: string;
  /** `0` solo representa la opción visual "sin año"; la columna es nullable. */
  anio: number;
}

export interface LeadsPage {
  items: LeadListItem[];
  pendingPairs: number; // candidates pending totales (banner admin)
  /**
   * Vehículos distintos que aparecen en el resultado, para poblar la
   * mini-pantalla. Salen de las filas ya traídas y no de un `distinct` aparte:
   * una consulta menos, y las opciones ofrecidas son las que dan resultado. Se
   * arman ANTES de filtrar por vehículo — si salieran de después, elegir uno
   * dejaría la lista con ese solo y no habría con qué cambiarlo.
   */
  vehiculos: VehiculoOpcion[];
  /**
   * Motivos de pérdida que aparecen en el último cierre de alguno de los leads
   * del resultado, en el orden del enum. La mini-pantalla ofrece estos y no
   * `MOTIVO_PERDIDA` entero: los motivos crecen y se reducen con el negocio, y
   * ofrecer uno que no filtra nada es ofrecer una lista vacía.
   */
  motivos: MotivoPerdida[];
  /**
   * Catálogo completo de etiquetas, para poblar el chip de filtro. Sale del
   * catálogo y no de los leads del resultado: si saliera del resultado, filtrar
   * por una etiqueta dejaría el selector con esa sola y no habría con qué
   * cambiarla — el mismo problema que resuelve `vehiculos` mirando el pre-filtro.
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
