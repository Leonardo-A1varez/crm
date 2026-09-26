import { ConflictError, IllegalStateError, NotFoundError, ValidationError } from "@/lib/errors";
import { derivarEstadoWorkflow } from "@/lib/ui/workflow-estado";
import { GrafoSchema } from "@/lib/validation/workflows.schema";
import { contextoDeDisparo } from "@/lib/workflows/contexto";
import { resumenPasos } from "@/lib/workflows/pasos";
import { disparadorDe, disparadorMatch } from "@/lib/workflows/recorrer";
import { validarGrafo } from "@/lib/workflows/validar-grafo";
import { problemasParaPublicar, type ProblemaPublicacion } from "@/lib/workflows/validar-workflow";
import {
  MARCA_CORRIDA_DE_PRUEBA,
  type Grafo,
  type MotivoFallo,
  type MotivoSalto,
} from "@/types/workflows";
import type { DifusionSupresionesRepository } from "@/server/repositories/difusion-supresiones.repo";
import type { LeadSessionRepository } from "@/server/repositories/lead-session.repo";
import type { LeadsRepository } from "@/server/repositories/leads.repo";
import type { WorkflowRunsRepository } from "@/server/repositories/workflow-runs.repo";
import type { WorkflowsRepository } from "@/server/repositories/workflows.repo";
import type { UUID, Workflow, WorkflowResumen, WorkflowVersion } from "@/types/entities";
import type { CamposVivosDeps } from "./ejecutor.service";
import { correrPrueba, sesionSimulada, type EfectoSimulado } from "./simulador.service";

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
  /**
   * "Ejecutar hasta acá": la prueba frena al llegar a este nodo, sin correrlo.
   * Tiene que ser un nodo del grafo. Si el recorrido no pasa por él, la prueba
   * corre entera.
   */
  hastaNodo?: string;
}

/**
 * Cómo terminó una prueba. No hay "esperando": la prueba saltea las esperas
 * con el reloj virtual y siempre termina.
 */
export type ResultadoProbar =
  | {
      tipo: "completado";
      pasos: number;
      /**
       * Un tope de seguridad saltó un mensaje y el lead salió del flujo (PRD
       * §6.6). Terminó: no es un fallo, y la corrida queda `terminado`.
       */
      salto?: { nodoId: string; motivo: MotivoSalto };
    }
  /** Frenó antes de `hastaNodo`. La corrida queda `cancelado`, con el motivo. */
  | { tipo: "detenido"; nodoId: string; pasos: number }
  /** Alguien canceló la corrida de prueba mientras corría. */
  | { tipo: "cancelado"; nodoId: string; pasos: number }
  | { tipo: "fallado"; nodoId: string | null; error: string; motivo: MotivoFallo | null };

export interface ProbarWorkflowResult {
  runId: UUID;
  resultado: ResultadoProbar;
  /** Cuántos mensajes le habría mandado al lead. */
  salientes: number;
}

/** Los mensajes que saltaron los topes de seguridad en una ventana. */
export interface SaltosRecientes {
  /** Desde cuándo se cuenta. */
  desde: Date;
  porMotivo: Record<MotivoSalto, number>;
}

/** Lo que se muestra en la pantalla de un workflow. */
export interface DetalleWorkflow {
  workflow: Workflow;
  /** De la versión más nueva a la más vieja. */
  versiones: WorkflowVersion[];
}

export interface CorridasVivasDeVersion {
  versionId: UUID;
  /** El número que se lee en pantalla: "v3". */
  version: number;
  cantidad: number;
}

/** Lo que pinta la pantalla "Publicar la versión N" (DiffPublicacion). */
export interface PreviaPublicacion {
  workflow: { id: UUID; nombre: string };
  /** La versión que se va a publicar. Su nota, si ya tenía una, precarga el campo. */
  nueva: Pick<WorkflowVersion, "id" | "version" | "grafo" | "nota" | "publicada">;
  /** La publicada hoy: contra ésta se dibuja el diff. `null` si nunca se publicó ninguna. */
  actual: Pick<WorkflowVersion, "id" | "version" | "grafo"> | null;
  /**
   * Las corridas vivas del workflow al momento de pedir la previa, de la
   * versión más nueva a la más vieja. Publicar no las mueve: cada una termina
   * en la versión donde arrancó, que puede no ser la publicada hoy.
   */
  corridasVivas: { total: number; porVersion: CorridasVivasDeVersion[] };
  /**
   * Lo que impide publicar esta versión, nodo por nodo. Vacío = publicable.
   * Es la misma revisión que vuelve a correr `publicar`.
   */
  problemas: ProblemaPublicacion[];
}

