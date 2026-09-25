import { normalizarTelefonoWhatsApp } from "./telefono";

/**
 * El teléfono como puede salir del servidor hacia la pantalla.
 *
 * La lista de destinatarios se lee, se captura y se reenvía; el número entero
 * no le hace falta a nadie para decidir si una difusión sale. Quedan el
 * prefijo —que dice de qué país es— y los últimos dígitos, que alcanzan para
 * reconocer a alguien que ya se conoce. Un número corto muestra menos: con
 * siete dígitos, prefijo y cola serían casi el número entero.
 *
 * Normaliza antes, con la misma función que usa todo Difusión, así que un
 * placeholder `ig:` o `fb:` no se muestra como si fuera un teléfono.
 */
export function enmascararTelefono(crudo: string | null): string {
  const d = normalizarTelefonoWhatsApp(crudo);
  if (d === null) return "—";
  const prefijo = `+${d.slice(0, 3)}`;
  if (d.length >= 11) return `${prefijo} ••• ••• ${d.slice(-3)}`;
  if (d.length >= 9) return `${prefijo} ••• ${d.slice(-2)}`;
  return `${prefijo} •••`;
}
