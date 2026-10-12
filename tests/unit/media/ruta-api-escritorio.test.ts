// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { InfraError, ValidationError } from "@/lib/errors";
import { responderArchivosEscritorio } from "@/app/api/escritorio/archivos/_lib/responder";
import type { ArchivosEscritorioService } from "@/server/services/media/archivos-escritorio.service";

function deps(over: { usuario?: boolean; listar?: ArchivosEscritorioService["listar"] } = {}) {
  const listar = vi.fn(over.listar ?? (async () => ({ items: [], siguiente: null })));
  return {
    listar,
    deps: {
      usuario: async () => (over.usuario === false ? null : { id: "u1" }),
      servicio: async (): Promise<ArchivosEscritorioService> => ({ listar }),
    },
  };
}
const req = (qs = "") => new Request(`https://crm.test/api/escritorio/archivos${qs}`);

describe("GET /api/escritorio/archivos", () => {
  it("con sesion devuelve la pagina, sin cache", async () => {
    const pagina = {
      items: [
        {
          mensajeId: "m1",
          cliente: "Rita",
          fecha: "2026-10-12T10:00:00.000Z",
          archivo: "a.pdf",
          mime: "application/pdf",
          bytes: 3,
        },
      ],
      siguiente: "abc",
    };
    const { deps: d, listar } = deps({ listar: async () => pagina });
    const r = await responderArchivosEscritorio(req("?despues=XYZ&limite=10"), d);
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(await r.json()).toEqual(pagina);
    expect(listar).toHaveBeenCalledWith({ cursor: "XYZ", limite: 10 });
  });

  it("sin parametros: primera pagina de 20", async () => {
    const { deps: d, listar } = deps();
    await responderArchivosEscritorio(req(), d);
    expect(listar).toHaveBeenCalledWith({ cursor: null, limite: 20 });
  });

  it("sin sesion: 401 y no toca nada", async () => {
    const { deps: d, listar } = deps({ usuario: false });
    const r = await responderArchivosEscritorio(req(), d);
    expect(r.status).toBe(401);
    expect(listar).not.toHaveBeenCalled();
  });

  it("limite invalido o cursor invalido: 400", async () => {
    for (const qs of ["?limite=0", "?limite=999", "?limite=abc", `?despues=${"x".repeat(400)}`]) {
      const { deps: d, listar } = deps();
      expect((await responderArchivosEscritorio(req(qs), d)).status, qs).toBe(400);
      expect(listar).not.toHaveBeenCalled();
    }
    const { deps: d } = deps({
      listar: async () => {
        throw new ValidationError("cursor inválido", "cursor");
      },
    });
    expect((await responderArchivosEscritorio(req("?despues=basura"), d)).status).toBe(400);
  });

  it("fallo inesperado: 500 sin detalle", async () => {
    const { deps: d } = deps({
      listar: async () => {
        throw new InfraError("db: secreto", "db");
      },
    });
    const r = await responderArchivosEscritorio(req(), d);
    expect(r.status).toBe(500);
    expect(await r.text()).not.toContain("secreto");
  });
});
