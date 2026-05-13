// Logger interface inyectable a services + handlers.
// Impls:
// - NoopLogger: default tests. Silencioso.
// - ConsoleLogger: JSON structured a console.log (info/debug) y console.error (warn/error).
//   Vercel Log Drains parsean JSON nativo.
// - PinoLogger (Fase 7): wrapper pino con Vercel Log Drains hook.
export type LogContext = Record<string, unknown>;

export interface Logger {
  debug(msg: string, ctx?: LogContext): void;
  info(msg: string, ctx?: LogContext): void;
  warn(msg: string, ctx?: LogContext): void;
  error(msg: string, ctx?: LogContext): void;
  child(bindings: LogContext): Logger;
}

export class NoopLogger implements Logger {
  debug(_msg: string, _ctx?: LogContext): void {}
  info(_msg: string, _ctx?: LogContext): void {}
  warn(_msg: string, _ctx?: LogContext): void {}
  error(_msg: string, _ctx?: LogContext): void {}
  child(_bindings: LogContext): Logger {
    return this;
  }
}

export class ConsoleLogger implements Logger {
  constructor(private readonly bindings: LogContext = {}) {}

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
    return new ConsoleLogger({ ...this.bindings, ...bindings });
  }

  private emit(level: string, msg: string, ctx?: LogContext): void {
    const entry = {
      level,
      msg,
      time: Date.now(),
      ...this.bindings,
      ...(ctx ?? {}),
    };
    const line = JSON.stringify(entry);
    if (level === "error" || level === "warn") {
      console.error(line);
    } else {
      console.log(line);
    }
  }
}