export interface WorkflowsAdminService {
  crear(input: { nombre: string; descripcion: string | null }): Promise<Workflow>;
  listar(): Promise<Workflow[]>;
  /** El workflow y todas sus versiones. `null` si el id no existe. */
  detalle(workflowId: UUID): Promise<DetalleWorkflow | null>;
  /** Valida el grafo y, sólo si está sano, lo guarda como versión nueva. */
  guardarVersion(input: GuardarVersionInput): Promise<WorkflowVersion>;
  /**
   * Publica la versión y despublica la anterior. Con `nota` la escribe en la
   * versión; sin nota —o en blanco—, la que tuviera queda. Las corridas en
   * curso no se tocan: terminan en la versión donde arrancaron.
   *
   * Un flujo con errores de configuración no se publica: `ValidationError`
   * con los problemas, nodo por nodo, en `issues`.
   */
  publicar(versionId: UUID, nota?: string | null): Promise<WorkflowVersion>;
  /**
   * Lo que muestra la pantalla antes de publicar: la versión nueva, la
   * publicada y las corridas vivas. `null` si la versión no existe.
   */
  previaPublicacion(versionId: UUID): Promise<PreviaPublicacion | null>;
  versionPublicada(workflowId: UUID): Promise<WorkflowVersion | null>;
  /** Todo lo que pinta una card del listado: estado, métricas de 30 días, resumen del flujo. */
  listarConResumen(): Promise<WorkflowResumen[]>;
  /**
   * Cuántos mensajes saltó cada tope de seguridad en los últimos `dias` (PRD
   * §6.6), contados en la base. Sin las corridas de "Probar".
   */
  saltosRecientes(dias: number, ahora?: Date): Promise<SaltosRecientes>;
  /** Copia nombre + descripción + la última versión guardada (si hay una) a un workflow nuevo, apagado. */
  duplicar(workflowId: UUID): Promise<Workflow>;
  pausar(workflowId: UUID): Promise<Workflow>;
  reanudar(workflowId: UUID): Promise<Workflow>;
  eliminar(workflowId: UUID): Promise<void>;
  /**
   * Una versión nueva, sin publicar, con el grafo, el tope y la política de
   * otra. El grafo se revalida con las reglas de hoy.
   */
  crearVersionDesde(versionId: UUID, userId: UUID | null): Promise<WorkflowVersion>;
  /**
   * Restaurar: copia una versión vieja a una versión NUEVA y la publica, en
   * una sola operación. No revive la fila vieja. Sin `nota`, la nueva dice de
   * qué versión salió.
   */
  rollbackAVersion(
    workflowId: UUID,
    versionId: UUID,
    userId: UUID | null,
    nota?: string | null,
  ): Promise<WorkflowVersion>;
  /**
   * Prueba el grafo actual del editor contra un lead real: guarda una versión
   * nueva (misma puerta que `guardarVersion`, misma validación) y la corre con
   * el motor y el registro de producción, con los efectos interceptados
   * (`correrPrueba`): no manda WhatsApp ni toca el lead, y persiste la corrida
   * y sus pasos en `workflow_runs`/`workflow_run_pasos`.
   */
  probar(input: ProbarWorkflowInput): Promise<ProbarWorkflowResult>;
}

