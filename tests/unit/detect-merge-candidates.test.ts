import { beforeEach, describe, expect, test } from "vitest";
import { InMemoryLeadsRepository } from "@/server/repositories/leads.repo";
import { InMemoryMergeCandidatesRepository } from "@/server/repositories/merge-candidates.repo";
import { DefaultLeadMergeDetectorService } from "@/server/services/lead-merge-detector.service";
import { InMemoryLeadIdentificadoresRepository } from "@/server/repositories/lead-identificadores.repo";
import {
  detectMergeCandidatesGlobalHandler,
  detectMergeCandidatesPerLeadHandler,
} from "@/inngest/functions/detect-merge-candidates";

const NOW = new Date("2026-05-12T00:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 24 * 60 * 60 * 1000);

async function seedLead(
  leads: InMemoryLeadsRepository,
  nombre: string,
  canal: "wa" | "ig" | "fb",
  metaUserId: string,
  createdAt: Date = NOW,
) {
  const created = await leads.create({
    nombre,
    telefono: canal === "wa" ? metaUserId : `${canal}:${metaUserId}`,
    email: null,
    direccion: null,
    vehiculo_marca: "",
    vehiculo_modelo: "",
    vehiculo_anio: 0,
    vehiculo_motor: null,
    empresa_id: null,
    canal_origen: canal,
    meta_user_ids: { [canal]: metaUserId },
  });
  // Forzar created_at para tests time-sensitive.
  const store = (leads as unknown as { store: Map<string, typeof created> }).store;
  store.set(created.id, { ...created, created_at: createdAt, updated_at: createdAt });
  return created;
}

/**
 * Le da el mismo telefono a dos leads. Es lo que el detector nuevo necesita
 * para proponer el par: llamarse igual dejo de alcanzar.
 */
async function compartirTelefono(
  repo: InMemoryLeadIdentificadoresRepository,
  leadA: string,
  leadB: string,
  valor: string,
) {
  for (const lead_id of [leadA, leadB]) {
    await repo.create({
      lead_id,
      tipo: "telefono",
      valor,
      valor_original: valor,
      principal: true,
      origen: "manual",
    });
  }
}

describe("detectMergeCandidatesPerLeadHandler", () => {
  let leads: InMemoryLeadsRepository;
  let candidates: InMemoryMergeCandidatesRepository;
  let identificadores: InMemoryLeadIdentificadoresRepository;
  let detector: DefaultLeadMergeDetectorService;

  beforeEach(() => {
    leads = new InMemoryLeadsRepository();
    candidates = new InMemoryMergeCandidatesRepository();
    identificadores = new InMemoryLeadIdentificadoresRepository();
    detector = new DefaultLeadMergeDetectorService(leads, candidates, identificadores);
  });

  test("no dup en BD: no proposals, no recorded", async () => {
    const lead = await seedLead(leads, "Juan Perez", "wa", "549110");

    const result = await detectMergeCandidatesPerLeadHandler(
      { leadId: lead.id },
      { detector, now: () => NOW },
    );

    expect(result.proposed).toBe(0);
    expect(result.recorded).toBe(0);
  });

  test("dup por identificador compartido → proposal + recorded", async () => {
    const leadWa = await seedLead(leads, "Juan Perez", "wa", "549110");
    const leadIg = await seedLead(leads, "Juan Perez", "ig", "ig_user_1");
    // El nombre igual ya no alcanza: lo que los ata es el telefono.
    await compartirTelefono(identificadores, leadWa.id, leadIg.id, "5491155550001");

    const result = await detectMergeCandidatesPerLeadHandler(
      { leadId: leadWa.id },
      { detector, now: () => NOW },
    );

    expect(result.proposed).toBe(1);
    expect(result.recorded).toBe(1);

    const pending = await candidates.list({ status: "pending" });
    expect(pending).toHaveLength(1);
  });

  test("ya existe pending para par: proposed=0, no re-recorded", async () => {
    const leadWa = await seedLead(leads, "Juan Perez", "wa", "549110");
    const leadIg = await seedLead(leads, "Juan Perez", "ig", "ig_user_1");
    await candidates.create({
      src_lead_id: leadWa.id,
      dst_lead_id: leadIg.id,
      similarity_score: 0.7,
      reasons: ["nombre_exacto", "canales_distintos"],
    });

    const result = await detectMergeCandidatesPerLeadHandler(
      { leadId: leadWa.id },
      { detector, now: () => NOW },
    );

    expect(result.proposed).toBe(0);
    expect(result.recorded).toBe(0);
  });
});

describe("detectMergeCandidatesGlobalHandler", () => {
  let leads: InMemoryLeadsRepository;
  let candidates: InMemoryMergeCandidatesRepository;
  let identificadores: InMemoryLeadIdentificadoresRepository;
  let detector: DefaultLeadMergeDetectorService;

  beforeEach(() => {
    leads = new InMemoryLeadsRepository();
    candidates = new InMemoryMergeCandidatesRepository();
    identificadores = new InMemoryLeadIdentificadoresRepository();
    detector = new DefaultLeadMergeDetectorService(leads, candidates, identificadores);
  });

  test("scan recientes detecta dup cross-canal", async () => {
    const maria1 = await seedLead(leads, "Maria Lopez", "wa", "549111", daysAgo(1));
    const maria2 = await seedLead(leads, "Maria Lopez", "ig", "ig_user_2", daysAgo(2));
    await seedLead(leads, "Pedro Ruiz", "fb", "fb_user_3", daysAgo(3));
    await compartirTelefono(identificadores, maria1.id, maria2.id, "5491199990001");

    const result = await detectMergeCandidatesGlobalHandler(
      {},
      { leads, detector, now: () => NOW },
    );

    expect(result.scanned).toBe(3);
    expect(result.proposed).toBeGreaterThanOrEqual(1);
    expect(result.recorded).toBeGreaterThanOrEqual(1);
  });

  test("filtra leads fuera de window: no scan ancient", async () => {
    await seedLead(leads, "Anciano", "wa", "ancient", daysAgo(60));

    const result = await detectMergeCandidatesGlobalHandler(
      {},
      { leads, detector, windowDays: 7, now: () => NOW },
    );

    expect(result.scanned).toBe(0);
  });
});
