import { ValidationError } from "@/lib/errors";
import { GrafoSchema } from "@/lib/validation/workflows.schema";
import { validarGrafo } from "@/lib/workflows/validar-grafo";
import type { WorkflowsRepository } from "@/server/repositories/workflows.repo";
import type { UUID, Workflow, WorkflowVersion } from "@/types/entities";
import type { Grafo } from "@/types/workflows";

export interface GuardarVersionInput {
  workflowId: UUID;
  grafo: Grafo;
  maxPasos: number;
  userId: UUID | null;
}

/** Lo que se muestra en la pantalla de un workflow. */
export interface DetalleWorkflow {
  workflow: Workflow;
  /** De la versión más nueva a la más vieja. */
  versiones: WorkflowVersion[];
}

export interface WorkflowsAdminService {
  crear(input: { nombre: string; descripcion: string | null }): Promise<Workflow>;
  listar(): Promise<Workflow[]>;
  /** El workflow y todas sus versiones. `null` si el id no existe. */
  detalle(workflowId: UUID): Promise<DetalleWorkflow | null>;
  /** Valida el grafo y, sólo si está sano, lo guarda como versión nueva. */
  guardarVersion(input: GuardarVersionInput): Promise<WorkflowVersion>;
  publicar(versionId: UUID): Promise<WorkflowVersion>;
  versionPublicada(workflowId: UUID): Promise<WorkflowVersion | null>;
}

export class DefaultWorkflowsAdminService implements WorkflowsAdminService {
  constructor(private readonly deps: { workflows: WorkflowsRepository }) {}

  async crear(input: { nombre: string; descripcion: string | null }): Promise<Workflow> {
    return this.deps.workflows.crearWorkflow({
      nombre: input.nombre,
      descripcion: input.descripcion,
      // Nace apagado: activarlo es un acto deliberado, no el default de crear.
      activo: false,
    });
  }

  async listar(): Promise<Workflow[]> {
    return this.deps.workflows.listarWorkflows();
  }

  /**
   * Todo lo que la pantalla de detalle necesita, en una sola llamada.
   *
   * Existe acá y no en la UI porque `app/**` no puede importar
   * `server/repositories/**` — regla dura de boundaries, y con motivo: la
   * pantalla no tiene por qué saber que hay un repo del otro lado.
   */
  async detalle(workflowId: UUID): Promise<DetalleWorkflow | null> {
    const workflow = await this.deps.workflows.findWorkflow(workflowId);
    if (!workflow) return null;

    const versiones = await this.deps.workflows.listarVersiones(workflowId);
    // La más nueva arriba: es la que se está por publicar, y es la que se mira.
    const ordenadas = [...versiones].sort((a, b) => b.version - a.version);
    return { workflow, versiones: ordenadas };
  }

  /**
   * La única puerta por la que un grafo entra a la base.
   *
   * Valida en dos etapas porque son dos preguntas distintas: primero la forma
   * (Zod), después el sentido (`validarGrafo`). Un grafo con un `tipo`
   * inexistente ni siquiera se puede recorrer, así que la forma va primero.
   *
   * Nada se guarda si algo falla: que la base sólo contenga grafos sanos es lo
   * que le permite a W2 ejecutar sin volver a validar en cada paso.
   */
  async guardarVersion(input: GuardarVersionInput): Promise<WorkflowVersion> {
    const forma = GrafoSchema.safeParse(input.grafo);
    if (!forma.success) {
      throw new ValidationError(
        `el grafo no tiene la forma esperada: ${forma.error.issues[0]?.message ?? "estructura inválida"}`,
        "grafo_forma_invalida",
      );
    }

    const problemas = validarGrafo(forma.data);
    if (problemas.length > 0) {
      // Todos los problemas en el mensaje, no el primero: quien está armando
      // el flujo quiere ver de una vez todo lo que le falta.
      const detalle = problemas.map((p) => `${p.regla}: ${p.mensaje}`).join(" | ");
      throw new ValidationError(`el flujo tiene problemas — ${detalle}`, "grafo_invalido");
    }

    const version = await this.deps.workflows.proximaVersion(input.workflowId);
    return this.deps.workflows.crearVersion({
      workflow_id: input.workflowId,
      version,
      grafo: forma.data,
      max_pasos: input.maxPasos,
      created_by: input.userId,
    });
  }

  async publicar(versionId: UUID): Promise<WorkflowVersion> {
    return this.deps.workflows.publicarVersion(versionId);
  }

  async versionPublicada(workflowId: UUID): Promise<WorkflowVersion | null> {
    return this.deps.workflows.findVersionPublicada(workflowId);
  }
}
