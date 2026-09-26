import { NotFoundError } from "@/lib/errors";
import { esperaOpcionCoincide } from "@/lib/workflows/respuesta-interactiva";
import {
  MOTIVOS_SALTO,
  esContextoDePrueba,
  motivoSaltoDeSalida,
  type MotivoSalto,
} from "@/types/workflows";
import type {
  HistorialFiltros,
  HistorialPaginado,
  PoliticaConcurrencia,
  UUID,
  WorkflowMetricas,
  WorkflowRun,
  WorkflowRunConLead,
  WorkflowRunDetalle,
  WorkflowRunEstado,
  WorkflowRunPaso,
} from "@/types/entities";
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
  /**
   * Las corridas vivas que la política "reiniciar" canceló para dejar arrancar
   * ésta. Quien llama le avisa a Inngest de cada una
   * (`workflow/corrida.cancelada`): sin eso, el segmento que duerme en una
   * espera sigue dormido hasta vencer.
   */
  cancelados: UUID[];
}

/** Por qué `reanudar` no reanudó. Los mismos códigos que devuelve `reanudar_workflow_run`. */
export type ReanudarWorkflowRunMotivo =
  | "corrida_no_encontrada"
  | "corrida_no_fallada"
  | "corrida_de_prueba"
  | "sin_paso_fallado"
  | "tope_pasos"
  | "ya_hay_corrida_viva";

export type ReanudarWorkflowRunResult =
  | { ok: true; desdePaso: number; nodoId: string }
  | { ok: false; motivo: ReanudarWorkflowRunMotivo };

/** Por qué `relanzar` no arrancó otra corrida: los suyos más los de `arrancar`. */
export type RelanzarWorkflowRunMotivo =
  | "corrida_no_encontrada"
  | "corrida_no_fallada"
  | "corrida_de_prueba"
  | ArrancarWorkflowRunMotivo;

export interface RelanzarWorkflowRunResult {
  run: WorkflowRun | null;
  /** Sólo presente cuando `run` es null. */
  motivo?: RelanzarWorkflowRunMotivo;
  /** Las que canceló la política "reiniciar" al arrancar la nueva. Ver `ArrancarWorkflowRunResult`. */
  cancelados: UUID[];
}

/** Por qué `cancelarSiViva` no canceló. */
export type CancelarWorkflowRunMotivo = "corrida_no_encontrada" | "corrida_no_viva";

export type CancelarWorkflowRunResult =
  | { ok: true }
  | { ok: false; motivo: CancelarWorkflowRunMotivo };

/** Por dónde pasaron las corridas de producción de una versión. Ver `corridasPorNodo`. */
export interface CorridasPorNodo {
  /** Corridas de la versión desde `desde` (sin las de Probar). */
  corridas: number;
  /** De ésas, las que siguen corriendo o esperando. */
  vivas: number;
  /** Por nodo, ordenados por id. Un nodo por el que no pasó ninguna no aparece. */
  nodos: { nodoId: string; corridas: number; fallaron: number; esperando: number }[];
}

export interface CorridasVivasDeVersion {
  versionId: UUID;
  cantidad: number;
}

/**
 * Lo que Postgres lee de la versión de una corrida para decidir. El repo
 * InMemory no tiene versiones: lo recibe inyectado (ver su constructor).
 */
