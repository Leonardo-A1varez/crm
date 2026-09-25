import type { CategoriaPlantilla, EstadoEntrega, GrupoEstado, RutaEnvio } from "./tipos";

/**
 * Roles de color de Difusión, sobre los tokens que ya existen en
 * `globals.css`. No hay un hex nuevo en toda la carpeta: el mismo
 * `--color-danger` que significa "perdido" en Leads significa "falló" acá, y
 * repintarlo solo en esta pantalla haría que el mismo hecho tuviera dos
 * colores en dos lugares.
 *
 * ── Validación (no se estimó a ojo: se corrió el validador de la skill
 * `dataviz`, `scripts/validate_palette.js`, contra las superficies reales
 * `--surface-card` #0f1116 en oscuro y #ffffff en claro) ────────────────────
 *
 * Re-medido el 2026-09-03, cuando los seis tokens semánticos se
 * re-escalonaron en `globals.css`.
 *
 * Riel del cupo — 4 tramos, pares adyacentes (que es el pairlist correcto
 * para una barra apilada: solo se tocan los vecinos):
 *   node validate_palette.js "#5f6672,#f7d710,#99cbfe,#f9667c" --mode dark  --surface "#0f1116"
 *   node validate_palette.js "#757c89,#8f5509,#2362a9,#c52a4d" --mode light --surface "#ffffff"
 *   oscuro: CVD ΔE 18.0 (deutan) · normal 26.7 · contraste 4/4 ≥ 3:1  → PASS
 *   claro:  CVD ΔE 14.3 (deutan) · normal 15.3 · contraste 4/4 ≥ 3:1  → PASS
 *
 * Estados de entrega — se validan POR GRUPO, no como una paleta plana. Como
 * paleta plana fallaba duro en claro (`caution` contra `danger`, "aceptado" y
 * "falló", el par que esta pantalla existe para separar). La salida fue
 * **facetear**: los estados se dibujan en grupos con separador, así que
 * caution y danger nunca son vecinos.
 *   en vuelo   "#5f6672,#f7d710" dark  → CVD 40.0 · normal 42.1  PASS
 *              "#757c89,#8f5509" light → CVD 14.3 · normal 15.3  PASS
 *   resuelto   "#31d7a5,#99cbfe,#f9667c" dark  → CVD 11.6 · normal 16.9  PASS
 *              "#097957,#2362a9,#c52a4d" light → TODOS LOS CHECKS PASAN
 *
 * `cancelado` (2026-09-14) no entra en ninguno de los dos. Pegado a `fallido`
 * —el único lugar donde encajaba, en la barra y en el grupo resuelto— da en
 * oscuro ΔE 3.0 en protanopía, bajo el piso de 6 que ni la codificación
 * secundaria habilita:
 *   node validate_palette.js "#99cbfe,#31d7a5,#f7d710,#5f6672,#f9667c,#7c838e" --mode dark --surface "#0f1116"
 *   → CVD separation FAIL · worst adjacent #7c838e↔#f9667c ΔE 3.0 (protan)
 * Por eso tiene grupo propio de un solo estado —sin vecinos de color— y en la
 * barra apilada no se pinta: es el tramo vacío del final, lo que el envío ya
 * no va a ocupar. Contra la superficie pasa 3:1 en los dos temas (#7c838e
 * sobre #0f1116 y #646b78 sobre #ffffff, en la misma corrida).
 *
 * Dos checks quedan en FAIL a propósito y no se van a "arreglar":
 *  · **Chroma floor** sobre los neutros: el tramo "usado", "en cola" y
 *    "cancelado" TIENEN que leerse grises — son la ausencia de algo, no una
 *    identidad más de la escala categórica.
 *  · **Lightness band** en oscuro sobre `caution`/`info`/`danger`/`ok`: son los
 *    tokens del propio producto. El riesgo que esa banda vigila —que la marca
 *    se lave contra el fondo— se mide directo con "Contrast vs surface", que
 *    pasa 3:1 en todos.
 *
 * Cada estado lleva además ícono propio, etiqueta de texto y su cifra en mono:
 * el color nunca es lo único que distingue dos estados.
 */

export const COLOR_CUPO = {
  /** Ya gastado en las últimas 24 h. Gris a propósito: es pasado. */
  usado: "var(--color-ink-ghost)",
  /** Apartado para conversaciones vivas. */
  reserva: "var(--color-caution)",
  /** Lo que esta difusión mete en la primera tanda. */
  difusion: "var(--color-info)",
  /** Lo que queda para las tandas siguientes. Va rayado además de rojo. */
  excedente: "var(--color-danger)",
} as const;

export type TramoCupo = keyof typeof COLOR_CUPO;

