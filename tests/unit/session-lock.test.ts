import { describe, expect, test } from "vitest";
import { InMemorySessionLock, NoopSessionLock } from "@/server/lock/session-lock";

describe("NoopSessionLock", () => {
  test("ejecuta fn sin serializar (sin lock real)", async () => {
    const lock = new NoopSessionLock();
    const result = await lock.withLock("k1", async () => 42);
    expect(result).toBe(42);
  });
});

describe("InMemorySessionLock", () => {
  test("withLock single ejecuta fn y retorna valor", async () => {
    const lock = new InMemorySessionLock();
    const result = await lock.withLock("k1", async () => "hello");
    expect(result).toBe("hello");
  });

  test("serializa 2 callers misma key (no overlap)", async () => {
    const lock = new InMemorySessionLock();
    let inFlight = 0;
    let peak = 0;

    const job = async (id: number) => {
      await lock.withLock("session-X", async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 10));
        inFlight--;
        return id;
      });
    };

    await Promise.all([job(1), job(2), job(3)]);

    expect(peak).toBe(1);
  });

  test("permite paralelismo entre keys distintos", async () => {
    const lock = new InMemorySessionLock();
    let inFlight = 0;
    let peak = 0;

    const job = async (key: string) => {
      await lock.withLock(key, async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 10));
        inFlight--;
      });
    };

    await Promise.all([job("a"), job("b"), job("c")]);

    expect(peak).toBe(3);
  });

  test("error en fn propaga + libera lock para siguiente caller", async () => {
    const lock = new InMemorySessionLock();
    const order: string[] = [];

    const p1 = lock.withLock("k", async () => {
      order.push("p1-start");
      throw new Error("boom");
    });

    const p2 = lock.withLock("k", async () => {
      order.push("p2-run");
      return "ok";
    });

    await expect(p1).rejects.toThrow("boom");
    await expect(p2).resolves.toBe("ok");
    expect(order).toEqual(["p1-start", "p2-run"]);
  });

  test("orden FIFO preservado", async () => {
    const lock = new InMemorySessionLock();
    const order: number[] = [];

    const jobs = [1, 2, 3, 4].map((id) =>
      lock.withLock("k", async () => {
        order.push(id);
      }),
    );

    await Promise.all(jobs);

    expect(order).toEqual([1, 2, 3, 4]);
  });
});
