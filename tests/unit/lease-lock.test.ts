import { describe, expect, it, vi } from "vitest";
import { InfraError } from "@/lib/errors";
import { LeaseLock, type AlmacenDeCandados } from "@/server/lock/lease-lock";

/**
 * Un almacén en memoria con la misma regla que `tomar_candado` en Postgres:
 * se toma si está libre o si el anterior venció.
 */
function almacen(ahora: () => number = () => Date.now()) {
  const filas = new Map<string, { duenio: string; venceMs: number }>();
  const tomas: string[] = [];
  const a: AlmacenDeCandados = {
    tomar: async (clave, duenio, ttlMs) => {
      const f = filas.get(clave);
      if (f && f.venceMs > ahora()) return false;
      filas.set(clave, { duenio, venceMs: ahora() + ttlMs });
      tomas.push(duenio);
      return true;
    },
    soltar: async (clave, duenio) => {
      if (filas.get(clave)?.duenio === duenio) filas.delete(clave);
    },
  };
  return { a, filas, tomas };
}

const rapido = { ttlMs: 30_000, esperaMaxMs: 2_000, intervaloMs: 1 };

describe("LeaseLock", () => {
  it("dos secciones con la misma clave no se pisan", async () => {
    const { a } = almacen();
    const lock = new LeaseLock(a, rapido);
    const orden: string[] = [];
    const seccion = (id: string) =>
      lock.withLock("k", async () => {
        orden.push(`${id}:entra`);
        await new Promise((r) => setTimeout(r, 5));
        orden.push(`${id}:sale`);
      });

    await Promise.all([seccion("a"), seccion("b")]);

    expect(orden).toEqual(
      orden[0] === "a:entra"
        ? ["a:entra", "a:sale", "b:entra", "b:sale"]
        : ["b:entra", "b:sale", "a:entra", "a:sale"],
    );
  });

  it("suelta el candado aunque la sección falle", async () => {
    const { a, filas } = almacen();
    const lock = new LeaseLock(a, rapido);

    await expect(
      lock.withLock("k", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(filas.size).toBe(0);
  });

  it("devuelve lo que devuelve la sección", async () => {
    const { a } = almacen();
    await expect(new LeaseLock(a, rapido).withLock("k", async () => 42)).resolves.toBe(42);
  });

  it("si no lo consigue a tiempo falla con InfraError, que Inngest reintenta", async () => {
    const { a } = almacen();
    await a.tomar("k", "otro", 60_000);

    await expect(
      new LeaseLock(a, { ...rapido, esperaMaxMs: 20 }).withLock("k", async () => 1),
    ).rejects.toBeInstanceOf(InfraError);
  });

  it("un candado vencido de un proceso que murió se puede tomar", async () => {
    let reloj = 0;
    const { a } = almacen(() => reloj);
    await a.tomar("k", "muerto", 1_000);
    reloj = 1_001;

    await expect(new LeaseLock(a, rapido).withLock("k", async () => "ok")).resolves.toBe("ok");
  });

  it("un fallo al soltar no tapa el resultado: el candado vence solo", async () => {
    const { a } = almacen();
    const onErrorAlSoltar = vi.fn();
    const lock = new LeaseLock(
      { ...a, soltar: async () => Promise.reject(new InfraError("red", "db")) },
      { ...rapido, onErrorAlSoltar },
    );

    await expect(lock.withLock("k", async () => "ok")).resolves.toBe("ok");
    expect(onErrorAlSoltar).toHaveBeenCalledWith(expect.any(InfraError));
  });
});
