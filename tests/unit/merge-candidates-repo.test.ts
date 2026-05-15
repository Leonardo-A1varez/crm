import { InMemoryMergeCandidatesRepository } from "@/server/repositories/merge-candidates.repo";
import { runMergeCandidatesContract } from "../repositories/merge-candidates.contract";

runMergeCandidatesContract(() => new InMemoryMergeCandidatesRepository());
