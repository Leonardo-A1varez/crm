import { ConflictError } from "@/lib/errors";
import type { IdentificadorTipo } from "@/types/domain";
import type { LeadIdentificador, UUID } from "@/types/entities";
import type { Insert } from "./_types";

export type LeadIdentificadorInsert = Insert<LeadIdentificador, "id" | "created_at">;

/** Otro lead que comparte al menos un identificador, y de qué tipo. */
export interface CoincidenciaIdentificador {
  leadId: UUID;
  tipos: IdentificadorTipo[];
}

export interface LeadIdentificadoresRepository {
  listByLeadId(leadId: UUID): Promise<LeadIdentificador[]>;
  /** Rechaza el duplicado exacto (mismo lead, tipo y valor) con `ConflictError`. */
  create(input: LeadIdentificadorInsert): Promise<LeadIdentificador>;
  delete(id: UUID): Promise<void>;
  /**
   * Leads que comparten al menos un identificador con este.
   *
   * Es lo que reemplaza al match por nombre: dos personas se llaman igual todo
   * el tiempo, pero no comparten RUC, VIN, placa ni teléfono.
   */
  findCoincidencias(leadId: UUID): Promise<CoincidenciaIdentificador[]>;
}

/**
 * La normalización se mudó a `lib/identificadores.ts` y se re-exporta desde acá.
 *
 * Motivo: el schema Zod de la Server Action tiene que normalizar para poder
 * decir "esto queda vacío" y "esto no es un VIN", y `lib/**` no puede importar
 * `server/repositories/**` (boundaries). Una segunda copia en `lib/` habría
 * dejado dos reglas capaces de derivar, que es justo lo que rompe la detección
 * de duplicados. El re-export mantiene válida esta ruta de import.
 */
export { normalizarIdentificador } from "@/lib/identificadores";

export class InMemoryLeadIdentificadoresRepository implements LeadIdentificadoresRepository {
  private readonly store = new Map<UUID, LeadIdentificador>();

  async listByLeadId(leadId: UUID): Promise<LeadIdentificador[]> {
    return Array.from(this.store.values())
      .filter((i) => i.lead_id === leadId)
      .sort((a, b) => a.created_at.getTime() - b.created_at.getTime())
      .map((i) => ({ ...i }));
  }

  async create(input: LeadIdentificadorInsert): Promise<LeadIdentificador> {
    const dup = Array.from(this.store.values()).find(
      (i) => i.lead_id === input.lead_id && i.tipo === input.tipo && i.valor === input.valor,
    );
    if (dup) {
      throw new ConflictError(
        `identificador duplicado: ${input.tipo} ${input.valor}`,
        "duplicate_identificador",
      );
    }
    const fila: LeadIdentificador = {
      ...input,
      id: crypto.randomUUID(),
      created_at: new Date(),
    };
    this.store.set(fila.id, fila);
    return { ...fila };
  }

  async delete(id: UUID): Promise<void> {
    this.store.delete(id);
  }

  async findCoincidencias(leadId: UUID): Promise<CoincidenciaIdentificador[]> {
    const mios = Array.from(this.store.values()).filter((i) => i.lead_id === leadId);
    const porLead = new Map<UUID, Set<IdentificadorTipo>>();

    for (const mio of mios) {
      for (const otro of this.store.values()) {
        if (otro.lead_id === leadId) continue;
        if (otro.tipo !== mio.tipo || otro.valor !== mio.valor) continue;
        const tipos = porLead.get(otro.lead_id) ?? new Set<IdentificadorTipo>();
        tipos.add(otro.tipo);
        porLead.set(otro.lead_id, tipos);
      }
    }

    return Array.from(porLead.entries()).map(([id, tipos]) => ({
      leadId: id,
      tipos: Array.from(tipos).sort(),
    }));
  }
}
