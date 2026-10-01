import { describe, expect, it, vi } from "vitest";
import { cargarEstadoCopiloto } from "@/app/(panel)/inbox/_lib/estado-copiloto";
import { InfraError, NotFoundError } from "@/lib/errors";
import { NoopLogger } from "@/lib/observability/logger";
import type { EstadoCopiloto } from "@/types/copiloto";

type Vista = Parameters<typeof cargarEstadoCopiloto>[0];

const SESION = { id: "s-1" } as unknown as NonNullable<Vista["session"]>;
const CONV = "22222222-2222-4222-8222-222222222222";

const ESTADO: EstadoCopiloto = {
  conversacionId: CONV,
  override: null,
  modoEfectivo: "copiloto",
  borrador: null,
};

function vista(parcial: Partial<Vista> = {}): Vista {
  return { session: SESION, conversacionId: CONV, canalActivo: "wa", ...parcial };
}

function logger() {
  const l = new NoopLogger();
  const warn = vi.spyOn(l, "warn");
  return { l, warn };
}

describe("cargarEstadoCopiloto", () => {
  it("en WhatsApp con sesión devuelve el estado del servicio", async () => {
    const estado = vi.fn().mockResolvedValue(ESTADO);
    const r = await cargarEstadoCopiloto(vista(), "m-1", { servicio: async () => ({ estado }) });
    expect(r).toBe(ESTADO);
    expect(estado).toHaveBeenCalledWith({ conversacionId: CONV, ultimoEntranteId: "m-1" });
  });

  it.each(["ig", "fb"] as const)("en %s no consulta el servicio", async (canalActivo) => {
    const servicio = vi.fn();
    const r = await cargarEstadoCopiloto(vista({ canalActivo }), null, { servicio });
    expect(r).toBeNull();
    expect(servicio).not.toHaveBeenCalled();
  });

  it("sin sesión activa o sin conversación no consulta el servicio", async () => {
    const servicio = vi.fn();
    expect(await cargarEstadoCopiloto(vista({ session: null }), null, { servicio })).toBeNull();
    expect(
      await cargarEstadoCopiloto(vista({ conversacionId: null }), null, { servicio }),
    ).toBeNull();
    expect(servicio).not.toHaveBeenCalled();
  });

  it.each([
    ["la base no contesta", new InfraError("postgrest caído con datos del cliente", "postgrest")],
    ["la conversación no existe", new NotFoundError("no existe", "conversacion", CONV)],
  ])("si %s degrada a null y avisa sin volcar el mensaje del error", async (_caso, error) => {
    const { l, warn } = logger();
    const r = await cargarEstadoCopiloto(vista(), null, {
      servicio: async () => ({ estado: vi.fn().mockRejectedValue(error) }),
      logger: l,
    });
    expect(r).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    const [msg, ctx] = warn.mock.calls[0]!;
    expect(msg).toBe("copiloto.estado.degradado");
    expect(ctx).toEqual({ conversacionId: CONV, error: error.name });
    expect(JSON.stringify(ctx)).not.toContain("datos del cliente");
  });

  it("si falla armar el servicio también degrada a null", async () => {
    const { l, warn } = logger();
    const r = await cargarEstadoCopiloto(vista(), null, {
      servicio: async () => {
        throw new Error("sin sesión");
      },
      logger: l,
    });
    expect(r).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
