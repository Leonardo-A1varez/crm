import { InMemoryLeadVehiculosRepository } from "@/server/repositories/lead-vehiculos.repo";
import { runLeadVehiculosContract } from "../repositories/lead-vehiculos.contract";

runLeadVehiculosContract(() => new InMemoryLeadVehiculosRepository());
