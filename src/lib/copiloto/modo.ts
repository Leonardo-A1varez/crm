import { esTimezoneValida, estaAbierto, tieneAlgunRango } from "@/lib/agente/horario";
import type { Horario } from "@/types/agente";
import type { ModoDecidido, ModoOverride } from "@/types/copiloto";

/**
 * La regla de §3.2 en una frase: "Copiloto" fijo es siempre Copiloto;
 * "Automático" fijo es Automático si el agente está abierto y Fuera de horario
 * si no; "Según horario" (`override = null`) es Copiloto si el equipo está
 * abierto, si no Automático si el agente está abierto, y si no Fuera de horario.
 */
export function decidirModo(input: {
  override: ModoOverride | null;
  equipoAbierto: boolean;
  agenteAbierto: boolean;
}): ModoDecidido {
  if (input.override === "copiloto") return "copiloto";
  if (input.override === "automatico") {
    return input.agenteAbierto ? "automatico" : "fuera_de_horario";
  }
  if (input.equipoAbierto) return "copiloto";
  return input.agenteAbierto ? "automatico" : "fuera_de_horario";
}

/**
 * ¿Hay personas del equipo ahora? Zona inválida o sin un solo rango cuenta como
 * equipo cerrado: `estaAbierto` devuelve `true` ante una zona inválida (para el
 * agente es lo seguro: no callar al cliente), pero para el equipo sería declarar
 * presencia que nadie tiene y dejar mensajes esperando un borrador que nadie
 * envía.
 */
export function equipoAbiertoAhora(
  config: { horario_equipo: Horario; horario_timezone: string },
  ahora: Date,
): boolean {
  return (
    esTimezoneValida(config.horario_timezone) &&
    tieneAlgunRango(config.horario_equipo) &&
    estaAbierto(config.horario_equipo, config.horario_timezone, ahora)
  );
}
