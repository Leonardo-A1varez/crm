import { beforeEach, describe, expect, test } from "vitest";
import { NotFoundError } from "@/lib/errors";
import { InMemoryLeadsRepository } from "@/server/repositories/leads.repo";
import { InMemoryLeadSessionRepository } from "@/server/repositories/lead-session.repo";
import { InMemoryMergeCandidatesRepository } from "@/server/repositories/merge-candidates.repo";
import { InMemoryTagsRepository } from "@/server/repositories/tags.repo";
import { DefaultLeadsService } from "@/server/services/leads/default-leads.service";
import type { LeadInsert } from "@/server/repositories/leads.repo";
import type { LeadSessionInsert } from "@/server/repositories/lead-session.repo";

let tel = 0;
function baseLead(overrides: Partial<LeadInsert> = {}): LeadInsert {
  tel += 1;
  return {
    nombre: "Lead Test",
    telefono: `+54911000${String(tel).padStart(4, "0")}`,
    email: null,
    direccion: null,
    vehiculo_marca: "Toyota",
    vehiculo_modelo: "Corolla",
    vehiculo_anio: 2018,
    vehiculo_motor: null,
    empresa_id: null,
    canal_origen: "wa",
    meta_user_ids: { wa: `wa-${tel}` },
    ...overrides,
  };
}

function baseSession(leadId: string): LeadSessionInsert {
  return {
    lead_id: leadId,
    current_stage: "identificando",
    urgencia: "media",
    consulta: "busca pastillas",
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
  };
}

describe("DefaultLeadsService", () => {
  let leads: InMemoryLeadsRepository;
  let sessions: InMemoryLeadSessionRepository;
  let candidates: InMemoryMergeCandidatesRepository;
  let tags: InMemoryTagsRepository;
  let svc: DefaultLeadsService;

  beforeEach(() => {
    leads = new InMemoryLeadsRepository();
    sessions = new InMemoryLeadSessionRepository();
    candidates = new InMemoryMergeCandidatesRepository();
    tags = new InMemoryTagsRepository();
    svc = new DefaultLeadsService({ leads, sessions, candidates, tags });
  });

  test("listLeads incluye TODOS los leads con badge sesionActiva, etapa y fechas", async () => {
    const conActiva = await leads.create(baseLead({ meta_user_ids: { wa: "w1", ig: "i1" } }));
    const sinActiva = await leads.create(baseLead({ canal_origen: "ig", meta_user_ids: {} }));
    await sessions.create(baseSession(conActiva.id));

    const page = await svc.listLeads();
    expect(page.items).toHaveLength(2);
    const item = page.items.find((i) => i.leadId === conActiva.id);
    expect(item?.sesionActiva).toBe(true);
    expect(item?.currentStage).toBe("identificando"); // etapa de la sesión abierta
    expect(item?.canalOrigen).toBe("wa");
    expect(item?.vehiculo).toBe("Toyota Corolla 2018");
    // El encabezado cuenta altas: `createdAt` viaja tal cual, sin derivar.
    expect(item?.createdAt).toEqual(conActiva.created_at);
    expect(item?.updatedAt).toEqual(conActiva.updated_at);
    const otro = page.items.find((i) => i.leadId === sinActiva.id);
    expect(otro?.sesionActiva).toBe(false);
    expect(otro?.currentStage).toBeNull(); // sin sesión abierta no hay etapa vigente
    expect(otro?.canalOrigen).toBe("ig");
  });

  test("listLeads: sesión cerrada no aporta etapa", async () => {
    const lead = await leads.create(baseLead());
    const s = await sessions.create(baseSession(lead.id));
    await sessions.close(s.id, { resultado: "exito" });

    const page = await svc.listLeads();
    expect(page.items[0]?.sesionActiva).toBe(false);
    expect(page.items[0]?.currentStage).toBeNull();
  });

  test("listLeads q delega al repo (trim + cap 100)", async () => {
    await leads.create(baseLead({ nombre: "Maria Fernanda" }));
    await leads.create(baseLead({ nombre: "Otro" }));
    const page = await svc.listLeads({ q: "  maria  " });
    expect(page.items).toHaveLength(1);
  });

  test("listLeads pendingPairs + soloDuplicados filtra a involucrados", async () => {
    const a = await leads.create(baseLead());
    const b = await leads.create(baseLead());
    await leads.create(baseLead()); // tercero, no involucrado
    await candidates.create({
      src_lead_id: a.id,
      dst_lead_id: b.id,
      similarity_score: 0.7,
      reasons: ["nombre_exacto"],
    });

    const page = await svc.listLeads({ soloDuplicados: true });
    expect(page.pendingPairs).toBe(1);
    expect(page.items.map((i) => i.leadId).sort()).toEqual([a.id, b.id].sort());
  });

  test("getLeadDetail arma ficha completa", async () => {
    const lead = await leads.create(baseLead());
    const other = await leads.create(baseLead({ nombre: "Duplicado Posible" }));
    const s1 = await sessions.create(baseSession(lead.id));
    await sessions.close(s1.id, { resultado: "perdido", motivo_perdida: "precio" });
    // Delay para evitar empate de started_at en el mismo milisegundo (mismo
    // patrón que el contract test de listByLeadId — T2).
    await new Promise((r) => setTimeout(r, 5));
    const s2 = await sessions.create(baseSession(lead.id)); // activa
    const tag = await tags.create({ nombre: "vip", color: "#ff0000", descripcion: null });
    await tags.assignToLead(lead.id, tag.id, "manual");
    const cand = await candidates.create({
      src_lead_id: lead.id,
      dst_lead_id: other.id,
      similarity_score: 1,
      reasons: ["manual"],
    });

    const d = await svc.getLeadDetail(lead.id);
    expect(d.lead.id).toBe(lead.id);
    expect(d.sesiones.map((s) => s.id)).toEqual([s2.id, s1.id]);
    expect(d.sesionActiva?.id).toBe(s2.id);
    expect(d.tags).toEqual([
      expect.objectContaining({ nombre: "vip", color: "#ff0000", source: "manual" }),
    ]);
    expect(d.duplicados).toHaveLength(1);
    expect(d.duplicados[0]?.candidateId).toBe(cand.id);
    expect(d.duplicados[0]?.otherLead.id).toBe(other.id);
  });

  test("getLeadDetail lead inexistente → NotFoundError", async () => {
    await expect(svc.getLeadDetail(crypto.randomUUID())).rejects.toBeInstanceOf(NotFoundError);
  });
});
