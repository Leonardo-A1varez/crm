import {
  ConflictError,
  IllegalStateError,
  InfraError,
  NotFoundError,
  type DomainError,
} from "@/lib/errors";
import { nodoPorId } from "@/lib/workflows/recorrer";
import {
  esContextoDePrueba,
  motivoSaltoDeSalida,
  type Grafo,
  type NodoTipo,
} from "@/types/workflows";
import type { LeadVehiculosRepository } from "@/server/repositories/lead-vehiculos.repo";
import type { LeadsRepository } from "@/server/repositories/leads.repo";
import type { MessagesRepository } from "@/server/repositories/messages.repo";
import type {
  CorridasPorNodo,
  ReanudarWorkflowRunMotivo,
  RelanzarWorkflowRunMotivo,
  WorkflowRunsRepository,
} from "@/server/repositories/workflow-runs.repo";
import type { WorkflowsRepository } from "@/server/repositories/workflows.repo";
import { ADMIN_ACTIONS, type AdminAuditService } from "@/server/services/admin-audit.service";
import type { LeadVehiculo, UUID, WorkflowRun, WorkflowRunPaso } from "@/types/entities";
import { accionDeNodo } from "./acciones/registro";

/**
 * Una corrida vista desde la pantalla "corrida en vivo" (CorridaEnVivo) y las
 * dos maneras de volver a lanzarla cuando falló (PreviaReanudacion), que nunca
 * se llaman igual porque no hacen lo mismo:
 *
 * - **Reanudar desde el fallo**: la MISMA corrida sigue desde el nodo del paso
 *   que falló, nunca desde el disparador. Lo anterior se reusa, no se repite.
 * - **Ejecutar de nuevo desde el principio**: una corrida NUEVA de la misma
 *   versión, con el mismo contexto de arranque. Todo lo que mandaba algo se
 *   vuelve a mandar, y la previa lo enumera uno por uno.
 *
 * Las dos corren sobre la versión con la que arrancó la corrida fallada: es la
 * regla de "publicar no toca las corridas", aplicada también a volver a
 * lanzarlas. Aplicar un arreglo publicado después sería una tercera acción.
 *
 * Ninguna de las dos ejecuta nada acá: dejan la corrida lista en la base y
 * encolan el segmento en Inngest, que lo corre con el mismo `segmentoHandler`
 * de siempre.
 */

/**
 * El evento que encola un segmento (`workflow/segmento.pendiente`). `id` es la
 * clave de deduplicación de Inngest: la decide este servicio, porque de ella
 * depende que una reanudación no se descarte como duplicada.
 */
export interface EventoSegmento {
  runId: UUID;
  desdePaso: number;
  id: string;
}

export type EmitirSegmento = (evento: EventoSegmento) => Promise<void>;

/**
 * Avisa a Inngest que la corrida se canceló (`workflow/corrida.cancelada`):
 * corta en el acto el segmento que esté dormido en una espera. Lo arma el
 * bootstrap, por la misma razón que `EmitirSegmento`.
 */
export type EmitirCancelacion = (runId: UUID) => Promise<void>;

export type EstadoNodoCorrida = "completado" | "activo" | "saltado" | "fallado" | "pendiente";

export interface EjecucionDeNodo {
  orden: number;
  /** Cuándo terminó el paso: `workflow_run_pasos.created_at`. */
  at: Date;
  salida: Record<string, unknown> | null;
  error: string | null;
}

export interface NodoDeCorrida {
  nodoId: string;
  tipo: NodoTipo;
  estado: EstadoNodoCorrida;
  /** Cuántas veces corrió. Con ciclos puede ser más de una. */
  ejecuciones: number;
  /** Su última ejecución. `null` si la corrida no llegó a este nodo. */
  ultima: EjecucionDeNodo | null;
}

/** Por qué no se ofrece reanudar. Si hay otra corrida viva lo decide la base al reanudar. */
export type MotivoSinReanudar =
  | "corrida_no_fallada"
  | "corrida_de_prueba"
  | "sin_paso_fallado"
  | "tope_pasos";

