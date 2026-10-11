import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { InfraError } from "@/lib/errors";
import { cifrarToken, llaveroDesdeEnv } from "@/lib/meta/token-cifrado";
import type { MensajeCoexistencia } from "@/lib/meta/parse-coexistencia";
import { InMemoryConversationsRepository } from "@/server/repositories/conversations.repo";
import { InMemoryHandoffEventsRepository } from "@/server/repositories/handoff-events.repo";
import { InMemoryLeadIdentificadoresRepository } from "@/server/repositories/lead-identificadores.repo";
import { InMemoryLeadSessionRepository } from "@/server/repositories/lead-session.repo";
import { InMemoryLeadsRepository } from "@/server/repositories/leads.repo";
import { InMemoryMessagesRepository } from "@/server/repositories/messages.repo";
import { InMemoryWhatsAppNumerosRepository } from "@/server/repositories/whatsapp-numeros.repo";
import { DefaultHandoffService } from "@/server/services/handoff.service";
import { DefaultCoexistenciaService } from "@/server/services/meta/coexistencia.service";
import type { DescargaMediaPorEncolar } from "@/server/services/meta/coexistencia.service";
import { DefaultResolverCredencialesWhatsApp } from "@/server/services/meta/credenciales-whatsapp.service";

const PHONE = "106540352242922";
const CLIENTE = "16505551234";

let numeros: InMemoryWhatsAppNumerosRepository;
let messages: InMemoryMessagesRepository;
let encolar: ReturnType<typeof vi.fn<(d: DescargaMediaPorEncolar) => Promise<void>>>;
let svc: DefaultCoexistenciaService;

beforeEach(async () => {
  numeros = new InMemoryWhatsAppNumerosRepository();
  messages = new InMemoryMessagesRepository();
  const sessions = new InMemoryLeadSessionRepository();
  const handoffEvents = new InMemoryHandoffEventsRepository(sessions);
  const llavero = llaveroDesdeEnv({ META_TOKENS_CLAVE: randomBytes(32).toString("base64") });
  await numeros.conectar({
    waba_id: "102290129340398",
    phone_number_id: PHONE,
    display_phone_number: "+1 555-078-3881",
    verified_name: "Lucky Shrub",
    modo: "coexistencia",
    token_cifrado: cifrarToken("TOKEN", PHONE, llavero),
  });
  encolar = vi.fn(async () => {});
  svc = new DefaultCoexistenciaService({
    numeros,
    graph: { leerNumero: vi.fn(), pedirSincronizacion: vi.fn() },
    credenciales: new DefaultResolverCredencialesWhatsApp({
      repo: numeros,
      llavero: () => llavero,
      ttlMs: 0,
    }),
    leads: new InMemoryLeadsRepository(),
    identificadores: new InMemoryLeadIdentificadoresRepository(),
    conversations: new InMemoryConversationsRepository(),
    sessions,
    messages,
    handoff: new DefaultHandoffService(sessions, undefined, handoffEvents),
    handoffEvents,
    encolarDescargaMedia: encolar,
    ahora: () => new Date("2026-10-12T15:00:00.000Z"),
  });
});

function conImagen(id: string, over: Partial<MensajeCoexistencia> = {}): MensajeCoexistencia {
  return {
    meta_message_id: id,
    direction: "out",
    tipo: "image",
    contenido: "Black Prince echeveria",
    media: { id: `media-${id}`, mime: "image/jpeg", nombre: null },
    at: new Date("2026-10-12T14:00:00.000Z"),
    ...over,
  };
}

describe("coexistencia: media de ecos e historial", () => {
  test("un eco con imagen queda pendiente en el hilo y encola su descarga", async () => {
    await svc.registrarEco({
      phone_number_id: PHONE,
      telefono_cliente: CLIENTE,
      mensaje: conImagen("wamid.ECO1"),
    });
    const m = await messages.findByMetaMessageId("wamid.ECO1");
    expect(m).toMatchObject({
      tipo: "image",
      direction: "out",
      media: { estado: "pendiente", metaId: "media-wamid.ECO1", mime: "image/jpeg" },
    });
    expect(encolar).toHaveBeenCalledExactlyOnceWith({
      mensajeId: m!.id,
      phoneNumberId: PHONE,
      fecha: "2026-10-12",
    });
  });

  test("el historial con media tambien encola, por mensaje", async () => {
    await svc.importarHistorial({
      phone_number_id: PHONE,
      fase: null,
      chunk: null,
      progreso: null,
      omitidos: 0,
      hilos: [
        {
          telefono_cliente: CLIENTE,
          mensajes: [
            conImagen("wamid.H1", { direction: "in" }),
            {
              meta_message_id: "wamid.H2",
              direction: "in",
              tipo: "text",
              contenido: "hola",
              at: new Date(),
            },
          ],
        },
      ],
    });
    expect(encolar).toHaveBeenCalledTimes(1);
    expect(encolar.mock.calls[0]![0]).toMatchObject({ phoneNumberId: PHONE });
  });

  test("un mensaje de texto no encola nada", async () => {
    await svc.registrarEco({
      phone_number_id: PHONE,
      telefono_cliente: CLIENTE,
      mensaje: {
        meta_message_id: "wamid.T",
        direction: "out",
        tipo: "text",
        contenido: "hola",
        at: new Date(),
      },
    });
    expect(encolar).not.toHaveBeenCalled();
  });

  test("reentrega del eco con la descarga aun pendiente: vuelve a encolar (el envio anterior pudo perderse)", async () => {
    const eco = {
      phone_number_id: PHONE,
      telefono_cliente: CLIENTE,
      mensaje: conImagen("wamid.R"),
    };
    encolar.mockRejectedValueOnce(new InfraError("inngest caido", "inngest"));
    await expect(svc.registrarEco(eco)).rejects.toBeInstanceOf(InfraError);
    // El mensaje ya quedó escrito; el reintento no lo duplica pero sí encola.
    expect(await svc.registrarEco(eco)).toBe("repetido");
    expect(encolar).toHaveBeenCalledTimes(2);
  });

  test("reentrega con el archivo ya descargado: no vuelve a encolar", async () => {
    const eco = {
      phone_number_id: PHONE,
      telefono_cliente: CLIENTE,
      mensaje: conImagen("wamid.D"),
    };
    await svc.registrarEco(eco);
    const m = await messages.findByMetaMessageId("wamid.D");
    await messages.registrarMediaDescargada(
      m!.id,
      { path: `sesiones/${m!.lead_session_id}/${m!.id}.jpg`, mime: "image/jpeg", bytes: 1 },
      new Date(),
    );
    encolar.mockClear();
    await svc.registrarEco(eco);
    expect(encolar).not.toHaveBeenCalled();
  });

  test("el nombre del documento se sanea antes de guardarse", async () => {
    await svc.registrarEco({
      phone_number_id: PHONE,
      telefono_cliente: CLIENTE,
      mensaje: {
        meta_message_id: "wamid.DOC",
        direction: "out",
        tipo: "doc",
        contenido: null,
        media: { id: "d1", mime: "application/pdf", nombre: "..\\..\\lista.pdf" },
        at: new Date(),
      },
    });
    expect((await messages.findByMetaMessageId("wamid.DOC"))?.media?.nombre).toBe("lista.pdf");
  });
});
