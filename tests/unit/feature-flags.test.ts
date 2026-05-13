import { describe, expect, test } from "vitest";
import { AllEnabledFeatureFlags, FLAGS, StaticFeatureFlags } from "@/lib/feature-flags";

describe("StaticFeatureFlags", () => {
  test("retorna valor configurado", async () => {
    const flags = new StaticFeatureFlags({
      [FLAGS.AI_AGENT_ENABLED]: true,
      [FLAGS.AUTO_HANDOFF_ENABLED]: false,
    });
    expect(await flags.isEnabled(FLAGS.AI_AGENT_ENABLED)).toBe(true);
    expect(await flags.isEnabled(FLAGS.AUTO_HANDOFF_ENABLED)).toBe(false);
  });

  test("flag no configurado retorna false (default cerrado)", async () => {
    const flags = new StaticFeatureFlags({});
    expect(await flags.isEnabled("foo.unknown")).toBe(false);
  });
});

describe("AllEnabledFeatureFlags", () => {
  test("siempre retorna true", async () => {
    const flags = new AllEnabledFeatureFlags();
    expect(await flags.isEnabled(FLAGS.AI_AGENT_ENABLED)).toBe(true);
    expect(await flags.isEnabled("cualquier.cosa")).toBe(true);
  });
});

describe("FLAGS constants", () => {
  test("constantes definidas", () => {
    expect(FLAGS.AI_AGENT_ENABLED).toBe("ai_agent.enabled");
    expect(FLAGS.AUTO_HANDOFF_ENABLED).toBe("auto_handoff.enabled");
    expect(FLAGS.REACTIVATION_ENABLED).toBe("reactivation.enabled");
  });
});
