import { tinte } from "@/components/workflows/lista/estado";
import type { EstadoDePaso, PasoDeCorrida } from "@/components/workflows/lista/tipos";

const ALTO_NODO = 26;
const PASO_Y = 38;
const ANCHO_NODO = 156;
const SANGRIA = 26;
const X_BASE = 10;
const MARGEN_Y = 8;

interface Trazo {
  color: string;
  /** Rayado para lo que no ocurrió: la línea llena significa "esto pasó". */
  rayado: boolean;
  /** Cuánto pesa el nodo. El que falló es el único grueso. */
  grosor: number;
  /** Cómo se llama el estado, para el `<title>` y la leyenda. */
  palabra: string;
}

/**
 * El color, el rayado y el grosor de cada estado de paso.
 *
 * El color NO va solo. Verde y rojo se separaban ΔE 6.5 en deuteranopía sobre
 * el fondo oscuro del panel; el re-escalonado del 2026-09-03 los llevó a 8.0
 * —medido con `node scripts/verificar-paleta-clara.mjs`, no estimado—, que es
 * justo el objetivo, sin margen. Si el único diferenciador fuera el tinte, un
 * lector de cada doce leería este diagrama al límite. Por eso cada estado
 * cambia también el trazo:
 * lleno contra rayado, y el que falló es el único con borde grueso. Encima, la
 * línea de tiempo de al lado escribe el estado con todas las letras.
 */
const TRAZO: Record<EstadoDePaso, Trazo> = {
  recorrido: { color: "var(--color-ok)", rayado: false, grosor: 1.25, palabra: "pasó por acá" },
  saltado: {
    color: "var(--color-special)",
    rayado: false,
    grosor: 1.75,
    palabra: "un tope lo saltó y el lead salió",
  },
  fallado: { color: "var(--color-danger)", rayado: false, grosor: 2.25, palabra: "falló acá" },
  "no-tomado": {
    color: "var(--color-line-control)",
    rayado: true,
    grosor: 1.25,
    palabra: "rama que no se tomó",
  },
  pendiente: {
    color: "var(--color-ink-ghost)",
    rayado: true,
    grosor: 1.25,
    palabra: "todavía no llegó",
  },
};

