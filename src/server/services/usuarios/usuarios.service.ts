import type { UsersRepository } from "@/server/repositories/users.repo";
import type { Usuario } from "@/types/entities";

/**
 * Lectura del equipo para los selectores del panel: a quién asignar un lead,
 * entre quiénes repartir, a quién avisar.
 *
 * Existe para que una página no toque un repositorio: `app/**` sólo puede
 * importar servicios (zonas de `eslint.config.mjs`). No filtra ni rotula: a
 * quién se ofrece y cómo se lo nombra es de la pantalla que arma el selector.
 */
export interface UsuariosService {
  /** Todo el equipo, admins e inactivos incluidos. */
  listar(): Promise<Usuario[]>;
}

export class DefaultUsuariosService implements UsuariosService {
  constructor(private readonly deps: { users: UsersRepository }) {}

  async listar(): Promise<Usuario[]> {
    return this.deps.users.list();
  }
}
