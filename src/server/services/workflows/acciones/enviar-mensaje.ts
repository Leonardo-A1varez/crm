import { NotFoundError, ValidationError } from "@/lib/errors";
import { configDeAccion, type CanalDeEnvio } from "@/lib/workflows/config-nodos";
import { interpolarVariables } from "@/lib/workflows/variables";
import type { AgenteConfigValores } from "@/types/agente";
import type { Canal } from "@/types/domain";
import type { UUID } from "@/types/entities";
import type { Nodo, ResultadoAccion, SaltoDeTope } from "@/types/workflows";
import type { DifusionSupresionesRepository } from "@/server/repositories/difusion-supresiones.repo";
import type { LeadSessionRepository } from "@/server/repositories/lead-session.repo";
import type { LeadsRepository } from "@/server/repositories/leads.repo";
import type { MessagesRepository } from "@/server/repositories/messages.repo";
import type { MetaApiService } from "@/server/services/meta-api.service";
import { cargarDatosInterpolacion } from "@/server/services/workflows/acciones/datos-interpolacion";
import type { AccionHandler, EntornoAccion } from "./registro";
import { revisarTopesDeEnvio } from "./topes-de-envio";

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
  /**
   * `findActiveByLeadId` es para el tope "requiere humano": se mira la sesión
   * ACTIVA del lead, no la de la corrida, que puede haber cerrado mientras la
   * corrida dormía.
   */
  sessions: { findById: (id: UUID) => Promise<unknown> } & Pick<
    LeadSessionRepository,
    "findActiveByLeadId"
  >;
  users: { findById: (id: UUID) => Promise<unknown> };
  configProvider: ConfigProviderParaEnviarMensaje;
  /**
   * La lista de bajas de Difusión (`difusion_supresiones`), por teléfono.
   *
   * Opcional en el TIPO sólo para no romper a quien arma el registro sin él
   * todavía (`inngest/bootstrap.ts`); en runtime falla CERRADO: sin este
   * puerto la acción tira `IllegalStateError` y no manda. Mandarle a alguien
   * que se dio de baja porque un puerto no se cableó es exactamente lo que el
   * PRD §6.6 dice que no pasa "nunca".
   */
  supresiones?: Pick<DifusionSupresionesRepository, "activasPorTelefonos">;
}

/**
 * El canal que exige cada opción del selector del nodo, o `null` si deja que
 * lo decida la conversación ("Inferir del trigger", el default del panel). La
 * acción no sabe abrir una conversación en otro canal: si el nodo pide uno
 * distinto del de la conversación activa, falla en voz alta en vez de mandar
 * por otro lado. Las opciones salen del contrato (`CANALES_DE_ENVIO`): una
 * opción nueva sin su canal acá no compila.
 */
const CANAL_DEL_NODO: Readonly<Record<CanalDeEnvio, Canal | null>> = {
  inferir: null,
  whatsapp: "wa",
  instagram: "ig",
  messenger: "fb",
};

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

/** La acción no se ejecuta: un tope la saltó y el lead sale del flujo. */
function saltar(salto: SaltoDeTope): ResultadoAccion {
  return { puerto: "salida", salto };
}

