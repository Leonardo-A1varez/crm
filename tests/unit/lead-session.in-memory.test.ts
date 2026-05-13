import { InMemoryLeadSessionRepository } from "@/server/repositories/lead-session.repo";
import { runLeadSessionContract } from "../repositories/lead-session.contract";

runLeadSessionContract(() => new InMemoryLeadSessionRepository());
