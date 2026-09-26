import type { AppClient } from "@/server/db/client";
import { mapPostgrestError } from "@/server/db/postgrest-errors";
import type { UUID } from "@/types/entities";
import type { RolDeNumero, WhatsAppNumerosRolRepository } from "./whatsapp-numeros-rol.repo";

/**
 * Con el client authed del request: la RLS deja leer a admin y vendedor y
 * escribir sólo a admin (`whatsapp_numeros_rol_*_admin`).
 */
export class SupabaseWhatsAppNumerosRolRepository implements WhatsAppNumerosRolRepository {
  constructor(private readonly db: AppClient) {}

  async listar(): Promise<RolDeNumero[]> {
    // Una fila por número de la cuenta: son unidades, no miles. El rango
    // explícito igual evita depender del corte silencioso de PostgREST.
    const { data, error } = await this.db
      .from("whatsapp_numeros_rol")
      .select("phone_number_id, rol")
      .order("phone_number_id")
      .range(0, 499);
    if (error) throw mapPostgrestError(error, { resource: "whatsapp_numeros_rol" });
    return (data ?? []).map((r) => ({ phoneNumberId: r.phone_number_id, rol: r.rol }));
  }

  async guardar(input: {
    phoneNumberId: string;
    rol: string;
    actorId: UUID | null;
  }): Promise<void> {
    const { error } = await this.db.from("whatsapp_numeros_rol").upsert(
      {
        phone_number_id: input.phoneNumberId,
        rol: input.rol,
        actualizado_por: input.actorId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "phone_number_id" },
    );
    if (error) throw mapPostgrestError(error, { resource: "whatsapp_numeros_rol" });
  }

  async borrar(phoneNumberId: string): Promise<void> {
    const { error } = await this.db
      .from("whatsapp_numeros_rol")
      .delete()
      .eq("phone_number_id", phoneNumberId);
    if (error) throw mapPostgrestError(error, { resource: "whatsapp_numeros_rol" });
  }
}
