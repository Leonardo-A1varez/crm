import type { UUID } from "@/types/entities";

/**
 * La etiqueta que el admin le pone a cada número de WhatsApp ("Casilla
 * principal", "Posventa"). Sólo informativa: no decide por qué número sale
 * nada. Ver `supabase/migrations/20260926100000_ajustes_rol_numero_y_uso_cupo.sql`.
 */
export interface RolDeNumero {
  phoneNumberId: string;
  rol: string;
}

export interface WhatsAppNumerosRolRepository {
  listar(): Promise<RolDeNumero[]>;
  /** Crea o reemplaza. `rol` ya viene recortado y no vacío. */
  guardar(input: { phoneNumberId: string; rol: string; actorId: UUID | null }): Promise<void>;
  /** Idempotente: borrar lo que no está no es un error. */
  borrar(phoneNumberId: string): Promise<void>;
}

export class InMemoryWhatsAppNumerosRolRepository implements WhatsAppNumerosRolRepository {
  private readonly filas = new Map<string, string>();

  async listar(): Promise<RolDeNumero[]> {
    return [...this.filas].map(([phoneNumberId, rol]) => ({ phoneNumberId, rol }));
  }

  async guardar(input: { phoneNumberId: string; rol: string }): Promise<void> {
    this.filas.set(input.phoneNumberId, input.rol);
  }

  async borrar(phoneNumberId: string): Promise<void> {
    this.filas.delete(phoneNumberId);
  }
}
