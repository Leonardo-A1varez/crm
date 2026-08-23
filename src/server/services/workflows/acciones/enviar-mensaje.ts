import { estaAbierto, proximaApertura } from "@/lib/agente/horario";
import { BudgetExceededError, NotFoundError, ValidationError } from "@/lib/errors";
import type { AgenteConfigValores } from "@/types/agente";
import type { Canal } from "@/types/domain";
import type { UUID } from "@/types/entities";
import type { Nodo } from "@/types/workflows";
import type { LeadsRepository } from "@/server/repositories/leads.repo";
import type { MessagesRepository } from "@/server/repositories/messages.repo";
import type { MetaApiService } from "@/server/services/meta-api.service";
import type { AccionHandler, EntornoAccion } from "./registro";

const VEINTICUATRO_HORAS_MS = 24 * 60 * 60 * 1000;

/**
 * Lo mínimo que esta acción necesita de la conversación activa del lead: por
 * dónde escribirle (canal) y desde cuándo está abierta la ventana de 24 h de
 * Meta (texto libre fuera de esa ventana, Meta lo rechaza).
 *
 * NO es `ConversationsRepository`: esa interfaz de hoy no tiene ni un método
 * "la conversación activa de este lead" ni el campo `ultimo_entrante_at` --
 * en ningún lado del repo existe todavía un "último mensaje entrante" por
 * conversación (`Conversacion` solo trae `ultima_actividad_at`, que se toca
 * con cada mensaje en cualquier dirección, entrante o saliente, y no sirve
 * para esto). Cerrar ese hueco es trabajo de quien conecte esta acción al
 * motor (Task 10/11): en Supabase probablemente sea
 * `max(created_at) where direction='in'` sobre `mensajes` de la conversación,
 * resuelto con una vista o una consulta aparte. Se documenta acá y no se
 * inventa una implementación sin que el dueño la vea, siguiendo la regla de
 * "si falta contexto, no asumir" -- esto se resuelve fuera del alcance de
 * la Task 9 (motor de la acción, no su wiring a Supabase).
 */
export interface ConversacionActivaParaEnvio {
  id: UUID;
  canal: Canal;
  ultimo_entrante_at: Date | null;
}

export interface ConversationsParaEnviarMensaje {
  findActivaByLead(leadId: UUID): Promise<ConversacionActivaParaEnvio | null>;
}

/**
 * Puerto angosto y no `AgentConfigProvider` (`server/services/agente/config-provider.ts`,
 * método `get()`): ese provider ya existe, cachea 30 s y devuelve
 * `AgenteConfigValores` completo, pero esta acción solo necesita 3 campos y
 * el nombre que le dio el brief de esta task es `activa()`. Quien conecte
 * esta acción (Task 10/11) adapta el provider real con un `{ activa: () =>
 * configProvider.get() }` de una línea -- no vale la pena forzar el nombre
 * real del método acá y arrastrar los otros ~15 campos que esta acción no
 * usa.
 */
export interface ConfigProviderParaEnviarMensaje {
  activa(): Promise<
    Pick<AgenteConfigValores, "max_salientes_automaticos_24h" | "horario" | "horario_timezone">
  >;
}

export interface AccionEnviarMensajeDeps {
  messages: Pick<MessagesRepository, "contarSalientesAutomaticos">;
  metaApi: Pick<MetaApiService, "sendOutbound">;
  conversations: ConversationsParaEnviarMensaje;
  leads: Pick<LeadsRepository, "findById">;
  configProvider: ConfigProviderParaEnviarMensaje;
}

function leerTexto(nodo: Nodo): string {
  const valor = nodo.config["texto"];
  if (typeof valor === "string" && valor.length > 0) return valor;
  throw new ValidationError(
    `el nodo "${nodo.id}" (enviar_mensaje) no declara "texto"`,
    "texto_ausente",
  );
}

/**
 * Mismo criterio que `requireLeadSessionId` en `acciones/internas.ts`: sin
 * sesión no hay a quién mandarle nada ni con qué `leadSessionId` completar
 * `SendOutboundInput`. Se duplica en vez de exportar desde `internas.ts`
 * porque esa dependencia cruzada entre dos archivos de acciones no le suma
 * nada a ninguno de los dos -- el mensaje de error de cada uno ya nombra la
 * acción propia.
 */
function requireLeadSessionId(nodo: Nodo, entorno: EntornoAccion): UUID {
  if (entorno.leadSessionId) return entorno.leadSessionId;
  throw new ValidationError(
    `el nodo "${nodo.id}" (enviar_mensaje) necesita una sesion activa y la corrida no tiene una`,
    "lead_session_id_ausente",
  );
}

