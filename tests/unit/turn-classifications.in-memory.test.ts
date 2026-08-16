import { InMemoryTurnClassificationsRepository } from "@/server/repositories/turn-classifications.repo";
import { runTurnClassificationsContract } from "../repositories/turn-classifications.contract";

runTurnClassificationsContract(() => new InMemoryTurnClassificationsRepository());