export type PreviaReanudar =
  | {
      posible: true;
      /** El nodo que vuelve a correr: el del paso que falló. */
      desdeNodo: string;
      desdePaso: number;
      /** Los que ya terminaron bien antes del fallo: su resultado se reusa, con la hora en que salió. */
      reusados: { nodoId: string; orden: number; at: Date }[];
      /** Los que vuelven a correr: el que falló. Lo que venga después corre por primera vez. */
      reejecuta: { nodoId: string; ordenFallado: number; error: string }[];
    }
  | { posible: false; motivo: MotivoSinReanudar };

export interface EnvioQueSeRepite {
  nodoId: string;
  orden: number;
  enviadoAt: Date;
  mensajeId: UUID;
  /** Lo que salió, tal cual. `null` si el mensaje ya no se puede leer (purga de sesiones). */
  texto: string | null;
}

export type PreviaEjecutarDeNuevo =
  | {
      posible: true;
      /** A quién le llegan de nuevo. */
      destinatario: { leadId: UUID; nombre: string | null };
      /** Cada mensaje que la corrida ya mandó y que volvería a salir si repite el recorrido. */
      envios: EnvioQueSeRepite[];
    }
  | { posible: false; motivo: "corrida_no_fallada" | "corrida_de_prueba" };

/** Todo lo que pinta CorridaEnVivo, en una sola lectura. */
export interface VistaCorrida {
  run: WorkflowRun;
  /** Corrida de "Probar": corrió con los efectos interceptados. */
  esPrueba: boolean;
  workflow: { id: UUID; nombre: string };
  /** La versión con la que corre: la pinneada, no la publicada hoy. */
  version: { id: UUID; numero: number; grafo: Grafo; maxPasos: number; publicada: boolean };
  lead: {
    id: UUID;
    nombre: string | null;
    /** El vehículo principal, como se lee: "Hilux 2018". `null` si el lead no tiene. */
    vehiculo: string | null;
  };
  /**
   * Lo que la corrida mandó, en orden. Se busca por la clave con que lo mandó
   * (`mensajes.idempotency_key = wf:<runId>:<orden>`). Una corrida de Probar
   * no mandó nada: trae lo que habría mandado, con `simulado`.
   */
  mensajes: MensajeDeCorrida[];
  /** Por dónde pasaron las corridas de producción de ESTA versión en 30 días. */
  porNodo: CorridasPorNodo;
  /** Una fila por ejecución, en orden. Un nodo que corrió dos veces aparece dos veces. */
  pasos: WorkflowRunPaso[];
  /** Una por nodo del grafo, en el orden en que la corrida los dejó; los no alcanzados al final. */
  nodos: NodoDeCorrida[];
  reanudar: PreviaReanudar;
  ejecutarDeNuevo: PreviaEjecutarDeNuevo;
}

export interface MensajeDeCorrida {
  nodoId: string;
  orden: number;
  /** `null` si el mensaje ya no se puede leer (purga de sesiones a los 29 días). */
  texto: string | null;
  /** Estado de entrega de Meta. `null` si todavía no reportó, o si es simulado. */
  estado: string | null;
  at: Date;
  simulado: boolean;
}

/** La ventana de "por dónde pasan las corridas": la misma de las métricas del listado. */
const VENTANA_POR_NODO_MS = 30 * 24 * 60 * 60 * 1000;

export interface CorridaReanudada {
  runId: UUID;
  desdePaso: number;
  nodoId: string;
}

