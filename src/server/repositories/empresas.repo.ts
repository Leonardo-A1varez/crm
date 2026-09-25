import { IllegalStateError } from "@/lib/errors";
import type { UUID } from "@/types/entities";

/**
 * La fila de `empresas`. La instalación es de una sola empresa (ver el
 * `COMMENT` de la tabla en la migración inicial): no hay selector de
 * organización ni va a haberlo.
 */
export interface Empresa {
  id: UUID;
  nombre: string;
  ruc_nit: string | null;
  created_at: Date;
}

export interface EmpresasRepository {
  /**
   * La empresa de la instalación. `null` si la tabla está vacía; falla si
   * tiene más de una fila, porque elegir una al azar mostraría datos de otra.
   */
  obtenerUnica(): Promise<Empresa | null>;
}

/** Compartida por las dos implementaciones para que no puedan discrepar. */
export function unicaOFalla(filas: readonly Empresa[]): Empresa | null {
  if (filas.length > 1) {
    throw new IllegalStateError(
      "la tabla empresas tiene más de una fila y la instalación es de una sola empresa",
      "empresas_multiples",
    );
  }
  const [fila] = filas;
  return fila ? { ...fila } : null;
}

export class InMemoryEmpresasRepository implements EmpresasRepository {
  private readonly filas: Empresa[];

  constructor(filas: readonly Empresa[] = []) {
    this.filas = filas.map((f) => ({ ...f }));
  }

  async obtenerUnica(): Promise<Empresa | null> {
    return unicaOFalla(this.filas);
  }
}
