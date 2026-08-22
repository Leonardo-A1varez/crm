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
  findRun(id: UUID): Promise<WorkflowRun | null>;
}

export class InMemoryWorkflowRunsRepository implements WorkflowRunsRepository {
  private readonly runs = new Map<UUID, WorkflowRun>();
  private readonly pasos = new Map<UUID, WorkflowRunPaso[]>();

  async arrancar(input: ArrancarWorkflowRunInput): Promise<ArrancarWorkflowRunResult> {
    // Simplificación deliberada frente a Postgres: allá "corrida viva" se
    // escopea por (workflow, lead) — dos workflows distintos sí pueden
    // correr en paralelo para el mismo lead — pero acá sólo llega
    // `versionId`, no el workflow al que pertenece. Este InMemory escopea
    // por lead a secas, que es el comportamiento de la política 'ignorar'
    // (la única que ejercitan los tests de este repo). La política real
    // ('ignorar'/'reiniciar'/'permitir') vive en `arrancar_workflow_run`
    // (Postgres) — ahí sí conoce el workflow de cada versión.
    const viva = [...this.runs.values()].find(
      (r) => r.lead_id === input.leadId && ESTADOS_VIVOS.includes(r.estado),
    );
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
