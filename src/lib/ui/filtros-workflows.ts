import type { ValorParam } from "./filtros-leads";
import type { WorkflowEstado, WorkflowResumen } from "@/types/entities";

/** Nombre de cada filtro en la URL de `/workflows`. */
export const PARAM = { busqueda: "q", estado: "estado", ordenar: "orden" } as const;

/** `"todos"` no es un `WorkflowEstado`: es la ausencia de filtro por estado. */
export const ESTADOS_WORKFLOW_FILTRO = ["todos", "activo", "borrador", "pausado", "error"] as const;
export type EstadoWorkflowFiltro = (typeof ESTADOS_WORKFLOW_FILTRO)[number];

export const ORDENAR_WORKFLOWS = ["editado", "nombre", "runs", "reciente"] as const;
export type OrdenarWorkflows = (typeof ORDENAR_WORKFLOWS)[number];

export const ORDENAR_WORKFLOWS_LABEL: Record<OrdenarWorkflows, string> = {
  editado: "Último editado",
  nombre: "Nombre",
  runs: "Más runs",
  reciente: "Más reciente",
};

export const ESTADO_WORKFLOW_FILTRO_LABEL: Record<EstadoWorkflowFiltro, string> = {
  todos: "Todos",
  activo: "Activo",
  borrador: "Borrador",
  pausado: "Pausado",
  error: "Error",
};

export interface FiltrosWorkflowsValores {
  busqueda?: string;
  estado?: EstadoWorkflowFiltro;
  ordenar?: OrdenarWorkflows;
}

function esEstadoWorkflow(v: string): v is WorkflowEstado {
  return v === "activo" || v === "borrador" || v === "pausado" || v === "error";
}

function texto(valor: ValorParam): string | undefined {
  if (typeof valor !== "string") return undefined;
  const limpio = valor.trim().slice(0, 200);
  return limpio === "" ? undefined : limpio;
}

function opcion<T extends string>(valor: ValorParam, validos: readonly T[]): T | undefined {
  const s = texto(valor);
  return s !== undefined && (validos as readonly string[]).includes(s) ? (s as T) : undefined;
}

/**
 * Traductor URL -> filtros, mismo criterio que `parseFiltrosLeads`: un param
 * repetido, viejo o corrupto es "sin filtro", nunca un error -- un link
 * compartido tiene que seguir abriendo la pantalla.
 */
export function parseFiltrosWorkflowsParams(
  params: Record<string, ValorParam>,
): FiltrosWorkflowsValores {
  return {
    busqueda: texto(params[PARAM.busqueda]),
    estado: opcion(params[PARAM.estado], ESTADOS_WORKFLOW_FILTRO),
    ordenar: opcion(params[PARAM.ordenar], ORDENAR_WORKFLOWS),
  };
}

/**
 * Filtra por nombre (contiene, sin distinguir mayúsculas) y por estado, y
 * ordena. Todo en memoria sobre una lista que el service ya trajo entera: una
 * instalación tiene una docena de workflows, no miles (AGENTS.md §1 -- "1
 * instalación por cliente"), así que no hay ninguna razón para pagar un
 * round-trip a la base por cada tecla del buscador.
 */
export function filtrarYOrdenarWorkflows(
  items: readonly WorkflowResumen[],
  filtros: FiltrosWorkflowsValores,
): WorkflowResumen[] {
  const busqueda = filtros.busqueda?.trim().toLowerCase();
  let filtrados = busqueda
    ? items.filter((i) => i.workflow.nombre.toLowerCase().includes(busqueda))
    : [...items];

  if (filtros.estado && filtros.estado !== "todos" && esEstadoWorkflow(filtros.estado)) {
    const estado = filtros.estado;
    filtrados = filtrados.filter((i) => i.estado === estado);
  }

  const ordenar = filtros.ordenar ?? "editado";
  filtrados.sort((a, b) => {
    switch (ordenar) {
      case "nombre":
        return a.workflow.nombre.localeCompare(b.workflow.nombre, "es");
      case "runs":
        return b.metricas.totalRuns - a.metricas.totalRuns;
      case "reciente":
        return b.workflow.created_at.getTime() - a.workflow.created_at.getTime();
      case "editado":
      default:
        return b.ultimaEdicion.getTime() - a.ultimaEdicion.getTime();
    }
  });

  return filtrados;
}
