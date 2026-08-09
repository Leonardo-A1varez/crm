import { NotFoundError } from "@/lib/errors";
import type { AgenteConfig, AgenteConfigValores } from "@/types/agente";

export type AgenteConfigInsert = AgenteConfigValores & {
  version: number;
  nota: string | null;
  rollback_de: string | null;
  creada_por: string | null;
};

export interface AgenteConfigRepository {
  /** La version activa, o null si no hay ninguna (tabla recien creada). */
  findActiva(): Promise<AgenteConfig | null>;
  findById(id: string): Promise<AgenteConfig | null>;
  /** Versiones mas recientes primero. */
  list(limit?: number): Promise<AgenteConfig[]>;
  siguienteVersion(): Promise<number>;
  /** Crea inactiva: activar es un paso aparte y explicito. */
  crear(input: AgenteConfigInsert): Promise<AgenteConfig>;
  /** Desactiva la activa actual y activa esta. */
  activar(id: string): Promise<AgenteConfig>;
}

const DEFAULT_LIST_LIMIT = 50;

function clonar(c: AgenteConfig): AgenteConfig {
  return { ...c, horario: structuredClone(c.horario) };
}

export class InMemoryAgenteConfigRepository implements AgenteConfigRepository {
  private readonly store = new Map<string, AgenteConfig>();

  async findActiva(): Promise<AgenteConfig | null> {
    for (const c of this.store.values()) if (c.activa) return clonar(c);
    return null;
  }

  async findById(id: string): Promise<AgenteConfig | null> {
    const c = this.store.get(id);
    return c ? clonar(c) : null;
  }

  async list(limit: number = DEFAULT_LIST_LIMIT): Promise<AgenteConfig[]> {
    return [...this.store.values()]
      .sort((a, b) => b.version - a.version)
      .slice(0, limit)
      .map(clonar);
  }

  async siguienteVersion(): Promise<number> {
    let mayor = 0;
    for (const c of this.store.values()) if (c.version > mayor) mayor = c.version;
    return mayor + 1;
  }

  async crear(input: AgenteConfigInsert): Promise<AgenteConfig> {
    const config: AgenteConfig = {
      ...input,
      horario: structuredClone(input.horario),
      id: crypto.randomUUID(),
      activa: false,
      created_at: new Date().toISOString(),
    };
    this.store.set(config.id, config);
    return clonar(config);
  }

  async activar(id: string): Promise<AgenteConfig> {
    const objetivo = this.store.get(id);
    if (!objetivo) throw new NotFoundError(`config no encontrada: ${id}`, "agente_config", id);

    for (const c of this.store.values()) if (c.activa) c.activa = false;
    objetivo.activa = true;
    return clonar(objetivo);
  }
}
