import { beforeEach, describe, expect, test } from "vitest";
import type { MensajeInsert, MessagesRepository } from "@/server/repositories/messages.repo";
import {
  DEFAULT_FIXTURES,
  type MessagesContractFixtures,
  type MessagesContractFixturesArg,
} from "./messages.contract";

/** Ruta con la forma que exige el CHECK de `mensajes.media_path`. */
function rutaMedia(ext = "jpg"): string {
  return `sesiones/${crypto.randomUUID()}/${crypto.randomUUID()}.${ext}`;
}

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
    tipo: "image",
    contenido: null,
    media_url: null,
    meta_message_id: "wamid.media.base",
    idempotency_key: null,
    metadata: {},
    ...overrides,
  };
}

const pendiente = (metaId = "media-1") => ({
  estado: "pendiente" as const,
  metaId,
  path: null,
  mime: "image/jpeg",
  bytes: null,
  nombre: null,
  error: null,
  descargadoAt: null,
});

/**
 * Contrato de las columnas `media_*` de `mensajes`: lo corren el repo en memoria
 * y el de Supabase, para que no se separen.
 */
export function runMessagesMediaContract(
  makeRepo: () => MessagesRepository,
  fixturesArg: MessagesContractFixturesArg = DEFAULT_FIXTURES,
) {
  describe("MessagesRepository contract: media", () => {
    let repo: MessagesRepository;
    let fixtures: MessagesContractFixtures;

    beforeEach(() => {
      repo = makeRepo();
      fixtures = typeof fixturesArg === "function" ? fixturesArg() : fixturesArg;
    });

    test("un mensaje con archivo vuelve con su media tal como se creo", async () => {
      const m = await repo.create(
        baseInsert(fixtures, { media: pendiente(), meta_message_id: "wamid.m1" }),
      );
      expect((await repo.findById(m.id))?.media).toEqual(pendiente());
    });

    test("un mensaje sin archivo tiene media null", async () => {
      const m = await repo.create(
        baseInsert(fixtures, { tipo: "text", meta_message_id: "wamid.m2" }),
      );
      expect((await repo.findById(m.id))?.media ?? null).toBeNull();
    });

    test("registrarMediaDescargada pasa de pendiente a descargado y es idempotente", async () => {
      const m = await repo.create(
        baseInsert(fixtures, { media: pendiente(), meta_message_id: "wamid.m3" }),
      );
      const path = rutaMedia();
      const at = new Date("2026-10-12T10:00:00.000Z");
      const hecho = await repo.registrarMediaDescargada(
        m.id,
        { path, mime: "image/webp", bytes: 1234 },
        at,
      );
      expect(hecho?.media).toMatchObject({
        estado: "descargado",
        path,
        mime: "image/webp",
        bytes: 1234,
        metaId: "media-1",
        error: null,
      });
      expect(hecho?.media?.descargadoAt?.toISOString()).toBe(at.toISOString());

      // Un reintento no pisa lo ya guardado.
      const repetido = await repo.registrarMediaDescargada(
        m.id,
        { path: rutaMedia("png"), mime: "image/png", bytes: 1 },
        new Date(),
      );
      expect(repetido).toBeNull();
      expect((await repo.findById(m.id))?.media?.path).toBe(path);
    });

    test("marcarMediaSinCopia deja fallido u omitido con el motivo, solo desde pendiente", async () => {
      const m = await repo.create(
        baseInsert(fixtures, { tipo: "video", media: pendiente(), meta_message_id: "wamid.m4" }),
      );
      const out = await repo.marcarMediaSinCopia(m.id, "omitido", "demasiado_grande");
      expect(out?.media).toMatchObject({ estado: "omitido", error: "demasiado_grande" });
      // Ya no esta pendiente: un reintento tardio no lo cambia.
      expect(await repo.marcarMediaSinCopia(m.id, "fallido", "otro")).toBeNull();
      expect((await repo.findById(m.id))?.media?.estado).toBe("omitido");
    });

    test("un id desconocido no revienta", async () => {
      const id = crypto.randomUUID();
      expect(
        await repo.registrarMediaDescargada(
          id,
          { path: rutaMedia(), mime: "image/jpeg", bytes: 1 },
          new Date(),
        ),
      ).toBeNull();
      expect(await repo.marcarMediaSinCopia(id, "fallido", "x")).toBeNull();
    });

    test("listMediaDescargada va en orden de descarga y respeta el cursor (at, id)", async () => {
      const ids: string[] = [];
      for (let i = 0; i < 3; i++) {
        const m = await repo.create(
          baseInsert(fixtures, { media: pendiente(`media-l${i}`), meta_message_id: `wamid.l${i}` }),
        );
        ids.push(m.id);
      }
      // 0 y 1 comparten el instante: el desempate es por id.
      const t0 = new Date("2026-10-12T10:00:00.000Z");
      const t1 = new Date("2026-10-12T10:05:00.000Z");
      const datos = () => ({ path: rutaMedia(), mime: "image/jpeg", bytes: 1 });
      await repo.registrarMediaDescargada(ids[0]!, datos(), t0);
      await repo.registrarMediaDescargada(ids[1]!, datos(), t0);
      await repo.registrarMediaDescargada(ids[2]!, datos(), t1);

      const todos = await repo.listMediaDescargada({ limit: 10 });
      expect(todos).toHaveLength(3);
      expect(todos[2]?.id).toBe(ids[2]);
      expect(todos.slice(0, 2).map((m) => m.id)).toEqual([ids[0]!, ids[1]!].sort());

      const primera = await repo.listMediaDescargada({ limit: 1 });
      expect(primera).toHaveLength(1);
      const resto = await repo.listMediaDescargada({
        limit: 10,
        despuesDe: { at: primera[0]!.media!.descargadoAt!, id: primera[0]!.id },
      });
      expect(resto.map((m) => m.id)).toEqual(todos.slice(1).map((m) => m.id));
    });

    test("listMediaDescargada ignora lo pendiente, fallido u omitido", async () => {
      await repo.create(
        baseInsert(fixtures, { media: pendiente("p"), meta_message_id: "wamid.n1" }),
      );
      expect(await repo.listMediaDescargada({ limit: 10 })).toEqual([]);
    });
  });
}
