import { separarTelefono } from "@/lib/ui/telefono";
import type { CodigoTelefono } from "@/lib/ui/telefono";
import type { ReactNode } from "react";

/**
 * Bandera del país del teléfono, dibujada en SVG inline.
 *
 * **No son emoji a propósito.** Windows no trae glifos de bandera en su fuente
 * de emoji: Chrome y Edge sobre Windows renderizan `🇪🇨` como las dos letras
 * "EC" —el par de símbolos indicadores regionales sin componer—. El dueño del
 * producto trabaja en Windows 11, así que el emoji mostraría texto donde tiene
 * que haber una bandera. El SVG se ve igual en los tres sistemas.
 *
 * Franjas y nada más: sin escudos, soles ni estrellas de ocho puntas. A 16×11
 * un escudo es una mancha, y dibujarlo bien costaría más path que las ocho
 * banderas juntas. La consecuencia asumida: Colombia y Ecuador comparten el
 * tricolor de la Gran Colombia y, sin escudo, se distinguen solo por el tono.
 * Por eso el `aria-label` y el `title` nombran el país — quien dude, lo lee.
 */

/** Alto de las tres franjas horizontales cuando son iguales (11 / 3). */
const TERCIO = 11 / 3;
/** Ancho de las tres franjas verticales cuando son iguales (16 / 3). */
const TERCIO_ANCHO = 16 / 3;

/**
 * Trazos por código de país, sin el `<svg>` que los envuelve.
 *
 * El `Record` está tipado contra los códigos de `telefono.ts`: agregar un país
 * al mercado sin dibujarle la bandera no compila, que es la única forma de que
 * la tabla no se desincronice en silencio.
 */
const BANDERAS: Record<CodigoTelefono, ReactNode> = {
  // Perú: vertical rojo–blanco–rojo.
  "51": (
    <>
      <rect width="16" height="11" fill="#D91023" />
      <rect x={TERCIO_ANCHO} width={TERCIO_ANCHO} height="11" fill="#FFFFFF" />
    </>
  ),
  // México: vertical verde–blanco–rojo (sin el águila).
  "52": (
    <>
      <rect width={TERCIO_ANCHO} height="11" fill="#006847" />
      <rect x={TERCIO_ANCHO} width={TERCIO_ANCHO} height="11" fill="#FFFFFF" />
      <rect x={TERCIO_ANCHO * 2} width={TERCIO_ANCHO} height="11" fill="#CE1126" />
    </>
  ),
  // Argentina: horizontal celeste–blanco–celeste (sin el sol de mayo).
  "54": (
    <>
      <rect width="16" height="11" fill="#74ACDF" />
      <rect y={TERCIO} width="16" height={TERCIO} fill="#FFFFFF" />
    </>
  ),
  // Brasil: verde, rombo amarillo y círculo azul. La única que no es de
  // franjas; sin el rombo no se parece a nada.
  "55": (
    <>
      <rect width="16" height="11" fill="#009B3A" />
      <path d="M8 1.3 14.7 5.5 8 9.7 1.3 5.5Z" fill="#FEDF00" />
      <circle cx="8" cy="5.5" r="2.3" fill="#002776" />
    </>
  ),
  // Chile: blanco arriba, rojo abajo, cantón azul con estrella.
  "56": (
    <>
      <rect width="16" height="11" fill="#FFFFFF" />
      <rect y="5.5" width="16" height="5.5" fill="#D52B1E" />
      <rect width="5.5" height="5.5" fill="#0039A6" />
      <path
        d="M2.75 1.25 3.09 2.29 4.18 2.29 3.3 2.93 3.63 3.96 2.75 3.32 1.87 3.96 2.2 2.93 1.32 2.29 2.41 2.29Z"
        fill="#FFFFFF"
      />
    </>
  ),
  // Colombia: amarillo a la mitad, azul y rojo un cuarto cada uno.
  "57": (
    <>
      <rect width="16" height="11" fill="#FCD116" />
      <rect y="5.5" width="16" height="2.75" fill="#003893" />
      <rect y="8.25" width="16" height="2.75" fill="#CE1126" />
    </>
  ),
  // Ecuador: mismo reparto que Colombia; cambian los tonos, no las franjas.
  "593": (
    <>
      <rect width="16" height="11" fill="#FFDD00" />
      <rect y="5.5" width="16" height="2.75" fill="#034EA2" />
      <rect y="8.25" width="16" height="2.75" fill="#ED1C24" />
    </>
  ),
  // Paraguay: horizontal rojo–blanco–azul (sin el escudo del centro).
  "595": (
    <>
      <rect width="16" height="11" fill="#D52B1E" />
      <rect y={TERCIO} width="16" height={TERCIO} fill="#FFFFFF" />
      <rect y={TERCIO * 2} width="16" height={TERCIO} fill="#0038A8" />
    </>
  ),
};

/**
 * La bandera del país al que pertenece el teléfono, o nada.
 *
 * Misma regla que `formatearTelefono`: lo que no matchea un código de la tabla
 * —un país fuera del mercado, o el `ig:<id>` que guardan los leads sin
 * WhatsApp— no dibuja nada. Poner una bandera adivinada al lado de un número
 * que el vendedor va a marcar es peor que no poner ninguna.
 */
export function BanderaTelefono({ telefono }: { telefono: string }) {
  const partido = separarTelefono(telefono);
  if (!partido) return null;

  return (
    <svg
      width="16"
      height="11"
      viewBox="0 0 16 11"
      role="img"
      aria-label={`Bandera de ${partido.pais}`}
      className="shrink-0 rounded-[2px]"
    >
      <title>{partido.pais}</title>
      {BANDERAS[partido.codigo]}
      {/* Borde de medio pixel: sin él, el blanco de Argentina, Perú o Paraguay
          se derrama sobre el panel y la bandera pierde el contorno. */}
      <rect
        x="0.25"
        y="0.25"
        width="15.5"
        height="10.5"
        rx="1.5"
        fill="none"
        stroke="rgba(0,0,0,0.28)"
        strokeWidth="0.5"
      />
    </svg>
  );
}
