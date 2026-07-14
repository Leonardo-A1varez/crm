import { describe, expect, test } from "vitest";
import { withSpan } from "@/lib/observability/tracing";

describe("withSpan", () => {
  test("retorna el resultado de fn", async () => {
    const out = await withSpan("test.ok", { canal: "wa" }, async () => 42);
    expect(out).toBe(42);
  });

  test("rethrow en error (no traga excepciones)", async () => {
    await expect(
      withSpan("test.fail", {}, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });
});
