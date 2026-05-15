import { ConflictError, NotFoundError } from "@/lib/errors";
import type { AppClient } from "@/server/db/client";
import { mapPostgrestError } from "@/server/db/postgrest-errors";
import type { Database } from "@/server/db/types.gen";
import { isUuid } from "@/server/db/uuid";
import type { Intent, UUID } from "@/types/entities";
import type {
  IntentInsert,
  IntentListFilter,
  IntentUpdate,
  IntentsRepository,
} from "./intents.repo";

type IntentDbUpdate = Database["public"]["Tables"]["intents"]["Update"];

/**
 * Supabase impl IntentsRepository. Slice 1 sub-paso 7.4 repo 5.
 *
 * Sin FKs externas. nombre UNIQUE → 23505 → ConflictError.
 * Tabla tiene created_at pero entity Intent no lo expone (mismo pattern InMemory).
 */
export class SupabaseIntentsRepository implements IntentsRepository {
  constructor(private readonly db: AppClient) {}

  async create(input: IntentInsert): Promise<Intent> {
    const { data, error } = await this.db
      .from("intents")
      .insert({
        nombre: input.nombre,
        descripcion: input.descripcion,
        ejemplos: input.ejemplos,
        auto_detectado: input.auto_detectado,
        activo: input.activo,
      })
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        throw new ConflictError(
          `nombre intent duplicado: ${input.nombre}`,
          "duplicate_intent_nombre",
          error,
        );
      }
      throw mapPostgrestError(error, { resource: "intent" });
    }
    return mapRow(data);
  }

  async findById(id: UUID): Promise<Intent | null> {
    if (!isUuid(id)) return null;
    const { data, error } = await this.db.from("intents").select().eq("id", id).maybeSingle();
    if (error) throw mapPostgrestError(error, { resource: "intent" });
    return data ? mapRow(data) : null;
  }

  async findByNombre(nombre: string): Promise<Intent | null> {
    const { data, error } = await this.db
      .from("intents")
      .select()
      .eq("nombre", nombre)
      .maybeSingle();
    if (error) throw mapPostgrestError(error, { resource: "intent" });
    return data ? mapRow(data) : null;
  }

  async update(id: UUID, patch: IntentUpdate): Promise<Intent> {
    const updatePayload: IntentDbUpdate = {};
    if (patch.nombre !== undefined) updatePayload.nombre = patch.nombre;
    if (patch.descripcion !== undefined) updatePayload.descripcion = patch.descripcion;
    if (patch.ejemplos !== undefined) updatePayload.ejemplos = patch.ejemplos;
    if (patch.auto_detectado !== undefined) updatePayload.auto_detectado = patch.auto_detectado;
    if (patch.activo !== undefined) updatePayload.activo = patch.activo;

    const { data, error } = await this.db
      .from("intents")
      .update(updatePayload)
      .eq("id", id)
      .select()
      .maybeSingle();

    if (error) throw mapPostgrestError(error, { resource: "intent" });
    if (data === null) {
      throw new NotFoundError(`intent no encontrado: ${id}`, "intent", id);
    }
    return mapRow(data);
  }

  async list(filter: IntentListFilter = {}): Promise<Intent[]> {
    let query = this.db.from("intents").select();
    if (filter.activo !== undefined) {
      query = query.eq("activo", filter.activo);
    }
    const { data, error } = await query;
    if (error) throw mapPostgrestError(error, { resource: "intent" });
    return (data ?? []).map(mapRow);
  }
}

interface IntentRow {
  id: string;
  nombre: string;
  descripcion: string;
  ejemplos: string[];
  auto_detectado: boolean;
  activo: boolean;
  created_at: string;
}

function mapRow(row: IntentRow): Intent {
  return {
    id: row.id,
    nombre: row.nombre,
    descripcion: row.descripcion,
    ejemplos: [...row.ejemplos],
    auto_detectado: row.auto_detectado,
    activo: row.activo,
  };
}
