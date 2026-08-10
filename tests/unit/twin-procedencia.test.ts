import { beforeEach, describe, expect, test } from "vitest";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { InMemoryConversationsRepository } from "@/server/repositories/conversations.repo";
import { InMemoryLeadSessionRepository } from "@/server/repositories/lead-session.repo";
import { InMemoryLeadsRepository } from "@/server/repositories/leads.repo";
import { InMemoryMessagesRepository } from "@/server/repositories/messages.repo";
import { InMemoryProductsRepository } from "@/server/repositories/productos.repo";
import { InMemoryTagsRepository } from "@/server/repositories/tags.repo";
import { DefaultHandoffService } from "@/server/services/handoff.service";
import { DefaultInboxService } from "@/server/services/inbox/default-inbox.service";
import { DefaultMetaApiService } from "@/server/services/meta-api.service";
import type { LeadSession } from "@/types/entities";

const USER = "11111111-1111-4111-8111-111111111111";

describe("editarCampoTwin", () => {
  let sessions: InMemoryLeadSessionRepository;
  let svc: DefaultInboxService;
  let sesion: LeadSession;

  beforeEach(async () => {
    const leads = new InMemoryLeadsRepository();
    sessions = new InMemoryLeadSessionRepository();
    const convs = new InMemoryConversationsRepository();
    const messages = new InMemoryMessagesRepository();
    svc = new DefaultInboxService({
      leads,
      sessions,
      convs,
      messages,
      metaApi: new DefaultMetaApiService(convs, messages, {
        sendText: async () => {
          throw new Error("no debe enviarse nada acá");
        },
      }),
      handoff: new DefaultHandoffService(sessions),
      productos: new InMemoryProductsRepository(),
      tags: new InMemoryTagsRepository(),
    });

    const lead = await leads.create({
      nombre: "Lead Test",
      telefono: "+595981000111",
      email: null,
      direccion: null,
      vehiculo_marca: "Toyota",
      vehiculo_modelo: "Corolla",
      vehiculo_anio: 2018,
      vehiculo_motor: null,
      empresa_id: null,
      canal_origen: "wa",
      meta_user_ids: {},
    });
    sesion = await sessions.create({
      lead_id: lead.id,
      current_stage: "cotizado",
      urgencia: "media",
      consulta: "lo que dedujo el extractor",
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
    });
  });

  test("una sesión nueva no tiene ningún campo marcado", () => {
    expect(sesion.procedencia).toEqual({});
  });

  test("editar escribe el valor y la marca en la misma operación", async () => {
    const out = await svc.editarCampoTwin({
      sessionId: sesion.id,
      campo: "consulta",
      valor: "lo que dijo el cliente en realidad",
      userId: USER,
    });

    expect(out.consulta).toBe("lo que dijo el cliente en realidad");
    expect(out.procedencia.consulta).toMatchObject({ por: "humano", user_id: USER });
    expect(out.procedencia.consulta?.at).toBeTypeOf("string");
  });

  test("editar un campo no marca los demás", async () => {
    const out = await svc.editarCampoTwin({
      sessionId: sesion.id,
      campo: "cantidad",
      valor: 3,
      userId: USER,
    });

    expect(Object.keys(out.procedencia)).toEqual(["cantidad"]);
  });

  test("borrar el valor deja el campo en null pero la marca queda", async () => {
    await svc.editarCampoTwin({
      sessionId: sesion.id,
      campo: "bloqueador",
      valor: "falta la factura",
      userId: USER,
    });
    const out = await svc.editarCampoTwin({
      sessionId: sesion.id,
      campo: "bloqueador",
      valor: null,
      userId: USER,
    });

    expect(out.bloqueador).toBeNull();
    // Que lo hayan borrado a mano también es información: sin la marca, el
    // extractor no puede saber que alguien decidió que ahí no va nada.
    expect(out.procedencia.bloqueador?.por).toBe("humano");
  });

  test("una sesión cerrada no se puede reescribir", async () => {
    await sessions.close(sesion.id, { resultado: "exito" });

    await expect(
      svc.editarCampoTwin({
        sessionId: sesion.id,
        campo: "consulta",
        valor: "tarde",
        userId: USER,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  test("una sesión inexistente falla con NotFound", async () => {
    await expect(
      svc.editarCampoTwin({
        sessionId: "22222222-2222-4222-8222-222222222222",
        campo: "consulta",
        valor: "x",
        userId: USER,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
