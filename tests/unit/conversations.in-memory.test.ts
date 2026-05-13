import { InMemoryConversationsRepository } from "@/server/repositories/conversations.repo";
import { runConversationsContract } from "../repositories/conversations.contract";

runConversationsContract(() => new InMemoryConversationsRepository());
