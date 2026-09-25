import { randomUUID } from "node:crypto";
import { InfraError } from "@/lib/errors";
import type { SessionLock } from "./session-lock";

/**
 * Dónde viven los candados. En producción es la tabla `candados` de Postgres
 * (`SupabaseCandadosRepository`); la regla de quién gana la aplica la base en
 * un solo INSERT … ON CONFLICT, así que vale entre instancias de Vercel.
 */
export interface AlmacenDeCandados {
  /** `true` = es tuyo hasta dentro de `ttlMs`, o hasta que lo sueltes. */
  tomar(clave: string, duenio: string, ttlMs: number): Promise<boolean>;
  /** Suelta el candado sólo si sigue siendo de `duenio`. */
  soltar(clave: string, duenio: string): Promise<void>;
}

export interface OpcionesLeaseLock {
  /**
   * Cuánto dura el candado si quien lo tiene muere sin soltarlo. Tiene que
   * sobrar para la sección crítica: si la sección tarda más, otro puede entrar
   * con ella a medio correr.
   */
  ttlMs: number;
  /** Cuánto espera a que se libere antes de rendirse. */
  esperaMaxMs: number;
  /** Cada cuánto vuelve a intentar mientras espera. */
  intervaloMs: number;
  /** Un `soltar` que falló. No se relanza: el candado vence solo en `ttlMs`. */
  onErrorAlSoltar?: (error: unknown) => void;
}

const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Exclusión mutua entre procesos con un candado de Postgres que vence.
 *
 * No es `pg_advisory_lock`: cada llamada de PostgREST es su propia transacción
 * en una conexión del pool, así que un candado de sesión quedaría tomado en una
 * conexión que otro request reusa, y uno de transacción se suelta al volver del
 * RPC, antes de que corra la sección. Una fila con vencimiento sobrevive a eso
 * y a un proceso que muere con el candado en la mano.
 *
 * Existe porque la lección 11 de AGENTS.md dice que un wrapper con el nombre
 * correcto no prueba exclusión: producción inyectaba `NoopSessionLock`. Esta
 * implementación sí la da, mientras la sección crítica termine antes de `ttlMs`.
 */
export class LeaseLock implements SessionLock {
  constructor(
    private readonly almacen: AlmacenDeCandados,
    private readonly opciones: OpcionesLeaseLock,
  ) {}

  async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const duenio = randomUUID();
    const limite = Date.now() + this.opciones.esperaMaxMs;
    while (!(await this.almacen.tomar(key, duenio, this.opciones.ttlMs))) {
      if (Date.now() >= limite) {
        // InfraError y no un error de negocio: es contención, y el paso que
        // lo pidió todavía no escribió nada, así que reintentarlo es seguro.
        throw new InfraError(
          `no se pudo tomar el candado "${key}" en ${this.opciones.esperaMaxMs} ms`,
          "candados",
        );
      }
      await dormir(this.opciones.intervaloMs);
    }
    try {
      return await fn();
    } finally {
      await this.almacen.soltar(key, duenio).catch((error: unknown) => {
        this.opciones.onErrorAlSoltar?.(error);
      });
    }
  }
}
