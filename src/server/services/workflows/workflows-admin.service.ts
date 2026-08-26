import { NotFoundError, ValidationError } from "@/lib/errors";
import { calcularEstadoWorkflow } from "@/lib/ui/workflow-estado";
import { GrafoSchema } from "@/lib/validation/workflows.schema";
import { resumenPasos } from "@/lib/workflows/pasos";
import { validarGrafo } from "@/lib/workflows/validar-grafo";
import type { WorkflowRunsRepository } from "@/server/repositories/workflow-runs.repo";
import type { WorkflowsRepository } from "@/server/repositories/workflows.repo";
import type { UUID, Workflow, WorkflowResumen, WorkflowVersion } from "@/types/entities";
import type { Grafo } from "@/types/workflows";

/** Ventana de métricas de la card: "últimos 30 días", igual que la Métricas de siempre. */
const VENTANA_METRICAS_MS = 30 * 24 * 60 * 60 * 1000;

/** `" (copia)"` no puede empujar el nombre más allá del CHECK de 80 chars de `workflows`. */
const SUFIJO_COPIA = " (copia)";
const NOMBRE_MAX = 80;

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
  /** Todo lo que pinta una card del listado: estado, métricas de 30 días, resumen del flujo. */
  listarConResumen(): Promise<WorkflowResumen[]>;
  /** Copia nombre + descripción + la última versión guardada (si hay una) a un workflow nuevo, apagado. */
  duplicar(workflowId: UUID): Promise<Workflow>;
  pausar(workflowId: UUID): Promise<Workflow>;
  reanudar(workflowId: UUID): Promise<Workflow>;
  eliminar(workflowId: UUID): Promise<void>;
}

export class DefaultWorkflowsAdminService implements WorkflowsAdminService {
  constructor(
    private readonly deps: { workflows: WorkflowsRepository; workflowRuns: WorkflowRunsRepository },
  ) {}

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

  /**
   * Une tres lecturas en la forma que pide la pantalla de listado:
   *   1. los workflows (una consulta);
   *   2. las versiones de CADA workflow, para saber la última guardada y cuál
   *      está publicada -- N+1 asumido, mismo trato que le da `page.tsx` hoy
   *      (docena de workflows por instalación, no miles, AGENTS.md §1);
   *   3. las métricas de TODOS los workflows en una sola llamada batched --
   *      esta sí evita el N+1, porque `metricasPorWorkflow` ya recibe la
   *      lista completa de ids en vez de que este método la llame en loop.
   */
  async listarConResumen(): Promise<WorkflowResumen[]> {
    const workflows = await this.deps.workflows.listarWorkflows();
    if (workflows.length === 0) return [];

    const desde = new Date(Date.now() - VENTANA_METRICAS_MS);
    const [porWorkflow, metricasPorWorkflow] = await Promise.all([
      Promise.all(
        workflows.map(
          async (w) => [w.id, await this.deps.workflows.listarVersiones(w.id)] as const,
        ),
      ),
      this.deps.workflowRuns.metricasPorWorkflow(
        workflows.map((w) => w.id),
        desde,
      ),
    ]);
    const versionesPorWorkflow = new Map(porWorkflow);

    return workflows.map((w) => {
      const versiones = [...(versionesPorWorkflow.get(w.id) ?? [])].sort(
        (a, b) => b.version - a.version,
      );
      const ultima = versiones[0];
      const publicada = versiones.find((v) => v.publicada);
      const metricas = metricasPorWorkflow[w.id] ?? {
        totalRuns: 0,
        runsExitosos: 0,
        ultimoRun: null,
      };

      const resumen: WorkflowResumen = {
        workflow: w,
        estado: calcularEstadoWorkflow({
          activo: w.activo,
          tieneVersionPublicada: publicada !== undefined,
          ultimoRunFallado: metricas.ultimoRun !== null && !metricas.ultimoRun.exito,
        }),
        tieneVersionBorrador: ultima !== undefined && ultima.id !== publicada?.id,
        versionPublicada: publicada?.version ?? null,
        resumenPasos: ultima ? resumenPasos(ultima.grafo) : [],
        metricas,
        ultimaEdicion: ultima?.created_at ?? w.created_at,
      };
      return resumen;
    });
  }

  async duplicar(workflowId: UUID): Promise<Workflow> {
    const detalle = await this.detalle(workflowId);
    if (!detalle) {
      throw new NotFoundError(`workflow no encontrado: ${workflowId}`, "workflow", workflowId);
    }

    const nombreBase = detalle.workflow.nombre;
    const nombreCopia =
      nombreBase.length + SUFIJO_COPIA.length > NOMBRE_MAX
        ? nombreBase.slice(0, NOMBRE_MAX - SUFIJO_COPIA.length) + SUFIJO_COPIA
        : nombreBase + SUFIJO_COPIA;

    const copia = await this.crear({
      nombre: nombreCopia,
      descripcion: detalle.workflow.descripcion,
    });

    // La última versión guardada, publicada o no: es lo que alguien vería si
    // abriera el original ahora mismo, así que es lo que espera encontrar en
    // la copia. `guardarVersion` la revalida -- barata, y defiende contra que
    // el schema del grafo haya cambiado desde que se guardó el original.
    const ultima = detalle.versiones[0];
    if (ultima) {
      await this.guardarVersion({
        workflowId: copia.id,
        grafo: ultima.grafo,
        maxPasos: ultima.max_pasos,
        userId: null,
      });
    }

    return copia;
  }

  async pausar(workflowId: UUID): Promise<Workflow> {
    return this.deps.workflows.setActivo(workflowId, false);
  }

  async reanudar(workflowId: UUID): Promise<Workflow> {
    return this.deps.workflows.setActivo(workflowId, true);
  }

  async eliminar(workflowId: UUID): Promise<void> {
    return this.deps.workflows.eliminar(workflowId);
  }
}