/**
 * La acción de riesgo del motor: es la única que llama a Meta. Orden
 * obligatorio y no reordenable:
 *
 *   1. **Topes del lead (PRD §6.6)**: requiere humano, dado de baja. Van
 *      primero porque son los más permanentes: un lead dado de baja no tiene
 *      que quedar diferido horas por el horario para saltarse recién al
 *      despertar, y el motivo que se registra tiene que ser el que explica de
 *      verdad por qué no recibió.
 *   2. **Tope de frecuencia**, ANTES de mandar. Chequearlo después es
 *      enterarse de que ya se había pasado con el mensaje 4 entregado.
 *   3. **Horario**: difiere, no salta. Va después del tope: si se chequeara
 *      antes, un mensaje que igual se iba a saltar esperaría horas para nada.
 *   4. **Ventana de 24 h de Meta**: salta (`sin_ventana`).
 *   5. Mandar es lo último, y pasa por `MetaApiService.sendOutbound`, que ya
 *      deduplica por `idempotencyKey` -- ver su doc comment. La key
 *      `wf:<runId>:<orden>` es lo que hace que un reintento del step de
 *      Inngest no mande el mismo WhatsApp dos veces.
 *
 * Un tope que salta NO tira: devuelve `salto` con el motivo y el ejecutor
 * termina la corrida con él. Un tope no es un fallo —el flujo hizo lo que
 * tenía que hacer— y pintarlo como error haría que el listado grite "Con
 * errores" por un flujo sano. Al despertar de una espera la acción vuelve a
 * correr entera, así que los topes se revalidan solos (PRD §6.4).
 */
export function crearAccionEnviarMensaje(deps: AccionEnviarMensajeDeps): AccionHandler {
  return async (nodo, entorno) => {
    // El texto y el canal, con las claves y el default con que los escribe el
    // panel (`config-nodos.ts`). El nodo legacy guarda el texto con su clave
    // de antes y se lee igual.
    const { mensaje: textoRaw, canal: canalDelNodo } = configDeAccion("enviar_mensaje", nodo);
    const canal = CANAL_DEL_NODO[canalDelNodo];
    const leadSessionId = requireLeadSessionId(nodo, entorno);
    // El reloj del motor, no el de la máquina: en "Probar" y en el simulador
    // es virtual, y un envío diferido tiene que ver abrir el horario en ESE
    // reloj. En producción son la misma hora.
    const ahora = entorno.ahora ?? new Date();

    // 1-3. TOPES DEL LEAD, DE FRECUENCIA Y HORARIO: los mismos que una
    // plantilla (`topes-de-envio.ts`), en el mismo orden.
    const topes = await revisarTopesDeEnvio(deps, entorno, ahora, "enviar_mensaje");
    if (topes.tipo === "salto") return saltar(topes.salto);
    if (topes.tipo === "diferir") {
      return { puerto: "salida", diferirHasta: topes.hasta, salida: { diferido: true } };
    }
    const { lead } = topes;

    // Cargar datos para interpolación de variables (solo después de validar horario)
    const datosInterpolacion = await cargarDatosInterpolacion(
      { leads: deps.leads, sessions: deps.sessions, users: deps.users },
      { leadId: entorno.leadId, leadSessionId, contexto: entorno.contexto },
    );
    const { texto } = interpolarVariables(textoRaw, datosInterpolacion);

    const conversacion = await deps.conversations.findActivaByLead(entorno.leadId);
    if (!conversacion) {
      throw new NotFoundError(
        `el lead ${entorno.leadId} no tiene conversación activa`,
        "conversacion",
        entorno.leadId,
      );
    }
    if (canal !== null && conversacion.canal !== canal) {
      throw new ValidationError(
        `el nodo "${nodo.id}" (enviar_mensaje) pide mandar por ${canal} y la conversación activa es de ${conversacion.canal}`,
        "canal_distinto",
      );
    }

    // 4. VENTANA DE 24 H DE META: fuera de ella, Meta rechaza texto libre y
    // solo deja pasar plantillas aprobadas. Se salta y NO se degrada a una
    // plantilla -- elegir cuál le llega a un cliente no es decisión del
    // motor, es decisión de negocio.
    if (
      !conversacion.ultimo_entrante_at ||
      ahora.getTime() - conversacion.ultimo_entrante_at.getTime() > VEINTICUATRO_HORAS_MS
    ) {
      return saltar({
        motivo: "sin_ventana",
        detalle:
          "La ventana de 24 h de Meta está cerrada: hace falta una plantilla aprobada, no texto libre.",
      });
    }

    // 5. MANDAR.
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