export interface ReglasDeVersion {
  maxPasos: number;
  politica: PoliticaConcurrencia;
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
  /**
   * Deja constancia de una corrida que NO arrancó: una fila `cancelado`, sin
   * pasos, con `motivo` en `error`. Es lo que ve el dueño en el historial del
   * flujo cuando el motor corta una cadena de disparos
   * (`lib/workflows/cadena.ts`). No pasa por la política de concurrencia: no
   * es una corrida viva, así que ni frena a otra ni la reinicia.
   */
  registrarNoArrancada(input: ArrancarWorkflowRunInput, motivo: string): Promise<WorkflowRun>;
  /** Compare-and-swap: null si `pasos_ejecutados !== desdePaso` o si la corrida ya no está viva. */
  tomarSegmento(runId: UUID, desdePaso: number): Promise<WorkflowRun | null>;
  registrarPaso(runId: UUID, paso: WorkflowRunPasoInsert): Promise<void>;
  /*
   * `avanzar`, `esperar`, `terminar`, `fallar` y `cancelar` sólo escriben sobre
   * una corrida VIVA (`corriendo`/`esperando`). Sobre una que ya cerró —la
   * cancelaron a mano, o la reinició un disparo nuevo mientras su segmento
   * seguía en vuelo— no hacen nada: sin esto, el `esperar` de ese segmento la
   * devolvía a `esperando` y la corrida cancelada resucitaba. Una corrida que
   * no existe sigue siendo `NotFoundError`.
   */
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
  /** `intentos`: cuántas veces se intentó el paso que falló (ver `WorkflowRun.intentos`). */
  fallar(runId: UUID, error: string, pasos: number, intentos?: number): Promise<void>;
  /**
   * La corta el motor sin que haya fallado nada: `cancelado`, con `motivo` en
   * `error`. Hoy, una corrida que despierta de «Esperar evento» con una
   * cadena de disparos pasada del límite (`lib/workflows/cadena.ts`).
   */
  cancelar(runId: UUID, motivo: string, pasos: number): Promise<void>;
  /**
   * "Cancelar corrida" desde el panel: compare-and-swap a `cancelado` sólo si
   * la corrida sigue viva, con `motivo` en `error` y sus pasos intactos. No
   * toca Inngest: una corrida que espera despierta, `tomarSegmento` la ve
   * cerrada y el segmento sale sin hacer nada; una con el segmento en vuelo
   * no ejecuta la acción siguiente (`EjecutorDeps.seguir`).
   */
  cancelarSiViva(runId: UUID, motivo: string): Promise<CancelarWorkflowRunResult>;
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
  fallarSiVivo(runId: UUID, error: string, desdePaso: number, intentos?: number): Promise<boolean>;
  /**
   * "Reanudar desde el fallo": deja una corrida `fallado` esperando en el nodo
   * de su último paso —el que falló—, con `pasos_ejecutados` = el orden de ese
   * paso, lista para que el segmento que se encole con ese `desdePaso` la
   * tome. Nunca desde el disparador. El nodo fallado vuelve a correr con un
   * orden nuevo: su paso fallado queda como historia, y la clave de
   * idempotencia de un envío cambia —con la misma, `sendOutbound` daría por
   * enviado un mensaje que Meta rechazó—. No encola nada: eso es de quien
   * llama. Ver la migración de `reanudar_workflow_run`.
   */
  reanudar(runId: UUID): Promise<ReanudarWorkflowRunResult>;
  /**
   * "Ejecutar de nuevo desde el principio": una corrida NUEVA de la misma
   * versión, lead y contexto que una fallada, con la política de concurrencia
   * de `arrancar`. La fallada queda como estaba. No encola nada.
   */
  relanzar(runId: UUID): Promise<RelanzarWorkflowRunResult>;
  findRun(id: UUID): Promise<WorkflowRun | null>;
  /**
   * La corrida del lead que está esperando la opción que acaba de tocar (botón
   * o fila de lista de un mensaje que mandó un flujo), con el workflow al que
   * pertenece. `null` si ninguna la espera. Es lo que usa el pipeline de
   * mensajes para no hacer contestar al agente un toque que es del flujo
   * (`services/workflows/interceptor.service.ts`). Las de Probar no cuentan.
   */
  esperandoOpcion(
    leadId: UUID,
    respondeA: string | null,
  ): Promise<{ runId: UUID; workflowId: UUID } | null>;
  /**
   * Métricas de corridas por workflow, sólo las iniciadas después de `desde`.
   * Una llamada para TODOS los workflows a la vez (no una por workflow): es lo
   * que evita que la pantalla de listado sea un N+1 sobre `workflow_runs`.
   *
   * Un `workflowId` sin ninguna corrida en la ventana simplemente no aparece
   * como clave del resultado -- el caller decide el default (`totalRuns: 0`).
   */
  metricasPorWorkflow(
    workflowIds: readonly UUID[],
    desde: Date,
  ): Promise<Record<UUID, WorkflowMetricas>>;
  /**
   * Corridas vivas (`corriendo`/`esperando`) de un workflow, por versión. Una
   * versión sin vivas no aparece. Es lo que dice la pantalla de publicación:
   * cuántas corridas siguen en marcha, y en qué versión terminan.
   */
  contarVivasPorVersion(workflowId: UUID): Promise<CorridasVivasDeVersion[]>;
  /**
   * Cuántas corridas de producción de la versión pasaron por cada nodo desde
   * `desde`, cuántas fallaron ahí y cuántas esperan ahí ahora. Agregado en la
   * base (`workflow_corridas_por_nodo`): los pasos crecen con cada corrida.
   */
  corridasPorNodo(versionId: UUID, desde: Date): Promise<CorridasPorNodo>;

