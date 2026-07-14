import { ConsoleLogger, type LogContext, type Logger } from "./logger";
import { PinoLogger } from "./pino-logger";

/**
 * Factory de logger por entorno: producción → Pino JSON (Log Drains),
 * dev/test → ConsoleLogger (mismo contrato redactPii). Instancia raíz por
 * proceso; los call sites piden child con sus bindings.
 */
let root: Logger | null = null;

export function getLogger(bindings: LogContext = {}): Logger {
  if (root === null) {
    root =
      process.env.NODE_ENV === "production"
        ? PinoLogger.create({ app: "crm" })
        : new ConsoleLogger({ app: "crm" });
  }
  return Object.keys(bindings).length > 0 ? root.child(bindings) : root;
}
