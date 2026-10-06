import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryProductsRepository } from "@/server/repositories/productos.repo";
import type { CompatibilidadEntry } from "@/types/entities";

const ACCENT: CompatibilidadEntry = {
  marca: "Hyundai",
  modelo: "ACC",
  modelo_nombre: "Hyundai Accent",
  anio_desde: 2006,
  anio_hasta: null,
  cilindrada: "1.4",
  combustible: null,
};

describe("InMemoryProductsRepository: compatibilidad pendiente", () => {
  let repo: InMemoryProductsRepository;

  beforeEach(() => {
    repo = new InMemoryProductsRepository();
  });

  async function crear(codigo: string, nombre: string, pendiente: boolean) {
    const creado = await repo.create({
      codigo_interno: codigo,
      sku_proveedor: null,
      nombre,
      descripcion: null,
      categoria: null,
      compatibilidad: [],
      precio: 10,
      stock: 1,
      imagen_url: null,
      activo: true,
    });
    // El alta siempre queda pendiente (trigger); acá se baja la marca a mano.
    if (pendiente) return creado;
    return repo.update(creado.id, { compatibilidad_pendiente: false });
  }

  it("lista solo los pendientes, con id y nombre, hasta el límite", async () => {
    await crear("A", "HY ACC 06- 1.4", true);
    await crear("B", "CH SAIL 1.4", false);
    await crear("C", "KIA RIO 1.4", true);
    await crear("D", "NS SENTRA", true);

    const dos = await repo.listarCompatibilidadPendiente(2);
    expect(dos).toHaveLength(2);
    expect(dos.map((p) => p.nombre).sort()).toEqual(["HY ACC 06- 1.4", "KIA RIO 1.4"].sort());
    expect(Object.keys(dos[0] ?? {}).sort()).toEqual(["id", "nombre"]);

    expect(await repo.listarCompatibilidadPendiente(10)).toHaveLength(3);
  });

  it("guardar escribe la compatibilidad y baja la marca", async () => {
    const p = await crear("A", "HY ACC 06- 1.4", true);

    expect(await repo.guardarCompatibilidad(p.id, "HY ACC 06- 1.4", [ACCENT])).toBe(true);

    const leido = await repo.findById(p.id);
    expect(leido?.compatibilidad).toEqual([ACCENT]);
    expect(leido?.compatibilidad_pendiente).toBe(false);
    expect(await repo.listarCompatibilidadPendiente(10)).toEqual([]);
  });

  it("si el nombre cambió mientras se traducía, no guarda y sigue pendiente", async () => {
    const p = await crear("A", "HY ACC 06- 1.4", true);
    await repo.update(p.id, { nombre: "HY ACC 12- 1.6", compatibilidad_pendiente: true });

    expect(await repo.guardarCompatibilidad(p.id, "HY ACC 06- 1.4", [ACCENT])).toBe(false);

    const leido = await repo.findById(p.id);
    expect(leido?.compatibilidad).toEqual([]);
    expect(leido?.compatibilidad_pendiente).toBe(true);
  });

  it("un producto que ya no existe no se guarda", async () => {
    expect(await repo.guardarCompatibilidad(crypto.randomUUID(), "X", [])).toBe(false);
  });
});