  // =========================================================================
  // Historial de ejecuciones (panel lateral I)
  // =========================================================================

  /** Historial paginado de un workflow con filtros. */
  listarHistorial(
    workflowId: UUID,
    filtros: HistorialFiltros,
    cursor?: string,
  ): Promise<HistorialPaginado>;

  /** Detalle de un run con sus pasos. */
  detalleRun(runId: UUID): Promise<WorkflowRunDetalle | null>;

  /** Pasos de un run en orden de ejecucion. */
  pasosDeRun(runId: UUID): Promise<WorkflowRunPaso[]>;

  /**
   * Cuántos mensajes saltó cada tope de seguridad desde `desde` (PRD §6.6),
   * contados en la base (`contar_saltos_workflow`): traer las filas para
   * contarlas acá chocaría con el corte de 1.000 de PostgREST. Todos los
   * motivos vienen en el resultado, en 0 si no saltó ninguno. Las corridas de
   * "Probar" no cuentan: no se le iba a mandar nada a nadie.
   */
  contarSaltosPorMotivo(desde: Date): Promise<Record<MotivoSalto, number>>;
}

/** Todos los motivos en 0: el punto de partida de un conteo. */
export function saltosEnCero(): Record<MotivoSalto, number> {
  return Object.fromEntries(MOTIVOS_SALTO.map((m) => [m, 0])) as Record<MotivoSalto, number>;
}

export class InMemoryWorkflowRunsRepository implements WorkflowRunsRepository {
  private readonly runs = new Map<UUID, WorkflowRun>();
  private readonly pasos = new Map<UUID, WorkflowRunPaso[]>();
  /** Lo que en Postgres escribe el trigger `workflow_run_pasos_marca_salto`. */
  private readonly saltos = new Map<UUID, MotivoSalto>();

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
   *
   * `resolverVersion`, igual de opcional, da lo que Postgres lee de la versión:
   * el tope de pasos (para no reanudar una corrida que volvería a cortarse) y
   * la política de concurrencia. Sin él: sin tope, y política 'ignorar', que es
   * el default de la columna.
   */
  constructor(
    private readonly resolverWorkflowId?: (versionId: UUID) => UUID | undefined,
    private readonly resolverVersion?: (versionId: UUID) => ReglasDeVersion | undefined,
  ) {}

