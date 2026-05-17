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

describe("ConsoleLogger — PII redaction runtime (regla §0.9)", () => {
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

  test("ctx con telefono redacted", () => {
    new ConsoleLogger().info("event", { telefono: "+5491155550000", id: "1" });
    const entry = parse(logSpy.mock.calls[0]);
    expect(entry.telefono).toBe("[REDACTED]");
    expect(entry.id).toBe("1");
  });

  test("ctx con email redacted", () => {
    new ConsoleLogger().info("event", { email: "x@y.com" });
    const entry = parse(logSpy.mock.calls[0]);
    expect(entry.email).toBe("[REDACTED]");
  });

  test("bindings root con PII redacted", () => {
    new ConsoleLogger({ email: "root@x.com" }).info("evt");
    const entry = parse(logSpy.mock.calls[0]);
    expect(entry.email).toBe("[REDACTED]");
  });

  test("child bindings nested PII redacted", () => {
    const log = new ConsoleLogger().child({ lead: { telefono: "+1" } });
    log.info("evt");
    const entry = parse(logSpy.mock.calls[0]);
    expect(entry.lead).toEqual({ telefono: "[REDACTED]" });
  });

  test("meta_user_ids redacted (jsonb cross-canal)", () => {
    new ConsoleLogger().info("evt", { meta_user_ids: { wa: "+1", ig: "@u" } });
    const entry = parse(logSpy.mock.calls[0]);
    expect(entry.meta_user_ids).toBe("[REDACTED]");
  });

  test("level/time/msg estructurales NO redacted aunque msg contenga PII en texto", () => {
    new ConsoleLogger().info("user with email x@y.com");
    const entry = parse(logSpy.mock.calls[0]);
    // msg key estructural — redactPii es key-based, "msg" no es PII key
    expect(entry.msg).toBe("user with email x@y.com");
    expect(entry.level).toBe("info");
    expect(typeof entry.time).toBe("number");
  });

  test("ctx key 'message' (no 'msg') sí redacted", () => {
    new ConsoleLogger().info("evt", { message: "user said hi" });
    const entry = parse(logSpy.mock.calls[0]);
    expect(entry.message).toBe("[REDACTED]");
    expect(entry.msg).toBe("evt"); // estructural intacto
  });

  test("array de leads con PII redacted item-por-item", () => {
    new ConsoleLogger().info("batch", {
      leads: [{ telefono: "+1" }, { telefono: "+2" }],
    });
    const entry = parse(logSpy.mock.calls[0]);
    expect(entry.leads).toEqual([{ telefono: "[REDACTED]" }, { telefono: "[REDACTED]" }]);
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
