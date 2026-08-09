import { describe } from "vitest";
import { InMemoryAgenteConfigRepository } from "@/server/repositories/agente-config.repo";
import { runAgenteConfigContract } from "../../repositories/agente-config.contract";

describe("InMemoryAgenteConfigRepository", () => {
  runAgenteConfigContract(() => new InMemoryAgenteConfigRepository());
});