export interface CorridasWorkflowService {
  /** `null` si la corrida no existe (o RLS no la deja ver). */
  vista(runId: UUID): Promise<VistaCorrida | null>;
  reanudar(runId: UUID): Promise<CorridaReanudada>;
  /** Devuelve la corrida NUEVA. */
  ejecutarDeNuevo(runId: UUID): Promise<{ runId: UUID }>;
  /**
   * "Cancelar corrida": la pasa a `cancelado` si sigue viva, de producción o
   * de Probar, audita quién la canceló y avisa a Inngest para que corte ya el
   * segmento dormido en una espera. Una con el segmento en vuelo no ejecuta la
   * acción siguiente (el segmento relee su estado antes de cada acción).
   */
  cancelar(runId: UUID, actorUserId: UUID | null): Promise<void>;
}

/** Lo que queda escrito en `workflow_runs.error` de una corrida cancelada a mano. */
export const MOTIVO_CANCELADA_A_MANO = "Cancelada a mano desde el panel.";

export interface CorridasWorkflowDeps {
  workflows: Pick<WorkflowsRepository, "findVersion" | "findWorkflow">;
  runs: Pick<
    WorkflowRunsRepository,
    | "findRun"
    | "pasosDeRun"
    | "reanudar"
    | "relanzar"
    | "fallarSiVivo"
    | "cancelarSiViva"
    | "corridasPorNodo"
  >;
  leads: Pick<LeadsRepository, "findById">;
  vehiculos: Pick<LeadVehiculosRepository, "listByLeadId">;
  messages: Pick<MessagesRepository, "findById" | "findByIdempotencyKey">;
  emitirSegmento: EmitirSegmento;
  emitirCancelacion: EmitirCancelacion;
  audit: Pick<AdminAuditService, "recordAction">;
  /** Sufijo único del id de evento de una reanudación. Inyectable para tests. */
  nuevoId?: () => string;
}

export class DefaultCorridasWorkflowService implements CorridasWorkflowService {
  constructor(private readonly deps: CorridasWorkflowDeps) {}

  async vista(runId: UUID): Promise<VistaCorrida | null> {
    const run = await this.deps.runs.findRun(runId);
    if (!run) return null;

    const version = await this.deps.workflows.findVersion(run.workflow_version_id);
    if (!version) {
      // `workflow_runs.workflow_version_id` es ON DELETE RESTRICT: no debería pasar nunca.
      throw new IllegalStateError(
        `la corrida ${run.id} apunta a una versión que no existe`,
        "version_ausente",
      );
    }
    const [workflow, lead, pasos, vehiculos, porNodo] = await Promise.all([
      this.deps.workflows.findWorkflow(version.workflow_id),
      this.deps.leads.findById(run.lead_id),
      this.deps.runs.pasosDeRun(run.id),
      this.deps.vehiculos.listByLeadId(run.lead_id),
      this.deps.runs.corridasPorNodo(version.id, new Date(Date.now() - VENTANA_POR_NODO_MS)),
    ]);
    if (!workflow) {
      throw new IllegalStateError(
        `la versión ${version.id} apunta a un workflow que no existe`,
        "workflow_ausente",
      );
    }
    const nombre = lead ? lead.nombre || lead.nombre_perfil || null : null;

    return {
      run,
      esPrueba: esContextoDePrueba(run.contexto),
      workflow: { id: workflow.id, nombre: workflow.nombre },
      version: {
        id: version.id,
        numero: version.version,
        grafo: version.grafo,
        maxPasos: version.max_pasos,
        publicada: version.publicada,
      },
      lead: { id: run.lead_id, nombre, vehiculo: vehiculoLegible(vehiculos[0]) },
      mensajes: await this.mensajesDeCorrida(run, pasos, version.grafo),
      porNodo,
      pasos,
      nodos: nodosDeCorrida(version.grafo, run, pasos),
      reanudar: previaReanudar(run, pasos, version.max_pasos),
      ejecutarDeNuevo: await this.previaEjecutarDeNuevo(run, pasos, version.grafo, nombre),
    };
  }

