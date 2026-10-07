import { describe, expect, it } from "vitest";
import { traducirDescripcion, type ModeloDiccionario } from "@/lib/catalogo/traducir-descripcion";

/*
 * Siglas de marca confirmadas por el dueño el 2026-10-08, además de las del diccionario
 * de modelos: DT = Datsun, MIT = Mitsubishi, VW = Volkswagen, FORD = Ford. Aunque el
 * diccionario todavía no tenga modelos de esas marcas, la sigla corta el vehículo en
 * curso: lo que va detrás ya no es del auto anterior. DH y DM (dirección hidráulica /
 * mecánica) son piezas y NO marcas; CN (Changan, «creo») espera confirmación.
 */
const m = (
  marcaSigla: string,
  marca: string,
  modeloCatalogo: string,
  modeloSugerido: string,
): ModeloDiccionario => ({
  marcaSigla,
  marca,
  modeloCatalogo,
  tipo: "modelo",
  filas: 10,
  modeloSugerido,
  confianza: "alta",
  esVehiculo: true,
  compuesto: false,
});

const DIC: ModeloDiccionario[] = [
  m("CH", "Chevrolet", "AVEO", "Chevrolet Aveo"),
  m("MT", "Mitsubishi", "L200", "Mitsubishi L200"),
];

/** Las cilindradas que el traductor le asigna al Aveo (un solo elemento con la lista). */
const cilindradasDelAveo = (nombre: string): (string | null)[] =>
  traducirDescripcion(nombre, DIC)
    .filter((c) => c.modelo === "AVEO")
    .map((c) => c.cilindrada);

describe("siglas de marca confirmadas más allá del diccionario", () => {
  it("línea base: sin sigla de por medio, la segunda cilindrada también es del Aveo", () => {
    expect(cilindradasDelAveo("CH AVEO 1.6 1.2")).toEqual(["1.6", "1.2"]);
  });

  it.each(["DT", "VW", "FORD"])("%s corta el vehículo en curso", (sigla) => {
    expect(cilindradasDelAveo(`CH AVEO 1.6 ${sigla} 1.2`)).toEqual(["1.6"]);
  });

  it("MIT es Mitsubishi sin la salvedad de MT (transmisión manual)", () => {
    const r = traducirDescripcion("CH AVEO 1.6 MIT L200 92-", DIC);
    expect(r.map((c) => `${c.marca} ${c.modelo}`)).toEqual(["Chevrolet AVEO", "Mitsubishi L200"]);
    expect(r[1]?.anio_desde).toBe(1992);
  });

  it("DH y DM no son marcas: no cortan nada", () => {
    expect(cilindradasDelAveo("CH AVEO 1.6 DH 1.8")).toEqual(["1.6", "1.8"]);
    expect(cilindradasDelAveo("CH AVEO 1.6 DM 1.8")).toEqual(["1.6", "1.8"]);
  });

  it("CN (Changan, sin confirmar) no corta nada todavía", () => {
    expect(cilindradasDelAveo("CH AVEO 1.6 CN 1.8")).toEqual(["1.6", "1.8"]);
  });
});
