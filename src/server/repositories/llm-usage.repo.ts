import type { LlmUsage, UUID } from "@/types/entities";
import type { Insert } from "./_types";

export type LlmUsageInsert = Insert<LlmUsage, "id" | "created_at"> & {
  /** Inyectable para tests deterministas; sin esto lo pone el DEFAULT de la tabla. */
  created_at?: Date;
};

/**
 * Lo que la tabla sabe del gasto de una sesión.
 *
 * Van juntos a propósito: una suma de 0 no dice nada sola. Puede ser una
 * conversación que resolvieron las reglas —gasto cero de verdad— o una de la
 * que no hay ninguna fila. `llamadas` es lo único que separa los dos casos, y
 * el panel los tiene que decir distinto.
 */
export interface ResumenGastoSesion {
  usd: number;
  /** Filas registradas para la sesión. 0 = la tabla no sabe nada de ella. */
  llamadas: number;
}

export interface ResumenGastoOpciones {
  /**
   * Workflows que no cuentan para este corte. Lo decide el caller y no el repo:
   * qué es "gasto de esta conversación" es una definición de producto, y otro
   * consumidor puede querer el total crudo.
   */
  excluirWorkflows?: readonly string[];
}

/**
 * Gasto por llamada al modelo. Append-only: no hay update ni delete.
 *
 * Los dos cortes que la UI necesita son sumas, no listados: "cuánto costó esta
 * conversación" (panel del Twin) y "cuánto se lleva gastado desde tal fecha"
 * (consola del agente). Se devuelven las filas y se suma en TypeScript en vez
 * de pedirle un aggregate a PostgREST: son decenas de filas por sesión y unos
 * miles por día a la escala de una instalación, y tener la cuenta acá la hace
 * testeable sin una base al lado. Si el volumen crece, lo que cambia es la
 * implementación Supabase y no los consumidores.
 */
export interface LlmUsageRepository {
  create(input: LlmUsageInsert): Promise<LlmUsage>;
  /** Gasto de una sesión. Todo en cero si la sesión no tiene filas o no existe. */
  resumenPorLeadSession(
    leadSessionId: UUID,
    opts?: ResumenGastoOpciones,
  ): Promise<ResumenGastoSesion>;
  /**
   * Cuándo se anotó la primera llamada de la historia; `null` con la tabla
   * vacía. Es la frontera de la medición: nada anterior a esa fecha tiene
   * gasto registrado, y por eso una conversación de antes no puede decir que
   * salió gratis. Se pregunta en vez de hardcodear la fecha de la migración
   * porque entre que la tabla existe y que el pipeline empieza a escribirla hay
   * un despliegue de por medio, y en otra instalación el hueco es otro.
   */
  primerRegistroAt(): Promise<Date | null>;
  /** Filas desde `desde` inclusive, para los cortes por ventana de tiempo. */
  listDesde(desde: Date): Promise<LlmUsage[]>;
}

/**
 * Default para los call sites donde la persistencia no aporta (tests rápidos,
 * `LLM_MODE=mock`). No guarda nada y no falla: el costo de un modelo mockeado
 * es cero y escribirlo solo ensuciaría la tabla.
 */
export class NoopLlmUsageRepository implements LlmUsageRepository {
  async create(input: LlmUsageInsert): Promise<LlmUsage> {
    return { ...input, id: crypto.randomUUID(), created_at: input.created_at ?? new Date() };
  }
  async resumenPorLeadSession(
    _leadSessionId: UUID,
    _opts?: ResumenGastoOpciones,
  ): Promise<ResumenGastoSesion> {
    return { usd: 0, llamadas: 0 };
  }
  async primerRegistroAt(): Promise<Date | null> {
    return null;
  }
  async listDesde(_desde: Date): Promise<LlmUsage[]> {
    return [];
  }
}

export class InMemoryLlmUsageRepository implements LlmUsageRepository {
  private readonly rows: LlmUsage[] = [];

  async create(input: LlmUsageInsert): Promise<LlmUsage> {
    const row: LlmUsage = {
      ...input,
      id: crypto.randomUUID(),
      created_at: input.created_at ?? new Date(),
    };
    this.rows.push(row);
    return { ...row };
  }

  async resumenPorLeadSession(
    leadSessionId: UUID,
    opts: ResumenGastoOpciones = {},
  ): Promise<ResumenGastoSesion> {
    const excluidos = new Set(opts.excluirWorkflows ?? []);
    let usd = 0;
    let llamadas = 0;
    for (const r of this.rows) {
      if (r.lead_session_id !== leadSessionId) continue;
      if (excluidos.has(r.workflow)) continue;
      usd += r.costo_usd;
      llamadas++;
    }
    return { usd, llamadas };
  }

  async primerRegistroAt(): Promise<Date | null> {
    let primera: Date | null = null;
    for (const r of this.rows) {
      if (!primera || r.created_at.getTime() < primera.getTime()) primera = r.created_at;
    }
    return primera;
  }

  async listDesde(desde: Date): Promise<LlmUsage[]> {
    return this.rows
      .filter((r) => r.created_at.getTime() >= desde.getTime())
      .map((r) => ({ ...r }));
  }
}
