import type {
  LecturaMeta,
  LimiteDeMensajeria,
} from "@/server/services/meta/salud-whatsapp.service";
import type { LecturaTope } from "./difusion.service";

/**
 * El escalón de mensajería que devolvió Meta, en la forma que pide el
 * planificador. Lo que no se sabe leer no se adivina: un escalón que la
 * lectura no reconoce (`TIER_NOT_SET`, uno que Meta agregue mañana) vuelve sin
 * dato, con el valor crudo en el motivo, y con él no se programa ninguna
 * difusión.
 */
export function topeDesdeLimite(limite: LecturaMeta<LimiteDeMensajeria>): LecturaTope {
  switch (limite.estado) {
    case "ok":
      return limite.valor.destinatarios === null
        ? {
            estado: "sin-dato",
            motivo: `Meta devolvió ${limite.valor.crudo}, que no se sabe leer como cantidad de destinatarios por día.`,
          }
        : { estado: "ok", tope: limite.valor.destinatarios };
    case "error":
      return {
        estado: "sin-dato",
        motivo: `No se pudo leer el nivel de mensajería de Meta: ${limite.mensaje}`,
      };
    case "no-expuesto":
      return { estado: "sin-dato", motivo: limite.motivo };
  }
}