interface EstiloEstado {
  color: string;
  grupo: GrupoEstado;
  etiqueta: string;
  /** La aclaración que hace falta para que el nombre no mienta. */
  glosa: string;
}

export const ESTADO_ENTREGA: Record<EstadoEntrega, EstiloEstado> = {
  en_cola: {
    color: "var(--color-ink-ghost)",
    grupo: "en_vuelo",
    etiqueta: "En cola",
    glosa: "todavía no se pidió nada a Meta",
  },
  aceptado: {
    color: "var(--color-caution)",
    grupo: "en_vuelo",
    etiqueta: "Aceptado",
    glosa: "Meta recibió el pedido y devolvió wamid — no garantiza entrega",
  },
  entregado: {
    color: "var(--color-ok)",
    grupo: "resuelto",
    etiqueta: "Entregado",
    glosa: "llegó al teléfono",
  },
  leido: {
    color: "var(--color-info)",
    grupo: "resuelto",
    etiqueta: "Leído",
    glosa: "lo abrieron",
  },
  fallido: {
    color: "var(--color-danger)",
    grupo: "resuelto",
    etiqueta: "Falló",
    glosa: "con código de error de Meta",
  },
  cancelado: {
    color: "var(--color-ink-faint)",
    grupo: "frenado",
    etiqueta: "Cancelado",
    glosa: "estaba en cola al detener: no sale",
  },
};

export const ORDEN_ESTADOS: readonly EstadoEntrega[] = [
  "en_cola",
  "aceptado",
  "entregado",
  "leido",
  "fallido",
  "cancelado",
];

export const ETIQUETA_GRUPO: Record<GrupoEstado, string> = {
  en_vuelo: "En vuelo · no llegó a ningún teléfono",
  resuelto: "Resuelto",
  frenado: "Frenado · no va a salir",
};

/**
 * El color de un fallo según la tabla de §4.4: lo que no se reintenta en rojo,
 * lo que se reintenta en ámbar y un código que la tabla no conoce, gris.
 */
export function colorDeFallo(reintentable: boolean | null): string {
  if (reintentable === null) return "var(--color-ink-faint)";
  return reintentable ? "var(--color-caution)" : "var(--color-danger)";
}

export const ETIQUETA_RUTA: Record<RutaEnvio, string> = {
  ventana_abierta: "ventana abierta",
  plantilla: "plantilla",
};

export const COLOR_RUTA: Record<RutaEnvio, string> = {
  /** Verde porque es gratis y no consume cupo: es la ruta buena. */
  ventana_abierta: "var(--color-ok)",
  plantilla: "var(--color-caution)",
};

interface EstiloCategoria {
  etiqueta: string;
  color: string;
  /** Cuándo se cobra, en una frase. */
  cobro: string;
  /** Si cuenta contra el tope de marketing que Meta le pone a cada persona. */
  cuentaEnTope: boolean;
}

/**
 * Las dos categorías con que sale una difusión y lo que implica cada una.
 *
 * Las dos reglas salen de `docs/prd-workflows-difusion.md` §4.3 (el tope por
 * persona es de plantillas de marketing, en ventana móvil de 7 días) y §4.8
 * (marketing se cobra siempre; utility es gratis dentro de la ventana).
 */
export const CATEGORIA_PLANTILLA: Record<CategoriaPlantilla, EstiloCategoria> = {
  marketing: {
    etiqueta: "Marketing",
    color: "var(--color-caution)",
    cobro: "Se cobra siempre, por mensaje entregado.",
    cuentaEnTope: true,
  },
  utility: {
    etiqueta: "Utility",
    color: "var(--color-info)",
    cobro: "Se cobra por mensaje entregado fuera de la ventana de servicio. Adentro es gratis.",
    cuentaEnTope: false,
  },
};

/**
 * Fondo tenue de un bloque de aviso: el mismo color al 9%, que es donde los
 * `ink-*` del tema siguen llegando a 4.5:1 encima. Igual criterio que
 * `stageBadgeBackground()` en `lib/ui/stage.ts`.
 */
export function tinte(color: string, porcentaje = 9): string {
  return `color-mix(in srgb, ${color} ${porcentaje}%, transparent)`;
}

/**
 * Relleno rayado de lo que no entra en la primera tanda. La trama es la
 * codificación secundaria que pide `dataviz` para que siga siendo legible sin
 * color: en blanco y negro, o para un daltónico, el tramo que sobra sigue
 * siendo el rayado.
 */
export function rayado(color: string): {
  backgroundColor: string;
  backgroundImage: string;
} {
  return {
    backgroundColor: tinte(color, 26),
    backgroundImage: `repeating-linear-gradient(135deg, ${color} 0 2px, transparent 2px 6px)`,
  };
}
