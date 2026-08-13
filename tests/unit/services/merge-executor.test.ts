import { beforeEach, describe, expect, test, vi } from "vitest";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { InMemoryAdminAuditRepository } from "@/server/repositories/admin-audit.repo";
import { InMemoryConversationsRepository } from "@/server/repositories/conversations.repo";
import { InMemoryLeadsRepository } from "@/server/repositories/leads.repo";
import { InMemoryLeadSessionRepository } from "@/server/repositories/lead-session.repo";
import { InMemoryMergeCandidatesRepository } from "@/server/repositories/merge-candidates.repo";
import { InMemoryTagsRepository } from "@/server/repositories/tags.repo";
import { DefaultAdminAuditService } from "@/server/services/admin-audit.service";
import { DefaultMergeExecutorService } from "@/server/services/leads/merge-executor.service";
import type { LeadInsert } from "@/server/repositories/leads.repo";
import type { LeadSessionInsert } from "@/server/repositories/lead-session.repo";

// Helpers copiados de tests/unit/services/leads-service.test.ts (T4) — cada test
// file es autónomo, sin import cruzado entre archivos de test.
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

describe("DefaultMergeExecutorService.approveMerge", () => {
  let leads: InMemoryLeadsRepository;
  let sessions: InMemoryLeadSessionRepository;
  let convs: InMemoryConversationsRepository;
  let tags: InMemoryTagsRepository;
  let candidates: InMemoryMergeCandidatesRepository;
  let auditRepo: InMemoryAdminAuditRepository;
  let svc: DefaultMergeExecutorService;

  beforeEach(() => {
    leads = new InMemoryLeadsRepository();
    sessions = new InMemoryLeadSessionRepository();
    convs = new InMemoryConversationsRepository();
    tags = new InMemoryTagsRepository();
    candidates = new InMemoryMergeCandidatesRepository();
    auditRepo = new InMemoryAdminAuditRepository();
    svc = new DefaultMergeExecutorService({
      leads,
      sessions,
      convs,
      tags,
      candidates,
      audit: new DefaultAdminAuditService(auditRepo),
      lock: { withLock: async <T>(_key: string, fn: () => Promise<T>) => fn() },
    });
  });

  async function seedPair() {
    const ganador = await leads.create(
      baseLead({ nombre: "Juan", email: null, meta_user_ids: { wa: "w-ganador" } }),
    );
    const perdedor = await leads.create(
      baseLead({
        nombre: "Juan",
        email: "juan@mail.com",
        canal_origen: "ig",
        meta_user_ids: { ig: "i-perdedor", wa: "w-perdedor" },
      }),
    );
    const cand = await candidates.create({
      src_lead_id: perdedor.id,
      dst_lead_id: ganador.id,
      similarity_score: 0.7,
      reasons: ["nombre_exacto"],
    });
    return { ganador, perdedor, cand };
  }

  test("approveMerge corre dentro del lock del par de leads", async () => {
    const { ganador, perdedor, cand } = await seedPair();
    const clavesTomadas: string[] = [];
    const lockEspia = {
      withLock: async <T>(key: string, fn: () => Promise<T>): Promise<T> => {
        clavesTomadas.push(key);
        return fn();
      },
    };
    const conLock = new DefaultMergeExecutorService({
      leads,
      sessions,
      convs,
      tags,
      candidates,
      audit: new DefaultAdminAuditService(auditRepo),
      lock: lockEspia,
    });

    await conLock.approveMerge({
      candidateId: cand.id,
      keepLeadId: ganador.id,
      actorUserId: null,
    });

    expect(clavesTomadas).toEqual([`merge:${[ganador.id, perdedor.id].sort().join(":")}`]);
    expect(await leads.findById(perdedor.id)).toBeNull();
  });

  test("happy path: reasigna todo, rellena huecos, borra perdedor, audita primero", async () => {
    const { ganador, perdedor, cand } = await seedPair();
    const conv = await convs.upsertByCanalThread("ig", "thread-p", perdedor.id);
    const s = await sessions.create(baseSession(perdedor.id));
    await sessions.close(s.id, { resultado: "exito" });
    const tag = await tags.create({ nombre: "vip", color: "#ff0000", descripcion: null });
    await tags.assignToLead(perdedor.id, tag.id, "workflow");

    const r = await svc.approveMerge({
      candidateId: cand.id,
      keepLeadId: ganador.id,
      actorUserId: crypto.randomUUID(),
    });
    expect(r.ganadorId).toBe(ganador.id);

    // perdedor borrado
    expect(await leads.findById(perdedor.id)).toBeNull();
    // conv + sesión + tag reasignados
    expect((await convs.findById(conv.id))?.lead_id).toBe(ganador.id);
    expect((await sessions.listByLeadId(ganador.id)).map((x) => x.id)).toContain(s.id);
    expect((await tags.listByLead(ganador.id)).map((t) => t.nombre)).toContain("vip");
    // source preservado
    expect((await tags.listByLead(ganador.id))[0]?.source).toBe("workflow");
    // fill-nulls + meta union ganador prima
    const g = await leads.findById(ganador.id);
    expect(g?.email).toBe("juan@mail.com");
    expect(g?.meta_user_ids).toEqual({ wa: "w-ganador", ig: "i-perdedor" });
    // audit con snapshot
    const acciones = await auditRepo.list();
    expect(acciones).toHaveLength(1);
    expect(acciones[0]?.action).toBe("lead.merge");
    expect(acciones[0]?.payload).toMatchObject({
      ganador_id: ganador.id,
      perdedor: expect.objectContaining({ id: perdedor.id, telefono: perdedor.telefono }),
    });
  });

  test("campos no-null del ganador intocables", async () => {
    const ganador = await leads.create(baseLead({ nombre: "G", email: "g@mail.com" }));
    const perdedor = await leads.create(baseLead({ nombre: "G", email: "p@mail.com" }));
    const cand = await candidates.create({
      src_lead_id: perdedor.id,
      dst_lead_id: ganador.id,
      similarity_score: 1,
      reasons: ["manual"],
    });
    await svc.approveMerge({ candidateId: cand.id, keepLeadId: ganador.id, actorUserId: null });
    expect((await leads.findById(ganador.id))?.email).toBe("g@mail.com");
  });

  test("keepLeadId puede ser el src del candidate (admin elige dirección)", async () => {
    const { ganador, perdedor, cand } = await seedPair();
    // ojo: en seedPair el candidate es src=perdedor, dst=ganador. Acá elegimos al SRC como ganador.
    await svc.approveMerge({ candidateId: cand.id, keepLeadId: perdedor.id, actorUserId: null });
    expect(await leads.findById(ganador.id)).toBeNull();
    expect(await leads.findById(perdedor.id)).not.toBeNull();
  });

  test("ambas sesiones activas → ValidationError con copy exacto y CERO cambios", async () => {
    const { ganador, perdedor, cand } = await seedPair();
    await sessions.create(baseSession(ganador.id));
    await sessions.create(baseSession(perdedor.id));

    await expect(
      svc.approveMerge({ candidateId: cand.id, keepLeadId: ganador.id, actorUserId: null }),
    ).rejects.toThrow(
      "Ambos leads tienen sesión activa — cerrá una desde el inbox antes de fusionar.",
    );
    expect(await leads.findById(perdedor.id)).not.toBeNull();
    expect(await auditRepo.list()).toHaveLength(0); // validación corta ANTES del audit
  });

  test("solo el perdedor con activa → se mueve y sigue activa bajo el ganador", async () => {
    const { ganador, perdedor, cand } = await seedPair();
    const activa = await sessions.create(baseSession(perdedor.id));
    await svc.approveMerge({ candidateId: cand.id, keepLeadId: ganador.id, actorUserId: null });
    expect((await sessions.findActiveByLeadId(ganador.id))?.id).toBe(activa.id);
  });

  test("candidate ya resuelto → ConflictError; inexistente → NotFoundError", async () => {
    const { ganador, cand } = await seedPair();
    await candidates.resolve(cand.id, "rejected", null);
    await expect(
      svc.approveMerge({ candidateId: cand.id, keepLeadId: ganador.id, actorUserId: null }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      svc.approveMerge({
        candidateId: crypto.randomUUID(),
        keepLeadId: ganador.id,
        actorUserId: null,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  test("keepLeadId fuera del par → ValidationError", async () => {
    const { cand } = await seedPair();
    await expect(
      svc.approveMerge({
        candidateId: cand.id,
        keepLeadId: crypto.randomUUID(),
        actorUserId: null,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("orden de ejecución: audit → convs → sesiones → tags → campos → delete (regresión reordering)", async () => {
    const { ganador, perdedor, cand } = await seedPair();
    await convs.upsertByCanalThread("ig", "thread-orden", perdedor.id);
    const tag = await tags.create({ nombre: "orden", color: "#00ff00", descripcion: null });
    await tags.assignToLead(perdedor.id, tag.id, "manual");

    // Spies creados DESPUÉS del pre-seed de assignToLead (arriba) a propósito:
    // vi.spyOn no registra llamadas hechas antes de existir, así que
    // invocationCallOrder[0] de spyAssign sólo puede ser la llamada interna del
    // merge (paso 5) — sin necesidad de vi.clearAllMocks().
    const spyAudit = vi.spyOn(auditRepo, "create");
    const spyConvUpdate = vi.spyOn(convs, "update");
    const spyReassign = vi.spyOn(sessions, "reassignLead");
    const spyAssign = vi.spyOn(tags, "assignToLead");
    const spyLeadUpdate = vi.spyOn(leads, "update");
    const spyDelete = vi.spyOn(leads, "delete");

    await svc.approveMerge({ candidateId: cand.id, keepLeadId: ganador.id, actorUserId: null });

    const orden = [
      spyAudit.mock.invocationCallOrder[0],
      spyConvUpdate.mock.invocationCallOrder[0],
      spyReassign.mock.invocationCallOrder[0],
      spyAssign.mock.invocationCallOrder[0],
      spyLeadUpdate.mock.invocationCallOrder[0],
      spyDelete.mock.invocationCallOrder[0],
    ];
    // cada paso estrictamente después del anterior
    for (let i = 1; i < orden.length; i++) {
      expect(orden[i]).toBeGreaterThan(orden[i - 1]);
    }
  });

  test("fill-nulls: perdedor rellena TODOS los huecos del ganador", async () => {
    const ganador = await leads.create(
      baseLead({
        nombre: "G",
        email: null,
        direccion: null,
        vehiculo_marca: "",
        vehiculo_modelo: "",
        vehiculo_anio: 0,
        vehiculo_motor: null,
        empresa_id: null,
        meta_user_ids: {},
      }),
    );
    const empresaId = crypto.randomUUID();
    const perdedor = await leads.create(
      baseLead({
        nombre: "G",
        email: "p@mail.com",
        direccion: "Calle 123",
        vehiculo_marca: "Ford",
        vehiculo_modelo: "Ranger",
        vehiculo_anio: 2020,
        vehiculo_motor: "3.2 diesel",
        empresa_id: empresaId,
      }),
    );
    const cand = await candidates.create({
      src_lead_id: perdedor.id,
      dst_lead_id: ganador.id,
      similarity_score: 1,
      reasons: ["manual"],
    });
    await svc.approveMerge({ candidateId: cand.id, keepLeadId: ganador.id, actorUserId: null });
    const g = await leads.findById(ganador.id);
    expect(g).toMatchObject({
      email: "p@mail.com",
      direccion: "Calle 123",
      vehiculo_marca: "Ford",
      vehiculo_modelo: "Ranger",
      vehiculo_anio: 2020,
      vehiculo_motor: "3.2 diesel",
      empresa_id: empresaId,
    });
  });

  test("no-overwrite: ganador lleno queda intacto en TODOS los campos", async () => {
    const empresaG = crypto.randomUUID();
    const ganador = await leads.create(
      baseLead({
        nombre: "G",
        email: "g@mail.com",
        direccion: "Dir G",
        vehiculo_marca: "Toyota",
        vehiculo_modelo: "Hilux",
        vehiculo_anio: 2019,
        vehiculo_motor: "2.8",
        empresa_id: empresaG,
      }),
    );
    const perdedor = await leads.create(
      baseLead({
        nombre: "G",
        email: "p@mail.com",
        direccion: "Dir P",
        vehiculo_marca: "Ford",
        vehiculo_modelo: "Ranger",
        vehiculo_anio: 2020,
        vehiculo_motor: "3.2",
        empresa_id: crypto.randomUUID(),
      }),
    );
    const cand = await candidates.create({
      src_lead_id: perdedor.id,
      dst_lead_id: ganador.id,
      similarity_score: 1,
      reasons: ["manual"],
    });
    await svc.approveMerge({ candidateId: cand.id, keepLeadId: ganador.id, actorUserId: null });
    const g = await leads.findById(ganador.id);
    expect(g).toMatchObject({
      email: "g@mail.com",
      direccion: "Dir G",
      vehiculo_marca: "Toyota",
      vehiculo_modelo: "Hilux",
      vehiculo_anio: 2019,
      vehiculo_motor: "2.8",
      empresa_id: empresaG,
    });
  });

  test("nombre_perfil y datos_extra sobreviven al merge", async () => {
    const ganador = await leads.create(
      baseLead({ nombre: "G", nombre_perfil: null, datos_extra: { Patente: "AAA111" } }),
    );
    const perdedor = await leads.create(
      baseLead({
        nombre: "G",
        nombre_perfil: "Juanchi",
        datos_extra: { Patente: "BBB222", Cumpleaños: "12/03" },
      }),
    );
    const cand = await candidates.create({
      src_lead_id: perdedor.id,
      dst_lead_id: ganador.id,
      similarity_score: 1,
      reasons: ["manual"],
    });

    await svc.approveMerge({ candidateId: cand.id, keepLeadId: ganador.id, actorUserId: null });

    const g = await leads.findById(ganador.id);
    expect(g?.nombre_perfil).toBe("Juanchi");
    // Unión clave por clave: el ganador prima donde los dos tenían valor, y lo
    // que solo tenía el perdedor no se pierde con el CASCADE.
    expect(g?.datos_extra).toEqual({ Patente: "AAA111", Cumpleaños: "12/03" });
  });

  test("un nombre_perfil ya cargado en el ganador no lo pisa el perdedor", async () => {
    const ganador = await leads.create(baseLead({ nombre: "G", nombre_perfil: "Juan P." }));
    const perdedor = await leads.create(baseLead({ nombre: "G", nombre_perfil: "Juanchi" }));
    const cand = await candidates.create({
      src_lead_id: perdedor.id,
      dst_lead_id: ganador.id,
      similarity_score: 1,
      reasons: ["manual"],
    });

    await svc.approveMerge({ candidateId: cand.id, keepLeadId: ganador.id, actorUserId: null });

    expect((await leads.findById(ganador.id))?.nombre_perfil).toBe("Juan P.");
  });
});

describe("DefaultMergeExecutorService.rejectMerge / createManualCandidate", () => {
  let leads: InMemoryLeadsRepository;
  let sessions: InMemoryLeadSessionRepository;
  let convs: InMemoryConversationsRepository;
  let tags: InMemoryTagsRepository;
  let candidates: InMemoryMergeCandidatesRepository;
  let auditRepo: InMemoryAdminAuditRepository;
  let svc: DefaultMergeExecutorService;

  beforeEach(() => {
    leads = new InMemoryLeadsRepository();
    sessions = new InMemoryLeadSessionRepository();
    convs = new InMemoryConversationsRepository();
    tags = new InMemoryTagsRepository();
    candidates = new InMemoryMergeCandidatesRepository();
    auditRepo = new InMemoryAdminAuditRepository();
    svc = new DefaultMergeExecutorService({
      leads,
      sessions,
      convs,
      tags,
      candidates,
      audit: new DefaultAdminAuditService(auditRepo),
      lock: { withLock: async <T>(_key: string, fn: () => Promise<T>) => fn() },
    });
  });

  test("rejectMerge resuelve rejected; replay → ConflictError", async () => {
    const a = await leads.create(baseLead());
    const b = await leads.create(baseLead());
    const cand = await candidates.create({
      src_lead_id: a.id,
      dst_lead_id: b.id,
      similarity_score: 0.7,
      reasons: ["nombre_exacto"],
    });
    await svc.rejectMerge({ candidateId: cand.id, actorUserId: null });
    expect((await candidates.findById(cand.id))?.status).toBe("rejected");
    await expect(
      svc.rejectMerge({ candidateId: cand.id, actorUserId: null }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  test("createManualCandidate crea score 1 reasons manual; par pending duplicado → ConflictError; lead inexistente → NotFoundError", async () => {
    const a = await leads.create(baseLead());
    const b = await leads.create(baseLead());
    const c = await svc.createManualCandidate({ leadId: a.id, otherLeadId: b.id });
    expect(c.similarity_score).toBe(1);
    expect(c.reasons).toEqual(["manual"]);
    await expect(
      svc.createManualCandidate({ leadId: a.id, otherLeadId: b.id }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      svc.createManualCandidate({ leadId: a.id, otherLeadId: crypto.randomUUID() }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  test("rejectMerge candidate inexistente → NotFoundError", async () => {
    await expect(
      svc.rejectMerge({ candidateId: crypto.randomUUID(), actorUserId: null }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
