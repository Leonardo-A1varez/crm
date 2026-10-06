import { beforeEach, describe, expect, test, vi } from "vitest";
import { NotFoundError, PermissionDeniedError } from "@/lib/errors";
import { AsignarEmpresaErpSchema } from "@/lib/validation/ajustes.schema";

const mocks = vi.hoisted(() => ({
  getCurrentRol: vi.fn(),
  getAuthenticatedUser: vi.fn(),
  asignarEmpresaErp: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/server/auth/guards", () => ({ getCurrentRol: mocks.getCurrentRol }));
vi.mock("@/server/auth/supabase-ssr", () => ({
  getAuthenticatedUser: mocks.getAuthenticatedUser,
}));
vi.mock("@/server/bootstrap/usuarios-bootstrap", () => ({
  getUsuariosAdminServiceForRequest: async () => ({
    asignarEmpresaErp: mocks.asignarEmpresaErp,
  }),
}));

const { asignarEmpresaErpAction } =
  await import("@/app/(panel)/ajustes/_actions/empresa-erp.action");

/** Ids sintéticos. */
const ADMIN_ID = "0b9a4c1e-6c1d-4f7e-9a53-1f2d3c4b5a61";
const USUARIO_ID = "5d2f7a90-3c44-4b0e-8f6a-2a1b9c8d7e60";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentRol.mockResolvedValue("admin");
  mocks.getAuthenticatedUser.mockResolvedValue({ id: ADMIN_ID });
  mocks.asignarEmpresaErp.mockResolvedValue({});
});

describe("AsignarEmpresaErpSchema", () => {
  test("acepta una empresa del ERP y null", () => {
    expect(AsignarEmpresaErpSchema.parse({ usuarioId: USUARIO_ID, empresaErp: 5 }).empresaErp).toBe(
      5,
    );
    expect(
      AsignarEmpresaErpSchema.parse({ usuarioId: USUARIO_ID, empresaErp: null }).empresaErp,
    ).toBeNull();
  });

  test("acepta la empresa como texto del select y vacío como sin empresa", () => {
    expect(
      AsignarEmpresaErpSchema.parse({ usuarioId: USUARIO_ID, empresaErp: "3" }).empresaErp,
    ).toBe(3);
    expect(
      AsignarEmpresaErpSchema.parse({ usuarioId: USUARIO_ID, empresaErp: "" }).empresaErp,
    ).toBeNull();
  });

  test("rechaza una empresa que no existe, un id que no es uuid y campos de más", () => {
    expect(
      AsignarEmpresaErpSchema.safeParse({ usuarioId: USUARIO_ID, empresaErp: 2 }).success,
    ).toBe(false);
    expect(AsignarEmpresaErpSchema.safeParse({ usuarioId: "x", empresaErp: 1 }).success).toBe(
      false,
    );
    expect(
      AsignarEmpresaErpSchema.safeParse({ usuarioId: USUARIO_ID, empresaErp: 1, actorId: "a" })
        .success,
    ).toBe(false);
  });
});

describe("asignarEmpresaErpAction", () => {
  test("un admin guarda la empresa a su nombre y la pantalla se refresca", async () => {
    const r = await asignarEmpresaErpAction({ usuarioId: USUARIO_ID, empresaErp: "6" });

    expect(r).toEqual({ ok: true });
    expect(mocks.asignarEmpresaErp).toHaveBeenCalledWith({
      usuarioId: USUARIO_ID,
      empresaErp: 6,
      actorId: ADMIN_ID,
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/ajustes");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/productos");
  });

  test("un vendedor no puede y no llega al servicio", async () => {
    mocks.getCurrentRol.mockResolvedValue("vendedor");

    const r = await asignarEmpresaErpAction({ usuarioId: USUARIO_ID, empresaErp: 1 });

    expect(r).toEqual({
      ok: false,
      error: "Solo un administrador puede cambiar la empresa de un usuario.",
    });
    expect(mocks.asignarEmpresaErp).not.toHaveBeenCalled();
  });

  test("un input inválido no llega ni a mirar el rol", async () => {
    const r = await asignarEmpresaErpAction({ usuarioId: "no-uuid", empresaErp: 1 });

    expect(r.ok).toBe(false);
    expect(mocks.getCurrentRol).not.toHaveBeenCalled();
    expect(mocks.asignarEmpresaErp).not.toHaveBeenCalled();
  });

  test("si la base rechaza la escritura (RLS) el mensaje es entendible", async () => {
    mocks.asignarEmpresaErp.mockRejectedValue(new PermissionDeniedError("rls"));

    const r = await asignarEmpresaErpAction({ usuarioId: USUARIO_ID, empresaErp: 1 });

    expect(r).toEqual({
      ok: false,
      error: "Solo un administrador puede cambiar la empresa de un usuario.",
    });
  });

  test("un usuario que ya no existe", async () => {
    mocks.asignarEmpresaErp.mockRejectedValue(new NotFoundError("x", "usuario", USUARIO_ID));

    const r = await asignarEmpresaErpAction({ usuarioId: USUARIO_ID, empresaErp: 1 });

    expect(r).toEqual({ ok: false, error: "Ese usuario ya no existe. Refrescá la página." });
  });
});
