import { ValidationError } from "@/lib/errors";
import type { UUID } from "@/types/entities";

/*
 * Round robin de vendedores sin estado propio.
 *
 * El reparto clásico guarda un puntero ("le tocó a Beto, sigue Cami"), y ese
 * puntero se desincroniza apenas alguien asigna a mano, un vendedor se va o dos
 * flujos reparten a la vez. Acá no hay puntero: el turno se deduce de las
 * sesiones ya asignadas —le toca al que hace más tiempo que no recibe—, así que
 * el mismo historial da siempre la misma respuesta y una asignación manual
 * cuenta igual que una automática.
 */

/** Un vendedor de la lista del nodo, en el orden en que lo cargó el admin. */
export interface CandidatoRoundRobin {
  id: UUID;
  /** `false` = no está (inactivo, o ya no existe): se saltea aunque le toque. */
  disponible: boolean;
}

/**
 * Lo que dicen las sesiones de un vendedor. Lo arma
 * `LeadSessionRepository.resumenAsignaciones`. Un vendedor sin ninguna sesión
 * asignada no tiene entrada, y eso se lee como "nunca recibió".
 */
export interface HistorialVendedor {
  vendedorId: UUID;
  /** La asignación más reciente de las sesiones que tiene. */
  ultimaAsignacionAt: Date;
  /** Sesiones abiertas (sin resultado) que tiene asignadas. Es lo que mide el tope. */
  sesionesAbiertas: number;
}

export interface OpcionesRoundRobin {
  /**
   * Máximo de sesiones **abiertas a la vez** por persona; `null` = sin tope.
   *
   * Cuenta abiertas y no "recibidas en el día": lo que el tope cuida es la
   * capacidad de atender, y una sesión cerrada ya no le pide nada a nadie.
   */
  tope: number | null;
}

export type MotivoSinVendedor =
  /** La lista está vacía: es un nodo mal configurado, no una falta de gente. */
  | "sin_candidatos"
  /** Nadie de la lista está disponible. */
  | "ninguno_disponible"
  /** Hay gente disponible, pero toda está en su tope. */
  | "todos_en_tope";

export type EleccionRoundRobin =
  | { tipo: "elegido"; vendedorId: UUID }
  | { tipo: "sin_vendedor"; motivo: MotivoSinVendedor };

/**
 * A quién le toca la próxima sesión.
 *
 * 1. Saltea a los no disponibles.
 * 2. Saltea a los que ya tienen `tope` sesiones abiertas.
 * 3. De los que quedan, el que hace más tiempo que no recibe; quien nunca
 *    recibió va antes que cualquiera que ya recibió.
 * 4. Empate: el que va antes en la lista. Con ids repetidos vale la primera
 *    aparición, así la posición de cada uno es una sola.
 *
 * Si un vendedor aparece dos veces en el historial, sus entradas se combinan:
 * la asignación más reciente y la suma de abiertas.
 *
 * Pura: no lee el reloj ni guarda nada entre llamadas.
 */
export function elegirVendedorRoundRobin(
  candidatos: readonly CandidatoRoundRobin[],
  historial: readonly HistorialVendedor[],
  opciones: OpcionesRoundRobin,
): EleccionRoundRobin {
  const { tope } = opciones;
  if (tope !== null && !(Number.isInteger(tope) && tope >= 1)) {
    throw new ValidationError(
      `el tope por persona tiene que ser un entero mayor que cero: ${tope}`,
      "tope_invalido",
    );
  }

  const unicos = primeraAparicion(candidatos);
  if (unicos.length === 0) return { tipo: "sin_vendedor", motivo: "sin_candidatos" };

  const presentes = unicos.filter((c) => c.disponible);
  if (presentes.length === 0) return { tipo: "sin_vendedor", motivo: "ninguno_disponible" };

  const cargas = cargaPorVendedor(historial);
  const conLugar = presentes.filter(
    (c) => tope === null || (cargas.get(c.id)?.abiertas ?? 0) < tope,
  );
  if (conLugar.length === 0) return { tipo: "sin_vendedor", motivo: "todos_en_tope" };

  const ultimaMs = (c: CandidatoRoundRobin): number =>
    cargas.get(c.id)?.ultimaMs ?? Number.NEGATIVE_INFINITY;
  // `<` estricto: ante un empate se queda el que venía antes en la lista.
  const elegido = conLugar.reduce((mejor, c) => (ultimaMs(c) < ultimaMs(mejor) ? c : mejor));
  return { tipo: "elegido", vendedorId: elegido.id };
}

function primeraAparicion(candidatos: readonly CandidatoRoundRobin[]): CandidatoRoundRobin[] {
  const vistos = new Set<UUID>();
  return candidatos.filter((c) => {
    if (vistos.has(c.id)) return false;
    vistos.add(c.id);
    return true;
  });
}

interface Carga {
  ultimaMs: number;
  abiertas: number;
}

function cargaPorVendedor(historial: readonly HistorialVendedor[]): Map<UUID, Carga> {
  const cargas = new Map<UUID, Carga>();
  for (const h of historial) {
    const previa = cargas.get(h.vendedorId);
    const ms = h.ultimaAsignacionAt.getTime();
    cargas.set(h.vendedorId, {
      ultimaMs: previa ? Math.max(previa.ultimaMs, ms) : ms,
      abiertas: (previa?.abiertas ?? 0) + h.sesionesAbiertas,
    });
  }
  return cargas;
}
