import { beforeEach, describe, expect, it } from "vitest";
import type { ModeloCatalogo } from "@/lib/catalogo/compatibilidad";
import { InMemoryCatalogoModelosRepository } from "@/server/repositories/catalogo-modelos.repo";
import { InMemoryProductsRepository } from "@/server/repositories/productos.repo";
import { DefaultRecalcularCompatibilidadService } from "@/server/services/catalog/recalcular-compatibilidad.service";

const MODELOS: ModeloCatalogo[] = [
  {
    marca: "Hyundai",
    sigla_modelo: "ACC",
    nombre_real: "Hyundai Accent",
    alias: [],
    confianza: "alta",
    confirmado: false,
  },
  {
    // Dudoso y sin confirmar: el traductor no debe usarlo.
    marca: "Hyundai",
    sigla_modelo: "GETZ",
    nombre_real: "Hyundai Getz",
    alias: [],
    confianza: "media",
    confirmado: false,
  },
];

describe("DefaultRecalcularCompatibilidadService", () => {
  let productos: InMemoryProductsRepository;
  let servicio: DefaultRecalcularCompatibilidadService;

  beforeEach(() => {
    productos = new InMemoryProductsRepository();
    servicio = new DefaultRecalcularCompatibilidadService({
      productos,
      modelos: new InMemoryCatalogoModelosRepository(MODELOS),
    });
  });

  async function crear(codigo: string, nombre: string, pendiente: boolean) {
    return productos.create({
      codigo_interno: codigo,
      sku_proveedor: null,
      nombre,
      descripcion: null,
      categoria: null,
      compatibilidad: [],
      precio: 5,
      stock: 1,
      imagen_url: null,
      activo: true,
      compatibilidad_pendiente: pendiente,
    });
  }

  it("traduce el nombre con el diccionario de la base y baja la marca", async () => {
    const p = await crear("A", "HY ACC 06- 1.4 /0", true);

    const r = await servicio.recalcular(10);

    expect(r).toMatchObject({ leidos: 1, actualizados: 1, sinVehiculo: 0, descartados: 0 });
    const leido = await productos.findById(p.id);
    expect(leido?.compatibilidad_pendiente).toBe(false);
    expect(leido?.compatibilidad).toEqual([
      expect.objectContaining({
        marca: "Hyundai",
        modelo: "ACC",
        modelo_nombre: "Hyundai Accent",
        anio_desde: 2006,
        cilindrada: "1.4",
      }),
    ]);
  });

  it("un nombre sin ningún modelo conocido deja la compatibilidad vacía y baja la marca", async () => {
    const p = await crear("A", "HY GETZ 1.4", true);

    const r = await servicio.recalcular(10);

    expect(r).toMatchObject({ leidos: 1, actualizados: 1, sinVehiculo: 1 });
    const leido = await productos.findById(p.id);
    expect(leido?.compatibilidad).toEqual([]);
    expect(leido?.compatibilidad_pendiente).toBe(false);
  });

  it("no toca los productos que no están pendientes", async () => {
    const p = await crear("A", "HY ACC 06- 1.4", false);

    expect(await servicio.recalcular(10)).toMatchObject({ leidos: 0, actualizados: 0 });
    expect((await productos.findById(p.id))?.compatibilidad).toEqual([]);
  });

  it("respeta el límite del lote y la segunda pasada termina el resto", async () => {
    await crear("A", "HY ACC 06- 1.4", true);
    await crear("B", "HY ACC 12- 1.6", true);
    await crear("C", "HY ACC 18-", true);

    expect((await servicio.recalcular(2)).leidos).toBe(2);
    expect((await servicio.recalcular(2)).leidos).toBe(1);
    expect((await servicio.recalcular(2)).leidos).toBe(0);
  });

  it("repetir la pasada no cambia nada (idempotente)", async () => {
    const p = await crear("A", "HY ACC 06- 1.4", true);
    await servicio.recalcular(10);
    const primera = await productos.findById(p.id);

    const otra = await servicio.recalcular(10);

    expect(otra.leidos).toBe(0);
    expect(await productos.findById(p.id)).toEqual(primera);
  });

  it("si el nombre cambia mientras se traduce, queda pendiente y se cuenta como descartado", async () => {
    const p = await crear("A", "HY ACC 06- 1.4", true);
    // La sincronización cambia el nombre entre la lectura y la escritura.
    const original = productos.guardarCompatibilidad.bind(productos);
    productos.guardarCompatibilidad = async (id, nombre, compat) => {
      await productos.update(id, { nombre: "HY ACC 12- 1.6", compatibilidad_pendiente: true });
      return original(id, nombre, compat);
    };

    const r = await servicio.recalcular(10);

    expect(r).toMatchObject({ leidos: 1, actualizados: 0, descartados: 1 });
    expect((await productos.findById(p.id))?.compatibilidad_pendiente).toBe(true);
  });
});
