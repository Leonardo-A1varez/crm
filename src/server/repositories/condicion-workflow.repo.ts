import type { Grupo } from "@/lib/ui/condiciones";
import type { ConsultaCamposVivos } from "@/lib/workflows/condiciones";
import type { UUID } from "@/types/entities";
import type { ContextoRun } from "@/types/workflows";

/** Lo que la pantalla de condición necesita para ofrecer los campos cerrados que viven en la base. */
export interface CatalogosCondicion {
  /** Todos, activos o no: una condición guardada puede apuntar a uno que se desactivó. */
  intents: { id: UUID; nombre: string; activo: boolean }[];
  etiquetas: { id: UUID; nombre: string; color: string }[];
}

export interface OpcionesCoincidencias {
  ahora: Date;
  /** `agente_config.horario_timezone`: en qué día cae cada fecha. */
  zona: string;
  /** Cuántos leads devolver para "Ver la lista". 0 = sólo contar. */
  muestra: number;
}

export interface Coincidencias {
  total: number;
  /** Los primeros `muestra`, los de actividad más reciente primero. */
  leads: { id: UUID; nombre: string | null }[];
}

/**
 * Las lecturas de la condición de un workflow. Es un read model: no escribe.
 *
 * - `leerCamposVivos`: lo que el ejecutor lee justo antes de evaluar una
 *   condición (`CAMPOS_VIVOS` en `lib/workflows/condiciones.ts`), en las rutas
 *   en que la condición lo busca. Un dato que no existe queda `null`.
 * - `coincidencias`: cuántos leads cumplen un árbol **ahora**, contado en
 *   Postgres (`workflow_condicion_coincidencias`). No se traen los leads para
 *   filtrarlos acá: PostgREST corta en 1.000 filas y no avisa (lección 12).
 */
export interface CondicionWorkflowRepository {
  leerCamposVivos(consulta: ConsultaCamposVivos): Promise<ContextoRun>;
  catalogos(): Promise<CatalogosCondicion>;
  coincidencias(arbol: Grupo, opciones: OpcionesCoincidencias): Promise<Coincidencias>;
}

/**
 * Para tests: devuelve lo que se le carga, por lead. No evalúa árboles: la
 * semántica del conteo vive en SQL y se prueba contra Postgres.
 */
export class InMemoryCondicionWorkflowRepository implements CondicionWorkflowRepository {
  readonly vivosPorLead = new Map<UUID, ContextoRun>();
  catalogosCargados: CatalogosCondicion = { intents: [], etiquetas: [] };
  coincidenciasCargadas: Coincidencias = { total: 0, leads: [] };
  readonly consultas: ConsultaCamposVivos[] = [];

  async leerCamposVivos(consulta: ConsultaCamposVivos): Promise<ContextoRun> {
    this.consultas.push(consulta);
    return structuredClone(this.vivosPorLead.get(consulta.leadId) ?? {});
  }

  async catalogos(): Promise<CatalogosCondicion> {
    return structuredClone(this.catalogosCargados);
  }

  async coincidencias(_arbol: Grupo, opciones: OpcionesCoincidencias): Promise<Coincidencias> {
    return {
      total: this.coincidenciasCargadas.total,
      leads: this.coincidenciasCargadas.leads.slice(0, opciones.muestra),
    };
  }
}
