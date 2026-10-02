import {
  InMemoryBusquedasSinResultadoRepository,
  type LlamadaHerramienta,
} from "@/server/repositories/busquedas-sin-resultado.repo";
import { runBusquedasSinResultadoContract } from "../repositories/busquedas-sin-resultado.contract";

runBusquedasSinResultadoContract(async () => {
  const llamadas: LlamadaHerramienta[] = [];
  return {
    repo: new InMemoryBusquedasSinResultadoRepository(llamadas),
    async sembrar(filas) {
      for (const f of filas) {
        llamadas.push({
          tool_name: f.toolName ?? "buscar_repuesto",
          args: f.args,
          result: f.result,
          error: f.error ?? null,
          created_at: f.creadaEn,
        });
      }
    },
  };
});
