import { beforeEach, describe, expect, it } from "vitest";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { NoopAdminAuditRepository } from "@/server/repositories/admin-audit.repo";
import { InMemoryUsersRepository } from "@/server/repositories/users.repo";
import { DefaultAdminAuditService } from "@/server/services/admin-audit.service";
import { DefaultUsuariosAdminService } from "@/server/services/usuarios/usuarios-admin.service";
import type { AdminActionInsert } from "@/server/repositories/admin-audit.repo";

describe("DefaultUsuariosAdminService.asignarEmpresaErp", () => {
  let users: InMemoryUsersRepository;
  let registradas: AdminActionInsert[];
  let svc: DefaultUsuariosAdminService;

  beforeEach(() => {
    users = new InMemoryUsersRepository();
    registradas = [];
    const repo = new NoopAdminAuditRepository();
    const crear = repo.create.bind(repo);
    repo.create = async (input) => {
      registradas.push(input);
      return crear(input);
    };
    svc = new DefaultUsuariosAdminService({ users, audit: new DefaultAdminAuditService(repo) });
  });

  async function vendedor() {
    return users.create({
      nombre: "Vendedora de prueba",
      email: "v@example.test",
      rol: "vendedor",
      activo: true,
    });
  }

  it("guarda la empresa y deja una fila de auditoría con el antes y el después", async () => {
    const u = await vendedor();
    const actor = crypto.randomUUID();

    const r = await svc.asignarEmpresaErp({ usuarioId: u.id, empresaErp: 3, actorId: actor });

    expect(r.empresa_erp).toBe(3);
    expect((await users.findById(u.id))?.empresa_erp).toBe(3);
    expect(registradas).toHaveLength(1);
    expect(registradas[0]).toMatchObject({
      actor_user_id: actor,
      action: "user.update_empresa_erp",
      entity_type: "usuario",
      entity_id: u.id,
      payload: { empresaErpAnterior: null, empresaErpNueva: 3 },
    });
  });

  it("null quita la empresa y registra de cuál venía", async () => {
    const u = await vendedor();
    await svc.asignarEmpresaErp({ usuarioId: u.id, empresaErp: 6, actorId: null });
    registradas.length = 0;

    await svc.asignarEmpresaErp({ usuarioId: u.id, empresaErp: null, actorId: null });

    expect((await users.findById(u.id))?.empresa_erp).toBeNull();
    expect(registradas[0]?.payload).toEqual({ empresaErpAnterior: 6, empresaErpNueva: null });
  });

  it("el payload de auditoría no lleva el email ni el nombre", async () => {
    const u = await vendedor();
    await svc.asignarEmpresaErp({ usuarioId: u.id, empresaErp: 1, actorId: null });
    expect(JSON.stringify(registradas[0])).not.toContain("example.test");
    expect(JSON.stringify(registradas[0])).not.toContain("Vendedora");
  });

  it("un usuario inexistente es NotFound y no audita", async () => {
    await expect(
      svc.asignarEmpresaErp({ usuarioId: crypto.randomUUID(), empresaErp: 1, actorId: null }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(registradas).toHaveLength(0);
  });

  it("una empresa fuera de 1, 3, 5 y 6 se rechaza", async () => {
    const u = await vendedor();
    await expect(
      svc.asignarEmpresaErp({ usuarioId: u.id, empresaErp: 2 as never, actorId: null }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(registradas).toHaveLength(0);
  });
});
