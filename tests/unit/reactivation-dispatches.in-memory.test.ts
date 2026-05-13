import { InMemoryReactivationDispatchesRepository } from "@/server/repositories/reactivation-dispatches.repo";
import { runReactivationDispatchesContract } from "../repositories/reactivation-dispatches.contract";

runReactivationDispatchesContract(() => new InMemoryReactivationDispatchesRepository());