export class DefaultWorkflowsAdminService implements WorkflowsAdminService {
  constructor(
    private readonly deps: {
      workflows: WorkflowsRepository;
      workflowRuns: WorkflowRunsRepository;
      leads: LeadsRepository;
      /**
       * Para que "Probar" corra con la sesión activa real del lead. Sin ella
       * la prueba usa la sesión que abriría un primer mensaje (`sesionSimulada`).
       */
      sessions?: Pick<LeadSessionRepository, "findActiveByLeadId">;
      /**
       * La lista de bajas real, para que "Probar" salte el mensaje a un lead
       * dado de baja igual que producción. Sin ella la prueba asume que no lo
       * está (`crearSandboxDePrueba`).
       */
      supresiones?: Pick<DifusionSupresionesRepository, "activasPorTelefonos">;
      /**
       * Los campos vivos de las condiciones (intent, etiquetas, vehículo…),
       * leídos de la base real: una prueba ramifica igual que producción. Sin
       * esto, esos campos quedan ausentes.
       */
      camposVivos?: CamposVivosDeps;
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
   * La única puerta por la que un grafo entra a la base (ver `grafoGuardable`).
   * Nada se guarda si algo falla: que la base sólo contenga grafos sanos es lo
   * que le permite a W2 ejecutar sin volver a validar en cada paso.
   */
  async guardarVersion(input: GuardarVersionInput): Promise<WorkflowVersion> {
    const grafo = this.grafoGuardable(input.grafo);
    const version = await this.deps.workflows.proximaVersion(input.workflowId);
    return this.deps.workflows.crearVersion({
      workflow_id: input.workflowId,
      version,
      grafo,
      max_pasos: input.maxPasos,
      created_by: input.userId,
    });
  }

  /**
   * Valida un grafo antes de que entre a la base: al guardarlo y también al
   * copiarlo de otra versión, que se guardó con las reglas de entonces.
   *
   * En dos etapas porque son dos preguntas distintas: primero la forma (Zod),
   * después el sentido (`validarGrafo`). Un grafo con un `tipo` inexistente ni
   * siquiera se puede recorrer, así que la forma va primero.
   */
  private grafoGuardable(grafo: Grafo): Grafo {
    const forma = GrafoSchema.safeParse(grafo);
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
    return forma.data;
  }

  async publicar(versionId: UUID, nota?: string | null): Promise<WorkflowVersion> {
    // Validar y después publicar no es una carrera: el grafo de una versión
    // no cambia después del INSERT (append-only, 20260913232000).
    const version = await this.versionExistente(versionId);
    this.publicable(version.grafo);
    return this.deps.workflows.publicarVersion(versionId, nota);
  }

  /**
   * La revisión de publicar: estructura + configuración de cada bloque
   * (`validarWorkflow`). Guardar exige menos —sólo estructura— porque un
   * borrador se guarda a medias; lo que se publica tiene que poder correr.
   * Antes esto sólo lo miraba un diálogo de la UI que nadie montaba.
   */
  private publicable(grafo: Grafo): void {
    const problemas = problemasParaPublicar(grafo);
    if (problemas.length === 0) return;
    const detalle = problemas
      .map((p) => (p.nodoId ? `${p.nodoId}: ${p.mensaje}` : p.mensaje))
      .join(" | ");
    throw new ValidationError(
      `el flujo tiene errores y no se puede publicar — ${detalle}`,
      problemas,
    );
  }

  async previaPublicacion(versionId: UUID): Promise<PreviaPublicacion | null> {
    const nueva = await this.deps.workflows.findVersion(versionId);
    if (!nueva) return null;
    const [workflow, actual] = await Promise.all([
      this.deps.workflows.findWorkflow(nueva.workflow_id),
      this.deps.workflows.findVersionPublicada(nueva.workflow_id),
    ]);
    if (!workflow) return null;

    // Contar primero y listar después: las versiones son append-only, así que
    // toda versión con corridas vivas ya está en la lista que se lee después.
    const vivas = await this.deps.workflowRuns.contarVivasPorVersion(workflow.id);
    const numeros = new Map(
      (await this.deps.workflows.listarVersiones(workflow.id)).map((v) => [v.id, v.version]),
    );
    const porVersion = vivas
      .map((c): CorridasVivasDeVersion => {
        const version = numeros.get(c.versionId);
        if (version === undefined) {
          throw new IllegalStateError(
            `hay corridas vivas en una versión que no es de este workflow: ${c.versionId}`,
            "version_ajena",
          );
        }
        return { versionId: c.versionId, version, cantidad: c.cantidad };
      })
      .sort((a, b) => b.version - a.version);

    return {
      workflow: { id: workflow.id, nombre: workflow.nombre },
      nueva: {
        id: nueva.id,
        version: nueva.version,
        grafo: nueva.grafo,
        nota: nueva.nota,
        publicada: nueva.publicada,
      },
      actual: actual ? { id: actual.id, version: actual.version, grafo: actual.grafo } : null,
      corridasVivas: {
        total: porVersion.reduce((n, c) => n + c.cantidad, 0),
        porVersion,
      },
      problemas: problemasParaPublicar(nueva.grafo),
    };
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

      const tieneVersionBorrador = ultima !== undefined && ultima.id !== publicada?.id;

      const resumen: WorkflowResumen = {
        workflow: w,
        estado: derivarEstadoWorkflow({
          activo: w.activo,
          tieneVersionPublicada: publicada !== undefined,
          tieneVersionBorrador,
          ultimoRunFallado: metricas.ultimoRun !== null && !metricas.ultimoRun.exito,
        }),
        tieneVersionBorrador,
        versionPublicada: publicada?.version ?? null,
        resumenPasos: ultima ? resumenPasos(ultima.grafo) : [],
        disparadorTipo: ultima ? (disparadorDe(ultima.grafo)?.tipo ?? null) : null,
        disparoManualPublicado: publicada ? disparadorMatch(publicada.grafo, "manual") : false,
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
   * Se usa para editar una versión publicada sin romperla: se clona a un
   * borrador, se edita el borrador y cuando está listo se publica.
   */
  async crearVersionDesde(versionId: UUID, userId: UUID | null): Promise<WorkflowVersion> {
    const origen = await this.versionExistente(versionId);
    this.grafoGuardable(origen.grafo);
    return this.deps.workflows.clonarVersion({
      versionId: origen.id,
      publicar: false,
      nota: null,
      createdBy: userId,
    });
  }

  async rollbackAVersion(
    workflowId: UUID,
    versionId: UUID,
    userId: UUID | null,
    nota?: string | null,
  ): Promise<WorkflowVersion> {
    const origen = await this.versionExistente(versionId);
    if (origen.workflow_id !== workflowId) {
      throw new ValidationError(
        "La versión no pertenece a este workflow",
        "version_workflow_mismatch",
      );
    }
    this.grafoGuardable(origen.grafo);
    // Restaurar publica: pasa por la misma revisión que publicar.
    this.publicable(origen.grafo);
    return this.deps.workflows.clonarVersion({
      versionId: origen.id,
      publicar: true,
      // Sin nota propia, la restauración igual dice de dónde salió: una v7
      // idéntica a la v3 sin ninguna explicación se lee como un error.
      nota: nota?.trim() || `Restaurada desde la versión ${origen.version}`,
      createdBy: userId,
    });
  }

  private async versionExistente(versionId: UUID): Promise<WorkflowVersion> {
    const version = await this.deps.workflows.findVersion(versionId);
    if (!version) {
      throw new NotFoundError(`versión no encontrada: ${versionId}`, "workflow_version", versionId);
    }
    return version;
  }

  async saltosRecientes(dias: number, ahora: Date = new Date()): Promise<SaltosRecientes> {
    const desde = new Date(ahora.getTime() - dias * 24 * 60 * 60 * 1000);
    return { desde, porMotivo: await this.deps.workflowRuns.contarSaltosPorMotivo(desde) };
  }

  async probar(input: ProbarWorkflowInput): Promise<ProbarWorkflowResult> {
    // Antes de guardar nada: un nodo que no está en el grafo no es "hasta
    // acá", y correr la prueba entera en su lugar haría lo que no se pidió.
    if (input.hastaNodo !== undefined && !input.grafo.nodos.some((n) => n.id === input.hastaNodo)) {
      throw new ValidationError(
        `"Ejecutar hasta acá" apunta a un bloque que no está en el flujo: ${input.hastaNodo}`,
      );
    }
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

    // La sesión activa real si el servicio la puede leer; si no, la que
    // abriría el pipeline con un primer mensaje de este lead.
    const sesionReal = (await this.deps.sessions?.findActiveByLeadId(lead.id)) ?? null;
    const inicio = new Date();
    const sesion = sesionReal ?? sesionSimulada(lead.id, inicio);

    const { run, motivo } = await this.deps.workflowRuns.arrancar({
      versionId: version.id,
      leadId: input.leadId,
      // La simulada no existe en `lead_session`: la FK la rechazaría.
      sessionId: sesionReal?.id ?? null,
      // Lo mismo que sembraría un disparo de producción con este lead y esta
      // sesión, más la marca de prueba: la corrida corre con los efectos
      // interceptados, y reanudarla o relanzarla con el motor de producción
      // mandaría efectos reales. `reanudar`/`relanzar` la rechazan por esto.
      contexto: {
        ...contextoDeDisparo({ lead, sesion, canal: lead.canal_origen }),
        [MARCA_CORRIDA_DE_PRUEBA]: true,
      },
    });
    if (!run) {
      // Con `20260925100000_probar_fuera_de_la_concurrencia` aplicada una
      // corrida de prueba no pasa por la política y esto no ocurre; queda para
      // una base donde todavía no se aplicó.
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

    // Mismo intérprete y mismo registro que producción; los efectos quedan
    // interceptados y las esperas se saltean. La corrida termina siempre: una
    // que quedara `esperando` no la reanuda nadie. (`arrancar_workflow_run` ya
    // no cuenta las de prueba como vivas, así que no frenaría producción.)
    const r = await correrPrueba({
      grafo: version.grafo,
      maxPasos: version.max_pasos,
      desde: inicio,
      contexto: run.contexto,
      lead,
      sesion,
      runId: run.id,
      supresiones: this.deps.supresiones,
      detenerEn: input.hastaNodo,
      camposVivos: this.deps.camposVivos,
      // La prueba también se puede cancelar desde la corrida: antes de cada
      // acción se relee si sigue viva.
      seguir: async () => {
        const actual = await this.deps.workflowRuns.findRun(run.id);
        return actual?.estado === "corriendo" || actual?.estado === "esperando";
      },
      onPaso: async (paso) => {
        await this.deps.workflowRuns.registrarPaso(run.id, {
          nodo_id: paso.nodoId,
          orden: paso.orden,
          entrada: null,
          salida: conEfectosSimulados(paso.salida, paso.efectos),
          error: paso.error,
        });
      },
    });

    const pasos = r.pasos.at(-1)?.orden ?? 0;
    if (r.desenlace === "detenido" && r.nodoId !== undefined) {
      // `cancelado` y no `terminado`: no llegó a un fin, se frenó a pedido. El
      // historial lo tiene que poder distinguir de una prueba completa.
      await this.deps.workflowRuns.cancelar(
        run.id,
        `Probar se detuvo antes de "${r.nodoId}", como se pidió (Ejecutar hasta acá).`,
        pasos,
      );
      return {
        runId: run.id,
        resultado: { tipo: "detenido", nodoId: r.nodoId, pasos },
        salientes: r.salientes,
      };
    }
    if (r.desenlace === "cancelada" && r.nodoId !== undefined) {
      // Ya la cerró quien la canceló: no se escribe nada encima.
      return {
        runId: run.id,
        resultado: { tipo: "cancelado", nodoId: r.nodoId, pasos },
        salientes: r.salientes,
      };
    }
    if (r.desenlace === "fin") {
      await this.deps.workflowRuns.terminar(run.id, pasos);
      return { runId: run.id, resultado: { tipo: "completado", pasos }, salientes: r.salientes };
    }
    // El motivo ya quedó en la salida del paso (y de ahí en la corrida):
    // `terminar` sólo la cierra.
    if (r.desenlace === "saltado" && r.salto) {
      await this.deps.workflowRuns.terminar(run.id, pasos);
      return {
        runId: run.id,
        resultado: {
          tipo: "completado",
          pasos,
          salto: { nodoId: r.salto.nodoId, motivo: r.salto.motivo },
        },
        salientes: r.salientes,
      };
    }

    const error = r.error ?? "la prueba terminó sin llegar a un fin";
    await this.deps.workflowRuns.fallar(run.id, error, pasos);
    return {
      runId: run.id,
      resultado: { tipo: "fallado", nodoId: r.nodoId ?? null, error, motivo: r.motivo ?? null },
      salientes: r.salientes,
    };
  }
}

/**
 * La salida del paso más lo que habría hecho afuera, bajo `simulado`: es lo
 * que el modal de "Probar" muestra de cada paso. Un paso sin efectos queda
 * como lo dejó la acción.
 */
function conEfectosSimulados(
  salida: Record<string, unknown> | null,
  efectos: EfectoSimulado[],
): Record<string, unknown> | null {
  if (efectos.length === 0) return salida;
  return { ...(salida ?? {}), simulado: efectos };
}