  async arrancar(input: ArrancarWorkflowRunInput): Promise<ArrancarWorkflowRunResult> {
    // Igual que `arrancar_workflow_run`: la política se aplica sólo entre
    // corridas de producción, y una de Probar no pasa por ella.
    const vivas = esContextoDePrueba(input.contexto)
      ? []
      : this.vivasDelMismoWorkflow(input.versionId, input.leadId);
    const cancelados: UUID[] = [];
    if (vivas.length > 0) {
      const { politica } = this.reglasDe(input.versionId);
      if (politica === "ignorar") {
        return { run: null, motivo: "ya_hay_corrida_viva", cancelados };
      }
      if (politica === "reiniciar") {
        // Todas, igual que el UPDATE set-based de `arrancar_workflow_run`.
        for (const viva of vivas) {
          cancelados.push(viva.id);
          this.actualizar(viva.id, {
            estado: "cancelado",
            ended_at: new Date(),
            error: "reiniciado por un disparo nuevo",
          });
        }
      }
    }

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
    return { run: clonarRun(run), cancelados };
  }

  async esperandoOpcion(
    leadId: UUID,
    respondeA: string | null,
  ): Promise<{ runId: UUID; workflowId: UUID } | null> {
    for (const r of this.runs.values()) {
      if (r.lead_id !== leadId || r.estado !== "esperando") continue;
      if (esContextoDePrueba(r.contexto)) continue;
      if (!esperaOpcionCoincide(r.contexto, respondeA)) continue;
      return {
        runId: r.id,
        workflowId: this.resolverWorkflowId?.(r.workflow_version_id) ?? r.workflow_version_id,
      };
    }
    return null;
  }

  async registrarNoArrancada(
    input: ArrancarWorkflowRunInput,
    motivo: string,
  ): Promise<WorkflowRun> {
    const ahora = new Date();
    const run: WorkflowRun = {
      id: crypto.randomUUID(),
      workflow_version_id: input.versionId,
      lead_id: input.leadId,
      lead_session_id: input.sessionId,
      estado: "cancelado",
      nodo_actual: null,
      contexto: structuredClone(input.contexto),
      pasos_ejecutados: 0,
      error: motivo,
      started_at: ahora,
      ended_at: ahora,
    };
    this.runs.set(run.id, run);
    return clonarRun(run);
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
    // Mismo efecto que el trigger de Postgres: el paso saltado marca la corrida.
    const motivo = motivoSaltoDeSalida(fila.salida);
    if (motivo !== null) this.saltos.set(runId, motivo);
  }

  async avanzar(
    runId: UUID,
    nodoActual: string,
    contexto: Record<string, unknown>,
    pasos: number,
  ): Promise<void> {
    this.actualizarSiViva(runId, {
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
    this.actualizarSiViva(runId, {
      estado: "esperando",
      nodo_actual: nodoActual,
      contexto: structuredClone(contexto),
      pasos_ejecutados: pasos,
    });
  }

  async terminar(runId: UUID, pasos: number): Promise<void> {
    this.actualizarSiViva(runId, {
      estado: "terminado",
      pasos_ejecutados: pasos,
      ended_at: new Date(),
    });
  }

  async fallar(runId: UUID, error: string, pasos: number, intentos?: number): Promise<void> {
    this.actualizarSiViva(runId, {
      estado: "fallado",
      pasos_ejecutados: pasos,
      error,
      ended_at: new Date(),
      ...(intentos !== undefined ? { intentos } : {}),
    });
  }

  async corridasPorNodo(versionId: UUID, desde: Date): Promise<CorridasPorNodo> {
    const runs = [...this.runs.values()].filter(
      (r) =>
        r.workflow_version_id === versionId &&
        r.started_at.getTime() >= desde.getTime() &&
        !esContextoDePrueba(r.contexto),
    );
    const porNodo = new Map<
      string,
      { corridas: Set<UUID>; fallaron: Set<UUID>; esperando: number }
    >();
    const de = (nodoId: string) => {
      const actual = porNodo.get(nodoId) ?? {
        corridas: new Set<UUID>(),
        fallaron: new Set<UUID>(),
        esperando: 0,
      };
      porNodo.set(nodoId, actual);
      return actual;
    };
    for (const r of runs) {
      for (const p of this.pasos.get(r.id) ?? []) {
        de(p.nodo_id).corridas.add(r.id);
        if (p.error !== null) de(p.nodo_id).fallaron.add(r.id);
      }
      if (r.estado === "esperando" && r.nodo_actual !== null) de(r.nodo_actual).esperando += 1;
    }
    return {
      corridas: runs.length,
      vivas: runs.filter((r) => ESTADOS_VIVOS.includes(r.estado)).length,
      nodos: [...porNodo.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([nodoId, v]) => ({
          nodoId,
          corridas: v.corridas.size,
          fallaron: v.fallaron.size,
          esperando: v.esperando,
        })),
    };
  }

  async cancelarSiViva(runId: UUID, motivo: string): Promise<CancelarWorkflowRunResult> {
    const run = this.runs.get(runId);
    if (!run) return { ok: false, motivo: "corrida_no_encontrada" };
    if (!ESTADOS_VIVOS.includes(run.estado)) return { ok: false, motivo: "corrida_no_viva" };
    this.actualizar(runId, { estado: "cancelado", error: motivo, ended_at: new Date() });
    return { ok: true };
  }

  async cancelar(runId: UUID, motivo: string, pasos: number): Promise<void> {
    this.actualizarSiViva(runId, {
      estado: "cancelado",
      pasos_ejecutados: pasos,
      error: motivo,
      ended_at: new Date(),
    });
  }

  async fallarSiVivo(
    runId: UUID,
    error: string,
    desdePaso: number,
    intentos?: number,
  ): Promise<boolean> {
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
      ...(intentos !== undefined ? { intentos } : {}),
    });
    return true;
  }

