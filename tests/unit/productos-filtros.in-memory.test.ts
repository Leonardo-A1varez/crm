import { InMemoryProductsRepository } from "@/server/repositories/productos.repo";
import { runProductosFiltrosContract } from "../repositories/productos-filtros.contract";

runProductosFiltrosContract(() => new InMemoryProductsRepository());
