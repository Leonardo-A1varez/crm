/**
 * Qué tiene que preguntar el agente después de la primera búsqueda.
 *
 * La regla no es un guión por tipo de pieza: es el eje que VARÍA entre los
 * candidatos. Si todos los resultados coinciden en todo menos en la
 * sobremedida, la pregunta es la sobremedida; si difieren en cilindrada, esa
 * va primero porque identifica el auto y sin eso lo demás es ruido.
 *
 * El orden sale de la física del problema, no de una preferencia:
 *   1. identificar el auto  (cilindrada, año)
 *   2. la geometría         (lado, posición) — vender el lado equivocado vuelve
 *   3. la sobremedida       (STD/0.50/0.75/1.00) — solo aplica a motor
 *   4. el fabricante        — NO es pregunta, es oferta de gama de precio
 */

export type EjePregunta = "cilindrada" | "anio" | "lado" | "posicion" | "medida" | "fabricante";

export interface CandidatoParaPregunta {
  /** La descripción del producto, que es donde el catálogo escribe el auto. */
  readonly nombre: string;
  /** El campo auxiliar: marca del fabricante y medidas físicas. */
  readonly descripcion?: string | null;
}

export interface PreguntaClave {
  readonly eje: EjePregunta;
  /** Los valores encontrados, en orden de aparición. */
  readonly valores: readonly string[];
  /** `false` para `fabricante`: ahí se ofrece gama, no se interroga. */
  readonly esPregunta: boolean;
}

/** `/0` es STD y `/2` es 0.50: la notación corta de la casa. */
const MEDIDAS = ["STD", "0.25", "0.50", "0.75", "1.00", "1.25"] as const;

const primerMatch = (texto: string, re: RegExp): string | null => re.exec(texto)?.[1] ?? null;

/**
 * Un eje por el que dos candidatos pueden diferir. Devuelve `null` cuando el
 * candidato no dice nada de ese eje — un dato ausente no discrimina.
 */
const EJES: ReadonlyArray<{
  readonly eje: EjePregunta;
  readonly leer: (c: CandidatoParaPregunta) => string | null;
}> = [
  { eje: "cilindrada", leer: (c) => primerMatch(c.nombre, /\b(\d\.\d)\b/) },
  { eje: "anio", leer: (c) => primerMatch(c.nombre, /(?<!\d)(\d{2}-\d{2}|\d{2}-|-\d{2})(?!\d)/) },
  { eje: "lado", leer: (c) => primerMatch(c.nombre, /\b(LH|RH|IZQ|DER)\b/) },
  { eje: "posicion", leer: (c) => primerMatch(c.nombre, /\b(DELT|DEL|POST|TRAS|SUP|INF)\b/) },
  {
    // El `/N` viene pegado al token anterior en el catálogo real (`05-13/0`),
    // así que no se puede exigir un espacio antes. Lo que sí se exige es que no
    // siga otro dígito: `B/18mm` es un bulón de 18 mm, no una sobremedida.
    eje: "medida",
    leer: (c) => {
      const n = primerMatch(c.nombre, /\/([0-5])(?![\d.])/);
      return n === null ? null : (MEDIDAS[Number(n)] ?? null);
    },
  },
  {
    eje: "fabricante",
    leer: (c) => primerMatch((c.descripcion ?? "").trim(), /^([A-Z][A-Z0-9-]{1,11})/),
  },
];

/**
 * El primer eje —en orden de prioridad— donde los candidatos no coinciden.
 * `null` cuando hay 0 o 1 candidato, o cuando ya no queda ambigüedad: ahí el
 * agente cotiza en vez de preguntar.
 */
export function preguntaClave(candidatos: readonly CandidatoParaPregunta[]): PreguntaClave | null {
  if (candidatos.length < 2) return null;

  for (const { eje, leer } of EJES) {
    const valores: string[] = [];
    for (const c of candidatos) {
      const v = leer(c);
      if (v !== null && !valores.includes(v)) valores.push(v);
    }
    if (valores.length > 1) {
      return { eje, valores, esPregunta: eje !== "fabricante" };
    }
  }
  return null;
}
