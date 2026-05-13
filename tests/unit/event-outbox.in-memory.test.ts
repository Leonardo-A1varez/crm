import { InMemoryEventOutboxRepository } from "@/server/repositories/event-outbox.repo";
import { runEventOutboxContract } from "../repositories/event-outbox.contract";

runEventOutboxContract(() => new InMemoryEventOutboxRepository());
