import type { Empresa, EmpresasRepository } from "@/server/repositories/empresas.repo";

export type { Empresa } from "@/server/repositories/empresas.repo";

/**
 * Lectura de los datos de la empresa para `/ajustes`.
 *
 * Existe para que la página no toque un repositorio: `app/**` sólo importa
 * servicios (zonas de `eslint.config.mjs`). No escribe: la tabla tiene policy
 * de UPDATE para admin, pero ninguna pantalla guarda estos datos todavía.
 */
export interface EmpresaService {
  /** `null` si la tabla `empresas` no tiene fila. */
  obtener(): Promise<Empresa | null>;
}

export class DefaultEmpresaService implements EmpresaService {
  constructor(private readonly deps: { empresas: EmpresasRepository }) {}

  async obtener(): Promise<Empresa | null> {
    return this.deps.empresas.obtenerUnica();
  }
}
