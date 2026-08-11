import type { VentanaActividad } from "@/types/leads";

export interface CotasActividad {
  /** Inclusiva. */
  actualizadoDesde?: Date;
  /** Exclusiva. */
  actualizadoHasta?: Date;
}

const DIA_MS = 24 * 60 * 60 * 1000;

/**
 * Cotas de `updated_at` para cada ventana del filtro de actividad.
 *
 * "Hoy" es el día calendario local y no las últimas 24 h: quien filtra a las
 * 9 de la mañana espera ver lo de esa mañana, no lo de ayer a la tarde. Las
 * otras dos son ventanas móviles porque no responden a una fecha sino a una
 * antigüedad: "esta semana" son los últimos 7 días y "hace más de 30" es todo
 * lo anterior a 30 días atrás, contados desde `ahora`.
 *
 * `ahora` se inyecta y no se lee del reloj adentro: leer la hora dentro del
 * render viola `react-hooks/purity` y, en el servicio, haría el filtro
 * intesteable.
 */
export function cotasActividad(ventana: VentanaActividad | undefined, ahora: Date): CotasActividad {
  if (ventana === "hoy") {
    const inicio = new Date(ahora);
    inicio.setHours(0, 0, 0, 0);
    return { actualizadoDesde: inicio };
  }
  if (ventana === "semana") {
    return { actualizadoDesde: new Date(ahora.getTime() - 7 * DIA_MS) };
  }
  if (ventana === "mas_30") {
    return { actualizadoHasta: new Date(ahora.getTime() - 30 * DIA_MS) };
  }
  return {};
}
