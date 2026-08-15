import { NotFoundError } from "@/lib/errors";
import { normalizarIdentificador } from "@/lib/identificadores";
import type { LeadVehiculo, UUID } from "@/types/entities";
import type { Insert } from "./_types";

export type LeadVehiculoInsert = Insert<LeadVehiculo, "id" | "created_at">;

/** Lo editable de un auto ya cargado. La pertenencia al lead no se cambia. */
export type LeadVehiculoUpdate = Partial<
  Pick<
    LeadVehiculo,
    | "marca"
    | "modelo"
    | "anio"
    | "motor"
    | "placa"
    | "placa_original"
    | "vin"
    | "vin_original"
    | "principal"
  >
>;

export interface LeadVehiculosRepository {
  /** Los autos del lead, el principal primero y después por antigüedad. */
  listByLeadId(leadId: UUID): Promise<LeadVehiculo[]>;
  create(input: LeadVehiculoInsert): Promise<LeadVehiculo>;
  update(id: UUID, patch: LeadVehiculoUpdate): Promise<LeadVehiculo>;
  delete(id: UUID): Promise<void>;
}

/**
 * El par `valor` / `valor_original` de la placa y el VIN, listo para guardar.
 *
 * Vive acá y no en cada llamador porque la detección de duplicados compara
 * contra la columna normalizada: si un camino guardara "AB-123-CD" sin
 * normalizar, ese auto no matchearía nunca con el mismo auto cargado como
 * "AB123CD". Reusa `normalizarIdentificador` en vez de repetir la regla — dos
 * copias derivan, y cuando derivan el detector deja de encontrar duplicados sin
 * que nadie se entere.
 */
export function normalizarDatoDeAuto(
  tipo: "placa" | "vin",
  crudo: string | null | undefined,
): { valor: string | null; original: string | null } {
  if (crudo === null || crudo === undefined || crudo.trim() === "") {
    return { valor: null, original: null };
  }
  const valor = normalizarIdentificador(tipo, crudo);
  return valor === "" ? { valor: null, original: null } : { valor, original: crudo.trim() };
}

/** El principal primero; entre iguales, el más viejo. Mismo orden que Supabase. */
function ordenar(a: LeadVehiculo, b: LeadVehiculo): number {
  if (a.principal !== b.principal) return a.principal ? -1 : 1;
  return a.created_at.getTime() - b.created_at.getTime();
}

export class InMemoryLeadVehiculosRepository implements LeadVehiculosRepository {
  private readonly store = new Map<UUID, LeadVehiculo>();

  async listByLeadId(leadId: UUID): Promise<LeadVehiculo[]> {
    return Array.from(this.store.values())
      .filter((v) => v.lead_id === leadId)
      .sort(ordenar)
      .map((v) => ({ ...v }));
  }

  async create(input: LeadVehiculoInsert): Promise<LeadVehiculo> {
    const fila: LeadVehiculo = { ...input, id: crypto.randomUUID(), created_at: new Date() };
    this.store.set(fila.id, fila);
    return { ...fila };
  }

  async update(id: UUID, patch: LeadVehiculoUpdate): Promise<LeadVehiculo> {
    const actual = this.store.get(id);
    if (!actual) {
      throw new NotFoundError(`vehículo no encontrado: ${id}`, "lead_vehiculo", id);
    }
    const siguiente = { ...actual, ...patch };
    this.store.set(id, siguiente);
    return { ...siguiente };
  }

  async delete(id: UUID): Promise<void> {
    this.store.delete(id);
  }
}
