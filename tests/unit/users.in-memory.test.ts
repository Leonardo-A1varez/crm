import { InMemoryUsersRepository } from "@/server/repositories/users.repo";
import { runUsersContract } from "../repositories/users.contract";

runUsersContract(() => new InMemoryUsersRepository());
