import { estaAbierto, proximaApertura } from "@/lib/agente/horario";
import { normalizarTelefonoWhatsApp } from "@/lib/difusion/telefono";
import { IllegalStateError, NotFoundError, ValidationError } from "@/lib/errors";
import type { Lead } from "@/types/entities";
import type { SaltoDeTope } from "@/types/workflows";
import type { AccionEnviarMensajeDeps } from "./enviar-mensaje";
import type { EntornoAccion } from "./registro";

const VEINTICUATRO_HORAS_MS = 24 * 60 * 60 * 1000;

export type DepsTopesDeEnvio = Pick<
  AccionEnviarMensajeDeps,
  "sessions" | "leads" | "supresiones" | "configProvider" | "messages" | "plantillasSinSesion"
>;

/**
 * Qué dicen los topes antes de mandarle algo a un lead:
 * - `sigue`: se puede mandar (trae el lead, que quien llama necesita);
 * - `salto`: un tope lo saltó, el lead sale del flujo;
 * - `diferir`: fuera de horario, se vuelve a intentar a esta hora.
 */
export type ResultadoTopes =
  | { tipo: "sigue"; lead: Lead }
  | { tipo: "salto"; salto: SaltoDeTope }
  | { tipo: "diferir"; hasta: Date };

/**
 * Los topes que comparten todos los envíos de un flujo —texto y plantilla—,
 * en este orden y no en otro:
 *
 *   1. **Del lead (PRD §6.6)**: requiere humano, dado de baja. Primero porque
 *      son los más permanentes: un lead dado de baja no tiene que quedar
 *      diferido horas para saltarse recién al despertar, y el motivo que se
 *      registra tiene que ser el que explica de verdad por qué no recibió.
 *   2. **Frecuencia**, ANTES de mandar. Chequearlo después es enterarse de que
 *      ya se había pasado con el mensaje 4 entregado.
 *   3. **Horario**: difiere, no salta. Después del tope: si fuera antes, un
 *      mensaje que igual se iba a saltar esperaría horas para nada.
 *
 * La ventana de 24 h de Meta NO está acá: sólo aplica al texto libre, y es
 * justamente lo que una plantilla aprobada puede cruzar.
 */
export async function revisarTopesDeEnvio(
  deps: DepsTopesDeEnvio,
  entorno: EntornoAccion,
  ahora: Date,
  accion: string,
): Promise<ResultadoTopes> {
  // 1. TOPES DEL LEAD. Se mira la sesión ACTIVA del lead, no la de la
  // corrida, que puede haber cerrado mientras la corrida dormía.
  const sesionActiva = await deps.sessions.findActiveByLeadId(entorno.leadId);
  if (sesionActiva?.current_stage === "requiere_humano") {
    return {
      tipo: "salto",
      salto: {
        motivo: "requiere_humano",
        detalle: "El lead está en «requiere humano»: una persona está a cargo.",
      },
    };
  }

  const lead = await deps.leads.findById(entorno.leadId);
  if (!lead) {
    throw new NotFoundError(`lead no encontrado: ${entorno.leadId}`, "lead", entorno.leadId);
  }
  // Falla CERRADO: mandarle a alguien que se dio de baja porque un puerto no
  // se cableó es exactamente lo que el PRD §6.6 dice que no pasa "nunca".
  if (!deps.supresiones) {
    throw new IllegalStateError(
      `${accion} no tiene cableada la lista de bajas: no se manda sin poder chequearla`,
      "puerto_supresiones_ausente",
    );
  }
  // Un lead de Instagram/Messenger guarda un placeholder `ig:`/`fb:` en
  // `telefono`: no tiene número de WhatsApp y no puede estar en una lista de
  // bajas que es por teléfono.
  const telefono = normalizarTelefonoWhatsApp(lead.telefono);
  if (telefono !== null) {
    const bajas = await deps.supresiones.activasPorTelefonos([telefono]);
    if (bajas.length > 0) {
      return {
        tipo: "salto",
        salto: {
          motivo: "dado_de_baja",
          detalle: "El lead está en la lista de bajas: no recibe mensajes automáticos.",
        },
      };
    }
  }

  // 2. TOPE DE FRECUENCIA.
  const cfg = await deps.configProvider.activa();
  const desde = new Date(ahora.getTime() - VEINTICUATRO_HORAS_MS);
  // Las plantillas que salieron sin sesión no están en `mensajes` hasta que
  // el lead responde; una vez anotadas en el hilo ya las cuenta la primera.
  const usados =
    (await deps.messages.contarSalientesAutomaticos(entorno.leadId, desde)) +
    (await deps.plantillasSinSesion.contarNoAnotadasDesde(entorno.leadId, desde));
  if (usados >= cfg.max_salientes_automaticos_24h) {
    return {
      tipo: "salto",
      salto: {
        motivo: "tope_frecuencia",
        detalle: `Ya recibió ${usados} mensajes automáticos en 24 h; el tope es ${cfg.max_salientes_automaticos_24h}.`,
      },
    };
  }

  // 3. HORARIO. Una config sin horario falla en voz alta: saltearse el
  // chequeo mandaría a cualquier hora, y el fail-open de `estaAbierto` es para
  // una timezone que no se puede interpretar, no para una config ausente.
  if (!cfg.horario || !cfg.horario_timezone) {
    throw new ValidationError(
      "la config del agente no trae horario de atención: no se puede decidir si está abierto",
      "horario_config_ausente",
    );
  }
  if (!estaAbierto(cfg.horario, cfg.horario_timezone, ahora)) {
    const cuando = proximaApertura(cfg.horario, cfg.horario_timezone, ahora);
    // Sin un solo rango válido no hay hora hábil a la que diferir. Mandar
    // igual sería ignorar la decisión del dueño; diferir para siempre sería un
    // flujo mudo que nunca termina.
    if (!cuando) {
      throw new ValidationError(
        "el horario de atención no tiene ningún rango: no hay hora hábil a la que diferir",
        "horario_vacio",
      );
    }
    return { tipo: "diferir", hasta: cuando };
  }

  return { tipo: "sigue", lead };
}
