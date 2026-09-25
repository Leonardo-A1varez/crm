/**
 * Los datos del panel de salud de WhatsApp.
 *
 * Ninguna cifra de Meta está escrita a fuego en estos componentes: ni los
 * peldaños del cupo, ni el mínimo de uso, ni las duraciones de las sanciones.
 * Todo entra por props. Esas cifras las cambia Meta cuando quiere, y una
 * constante en un componente envejece sin avisar y después miente con cara de
 * dato. Lo que Meta publica y no expone por API vive, con su fuente, en
 * `app/(panel)/ajustes/_lib/politica-meta.ts`.
 */

/** Un peldaño de la escalera de cupo. */
export interface PeldanoCupo {
  /** Destinatarios distintos cada 24 h. `null` es el peldaño sin techo. */
  destinatariosPorDia: number | null;
  /** Cómo se escribe: "2.000", "ilimitado". */
  etiqueta: string;
}

export const CALIDADES = ["alta", "media", "baja", "sin-datos"] as const;
export type Calidad = (typeof CALIDADES)[number];

/**
 * Si se puede mandar, según el `health_status` de Meta. `detalle` y `motivo`
 * son el texto de Meta o el de la lectura que falló: no se redactan acá.
 */
export type EnvioSegunMeta =
  | { estado: "disponible" }
  | { estado: "limitado"; detalle: string }
  | { estado: "bloqueado"; detalle: string }
  | { estado: "sin-dato"; motivo: string };

/** Un número de WhatsApp de la cuenta. */
export interface NumeroWhatsApp {
  id: string;
  /** Como lo devuelve Meta. */
  numero: string;
  /** El nombre verificado que ve el cliente. `null` si Meta no lo devolvió. */
  nombre: string | null;
  calidad: Calidad;
  /** El valor crudo de Meta (`GREEN`, `NA`…), para cotejar con su administrador. */
  calidadCruda: string | null;
  envio: EnvioSegunMeta;
  /** Es el número por el que manda este CRM. */
  esElConfigurado: boolean;
}

/**
 * La primera condición del ascenso automático. `sin-dato` no es `cumplida`:
 * con un número sin calificar o una lectura caída no se puede afirmar nada.
 */
export type CondicionCalidad =
  | { estado: "cumplida" }
  | { estado: "falta"; pendientes: readonly string[] }
  | { estado: "sin-dato"; motivo: string };

/** La segunda condición: cuánto del cupo se usó en la ventana. */
export type UsoDelCupo =
  | {
      disponible: true;
      /** Uso de la ventana, en porcentaje del cupo. */
      pct: number;
      /** Días de uso sostenido que todavía faltan. `null` si esa parte ya está. */
      diasFaltantes: number | null;
    }
  | { disponible: false; motivo: string };

/**
 * El estado del ascenso de cupo. Son DOS condiciones que van juntas, y la
 * segunda es contraintuitiva: mandar poco también congela el ascenso.
 */
export interface EstadoCupo {
  peldanos: readonly PeldanoCupo[];
  /** Índice del peldaño en el que está hoy el portfolio. */
  actual: number;
  calidad: CondicionCalidad;
  uso: UsoDelCupo;
  /** El mínimo de uso que exige Meta para el ascenso, en porcentaje. */
  minimoPct: number;
  /** Sobre cuántos días se mide el uso. */
  ventanaDias: number;
  /**
   * Si no es `null`, salir del peldaño actual no es automático: vale
   * cualquiera de estas vías. Meta lo hace así en el primer peldaño.
   */
  desbloqueo: readonly string[] | null;
}

/** Un escalón de la escalera de sanciones de Meta. */
export interface EscalonSancion {
  id: string;
  nombre: string;
  /** Qué deja de poder hacerse, en castellano. */
  consecuencia: string;
  /** Cuánto dura, como lo dice la política: "1 o 3 días", "indefinido". */
  duracion: string;
  /** Lo que dice la política sobre apelarlo. `null` si no dice nada. */
  apelacion: string | null;
}

/**
 * Dónde está parada la cuenta en la escalera. Hoy la página sólo produce
 * `no-disponible`, porque Meta no expone el escalón por API. Los otros dos
 * quedan para cuando haya una fuente (el webhook `account_update`).
 */
export type PosicionEnEscalera =
  | { tipo: "sin-sancion" }
  | { tipo: "en-escalon"; indice: number; desde: string | null }
  | { tipo: "no-disponible"; motivo: string };

export const ESTADOS_PLANTILLA = [
  "aprobada",
  "en-revision",
  "pausada",
  "rechazada",
  "deshabilitada",
] as const;

export type EstadoPlantilla = (typeof ESTADOS_PLANTILLA)[number];

/**
 * Lo que puede mostrar la tabla de Ajustes: `EstadoPlantilla` más `otro`, para
 * los estados de Meta sin traducción (LIMIT_EXCEEDED, ARCHIVED…).
 *
 * Es un tipo aparte y no un miembro más de `EstadoPlantilla` porque Difusión
 * tipa sus plantillas con ese tipo e indexa `DESCRIPTOR_PLANTILLA` con él:
 * ensancharlo tocaba pantallas que no son de Ajustes.
 */
export type EstadoPlantillaLeida = EstadoPlantilla | "otro";

/** Una plantilla leída de Meta. Acá sólo se leen; se crean y se despausan allá. */
export interface PlantillaMeta {
  id: string;
  nombre: string;
  /** Una misma plantilla puede existir en varios idiomas, cada uno con su estado. */
  idioma: string | null;
  categoria: string;
  estado: EstadoPlantillaLeida;
  /** Por qué está como está, con el valor de Meta cuando lo hay. */
  nota: string;
  /**
   * Si hace falta despausarla A MANO: las pausadas por pacing no vuelven
   * solas. Ninguna lectura de Meta lo distingue hoy, así que llega en `false`.
   */
  requiereDespausadoManual: boolean;
  /**
   * En qué escalón del pausado por calidad está: 1 y 2 son pausas con reloj,
   * 3 es la deshabilitación. `null` cuando no se sabe o no está pausada.
   */
  escalonPausado: 1 | 2 | 3 | null;
}

/**
 * Un bloque de datos que puede no haber llegado. Tres desenlaces, porque lo
 * que no se pudo leer se reintenta recargando y lo que no está disponible no.
 */
export type Lectura<T> =
  | { estado: "ok"; datos: T }
  | { estado: "error"; mensaje: string }
  | { estado: "no-disponible"; motivo: string };