/** Corta sin partir el sentido: la SVG no tiene `text-overflow`. */
function recortar(texto: string, max: number): string {
  return texto.length <= max ? texto : `${texto.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Para cada paso, de cuál cuelga.
 *
 * El anterior con nivel MENOR O IGUAL. Si el nivel es el mismo, es una
 * continuación y la línea baja recta; si es menor, el paso cuelga de una
 * condición y la línea hace codo. Con esa única regla se dibujan tanto el
 * tronco como las ramas, sin necesitar un árbol explícito en los datos.
 */
function padres(pasos: readonly PasoDeCorrida[]): readonly (number | null)[] {
  return pasos.map((paso, i) => {
    for (let j = i - 1; j >= 0; j--) {
      const anterior = pasos[j];
      if (anterior !== undefined && anterior.nivel <= paso.nivel) return j;
    }
    return null;
  });
}

/**
 * El flujo dibujado con el camino que la corrida recorrió de verdad.
 *
 * Se dibuja el CAMINO, no el grafo entero. Para una corrida, el recorrido es
 * una secuencia: de cada condición sale una rama tomada y las otras quedan como
 * muñones colgando. Pintar el grafo completo y después resaltar por encima
 * obliga a buscar el hilo entre nodos que esa corrida nunca vio; pintar el
 * camino y colgar los muñones muestra lo mismo y ya viene leído.
 */
export function CaminoRecorrido({ pasos }: { pasos: readonly PasoDeCorrida[] }) {
  if (pasos.length === 0) {
    return (
      <p className="text-ink-ghost text-[11.5px]">Esta corrida no llegó a ejecutar un paso.</p>
    );
  }

  const deQuienCuelga = padres(pasos);
  const alto = pasos.length * PASO_Y + MARGEN_Y * 2 - (PASO_Y - ALTO_NODO);
  const nivelMax = pasos.reduce((max, p) => Math.max(max, p.nivel), 0);
  const ancho = X_BASE * 2 + ANCHO_NODO + nivelMax * SANGRIA;

  const x = (nivel: number) => X_BASE + nivel * SANGRIA;
  const y = (i: number) => MARGEN_Y + i * PASO_Y;

  return (
    <figure className="flex flex-col gap-3">
      <svg
        viewBox={`0 0 ${ancho} ${alto}`}
        width={ancho}
        height={alto}
        role="img"
        aria-label={`Camino recorrido: ${pasos.length} pasos, ${pasos.filter((p) => p.paso === "recorrido").length} ejecutados`}
        className="max-w-full"
      >
        {pasos.map((paso, i) => {
          const padre = deQuienCuelga[i];
          if (padre === null || padre === undefined) return null;
          const previo = pasos[padre];
          if (previo === undefined) return null;

          const trazo = TRAZO[paso.paso];
          const xHijo = x(paso.nivel);
          const xPadre = x(previo.nivel);
          const yDesde = y(padre) + ALTO_NODO;
          const yHasta = y(i);
          // Codo cuando el hijo cuelga más adentro; recta cuando continúa.
          const d =
            paso.nivel > previo.nivel
              ? `M ${xPadre + 12} ${yDesde} V ${yHasta + ALTO_NODO / 2} H ${xHijo}`
              : `M ${xPadre + 12} ${yDesde} V ${yHasta}`;

          return (
            <path
              key={`arista-${paso.id}`}
              d={d}
              fill="none"
              strokeWidth={1.25}
              strokeDasharray={trazo.rayado ? "3 3" : undefined}
              style={{ stroke: trazo.color }}
            />
          );
        })}

        {pasos.map((paso, i) => {
          const trazo = TRAZO[paso.paso];
          const esFantasma = paso.paso === "no-tomado" || paso.paso === "pendiente";

          return (
            <g key={paso.id}>
              <title>{`${paso.nombre} — ${trazo.palabra}`}</title>
              <rect
                x={x(paso.nivel)}
                y={y(i)}
                width={ANCHO_NODO - paso.nivel * SANGRIA}
                height={ALTO_NODO}
                rx={7}
                strokeWidth={trazo.grosor}
                strokeDasharray={trazo.rayado ? "3 3" : undefined}
                style={{
                  stroke: trazo.color,
                  fill: esFantasma ? "transparent" : tinte(trazo.color, 10),
                }}
              />
              <text
                x={x(paso.nivel) + 10}
                y={y(i) + ALTO_NODO / 2 + 3.5}
                fontSize={10.5}
                fontWeight={paso.paso === "fallado" ? 650 : 500}
                style={{ fill: esFantasma ? "var(--color-ink-ghost)" : "var(--color-ink-body)" }}
              >
                {recortar(paso.nombre, 22 - paso.nivel * 3)}
              </text>
            </g>
          );
        })}
      </svg>

      <figcaption className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5">
        {(
          [
            "recorrido",
            // El saltado sólo entra a la leyenda si está en el dibujo: es raro,
            // y una leyenda con estados que no aparecen hay que descartarla.
            ...(pasos.some((p) => p.paso === "saltado") ? (["saltado"] as const) : []),
            "fallado",
            "no-tomado",
          ] as const
        ).map((estado) => (
          <span key={estado} className="text-ink-faint flex items-center gap-1.5 text-[10.5px]">
            <svg width={16} height={9} aria-hidden className="shrink-0">
              <rect
                x={0.75}
                y={0.75}
                width={14.5}
                height={7.5}
                rx={3}
                strokeWidth={TRAZO[estado].grosor}
                strokeDasharray={TRAZO[estado].rayado ? "3 3" : undefined}
                style={{
                  stroke: TRAZO[estado].color,
                  fill: TRAZO[estado].rayado ? "transparent" : tinte(TRAZO[estado].color, 14),
                }}
              />
            </svg>
            {TRAZO[estado].palabra}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
