import { describe, expect, test, beforeEach } from "vitest";
import type { MensajeInsert, MessagesRepository } from "@/server/repositories/messages.repo";
import type { UUID } from "@/types/entities";

export interface MessagesContractFixtures {
  conversacionIds: { one: UUID; A: UUID; B: UUID };
  leadSessionId: UUID;
  // Sesión de OTRO lead (constraint 1 activa por lead). Para asserts de
  // aislamiento en listBySessionId.
  leadSessionIdAlt: UUID;
}

const DEFAULT_FIXTURES: MessagesContractFixtures = {
  conversacionIds: { one: "conv-1", A: "conv-A", B: "conv-B" },
  leadSessionId: "session-1",
  leadSessionIdAlt: "session-2",
};

export type MessagesContractFixturesArg =
  | MessagesContractFixtures
  | (() => MessagesContractFixtures);

function baseInsert(
  fixtures: MessagesContractFixtures,
  overrides: Partial<MensajeInsert> = {},
): MensajeInsert {
  return {
    conversacion_id: fixtures.conversacionIds.one,
    lead_session_id: fixtures.leadSessionId,
    direction: "in",
    sender: "lead",
    sender_user_id: null,
    tipo: "text",
    contenido: "Hola, necesito pastillas de freno",
    media_url: null,
    meta_message_id: "wamid.abc.001",
    idempotency_key: null,
    metadata: {},
    ...overrides,
  };
}

