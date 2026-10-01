/**
 * Matemática pura de la calibración del recorte por ancho de área. Sin
 * electron ni fs: se prueba desde el autocheck y con `node` plano.
 *
 * Por qué existe: el ancho de la lista de chats de WhatsApp Web depende del
 * ancho total de la vista (= ancho del área + recorte), que no se puede leer
 * (no se inyecta nada en WhatsApp Web). Un recorte único no sirve para todos
 * los tamaños de ventana, así que el dueño calibra a mano a distintos anchos y
 * el recorte de los demás se interpola.
 */

export const RECORTE_MAXIMO = 1200;
export const MAXIMO_CALIBRACIONES = 20;
export const PASO_ANCHO_AREA = 10;
const ANCHO_AREA_MAXIMO = 20_000;

export interface Calibracion {
  /** Ancho del área en DIP, redondeado a múltiplos de 10. */
  anchoArea: number;
  /** Recorte izquierdo en DIP. */
  recorte: number;
}

export function recorteValido(valor: unknown): valor is number {
  return (
    typeof valor === "number" && Number.isInteger(valor) && valor >= 0 && valor <= RECORTE_MAXIMO
  );
}

export function anchoAreaValido(valor: unknown): valor is number {
  return (
    typeof valor === "number" &&
    Number.isInteger(valor) &&
    valor > 0 &&
    valor <= ANCHO_AREA_MAXIMO
  );
}

export function redondearAncho(ancho: number): number {
  return Math.round(ancho / PASO_ANCHO_AREA) * PASO_ANCHO_AREA;
}

/**
 * Agrega o reemplaza la calibración del mismo ancho. El arreglo va de la más
 * vieja a la más nueva: reemplazar mueve la entrada al final, y si se pasa de
 * `MAXIMO_CALIBRACIONES` se descarta la más vieja. No muta la entrada.
 */
export function guardarCalibracion(
  calibraciones: readonly Calibracion[],
  nueva: Calibracion,
): Calibracion[] {
  const resto = calibraciones.filter((c) => c.anchoArea !== nueva.anchoArea);
  const resultado = [...resto, { anchoArea: nueva.anchoArea, recorte: nueva.recorte }];
  return resultado.slice(Math.max(0, resultado.length - MAXIMO_CALIBRACIONES));
}

/**
 * Recorte para un ancho de área:
 * - 0 calibraciones: `porDefecto` (0 si no hay).
 * - 1: ese valor.
 * - 2 o más: interpolación lineal entre las dos más cercanas que rodean el
 *   ancho; fuera del rango, la más cercana (no se extrapola). Un ancho con
 *   calibración exacta devuelve ese valor.
 * - `ancho === null` (todavía no hay área): la calibración más reciente.
 * Redondea a entero y acota a 0–RECORTE_MAXIMO.
 */
export function recorteEfectivo(
  calibraciones: readonly Calibracion[],
  ancho: number | null,
  porDefecto = 0,
): number {
  const acotar = (n: number): number => Math.min(RECORTE_MAXIMO, Math.max(0, Math.round(n)));
  if (calibraciones.length === 0) return acotar(porDefecto);
  if (ancho === null) return acotar(calibraciones[calibraciones.length - 1]?.recorte ?? 0);
  const orden = [...calibraciones].sort((a, b) => a.anchoArea - b.anchoArea);
  const primera = orden[0];
  const ultima = orden[orden.length - 1];
  if (primera === undefined || ultima === undefined) return acotar(porDefecto);
  if (ancho <= primera.anchoArea) return acotar(primera.recorte);
  if (ancho >= ultima.anchoArea) return acotar(ultima.recorte);
  for (let i = 0; i + 1 < orden.length; i += 1) {
    const izq = orden[i];
    const der = orden[i + 1];
    if (izq === undefined || der === undefined) continue;
    if (ancho >= izq.anchoArea && ancho <= der.anchoArea) {
      const t = (ancho - izq.anchoArea) / (der.anchoArea - izq.anchoArea);
      return acotar(izq.recorte + t * (der.recorte - izq.recorte));
    }
  }
  return acotar(ultima.recorte);
}

export function hayCalibracionExacta(
  calibraciones: readonly Calibracion[],
  ancho: number | null,
): boolean {
  return ancho !== null && calibraciones.some((c) => c.anchoArea === ancho);
}
