import { describe, expect, test } from "vitest";
import { makeHealthHandler } from "@/app/api/health/route";

const PLACEHOLDER = "dev-placeholder";
const REAL_KEY = "signkey-real-abc123";

function makeFetchOk(): typeof fetch {
  return (async () => new Response("ok", { status: 200 })) as typeof fetch;
}

function makeFetchFail(): typeof fetch {
  return (async () => {
    throw new Error("network down");
  }) as unknown as typeof fetch;
}

describe("makeHealthHandler", () => {
  test("db ok + keys placeholder → 200 degraded con checks skipped", async () => {
    const handler = makeHealthHandler({
      checkDb: async () => true,
      inngestKey: PLACEHOLDER,
      openaiKey: PLACEHOLDER,
      fetchFn: makeFetchOk(),
    });

    const res = await handler();
    const body = (await res.json()) as { status: string; checks: Record<string, string> };

    expect(res.status).toBe(200);
    expect(body.status).toBe("degraded");
    expect(body.checks["db"]).toBe("ok");
    expect(body.checks["inngest"]).toBe("skipped");
    expect(body.checks["openai"]).toBe("skipped");
  });

  test("db fail → 503 down", async () => {
    const handler = makeHealthHandler({
      checkDb: async () => false,
      inngestKey: REAL_KEY,
      openaiKey: REAL_KEY,
      fetchFn: makeFetchOk(),
    });

    const res = await handler();
    const body = (await res.json()) as { status: string };

    expect(res.status).toBe(503);
    expect(body.status).toBe("down");
  });

  test("todo real y ok → 200 ok", async () => {
    const handler = makeHealthHandler({
      checkDb: async () => true,
      inngestKey: REAL_KEY,
      openaiKey: REAL_KEY,
      fetchFn: makeFetchOk(),
    });

    const res = await handler();
    const body = (await res.json()) as { status: string; checks: Record<string, string> };

    expect(res.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.checks["inngest"]).toBe("ok");
    expect(body.checks["openai"]).toBe("ok");
  });

  test("check externo falla → 200 degraded, sin mensaje de error crudo", async () => {
    const handler = makeHealthHandler({
      checkDb: async () => true,
      inngestKey: REAL_KEY,
      openaiKey: REAL_KEY,
      fetchFn: makeFetchFail(),
    });

    const res = await handler();
    const body = (await res.json()) as { status: string; checks: Record<string, string> };

    expect(res.status).toBe(200);
    expect(body.status).toBe("degraded");
    expect(body.checks["inngest"]).toBe("fail");
    expect(JSON.stringify(body)).not.toContain("network down");
  });
});
