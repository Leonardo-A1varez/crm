import { describe, expect, test, vi } from "vitest";
import { ConsoleLogger } from "@/lib/observability/logger";
import { PinoLogger } from "@/lib/observability/pino-logger";

/**
 * Paridad de redacción con ConsoleLogger: mismo input → mismos campos
 * redactados. El sink cambia (pino vs console), el contrato PII no.
 */

const PII_CTX = {
  telefono: "+595981123456",
  mensaje: "hola necesito repuestos",
  email: "lead@mail.com",
  nested: { nombre: "Juan", vehiculo_marca: "Toyota" },
  leadId: "abc-123",
};

function captureConsoleEntry(): Record<string, unknown> {
  const spy = vi.spyOn(console, "log").mockImplementation(() => {});
  new ConsoleLogger({ scope: "test" }).info("evento", PII_CTX);
  const line = spy.mock.calls[0]?.[0] as string;
  spy.mockRestore();
  return JSON.parse(line) as Record<string, unknown>;
}

function capturePinoEntry(): Record<string, unknown> {
  const chunks: string[] = [];
  const logger = PinoLogger.forTest((chunk) => chunks.push(chunk), { scope: "test" });
  logger.info("evento", PII_CTX);
  const line = chunks[0];
  if (!line) throw new Error("pino no emitió");
  return JSON.parse(line) as Record<string, unknown>;
}

describe("PinoLogger", () => {
  test("redacta PII idéntico a ConsoleLogger", () => {
    const consoleEntry = captureConsoleEntry();
    const pinoEntry = capturePinoEntry();

    // Campos PII redactados iguales; estructurales (time) difieren.
    expect(pinoEntry["telefono"]).toBe(consoleEntry["telefono"]);
    expect(pinoEntry["mensaje"]).toBe(consoleEntry["mensaje"]);
    expect(pinoEntry["email"]).toBe(consoleEntry["email"]);
    expect(pinoEntry["nested"]).toEqual(consoleEntry["nested"]);
    // No-PII intactos.
    expect(pinoEntry["leadId"]).toBe("abc-123");
    // PII efectivamente redactada (no passthrough).
    expect(pinoEntry["telefono"]).not.toBe(PII_CTX.telefono);
  });

  test("shape JSON: level string + msg + time", () => {
    const entry = capturePinoEntry();
    expect(entry["level"]).toBe("info");
    expect(entry["msg"]).toBe("evento");
    expect(typeof entry["time"]).toBe("number");
  });

  test("child mergea bindings y también redacta", () => {
    const chunks: string[] = [];
    const base = PinoLogger.forTest((c) => chunks.push(c), { app: "crm" });
    const child = base.child({ scope: "inbox", telefono: "+595999888777" });
    child.warn("aviso");
    const entry = JSON.parse(chunks[0] ?? "{}") as Record<string, unknown>;
    expect(entry["app"]).toBe("crm");
    expect(entry["scope"]).toBe("inbox");
    expect(entry["telefono"]).not.toBe("+595999888777");
    expect(entry["level"]).toBe("warn");
  });
});