  async reanudar(runId: UUID): Promise<ReanudarWorkflowRunResult> {
    // Mismas preguntas y en el mismo orden que `reanudar_workflow_run`.
    const run = this.runs.get(runId);
    if (!run) return { ok: false, motivo: "corrida_no_encontrada" };
    if (run.estado !== "fallado") return { ok: false, motivo: "corrida_no_fallada" };
    if (esContextoDePrueba(run.contexto)) return { ok: false, motivo: "corrida_de_prueba" };

    const ultimo = (this.pasos.get(runId) ?? []).reduce<WorkflowRunPaso | null>(
      (max, p) => (max === null || p.orden > max.orden ? p : max),
      null,
    );
    if (ultimo === null || ultimo.error === null) return { ok: false, motivo: "sin_paso_fallado" };

    const reglas = this.reglasDe(run.workflow_version_id);
    if (ultimo.orden >= reglas.maxPasos) return { ok: false, motivo: "tope_pasos" };
    if (
      reglas.politica !== "permitir" &&
      this.vivasDelMismoWorkflow(run.workflow_version_id, run.lead_id, run.id).length > 0
    ) {
      return { ok: false, motivo: "ya_hay_corrida_viva" };
    }

    this.actualizar(runId, {
      estado: "esperando",
      nodo_actual: ultimo.nodo_id,
      pasos_ejecutados: ultimo.orden,
      error: null,
      ended_at: null,
    });
    return { ok: true, desdePaso: ultimo.orden, nodoId: ultimo.nodo_id };
  }

  async relanzar(runId: UUID): Promise<RelanzarWorkflowRunResult> {
    const run = this.runs.get(runId);
    if (!run) return { run: null, motivo: "corrida_no_encontrada", cancelados: [] };
    if (run.estado !== "fallado") {
      return { run: null, motivo: "corrida_no_fallada", cancelados: [] };
    }
    if (esContextoDePrueba(run.contexto)) {
      return { run: null, motivo: "corrida_de_prueba", cancelados: [] };
    }
    // Postgres elige la sesión abierta del lead; acá no hay sesiones y se
    // reusa la de la corrida.
    return this.arrancar({
      versionId: run.workflow_version_id,
      leadId: run.lead_id,
      sessionId: run.lead_session_id,
      contexto: run.contexto,
    });
  }

