import type { ModeloCatalogo } from "@/lib/catalogo/compatibilidad";
import type { ModeloDiccionario } from "@/lib/catalogo/traducir-descripcion";

/**
 * Sigla de marca del inventario por nombre de marca. `catalogo_modelos` guarda
 * la marca con nombre completo y el traductor necesita la sigla (`HY`) para
 * reconocer dónde empieza un vehículo. Son las diez marcas del diccionario; un
 * test las compara con el CSV para que no se desincronicen.
 */
export const SIGLAS_DE_MARCA: Readonly<Record<string, string>> = {
  Hyundai: "HY",
  Chevrolet: "CH",
  Kia: "KIA",
  Nissan: "NS",
  Mazda: "MZ",
  Toyota: "TY",
  Suzuki: "SZ",
  Daewoo: "DW",
  Renault: "REN",
  Mitsubishi: "MT",
  Ford: "FORD",
};

/**
 * Las filas activas de `catalogo_modelos` como diccionario del traductor.
 *
 * Activa es lo mismo que la columna generada `activo`: confirmada por el dueño o
 * con confianza alta. Una marca sin sigla conocida se descarta: sin sigla el
 * traductor no puede reconocerla.
 */
export function diccionarioDesdeModelos(modelos: readonly ModeloCatalogo[]): ModeloDiccionario[] {
  const salida: ModeloDiccionario[] = [];
  for (const m of modelos) {
    if (!(m.confirmado || m.confianza === "alta")) continue;
    const sigla = SIGLAS_DE_MARCA[m.marca];
    if (sigla === undefined) continue;
    salida.push({
      marcaSigla: sigla,
      marca: m.marca,
      modeloCatalogo: m.sigla_modelo.trim().toUpperCase(),
      tipo: "modelo",
      filas: 0,
      modeloSugerido: m.nombre_real,
      confianza: m.confianza,
      esVehiculo: true,
      compuesto: m.nombre_real.includes(" + "),
    });
  }
  return salida;
}
