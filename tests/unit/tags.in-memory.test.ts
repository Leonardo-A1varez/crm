import { InMemoryTagsRepository } from "@/server/repositories/tags.repo";
import { runTagsContract } from "../repositories/tags.contract";

runTagsContract(() => new InMemoryTagsRepository());
