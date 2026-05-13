import { InMemoryProductsRepository } from "@/server/repositories/productos.repo";
import { runProductosContract } from "../repositories/productos.contract";

runProductosContract(() => new InMemoryProductsRepository());
