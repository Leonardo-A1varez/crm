import { NotFoundError } from "@/lib/errors";
import { disparadorMatch } from "@/lib/workflows/recorrer";
import type { UUID, Workflow, WorkflowVersion } from "@/types/entities";
import type { Insert } from "./_types";

export type WorkflowInsert = Insert<Workflow, "id" | "created_at">;
// `publicada` queda afuera del alta: una versión nace despublicada siempre,
// y publicar es un acto aparte (`publicarVersion`), que además tiene que
// despublicar la anterior. Dejar `publicada` en el alta permitía expresar
// un estado que Postgres rechaza con 23505 (índice único parcial).
// `politica_concurrencia` también queda afuera: el default seguro
// ("ignorar") vive en un solo lugar por impl (acá en `crearVersion` y en
// `COLS_VERSION` de la impl Supabase, que lo deja en manos del DEFAULT de
// la columna), no repetido en cada call site.
// `nota` tampoco: una versión nace sin nota. La escribe quien publica
// (`publicarVersion`) o quien restaura (`clonarVersion`).
export type WorkflowVersionInsert = Insert<
  WorkflowVersion,
  "id" | "created_at" | "publicada" | "politica_concurrencia" | "nota"
>;

/** Copiar una versión a una nueva. Ver `WorkflowsRepository.clonarVersion`. */
export interface ClonarVersionInput {
  versionId: UUID;
  /** Publicar la copia en la misma operación: restaurar una versión vieja. */
  publicar: boolean;
  nota: string | null;
  createdBy: UUID | null;
}

/**
 * Lectura y escritura de la definición de workflows.
 *
 * No expone `update` del grafo a propósito: `workflow_versiones` es
 * append-only. Cambiar un flujo es crear una versión nueva, porque puede
 * haber corridas ejecutando la anterior.
 */
export interface WorkflowsRepository {
  crearWorkflow(input: WorkflowInsert): Promise<Workflow>;
  listarWorkflows(): Promise<Workflow[]>;
  findWorkflow(id: UUID): Promise<Workflow | null>;

  crearVersion(input: WorkflowVersionInsert): Promise<WorkflowVersion>;
  listarVersiones(workflowId: UUID): Promise<WorkflowVersion[]>;
  findVersionPublicada(workflowId: UUID): Promise<WorkflowVersion | null>;
  /**
   * Una versión por id, publicada o no. Task 10 (motor de Inngest) la usa
   * para leer la versión PINNEADA de una corrida (`workflow_runs.workflow_version_id`)
   * -- nunca la publicada actual, que puede haber cambiado desde que la
   * corrida arrancó. `findVersionPublicada` no sirve para esto: una corrida
   * vieja puede estar corriendo sobre una versión que ya no es la publicada.
   */
  findVersion(id: UUID): Promise<WorkflowVersion | null>;
  /**
   * Publica una y despublica la que estuviera publicada de ese workflow. Con
   * `nota` la escribe en la versión que se publica; sin nota —o en blanco— la
   * que ya tuviera queda como estaba. No toca corridas: las que están en curso
   * terminan en la versión con la que arrancaron.
   */
  publicarVersion(versionId: UUID, nota?: string | null): Promise<WorkflowVersion>;
  /**
   * Copia una versión —grafo, tope de pasos, política de concurrencia— a una
   * versión NUEVA con el próximo número, y con `publicar` la publica en la
   * misma operación. Nunca revive la fila vieja: "crear versión desde" y
   * "restaurar" son esto. `NotFoundError` si la versión no existe.
   */
  clonarVersion(input: ClonarVersionInput): Promise<WorkflowVersion>;
  /** Qué número le toca a la próxima versión. 1 si no hay ninguna. */
  proximaVersion(workflowId: UUID): Promise<number>;
  /**
   * Versiones publicadas de workflows `activo` cuyo nodo disparador matchea
   * `disparador`. Es lo que `workflow-disparar` (Task 10) recorre para saber
   * qué corridas arrancar en respuesta a un evento de dominio.
   */
  listarPublicadasPorDisparador(disparador: string): Promise<WorkflowVersion[]>;
  /** Prender/apagar. No toca versiones ni corridas en vuelo. */
  setActivo(id: UUID, activo: boolean): Promise<Workflow>;
  /**
   * Borra el workflow y sus versiones (`ON DELETE CASCADE`). Si alguna versión
   * tiene corridas (`workflow_runs.workflow_version_id` es `ON DELETE
   * RESTRICT`), Postgres rechaza el borrado con 23503 -- `mapPostgrestError` lo
   * convierte en `ConflictError`, que la action traduce a un mensaje entendible
   * en vez de dejar pasar el texto crudo de Postgres.
   */
  eliminar(id: UUID): Promise<void>;
}

