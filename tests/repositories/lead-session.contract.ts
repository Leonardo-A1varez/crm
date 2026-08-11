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

    test("moverEtapa escribe la etapa y la marca de humano en una sola operación", async () => {
      const s = await repo.create(baseInsert(fixtures.leadIds.one));
      const movida = await repo.moverEtapa(s.id, "negociando", null);

      expect(movida.current_stage).toBe("negociando");
      expect(movida.procedencia.current_stage).toMatchObject({
        por: "humano",
        user_id: null,
        valor_anterior: "nuevo",
      });
    });

    test("moverEtapa hacia adelante arrastra etapa_alcanzada", async () => {
      const s = await repo.create(baseInsert(fixtures.leadIds.one));
      const movida = await repo.moverEtapa(s.id, "esperando_pago", null);

      expect(movida.etapa_alcanzada).toBe("esperando_pago");
    });

    test("moverEtapa hacia atrás NO baja etapa_alcanzada", async () => {
      // El máximo alcanzado es el único registro de hasta dónde llegó la
      // conversación: bajarlo perdería el dato que la columna existe para guardar.
      const s = await repo.create(baseInsert(fixtures.leadIds.one));
      await repo.moverEtapa(s.id, "cotizado", null);
      const atras = await repo.moverEtapa(s.id, "identificando", null);

      expect(atras.current_stage).toBe("identificando");
      expect(atras.etapa_alcanzada).toBe("cotizado");
    });

    test("moverEtapa no borra la procedencia de los otros campos", async () => {
      const s = await repo.create(baseInsert(fixtures.leadIds.one));
      await repo.editarCampoTwin(s.id, "bloqueador", "falta la factura", null);
      const movida = await repo.moverEtapa(s.id, "negociando", null);

      expect(movida.procedencia.bloqueador?.por).toBe("humano");
      expect(movida.procedencia.current_stage?.por).toBe("humano");
    });

    test("moverEtapa throws cuando id falta", async () => {
      await expect(repo.moverEtapa("missing", "cotizado", null)).rejects.toThrow();
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

    test("delete borra la sesión (findById null post-delete)", async () => {
      const s = await repo.create(baseInsert(fixtures.leadIds.one));
      await repo.close(s.id, { resultado: "perdido", motivo_perdida: "no_responde" });

      await repo.delete(s.id);

      expect(await repo.findById(s.id)).toBeNull();
    });

    test("delete de id inexistente es no-op (replay-safe, sin throw)", async () => {
      await expect(repo.delete(crypto.randomUUID())).resolves.toBeUndefined();
    });

    test("listByLeadId devuelve todas las sesiones del lead started_at desc", async () => {
      const leadA = fixtures.leadIds.A;
      const leadB = fixtures.leadIds.X;
      const s1 = await repo.create(baseInsert(leadA));
      await repo.close(s1.id, { resultado: "perdido", motivo_perdida: "otro" });
      await new Promise((r) => setTimeout(r, 5));
      const s2 = await repo.create(baseInsert(leadA));
      await repo.create(baseInsert(leadB)); // otro lead, no aparece

      const r = await repo.listByLeadId(leadA);
      expect(r.map((s) => s.id)).toEqual([s2.id, s1.id]);
    });

    test("listByLeadId lead sin sesiones → []", async () => {
      const leadA = fixtures.leadIds.A;
      expect(await repo.listByLeadId(leadA)).toEqual([]);
    });

    test("reassignLead mueve todas las sesiones y devuelve count", async () => {
      const leadA = fixtures.leadIds.A;
      const leadB = fixtures.leadIds.X;
      const s1 = await repo.create(baseInsert(leadA));
      await repo.close(s1.id, { resultado: "exito" });
      const s2 = await repo.create(baseInsert(leadA)); // activa

      const moved = await repo.reassignLead(leadA, leadB);
      expect(moved).toBe(2);
      expect(await repo.listByLeadId(leadA)).toEqual([]);
      const enB = await repo.listByLeadId(leadB);
      expect(enB.map((s) => s.id).sort()).toEqual([s1.id, s2.id].sort());
      // la activa sigue activa bajo el nuevo lead
      expect((await repo.findActiveByLeadId(leadB))?.id).toBe(s2.id);
    });

    test("reassignLead sin sesiones → 0 (replay-safe)", async () => {
      const leadA = fixtures.leadIds.A;
      const leadB = fixtures.leadIds.X;
      expect(await repo.reassignLead(leadA, leadB)).toBe(0);
    });

    test("listCierres devuelve solo las cerradas, de la más reciente a la más vieja", async () => {
      const leadA = fixtures.leadIds.A;
      const leadB = fixtures.leadIds.X;
      const vieja = await repo.create(baseInsert(leadA));
      await repo.close(vieja.id, { resultado: "perdido", motivo_perdida: "precio" });
      await new Promise((r) => setTimeout(r, 5)); // sin esto empatan closed_at
      const nueva = await repo.create(baseInsert(leadB));
      await repo.close(nueva.id, { resultado: "exito" });
      await repo.create(baseInsert(fixtures.leadIds.Y)); // abierta: no es un cierre

      const cierres = await repo.listCierres();
      expect(cierres.map((c) => c.lead_id)).toEqual([leadB, leadA]);
      expect(cierres[0]).toMatchObject({ resultado: "exito", motivo_perdida: null });
      expect(cierres[1]).toMatchObject({ resultado: "perdido", motivo_perdida: "precio" });
    });

    test("listLeadIdsByCodigo busca por substring y no repite el lead", async () => {
      const leadA = fixtures.leadIds.A;
      const leadB = fixtures.leadIds.X;
      const s1 = await repo.create(baseInsert(leadA));
      await repo.update(s1.id, { codigo_interno: "FRE-1234" });
      await repo.close(s1.id, { resultado: "exito" });
      const s2 = await repo.create(baseInsert(leadA));
      await repo.update(s2.id, { codigo_interno: "FRE-1234-B" });
      const s3 = await repo.create(baseInsert(leadB));
      await repo.update(s3.id, { codigo_interno: "AMO-9999" });

      expect(await repo.listLeadIdsByCodigo("fre-1234")).toEqual([leadA]);
      expect(await repo.listLeadIdsByCodigo("9999")).toEqual([leadB]);
      expect(await repo.listLeadIdsByCodigo("")).toEqual([]);
      expect(await repo.listLeadIdsByCodigo("no-existe")).toEqual([]);
    });

    test("resolver perdido cierra, desvía la etapa y congela lo alcanzado", async () => {
      const leadA = fixtures.leadIds.A;
      const s = await repo.create(baseInsert(leadA));
      await repo.update(s.id, { current_stage: "negociando" });

      const perdida = await repo.resolver(s.id, { resultado: "perdido", motivo: "precio" }, null);
      expect(perdida.resultado).toBe("perdido");
      expect(perdida.motivo_perdida).toBe("precio");
      expect(perdida.current_stage).toBe("perdido");
      // El desvío no avanza el embudo: el máximo alcanzado sigue siendo el real.
      expect(perdida.etapa_alcanzada).toBe("negociando");
      expect(perdida.closed_at).not.toBeNull();
      expect(perdida.procedencia.current_stage?.por).toBe("humano");
      expect(perdida.procedencia.current_stage?.valor_anterior).toBe("negociando");

      // Replay con el mismo motivo: mismo resultado, sin error.
      expect((await repo.resolver(s.id, { resultado: "perdido", motivo: "precio" }, null)).id).toBe(
        s.id,
      );
      // Con otro motivo la sesión ya cerrada no se puede reescribir.
      await expect(
        repo.resolver(s.id, { resultado: "perdido", motivo: "stock" }, null),
      ).rejects.toThrow();
      // Y tampoco con el otro resultado.
      await expect(repo.resolver(s.id, { resultado: "exito" }, null)).rejects.toThrow();
    });

    test("resolver exito cierra en cerrado y arrastra lo alcanzado hasta el paso 6", async () => {
      const leadA = fixtures.leadIds.A;
      const s = await repo.create(baseInsert(leadA));
      await repo.update(s.id, { current_stage: "cotizado" });

      const ganada = await repo.resolver(s.id, { resultado: "exito" }, null);
      expect(ganada.resultado).toBe("exito");
      // Ganar no deja motivo: esa columna es del cierre perdido y nada más.
      expect(ganada.motivo_perdida).toBeNull();
      expect(ganada.current_stage).toBe("cerrado");
      // `cerrado` sí es el paso 6 del embudo: el máximo avanza hasta ahí.
      expect(ganada.etapa_alcanzada).toBe("cerrado");
      expect(ganada.closed_at).not.toBeNull();
      expect(ganada.procedencia.current_stage?.por).toBe("humano");

      expect((await repo.resolver(s.id, { resultado: "exito" }, null)).id).toBe(s.id);
    });
  });
}
