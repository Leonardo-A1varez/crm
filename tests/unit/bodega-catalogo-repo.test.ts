import { InMemoryBodegaCatalogoRepository } from "@/server/repositories/bodega-catalogo.repo";
import { runBodegaCatalogoContract } from "../repositories/bodega-catalogo.contract";

runBodegaCatalogoContract(async () => {
  const repo = new InMemoryBodegaCatalogoRepository();
  return {
    repo,
    marca: async (nombre) => repo.marca(nombre),
    existencia: async (noItem) => repo.existencia(noItem),
    variante: async (id) => repo.variante(id),
    sembrarMarcaDelErp: async (m) => repo.sembrarMarcaDelErp(m),
  };
});
