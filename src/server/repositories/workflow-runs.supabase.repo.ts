import { InfraError, NotFoundError } from "@/lib/errors";
import type { AppClient } from "@/server/db/client";
import { mapPostgrestError } from "@/server/db/postgrest-errors";
import { serverNowIso } from "@/server/db/server-time";
import type {
  HistorialFiltros,
  HistorialPaginado,
  UUID,
  WorkflowMetricas,
  WorkflowRun,
  WorkflowRunConLead,
  WorkflowRunDetalle,
  WorkflowRunEstado,
  WorkflowRunPaso,
} from "@/types/entities";
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

/**
 * Tope de `metricasPorWorkflow`, mismo motivo que `MAX_WORKFLOWS_ACTIVOS` en
 * `workflows.supabase.repo.ts`: PostgREST corta en 1.000 filas sin avisar
 * (AGENTS.md nota 12), así que el `.range()` va explícito. 20.000 corridas en
 * 30 días es generoso para el tier piloto (~5K leads/mes, AGENTS.md §1) y
 * deja margen sin acercarse a un `.select()` sin tope.
 */
const MAX_RUNS_METRICAS = 20000;

interface RunMetricaRow {
  estado: WorkflowRunEstado;
  error: string | null;
  started_at: string;
  ended_at: string | null;
  workflow_versiones: { workflow_id: string };
}

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
      // La firma generada marca este arg como `string` sin `| null` porque
      // el codegen de Supabase no refleja nulabilidad de argumentos de
      // función — el parámetro Postgres (`p_session_id uuid`, sin `not
      // null`) sí acepta NULL.
      p_session_id: input.sessionId as never,
      // Acá el mismatch no es de nulabilidad: `p_contexto` espera `Json`
      // (unión recursiva de string|number|boolean|null|Json[]|{[k]:Json}) y
      // el dominio trabaja con `Record<string, unknown>`, que TS no
      // considera asignable pese a que el valor en runtime es JSON válido.
      // Mismo motivo que el cast de `grafo` en workflows.supabase.repo.ts.
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

  async fallarSiVivo(runId: UUID, error: string, desdePaso: number): Promise<boolean> {
    // Mismo UPDATE compare-and-swap que `tomarSegmento` (id + pasos_ejecutados
    // + estado vivo), pero escribe `fallado` en vez de tomar la corrida: si
    // otro camino ya la cerró (avanzó a otro paso, o la terminaron/fallaron/
    // cancelaron a mano) el `.eq`/`.in` no matchea ninguna fila y esto es un
    // no-op -- no resucita una corrida que ya cerró.
    const endedAt = await serverNowIso(this.db);
    const { data, error: pgError } = await this.db
      .from("workflow_runs")
      .update({ estado: "fallado", pasos_ejecutados: desdePaso, error, ended_at: endedAt })
      .eq("id", runId)
      .eq("pasos_ejecutados", desdePaso)
      .in("estado", ESTADOS_VIVOS)
      .select("id")
      .maybeSingle();
    if (pgError) throw mapPostgrestError(pgError, { resource: "workflow_runs" });
    return data !== null;
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

  /**
   * `workflow_id` no vive en `workflow_runs` (sólo `workflow_version_id`), así
   * que se embebe `workflow_versiones!inner(workflow_id)` -- un join, no una
   * segunda vuelta a la base. Mismo patrón que `listMensajesDesde` en
   * `metrics.supabase.repo.ts`. La agregación (total/exitosos/último) se hace
   * en JS sobre las filas crudas: es exactamente lo que ya hace el resto de
   * `MetricsRepository` para la pantalla de Métricas, no una excepción nueva.
   */
  async metricasPorWorkflow(
    workflowIds: readonly UUID[],
    desde: Date,
  ): Promise<Record<UUID, WorkflowMetricas>> {
    if (workflowIds.length === 0) return {};

    const { data, error } = await this.db
      .from("workflow_runs")
      .select("estado, error, started_at, ended_at, workflow_versiones!inner(workflow_id)")
      .in("workflow_versiones.workflow_id", workflowIds as string[])
      .gte("started_at", desde.toISOString())
      .range(0, MAX_RUNS_METRICAS - 1);
    if (error) throw mapPostgrestError(error, { resource: "workflow_runs" });

    const acumulado = new Map<
      string,
      { total: number; exitosos: number; ultimo: WorkflowMetricas["ultimoRun"] }
    >();
    for (const r of (data ?? []) as unknown as RunMetricaRow[]) {
      const workflowId = r.workflow_versiones.workflow_id;
      const startedAt = new Date(r.started_at);
      const exito = r.estado === "terminado" && r.error === null;

      const actual = acumulado.get(workflowId) ?? { total: 0, exitosos: 0, ultimo: null };
      actual.total += 1;
      if (exito) actual.exitosos += 1;
      // `>=` y no `>`: en un empate de `started_at` gana la fila procesada
      // después, mismo criterio que la impl InMemory.
      if (!actual.ultimo || startedAt >= actual.ultimo.at) {
        actual.ultimo = {
          at: startedAt,
          exito,
          duracionMs: r.ended_at ? new Date(r.ended_at).getTime() - startedAt.getTime() : null,
        };
      }
      acumulado.set(workflowId, actual);
    }

    const resultado: Record<string, WorkflowMetricas> = {};
    for (const [id, v] of acumulado) {
      resultado[id] = { totalRuns: v.total, runsExitosos: v.exitosos, ultimoRun: v.ultimo };
    }
    return resultado;
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

  // =========================================================================
  // Historial de ejecuciones (panel lateral I)
  // =========================================================================

  async listarHistorial(
    workflowId: UUID,
    filtros: HistorialFiltros,
    cursor?: string,
  ): Promise<HistorialPaginado> {
    const PAGE_SIZE = 20;

    // Primero contamos el total (sin cursor)
    let countQuery = this.db
      .from("workflow_runs")
      .select("id, workflow_versiones!inner(workflow_id)", { count: "exact", head: true })
      .eq("workflow_versiones.workflow_id", workflowId);

    if (filtros.estado && filtros.estado !== "todos") {
      countQuery = countQuery.eq("estado", filtros.estado);
    }
    if (filtros.fechaDesde) {
      countQuery = countQuery.gte("started_at", filtros.fechaDesde.toISOString());
    }
    if (filtros.fechaHasta) {
      countQuery = countQuery.lte("started_at", filtros.fechaHasta.toISOString());
    }
    if (filtros.leadId) {
      countQuery = countQuery.eq("lead_id", filtros.leadId);
    }

    const { count, error: countError } = await countQuery;
    if (countError) throw mapPostgrestError(countError, { resource: "workflow_runs" });

    // Ahora la query con los datos
    let query = this.db
      .from("workflow_runs")
      .select(`${COLS_RUN}, workflow_versiones!inner(workflow_id), leads(nombre, nombre_perfil)`)
      .eq("workflow_versiones.workflow_id", workflowId)
      .order("started_at", { ascending: false })
      .limit(PAGE_SIZE);

    if (filtros.estado && filtros.estado !== "todos") {
      query = query.eq("estado", filtros.estado);
    }
    if (filtros.fechaDesde) {
      query = query.gte("started_at", filtros.fechaDesde.toISOString());
    }
    if (filtros.fechaHasta) {
      query = query.lte("started_at", filtros.fechaHasta.toISOString());
    }
    if (filtros.leadId) {
      query = query.eq("lead_id", filtros.leadId);
    }
    if (cursor) {
      query = query.lt("started_at", cursor);
    }

    const { data, error } = await query;
    if (error) throw mapPostgrestError(error, { resource: "workflow_runs" });

    const runs = (data ?? []).map((r) => mapRunConLead(r as unknown as HistorialRunRow));
    const nextCursor =
      runs.length === PAGE_SIZE ? (runs.at(-1)?.started_at.toISOString() ?? null) : null;

    return {
      runs,
      nextCursor,
      total: count ?? 0,
    };
  }

  async detalleRun(runId: UUID): Promise<WorkflowRunDetalle | null> {
    const { data, error } = await this.db
      .from("workflow_runs")
      .select(
        `${COLS_RUN}, workflow_versiones!inner(workflow_id, version, publicada), leads(nombre, nombre_perfil)`,
      )
      .eq("id", runId)
      .maybeSingle();

    if (error) throw mapPostgrestError(error, { resource: "workflow_runs" });
    if (!data) return null;

    const pasos = await this.pasosDeRun(runId);
    const row = data as unknown as DetalleRunRow;

    return {
      ...mapRunConLead(row),
      pasos,
      version_numero: row.workflow_versiones.version,
      version_actual: row.workflow_versiones.publicada,
    };
  }

  async pasosDeRun(runId: UUID): Promise<WorkflowRunPaso[]> {
    const { data, error } = await this.db
      .from("workflow_run_pasos")
      .select("id, run_id, nodo_id, orden, entrada, salida, error, created_at")
      .eq("run_id", runId)
      .order("orden", { ascending: true });

    if (error) throw mapPostgrestError(error, { resource: "workflow_run_pasos" });

    return (data ?? []).map((p) => ({
      id: p.id,
      run_id: p.run_id,
      nodo_id: p.nodo_id,
      orden: p.orden,
      entrada: p.entrada as Record<string, unknown> | null,
      salida: p.salida as Record<string, unknown> | null,
      error: p.error,
      created_at: new Date(p.created_at),
    }));
  }
}

interface HistorialRunRow extends WorkflowRunRow {
  workflow_versiones: { workflow_id: string };
  leads: { nombre: string | null; nombre_perfil: string | null } | null;
}

interface DetalleRunRow extends HistorialRunRow {
  workflow_versiones: {
    workflow_id: string;
    version: number;
    publicada: boolean;
  };
}

function mapRunConLead(r: HistorialRunRow): WorkflowRunConLead {
  const run = mapRun(r);
  const leadNombre = r.leads?.nombre ?? r.leads?.nombre_perfil ?? null;
  return {
    ...run,
    lead_nombre: leadNombre,
    trigger_tipo: "manual", // TODO: extraer del contexto cuando se guarde
    trigger_datos: {},
    duracion_ms: run.ended_at ? run.ended_at.getTime() - run.started_at.getTime() : null,
  };
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
