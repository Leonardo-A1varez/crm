import { esEmpresaErp } from "@/lib/catalogo/precios-erp";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { ADMIN_ACTIONS } from "@/server/services/admin-audit.service";
import type { UsersRepository } from "@/server/repositories/users.repo";
import type { AdminAuditService } from "@/server/services/admin-audit.service";
import type { EmpresaErp, Usuario, UUID } from "@/types/entities";

export interface AsignarEmpresaErpInput {
  usuarioId: UUID;
  /** `null` le quita la empresa: no se le resalta ninguna columna de precio. */
  empresaErp: EmpresaErp | null;
  actorId: UUID | null;
}

/**
 * Cambios del equipo que hace un administrador. Separado de `UsuariosService`
 * (lectura para los selectores) porque este escribe y audita.
 */
export interface UsuariosAdminService {
  asignarEmpresaErp(input: AsignarEmpresaErpInput): Promise<Usuario>;
}

export class DefaultUsuariosAdminService implements UsuariosAdminService {
  constructor(private readonly deps: { users: UsersRepository; audit: AdminAuditService }) {}

  async asignarEmpresaErp(input: AsignarEmpresaErpInput): Promise<Usuario> {
    if (input.empresaErp !== null && !esEmpresaErp(input.empresaErp)) {
      throw new ValidationError(`empresa del ERP inválida: ${String(input.empresaErp)}`);
    }
    const actual = await this.deps.users.findById(input.usuarioId);
    if (!actual) {
      throw new NotFoundError(
        `usuario no encontrado: ${input.usuarioId}`,
        "usuario",
        input.usuarioId,
      );
    }

    // Primero la escritura: si la base la rechaza (la policy es solo de admin) no
    // queda una fila de auditoría de un cambio que no ocurrió. El payload lleva solo
    // los códigos, nunca el nombre ni el email del usuario.
    const actualizado = await this.deps.users.update(input.usuarioId, {
      empresa_erp: input.empresaErp,
    });
    await this.deps.audit.recordAction({
      actorUserId: input.actorId,
      action: ADMIN_ACTIONS.USER_UPDATE_EMPRESA_ERP,
      entityType: "usuario",
      entityId: input.usuarioId,
      payload: {
        empresaErpAnterior: actual.empresa_erp ?? null,
        empresaErpNueva: input.empresaErp,
      },
    });
    return actualizado;
  }
}
