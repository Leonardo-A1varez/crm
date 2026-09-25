import { beforeEach, describe, expect, test } from "vitest";
import { InMemoryUsersRepository } from "@/server/repositories/users.repo";
import { DefaultUsuariosService } from "@/server/services/usuarios/usuarios.service";

describe("DefaultUsuariosService", () => {
  let users: InMemoryUsersRepository;
  let svc: DefaultUsuariosService;

  beforeEach(() => {
    users = new InMemoryUsersRepository();
    svc = new DefaultUsuariosService({ users });
  });

  test("lista a todo el equipo, admins e inactivos incluidos", async () => {
    await users.create({ nombre: "Ana", email: "ana@crm.local", rol: "vendedor", activo: true });
    await users.create({ nombre: "Leo", email: "leo@crm.local", rol: "admin", activo: true });
    await users.create({ nombre: "Paz", email: "paz@crm.local", rol: "vendedor", activo: false });

    const lista = await svc.listar();

    // Un inactivo se lista igual: un flujo guardado puede seguir apuntándole, y
    // quien arma el selector necesita poder mostrarlo marcado.
    expect(lista.map((u) => u.nombre).sort()).toEqual(["Ana", "Leo", "Paz"]);
  });

  test("sin usuarios, lista vacía", async () => {
    expect(await svc.listar()).toEqual([]);
  });
});