  /**
   * Deja la corrida esperando en el nodo que falló (lo decide la base, con el
   * mismo lock que un disparo: `reanudar_workflow_run`) y encola el segmento.
   *
   * El id del evento NO es `workflow-segmento-pendiente:<runId>:<desdePaso>`:
   * ese es el del segmento que ya corrió con ese `desdePaso`, Inngest
   * deduplica por id, y reusarlo haría que descartara la reanudación y la
   * corrida quedara viva sin que nadie la tome. Una reanudación es un evento
   * nuevo; que haya una sola por fallo lo asegura el compare-and-swap de la
   * base, no el id.
   */
  async reanudar(runId: UUID): Promise<CorridaReanudada> {
    const r = await this.deps.runs.reanudar(runId);
    if (!r.ok) throw errorDeReanudar(runId, r.motivo);

    await this.encolar(
      {
        runId,
        desdePaso: r.desdePaso,
        id: `workflow-segmento-reanudado:${runId}:${r.desdePaso}:${this.nuevoId()}`,
      },
      "no se pudo reanudar la corrida",
    );
    return { runId, desdePaso: r.desdePaso, nodoId: r.nodoId };
  }

  /**
   * Arranca la corrida nueva (`relanzar_workflow_run`, con la política de
   * concurrencia de un disparo) y encola su primer segmento con el mismo id que
   * usa `workflow-disparar` para una corrida recién arrancada.
   */
  async ejecutarDeNuevo(runId: UUID): Promise<{ runId: UUID }> {
    const r = await this.deps.runs.relanzar(runId);
    // "Reiniciar" pudo cancelar otra corrida viva del lead: se avisa aunque la
    // nueva no haya arrancado, para que su espera no siga dormida en Inngest.
    for (const cancelada of r.cancelados) await this.deps.emitirCancelacion(cancelada);
    if (!r.run) throw errorDeRelanzar(runId, r.motivo);

    await this.encolar(
      { runId: r.run.id, desdePaso: 0, id: `workflow-segmento-pendiente:${r.run.id}:0` },
      "no se pudo arrancar la corrida nueva",
    );
    return { runId: r.run.id };
  }

  /**
   * Orden: CAS, auditoría, aviso a Inngest.
   *
   * - La auditoría va DESPUÉS del CAS, al revés que el borrado de etiquetas:
   *   una cancelación que no ocurrió (la corrida ya había cerrado) no deja una
   *   fila que diga que alguien la canceló. Si el insert de auditoría falla, la
   *   acción devuelve error aunque la corrida ya esté cancelada.
   * - El payload no lleva nada del lead (ni su id ni el contexto, que puede
   *   tener su nombre): versión, estado previo y si era de Probar.
   * - Si el aviso a Inngest falla, la corrida ya está cancelada y auditada: el
   *   segmento dormido sale solo al vencer (`tomarSegmento` la ve cerrada). Se
   *   dice igual, con un `InfraError` que la pantalla muestra.
   */
  async cancelar(runId: UUID, actorUserId: UUID | null): Promise<void> {
    const previa = await this.deps.runs.findRun(runId);
    const r = await this.deps.runs.cancelarSiViva(runId, MOTIVO_CANCELADA_A_MANO);
    if (!r.ok) {
      if (r.motivo === "corrida_no_encontrada") {
        throw new NotFoundError(`corrida no encontrada: ${runId}`, "workflow_run", runId);
      }
      throw new IllegalStateError(
        "La corrida ya terminó: no hay nada que cancelar.",
        "corrida_no_viva",
      );
    }

    await this.deps.audit.recordAction({
      actorUserId,
      action: ADMIN_ACTIONS.WORKFLOW_RUN_CANCEL,
      entityType: "workflow_run",
      entityId: runId,
      payload: {
        version_id: previa?.workflow_version_id ?? null,
        estado_previo: previa?.estado ?? null,
        prueba: previa ? esContextoDePrueba(previa.contexto) : null,
      },
    });

    try {
      await this.deps.emitirCancelacion(runId);
    } catch (error) {
      throw new InfraError(
        "La corrida quedó cancelada, pero no se pudo cortar su espera: se va a cerrar sola cuando venza.",
        "inngest",
        error,
      );
    }
  }

