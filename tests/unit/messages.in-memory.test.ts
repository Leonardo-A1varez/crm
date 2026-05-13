import { InMemoryMessagesRepository } from "@/server/repositories/messages.repo";
import { runMessagesContract } from "../repositories/messages.contract";

runMessagesContract(() => new InMemoryMessagesRepository());
