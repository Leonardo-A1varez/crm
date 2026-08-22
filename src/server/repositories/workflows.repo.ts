import { NotFoundError } from "@/lib/errors";
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
export type WorkflowVersionInsert = Insert<
  WorkflowVersion,
  "id" | "created_at" | "publicada" | "politica_concurrencia"
>;

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
  /** Publica una y despublica la que estuviera publicada de ese workflow. */
  publicarVersion(versionId: UUID): Promise<WorkflowVersion>;
  /** Qué número le toca a la próxima versión. 1 si no hay ninguna. */
  proximaVersion(workflowId: UUID): Promise<number>;
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

  async publicarVersion(versionId: UUID): Promise<WorkflowVersion> {
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
    const next: WorkflowVersion = { ...v, publicada: true };
    this.versiones.set(versionId, next);
    return { ...next };
  }

  async proximaVersion(workflowId: UUID): Promise<number> {
    const versiones = [...this.versiones.values()].filter((v) => v.workflow_id === workflowId);
    return versiones.reduce((max, v) => Math.max(max, v.version), 0) + 1;
  }
}
