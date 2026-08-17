import { InMemoryCampaniasRepository } from "@/server/repositories/campanias.repo";
import { runCampaniasContract } from "../repositories/campanias.contract";

runCampaniasContract(() => new InMemoryCampaniasRepository());
