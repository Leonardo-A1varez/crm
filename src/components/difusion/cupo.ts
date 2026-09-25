import { formatearEntero } from "./formato";
import type { TramoCupo } from "./paleta";
import type { Cupo, SaludNumero, TandaReparto } from "./tipos";

/**
 * Lo que la pantalla deriva del cupo que calculó el servidor.
 *
 * Nada acá planifica. Cuánto entra por tanda, cuántas tandas hacen falta y
 * cuándo arranca cada una lo decide `planificarDifusion`
 * (`lib/difusion/planificador.ts`) y llega hecho en `Alcance.cupo` y
 * `Alcance.tandas`. Estas funciones sólo lo ponen en la forma que dibuja el
 * riel y en la frase que se lee arriba del pre-vuelo. Puras y sin React: son
 * la parte que decide si se habilita el botón, y se prueban sin montar nada.
 */

export interface RielCupo {
  tope: number;
  /**
   * Denominador del riel. Cuando algo no entra en la primera tanda, la escala
   * crece más allá del tope: eso es lo que hace que lo que sigue se dibuje
   * FUERA de la línea de tope en vez de clavarse en 100 %.
   */
  escala: number;
  /** Dónde cae la línea de tope, en % de la escala. */
  posicionTope: number;
  /** En el orden en que se consumen; sólo los que tienen algo. */
  tramos: { clave: TramoCupo; cantidad: number }[];
  /** Lo que queda sin usar de la tanda, cuando la difusión entra en una sola. */
  margen: number;
}

/**
 * El riel del medidor. `null` cuando no hay nada honesto que dibujar: sin el
 * escalón de Meta no hay tope, y con el escalón ilimitado no hay techo.
 */
export function rielDeCupo(cupo: Cupo, tandas: readonly TandaReparto[]): RielCupo | null {
  if (cupo.estado !== "ok" || cupo.tope === "ilimitado") return null;

  const tope = Math.max(0, cupo.tope);
  const usado = Math.max(0, cupo.usado24h);
  // La reserva se aparta de lo que queda: si lo usado ya se comió parte, lo
  // apartado es lo que hay, no el 15 % entero.
  const reserva = Math.min(Math.max(0, cupo.reserva), Math.max(0, cupo.restante));
  const primera = cupo.alcanza ? (tandas[0]?.porPlantilla ?? 0) : 0;
  // Sin cupo, el planificador no arma tandas: todo lo pedido queda afuera.
  const siguientes = cupo.alcanza
    ? tandas.slice(1).reduce((n, t) => n + t.porPlantilla, 0)
    : cupo.solicitado;

  const tramos: RielCupo["tramos"] = [
    { clave: "usado" as const, cantidad: usado },
    { clave: "reserva" as const, cantidad: reserva },
    { clave: "difusion" as const, cantidad: primera },
    { clave: "excedente" as const, cantidad: siguientes },
  ].filter((t) => t.cantidad > 0);

  const escala = Math.max(tope, usado + reserva + primera + siguientes, 1);
  return {
    tope,
    escala,
    posicionTope: (tope / escala) * 100,
    tramos,
    margen: cupo.alcanza && tandas.length <= 1 ? Math.max(0, cupo.porTanda - primera) : 0,
  };
}

export type NivelVerdicto = "listo" | "reparto" | "bloqueado";

export interface Verdicto {
  nivel: NivelVerdicto;
  /** Una frase, en presente, que dice qué va a pasar al programar. */
  titulo: string;
  /** El porqué, con el número que lo sostiene. */
  detalle: string;
  color: string;
}

export interface EntradaVerdicto {
  destinatarios: number;
  cupo: Cupo;
  tandas: readonly TandaReparto[];
  salud: SaludNumero;
  /** La elegida en el paso Mensaje; `elegible` según su estado de hoy en Meta. */
  plantilla: { nombre: string; elegible: boolean } | null;
}

const ROJO = "var(--color-danger)";

function bloqueado(titulo: string, detalle: string): Verdicto {
  return { nivel: "bloqueado", titulo, detalle, color: ROJO };
}

/**
 * El veredicto es lo primero que se lee en el pre-vuelo y lo último que se
 * repite al lado del botón. Todo lo demás en la pantalla es la evidencia.
 *
 * Los bloqueos que dependen del cupo repiten los que aplica el servidor al
 * programar (sin plantilla, sin destinatarios, sin escalón, sin cupo): acá se
 * dicen antes de apretar. La calidad baja y el envío bloqueado por Meta
 * frenan sólo en la pantalla: el servidor no los mira.
 */
export function evaluarEnvio(e: EntradaVerdicto): Verdicto {
  if (e.plantilla === null) {
    return bloqueado(
      "Falta la plantilla",
      "Sin plantilla no hay qué mandarle a quien no tiene la ventana abierta.",
    );
  }
  if (!e.plantilla.elegible) {
    return bloqueado(
      "La plantilla ya no se puede usar",
      `${e.plantilla.nombre} dejó de estar aprobada en Meta. Volvé al paso Mensaje y elegí otra.`,
    );
  }
  if (e.destinatarios === 0) {
    return bloqueado(
      "No queda nadie a quién mandarle",
      "Todos los de la audiencia quedan excluidos por alguno de los motivos de la lista.",
    );
  }
  if (e.salud.envio.estado === "bloqueado") {
    return bloqueado("Meta marca el envío como bloqueado", e.salud.envio.detalle);
  }
  if (e.salud.calidad.estado === "ok" && e.salud.calidad.valor.calidad === "baja") {
    return bloqueado(
      "No se puede enviar",
      "La calidad del número está en baja. Una difusión ahora acelera la sanción en vez de vender.",
    );
  }
  if (e.cupo.estado === "sin-dato") {
    return bloqueado(
      "No se sabe cuántos entran por día",
      `No se pudo leer el nivel de mensajería de Meta: ${e.cupo.motivo}`,
    );
  }

  const cupo = e.cupo;
  if (!cupo.alcanza) {
    return bloqueado(
      "No hay cupo para plantillas",
      `Quedan ${formatearEntero(cupo.restante)} de las últimas 24 h y ${formatearEntero(cupo.reserva)} están reservados para conversaciones vivas: no entra ninguna plantilla.`,
    );
  }

  const ultima = e.tandas.at(-1);
  if (e.tandas.length > 1 && ultima) {
    return {
      nivel: "reparto",
      titulo: `Sale en ${e.tandas.length} tandas de 24 h`,
      detalle: `Por plantilla entran ${formatearEntero(cupo.porTanda)} por tanda. La última arranca ${ultima.desde}.`,
      color: "var(--color-caution)",
    };
  }

  const margen =
    cupo.tope === "ilimitado"
      ? null
      : Math.max(0, cupo.porTanda - (e.tandas[0]?.porPlantilla ?? 0));
  return {
    nivel: "listo",
    titulo: "Entra en una sola tanda",
    detalle: `Los ${formatearEntero(e.destinatarios)} salen en la primera tanda${
      margen === null ? "" : ` y quedan ${formatearEntero(margen)} de margen en la ventana de 24 h`
    }.`,
    color: "var(--color-ok)",
  };
}

/** Porcentaje de un tramo sobre la escala del riel, sin dividir por cero. */
export function anchoTramo(cantidad: number, escala: number): number {
  if (escala <= 0) return 0;
  return Math.max(0, Math.min(100, (cantidad / escala) * 100));
}
