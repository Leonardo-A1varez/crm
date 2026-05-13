import { beforeEach, describe, expect, test } from "vitest";
import { InMemoryLeadsRepository } from "@/server/repositories/leads.repo";
import { InMemoryMergeCandidatesRepository } from "@/server/repositories/merge-candidates.repo";
import { DefaultLeadMergeDetectorService } from "@/server/services/lead-merge-detector.service";
import { NotFoundError } from "@/lib/errors";
import type { Canal } from "@/types/domain";

async function seedLead(
  repo: InMemoryLeadsRepository,
  partial: {
    nombre: string;
    canal: Canal;
    telefono?: string;
    marca?: string;
    modelo?: string;
  },
) {
  return repo.create({
    nombre: partial.nombre,
    telefono: partial.telefono ?? `${partial.canal}:${crypto.randomUUID()}`,
    email: null,
    direccion: null,
    vehiculo_marca: partial.marca ?? "",
    vehiculo_modelo: partial.modelo ?? "",
    vehiculo_anio: 0,
    vehiculo_motor: null,
    empresa_id: null,
    canal_origen: partial.canal,
    meta_user_ids: { [partial.canal]: crypto.randomUUID() },
  });
}

describe("LeadMergeDetector.findCandidatesFor", () => {
  let leads: InMemoryLeadsRepository;
  let candidates: InMemoryMergeCandidatesRepository;
  let svc: DefaultLeadMergeDetectorService;

  beforeEach(() => {
    leads = new InMemoryLeadsRepository();
    candidates = new InMemoryMergeCandidatesRepository();
    svc = new DefaultLeadMergeDetectorService(leads, candidates);
  });

  test("lead inexistente lanza NotFoundError", async () => {
    await expect(svc.findCandidatesFor({ leadId: "fake" })).rejects.toBeInstanceOf(NotFoundError);
  });

  test("lead con nombre vacío no genera candidates", async () => {
    const a = await seedLead(leads, { nombre: "", canal: "wa" });
    await seedLead(leads, { nombre: "", canal: "ig" });
    const out = await svc.findCandidatesFor({ leadId: a.id });
    expect(out).toEqual([]);
  });

  test("dos leads mismo nombre + canales distintos → candidate", async () => {
    const a = await seedLead(leads, { nombre: "Juan Perez", canal: "wa" });
    const b = await seedLead(leads, { nombre: "Juan Perez", canal: "ig" });

    const out = await svc.findCandidatesFor({ leadId: a.id });
    expect(out).toHaveLength(1);
    expect(out[0].dst_lead_id).toBe(b.id);
    expect(out[0].reasons).toContain("nombre_exacto");
    expect(out[0].reasons).toContain("canales_distintos");
    expect(out[0].similarity_score).toBeGreaterThan(0);
  });

  test("nombre case-insensitive + trim", async () => {
    const a = await seedLead(leads, { nombre: "  Juan Perez ", canal: "wa" });
    await seedLead(leads, { nombre: "juan perez", canal: "ig" });

    const out = await svc.findCandidatesFor({ leadId: a.id });
    expect(out).toHaveLength(1);
  });

  test("nombres distintos no genera candidate", async () => {
    const a = await seedLead(leads, { nombre: "Juan", canal: "wa" });
    await seedLead(leads, { nombre: "Maria", canal: "ig" });

    const out = await svc.findCandidatesFor({ leadId: a.id });
    expect(out).toEqual([]);
  });

  test("mismo canal_origen no genera candidate", async () => {
    const a = await seedLead(leads, { nombre: "Juan", canal: "wa" });
    await seedLead(leads, { nombre: "Juan", canal: "wa" }).catch(() => undefined);
    // Different telefonos para evitar UNIQUE violation
    await leads.create({
      nombre: "Juan",
      telefono: "second-wa",
      email: null,
      direccion: null,
      vehiculo_marca: "",
      vehiculo_modelo: "",
      vehiculo_anio: 0,
      vehiculo_motor: null,
      empresa_id: null,
      canal_origen: "wa",
      meta_user_ids: { wa: "x" },
    });

    const out = await svc.findCandidatesFor({ leadId: a.id });
    expect(out).toEqual([]);
  });

  test("vehiculo_marca distinto descarta candidate", async () => {
    const a = await seedLead(leads, { nombre: "Juan", canal: "wa", marca: "Toyota" });
    await seedLead(leads, { nombre: "Juan", canal: "ig", marca: "Ford" });

    const out = await svc.findCandidatesFor({ leadId: a.id });
    expect(out).toEqual([]);
  });

  test("misma vehiculo_marca permite candidate", async () => {
    const a = await seedLead(leads, { nombre: "Juan", canal: "wa", marca: "Toyota" });
    await seedLead(leads, { nombre: "Juan", canal: "ig", marca: "Toyota" });

    const out = await svc.findCandidatesFor({ leadId: a.id });
    expect(out).toHaveLength(1);
  });

  test("candidate ya aprobado entre par se omite", async () => {
    const a = await seedLead(leads, { nombre: "Juan", canal: "wa" });
    const b = await seedLead(leads, { nombre: "Juan", canal: "ig" });
    const candidate = await candidates.create({
      src_lead_id: a.id,
      dst_lead_id: b.id,
      similarity_score: 0.7,
      reasons: ["nombre_exacto"],
    });
    await candidates.resolve(candidate.id, "approved", null);

    const out = await svc.findCandidatesFor({ leadId: a.id });
    expect(out).toEqual([]);
  });

  test("candidate pending entre par se omite (no re-propose)", async () => {
    const a = await seedLead(leads, { nombre: "Juan", canal: "wa" });
    const b = await seedLead(leads, { nombre: "Juan", canal: "ig" });
    await candidates.create({
      src_lead_id: a.id,
      dst_lead_id: b.id,
      similarity_score: 0.7,
      reasons: [],
    });

    const out = await svc.findCandidatesFor({ leadId: a.id });
    expect(out).toEqual([]);
  });
});

describe("LeadMergeDetector.recordCandidate", () => {
  let leads: InMemoryLeadsRepository;
  let candidates: InMemoryMergeCandidatesRepository;
  let svc: DefaultLeadMergeDetectorService;

  beforeEach(() => {
    leads = new InMemoryLeadsRepository();
    candidates = new InMemoryMergeCandidatesRepository();
    svc = new DefaultLeadMergeDetectorService(leads, candidates);
  });

  test("persiste candidate nuevo", async () => {
    const a = await seedLead(leads, { nombre: "Juan", canal: "wa" });
    const b = await seedLead(leads, { nombre: "Juan", canal: "ig" });

    const c = await svc.recordCandidate({
      src_lead_id: a.id,
      dst_lead_id: b.id,
      similarity_score: 0.7,
      reasons: ["nombre_exacto"],
    });

    expect(c).not.toBeNull();
    expect(c!.status).toBe("pending");
  });

  test("retorna null si pending ya existe (idempotente)", async () => {
    const a = await seedLead(leads, { nombre: "Juan", canal: "wa" });
    const b = await seedLead(leads, { nombre: "Juan", canal: "ig" });

    await svc.recordCandidate({
      src_lead_id: a.id,
      dst_lead_id: b.id,
      similarity_score: 0.7,
      reasons: [],
    });
    const second = await svc.recordCandidate({
      src_lead_id: a.id,
      dst_lead_id: b.id,
      similarity_score: 0.9,
      reasons: [],
    });
    expect(second).toBeNull();
  });
});
