import type { AppClient } from "@/server/db/client";
import { mapPostgrestError } from "@/server/db/postgrest-errors";
import { isUuid } from "@/server/db/uuid";
import type { TurnClassification, UUID } from "@/types/entities";
import type {
  TurnClassificationInsert,
  TurnClassificationsRepository,
} from "./turn-classifications.repo";

interface TurnClassificationRow {
  id: string;
  mensaje_id: string;
  intent_id: string | null;
  intent_nombre: string | null;
  confidence: number;
  created_at: string;
}

function mapRow(row: TurnClassificationRow): TurnClassification {
  return {
    id: row.id,
    mensaje_id: row.mensaje_id,
    intent_id: row.intent_id,
    intent_nombre: row.intent_nombre,
    confidence: row.confidence,
    created_at: new Date(row.created_at),
  };
}

/**
 * Supabase impl de `TurnClassificationsRepository`. Append-only: no hay update
 * ni delete. Las filas se van con el mensaje (CASCADE) cuando el cron purga la
 * sesión, igual que `rule_executions`.
 */
export class SupabaseTurnClassificationsRepository implements TurnClassificationsRepository {
  constructor(private readonly db: AppClient) {}

  async create(input: TurnClassificationInsert): Promise<TurnClassification> {
    const { data, error } = await this.db
      .from("turn_classifications")
      .insert({
        mensaje_id: input.mensaje_id,
        intent_id: input.intent_id,
        intent_nombre: input.intent_nombre,
        confidence: input.confidence,
      })
      .select()
      .single();

    if (error) {
      // UNIQUE (mensaje_id): el turno ya se auditó en un intento anterior del
      // workflow. Devolver la fila existente en vez de propagar deja el paso
      // replay-safe sin que el conteo por intent cuente el turno dos veces.
      if (error.code === "23505") {
        const existente = await this.findByMensajeId(input.mensaje_id);
        if (existente) return existente;
      }
      throw mapPostgrestError(error, { resource: "turn_classifications" });
    }
    return mapRow(data as TurnClassificationRow);
  }

  async findByMensajeId(mensajeId: UUID): Promise<TurnClassification | null> {
    if (!isUuid(mensajeId)) return null;
    const { data, error } = await this.db
      .from("turn_classifications")
      .select()
      .eq("mensaje_id", mensajeId)
      .maybeSingle();
    if (error) throw mapPostgrestError(error, { resource: "turn_classifications" });
    return data ? mapRow(data as TurnClassificationRow) : null;
  }
}
