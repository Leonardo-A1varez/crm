// @vitest-environment node
import { beforeEach, describe, expect, test } from "vitest";
import { NotFoundError } from "@/lib/errors";
import { InMemoryMediaStorage } from "@/server/repositories/media-storage.repo";
import { InMemoryMessagesRepository } from "@/server/repositories/messages.repo";
import {
  DefaultAccesoMediaService,
  SEGUNDOS_DE_FIRMA,
} from "@/server/services/media/acceso-media.service";
import type { MensajeMedia } from "@/types/entities";

const SESION = "0f5c1a52-3a3f-4ac9-9a4b-1f6ab3a7c2d1";
const CONV = "11111111-2222-4333-8444-555555555555";

let messages: InMemoryMessagesRepository;
let storage: InMemoryMediaStorage;
let svc: DefaultAccesoMediaService;

beforeEach(() => {
  messages = new InMemoryMessagesRepository();
  storage = new InMemoryMediaStorage();
  svc = new DefaultAccesoMediaService({ messages, storage });
});

async function mensaje(
  media: Partial<MensajeMedia> | null,
  tipo: "image" | "doc" | "audio" = "image",
) {
  const objeto = crypto.randomUUID();
  const path = `sesiones/${SESION}/${objeto}.bin`;
  storage.objetos.set(path, { bytes: new Uint8Array([1]), mime: "image/jpeg" });
  return messages.create({
    conversacion_id: CONV,
    lead_session_id: SESION,
    direction: "in",
    sender: "lead",
    sender_user_id: null,
    tipo,
    contenido: null,
    media_url: null,
    ...(media
      ? {
          media: {
            estado: "descargado",
            metaId: "M",
            path,
            mime: "image/jpeg",
            bytes: 1,
            nombre: null,
            error: null,
            descargadoAt: new Date(),
            ...media,
          },
        }
      : {}),
    meta_message_id: `wamid.${objeto}`,
    idempotency_key: null,
    metadata: {},
  });
}

describe("DefaultAccesoMediaService.urlDe", () => {
  test("imagen, audio y video verificados se abren en linea con una URL firmada corta", async () => {
    const m = await mensaje({ mime: "image/jpeg" });
    const url = await svc.urlDe(m.id, { descargar: false });
    expect(url).toContain(`sesiones/${SESION}/`);
    expect(url).toContain(`expira=${SEGUNDOS_DE_FIRMA}`);
    expect(url).not.toContain("download=");
    expect(SEGUNDOS_DE_FIRMA).toBeLessThanOrEqual(600);
  });

  test("un documento siempre sale como descarga, con el nombre saneado", async () => {
    const m = await mensaje({ mime: "application/pdf", nombre: "Lista Corolla.pdf" }, "doc");
    const url = await svc.urlDe(m.id, { descargar: false });
    expect(url).toContain("download=Lista%20Corolla.pdf");
  });

  test("binario sin tipo reconocido: descarga, nunca en linea", async () => {
    const m = await mensaje({ mime: "application/octet-stream", nombre: null });
    const url = await svc.urlDe(m.id, { descargar: false });
    expect(url).toContain("download=");
  });

  test("pedir descarga de una imagen fuerza el attachment", async () => {
    const m = await mensaje({ mime: "image/png", nombre: null });
    const url = await svc.urlDe(m.id, { descargar: true });
    expect(url).toContain("download=");
  });

  test("el nombre de descarga no puede traer rutas ni caracteres de control", async () => {
    const m = await mensaje({ mime: "application/pdf", nombre: "../../etc/passwd" }, "doc");
    const url = await svc.urlDe(m.id, { descargar: false });
    expect(url).toContain("download=passwd");
    expect(url).not.toContain("..");
  });

  test("sin archivo, pendiente, fallido u omitido: no encontrado", async () => {
    const sin = await mensaje(null);
    await expect(svc.urlDe(sin.id, { descargar: false })).rejects.toBeInstanceOf(NotFoundError);
    for (const estado of ["pendiente", "fallido", "omitido"] as const) {
      const m = await mensaje({ estado, path: null, mime: null });
      await expect(svc.urlDe(m.id, { descargar: false })).rejects.toBeInstanceOf(NotFoundError);
    }
  });

  test("mensaje inexistente", async () => {
    await expect(svc.urlDe(crypto.randomUUID(), { descargar: false })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
