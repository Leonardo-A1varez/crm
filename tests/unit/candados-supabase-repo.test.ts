import { describe, expect, it, vi } from "vitest";
import { InfraError, ValidationError } from "@/lib/errors";
import type { AppClient } from "@/server/db/client";
import { SupabaseCandadosRepository } from "@/server/repositories/candados.supabase.repo";

/**
 * El repo sólo traduce: la regla de quién gana la aplica `tomar_candado` en
 * Postgres (migración `20260925120000_candados`), probada contra una réplica.
 */
function cliente(respuesta: { data: unknown; error: unknown }) {
  const rpc = vi.fn(async () => respuesta);
  return { db: { rpc } as unknown as AppClient, rpc };
}

describe("SupabaseCandadosRepository", () => {
  it("tomar llama a tomar_candado con sus parámetros y devuelve lo que decide la base", async () => {
    const { db, rpc } = cliente({ data: true, error: null });
    const repo = new SupabaseCandadosRepository(db);

    await expect(repo.tomar("k", "d", 30_000)).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith("tomar_candado", {
      p_clave: "k",
      p_duenio: "d",
      p_ttl_ms: 30_000,
    });
  });

  it("un null de la base es «no lo tomaste»", async () => {
    const { db } = cliente({ data: null, error: null });
    await expect(new SupabaseCandadosRepository(db).tomar("k", "d", 1)).resolves.toBe(false);
  });

  it("soltar llama a soltar_candado", async () => {
    const { db, rpc } = cliente({ data: null, error: null });
    await new SupabaseCandadosRepository(db).soltar("k", "d");
    expect(rpc).toHaveBeenCalledWith("soltar_candado", { p_clave: "k", p_duenio: "d" });
  });

  it("un error de la base sale como error de dominio", async () => {
    const { db } = cliente({ data: null, error: { code: "08006", message: "caída" } });
    await expect(new SupabaseCandadosRepository(db).tomar("k", "d", 1)).rejects.toBeInstanceOf(
      InfraError,
    );
  });

  it("un vencimiento inválido es error de entrada y no llega a la base", async () => {
    // La base también lo rechaza (22023), pero ese código `mapPostgrestError`
    // lo clasifica como InfraError, que se reintenta: un bug de config
    // reintentado hasta agotarse.
    const { db, rpc } = cliente({ data: true, error: null });
    const repo = new SupabaseCandadosRepository(db);
    for (const ttl of [0, -1, 1.5, Number.NaN]) {
      await expect(repo.tomar("k", "d", ttl)).rejects.toBeInstanceOf(ValidationError);
    }
    expect(rpc).not.toHaveBeenCalled();
  });
});
