import { ValidationError } from "@/lib/errors";
import { ETAPAS_EMBUDO, type EtapaEmbudo } from "@/types/domain";
import type { HandoffService } from "@/server/services/handoff.service";
import type { LeadSessionRepository } from "@/server/repositories/lead-session.repo";
import type { TagsRepository } from "@/server/repositories/tags.repo";
import type { Nodo } from "@/types/workflows";
import type { AccionHandler, EntornoAccion } from "./registro";

/**
 * Las tres acciones que solo tocan nuestra propia base. `enviar_mensaje`
 * (Task 9) manda un WhatsApp real y por eso llega despues: estas tres no
 * tienen efecto externo, asi que un grafo mal armado nunca puede spamear a
 * un lead - como mucho le cuelga una etiqueta de mas o mueve una etapa.
 */
export interface AccionesInternasDeps {
  tags: Pick<TagsRepository, "assignToLead">;
  sessions: Pick<LeadSessionRepository, "update">;
  handoff: Pick<HandoffService, "pause">;
}

/** `config[campo]` como string no vacio, o `undefined` si falta o es de otro tipo. */
function leerStringConfig(nodo: Nodo, campo: string): string | undefined {
  const valor = nodo.config[campo];
  return typeof valor === "string" && valor.length > 0 ? valor : undefined;
}

/**
 * `leadSessionId` es opcional en `EntornoAccion` porque no todo disparador de
 * workflow nace de un mensaje (W3 puede agregar disparadores por cron o por
 * evento de lead). `cambiar_etapa` y `escalar_a_humano` si necesitan una
 * sesion -- no hay `current_stage` ni handoff sin una -- asi que la ausencia
 * es un ValidationError y no un `undefined` que explota tres capas mas abajo.
 */
function requireLeadSessionId(nodo: Nodo, entorno: EntornoAccion): string {
  if (entorno.leadSessionId) return entorno.leadSessionId;
  throw new ValidationError(
    `el nodo "${nodo.id}" (${String(nodo.config["accion"])}) necesita una sesion activa y la corrida no tiene una`,
    "lead_session_id_ausente",
  );
}

/**
 * Cuelga una etiqueta con `source: "workflow"`. Ese valor es lo que hace que
 * `assignToLead` no revive una etiqueta que una persona saco a mano -- ver el
 * doc comment de `TagsRepository.assignToLead`. `assignedBy: null` porque
 * quien asigna es una regla, no un usuario.
 */
function crearPonerEtiqueta(tags: AccionesInternasDeps["tags"]): AccionHandler {
  return async (nodo, entorno) => {
    const tagId = leerStringConfig(nodo, "tagId");
    if (!tagId) {
      throw new ValidationError(
        `el nodo "${nodo.id}" (poner_etiqueta) no declara "tagId"`,
        "tag_id_ausente",
      );
    }
    const leadTag = await tags.assignToLead(entorno.leadId, tagId, "workflow", null);
    return {
      puerto: "salida",
      salida: { tag_id: tagId, quitada_at: leadTag.quitada_at?.toISOString() ?? null },
    };
  };
}

const ETAPAS_VALIDAS = new Set<string>(ETAPAS_EMBUDO);

function esEtapaEmbudo(valor: string): valor is EtapaEmbudo {
  return ETAPAS_VALIDAS.has(valor);
}

/**
 * Mueve `lead_session.current_stage`. Escribe con `sessions.update`, la misma
 * puerta que usan el pipeline y el agente para escalar a `requiere_humano`
 * (`ai-agent.service.ts`) -- no con `moverEtapa`, que es especifico del click
 * humano en el rail del Twin y deja `procedencia.current_stage = "humano"`.
 * Marcar la escritura de una regla como si la hubiera hecho una persona seria
 * mentir en el propio dato que existe para decir quien decidio que.
 *
 * Consecuencia, ya visible en el codigo de hoy: el filtro que hace que una
 * etapa corregida a mano no se pise (`descartarCorregidosAMano` en
 * `twin-extractor.service.ts`) vive DENTRO del extractor LLM, no en el repo.
 * Un workflow, igual que el pipeline y el agente, no pasa por ese filtro y
 * puede mover una etapa que un vendedor fijo a mano. Es el mismo trato que ya
 * reciben esos otros dos escritores directos -- no una regla nueva -- pero
 * queda anotado como pregunta abierta para cuando W4 de observabilidad de
 * "por que se movio esto": puede hacer falta que `cambiar_etapa` respete el
 * pin igual que lo hace el extractor, y hoy no lo hace.
 *
 * Solo acepta `EtapaEmbudo` (las 6 posiciones del embudo): `perdido` y
 * `requiere_humano` son desvios que decide el pipeline, no destinos de un
 * nodo `cambiar_etapa` -- mismo limite que ya impone `moverEtapa` en el repo.
 */
function crearCambiarEtapa(sessions: AccionesInternasDeps["sessions"]): AccionHandler {
  return async (nodo, entorno) => {
    const etapa = leerStringConfig(nodo, "etapa");
    if (!etapa || !esEtapaEmbudo(etapa)) {
      throw new ValidationError(
        `el nodo "${nodo.id}" (cambiar_etapa) tiene "etapa" invalida: ${JSON.stringify(nodo.config["etapa"])}`,
        "etapa_invalida",
      );
    }
    const leadSessionId = requireLeadSessionId(nodo, entorno);
    await sessions.update(leadSessionId, { current_stage: etapa });
    return { puerto: "salida", salida: { current_stage: etapa } };
  };
}

/**
 * Escala a un humano delegando en `HandoffService.pause` -- no escribe
 * `ia_pausada`/`current_stage` por su cuenta. `pause` ya resuelve la
 * transicion completa (guarda `stage_before_handoff`, deja `current_stage`
 * en `requiere_humano`, y con `HandoffEventsRepository` real audita el evento
 * y es idempotente por `sourceEventKey`); reimplementar eso aca seria la
 * misma duplicacion que la leccion de la Task 7 de leads: un wrapper que se
 * parece a la operacion real no es la operacion real.
 *
 * `reasonCode: "rule_handoff"` + `source: "rule"` reutiliza el mismo par que
 * ya usa el motor de reglas IF/THEN (`ai-agent.service.ts`) para un handoff
 * disparado por una regla y no por una persona ni por el guard del agente --
 * un workflow es exactamente eso, una regla mas. `sourceEventKey` usa
 * `runId`+`orden`, que es la clave de idempotencia de un paso de corrida
 * (ver doc comment de `EntornoAccion.orden`): reintentar el mismo paso no
 * dispara un segundo evento de handoff.
 */
function crearEscalarAHumano(handoff: AccionesInternasDeps["handoff"]): AccionHandler {
  return async (nodo, entorno) => {
    const leadSessionId = requireLeadSessionId(nodo, entorno);
    const session = await handoff.pause({
      sessionId: leadSessionId,
      reasonCode: "rule_handoff",
      source: "rule",
      sourceEventKey: `workflow:${entorno.runId}:${entorno.orden}`,
      notifyCustomer: false,
    });
    return {
      puerto: "salida",
      salida: { lead_session_id: session.id, current_stage: session.current_stage },
    };
  };
}

export function crearAccionesInternas(deps: AccionesInternasDeps): Record<string, AccionHandler> {
  return {
    poner_etiqueta: crearPonerEtiqueta(deps.tags),
    cambiar_etapa: crearCambiarEtapa(deps.sessions),
    escalar_a_humano: crearEscalarAHumano(deps.handoff),
  };
}
