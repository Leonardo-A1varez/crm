import { describe, expect, test } from "vitest";
import { InfraError } from "@/lib/errors";
import { InMemoryLeadSessionRepository } from "@/server/repositories/lead-session.repo";
import { InMemoryLeadsRepository } from "@/server/repositories/leads.repo";
import { DefaultAgentePreviewSessionsService } from "@/server/services/agente/preview-sessions.service";

const baseLead = {
  nombre: "Casa Norte",
  nombre_perfil: null,
  telefono: "+573001112233",
  email: null,
  direccion: null,
  vehiculo_marca: null,
  vehiculo_modelo: null,
  vehiculo_anio: 2020,
  vehiculo_motor: null,
  empresa_id: null,
  canal_origen: "wa" as const,
  meta_user_ids: {},
  datos_extra: {},
};

describe("DefaultAgentePreviewSessionsService", () => {
  test("lista solo sesiones activas con su nombre de lead", async () => {
    const leads = new InMemoryLeadsRepository();
    const sessions = new InMemoryLeadSessionRepository();
    const lead = await leads.create(baseLead);
    const session = await sessions.create({
      lead_id: lead.id,
      current_stage: "nuevo",
      urgencia: "media",
      consulta: "pastillas",
      producto_cotizado_id: null,
      codigo_interno: null,
      precio_cotizado: null,
      cantidad: null,
      bloqueador: null,
      comprobante_pago_url: null,
      metodo_pago: null,
      resultado: null,
      motivo_perdida: null,
      ia_pausada: false,
    });

    const result = await new DefaultAgentePreviewSessionsService(sessions, leads).list();
    expect(result).toEqual({
      disponible: true,
      sesiones: [{ id: session.id, etiqueta: "Casa Norte" }],
    });
  });

  test("degrada solo el preview si la lectura falla", async () => {
    const leads = new InMemoryLeadsRepository();
    const sessions = new InMemoryLeadSessionRepository();
    sessions.listActive = async () => {
      throw new InfraError("RPC no disponible", "postgrest");
    };

    const result = await new DefaultAgentePreviewSessionsService(sessions, leads).list();
    expect(result).toEqual({ disponible: false, sesiones: [] });
  });
});
