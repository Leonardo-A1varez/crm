import { NotFoundError, ValidationError } from "@/lib/errors";
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
  // `aplicarExtraccion` (no `update`): `cambiar_etapa` necesita escribir
  // `current_stage` y su marca de procedencia en la MISMA operacion -- un
  // `current_stage` sin su procedencia al dia es el bug que este fix corrige.
  // `findById` es para leer `current_stage` previo, que va en
  // `valor_anterior` de la marca, igual que hace `moverEtapa` en el repo.
  sessions: Pick<LeadSessionRepository, "findById" | "aplicarExtraccion">;
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
 * Mueve `lead_session.current_stage`. El workflow gana incluso sobre una
 * etapa que un vendedor fijo a mano -- es una decision del dueno del
 * producto, tomada en el review de esta misma task -- pero la procedencia
 * tiene que decir la verdad sobre quien la movio: `por: "workflow"`, nunca
 * `"humano"`. Escribe con `sessions.aplicarExtraccion`, no con `update` ni
 * con `moverEtapa`:
 *
 * - `update` (lo que usaba la primera version de esta accion) no toca
 *   `procedencia` para nada: `current_stage` avanzaba y el chip del rail
 *   ("Etapa puesta por vos... el extractor no la vuelve a tocar") se quedaba
 *   apuntando a un valor que ya no existe. Ver Fix round 1 mas abajo en el
 *   reporte de esta task.
 * - `moverEtapa` es especifico del click humano en el rail del Twin y deja
 *   `procedencia.current_stage = "humano"` a proposito -- usarlo desde un
 *   workflow mentiria exactamente al reves de lo que este fix corrige.
 * - `aplicarExtraccion` es la puerta que YA existe para "el patch y su marca
 *   de procedencia en la misma operacion" (ver su doc comment en
 *   `lead-session.repo.ts`): en Supabase es un solo UPDATE, en InMemory una
 *   sola operacion sincronica. No hizo falta un metodo de repo nuevo.
 *
 * El `findById` previo es para `valor_anterior` en la marca -- mismo shape
 * que arma `moverEtapa` (`por`, `at`, `user_id: null` porque quien mueve es
 * una regla y no una persona, `mensaje_origen_id: null`, `valor_anterior`).
 *
 * Consecuencia para el extractor, confirmada leyendo
 * `descartarCorregidosAMano` en `twin-extractor.service.ts`: filtra sobre
 * `procedencia[campo]?.por === "humano"` nada mas, asi que una etapa con
 * `por: "workflow"` NO queda protegida -- el extractor puede volver a
 * pisarla en el proximo turno, igual que pisa una que puso el pipeline. Es
 * el comportamiento correcto para esta task (el dueno solo pidio que el
 * workflow gane sobre el humano, no que quede fijada contra la IA) y no se
 * toco el extractor. Queda anotado por si una version futura quiere que
 * "lo puso un workflow" tambien bloquee al extractor.
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
    const actual = await sessions.findById(leadSessionId);
    if (!actual) {
      throw new NotFoundError(
        `lead_session no encontrada: ${leadSessionId}`,
        "lead_session",
        leadSessionId,
      );
    }
    await sessions.aplicarExtraccion(
      leadSessionId,
      { current_stage: etapa },
      {
        current_stage: {
          por: "workflow",
          at: new Date().toISOString(),
          user_id: null,
          mensaje_origen_id: null,
          valor_anterior: actual.current_stage,
        },
      },
    );
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
 * dispara un segundo evento de handoff. `notifyCustomer: true` porque es el
 * default que ya usan los dos llamadores existentes de `pause` con
 * `source: "rule"`/`"agent_guard"`: un `false` aca seria la IA callandose
 * sin avisarle al cliente, un caso especial que nadie pidio para esta task.
 */
function crearEscalarAHumano(handoff: AccionesInternasDeps["handoff"]): AccionHandler {
  return async (nodo, entorno) => {
    const leadSessionId = requireLeadSessionId(nodo, entorno);
    const session = await handoff.pause({
      sessionId: leadSessionId,
      reasonCode: "rule_handoff",
      source: "rule",
      sourceEventKey: `workflow:${entorno.runId}:${entorno.orden}`,
      notifyCustomer: true,
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
