import { ConflictError, NotFoundError } from "@/lib/errors";
import type { RolUsuario } from "@/types/domain";
import type { Usuario, UUID } from "@/types/entities";
import type { Insert, Update } from "./_types";

export type UsuarioInsert = Insert<Usuario, "id" | "created_at">;
export type UsuarioUpdate = Update<Usuario, "id" | "created_at" | "email">;

export interface UsuarioListFilter {
  rol?: RolUsuario;
}

export interface UsersRepository {
  create(input: UsuarioInsert): Promise<Usuario>;
  findById(id: UUID): Promise<Usuario | null>;
  findByEmail(email: string): Promise<Usuario | null>;
  update(id: UUID, patch: UsuarioUpdate): Promise<Usuario>;
  list(filter?: UsuarioListFilter): Promise<Usuario[]>;
}

export class InMemoryUsersRepository implements UsersRepository {
  private readonly store = new Map<UUID, Usuario>();

  async create(input: UsuarioInsert): Promise<Usuario> {
    const dup = await this.findByEmail(input.email);
    if (dup) throw new ConflictError(`email duplicado: ${input.email}`, "duplicate_email");
    const user: Usuario = {
      ...input,
      id: crypto.randomUUID(),
      created_at: new Date(),
    };
    this.store.set(user.id, user);
    return { ...user };
  }

  async findById(id: UUID): Promise<Usuario | null> {
    const u = this.store.get(id);
    return u ? { ...u } : null;
  }

  async findByEmail(email: string): Promise<Usuario | null> {
    for (const u of this.store.values()) {
      if (u.email === email) return { ...u };
    }
    return null;
  }

  async update(id: UUID, patch: UsuarioUpdate): Promise<Usuario> {
    const current = this.store.get(id);
    if (!current) throw new NotFoundError(`usuario no encontrado: ${id}`, "usuario", id);
    const next: Usuario = {
      ...current,
      ...patch,
      id: current.id,
      email: current.email,
      created_at: current.created_at,
    };
    this.store.set(id, next);
    return { ...next };
  }

  async list(filter: UsuarioListFilter = {}): Promise<Usuario[]> {
    let rows = Array.from(this.store.values());
    if (filter.rol !== undefined) {
      rows = rows.filter((u) => u.rol === filter.rol);
    }
    return rows.map((u) => ({ ...u }));
  }
}