  async findRun(id: UUID): Promise<WorkflowRun | null> {
    const run = this.runs.get(id);
    return run ? clonarRun(run) : null;
  }

  async metricasPorWorkflow(
    workflowIds: readonly UUID[],
    desde: Date,
  ): Promise<Record<UUID, WorkflowMetricas>> {
    const buscados = new Set(workflowIds);
    const acumulado = new Map<
      UUID,
      { total: number; exitosos: number; ultimo: WorkflowMetricas["ultimoRun"] }
    >();

    for (const run of this.runs.values()) {
      if (run.started_at < desde) continue;
      // Mismo fallback que el escopeo de "corrida viva" del constructor: sin
      // resolver, `workflow_version_id` hace de workflow id (sirve para tests
      // que no le importa la distinción versión/workflow).
      const workflowId =
        this.resolverWorkflowId?.(run.workflow_version_id) ?? run.workflow_version_id;
      if (!buscados.has(workflowId)) continue;

      const actual = acumulado.get(workflowId) ?? { total: 0, exitosos: 0, ultimo: null };
      const exito = run.estado === "terminado" && run.error === null;
      actual.total += 1;
      if (exito) actual.exitosos += 1;
      // `>=` y no `>`: en un empate (mismo milisegundo, insert-only test o dos
      // corridas que arrancaron juntas) gana la que se procesa después, en vez
      // de congelarse en la primera que llegó -- el orden de iteración del
      // `Map` es el de inserción, así que "después" es "más nueva" en la
      // práctica.
      if (!actual.ultimo || run.started_at >= actual.ultimo.at) {
        actual.ultimo = {
          at: run.started_at,
          exito,
          duracionMs: run.ended_at ? run.ended_at.getTime() - run.started_at.getTime() : null,
        };
      }
      acumulado.set(workflowId, actual);
    }

    const resultado: Record<UUID, WorkflowMetricas> = {};
    for (const [id, v] of acumulado) {
      resultado[id] = { totalRuns: v.total, runsExitosos: v.exitosos, ultimoRun: v.ultimo };
    }
    return resultado;
  }

  async contarVivasPorVersion(workflowId: UUID): Promise<CorridasVivasDeVersion[]> {
    const porVersion = new Map<UUID, number>();
    for (const run of this.runs.values()) {
      if (!ESTADOS_VIVOS.includes(run.estado)) continue;
      // Mismo fallback que `metricasPorWorkflow`.
      const wid = this.resolverWorkflowId?.(run.workflow_version_id) ?? run.workflow_version_id;
      if (wid !== workflowId) continue;
      porVersion.set(run.workflow_version_id, (porVersion.get(run.workflow_version_id) ?? 0) + 1);
    }
    return [...porVersion].map(([versionId, cantidad]) => ({ versionId, cantidad }));
  }

  /**
   * Las corridas vivas del lead en el mismo workflow que `versionId`. Con el
   * lookup inyectado escopea por workflow, como el join de Postgres; sin él,
   * por lead a secas (el fallback histórico del constructor).
   */
  /** Corridas de producción vivas: las de Probar no cuentan para la política. */
  private vivasDelMismoWorkflow(versionId: UUID, leadId: UUID, exceptoRunId?: UUID): WorkflowRun[] {
    const workflowId = this.resolverWorkflowId?.(versionId);
    return [...this.runs.values()].filter((r) => {
      if (r.id === exceptoRunId) return false;
      if (r.lead_id !== leadId) return false;
      if (esContextoDePrueba(r.contexto)) return false;
      if (!ESTADOS_VIVOS.includes(r.estado)) return false;
      if (this.resolverWorkflowId === undefined) return true;
      return this.resolverWorkflowId(r.workflow_version_id) === workflowId;
    });
  }

  private reglasDe(versionId: UUID): ReglasDeVersion {
    return (
      this.resolverVersion?.(versionId) ?? {
        maxPasos: Number.POSITIVE_INFINITY,
        politica: "ignorar",
      }
    );
  }

