import { isNonRetriable, ValidationError } from "@/lib/errors";
import {
  camposDelPrefijo,
  esInterceptor,
  ganadorEntre,
  primerEnvioDesde,
  recorrerPrefijo,
} from "@/lib/workflows/interceptar";
import { disparoCoincide } from "@/lib/workflows/recorrer";
import type { TurnosInterceptadosRepository } from "@/server/repositories/turnos-interceptados.repo";
import type { WorkflowRunsRepository } from "@/server/repositories/workflow-runs.repo";
import type { WorkflowsRepository } from "@/server/repositories/workflows.repo";
import type { UUID, WorkflowVersion } from "@/types/entities";
import type { ContextoRun, DatosDisparo, MotivoSalto, Nodo } from "@/types/workflows";
import type { CampoCondicion } from "@/lib/workflows/condiciones";
import type { ConversationsParaEnviarMensaje } from "./acciones/enviar-mensaje";
import {
  envioRequiereVentana,
  revisarTopesDeEnvio,
  ventanaAbierta,
  type DepsTopesDeEnvio,
} from "./acciones/topes-de-envio";
import type { CamposVivosDeps } from "./ejecutor.service";

/**
 * "Intercepta el LLM" en el pipeline de mensajes (decisión 2 del dueño): antes
 * de llamar al agente, ¿este turno lo contesta un flujo?
 *
 * Dos maneras de contestar por el agente:
 *
 * 1. **Respuesta esperada.** El lead tocó un botón o eligió una fila de un
 *    mensaje que mandó un flujo, y esa corrida está esperando justo eso. La
 *    opción es del flujo: si además contestara el agente, el cliente recibiría
 *    dos respuestas a un solo toque. El texto libre sigue yendo al agente.
 * 2. **Condición.** Un flujo publicado y activo, con "Mensaje recibido" marcado
 *    "intercepta el LLM", cuyo filtro y cuyas condiciones iniciales cumple el
 *    mensaje (`lib/workflows/interceptar.ts`).
 *
 * Rápido a propósito: una lectura de corridas esperando (sólo si hubo toque),
 * la lista de versiones publicadas que el despacho ya lee en cada mensaje y,
 * si alguna condición del prefijo mira un campo vivo, una sola lectura de esos
 * campos. **No corre el flujo ni espera a que termine**: la corrida la arranca
 * después `workflow-disparar`, con el disparo de siempre.
 *
 * **Nunca silencia al agente si el flujo no va a poder responder** (regla del
 * dueño). Antes de interceptar mira lo mismo que va a mirar el envío del flujo
 * —`revisarTopesDeEnvio` (requiere humano, dado de baja, tope de frecuencia) y
 * la ventana de 24 h si el primer bloque que manda la necesita—, con las mismas
 * funciones: si algo lo impide, no intercepta y contesta el agente. La carrera
 * entre esta decisión y el envío la cierra la marca `$respuesta_de_turno`
 * (`lib/workflows/interceptar.ts`). El horario no descarta: fuera de hora el
 * envío del flujo se difiere, no se salta.
 */

/** Por qué un interceptor que coincidía no contesta: lo que habría hecho saltar su envío. */
export type MotivoDescarte =
  | MotivoSalto
  /** El bloque que contestaría no tiene una config válida: al correr fallaría. */
  | "bloque_mal_configurado"
  /** Los topes no se pudieron evaluar por la config (sin horario, sin lista de bajas). */
  | "no_verificable";

export interface DecidirIntercepcionInput {
  leadId: UUID;
  leadSessionId: UUID | null;
  /** Los datos del disparo "Mensaje recibido": canal, tipo y texto, para el filtro del trigger. */
  datos: DatosDisparo;
  /** Lo que siembra `contextoDeDisparo`. Con el intent del turno si ya se clasificó. */
  contexto: ContextoRun;
  /** El turno ya se clasificó: `contexto.sesion.intent` es el de este mensaje. */
  intentConocido: boolean;
  /** El toque de un botón o fila; `null` si el mensaje no es una respuesta interactiva. */
  respuestaInteractiva: { respondeA: string | null } | null;
}

