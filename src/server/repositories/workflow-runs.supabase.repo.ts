import { InfraError, NotFoundError } from "@/lib/errors";
import type { AppClient } from "@/server/db/client";
import { mapPostgrestError } from "@/server/db/postgrest-errors";
import { serverNowIso } from "@/server/db/server-time";
import { isUuid } from "@/server/db/uuid";
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
import { esMotivoSalto, type MotivoSalto } from "@/types/workflows";
import { saltosEnCero } from "./workflow-runs.repo";
import type {
  ArrancarWorkflowRunInput,
  ArrancarWorkflowRunMotivo,
  ArrancarWorkflowRunResult,
  CancelarWorkflowRunResult,
  CorridasPorNodo,
  CorridasVivasDeVersion,
  ReanudarWorkflowRunMotivo,
  ReanudarWorkflowRunResult,
  RelanzarWorkflowRunMotivo,
  RelanzarWorkflowRunResult,
  WorkflowRunPasoInsert,
  WorkflowRunsRepository,
} from "./workflow-runs.repo";

const COLS_RUN =
  "id, workflow_version_id, lead_id, lead_session_id, estado, nodo_actual, contexto, pasos_ejecutados, error, started_at, ended_at, intentos";

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
  /** Migración 20260926140000. Una base sin ella no la devuelve: se lee como vacía. */
  cancelados?: string[] | null;
}

interface ReanudarWorkflowRunRow {
  desde_paso: number | null;
  nodo_id: string | null;
  error_code: ReanudarWorkflowRunMotivo | null;
}

interface RelanzarWorkflowRunRow {
  run_id: string | null;
  error_code: RelanzarWorkflowRunMotivo | null;
  cancelados?: string[] | null;
}

interface SaltosPorMotivoRow {
  motivo: string;
  // `bigint` en Postgres: PostgREST lo manda como número, `Number()` cubre texto.
  cantidad: number | string;
}

