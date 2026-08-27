import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { calcularEstadoWorkflow } from "@/lib/ui/workflow-estado";
import { GrafoSchema } from "@/lib/validation/workflows.schema";
import {
  ejecutarWorkflow,
  serializarVariables,
  type EjecucionCallbacks,
  type ResultadoEjecucion,
} from "@/lib/workflows/engine";
import { resumenPasos } from "@/lib/workflows/pasos";
import { validarGrafo } from "@/lib/workflows/validar-grafo";
import type { LeadsRepository } from "@/server/repositories/leads.repo";
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

export interface ProbarWorkflowInput {
  workflowId: UUID;
  grafo: Grafo;
  maxPasos: number;
  /** Lead de prueba: el motor necesita una entidad real para interpolar variables. */
  leadId: UUID;
  userId: UUID | null;
}

export interface ProbarWorkflowResult {
  runId: UUID;
  resultado: ResultadoEjecucion;
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
  /** Crea una nueva versión draft clonando el grafo de una existente. */
  crearVersionDesde(versionId: UUID, userId: UUID | null): Promise<WorkflowVersion>;
  /** Crea una nueva versión desde una antigua y la publica (rollback). */
  rollbackAVersion(
    workflowId: UUID,
    versionId: UUID,
    userId: UUID | null,
  ): Promise<WorkflowVersion>;
  /**
   * Prueba el grafo actual del editor contra un lead real: guarda una versión
   * nueva (misma puerta que `guardarVersion`, misma validación) y arranca una
   * corrida de verdad contra el motor — sin wiring a Inngest ni a Meta: los
   * handlers de mensajería/CRM son puros y sólo devuelven qué habrían hecho.
   */
  probar(input: ProbarWorkflowInput): Promise<ProbarWorkflowResult>;
}

export class DefaultWorkflowsAdminService implements WorkflowsAdminService {
  constructor(
    private readonly deps: {
      workflows: WorkflowsRepository;
      workflowRuns: WorkflowRunsRepository;
      leads: LeadsRepository;
    },
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

  /**
   * Crea una nueva versión draft clonando el grafo de una existente.
   *
   * Se usa cuando se quiere editar una versión publicada sin romperla: se clona
   * a un borrador, se edita el borrador, y cuando esté listo se publica.
   */
  async crearVersionDesde(versionId: UUID, userId: UUID | null): Promise<WorkflowVersion> {
    const versionOrigen = await this.deps.workflows.findVersion(versionId);
    if (!versionOrigen) {
      throw new NotFoundError(`versión no encontrada: ${versionId}`, "workflow_version", versionId);
    }

    const siguienteNumero = await this.deps.workflows.proximaVersion(versionOrigen.workflow_id);

    return this.deps.workflows.crearVersion({
      workflow_id: versionOrigen.workflow_id,
      version: siguienteNumero,
      grafo: versionOrigen.grafo,
      max_pasos: versionOrigen.max_pasos,
      created_by: userId,
    });
  }

  /**
   * Rollback: crea una nueva versión desde una antigua y la publica.
   *
   * Es un atajo de "crear versión desde + publicar" en una sola operación. La
   * versión nueva tiene el grafo de la versión seleccionada pero con número
   * nuevo — no revive la versión vieja, crea una copia fresca.
   */
  async rollbackAVersion(
    workflowId: UUID,
    versionId: UUID,
    userId: UUID | null,
  ): Promise<WorkflowVersion> {
    // Verificar que la versión pertenece al workflow
    const versionOrigen = await this.deps.workflows.findVersion(versionId);
    if (!versionOrigen) {
      throw new NotFoundError(`versión no encontrada: ${versionId}`, "workflow_version", versionId);
    }
    if (versionOrigen.workflow_id !== workflowId) {
      throw new ValidationError(
        "La versión no pertenece a este workflow",
        "version_workflow_mismatch",
      );
    }

    // Crear nueva versión con el grafo de la versión seleccionada
    const nuevaVersion = await this.crearVersionDesde(versionId, userId);

    // Publicarla automáticamente
    return this.deps.workflows.publicarVersion(nuevaVersion.id);
  }

  async probar(input: ProbarWorkflowInput): Promise<ProbarWorkflowResult> {
    // Misma puerta que "Guardar": el grafo que se prueba es el que queda
    // guardado como borrador, para que "Probar" y "Guardar" nunca diverjan.
    const version = await this.guardarVersion({
      workflowId: input.workflowId,
      grafo: input.grafo,
      maxPasos: input.maxPasos,
      userId: input.userId,
    });

    const lead = await this.deps.leads.findById(input.leadId);
    if (!lead) {
      throw new NotFoundError(`lead no encontrado: ${input.leadId}`, "lead", input.leadId);
    }

    const { run, motivo } = await this.deps.workflowRuns.arrancar({
      versionId: version.id,
      leadId: input.leadId,
      sessionId: null,
      contexto: {},
    });
    if (!run) {
      if (motivo === "ya_hay_corrida_viva") {
        throw new ConflictError(
          "Ya hay una corrida en curso para este lead. Esperá a que termine antes de probar de nuevo.",
          "ya_hay_corrida_viva",
        );
      }
      throw new NotFoundError(
        `versión no encontrada: ${version.id}`,
        "workflow_version",
        version.id,
      );
    }

    const callbacks: EjecucionCallbacks = {
      persistirEstado: async (ctx) => {
        const contexto = serializarVariables(ctx.variables);
        const pasos = ctx.historialPasos.length;
        if (ctx.estado === "completado") {
          await this.deps.workflowRuns.terminar(ctx.runId, pasos);
        } else if (ctx.estado === "error") {
          await this.deps.workflowRuns.fallar(ctx.runId, ctx.error ?? "error desconocido", pasos);
        } else if (ctx.estado === "esperando") {
          await this.deps.workflowRuns.esperar(ctx.runId, ctx.nodoActual, contexto, pasos);
        } else {
          await this.deps.workflowRuns.avanzar(ctx.runId, ctx.nodoActual, contexto, pasos);
        }
      },
      persistirPaso: async (runId, paso, orden) => {
        await this.deps.workflowRuns.registrarPaso(runId, {
          nodo_id: paso.nodoId,
          orden,
          entrada: paso.entrada,
          salida: paso.salida,
          error: paso.error ?? null,
        });
      },
    };

    const resultado = await ejecutarWorkflow(
      version,
      { runId: run.id, trigger: { tipo: "manual", datos: {} }, lead },
      callbacks,
    );

    return { runId: run.id, resultado };
  }
}