  /** Ver el bloque de `avanzar` en la interfaz: una corrida cerrada no se reescribe. */
  private actualizarSiViva(runId: UUID, cambios: Partial<WorkflowRun>): void {
    const run = this.runs.get(runId);
    if (!run) throw new NotFoundError(`corrida no encontrada: ${runId}`, "workflow_run", runId);
    if (!ESTADOS_VIVOS.includes(run.estado)) return;
    this.runs.set(runId, { ...run, ...cambios });
  }

  private actualizar(runId: UUID, cambios: Partial<WorkflowRun>): void {
    const run = this.runs.get(runId);
    if (!run) throw new NotFoundError(`corrida no encontrada: ${runId}`, "workflow_run", runId);
    this.runs.set(runId, { ...run, ...cambios });
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
    let runs = [...this.runs.values()].filter((r) => {
      const wid = this.resolverWorkflowId?.(r.workflow_version_id) ?? r.workflow_version_id;
      return wid === workflowId;
    });

    // Aplicar filtros
    if (filtros.estado && filtros.estado !== "todos") {
      runs = runs.filter((r) => r.estado === filtros.estado);
    }
    if (filtros.fechaDesde) {
      runs = runs.filter((r) => r.started_at >= filtros.fechaDesde!);
    }
    if (filtros.fechaHasta) {
      runs = runs.filter((r) => r.started_at <= filtros.fechaHasta!);
    }
    if (filtros.leadId) {
      runs = runs.filter((r) => r.lead_id === filtros.leadId);
    }

    // Ordenar por fecha descendente
    runs.sort((a, b) => b.started_at.getTime() - a.started_at.getTime());

    const total = runs.length;

    // Aplicar cursor
    if (cursor) {
      const cursorDate = new Date(cursor);
      runs = runs.filter((r) => r.started_at < cursorDate);
    }

    // Paginar
    const paginados = runs.slice(0, PAGE_SIZE);
    const nextCursor =
      paginados.length === PAGE_SIZE ? paginados.at(-1)?.started_at.toISOString() : null;

    return {
      runs: paginados.map((r) => this.mapRunConLead(r)),
      nextCursor: nextCursor ?? null,
      total,
    };
  }

  async detalleRun(runId: UUID): Promise<WorkflowRunDetalle | null> {
    const run = this.runs.get(runId);
    if (!run) return null;

    const pasos = this.pasos.get(runId) ?? [];
    return {
      ...this.mapRunConLead(run),
      pasos: pasos.sort((a, b) => a.orden - b.orden),
      version_numero: 1,
      version_actual: true,
    };
  }

  async pasosDeRun(runId: UUID): Promise<WorkflowRunPaso[]> {
    const pasos = this.pasos.get(runId) ?? [];
    return pasos.sort((a, b) => a.orden - b.orden);
  }

  async contarSaltosPorMotivo(desde: Date): Promise<Record<MotivoSalto, number>> {
    const conteo = saltosEnCero();
    for (const [runId, lista] of this.pasos) {
      const run = this.runs.get(runId);
      if (!run || esContextoDePrueba(run.contexto)) continue;
      for (const paso of lista) {
        const motivo = motivoSaltoDeSalida(paso.salida);
        if (motivo !== null && paso.created_at >= desde) conteo[motivo] += 1;
      }
    }
    return conteo;
  }

  private mapRunConLead(run: WorkflowRun): WorkflowRunConLead {
    return {
      ...clonarRun(run),
      motivo_salto: this.saltos.get(run.id) ?? null,
      lead_nombre: null,
      trigger_tipo: "manual",
      trigger_datos: {},
      duracion_ms: run.ended_at ? run.ended_at.getTime() - run.started_at.getTime() : null,
    };
  }
}

function clonarRun(run: WorkflowRun): WorkflowRun {
  return { ...run, contexto: structuredClone(run.contexto) };
}