  /**
   * Sin el evento nadie toma la corrida: quedaría viva para siempre y, con la
   * política por defecto, bloquearía los disparos de ese flujo para el lead. Si
   * no se puede encolar se la vuelve a cerrar con el mismo CAS que usa el
   * `onFailure` del segmento: no pisa nada si alguien la tomó mientras tanto.
   */
  private async encolar(evento: EventoSegmento, queFallo: string): Promise<void> {
    try {
      await this.deps.emitirSegmento(evento);
    } catch (error) {
      const detalle = error instanceof Error ? error.message : String(error);
      const cerrada = await this.deps.runs.fallarSiVivo(
        evento.runId,
        `${queFallo}: ${detalle}`,
        evento.desdePaso,
      );
      throw new InfraError(
        cerrada
          ? `${queFallo}: ${detalle}`
          : `${queFallo}: ${detalle} (y la corrida ya no estaba viva para cerrarla)`,
        "inngest",
        error,
      );
    }
  }

  private async mensajesDeCorrida(
    run: WorkflowRun,
    pasos: readonly WorkflowRunPaso[],
    grafo: Grafo,
  ): Promise<MensajeDeCorrida[]> {
    const envios = pasos.filter((p) => {
      const nodo = nodoPorId(grafo, p.nodo_id);
      const accion = nodo ? accionDeNodo(nodo) : undefined;
      return accion === "enviar_mensaje" || accion === "enviar_plantilla";
    });
    if (esContextoDePrueba(run.contexto)) {
      return envios.flatMap((p) =>
        textosSimulados(p).map((texto) => ({
          nodoId: p.nodo_id,
          orden: p.orden,
          texto,
          estado: null,
          at: p.created_at,
          simulado: true,
        })),
      );
    }
    // Por la clave y no por `salida.mensaje_id`: un envío que falló después de
    // reservar la fila no dejó id en la salida, pero sí existe el mensaje.
    const encontrados = await Promise.all(
      envios.map(async (p) => ({
        paso: p,
        mensaje: await this.deps.messages.findByIdempotencyKey(`wf:${run.id}:${p.orden}`),
      })),
    );
    return encontrados.flatMap(({ paso, mensaje }) =>
      mensaje
        ? [
            {
              nodoId: paso.nodo_id,
              orden: paso.orden,
              texto: mensaje.contenido,
              estado: mensaje.estado_entrega,
              at: mensaje.created_at,
              simulado: false,
            },
          ]
        : [],
    );
  }

  private nuevoId(): string {
    return this.deps.nuevoId?.() ?? crypto.randomUUID();
  }

  private async previaEjecutarDeNuevo(
    run: WorkflowRun,
    pasos: readonly WorkflowRunPaso[],
    grafo: Grafo,
    nombre: string | null,
  ): Promise<PreviaEjecutarDeNuevo> {
    if (run.estado !== "fallado") return { posible: false, motivo: "corrida_no_fallada" };
    if (esContextoDePrueba(run.contexto)) return { posible: false, motivo: "corrida_de_prueba" };

    // Sólo lo que de verdad salió: un envío diferido por horario todavía no
    // mandó nada, y uno fallado tampoco.
    const salidos = pasos.flatMap((p) => {
      const mensajeId = mensajeIdDe(p);
      if (p.error !== null || mensajeId === null) return [];
      const nodo = nodoPorId(grafo, p.nodo_id);
      return nodo && accionDeNodo(nodo) === "enviar_mensaje" ? [{ paso: p, mensajeId }] : [];
    });
    const envios = await Promise.all(
      salidos.map(async ({ paso, mensajeId }): Promise<EnvioQueSeRepite> => {
        const mensaje = await this.deps.messages.findById(mensajeId);
        return {
          nodoId: paso.nodo_id,
          orden: paso.orden,
          enviadoAt: paso.created_at,
          mensajeId,
          texto: mensaje?.contenido ?? null,
        };
      }),
    );
    return { posible: true, destinatario: { leadId: run.lead_id, nombre }, envios };
  }
}