/** Una nota en blanco es ninguna nota: lo mismo que `nullif(btrim(...), '')` en Postgres. */
function notaLimpia(nota: string | null | undefined): string | null {
  const limpia = nota?.trim();
  return limpia ? limpia : null;
}

export class InMemoryWorkflowsRepository implements WorkflowsRepository {
  private readonly workflows = new Map<UUID, Workflow>();
  private readonly versiones = new Map<UUID, WorkflowVersion>();

  async crearWorkflow(input: WorkflowInsert): Promise<Workflow> {
    const w: Workflow = { ...input, id: crypto.randomUUID(), created_at: new Date() };
    this.workflows.set(w.id, w);
    return { ...w };
  }

  async listarWorkflows(): Promise<Workflow[]> {
    return [...this.workflows.values()].map((w) => ({ ...w }));
  }

  async findWorkflow(id: UUID): Promise<Workflow | null> {
    const w = this.workflows.get(id);
    return w ? { ...w } : null;
  }

  async crearVersion(input: WorkflowVersionInsert): Promise<WorkflowVersion> {
    const v: WorkflowVersion = {
      ...input,
      id: crypto.randomUUID(),
      created_at: new Date(),
      publicada: false,
      politica_concurrencia: "ignorar",
      nota: null,
    };
    this.versiones.set(v.id, v);
    return { ...v };
  }

  async listarVersiones(workflowId: UUID): Promise<WorkflowVersion[]> {
    return [...this.versiones.values()]
      .filter((v) => v.workflow_id === workflowId)
      .map((v) => ({ ...v }));
  }

  async findVersionPublicada(workflowId: UUID): Promise<WorkflowVersion | null> {
    const v = [...this.versiones.values()].find((x) => x.workflow_id === workflowId && x.publicada);
    return v ? { ...v } : null;
  }

  async findVersion(id: UUID): Promise<WorkflowVersion | null> {
    const v = this.versiones.get(id);
    return v ? { ...v } : null;
  }

  async publicarVersion(versionId: UUID, nota?: string | null): Promise<WorkflowVersion> {
    const v = this.versiones.get(versionId);
    if (!v)
      throw new NotFoundError(`versión no encontrada: ${versionId}`, "workflow_version", versionId);
    // Despublicar la anterior antes de publicar esta: el índice único parcial
    // de Postgres rechazaría dos publicadas del mismo workflow.
    for (const otra of this.versiones.values()) {
      if (otra.workflow_id === v.workflow_id && otra.publicada) {
        this.versiones.set(otra.id, { ...otra, publicada: false });
      }
    }
    const next: WorkflowVersion = { ...v, publicada: true, nota: notaLimpia(nota) ?? v.nota };
    this.versiones.set(versionId, next);
    return { ...next };
  }

  async clonarVersion(input: ClonarVersionInput): Promise<WorkflowVersion> {
    const origen = this.versiones.get(input.versionId);
    if (!origen) {
      throw new NotFoundError(
        `versión no encontrada: ${input.versionId}`,
        "workflow_version",
        input.versionId,
      );
    }
    const copia: WorkflowVersion = {
      ...origen,
      id: crypto.randomUUID(),
      version: await this.proximaVersion(origen.workflow_id),
      grafo: structuredClone(origen.grafo),
      publicada: false,
      created_at: new Date(),
      created_by: input.createdBy,
      nota: notaLimpia(input.nota),
    };
    this.versiones.set(copia.id, copia);
    return input.publicar ? this.publicarVersion(copia.id) : { ...copia };
  }

  async proximaVersion(workflowId: UUID): Promise<number> {
    const versiones = [...this.versiones.values()].filter((v) => v.workflow_id === workflowId);
    return versiones.reduce((max, v) => Math.max(max, v.version), 0) + 1;
  }

  async listarPublicadasPorDisparador(disparador: string): Promise<WorkflowVersion[]> {
    const resultado: WorkflowVersion[] = [];
    for (const v of this.versiones.values()) {
      if (!v.publicada) continue;
      const w = this.workflows.get(v.workflow_id);
      if (!w?.activo) continue;
      if (disparadorMatch(v.grafo, disparador)) resultado.push({ ...v });
    }
    return resultado;
  }

  async setActivo(id: UUID, activo: boolean): Promise<Workflow> {
    const w = this.workflows.get(id);
    if (!w) throw new NotFoundError(`workflow no encontrado: ${id}`, "workflow", id);
    const next: Workflow = { ...w, activo };
    this.workflows.set(id, next);
    return { ...next };
  }

  async eliminar(id: UUID): Promise<void> {
    this.workflows.delete(id);
    for (const [versionId, v] of this.versiones) {
      if (v.workflow_id === id) this.versiones.delete(versionId);
    }
  }
}
