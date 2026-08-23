import { NotFoundError } from "@/lib/errors";
import type { UUID, WorkflowRun, WorkflowRunEstado, WorkflowRunPaso } from "@/types/entities";
import type { Insert } from "./_types";

export type WorkflowRunPasoInsert = Insert<WorkflowRunPaso, "id" | "run_id" | "created_at">;

export interface ArrancarWorkflowRunInput {
  versionId: UUID;
  leadId: UUID;
  /** Nullable: hay disparadores que no nacen de una sesión (ej. cron por lead). */
  sessionId: UUID | null;
  contexto: Record<string, unknown>;
}

export type ArrancarWorkflowRunMotivo = "version_not_found" | "ya_hay_corrida_viva";

export interface ArrancarWorkflowRunResult {
  run: WorkflowRun | null;
  /** Sólo presente cuando `run` es null: por qué no arrancó. */
  motivo?: ArrancarWorkflowRunMotivo;
}

/** Estados en los que una corrida puede seguir avanzando. */
const ESTADOS_VIVOS: readonly WorkflowRunEstado[] = ["corriendo", "esperando"];

/**
 * Estado mutable de una ejecución del motor de workflows — capa 3 sobre
 * `workflows.repo.ts`, que sólo guarda la definición (workflow + versión).
 *
 * `tomarSegmento` es el método que importa: Inngest entrega *at-least-once*,
 * y el evento que dispara la continuación de una corrida lleva el
 * `desdePaso` con el que se despachó. Es un compare-and-swap — sólo toma la
 * corrida si `pasos_ejecutados` sigue siendo ese número y el estado sigue
 * vivo — para que un reintento de Inngest que llega después de que la
 * corrida ya avanzó (o terminó, o la canceló otra cosa) salga sin reejecutar
 * nada. Sin esto, un reintento reejecuta el segmento entero: si ese segmento
 * manda un WhatsApp, el cliente lo recibe dos veces.
 */
export interface WorkflowRunsRepository {
  arrancar(input: ArrancarWorkflowRunInput): Promise<ArrancarWorkflowRunResult>;
  /** Compare-and-swap: null si `pasos_ejecutados !== desdePaso` o si la corrida ya no está viva. */
  tomarSegmento(runId: UUID, desdePaso: number): Promise<WorkflowRun | null>;
  registrarPaso(runId: UUID, paso: WorkflowRunPasoInsert): Promise<void>;
  /** Avanza dentro del mismo segmento: sigue corriendo, sólo cambia de nodo. */
  avanzar(
    runId: UUID,
    nodoActual: string,
    contexto: Record<string, unknown>,
    pasos: number,
  ): Promise<void>;
  /** Pausa la corrida — espera un evento o un timer externo. */
  esperar(
    runId: UUID,
    nodoActual: string,
    contexto: Record<string, unknown>,
    pasos: number,
  ): Promise<void>;
  terminar(runId: UUID, pasos: number): Promise<void>;
  fallar(runId: UUID, error: string, pasos: number): Promise<void>;
  /**
   * CAS de fallo definitivo: mismo predicado que `tomarSegmento`
   * (`pasos_ejecutados === desdePaso` Y estado en `ESTADOS_VIVOS`), pero en
   * vez de tomar la corrida la marca `fallado`. Lo usa el `onFailure` de
   * Inngest cuando `workflow-segmento` agota los reintentos de un error
   * retriable: ese handler puede correr DESPUÉS de que la corrida ya cerró
   * por otro camino (reentrega de Inngest, o una carrera contra un handoff/
   * cancelación manual que la dejó en un estado terminal), y en ese caso NO
   * debe resucitar ni pisar una corrida que ya cerró con un error que ya no
   * aplica. Devuelve si efectivamente la marcó.
   */
  fallarSiVivo(runId: UUID, error: string, desdePaso: number): Promise<boolean>;
  findRun(id: UUID): Promise<WorkflowRun | null>;
}

export class InMemoryWorkflowRunsRepository implements WorkflowRunsRepository {
  private readonly runs = new Map<UUID, WorkflowRun>();
  private readonly pasos = new Map<UUID, WorkflowRunPaso[]>();

  /**
   * En Postgres, "corrida viva" se escopea por (workflow, lead): el join de
   * `arrancar_workflow_run` filtra por `workflow_id` de la versión que
   * dispara, y dos workflows distintos sí pueden correr en paralelo para el
   * mismo lead. Acá sólo llega `versionId` en cada `arrancar`, así que este
   * repo necesita poder resolver a qué workflow pertenece cada versión para
   * escopear igual.
   *
   * `resolverWorkflowId` es **opcional** a propósito: sin él, el escopeo cae
   * al fallback histórico (por `leadId` a secas, equivalente a la política
   * 'ignorar' aplicada sin distinguir workflows) — un test que no le importa
   * el multi-workflow no necesita setup extra. Un test que sí ejercita dos
   * workflows distintos sobre el mismo lead tiene que inyectar la función
   * que resuelve `versionId -> workflowId` para que el escopeo matchee el
   * de Postgres.
   */
  constructor(private readonly resolverWorkflowId?: (versionId: UUID) => UUID | undefined) {}

