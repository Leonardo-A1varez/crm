import { NotFoundError } from "@/lib/errors";
import type { AppClient } from "@/server/db/client";
import { mapPostgrestError } from "@/server/db/postgrest-errors";
import { isUuid } from "@/server/db/uuid";
import type { LeadVehiculo, UUID } from "@/types/entities";
import type {
  LeadVehiculoInsert,
  LeadVehiculoUpdate,
  LeadVehiculosRepository,
} from "./lead-vehiculos.repo";

interface VehiculoRow {
  id: string;
  lead_id: string;
  marca: string | null;
  modelo: string | null;
  anio: number | null;
  motor: string | null;
  placa: string | null;
  placa_original: string | null;
  vin: string | null;
  vin_original: string | null;
  principal: boolean;
  created_at: string;
}

function mapRow(row: VehiculoRow): LeadVehiculo {
  return { ...row, created_at: new Date(row.created_at) };
}

export class SupabaseLeadVehiculosRepository implements LeadVehiculosRepository {
  constructor(private readonly db: AppClient) {}

  async listByLeadId(leadId: UUID): Promise<LeadVehiculo[]> {
    if (!isUuid(leadId)) return [];
    const { data, error } = await this.db
      .from("lead_vehiculos")
      .select("*")
      .eq("lead_id", leadId)
      // El principal primero: es el que la ficha muestra como el auto del lead.
      .order("principal", { ascending: false })
      .order("created_at", { ascending: true });
    if (error) throw mapPostgrestError(error, { resource: "lead_vehiculos" });
    return ((data ?? []) as VehiculoRow[]).map(mapRow);
  }

  async create(input: LeadVehiculoInsert): Promise<LeadVehiculo> {
    const { data, error } = await this.db.from("lead_vehiculos").insert(input).select().single();
    if (error) throw mapPostgrestError(error, { resource: "lead_vehiculos" });
    return mapRow(data as VehiculoRow);
  }

  async update(id: UUID, patch: LeadVehiculoUpdate): Promise<LeadVehiculo> {
    if (!isUuid(id)) throw new NotFoundError(`vehículo no encontrado: ${id}`, "lead_vehiculo", id);
    // `maybeSingle` y no `single`: con cero filas, `single` devuelve PGRST116 y
    // `mapPostgrestError` lo convierte en `InfraError`, que es **retriable**.
    // Editar un vehículo que ya no existe haría reintentar una operación
    // condenada en vez de decir "eso ya no está". La impl in-memory siempre
    // lanzó `NotFoundError`; el contract test destapó la divergencia.
    const { data, error } = await this.db
      .from("lead_vehiculos")
      .update(patch)
      .eq("id", id)
      .select()
      .maybeSingle();
    if (error) throw mapPostgrestError(error, { resource: "lead_vehiculos" });
    if (data === null) {
      throw new NotFoundError(`vehículo no encontrado: ${id}`, "lead_vehiculo", id);
    }
    return mapRow(data as VehiculoRow);
  }

  async delete(id: UUID): Promise<void> {
    if (!isUuid(id)) return;
    const { error } = await this.db.from("lead_vehiculos").delete().eq("id", id);
    if (error) throw mapPostgrestError(error, { resource: "lead_vehiculos" });
  }
}