/** "Hilux 2018", como lo escribe el diseño; sin modelo, la marca. */
function vehiculoLegible(v: LeadVehiculo | undefined): string | null {
  if (!v) return null;
  const nombre = v.modelo ?? v.marca;
  if (!nombre) return null;
  return v.anio !== null ? `${nombre} ${v.anio}` : nombre;
}

/** Lo que una prueba habría mandado: `salida.simulado[].detalle.texto`. */
function textosSimulados(paso: WorkflowRunPaso): string[] {
  const simulado = paso.salida?.["simulado"];
  if (!Array.isArray(simulado)) return [];
  return simulado.flatMap((e: unknown) => {
    const detalle = (e as { detalle?: { texto?: unknown } } | null)?.detalle;
    return typeof detalle?.texto === "string" ? [detalle.texto] : [];
  });
}

/** `enviar_mensaje` deja en la salida del paso el id del mensaje que mandó. */
function mensajeIdDe(paso: WorkflowRunPaso): string | null {
  const id = paso.salida?.["mensaje_id"];
  return typeof id === "string" ? id : null;
}

function estadoDeNodo(
  nodoId: string,
  run: WorkflowRun,
  ultima: WorkflowRunPaso | undefined,
): EstadoNodoCorrida {
  if (run.estado === "esperando" && run.nodo_actual === nodoId) return "activo";
  if (!ultima) return "pendiente";
  if (ultima.error !== null) return "fallado";
  // Un tope de seguridad lo salto: el lead salio del flujo aca. No es un
  // fallo y no se pinta como tal (PRD 6.6).
  return motivoSaltoDeSalida(ultima.salida) !== null ? "saltado" : "completado";
}

/**
 * El estado de cada nodo del grafo, para pintar el lienzo. Con ciclos un nodo
 * corre varias veces: cuenta su última ejecución.
 *
 * - `activo`: la corrida espera para correr ese nodo (`nodo_actual` de una
 *   corrida `esperando`): el que sigue a una espera, una acción diferida por
 *   horario, o el nodo fallado de una corrida reanudada. Una corrida
 *   `corriendo` no marca ninguno: el segmento está ejecutando y sus pasos
 *   llegan por Realtime a medida que terminan.
 * - `fallado` / `completado`: cómo terminó su última ejecución.
 * - `saltado`: un tope de seguridad saltó el mensaje y el lead salió del flujo.
 * - `pendiente`: la corrida no llegó.
 *
 * Orden: por la última ejecución, que es el orden en que la corrida los dejó;
 * los pendientes al final, en el orden del grafo (`sort` es estable).
 */
function nodosDeCorrida(
  grafo: Grafo,
  run: WorkflowRun,
  pasos: readonly WorkflowRunPaso[],
): NodoDeCorrida[] {
  const porNodo = new Map<string, WorkflowRunPaso[]>();
  for (const p of pasos) {
    const lista = porNodo.get(p.nodo_id) ?? [];
    lista.push(p);
    porNodo.set(p.nodo_id, lista);
  }

  const nodos = grafo.nodos.map((n): NodoDeCorrida => {
    const ejecuciones = porNodo.get(n.id) ?? [];
    const ultima = ejecuciones.at(-1);
    return {
      nodoId: n.id,
      tipo: n.tipo,
      estado: estadoDeNodo(n.id, run, ultima),
      ejecuciones: ejecuciones.length,
      ultima: ultima
        ? { orden: ultima.orden, at: ultima.created_at, salida: ultima.salida, error: ultima.error }
        : null,
    };
  });

  const orden = (n: NodoDeCorrida) => n.ultima?.orden ?? Number.POSITIVE_INFINITY;
  return nodos.sort((a, b) => (orden(a) === orden(b) ? 0 : orden(a) - orden(b)));
}

