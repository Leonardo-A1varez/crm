import { ConflictError, NotFoundError } from "@/lib/errors";
import type { AppClient } from "@/server/db/client";
import { mapPostgrestError } from "@/server/db/postgrest-errors";
import type { Database } from "@/server/db/types.gen";
import { isUuid } from "@/server/db/uuid";
import type { RolUsuario } from "@/types/domain";
import type { Usuario, UUID } from "@/types/entities";
import type {
  UsersRepository,
  UsuarioInsert,
  UsuarioListFilter,
  UsuarioUpdate,
} from "./users.repo";

type UsuarioDbUpdate = Database["public"]["Tables"]["usuarios"]["Update"];

/**
 * Supabase impl UsersRepository. Slice 1 sub-paso 7.4 repo 4.
 *
 * usuarios.id NO tiene default uuid en SQL — en prod sync vía trigger
 * auth.users → public.usuarios. Acá el repo genera UUID en create
 * (matchea InMemory). Email unique → 23505 → ConflictError.
 *
 * UsuarioUpdate type omite email — defense extra: payload nunca incluye email
 * aunque caller bypass type.
 */
export class SupabaseUsersRepository implements UsersRepository {
  constructor(private readonly db: AppClient) {}

  async create(input: UsuarioInsert): Promise<Usuario> {
    const id = crypto.randomUUID();
    const { data, error } = await this.db
      .from("usuarios")
      .insert({
        id,
        nombre: input.nombre,
        email: input.email,
        rol: input.rol,
        activo: input.activo,
      })
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        throw new ConflictError(`email duplicado: ${input.email}`, "duplicate_email", error);
      }
      throw mapPostgrestError(error, { resource: "usuario" });
    }
    return mapRow(data);
  }

  async findById(id: UUID): Promise<Usuario | null> {
    if (!isUuid(id)) return null;
    const { data, error } = await this.db.from("usuarios").select().eq("id", id).maybeSingle();
    if (error) throw mapPostgrestError(error, { resource: "usuario" });
    return data ? mapRow(data) : null;
  }

  async findByEmail(email: string): Promise<Usuario | null> {
    const { data, error } = await this.db
      .from("usuarios")
      .select()
      .eq("email", email)
      .maybeSingle();
    if (error) throw mapPostgrestError(error, { resource: "usuario" });
    return data ? mapRow(data) : null;
  }

  async update(id: UUID, patch: UsuarioUpdate): Promise<Usuario> {
    const updatePayload: UsuarioDbUpdate = {};
    if (patch.nombre !== undefined) updatePayload.nombre = patch.nombre;
    if (patch.rol !== undefined) updatePayload.rol = patch.rol;
    if (patch.activo !== undefined) updatePayload.activo = patch.activo;

    const { data, error } = await this.db
      .from("usuarios")
      .update(updatePayload)
      .eq("id", id)
      .select()
      .maybeSingle();

    if (error) throw mapPostgrestError(error, { resource: "usuario" });
    if (data === null) {
      throw new NotFoundError(`usuario no encontrado: ${id}`, "usuario", id);
    }
    return mapRow(data);
  }

  async list(filter: UsuarioListFilter = {}): Promise<Usuario[]> {
    let query = this.db.from("usuarios").select();
    if (filter.rol !== undefined) {
      query = query.eq("rol", filter.rol);
    }
    const { data, error } = await query;
    if (error) throw mapPostgrestError(error, { resource: "usuario" });
    return (data ?? []).map(mapRow);
  }
}

interface UsuarioRow {
  id: string;
  nombre: string;
  email: string;
  rol: RolUsuario;
  activo: boolean;
  created_at: string;
}

function mapRow(row: UsuarioRow): Usuario {
  return {
    id: row.id,
    nombre: row.nombre,
    email: row.email,
    rol: row.rol,
    activo: row.activo,
    created_at: new Date(row.created_at),
  };
}
