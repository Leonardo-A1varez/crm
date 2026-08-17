import { mapPostgrestError } from "@/server/db/postgrest-errors";
import type { AppClient } from "@/server/db/client";
import type { Campania, UUID } from "@/types/entities";
import type { CampaniaInsert, CampaniaUpdate, CampaniasRepository } from "./campanias.repo";

export class SupabaseCampaniasRepository implements CampaniasRepository {
  constructor(private readonly db: AppClient) {}

  async create(input: CampaniaInsert): Promise<Campania> {
    const { data, error } = await this.db
      .from("campanias")
      .insert({
        nombre: input.nombre,
        desde: input.desde.toISOString(),
        hasta: input.hasta.toISOString(),
      })
      .select("id, nombre, desde, hasta, created_at")
      .single();
    if (error) throw mapPostgrestError(error, { resource: "campanias" });
    return mapRow(data);
  }

  async findById(id: UUID): Promise<Campania | null> {
    const { data, error } = await this.db
      .from("campanias")
      .select("id, nombre, desde, hasta, created_at")
      .eq("id", id)
      .maybeSingle();
    if (error) throw mapPostgrestError(error, { resource: "campanias" });
    return data ? mapRow(data) : null;
  }

  async update(id: UUID, patch: CampaniaUpdate): Promise<Campania> {
    const { data, error } = await this.db
      .from("campanias")
      .update({
        ...(patch.nombre !== undefined ? { nombre: patch.nombre } : {}),
        ...(patch.desde !== undefined ? { desde: patch.desde.toISOString() } : {}),
        ...(patch.hasta !== undefined ? { hasta: patch.hasta.toISOString() } : {}),
      })
      .eq("id", id)
      .select("id, nombre, desde, hasta, created_at")
      .single();
    if (error) throw mapPostgrestError(error, { resource: "campanias" });
    return mapRow(data);
  }

  async list(): Promise<Campania[]> {
    const { data, error } = await this.db
      .from("campanias")
      .select("id, nombre, desde, hasta, created_at")
      .order("desde", { ascending: false });
    if (error) throw mapPostgrestError(error, { resource: "campanias" });
    return (data ?? []).map(mapRow);
  }

  async delete(id: UUID): Promise<void> {
    const { error } = await this.db.from("campanias").delete().eq("id", id);
    if (error) throw mapPostgrestError(error, { resource: "campanias" });
  }
}

function mapRow(r: {
  id: string;
  nombre: string;
  desde: string;
  hasta: string;
  created_at: string;
}): Campania {
  return {
    id: r.id,
    nombre: r.nombre,
    desde: new Date(r.desde),
    hasta: new Date(r.hasta),
    created_at: new Date(r.created_at),
  };
}
