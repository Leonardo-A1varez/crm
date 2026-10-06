import type { ErpSyncEstadoRepository } from "@/server/repositories/erp-sync-estado.repo";
import type { ErpSyncEstado } from "@/types/entities";

/**
 * Cómo va la sincronización del catálogo con el ERP, para el aviso de arriba de
 * /productos. Existe para que la página no toque un repositorio (zonas de
 * `eslint.config.mjs`).
 */
export interface ErpSyncService {
  /** `null` si la tabla todavía no tiene fila. */
  estado(): Promise<ErpSyncEstado | null>;
}

export class DefaultErpSyncService implements ErpSyncService {
  constructor(private readonly deps: { estados: ErpSyncEstadoRepository }) {}

  estado(): Promise<ErpSyncEstado | null> {
    return this.deps.estados.leer();
  }
}