/**
 * Qué pasaría al reanudar. Las mismas preguntas, en el mismo orden, que
 * `reanudar_workflow_run` en la base —salvo "¿hay otra corrida viva?", que
 * sólo se puede contestar con el lock tomado, al reanudar—.
 */
function previaReanudar(
  run: WorkflowRun,
  pasos: readonly WorkflowRunPaso[],
  maxPasos: number,
): PreviaReanudar {
  if (run.estado !== "fallado") return { posible: false, motivo: "corrida_no_fallada" };
  if (esContextoDePrueba(run.contexto)) return { posible: false, motivo: "corrida_de_prueba" };

  const fallado = pasos.at(-1);
  if (!fallado || fallado.error === null) return { posible: false, motivo: "sin_paso_fallado" };
  if (fallado.orden >= maxPasos) return { posible: false, motivo: "tope_pasos" };

  // La última ejecución que terminó bien de cada nodo antes del fallo. El nodo
  // que falló no se reusa aunque haya corrido bien antes: vuelve a correr.
  const reusados = new Map<string, { nodoId: string; orden: number; at: Date }>();
  for (const p of pasos) {
    if (p.error !== null || p.orden >= fallado.orden) continue;
    reusados.set(p.nodo_id, { nodoId: p.nodo_id, orden: p.orden, at: p.created_at });
  }
  reusados.delete(fallado.nodo_id);

  return {
    posible: true,
    desdeNodo: fallado.nodo_id,
    desdePaso: fallado.orden,
    reusados: [...reusados.values()].sort((a, b) => a.orden - b.orden),
    reejecuta: [{ nodoId: fallado.nodo_id, ordenFallado: fallado.orden, error: fallado.error }],
  };
}

function errorDeReanudar(runId: UUID, motivo: ReanudarWorkflowRunMotivo): DomainError {
  switch (motivo) {
    case "corrida_no_encontrada":
      return new NotFoundError(`corrida no encontrada: ${runId}`, "workflow_run", runId);
    case "corrida_no_fallada":
      return new IllegalStateError("Sólo se puede reanudar una corrida que falló.", motivo);
    case "corrida_de_prueba":
      return new IllegalStateError(
        "Es una corrida de prueba: no se reanuda con el motor de producción. Probá el flujo de nuevo.",
        motivo,
      );
    case "sin_paso_fallado":
      return new IllegalStateError(
        "La corrida falló antes de ejecutar un paso: no hay desde dónde reanudarla.",
        motivo,
      );
    case "tope_pasos":
      return new IllegalStateError(
        "La corrida llegó al tope de pasos de su versión: reanudarla volvería a cortarse.",
        motivo,
      );
    case "ya_hay_corrida_viva":
      return new ConflictError(
        "Ya hay otra corrida en curso de este flujo para este lead.",
        motivo,
      );
  }
}

function errorDeRelanzar(runId: UUID, motivo: RelanzarWorkflowRunMotivo | undefined): DomainError {
  switch (motivo) {
    case "corrida_no_encontrada":
      return new NotFoundError(`corrida no encontrada: ${runId}`, "workflow_run", runId);
    case "corrida_no_fallada":
      return new IllegalStateError(
        "Sólo se puede ejecutar de nuevo una corrida que falló.",
        motivo,
      );
    case "corrida_de_prueba":
      return new IllegalStateError(
        "Es una corrida de prueba: no se relanza con el motor de producción. Probá el flujo de nuevo.",
        motivo,
      );
    case "version_not_found":
      return new NotFoundError(
        `la versión de la corrida ${runId} no existe`,
        "workflow_version",
        runId,
      );
    case "ya_hay_corrida_viva":
      return new ConflictError(
        "Ya hay otra corrida en curso de este flujo para este lead.",
        motivo,
      );
    case undefined:
      return new InfraError("relanzar no arrancó la corrida y no dijo por qué", "postgrest");
  }
}