  async arrancar(input: ArrancarWorkflowRunInput): Promise<ArrancarWorkflowRunResult> {
    const workflowId = this.resolverWorkflowId?.(input.versionId);
    const viva = [...this.runs.values()].find((r) => {
      if (r.lead_id !== input.leadId) return false;
      if (!ESTADOS_VIVOS.includes(r.estado)) return false;
      // Sin lookup inyectado: fallback histórico, escopea sólo por lead.
      if (this.resolverWorkflowId === undefined) return true;
      return this.resolverWorkflowId(r.workflow_version_id) === workflowId;
    });
    if (viva) return { run: null, motivo: "ya_hay_corrida_viva" };

    const run: WorkflowRun = {
      id: crypto.randomUUID(),
      workflow_version_id: input.versionId,
      lead_id: input.leadId,
      lead_session_id: input.sessionId,
      estado: "corriendo",
      nodo_actual: null,
      contexto: structuredClone(input.contexto),
      pasos_ejecutados: 0,
      error: null,
      started_at: new Date(),
      ended_at: null,
    };
    this.runs.set(run.id, run);
    return { run: clonarRun(run) };
  }

  async tomarSegmento(runId: UUID, desdePaso: number): Promise<WorkflowRun | null> {
    const run = this.runs.get(runId);
    // Mismo predicado que el UPDATE de Postgres: id + pasos + estado vivo.
    if (!run) return null;
    if (run.pasos_ejecutados !== desdePaso) return null;
    if (!ESTADOS_VIVOS.includes(run.estado)) return null;
    run.estado = "corriendo";
    return clonarRun(run);
  }

  async registrarPaso(runId: UUID, paso: WorkflowRunPasoInsert): Promise<void> {
    const run = this.runs.get(runId);
    if (!run) throw new NotFoundError(`corrida no encontrada: ${runId}`, "workflow_run", runId);
    const fila: WorkflowRunPaso = {
      nodo_id: paso.nodo_id,
      orden: paso.orden,
      entrada: paso.entrada ? structuredClone(paso.entrada) : null,
      salida: paso.salida ? structuredClone(paso.salida) : null,
      error: paso.error,
      id: crypto.randomUUID(),
      run_id: runId,
      created_at: new Date(),
    };
    const lista = this.pasos.get(runId) ?? [];
    lista.push(fila);
    this.pasos.set(runId, lista);
  }

  async avanzar(
    runId: UUID,
    nodoActual: string,
    contexto: Record<string, unknown>,
    pasos: number,
  ): Promise<void> {
    this.actualizar(runId, {
      estado: "corriendo",
      nodo_actual: nodoActual,
      contexto: structuredClone(contexto),
      pasos_ejecutados: pasos,
    });
  }

  async esperar(
    runId: UUID,
    nodoActual: string,
    contexto: Record<string, unknown>,
    pasos: number,
  ): Promise<void> {
    this.actualizar(runId, {
      estado: "esperando",
      nodo_actual: nodoActual,
      contexto: structuredClone(contexto),
      pasos_ejecutados: pasos,
    });
  }

  async terminar(runId: UUID, pasos: number): Promise<void> {
    this.actualizar(runId, { estado: "terminado", pasos_ejecutados: pasos, ended_at: new Date() });
  }

  async fallar(runId: UUID, error: string, pasos: number): Promise<void> {
    this.actualizar(runId, {
      estado: "fallado",
      pasos_ejecutados: pasos,
      error,
      ended_at: new Date(),
    });
  }

  async fallarSiVivo(runId: UUID, error: string, desdePaso: number): Promise<boolean> {
    const run = this.runs.get(runId);
    // Mismo predicado que tomarSegmento: sin esto, este método resucitaría
    // una corrida que ya cerró (terminado/fallado) por otro camino.
    if (!run) return false;
    if (run.pasos_ejecutados !== desdePaso) return false;
    if (!ESTADOS_VIVOS.includes(run.estado)) return false;
    this.actualizar(runId, {
      estado: "fallado",
      pasos_ejecutados: desdePaso,
      error,
      ended_at: new Date(),
    });
    return true;
  }

  async findRun(id: UUID): Promise<WorkflowRun | null> {
    const run = this.runs.get(id);
    return run ? clonarRun(run) : null;
  }

  private actualizar(runId: UUID, cambios: Partial<WorkflowRun>): void {
    const run = this.runs.get(runId);
    if (!run) throw new NotFoundError(`corrida no encontrada: ${runId}`, "workflow_run", runId);
    this.runs.set(runId, { ...run, ...cambios });
  }
}

function clonarRun(run: WorkflowRun): WorkflowRun {
  return { ...run, contexto: structuredClone(run.contexto) };
}
