import { InfraError, NotFoundError } from "@/lib/errors";
import type { AppClient } from "@/server/db/client";
import { mapPostgrestError } from "@/server/db/postgrest-errors";
import { serverNowIso } from "@/server/db/server-time";
import type { UUID, WorkflowRun, WorkflowRunEstado } from "@/types/entities";
import type {
  ArrancarWorkflowRunInput,
  ArrancarWorkflowRunMotivo,
  ArrancarWorkflowRunResult,
  WorkflowRunPasoInsert,
  WorkflowRunsRepository,
} from "./workflow-runs.repo";

const COLS_RUN =
  "id, workflow_version_id, lead_id, lead_session_id, estado, nodo_actual, contexto, pasos_ejecutados, error, started_at, ended_at";

const ESTADOS_VIVOS: readonly WorkflowRunEstado[] = ["corriendo", "esperando"];

interface ArrancarWorkflowRunRow {
  run_id: string | null;
  error_code: ArrancarWorkflowRunMotivo | null;
}

interface WorkflowRunRow {
  id: string;
  workflow_version_id: string;
  lead_id: string;
  lead_session_id: string | null;
  estado: WorkflowRunEstado;
  nodo_actual: string | null;
  contexto: unknown;
  pasos_ejecutados: number;
  error: string | null;
  started_at: string;
  ended_at: string | null;
}

export class SupabaseWorkflowRunsRepository implements WorkflowRunsRepository {
  constructor(private readonly db: AppClient) {}

  async arrancar(input: ArrancarWorkflowRunInput): Promise<ArrancarWorkflowRunResult> {
    // Decidir "hay corrida viva?" y despues insertar sería una carrera entre
    // dos disparos simultáneos del mismo lead — por eso arranca es un solo
    // RPC (`arrancar_workflow_run`, advisory lock por workflow+lead) y no un
    // SELECT seguido de un INSERT desde acá. Mismo patrón que
    // `approve_lead_merge` en lead-merge.supabase.repo.ts.
    const { data, error } = await this.db.rpc("arrancar_workflow_run", {
      p_version_id: input.versionId,
      p_lead_id: input.leadId,
      // La firma generada marca estos dos como `string` sin `| null` porque
      // el codegen de Supabase no refleja nulabilidad de argumentos de
      // función — el parámetro Postgres sí acepta NULL. Mismo motivo que el
      // cast de `grafo` en workflows.supabase.repo.ts.
      p_session_id: input.sessionId as never,
      p_contexto: input.contexto as never,
    });
    if (error) throw mapPostgrestError(error, { resource: "workflow_runs" });

    const row = (data as ArrancarWorkflowRunRow[] | null)?.[0];
    if (!row) throw new InfraError("arrancar_workflow_run no devolvió resultado", "postgrest");
    if (row.error_code !== null) return { run: null, motivo: row.error_code };
    if (row.run_id === null) {
      throw new InfraError("arrancar_workflow_run devolvió run_id nulo", "postgrest");
    }

    const run = await this.findRun(row.run_id);
    if (!run) {
      throw new InfraError(
        "arrancar_workflow_run creó una corrida que no se puede leer de vuelta",
        "postgrest",
      );
    }
    return { run };
  }

  async tomarSegmento(runId: UUID, desdePaso: number): Promise<WorkflowRun | null> {
    const { data, error } = await this.db
      .from("workflow_runs")
      .update({ estado: "corriendo" })
      .eq("id", runId)
      .eq("pasos_ejecutados", desdePaso)
      .in("estado", ESTADOS_VIVOS)
      .select(COLS_RUN)
      .maybeSingle();
    if (error) throw mapPostgrestError(error, { resource: "workflow_runs" });
    return data ? mapRun(data as WorkflowRunRow) : null;
  }

  async registrarPaso(runId: UUID, paso: WorkflowRunPasoInsert): Promise<void> {
    const { error } = await this.db.from("workflow_run_pasos").insert({
      run_id: runId,
      nodo_id: paso.nodo_id,
      orden: paso.orden,
      entrada: paso.entrada as never,
      salida: paso.salida as never,
      error: paso.error,
    });
    if (error) throw mapPostgrestError(error, { resource: "workflow_run_pasos" });
  }

  async avanzar(
    runId: UUID,
    nodoActual: string,
    contexto: Record<string, unknown>,
    pasos: number,
  ): Promise<void> {
    await this.actualizar(runId, {
      estado: "corriendo",
      nodo_actual: nodoActual,
      contexto: contexto as never,
      pasos_ejecutados: pasos,
    });
  }

  async esperar(
    runId: UUID,
    nodoActual: string,
    contexto: Record<string, unknown>,
    pasos: number,
  ): Promise<void> {
    await this.actualizar(runId, {
      estado: "esperando",
      nodo_actual: nodoActual,
      contexto: contexto as never,
      pasos_ejecutados: pasos,
    });
  }

  async terminar(runId: UUID, pasos: number): Promise<void> {
    // `ended_at` sale de `serverNowIso`, no de `new Date().toISOString()`:
    // el CHECK `workflow_runs_fin_coherente` exige que un estado terminal
    // tenga `ended_at`, y `started_at` ya lo puso Postgres con su propio
    // reloj — mezclar JS/PG en la misma fila de duración es la clase de bug
    // que la lección de clock skew de este proyecto ya pagó una vez
    // (ver `server-time.ts`).
    const endedAt = await serverNowIso(this.db);
    await this.actualizar(runId, {
      estado: "terminado",
      pasos_ejecutados: pasos,
      ended_at: endedAt,
    });
  }

  async fallar(runId: UUID, error: string, pasos: number): Promise<void> {
    const endedAt = await serverNowIso(this.db);
    await this.actualizar(runId, {
      estado: "fallado",
      pasos_ejecutados: pasos,
      error,
      ended_at: endedAt,
    });
  }

  async findRun(id: UUID): Promise<WorkflowRun | null> {
    const { data, error } = await this.db
      .from("workflow_runs")
      .select(COLS_RUN)
      .eq("id", id)
      .maybeSingle();
    if (error) throw mapPostgrestError(error, { resource: "workflow_runs" });
    return data ? mapRun(data as WorkflowRunRow) : null;
  }

  private async actualizar(runId: UUID, cambios: Record<string, unknown>): Promise<void> {
    const { data, error } = await this.db
      .from("workflow_runs")
      .update(cambios as never)
      .eq("id", runId)
      .select("id")
      .maybeSingle();
    if (error) throw mapPostgrestError(error, { resource: "workflow_runs" });
    if (data === null) {
      throw new NotFoundError(`corrida no encontrada: ${runId}`, "workflow_run", runId);
    }
  }
}

function mapRun(r: WorkflowRunRow): WorkflowRun {
  return {
    id: r.id,
    workflow_version_id: r.workflow_version_id,
    lead_id: r.lead_id,
    lead_session_id: r.lead_session_id,
    estado: r.estado,
    nodo_actual: r.nodo_actual,
    contexto: r.contexto as Record<string, unknown>,
    pasos_ejecutados: r.pasos_ejecutados,
    error: r.error,
    started_at: new Date(r.started_at),
    ended_at: r.ended_at ? new Date(r.ended_at) : null,
  };
}