export function runMessagesContract(
  makeRepo: () => MessagesRepository,
  fixturesArg: MessagesContractFixturesArg = DEFAULT_FIXTURES,
) {
  describe("MessagesRepository contract", () => {
    let repo: MessagesRepository;
    let fixtures: MessagesContractFixtures;

    beforeEach(() => {
      repo = makeRepo();
      fixtures = typeof fixturesArg === "function" ? fixturesArg() : fixturesArg;
    });

    test("create asigna id + created_at + persiste", async () => {
      const m = await repo.create(baseInsert(fixtures));
      expect(m.id).toBeTypeOf("string");
      expect(m.created_at).toBeInstanceOf(Date);
      expect(m.contenido).toBe("Hola, necesito pastillas de freno");
      expect(await repo.findById(m.id)).toEqual(m);
    });

    test("create permite meta_message_id null (outbound antes de delivery)", async () => {
      const m = await repo.create(baseInsert(fixtures, { meta_message_id: null }));
      expect(m.meta_message_id).toBeNull();
    });

    test("findById devuelve null cuando id falta", async () => {
      expect(await repo.findById("nope")).toBeNull();
    });

    test("findByMetaMessageId localiza por meta id", async () => {
      const m = await repo.create(baseInsert(fixtures, { meta_message_id: "wamid.xyz" }));
      const found = await repo.findByMetaMessageId("wamid.xyz");
      expect(found?.id).toBe(m.id);
      expect(await repo.findByMetaMessageId("missing")).toBeNull();
    });

    test("findByMetaMessageId nunca matchea mensajes con meta_message_id null", async () => {
      await repo.create(baseInsert(fixtures, { meta_message_id: null }));
      // Caller debe pasar string concreto; vacío no debe matchear null tampoco.
      expect(await repo.findByMetaMessageId("")).toBeNull();
    });

    test("listByConversacion devuelve mensajes de la conv en orden DESC", async () => {
      const m1 = await repo.create(baseInsert(fixtures, { meta_message_id: "id_1" }));
      await new Promise((r) => setTimeout(r, 5));
      const m2 = await repo.create(baseInsert(fixtures, { meta_message_id: "id_2" }));
      await new Promise((r) => setTimeout(r, 5));
      const m3 = await repo.create(baseInsert(fixtures, { meta_message_id: "id_3" }));

      const list = await repo.listByConversacion(fixtures.conversacionIds.one);
      expect(list.map((m) => m.id)).toEqual([m3.id, m2.id, m1.id]);
    });

    test("listByConversacion filtra por conversacion_id", async () => {
      await repo.create(
        baseInsert(fixtures, {
          conversacion_id: fixtures.conversacionIds.A,
          meta_message_id: "id_A",
        }),
      );
      await repo.create(
        baseInsert(fixtures, {
          conversacion_id: fixtures.conversacionIds.B,
          meta_message_id: "id_B",
        }),
      );

      const a = await repo.listByConversacion(fixtures.conversacionIds.A);
      expect(a).toHaveLength(1);
      expect(a[0]?.conversacion_id).toBe(fixtures.conversacionIds.A);
    });

    test("listByConversacion respeta limit", async () => {
      for (let i = 0; i < 10; i++) {
        await repo.create(baseInsert(fixtures, { meta_message_id: `id_${i}` }));
        await new Promise((r) => setTimeout(r, 1));
      }
      const list = await repo.listByConversacion(fixtures.conversacionIds.one, { limit: 3 });
      expect(list).toHaveLength(3);
    });

    test("listByConversacion con `before` filtra created_at < before", async () => {
      const a = await repo.create(baseInsert(fixtures, { meta_message_id: "id_A" }));
      await new Promise((r) => setTimeout(r, 10));
      const b = await repo.create(baseInsert(fixtures, { meta_message_id: "id_B" }));

      const before = new Date(b.created_at.getTime());
      const list = await repo.listByConversacion(fixtures.conversacionIds.one, { before });
      expect(list.map((m) => m.id)).toEqual([a.id]);
    });

    test("listByConversacion default limit aplica cuando no se especifica", async () => {
      for (let i = 0; i < 60; i++) {
        await repo.create(baseInsert(fixtures, { meta_message_id: `id_${i}` }));
      }
      const list = await repo.listByConversacion(fixtures.conversacionIds.one);
      expect(list.length).toBeLessThanOrEqual(50);
    });

    test("metadata no comparte ref con storage (defense vs caller mutation)", async () => {
      const m = await repo.create(
        baseInsert(fixtures, { metadata: { reply_to: "wamid.original" } }),
      );
      // Mutar metadata retornada no debe afectar storage.
      (m.metadata as { reply_to: string }).reply_to = "MUTADO";

      const refetch = await repo.findById(m.id);
      expect((refetch?.metadata as { reply_to: string }).reply_to).toBe("wamid.original");
    });

    test("input metadata no compartido con storage (defense vs input mutation post-create)", async () => {
      const meta = { reply_to: "wamid.seed" };
      const m = await repo.create(baseInsert(fixtures, { metadata: meta }));
      // Mutar input post-create no debe afectar storage.
      meta.reply_to = "MUTADO_INPUT";

      const refetch = await repo.findById(m.id);
      expect((refetch?.metadata as { reply_to: string }).reply_to).toBe("wamid.seed");
    });

    // Migration 0012 — UNIQUE partial mensajes(meta_message_id) WHERE NOT NULL.
    // Atomic dedup inbound. Segundo insert mismo meta_message_id debe lanzar
    // ConflictError. Garantiza parity entre InMemoryMessagesRepository y la
    // implementación Supabase (PostgrestError 23505 → ConflictError vía mapPostgrestError).
    test("create rechaza meta_message_id duplicado (UNIQUE 0012)", async () => {
      await repo.create(baseInsert(fixtures, { meta_message_id: "wamid.dup" }));
      await expect(
        repo.create(baseInsert(fixtures, { meta_message_id: "wamid.dup" })),
      ).rejects.toMatchObject({
        code: "CONFLICT",
        conflictType: "duplicate_meta_message_id",
      });
    });

    test("create permite múltiples filas con meta_message_id null (partial WHERE NOT NULL)", async () => {
      // Partial index ignora NULL → varios outbounds pendientes pueden coexistir.
      const a = await repo.create(baseInsert(fixtures, { meta_message_id: null }));
      const b = await repo.create(baseInsert(fixtures, { meta_message_id: null }));
      expect(a.id).not.toBe(b.id);
    });

    // listBySessionId — thread cronológico de la sesión (Slice 2 8.2).
    // ASC (viejo→nuevo) porque el ChatThread renderiza directo sin reverse.
    test("listBySessionId devuelve mensajes de la sesión ASC cruzando conversaciones", async () => {
      const m1 = await repo.create(
        baseInsert(fixtures, {
          conversacion_id: fixtures.conversacionIds.A,
          meta_message_id: "sess_1",
        }),
      );
      await new Promise((r) => setTimeout(r, 5));
      const m2 = await repo.create(
        baseInsert(fixtures, {
          conversacion_id: fixtures.conversacionIds.B,
          meta_message_id: "sess_2",
        }),
      );
      await new Promise((r) => setTimeout(r, 5));
      const m3 = await repo.create(
        baseInsert(fixtures, {
          conversacion_id: fixtures.conversacionIds.A,
          meta_message_id: "sess_3",
        }),
      );

      const list = await repo.listBySessionId(fixtures.leadSessionId);
      expect(list.map((m) => m.id)).toEqual([m1.id, m2.id, m3.id]);
    });

    test("listBySessionId filtra por lead_session_id", async () => {
      await repo.create(baseInsert(fixtures, { meta_message_id: "own_1" }));
      await repo.create(
        baseInsert(fixtures, {
          lead_session_id: fixtures.leadSessionIdAlt,
          meta_message_id: "alien_1",
        }),
      );

      const list = await repo.listBySessionId(fixtures.leadSessionId);
      expect(list).toHaveLength(1);
      expect(list[0]?.lead_session_id).toBe(fixtures.leadSessionId);
    });

    test("listBySessionId con limit conserva los N más recientes en orden ASC", async () => {
      const ids: string[] = [];
      for (let i = 0; i < 4; i++) {
        const m = await repo.create(baseInsert(fixtures, { meta_message_id: `recent_${i}` }));
        ids.push(m.id);
        await new Promise((r) => setTimeout(r, 5));
      }

      const list = await repo.listBySessionId(fixtures.leadSessionId, { limit: 2 });
      // Últimos 2 creados, en ASC.
      expect(list.map((m) => m.id)).toEqual([ids[2], ids[3]]);
    });

    test("listBySessionIds trae los hilos de varias sesiones en una sola lectura", async () => {
      const a = await repo.create(baseInsert(fixtures, { meta_message_id: "tanda_a" }));
      await new Promise((r) => setTimeout(r, 5));
      const b = await repo.create(
        baseInsert(fixtures, {
          meta_message_id: "tanda_b",
          lead_session_id: fixtures.leadSessionIdAlt,
        }),
      );

      const juntos = await repo.listBySessionIds([
        fixtures.leadSessionId,
        fixtures.leadSessionIdAlt,
      ]);
      // ASC global: quien llama agrupa por sesión y necesita cada hilo en orden.
      expect(juntos.map((m) => m.id)).toEqual([a.id, b.id]);

      const soloUna = await repo.listBySessionIds([fixtures.leadSessionIdAlt]);
      expect(soloUna.map((m) => m.id)).toEqual([b.id]);
    });

    test("listBySessionIds sin ids no consulta y devuelve vacío", async () => {
      await repo.create(baseInsert(fixtures));
      expect(await repo.listBySessionIds([])).toEqual([]);
    });

    test("listRecentBySessionIds acota cada hilo y conserva orden ASC", async () => {
      const contenidos: string[] = [];
      for (let i = 0; i < 3; i += 1) {
        const contenido = `recent batch ${i}`;
        await repo.create(
          baseInsert(fixtures, { meta_message_id: `recent_batch_${i}`, contenido }),
        );
        contenidos.push(contenido);
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      const rows = await repo.listRecentBySessionIds([fixtures.leadSessionId], 2);
      expect(rows.map((row) => row.contenido)).toEqual([contenidos[1], contenidos[2]]);
      expect(await repo.listRecentBySessionIds([], 2)).toEqual([]);
    });

    test("buscarContenido encuentra por subcadena, ignora mayúsculas y trae la sesión", async () => {
      const m = await repo.create(
        baseInsert(fixtures, { meta_message_id: "buscar_1", contenido: "Pastillas de FRENO" }),
      );
      await repo.create(
        baseInsert(fixtures, { meta_message_id: "buscar_2", contenido: "Filtro de aceite" }),
      );

      const hits = await repo.buscarContenido("freno", { limit: 10 });
      expect(hits).toHaveLength(1);
      expect(hits[0]).toMatchObject({
        mensajeId: m.id,
        leadSessionId: fixtures.leadSessionId,
        contenido: "Pastillas de FRENO",
        direction: "in",
      });
      expect(hits[0]?.createdAt).toBeInstanceOf(Date);
    });

    test("buscarContenido escapa los comodines de LIKE", async () => {
      await repo.create(
        baseInsert(fixtures, { meta_message_id: "like_1", contenido: "codigo FRE_1234" }),
      );
      // Sin escapar, `_` matchearía cualquier caracter y esto daría 1.
      expect(await repo.buscarContenido("FREX1234", { limit: 10 })).toEqual([]);
      expect(await repo.buscarContenido("FRE_1234", { limit: 10 })).toHaveLength(1);
    });

    test("buscarContenido ordena del más reciente al más viejo y respeta el tope", async () => {
      await repo.create(baseInsert(fixtures, { meta_message_id: "ord_1", contenido: "freno uno" }));
      await new Promise((r) => setTimeout(r, 5));
      const dos = await repo.create(
        baseInsert(fixtures, { meta_message_id: "ord_2", contenido: "freno dos" }),
      );

      const hits = await repo.buscarContenido("freno", { limit: 1 });
      expect(hits.map((h) => h.mensajeId)).toEqual([dos.id]);
    });

    test("buscarContenido con texto vacío no consulta y devuelve vacío", async () => {
      await repo.create(baseInsert(fixtures));
      expect(await repo.buscarContenido("", { limit: 10 })).toEqual([]);
    });

    test("buscarContenido ignora los mensajes sin texto", async () => {
      await repo.create(
        baseInsert(fixtures, {
          meta_message_id: "media_1",
          tipo: "image",
          contenido: null,
          media_url: "https://ejemplo/x.jpg",
        }),
      );
      expect(await repo.buscarContenido("jpg", { limit: 10 })).toEqual([]);
    });
  });
}
