import { InMemoryLeadsRepository } from "@/server/repositories/leads.repo";
import { runLeadsContract } from "../repositories/leads.contract";

runLeadsContract(() => new InMemoryLeadsRepository());