interface CorridasVivasRow {
  version_id: string;
  // `bigint` en Postgres: PostgREST lo manda como número, `Number()` cubre texto.
  cantidad: number | string;
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
  intentos: number | null;
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
    const cancelados = row.cancelados ?? [];
    if (row.error_code !== null) return { run: null, motivo: row.error_code, cancelados };
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
    return { run, cancelados };
  }

  async registrarNoArrancada(
    input: ArrancarWorkflowRunInput,
    motivo: string,
  ): Promise<WorkflowRun> {
    // INSERT directo y no `arrancar_workflow_run`: esa función aplica la
    // política de concurrencia, y una corrida que no arranca no es viva --
    // con `reiniciar` cancelaría la corrida de verdad del flujo sólo para
    // anotar que ésta no corrió. `started_at` lo pone Postgres y `ended_at`
    // sale de su mismo reloj (`serverNowIso`): el CHECK
    // `workflow_runs_fin_coherente` exige `ended_at` en un estado terminal.
    const endedAt = await serverNowIso(this.db);
    const { data, error } = await this.db
      .from("workflow_runs")
      .insert({
        workflow_version_id: input.versionId,
        lead_id: input.leadId,
        lead_session_id: input.sessionId,
        estado: "cancelado",
        // Mismo cast que `arrancar`: `Record<string, unknown>` no es `Json` para TS.
        contexto: input.contexto as never,
        pasos_ejecutados: 0,
        error: motivo,
        ended_at: endedAt,
      })
      .select(COLS_RUN)
      .single();
    if (error) throw mapPostgrestError(error, { resource: "workflow_runs" });
    return mapRun(data as WorkflowRunRow);
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
    await this.actualizarSiViva(runId, {
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
    await this.actualizarSiViva(runId, {
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
    await this.actualizarSiViva(runId, {
      estado: "terminado",
      pasos_ejecutados: pasos,
      ended_at: endedAt,
    });
  }

  async fallar(runId: UUID, error: string, pasos: number, intentos?: number): Promise<void> {
    const endedAt = await serverNowIso(this.db);
    await this.actualizarSiViva(runId, {
      estado: "fallado",
      pasos_ejecutados: pasos,
      error,
      ended_at: endedAt,
      ...(intentos !== undefined ? { intentos } : {}),
    });
  }

  async cancelar(runId: UUID, motivo: string, pasos: number): Promise<void> {
    // `ended_at` del reloj de Postgres, como en `terminar`/`fallar`.
    const endedAt = await serverNowIso(this.db);
    await this.actualizarSiViva(runId, {
      estado: "cancelado",
      pasos_ejecutados: pasos,
      error: motivo,
      ended_at: endedAt,
    });
  }

  async corridasPorNodo(versionId: UUID, desde: Date): Promise<CorridasPorNodo> {
    if (!isUuid(versionId)) return { corridas: 0, vivas: 0, nodos: [] };
    const { data, error } = await this.db.rpc("workflow_corridas_por_nodo", {
      p_version_id: versionId,
      p_desde: desde.toISOString(),
    });
    if (error) throw mapPostgrestError(error, { resource: "workflow_runs" });
    const r = data as {
      corridas?: unknown;
      vivas?: unknown;
      nodos?: { nodo_id: string; corridas: number; fallaron: number; esperando: number }[];
    } | null;
    if (r === null || typeof r.corridas !== "number" || typeof r.vivas !== "number") {
      throw new InfraError("workflow_corridas_por_nodo devolvió otra forma", "postgrest");
    }
    return {
      corridas: r.corridas,
      vivas: r.vivas,
      nodos: (r.nodos ?? []).map((n) => ({
        nodoId: n.nodo_id,
        corridas: n.corridas,
        fallaron: n.fallaron,
        esperando: n.esperando,
      })),
    };
  }

  async cancelarSiViva(runId: UUID, motivo: string): Promise<CancelarWorkflowRunResult> {
    if (!isUuid(runId)) return { ok: false, motivo: "corrida_no_encontrada" };
    // Compare-and-swap en un solo UPDATE: entre leer el estado y escribirlo el
    // segmento podría cerrarla. `ended_at` del reloj de Postgres.
    const endedAt = await serverNowIso(this.db);
    const { data, error } = await this.db
      .from("workflow_runs")
      .update({ estado: "cancelado", error: motivo, ended_at: endedAt })
      .eq("id", runId)
      .in("estado", ESTADOS_VIVOS)
      .select("id")
      .maybeSingle();
    if (error) throw mapPostgrestError(error, { resource: "workflow_runs" });
    if (data !== null) return { ok: true };
    return (await this.existe(runId))
      ? { ok: false, motivo: "corrida_no_viva" }
      : { ok: false, motivo: "corrida_no_encontrada" };
  }

  async fallarSiVivo(
    runId: UUID,
    error: string,
    desdePaso: number,
    intentos?: number,
  ): Promise<boolean> {
    // Mismo UPDATE compare-and-swap que `tomarSegmento` (id + pasos_ejecutados
    // + estado vivo), pero escribe `fallado` en vez de tomar la corrida: si
    // otro camino ya la cerró (avanzó a otro paso, o la terminaron/fallaron/
    // cancelaron a mano) el `.eq`/`.in` no matchea ninguna fila y esto es un
    // no-op -- no resucita una corrida que ya cerró.
    const endedAt = await serverNowIso(this.db);
    const { data, error: pgError } = await this.db
      .from("workflow_runs")
      .update({
        estado: "fallado",
        pasos_ejecutados: desdePaso,
        error,
        ended_at: endedAt,
        ...(intentos !== undefined ? { intentos } : {}),
      })
      .eq("id", runId)
      .eq("pasos_ejecutados", desdePaso)
      .in("estado", ESTADOS_VIVOS)
      .select("id")
      .maybeSingle();
    if (pgError) throw mapPostgrestError(pgError, { resource: "workflow_runs" });
    return data !== null;
  }

  async reanudar(runId: UUID): Promise<ReanudarWorkflowRunResult> {
    // Una sola función con el mismo advisory lock que `arrancar_workflow_run`:
    // decidir acá "¿está fallada, hay otra viva?" y después escribir sería la
    // misma carrera que ese RPC existe para cerrar.
    const { data, error } = await this.db.rpc("reanudar_workflow_run", { p_run_id: runId });
    if (error) throw mapPostgrestError(error, { resource: "workflow_runs" });

    const row = (data as ReanudarWorkflowRunRow[] | null)?.[0];
    if (!row) throw new InfraError("reanudar_workflow_run no devolvió resultado", "postgrest");
    if (row.error_code !== null) return { ok: false, motivo: row.error_code };
    if (row.desde_paso === null || row.nodo_id === null) {
      throw new InfraError("reanudar_workflow_run no devolvió desde dónde sigue", "postgrest");
    }
    return { ok: true, desdePaso: row.desde_paso, nodoId: row.nodo_id };
  }

  async relanzar(runId: UUID): Promise<RelanzarWorkflowRunResult> {
    const { data, error } = await this.db.rpc("relanzar_workflow_run", { p_run_id: runId });
    if (error) throw mapPostgrestError(error, { resource: "workflow_runs" });

    const row = (data as RelanzarWorkflowRunRow[] | null)?.[0];
    if (!row) throw new InfraError("relanzar_workflow_run no devolvió resultado", "postgrest");
    const cancelados = row.cancelados ?? [];
    if (row.error_code !== null) return { run: null, motivo: row.error_code, cancelados };
    if (row.run_id === null) {
      throw new InfraError("relanzar_workflow_run devolvió run_id nulo", "postgrest");
    }

    const run = await this.findRun(row.run_id);
    if (!run) {
      throw new InfraError(
        "relanzar_workflow_run creó una corrida que no se puede leer de vuelta",
        "postgrest",
      );
    }
    return { run, cancelados };
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

  async contarVivasPorVersion(workflowId: UUID): Promise<CorridasVivasDeVersion[]> {
    // El GROUP BY en Postgres (`contar_corridas_vivas`): traer las filas para
    // contarlas acá chocaría con el corte de 1.000 de PostgREST.
    const { data, error } = await this.db.rpc("contar_corridas_vivas", {
      p_workflow_id: workflowId,
    });
    if (error) throw mapPostgrestError(error, { resource: "workflow_runs" });
    return ((data ?? []) as CorridasVivasRow[]).map((r) => ({
      versionId: r.version_id,
      cantidad: Number(r.cantidad),
    }));
  }

  async contarSaltosPorMotivo(desde: Date): Promise<Record<MotivoSalto, number>> {
    // El GROUP BY en Postgres (`contar_saltos_workflow`), por el mismo motivo
    // que `contar_corridas_vivas`: PostgREST corta en 1.000 filas sin avisar.
    const { data, error } = await this.db.rpc("contar_saltos_workflow", {
      p_desde: desde.toISOString(),
    });
    if (error) throw mapPostgrestError(error, { resource: "workflow_run_pasos" });
    const conteo = saltosEnCero();
    for (const fila of (data ?? []) as SaltosPorMotivoRow[]) {
      // La base admite sólo los motivos del CHECK; uno que la app no conoce es
      // un contrato roto entre los dos, y se dice en vez de perderlo.
      if (!esMotivoSalto(fila.motivo)) {
        throw new InfraError(`motivo de salto desconocido: ${fila.motivo}`, "postgrest");
      }
      conteo[fila.motivo] = Number(fila.cantidad);
    }
    return conteo;
  }

  /**
   * Sólo sobre una corrida viva (ver el bloque de `avanzar` en la interfaz).
   * Cero filas: si la corrida existe, ya cerró y no se toca; si no existe,
   * `NotFoundError`, igual que antes.
   */
  private async actualizarSiViva(runId: UUID, cambios: Record<string, unknown>): Promise<void> {
    const { data, error } = await this.db
      .from("workflow_runs")
      .update(cambios as never)
      .eq("id", runId)
      .in("estado", ESTADOS_VIVOS)
      .select("id")
      .maybeSingle();
    if (error) throw mapPostgrestError(error, { resource: "workflow_runs" });
    if (data === null && !(await this.existe(runId))) {
      throw new NotFoundError(`corrida no encontrada: ${runId}`, "workflow_run", runId);
    }
  }

  private async existe(runId: UUID): Promise<boolean> {
    const { data, error } = await this.db
      .from("workflow_runs")
      .select("id")
      .eq("id", runId)
      .maybeSingle();
    if (error) throw mapPostgrestError(error, { resource: "workflow_runs" });
    return data !== null;
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
      .select(
        `${COLS_RUN}, motivo_salto, workflow_versiones!inner(workflow_id), leads(nombre, nombre_perfil)`,
      )
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
        `${COLS_RUN}, motivo_salto, workflow_versiones!inner(workflow_id, version, publicada), leads(nombre, nombre_perfil)`,
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
  motivo_salto: string | null;
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
    // El CHECK de la columna sólo admite los motivos conocidos; el guard es
    // para no castear a ciegas lo que viene de un jsonb/texto.
    motivo_salto: esMotivoSalto(r.motivo_salto) ? r.motivo_salto : null,
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
    intentos: r.intentos,
  };
}