export type DecisionIntercepcion =
  | { tipo: "intercepta"; motivo: "condicion"; workflowId: UUID; versionId: UUID }
  | { tipo: "intercepta"; motivo: "respuesta_esperada"; workflowId: UUID; runId: UUID }
  /** Contesta el agente. `descartada`: había un flujo que coincidía y no iba a poder responder. */
  | { tipo: "no"; descartada?: { workflowId: UUID; motivo: MotivoDescarte } }
  /** Algún interceptor depende del intent del turno: clasificar y volver a preguntar. */
  | { tipo: "necesita_intent" };

export type Intercepcion = Extract<DecisionIntercepcion, { tipo: "intercepta" }>;

export interface InterceptorTurnoDeps {
  workflows: Pick<WorkflowsRepository, "listarPublicadasPorDisparador">;
  runs: Pick<WorkflowRunsRepository, "esperandoOpcion">;
  turnos: Pick<TurnosInterceptadosRepository, "registrar">;
  /** Los campos vivos de las condiciones y la zona del negocio (`camposVivosDeCondicion`). */
  camposVivos: CamposVivosDeps;
  /** Los mismos puertos que usan los topes del envío (`topes-de-envio.ts`). */
  topes: DepsTopesDeEnvio;
  /** Para la ventana de 24 h: el último entrante de la conversación activa. */
  conversations: ConversationsParaEnviarMensaje;
  ahora?: () => Date;
}

/** Lo que el pipeline necesita del interceptor. `InterceptorTurnoService` lo implementa. */
export interface InterceptorTurno {
  decidir(input: DecidirIntercepcionInput): Promise<DecisionIntercepcion>;
  registrar(mensajeId: UUID, decision: Intercepcion): Promise<void>;
}

const esObjeto = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/** `{ lead: {a} }` + `{ lead: {b} }` = `{ lead: {a, b} }`. El contexto del disparo gana. */
function conVivos(contexto: ContextoRun, vivos: ContextoRun): ContextoRun {
  const mezcla: ContextoRun = { ...vivos };
  for (const [clave, valor] of Object.entries(contexto)) {
    const previo = mezcla[clave];
    mezcla[clave] = esObjeto(valor) && esObjeto(previo) ? { ...previo, ...valor } : valor;
  }
  return mezcla;
}

/**
 * ¿El bloque le manda algo al cliente? Una config rota cuenta como envío: así
 * llega a `impedimento`, que la descarta en vez de interceptar con un bloque
 * que va a fallar.
 */
function esEnvio(nodo: Nodo): boolean {
  try {
    return envioRequiereVentana(nodo) !== null;
  } catch {
    return true;
  }
}

export class InterceptorTurnoService implements InterceptorTurno {
  constructor(private readonly deps: InterceptorTurnoDeps) {}

