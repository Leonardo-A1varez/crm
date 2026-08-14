import { beforeEach, describe, expect, test } from "vitest";
import { NotFoundError } from "@/lib/errors";
import { InMemoryLeadIdentificadoresRepository } from "@/server/repositories/lead-identificadores.repo";
import { InMemoryLeadsRepository } from "@/server/repositories/leads.repo";
import { InMemoryMergeCandidatesRepository } from "@/server/repositories/merge-candidates.repo";
import { DefaultLeadMergeDetectorService } from "@/server/services/lead-merge-detector.service";
import type { Canal, IdentificadorTipo } from "@/types/domain";
import type { Lead } from "@/types/entities";

async function seedLead(
  repo: InMemoryLeadsRepository,
  partial: { nombre: string; canal: Canal; marca?: string; modelo?: string },
) {
  return repo.create({
    nombre: partial.nombre,
    // Teléfono de relleno: la identidad real vive en los identificadores.
    telefono: `${partial.canal}:${crypto.randomUUID()}`,
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
  let identificadores: InMemoryLeadIdentificadoresRepository;
  let svc: DefaultLeadMergeDetectorService;

  beforeEach(() => {
    leads = new InMemoryLeadsRepository();
    candidates = new InMemoryMergeCandidatesRepository();
    identificadores = new InMemoryLeadIdentificadoresRepository();
    svc = new DefaultLeadMergeDetectorService(leads, candidates, identificadores);
  });

  const darIdentificador = (lead: Lead, tipo: IdentificadorTipo, valor: string) =>
    identificadores.create({
      lead_id: lead.id,
      tipo,
      valor,
      valor_original: valor,
      principal: true,
      origen: "manual",
    });

  test("lead inexistente lanza NotFoundError", async () => {
    await expect(svc.findCandidatesFor({ leadId: "fake" })).rejects.toBeInstanceOf(NotFoundError);
  });

  test("llamarse igual NO alcanza: sin identificador compartido no hay propuesta", async () => {
    // Este es el cambio de fondo. Antes bastaba el nombre y bastaba mal: hay
    // cientos de "Juan Perez" y ninguno es el mismo.
    const a = await seedLead(leads, { nombre: "Juan Perez", canal: "wa" });
    await seedLead(leads, { nombre: "Juan Perez", canal: "ig" });

    expect(await svc.findCandidatesFor({ leadId: a.id })).toEqual([]);
  });

  test("compartir teléfono propone el par aunque los nombres difieran", async () => {
    const a = await seedLead(leads, { nombre: "Juan Perez", canal: "wa" });
    const b = await seedLead(leads, { nombre: "J. Perez", canal: "ig" });
    await darIdentificador(a, "telefono", "5491155550001");
    await darIdentificador(b, "telefono", "5491155550001");

    const out = await svc.findCandidatesFor({ leadId: a.id });
    expect(out).toHaveLength(1);
    expect(out[0]?.dst_lead_id).toBe(b.id);
    expect(out[0]?.reasons).toEqual(["mismo_telefono"]);
    expect(out[0]?.similarity_score).toBeCloseTo(0.9);
  });

  test("el mismo canal ya no descarta el par", async () => {
    // Antes se exigía `canal_origen` distinto, así que dos leads de Instagram
    // de la misma persona no se proponían nunca.
    const a = await seedLead(leads, { nombre: "Ana", canal: "ig" });
    const b = await seedLead(leads, { nombre: "Ana", canal: "ig" });
    await darIdentificador(a, "email", "ana@mail.com");
    await darIdentificador(b, "email", "ana@mail.com");

    expect(await svc.findCandidatesFor({ leadId: a.id })).toHaveLength(1);
  });

  test("vehículos distintos ya no descartan: una persona puede tener dos autos", async () => {
    const a = await seedLead(leads, {
      nombre: "Ana",
      canal: "wa",
      marca: "Toyota",
      modelo: "Hilux",
    });
    const b = await seedLead(leads, { nombre: "Ana", canal: "ig", marca: "Ford", modelo: "Focus" });
    await darIdentificador(a, "ruc", "1790012345001");
    await darIdentificador(b, "ruc", "1790012345001");

    expect(await svc.findCandidatesFor({ leadId: a.id })).toHaveLength(1);
  });

  test("el nombre igual suma certeza pero no dispara solo", async () => {
    const a = await seedLead(leads, { nombre: "Ana Diaz", canal: "wa" });
    const b = await seedLead(leads, { nombre: "Ana Diaz", canal: "ig" });
    await darIdentificador(a, "email", "ana@mail.com");
    await darIdentificador(b, "email", "ana@mail.com");

    const out = await svc.findCandidatesFor({ leadId: a.id });
    expect(out[0]?.reasons).toEqual(["mismo_email", "mismo_nombre"]);
    // 0.85 del email + 0.05 del nombre.
    expect(out[0]?.similarity_score).toBeCloseTo(0.9);
  });

  test("el puntaje toma el tipo más fuerte, no la suma", async () => {
    const a = await seedLead(leads, { nombre: "Ana", canal: "wa" });
    const b = await seedLead(leads, { nombre: "Beatriz", canal: "ig" });
    await darIdentificador(a, "vin", "8AJFA3CD1K0123456");
    await darIdentificador(b, "vin", "8AJFA3CD1K0123456");
    await darIdentificador(a, "email", "x@mail.com");
    await darIdentificador(b, "email", "x@mail.com");

    const out = await svc.findCandidatesFor({ leadId: a.id });
    // VIN es 1: sumarle el email no puede pasar de 1.
    expect(out[0]?.similarity_score).toBe(1);
    // Lo más confiable primero, para que el motivo se lea de un vistazo.
    expect(out[0]?.reasons).toEqual(["mismo_vin", "mismo_email"]);
  });

  test("un par ya pendiente no se vuelve a proponer", async () => {
    const a = await seedLead(leads, { nombre: "Ana", canal: "wa" });
    const b = await seedLead(leads, { nombre: "Ana", canal: "ig" });
    await darIdentificador(a, "telefono", "5491155550009");
    await darIdentificador(b, "telefono", "5491155550009");
    await candidates.create({
      src_lead_id: a.id,
      dst_lead_id: b.id,
      similarity_score: 0.9,
      reasons: ["mismo_telefono"],
    });

    expect(await svc.findCandidatesFor({ leadId: a.id })).toEqual([]);
  });

  test("un par rechazado vuelve a proponerse pero recordCandidate no lo persiste", async () => {
    // El detector propone; `recordCandidate` es el que respeta la decisión
    // humana de haberlo rechazado. Separar las dos cosas deja que la propuesta
    // siga siendo visible en un scan manual sin volver a molestar en la UI.
    const a = await seedLead(leads, { nombre: "Ana", canal: "wa" });
    const b = await seedLead(leads, { nombre: "Ana", canal: "ig" });
    await darIdentificador(a, "telefono", "5491155550010");
    await darIdentificador(b, "telefono", "5491155550010");
    const cand = await candidates.create({
      src_lead_id: a.id,
      dst_lead_id: b.id,
      similarity_score: 0.9,
      reasons: ["mismo_telefono"],
    });
    await candidates.resolve(cand.id, "rejected", null);

    const out = await svc.findCandidatesFor({ leadId: a.id });
    expect(out).toHaveLength(1);
    expect(await svc.recordCandidate(out[0]!)).toBeNull();
  });

  test("un lead sin identificadores no propone nada", async () => {
    const a = await seedLead(leads, { nombre: "Solo", canal: "wa" });
    await seedLead(leads, { nombre: "Solo", canal: "ig" });

    expect(await svc.findCandidatesFor({ leadId: a.id })).toEqual([]);
  });

  test("valores distintos del mismo tipo no son coincidencia", async () => {
    const a = await seedLead(leads, { nombre: "Ana", canal: "wa" });
    const b = await seedLead(leads, { nombre: "Ana", canal: "ig" });
    await darIdentificador(a, "telefono", "5491155550001");
    await darIdentificador(b, "telefono", "5491199990002");

    expect(await svc.findCandidatesFor({ leadId: a.id })).toEqual([]);
  });
});
