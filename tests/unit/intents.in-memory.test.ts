import { InMemoryIntentsRepository } from "@/server/repositories/intents.repo";
import { runIntentsContract } from "../repositories/intents.contract";

runIntentsContract(() => new InMemoryIntentsRepository());
