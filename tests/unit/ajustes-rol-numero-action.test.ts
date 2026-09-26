import { beforeEach, describe, expect, test, vi } from "vitest";
import { GuardarRolNumeroSchema } from "@/lib/validation/ajustes.schema";

const mocks = vi.hoisted(() => ({
  getCurrentRol: vi.fn(),
  getAuthenticatedUser: vi.fn(),
  guardarRol: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/server/auth/guards", () => ({ getCurrentRol: mocks.getCurrentRol }));
vi.mock("@/server/auth/supabase-ssr", () => ({
  getAuthenticatedUser: mocks.getAuthenticatedUser,
}));
vi.mock("@/server/bootstrap/ajustes-bootstrap", () => ({
  getRegistrosWhatsAppServiceForRequest: async () => ({ guardarRol: mocks.guardarRol }),
}));

const { guardarRolNumeroAction } = await import("@/app/(panel)/ajustes/_actions/rol-numero.action");

/** Ids sintéticos. */
const ADMIN_ID = "0b9a4c1e-6c1d-4f7e-9a53-1f2d3c4b5a61";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCurrentRol.mockResolvedValue("admin");
  mocks.getAuthenticatedUser.mockResolvedValue({ id: ADMIN_ID });
  mocks.guardarRol.mockResolvedValue(undefined);
});

describe("GuardarRolNumeroSchema", () => {
  test("acepta un id numérico y un rol corto", () => {
    expect(GuardarRolNumeroSchema.parse({ phoneNumberId: "1278451868", rol: "Posventa" })).toEqual({
      phoneNumberId: "1278451868",
      rol: "Posventa",
    });
  });

  test("rechaza un id que no es de Meta: nada de rutas ni letras", () => {
    expect(GuardarRolNumeroSchema.safeParse({ phoneNumberId: "../1", rol: "x" }).success).toBe(
      false,
    );
  });

  test("rechaza un rol de más de 40 caracteres", () => {
    expect(
      GuardarRolNumeroSchema.safeParse({ phoneNumberId: "1", rol: "x".repeat(41) }).success,
    ).toBe(false);
  });

  test("rechaza campos de más", () => {
    expect(
      GuardarRolNumeroSchema.safeParse({ phoneNumberId: "1", rol: "x", actorId: ADMIN_ID }).success,
    ).toBe(false);
  });
});

describe("guardarRolNumeroAction", () => {
  test("un admin guarda el rol a su nombre y la pantalla se refresca", async () => {
    const r = await guardarRolNumeroAction({ phoneNumberId: "1278451868", rol: "Posventa" });

    expect(r).toEqual({ ok: true });
    expect(mocks.guardarRol).toHaveBeenCalledWith({
      phoneNumberId: "1278451868",
      rol: "Posventa",
      actorId: ADMIN_ID,
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/ajustes");
  });

  test("un vendedor no puede", async () => {
    mocks.getCurrentRol.mockResolvedValue("vendedor");
    const r = await guardarRolNumeroAction({ phoneNumberId: "1278451868", rol: "Posventa" });

    expect(r).toEqual({
      ok: false,
      error: "Solo un administrador puede cambiar el rol de un número.",
    });
    expect(mocks.guardarRol).not.toHaveBeenCalled();
  });

  test("un input inválido no llega al servicio", async () => {
    const r = await guardarRolNumeroAction({ phoneNumberId: "abc", rol: "Posventa" });

    expect(r.ok).toBe(false);
    expect(mocks.getCurrentRol).not.toHaveBeenCalled();
    expect(mocks.guardarRol).not.toHaveBeenCalled();
  });
});
