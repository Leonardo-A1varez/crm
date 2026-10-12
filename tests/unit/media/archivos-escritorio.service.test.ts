// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { ValidationError } from "@/lib/errors";
import { decodificarCursor, codificarCursor } from "@/lib/media/cursor";
import { InMemoryConversationsRepository } from "@/server/repositories/conversations.repo";
import { InMemoryLeadsRepository } from "@/server/repositories/leads.repo";
import { InMemoryMessagesRepository } from "@/server/repositories/messages.repo";
import { DefaultArchivosEscritorioService } from "@/server/services/media/archivos-escritorio.service";
import type { Lead } from "@/types/entities";

const SESION = "0f5c1a52-3a3f-4ac9-9a4b-1f6ab3a7c2d1";

let messages: InMemoryMessagesRepository;
let convs: InMemoryConversationsRepository;
let leads: InMemoryLeadsRepository;
let svc: DefaultArchivosEscritorioService;
let lead: Lead;
let convId: string;
let reloj = 0;

async function archivo(
  over: { mime?: string; nombre?: string | null; tipo?: "image" | "doc" | "audio" } = {},
) {
  const m = await messages.create({
    conversacion_id: convId,
    lead_session_id: SESION,
    direction: "in",
    sender: "lead",
    sender_user_id: null,
    tipo: over.tipo ?? "image",
    contenido: null,
    media_url: null,
    media: {
      estado: "pendiente",
      metaId: "M",
      path: null,
      mime: over.mime ?? "image/jpeg",
      bytes: null,
      nombre: over.nombre ?? null,
      error: null,
      descargadoAt: null,
    },
    meta_message_id: `wamid.${crypto.randomUUID()}`,
    idempotency_key: null,
    metadata: {},
  });
  await messages.registrarMediaDescargada(
    m.id,
    {
      path: `sesiones/${SESION}/${m.id}.bin`,
      mime: over.mime ?? "image/jpeg",
      bytes: 2048,
    },
    new Date(Date.UTC(2026, 9, 12, 10, 0, reloj++)),
  );
  return m;
}

beforeEach(async () => {
  reloj = 0;
  messages = new InMemoryMessagesRepository();
  convs = new InMemoryConversationsRepository();
  leads = new InMemoryLeadsRepository();
  lead = await leads.create({
    nombre: "Rita Agenda",
    telefono: "5491122334455",
    email: null,
    direccion: null,
    vehiculo_marca: null,
    vehiculo_modelo: null,
    vehiculo_anio: null,
    vehiculo_motor: null,
    empresa_id: null,
    canal_origen: "wa",
    meta_user_ids: {},
  });
  convId = (await convs.create({ lead_id: lead.id, canal: "wa", canal_thread_id: "5491122334455" }))
    .id;
  svc = new DefaultArchivosEscritorioService({ messages, convs, leads });
});

describe("cursor", () => {
  it("ida y vuelta, y lo que no es un cursor se rechaza", () => {
    const c = codificarCursor({ at: new Date("2026-10-12T10:00:00.000Z"), id: SESION });
    expect(decodificarCursor(c)).toEqual({ at: new Date("2026-10-12T10:00:00.000Z"), id: SESION });
    for (const malo of [
      "",
      "###",
      "bm9fZXNfdW5fY3Vyc29y",
      Buffer.from(JSON.stringify({ at: "x", id: "no-uuid" })).toString("base64url"),
    ]) {
      expect(() => decodificarCursor(malo), malo).toThrow(ValidationError);
    }
  });
});

describe("DefaultArchivosEscritorioService.listar", () => {
  it("devuelve lo descargado, del mas viejo al mas nuevo, con cliente, fecha y nombre sugerido", async () => {
    const a = await archivo();
    const b = await archivo({ tipo: "doc", mime: "application/pdf", nombre: "Lista Corolla.pdf" });
    const r = await svc.listar({ cursor: null, limite: 10 });
    expect(r.items.map((i) => i.mensajeId)).toEqual([a.id, b.id]);
    expect(r.items[0]).toMatchObject({
      cliente: "Rita Agenda",
      mime: "image/jpeg",
      bytes: 2048,
      archivo: expect.stringMatching(/^imagen-[0-9a-f]{8}\.jpg$/),
    });
    expect(r.items[1]).toMatchObject({ archivo: "Lista Corolla.pdf" });
    expect(new Date(r.items[0]!.fecha).toISOString()).toBe(r.items[0]!.fecha);
  });

  it("sin nombre cargado el cliente es su telefono", async () => {
    await leads.update(lead.id, { nombre: "" });
    await archivo();
    expect((await svc.listar({ cursor: null, limite: 10 })).items[0]?.cliente).toBe(
      "5491122334455",
    );
  });

  it("pagina con cursor: sin repetir ni saltear, y avisa cuando no hay mas", async () => {
    const ids = [(await archivo()).id, (await archivo()).id, (await archivo()).id];
    const p1 = await svc.listar({ cursor: null, limite: 2 });
    expect(p1.items.map((i) => i.mensajeId)).toEqual(ids.slice(0, 2));
    expect(p1.siguiente).not.toBeNull();
    const p2 = await svc.listar({ cursor: p1.siguiente, limite: 2 });
    expect(p2.items.map((i) => i.mensajeId)).toEqual(ids.slice(2));
    const p3 = await svc.listar({ cursor: p2.siguiente, limite: 2 });
    expect(p3.items).toEqual([]);
  });

  it("no incluye lo pendiente, fallido u omitido", async () => {
    await messages.create({
      conversacion_id: convId,
      lead_session_id: SESION,
      direction: "in",
      sender: "lead",
      sender_user_id: null,
      tipo: "image",
      contenido: null,
      media_url: null,
      media: {
        estado: "pendiente",
        metaId: "M",
        path: null,
        mime: "image/jpeg",
        bytes: null,
        nombre: null,
        error: null,
        descargadoAt: null,
      },
      meta_message_id: "wamid.pend",
      idempotency_key: null,
      metadata: {},
    });
    expect((await svc.listar({ cursor: null, limite: 10 })).items).toEqual([]);
  });

  it("un binario sin tipo reconocido baja como .bin con nombre neutro", async () => {
    await archivo({ mime: "application/octet-stream" });
    expect((await svc.listar({ cursor: null, limite: 10 })).items[0]?.archivo).toMatch(
      /^archivo-[0-9a-f]{8}\.bin$/,
    );
  });

  it("limite fuera de rango se acota", async () => {
    await archivo();
    expect((await svc.listar({ cursor: null, limite: 9999 })).items).toHaveLength(1);
  });
});
