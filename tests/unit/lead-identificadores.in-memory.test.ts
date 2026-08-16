import { InMemoryLeadIdentificadoresRepository } from "@/server/repositories/lead-identificadores.repo";
import { runLeadIdentificadoresContract } from "../repositories/lead-identificadores.contract";

runLeadIdentificadoresContract(() => new InMemoryLeadIdentificadoresRepository());
