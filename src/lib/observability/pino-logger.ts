import pino from "pino";
import { redactPii } from "./redact";
import type { LogContext, Logger } from "./logger";

/**
 * Logger producción: pino JSON a stdout (Vercel Log Drains parsean nativo).
 * Mismo contrato PII que ConsoleLogger: redactPii sobre bindings+ctx en cada
 * emit (no en child — paridad exacta). Shape: { level, msg, time, ...ctx }.
 */

const BASE_OPTIONS: pino.LoggerOptions = {
  // Sin pid/hostname (base) — ruido en serverless.
  base: undefined,
  timestamp: pino.stdTimeFunctions.epochTime,
  formatters: {
    level: (label) => ({ level: label }),
  },
  // Nivel debug: el filtrado real lo hace el drain/plataforma.
  level: "debug",
};

export class PinoLogger implements Logger {
  private constructor(
    private readonly instance: pino.Logger,
    private readonly bindings: LogContext,
  ) {}

  static create(bindings: LogContext = {}): PinoLogger {
    return new PinoLogger(pino(BASE_OPTIONS), bindings);
  }

  /** Test-only: sink inyectable para capturar líneas sin stdout. */
  static forTest(sink: (chunk: string) => void, bindings: LogContext = {}): PinoLogger {
    const destination: pino.DestinationStream = {
      write(chunk: string) {
        sink(chunk);
      },
    };
    return new PinoLogger(pino(BASE_OPTIONS, destination), bindings);
  }

  debug(msg: string, ctx?: LogContext): void {
    this.emit("debug", msg, ctx);
  }

  info(msg: string, ctx?: LogContext): void {
    this.emit("info", msg, ctx);
  }

  warn(msg: string, ctx?: LogContext): void {
    this.emit("warn", msg, ctx);
  }

  error(msg: string, ctx?: LogContext): void {
    this.emit("error", msg, ctx);
  }

  child(bindings: LogContext): Logger {
    return new PinoLogger(this.instance, { ...this.bindings, ...bindings });
  }

  private emit(level: "debug" | "info" | "warn" | "error", msg: string, ctx?: LogContext): void {
    const merged = { ...this.bindings, ...(ctx ?? {}) };
    const redacted = redactPii(merged) as LogContext;
    this.instance[level](redacted, msg);
  }
}
