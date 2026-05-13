import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ConsoleLogger, NoopLogger, type LogContext } from "@/lib/observability/logger";

describe("NoopLogger", () => {
  test("metodos no throws", () => {
    const l = new NoopLogger();
    expect(() => l.debug("x")).not.toThrow();
    expect(() => l.info("x")).not.toThrow();
    expect(() => l.warn("x")).not.toThrow();
    expect(() => l.error("x")).not.toThrow();
  });

  test("child retorna instancia logger (chainable)", () => {
    const l = new NoopLogger();
    const child = l.child({ x: 1 });
    expect(() => child.info("test")).not.toThrow();
  });
});

describe("ConsoleLogger", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
  });

  function parse(call: unknown[]): Record<string, unknown> {
    return JSON.parse(call[0] as string);
  }

  test("info emite a console.log con level + msg + time", () => {
    new ConsoleLogger().info("hello", { user: "alice" });

    expect(logSpy).toHaveBeenCalledOnce();
    const entry = parse(logSpy.mock.calls[0]);
    expect(entry.level).toBe("info");
    expect(entry.msg).toBe("hello");
    expect(entry.user).toBe("alice");
    expect(typeof entry.time).toBe("number");
  });

  test("error emite a console.error no console.log", () => {
    new ConsoleLogger().error("oops");
    expect(errSpy).toHaveBeenCalledOnce();
    expect(logSpy).not.toHaveBeenCalled();
  });

  test("warn emite a console.error", () => {
    new ConsoleLogger().warn("careful");
    expect(errSpy).toHaveBeenCalledOnce();
  });

  test("child merges bindings", () => {
    const root = new ConsoleLogger({ app: "crm" });
    const child = root.child({ workflow: "on-message" });
    child.info("step");

    const entry = parse(logSpy.mock.calls[0]);
    expect(entry.app).toBe("crm");
    expect(entry.workflow).toBe("on-message");
  });

  test("child sobrescribe bindings con mismas keys", () => {
    const root = new ConsoleLogger({ k: "a" });
    const child = root.child({ k: "b" });
    child.info("test");

    const entry = parse(logSpy.mock.calls[0]);
    expect(entry.k).toBe("b");
  });

  test("ctx en call sobrescribe bindings", () => {
    const root = new ConsoleLogger({ app: "crm" });
    root.info("msg", { app: "override" });

    const entry = parse(logSpy.mock.calls[0]);
    expect(entry.app).toBe("override");
  });
});

describe("Logger contract para spy en tests", () => {
  test("permite captura de calls via implementación custom", () => {
    const entries: Array<{ level: string; msg: string; ctx?: LogContext }> = [];
    const spy: import("@/lib/observability/logger").Logger = {
      debug: (m, c) => entries.push({ level: "debug", msg: m, ctx: c }),
      info: (m, c) => entries.push({ level: "info", msg: m, ctx: c }),
      warn: (m, c) => entries.push({ level: "warn", msg: m, ctx: c }),
      error: (m, c) => entries.push({ level: "error", msg: m, ctx: c }),
      child: () => spy,
    };
    spy.info("x", { y: 1 });
    spy.error("err");
    expect(entries).toEqual([
      { level: "info", msg: "x", ctx: { y: 1 } },
      { level: "error", msg: "err", ctx: undefined },
    ]);
  });
});
