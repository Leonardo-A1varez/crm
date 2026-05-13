import { describe, expect, test, beforeEach } from "vitest";
import type { UsersRepository, UsuarioInsert } from "@/server/repositories/users.repo";

function baseInsert(overrides: Partial<UsuarioInsert> = {}): UsuarioInsert {
  return {
    nombre: "Admin Uno",
    email: "admin@example.com",
    rol: "admin",
    activo: true,
    ...overrides,
  };
}

export function runUsersContract(makeRepo: () => UsersRepository) {
  describe("UsersRepository contract", () => {
    let repo: UsersRepository;

    beforeEach(() => {
      repo = makeRepo();
    });

    test("create asigna id + created_at + persiste", async () => {
      const u = await repo.create(baseInsert());
      expect(u.id).toBeTypeOf("string");
      expect(u.created_at).toBeInstanceOf(Date);
      expect(u.email).toBe("admin@example.com");
      expect(await repo.findById(u.id)).toEqual(u);
    });

    test("create rechaza email duplicado", async () => {
      await repo.create(baseInsert());
      await expect(repo.create(baseInsert())).rejects.toThrow(/email/i);
    });

    test("findById null cuando id falta", async () => {
      expect(await repo.findById("missing")).toBeNull();
    });

    test("findByEmail localiza usuario", async () => {
      const u = await repo.create(baseInsert());
      const found = await repo.findByEmail("admin@example.com");
      expect(found?.id).toBe(u.id);
      expect(await repo.findByEmail("nope@x.com")).toBeNull();
    });

    test("update permite cambiar nombre/rol/activo", async () => {
      const u = await repo.create(baseInsert());
      const patched = await repo.update(u.id, {
        nombre: "Admin Modificado",
        rol: "vendedor",
        activo: false,
      });
      expect(patched.nombre).toBe("Admin Modificado");
      expect(patched.rol).toBe("vendedor");
      expect(patched.activo).toBe(false);
      expect(patched.email).toBe(u.email);
      expect(patched.created_at).toEqual(u.created_at);
    });

    test("update throws cuando id falta", async () => {
      await expect(repo.update("missing", { activo: false })).rejects.toThrow();
    });

    test("list sin filter devuelve todos", async () => {
      await repo.create(baseInsert());
      await repo.create(baseInsert({ email: "vendedor@example.com", rol: "vendedor" }));
      const all = await repo.list();
      expect(all).toHaveLength(2);
    });

    test("list filtra por rol", async () => {
      await repo.create(baseInsert({ email: "a@x.com", rol: "admin" }));
      await repo.create(baseInsert({ email: "v1@x.com", rol: "vendedor" }));
      await repo.create(baseInsert({ email: "v2@x.com", rol: "vendedor" }));

      const admins = await repo.list({ rol: "admin" });
      expect(admins).toHaveLength(1);

      const vendedores = await repo.list({ rol: "vendedor" });
      expect(vendedores).toHaveLength(2);
    });
  });
}
