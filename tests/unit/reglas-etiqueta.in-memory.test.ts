import { InMemoryReglasEtiquetaRepository } from "@/server/repositories/reglas-etiqueta.repo";
import { runReglasEtiquetaContract } from "../repositories/reglas-etiqueta.contract";

runReglasEtiquetaContract(() => new InMemoryReglasEtiquetaRepository());
