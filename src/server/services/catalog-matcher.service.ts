import type { Producto } from "@/types/entities";
import type { ProductsRepository } from "@/server/repositories/productos.repo";
import type {
  BuscarRepuestoInput,
  BuscarRepuestoMatch,
  BuscarRepuestoOutput,
} from "@/lib/validation/ai";

export interface CatalogMatcherService {
  buscar(input: BuscarRepuestoInput): Promise<BuscarRepuestoOutput>;
}

export class DefaultCatalogMatcherService implements CatalogMatcherService {
  constructor(private readonly productos: ProductsRepository) {}

  async buscar(input: BuscarRepuestoInput): Promise<BuscarRepuestoOutput> {
    const all = await this.productos.list({ activo: true });

    const q = input.query.toLowerCase().trim();
    const marca = input.marca?.toLowerCase().trim();
    const modelo = input.modelo?.toLowerCase().trim();
    const anio = input.anio;

    const scored: Array<{ p: Producto; score: number }> = [];
    for (const p of all) {
      if (!matchesCompatibilidad(p, marca, modelo, anio)) continue;
      const score = relevanceScore(p, q);
      if (score > 0) scored.push({ p, score });
    }

    scored.sort((a, b) => b.score - a.score);
    const matches: BuscarRepuestoMatch[] = scored.map(({ p }) => ({
      id: p.id,
      codigo_interno: p.codigo_interno,
      nombre: p.nombre,
      precio: p.precio,
      stock: p.stock,
    }));

    return { matches, count: matches.length };
  }
}

function relevanceScore(p: Producto, q: string): number {
  const cod = p.codigo_interno.toLowerCase();
  const nom = p.nombre.toLowerCase();
  if (cod === q) return 100;
  if (cod.startsWith(q)) return 80;
  if (nom.startsWith(q)) return 60;
  if (nom.includes(q)) return 40;
  if (cod.includes(q)) return 20;
  return 0;
}

function matchesCompatibilidad(
  p: Producto,
  marca: string | undefined,
  modelo: string | undefined,
  anio: number | undefined,
): boolean {
  if (!marca && !modelo && anio === undefined) return true;
  return p.compatibilidad.some((c) => {
    if (marca && c.marca.toLowerCase() !== marca) return false;
    if (modelo && c.modelo.toLowerCase() !== modelo) return false;
    if (anio !== undefined && !(c.anio_desde <= anio && anio <= c.anio_hasta)) return false;
    return true;
  });
}
