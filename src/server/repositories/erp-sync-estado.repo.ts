import type { ErpSyncEstado } from "@/types/entities";

/**
 * Lectura de `erp_sync_estado`, la fila única que dice cómo va la sincronización
 * del catálogo con el ERP. La escribe la propia sincronización; el panel solo la
 * lee.
 */
export interface ErpSyncEstadoRepository {
  /** `null` si la tabla todavía no tiene fila. */
  leer(): Promise<ErpSyncEstado | null>;
}

export class InMemoryErpSyncEstadoRepository implements ErpSyncEstadoRepository {
  constructor(private estado: ErpSyncEstado | null = null) {}

  fijar(estado: ErpSyncEstado | null): void {
    this.estado = estado;
  }

  async leer(): Promise<ErpSyncEstado | null> {
    return this.estado === null ? null : { ...this.estado };
  }
}
