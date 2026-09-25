import type { EstadoFlujo } from "@/components/workflows/lista/estado";

/**
 * Lo que estas pantallas dibujan. Es un view-model, no una entidad: los
 * componentes de esta carpeta son puros y deterministas —no leen el reloj, no
 * consultan la base, no formatean fechas— así que todo lo que depende del
 * "ahora" llega ya resuelto en texto.
 *
 * El motivo no es purismo. `WorkflowCard` (la tarjeta vieja) llama a
 * `Date.now()` adentro del render: el servidor pinta "hace 3 m", el cliente
 * hidrata un segundo después y puede pintar "hace 4 m". Pasando el texto ya
 * hecho, el problema no existe.
 */
export interface FlujoEnLista {
  id: string;
  nombre: string;
  estado: EstadoFlujo;
  /** Qué hace el flujo, en una línea. Los pasos unidos con flechas, ya armados. */
  resumen: string;
  /** Corridas de los últimos 30 días. */
  corridas30d: number;
  /** Corridas exitosas de esas mismas 30 días, para calcular la tasa acá. */
  exitosas30d: number;
  /** "hace 3 m", "ayer 09:14". `null` si nunca corrió. */
  ultimaEjecucion: string | null;
  /** Cuántas corridas hay vivas ahora mismo. Le da número a la promesa de pausar. */
  corridasEnCurso: number;
}

export type FiltroEstado = EstadoFlujo | "todos";

/** Una corrida en la lista del historial. */
export interface CorridaEnLista {
  id: string;
  /** Identificador corto que se muestra: `#a3d1`. */
  codigo: string;
  leadNombre: string;
  /** El vehículo del lead, si se conoce. Es lo que distingue dos leads homónimos. */
  leadVehiculo: string | null;
  cuando: string;
  duracion: string;
  fin: FinDeCorrida;
  /** Código de error de Meta u otro, si terminó mal. */
  codigoError: string | null;
}

export const FINES_DE_CORRIDA = [
  "terminada",
  "saltada",
  "fallada",
  "corriendo",
  "esperando",
  "cancelada",
] as const;

export type FinDeCorrida = (typeof FINES_DE_CORRIDA)[number];

/** Un paso de la corrida, tal como se ejecutó (o no). */
export interface PasoDeCorrida {
  id: string;
  nombre: string;
  /**
   * `recorrido`   pasó por acá y salió bien
   * `fallado`     acá se rompió
   * `saltado`     un tope de seguridad lo saltó y el lead salió del flujo
   * `no-tomado`   es una rama que existía y esta corrida no tomó
   * `pendiente`   todavía no llegó (corrida viva)
   */
  paso: EstadoDePaso;
  hora: string | null;
  duracion: string | null;
  /** Indentación cuando el paso cuelga de una condición. 0 es el tronco. */
  nivel: number;
  /** Por qué no se tomó esta rama (`no-tomado`) o qué tope lo saltó (`saltado`). */
  motivo: string | null;
}

export const ESTADOS_DE_PASO = [
  "recorrido",
  "saltado",
  "fallado",
  "no-tomado",
  "pendiente",
] as const;

export type EstadoDePaso = (typeof ESTADOS_DE_PASO)[number];

/** El detalle que se abre al elegir una corrida. */
export interface DetalleDeCorrida {
  corrida: CorridaEnLista;
  version: string;
  /** "arrancó ayer 09:14 · falló hoy 09:14 tras 3 intentos" */
  cronologia: string;
  pasos: readonly PasoDeCorrida[];
  /** Entrada del paso que falló, ya serializada línea por línea. */
  entrada: readonly string[];
  /** Salida del paso que falló. */
  salida: readonly string[];
  /** Cuántos pasos se reusan si se reanuda en vez de re-ejecutar. */
  pasosMemoizados: number;
  /**
   * Sólo en una corrida `saltada`: en qué paso un tope de seguridad saltó el
   * mensaje, y por qué. Es lo que alguien viene a preguntar: "¿por qué no le
   * llegó?".
   */
  salto?: { paso: string; motivo: string; explicacion: string };
}
