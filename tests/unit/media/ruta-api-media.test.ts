// @vitest-environment node
import { describe, expect, test, vi } from "vitest";
import { InfraError, NotFoundError } from "@/lib/errors";
import { responderMedia } from "@/app/api/media/_lib/responder";
import type { AccesoMediaService } from "@/server/services/media/acceso-media.service";

const ID = "7d9e8a10-0bd4-4b8a-8b43-5c2e1f0a9b77";
const FIRMADA = "https://x.supabase.co/storage/v1/object/sign/mensajes_media/a.png?token=t";

function deps(over: { usuario?: boolean; urlDe?: AccesoMediaService["urlDe"] } = {}) {
  const urlDe = vi.fn(over.urlDe ?? (async () => FIRMADA));
  return {
    urlDe,
    deps: {
      usuario: async () => (over.usuario === false ? null : { id: "u1" }),
      servicio: async (): Promise<AccesoMediaService> => ({ urlDe }),
    },
  };
}

const req = (qs = "") => new Request(`https://crm.test/api/media/${ID}${qs}`);

describe("GET /api/media/[mensajeId]", () => {
  test("con sesion y archivo: redirige a la URL firmada, solo cacheable en el navegador y por menos de lo que dura la firma", async () => {
    const { deps: d, urlDe } = deps();
    const r = await responderMedia(req(), ID, d);
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe(FIRMADA);
    const cc = r.headers.get("cache-control") ?? "";
    expect(cc).toContain("private");
    expect(cc).not.toContain("public");
    const maxAge = Number(/max-age=(\d+)/.exec(cc)?.[1]);
    expect(maxAge).toBeGreaterThan(0);
    expect(maxAge).toBeLessThan(300);
    expect(urlDe).toHaveBeenCalledWith(ID, { descargar: false });
  });

  test("?descargar=1 pide la descarga", async () => {
    const { deps: d, urlDe } = deps();
    await responderMedia(req("?descargar=1"), ID, d);
    expect(urlDe).toHaveBeenCalledWith(ID, { descargar: true });
  });

  test("sin sesion: 401, sin tocar el service ni redirigir", async () => {
    const { deps: d, urlDe } = deps({ usuario: false });
    const r = await responderMedia(req(), ID, d);
    expect(r.status).toBe(401);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(urlDe).not.toHaveBeenCalled();
  });

  test("un id que no es uuid: 400, sin tocar el service", async () => {
    for (const malo of ["abc", "../../etc/passwd", `${ID}/../x`, ""]) {
      const { deps: d, urlDe } = deps();
      const r = await responderMedia(req(), malo, d);
      expect(r.status, malo).toBe(400);
      expect(urlDe).not.toHaveBeenCalled();
    }
  });

  test("sin archivo (o sin permiso para ver el mensaje): 404 uniforme", async () => {
    const { deps: d } = deps({
      urlDe: async () => {
        throw new NotFoundError("nada", "media", ID);
      },
    });
    const r = await responderMedia(req(), ID, d);
    expect(r.status).toBe(404);
    expect(r.headers.get("cache-control")).toBe("no-store");
  });

  test("un fallo inesperado es 500 sin filtrar el detalle", async () => {
    const { deps: d } = deps({
      urlDe: async () => {
        throw new InfraError("storage: secreto-interno", "storage");
      },
    });
    const r = await responderMedia(req(), ID, d);
    expect(r.status).toBe(500);
    expect(await r.text()).not.toContain("secreto-interno");
  });
});
