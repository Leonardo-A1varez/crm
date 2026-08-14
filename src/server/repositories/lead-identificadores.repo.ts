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
 * Normaliza para comparar: sin espacios ni separadores, y en minúscula.
 *
 * Vive acá y no en cada llamador porque la comparación del detector se hace
 * contra `valor`, y dos formas del mismo teléfono —"+54 9 11 5555-0002" y
 * "5491155550002"— tienen que caer en la misma cadena o el duplicado no se
 * detecta. `valor_original` conserva lo que la persona escribió.
 */
export function normalizarIdentificador(tipo: IdentificadorTipo, crudo: string): string {
  const limpio = crudo.trim();
  if (tipo === "email") return limpio.toLowerCase();
  if (tipo === "telefono") return limpio.replace(/[^0-9+]/g, "");
  // RUC, placa y VIN: alfanuméricos. Los guiones y espacios de "AB-123-CD" o
  // "AB 123 CD" son decoración de quien escribe, no parte del identificador.
  return limpio.replace(/[^0-9a-zA-Z]/g, "").toUpperCase();
}

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
