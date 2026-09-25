import { InfraError } from "@/lib/errors";
import type { AppClient } from "@/server/db/client";
import { mapPostgrestError } from "@/server/db/postgrest-errors";
import type { Json } from "@/server/db/types.gen";
import type { DifusionEnvioInsert } from "./difusion-envios.repo";
import {
  exigirPlanDeLaDifusion,
  type DifusionProgramacionRepository,
  type ProgramacionInput,
  type ProgramacionResultado,
} from "./difusion-programacion.repo";

/**
 * Supabase impl de `DifusionProgramacionRepository`: una sola llamada a
 * `programar_difusion()`, que escribe el plan, cambia el estado y encola el
 * aviso al motor en la misma transacción.
 *
 * La función exige una persona admin (`is_admin()`): con el service-role no
 * hay persona y la base la rechaza. Se llama con el cliente autenticado del
 * request. Errores: 23505 → `ConflictError` (ya programada), P0002 →
 * `NotFoundError`, 42501 → `PermissionDeniedError`, 23514 → `ValidationError`.
 */
export class SupabaseDifusionProgramacionRepository implements DifusionProgramacionRepository {
  constructor(private readonly db: AppClient) {}

  async programar(input: ProgramacionInput): Promise<ProgramacionResultado> {
    exigirPlanDeLaDifusion(input);

    const { data, error } = await this.db.rpc("programar_difusion", {
      p_difusion_id: input.difusionId,
      p_programada_para: input.programadaPara.toISOString(),
      p_envios: input.filas.map(aFilaDePlan) as unknown as Json,
      // Sin canary se omite: la columna toma el default null de la función.
      ...(input.canaryTamano === null ? {} : { p_canary_tamano: input.canaryTamano }),
    });
    if (error) throw mapPostgrestError(error, { resource: "difusion" });

    const fila = (data ?? [])[0];
    if (!fila) {
      throw new InfraError("programar_difusion no devolvió las cifras del plan", "postgrest");
    }
    return { audienciaInicial: fila.audiencia_inicial, destinatarios: fila.destinatarios };
  }
}

/** La forma que lee `jsonb_to_recordset` en la función. `difusion_id` sale del parámetro. */
function aFilaDePlan(f: DifusionEnvioInsert) {
  return {
    lead_id: f.lead_id,
    telefono: f.telefono,
    estado: f.estado,
    motivo_exclusion: f.motivo_exclusion,
    ruta: f.ruta,
    tanda: f.tanda,
    programado_para: f.programado_para === null ? null : f.programado_para.toISOString(),
  };
}
