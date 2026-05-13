import { describe, expect, test } from "vitest";
import { inngest } from "@/inngest/client";

describe("Inngest client", () => {
  test("instanciado con id 'crm'", () => {
    expect(inngest.id).toBe("crm");
  });
});