  async decidir(input: DecidirIntercepcionInput): Promise<DecisionIntercepcion> {
    const ahora = (this.deps.ahora ?? (() => new Date()))();
    if (input.respuestaInteractiva) {
      const esperando = await this.deps.runs.esperandoOpcion(
        input.leadId,
        input.respuestaInteractiva.respondeA,
      );
      if (esperando) {
        // Qué bloque contesta el toque depende de la opción y de la corrida:
        // se miran los topes del lead y la frecuencia, que valen para todos.
        const motivo = await this.impedimento(input, null, ahora);
        if (motivo) return { tipo: "no", descartada: { workflowId: esperando.workflowId, motivo } };
        return {
          tipo: "intercepta",
          motivo: "respuesta_esperada",
          workflowId: esperando.workflowId,
          runId: esperando.runId,
        };
      }
    }

    const candidatas = (
      await this.deps.workflows.listarPublicadasPorDisparador("mensaje_recibido")
    ).filter(
      (v) => esInterceptor(v.grafo) && disparoCoincide(v.grafo, "mensaje_recibido", input.datos),
    );
    if (candidatas.length === 0) return { tipo: "no" };

    const campos = new Set<CampoCondicion>();
    for (const v of candidatas) for (const c of camposDelPrefijo(v.grafo)) campos.add(c);
    const [vivos, zona] = await Promise.all([
      campos.size > 0
        ? this.deps.camposVivos.cargar({
            leadId: input.leadId,
            leadSessionId: input.leadSessionId,
            campos,
          })
        : Promise.resolve({}),
      this.deps.camposVivos.zona(),
    ]);
    const contexto = conVivos(input.contexto, vivos);
    const opciones = { ahora, zona };

    const interceptan: Array<{
      workflow_id: UUID;
      created_at: Date;
      version: WorkflowVersion;
      nodo: Nodo;
    }> = [];
    let faltaIntent = false;
    for (const v of candidatas) {
      const r = recorrerPrefijo(v.grafo, contexto, opciones, input.intentConocido);
      if (r.tipo === "intercepta") {
        interceptan.push({
          workflow_id: v.workflow_id,
          created_at: v.created_at,
          version: v,
          nodo: r.nodo,
        });
      } else if (r.tipo === "necesita_intent") faltaIntent = true;
    }

    // Uno que se decide sin clasificar gana sobre uno que necesita el intent:
    // esperar al clasificador sólo para elegir entre dos interceptores sería
    // gastar LLM en un turno que igual no contesta el agente.
    const elegido = ganadorEntre(interceptan);
    if (elegido) {
      const ganador = elegido.version;
      // Contesta uno solo; si él no puede, contesta el agente. Los topes que lo
      // frenan son del lead, así que frenarían igual a cualquier otro.
      const envio = primerEnvioDesde(ganador.grafo, elegido.nodo, esEnvio);
      const motivo = envio ? await this.impedimento(input, envio, ahora) : null;
      if (motivo) return { tipo: "no", descartada: { workflowId: ganador.workflow_id, motivo } };
      return {
        tipo: "intercepta",
        motivo: "condicion",
        workflowId: ganador.workflow_id,
        versionId: ganador.id,
      };
    }
    return faltaIntent ? { tipo: "necesita_intent" } : { tipo: "no" };
  }

  /**
   * Lo que haría saltar el envío del flujo, con las funciones del envío. `envio`
   * `null`: no se sabe qué bloque contesta (el toque de un botón); se miran los
   * topes que valen para cualquier bloque.
   */
  private async impedimento(
    input: DecidirIntercepcionInput,
    envio: Nodo | null,
    ahora: Date,
  ): Promise<MotivoDescarte | null> {
    let requiereVentana = false;
    if (envio) {
      try {
        requiereVentana = envioRequiereVentana(envio) === true;
      } catch (error) {
        if (error instanceof ValidationError) return "bloque_mal_configurado";
        throw error;
      }
    }
    try {
      const topes = await revisarTopesDeEnvio(
        this.deps.topes,
        { leadId: input.leadId, contexto: input.contexto },
        ahora,
        "interceptar",
      );
      if (topes.tipo === "salto") return topes.salto.motivo;
    } catch (error) {
      // Una config que no deja evaluar los topes tampoco deja mandar: el envío
      // fallaría con el mismo error. Una falla de infraestructura se reintenta:
      // el step vuelve a decidir.
      if (isNonRetriable(error)) return "no_verificable";
      throw error;
    }
    if (requiereVentana) {
      const conversacion = await this.deps.conversations.findActivaByLead(input.leadId);
      if (!conversacion || !ventanaAbierta(conversacion.ultimo_entrante_at, ahora)) {
        return "sin_ventana";
      }
    }
    return null;
  }

  async registrar(mensajeId: UUID, decision: Intercepcion): Promise<void> {
    await this.deps.turnos.registrar({
      mensaje_id: mensajeId,
      workflow_id: decision.workflowId,
      workflow_version_id: decision.motivo === "condicion" ? decision.versionId : null,
      workflow_run_id: decision.motivo === "respuesta_esperada" ? decision.runId : null,
      motivo: decision.motivo,
    });
  }
}
