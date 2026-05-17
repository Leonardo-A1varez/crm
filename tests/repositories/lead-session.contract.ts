import { describe, expect, test, beforeEach } from "vitest";
import type {
  LeadSessionInsert,
  LeadSessionRepository,
} from "@/server/repositories/lead-session.repo";
import type { UUID } from "@/types/entities";

export interface LeadSessionContractFixtures {
  leadIds: {
    one: UUID;
    X: UUID;
    Y: UUID;
    A: UUID;
    two: UUID;
    three: UUID;
    none: UUID;
  };
}

const DEFAULT_FIXTURES: LeadSessionContractFixtures = {
  leadIds: {
    one: "lead-1",
    X: "lead-X",
    Y: "lead-Y",
    A: "lead-A",
    two: "lead-2",
    three: "lead-3",
    none: "lead-none",
  },
};

export type LeadSessionContractFixturesArg =
  | LeadSessionContractFixtures
  | (() => LeadSessionContractFixtures);

function baseInsert(leadId: UUID): LeadSessionInsert {
  return {
    lead_id: leadId,
    current_stage: "nuevo",
    urgencia: "media",
    consulta: "Pastillas de freno Corolla 2015",
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

export function runLeadSessionContract(
  makeRepo: () => LeadSessionRepository,
  fixturesArg: LeadSessionContractFixturesArg = DEFAULT_FIXTURES,
) {
  describe("LeadSessionRepository contract", () => {
    let repo: LeadSessionRepository;
    let fixtures: LeadSessionContractFixtures;

    beforeEach(() => {
      repo = makeRepo();
      fixtures = typeof fixturesArg === "function" ? fixturesArg() : fixturesArg;
    });

    test("create asigna id + started_at + closed_at null", async () => {
      const s = await repo.create(baseInsert(fixtures.leadIds.one));
      expect(s.id).toBeTypeOf("string");
      expect(s.started_at).toBeInstanceOf(Date);
      expect(s.closed_at).toBeNull();
      expect(s.resultado).toBeNull();

      const fetched = await repo.findById(s.id);
      expect(fetched).toEqual(s);
    });

    test("create rechaza segunda sesión activa para el mismo lead", async () => {
      await repo.create(baseInsert(fixtures.leadIds.X));
      await expect(repo.create(baseInsert(fixtures.leadIds.X))).rejects.toThrow(/activ/i);
    });

    test("create permite nueva sesión cuando la anterior fue cerrada", async () => {
      const first = await repo.create(baseInsert(fixtures.leadIds.Y));
      await repo.close(first.id, { resultado: "perdido", motivo_perdida: "precio" });
      const second = await repo.create(baseInsert(fixtures.leadIds.Y));
      expect(second.id).not.toBe(first.id);
    });

    test("findActiveByLeadId devuelve solo la sesión con resultado null", async () => {
      const a = await repo.create(baseInsert(fixtures.leadIds.A));
      await repo.close(a.id, { resultado: "exito" });
      const b = await repo.create(baseInsert(fixtures.leadIds.A));

      const active = await repo.findActiveByLeadId(fixtures.leadIds.A);
      expect(active?.id).toBe(b.id);
    });

    test("findActiveByLeadId devuelve null cuando no hay activa", async () => {
      expect(await repo.findActiveByLeadId(fixtures.leadIds.none)).toBeNull();
    });

    test("update aplica patch + preserva id/lead_id/started_at/resultado", async () => {
      const s = await repo.create(baseInsert(fixtures.leadIds.one));
      const patched = await repo.update(s.id, {
        current_stage: "cotizado",
        precio_cotizado: 150000,
      });
      expect(patched.id).toBe(s.id);
      expect(patched.lead_id).toBe(s.lead_id);
      expect(patched.started_at).toEqual(s.started_at);
      expect(patched.current_stage).toBe("cotizado");
      expect(patched.precio_cotizado).toBe(150000);
      expect(patched.resultado).toBeNull();
    });

    test("update throws cuando id falta", async () => {
      await expect(repo.update("missing", { urgencia: "alta" })).rejects.toThrow();
    });

    test("close setea resultado + closed_at + motivo_perdida", async () => {
      const s = await repo.create(baseInsert(fixtures.leadIds.one));
      const closed = await repo.close(s.id, {
        resultado: "perdido",
        motivo_perdida: "stock",
      });
      expect(closed.resultado).toBe("perdido");
      expect(closed.motivo_perdida).toBe("stock");
      expect(closed.closed_at).toBeInstanceOf(Date);
    });

    test("close de éxito sin motivo_perdida queda null", async () => {
      const s = await repo.create(baseInsert(fixtures.leadIds.one));
      const closed = await repo.close(s.id, { resultado: "exito" });
      expect(closed.resultado).toBe("exito");
      expect(closed.motivo_perdida).toBeNull();
      expect(closed.closed_at).toBeInstanceOf(Date);
    });

    test("close con resultado/motivo distinto sobre sesión cerrada lanza IllegalStateError", async () => {
      const s = await repo.create(baseInsert(fixtures.leadIds.one));
      await repo.close(s.id, { resultado: "exito" });
      await expect(repo.close(s.id, { resultado: "perdido" })).rejects.toMatchObject({
        code: "ILLEGAL_STATE",
        stateType: "session_already_closed_different",
      });
    });

    test("close idempotente: mismo resultado retorna sesión existente sin throw", async () => {
      const s = await repo.create(baseInsert(fixtures.leadIds.one));
      const first = await repo.close(s.id, { resultado: "exito" });
      const second = await repo.close(s.id, { resultado: "exito" });
      expect(second.id).toBe(first.id);
      expect(second.closed_at).toEqual(first.closed_at);
      expect(second.resultado).toBe("exito");
    });

    test("close idempotente: mismo resultado + mismo motivo_perdida retorna existing", async () => {
      const s = await repo.create(baseInsert(fixtures.leadIds.one));
      const first = await repo.close(s.id, {
        resultado: "perdido",
        motivo_perdida: "precio",
      });
      const second = await repo.close(s.id, {
        resultado: "perdido",
        motivo_perdida: "precio",
      });
      expect(second.id).toBe(first.id);
      expect(second.closed_at).toEqual(first.closed_at);
      expect(second.motivo_perdida).toBe("precio");
    });

    test("close con motivo distinto sobre sesión cerrada lanza IllegalStateError", async () => {
      const s = await repo.create(baseInsert(fixtures.leadIds.one));
      await repo.close(s.id, { resultado: "perdido", motivo_perdida: "precio" });
      await expect(
        repo.close(s.id, { resultado: "perdido", motivo_perdida: "stock" }),
      ).rejects.toMatchObject({ code: "ILLEGAL_STATE" });
    });

    test("listActive retorna solo sesiones con resultado IS NULL", async () => {
      const sActive = await repo.create(baseInsert(fixtures.leadIds.one));
      const sClosed = await repo.create(baseInsert(fixtures.leadIds.two));
      await repo.close(sClosed.id, { resultado: "exito" });
      const sActive2 = await repo.create(baseInsert(fixtures.leadIds.three));

      const out = await repo.listActive();
      const ids = out.map((s) => s.id).sort();
      expect(ids).toContain(sActive.id);
      expect(ids).toContain(sActive2.id);
      expect(ids).not.toContain(sClosed.id);
    });

    test("listClosedBefore retorna sesiones cerradas cuyo closed_at < fecha", async () => {
      const s1 = await repo.create(baseInsert(fixtures.leadIds.one));
      const s2 = await repo.create(baseInsert(fixtures.leadIds.two));
      // s3 nunca se cierra → no debe aparecer.
      await repo.create(baseInsert(fixtures.leadIds.three));

      await repo.close(s1.id, { resultado: "exito" });
      await repo.close(s2.id, { resultado: "perdido", motivo_perdida: "precio" });

      const futureCutoff = new Date(Date.now() + 60 * 1000);
      const allClosed = await repo.listClosedBefore(futureCutoff);
      const ids = allClosed.map((s) => s.id).sort();
      expect(ids).toEqual([s1.id, s2.id].sort());

      const pastCutoff = new Date(Date.now() - 60 * 1000);
      const nothing = await repo.listClosedBefore(pastCutoff);
      expect(nothing).toEqual([]);
    });
  });
}