/**
 * La acción de riesgo del motor: es la única que llama a Meta. Orden
 * obligatorio y no reordenable -- **tope → horario → mandar**:
 *
 *   1. El tope se chequea ANTES que nada más. Chequearlo después de mandar es
 *      enterarse de que ya se había pasado con el mensaje 4 entregado.
 *   2. El horario se chequea después del tope y antes de mandar. Si se
 *      chequeara antes, un mensaje que igual se iba a diferir habría gastado
 *      presupuesto que nunca se usó.
 *   3. Mandar es lo último, y pasa por `MetaApiService.sendOutbound`, que ya
 *      deduplica por `idempotencyKey` -- ver su doc comment. La key
 *      `wf:<runId>:<orden>` es lo que hace que un reintento del step de
 *      Inngest no mande el mismo WhatsApp dos veces.
 */
export function crearAccionEnviarMensaje(deps: AccionEnviarMensajeDeps): AccionHandler {
  return async (nodo, entorno) => {
    const texto = leerTexto(nodo);
    const leadSessionId = requireLeadSessionId(nodo, entorno);

    // 1. TOPE.
    const cfg = await deps.configProvider.activa();
    const desde = new Date(Date.now() - VEINTICUATRO_HORAS_MS);
    const usados = await deps.messages.contarSalientesAutomaticos(entorno.leadId, desde);
    if (usados >= cfg.max_salientes_automaticos_24h) {
      throw new BudgetExceededError(
        `tope de ${cfg.max_salientes_automaticos_24h} salientes automáticos en 24 h alcanzado para este lead`,
        "salientes_24h",
      );
    }

    // 2. HORARIO. `cfg.horario`/`cfg.horario_timezone` se leen con guarda en
    // vez de pasarlos directo a `estaAbierto`: esta acción declara el tipo de
    // `configProvider.activa()` como obligatorio para esos dos campos, pero
    // un adaptador real que falle en traerlos no debería tirar el turno por
    // un `undefined[dia]` -- el mismo criterio de "fallar abierto ante un
    // horario que no se puede leer" que ya documenta `estaAbierto`.
    const ahora = new Date();
    if (
      cfg.horario &&
      cfg.horario_timezone &&
      !estaAbierto(cfg.horario, cfg.horario_timezone, ahora)
    ) {
      const cuando = proximaApertura(cfg.horario, cfg.horario_timezone, ahora);
      // Sin un solo rango válido no hay hora hábil a la que diferir. Mandar
      // igual sería ignorar la decisión del dueño; diferir para siempre sería
      // un flujo mudo que nunca termina.
      if (!cuando) {
        throw new ValidationError(
          "el horario de atención no tiene ningún rango: no hay hora hábil a la que diferir",
          "horario_vacio",
        );
      }
      return { puerto: "salida", diferirHasta: cuando, salida: { diferido: true } };
    }

    const [conversacion, lead] = await Promise.all([
      deps.conversations.findActivaByLead(entorno.leadId),
      deps.leads.findById(entorno.leadId),
    ]);
    if (!conversacion) {
      throw new NotFoundError(
        `el lead ${entorno.leadId} no tiene conversación activa`,
        "conversacion",
        entorno.leadId,
      );
    }
    if (!lead) {
      throw new NotFoundError(`lead no encontrado: ${entorno.leadId}`, "lead", entorno.leadId);
    }

    // Ventana de 24 h de Meta: fuera de ella, Meta rechaza texto libre y solo
    // deja pasar plantillas aprobadas. Fallar en voz alta y NO degradar a una
    // plantilla -- elegir cuál le llega a un cliente no es decisión del
    // motor, es decisión de negocio (ver brief de esta task).
    if (
      !conversacion.ultimo_entrante_at ||
      ahora.getTime() - conversacion.ultimo_entrante_at.getTime() > VEINTICUATRO_HORAS_MS
    ) {
      throw new ValidationError(
        "la ventana de 24 h de Meta está cerrada: hace falta una plantilla aprobada, no texto libre",
        "ventana_24h_meta_cerrada",
      );
    }

    // 3. MANDAR.
    const mensaje = await deps.metaApi.sendOutbound({
      conversacionId: conversacion.id,
      leadSessionId,
      canal: conversacion.canal,
      to: lead.telefono,
      contenido: texto,
      sender: "sistema",
      // `sendOutbound` ya deduplica contra esta key -- un reintento del step
      // de Inngest la vuelve a calcular igual y encuentra la reserva
      // existente en vez de llamar a Meta de nuevo.
      idempotencyKey: `wf:${entorno.runId}:${entorno.orden}`,
    });

    return { puerto: "salida", salida: { mensaje_id: mensaje.id } };
  };
}
