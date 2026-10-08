import { describe, expect, test } from "vitest";
import {
  indexarMarcas,
  ladoDeVariantes,
  resolverOrigen,
  type MarcaCatalogo,
  type VarianteBodega,
} from "@/lib/catalogo/procedencia";
import { MARCAS } from "../../helpers/catalogo-marcas-fixtures";

const indice = indexarMarcas(MARCAS);

const variante = (o: Partial<VarianteBodega> = {}): VarianteBodega => ({
  id: "v-1",
  item_codigo_interno: "X",
  marca_canonica: "MANDO",
  marca_procedencia: "KOREA",
  lado: null,
  estado: "CONFIRMED",
  descartada: false,
  activa: true,
  ...o,
});

describe("resolverOrigen con variantes de Bodega Web", () => {
  test("una variante confiable manda sobre la descripción del ERP", () => {
    // El ERP dice MOBIS; la variante confirmada dice MANDO. Se afirma lo de la variante.
    const r = resolverOrigen("MOBIS", "25100-2X000", indice, [variante()]);
    expect(r).toEqual({ marca: "MANDO", procedencia: "Korea" });
  });

  test.each(["CONFIRMED", "TRUSTED"])("el estado %s es confiable", (estado) => {
    expect(resolverOrigen(null, null, indice, [variante({ estado })]).marca).toBe("MANDO");
  });

  test.each(["OBSERVED", "CONFLICT"])(
    "el estado %s NO es confiable: se usa la descripción del ERP",
    (estado) => {
      const r = resolverOrigen("MOBIS", null, indice, [variante({ estado })]);
      expect(r).toEqual({ marca: "MOBIS", procedencia: "Original" });
    },
  );

  test("una variante descartada o dada de baja no cuenta", () => {
    for (const v of [variante({ descartada: true }), variante({ activa: false })]) {
      expect(resolverOrigen("MOBIS", null, indice, [v])).toEqual({
        marca: "MOBIS",
        procedencia: "Original",
      });
    }
  });

  test("si la variante no trae procedencia, se busca la marca en la tabla de marcas", () => {
    const r = resolverOrigen(null, null, indice, [
      variante({ marca_canonica: "VALEO", marca_procedencia: null }),
    ]);
    expect(r).toEqual({ marca: "VALEO", procedencia: "Francia" });
  });

  test("si ni la variante ni la tabla saben la procedencia, sigue el sufijo del código", () => {
    const r = resolverOrigen(null, "25100-2X000/K", indice, [
      variante({ marca_canonica: "TAIHO", marca_procedencia: null }),
    ]);
    expect(r).toEqual({ marca: "TAIHO", procedencia: "Korea" });
  });

  test("sin procedencia en ninguna fuente, queda null: no se inventa", () => {
    const r = resolverOrigen(null, "25100-2X000", indice, [
      variante({ marca_canonica: "TAIHO", marca_procedencia: null }),
    ]);
    expect(r).toEqual({ marca: "TAIHO", procedencia: null });
  });

  test("dos variantes confiables que coinciden en la marca valen como una", () => {
    const r = resolverOrigen(null, null, indice, [
      variante({ id: "a" }),
      variante({ id: "b", marca_procedencia: null }),
    ]);
    expect(r).toEqual({ marca: "MANDO", procedencia: "Korea" });
  });

  test("dos variantes confiables de marcas distintas son ambiguas: se usa el ERP", () => {
    const r = resolverOrigen("MOBIS", null, indice, [
      variante({ id: "a", marca_canonica: "MANDO", marca_procedencia: "KOREA" }),
      variante({ id: "b", marca_canonica: "CTR", marca_procedencia: "KOREA" }),
    ]);
    expect(r).toEqual({ marca: "MOBIS", procedencia: "Original" });
  });

  test("una variante confiable sin marca no aporta nada", () => {
    const r = resolverOrigen("MOBIS", null, indice, [
      variante({ marca_canonica: null, marca_procedencia: null }),
    ]);
    expect(r).toEqual({ marca: "MOBIS", procedencia: "Original" });
  });

  test("sin variantes todo sigue igual que antes", () => {
    expect(resolverOrigen("MOBIS", null, indice)).toEqual({
      marca: "MOBIS",
      procedencia: "Original",
    });
    expect(resolverOrigen("MOBIS", null, indice, [])).toEqual({
      marca: "MOBIS",
      procedencia: "Original",
    });
  });
});

describe("las marcas de vehículo no son marcas de repuesto", () => {
  const conVehiculo: MarcaCatalogo[] = [
    ...MARCAS,
    { nombre: "KIA", tipo: "vehiculo", procedencia: "KOREA", activa: true, alias: [] },
  ];

  test("una marca tipo vehiculo no entra al índice", () => {
    const i = indexarMarcas(conVehiculo);
    expect(i.porClave.has("kia")).toBe(false);
    expect(i.porClave.has("mando")).toBe(true);
  });

  test("el texto KIA en la descripción no se resuelve con la procedencia de la marca de vehículo", () => {
    const r = resolverOrigen("KIA", null, indexarMarcas(conVehiculo));
    expect(r.procedencia).toBeNull();
  });

  test("tipo producto sigue siendo marca de repuesto", () => {
    const i = indexarMarcas([
      { nombre: "MANDO", tipo: "producto", procedencia: "KOREA", activa: true, alias: [] },
    ]);
    expect(i.porClave.get("mando")?.procedencia).toBe("Korea");
  });
});

describe("ladoDeVariantes", () => {
  test("el lado unánime de las variantes confiables", () => {
    expect(ladoDeVariantes([variante({ lado: "LEFT" })])).toBe("izquierdo");
    expect(
      ladoDeVariantes([variante({ lado: "RIGHT" }), variante({ id: "b", lado: "RIGHT" })]),
    ).toBe("derecho");
  });

  test("lados distintos, BOTH o sin lado: null", () => {
    expect(
      ladoDeVariantes([variante({ lado: "LEFT" }), variante({ id: "b", lado: "RIGHT" })]),
    ).toBeNull();
    expect(ladoDeVariantes([variante({ lado: "BOTH" })])).toBeNull();
    expect(ladoDeVariantes([variante({ lado: null })])).toBeNull();
    expect(ladoDeVariantes([])).toBeNull();
  });

  test("una variante no confiable no cuenta", () => {
    expect(ladoDeVariantes([variante({ lado: "LEFT", estado: "OBSERVED" })])).toBeNull();
    expect(ladoDeVariantes([variante({ lado: "LEFT", descartada: true })])).toBeNull();
  });
});
