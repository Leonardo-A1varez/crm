import type { AppClient } from "@/server/db/client";
import { mapPostgrestError } from "@/server/db/postgrest-errors";
import { isUuid } from "@/server/db/uuid";
import type { IdentificadorTipo } from "@/types/domain";
import type { LeadIdentificador, UUID } from "@/types/entities";
import type {
  CoincidenciaIdentificador,
  LeadIdentificadorInsert,
  LeadIdentificadoresRepository,
} from "./lead-identificadores.repo";

interface IdentificadorRow {
  id: string;
  lead_id: string;
  tipo: IdentificadorTipo;
  valor: string;
  valor_original: string | null;
  principal: boolean;
  origen: string;
  created_at: string;
}

function mapRow(row: IdentificadorRow): LeadIdentificador {
  return { ...row, created_at: new Date(row.created_at) };
}

export class SupabaseLeadIdentificadoresRepository implements LeadIdentificadoresRepository {
  constructor(private readonly db: AppClient) {}

  async listByLeadId(leadId: UUID): Promise<LeadIdentificador[]> {
    if (!isUuid(leadId)) return [];
    const { data, error } = await this.db
      .from("lead_identificadores")
      .select("*")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: true });
    if (error) throw mapPostgrestError(error, { resource: "lead_identificadores" });
    return ((data ?? []) as IdentificadorRow[]).map(mapRow);
  }

  async create(input: LeadIdentificadorInsert): Promise<LeadIdentificador> {
    const { data, error } = await this.db
      .from("lead_identificadores")
      .insert(input)
      .select()
      .single();
    if (error) throw mapPostgrestError(error, { resource: "lead_identificadores" });
    return mapRow(data as IdentificadorRow);
  }

  async delete(id: UUID): Promise<void> {
    if (!isUuid(id)) return;
    const { error } = await this.db.from("lead_identificadores").delete().eq("id", id);
    if (error) throw mapPostgrestError(error, { resource: "lead_identificadores" });
  }

  async findCoincidencias(leadId: UUID): Promise<CoincidenciaIdentificador[]> {
    if (!isUuid(leadId)) return [];
    // RPC y no dos consultas: el join se apoya en el índice `(tipo, valor)` y
    // vuelve agregado en un viaje. Preguntar por cada valor sería N+1.
    const { data, error } = await this.db.rpc("leads_que_comparten_identificador", {
      p_lead_id: leadId,
    });
    if (error) throw mapPostgrestError(error, { resource: "lead_identificadores" });

    return ((data ?? []) as { lead_id: string; tipos: string[] }[]).map((row) => ({
      leadId: row.lead_id,
      tipos: row.tipos as IdentificadorTipo[],
    }));
  }
}
