import type { WorkflowRunEstado, UUID } from "@/types/entities";
import type { EstadoPaso } from "./estados";

/** Un run para mostrar en la lista del historial */
export interface WorkflowRunListItem {
  id: UUID;
  workflow_id: UUID;
  version_id: UUID;
  estado: WorkflowRunEstado;
  lead_id: UUID;
  lead_nombre: string | null;
  trigger_tipo: string;
  trigger_datos: Record<string, unknown>;
  nodo_actual: string | null;
  error: string | null;
  duracion_ms: number | null;
  pasos_completados: number;
  pasos_totales: number;
  iniciado_en: Date;
  completado_en: Date | null;
}

/** Detalle expandido de un run con pasos */
export interface WorkflowRunDetalle extends WorkflowRunListItem {
  pasos: PasoEjecutado[];
  version_numero: number;
  version_actual: boolean;
}

/** Un paso ejecutado dentro de un run */
export interface PasoEjecutado {
  id: UUID;
  nodo_id: string;
  nodo_nombre: string;
  nodo_tipo: string;
  estado: EstadoPaso;
  entrada: Record<string, unknown> | null;
  salida: Record<string, unknown> | null;
  duracion_ms: number;
  error: string | null;
  timestamp: Date;
}

/** Filtros del historial */
export interface FiltrosHistorial {
  estado?: WorkflowRunEstado | "todos";
  fechaDesde?: Date;
  fechaHasta?: Date;
  leadId?: string;
  busqueda?: string;
}

/** Resultado de la paginacion cursor */
export interface HistorialPaginado {
  runs: WorkflowRunListItem[];
  nextCursor: string | null;
  total: number;
}
