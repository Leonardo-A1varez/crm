import { describe, expect, it, vi } from "vitest";
import type {
  CursorBodega,
  FilaExistencia,
  PaginaBodega,
  TablaBodega,
} from "@/lib/catalogo/bodega-contrato";
import { InfraError, PermissionDeniedError } from "@/lib/errors";
import {
  InMemoryBodegaCatalogoRepository,
  type BodegaCatalogoRepository,
} from "@/server/repositories/bodega-catalogo.repo";
import {
  BodegaTimeoutError,
  type BodegaCatalogoClient,
  type PedidoBodega,
} from "@/server/services/catalog/bodega/bodega-client";
import { DefaultSincronizarBodegaService } from "@/server/services/catalog/bodega/sincronizar-bodega.service";

const fila = (no_item: string): FilaExistencia => ({
  no_item,
  grupo_numero: 100,
  origen: "excel",
  actualizado_en: "2026-10-07T10:00:00.000001+00:00",
});

const pagina = (
  filas: FilaExistencia[],
  cursor: CursorBodega,
  siguiente: CursorBodega | null,
): PaginaBodega<"existencias"> => ({ tabla: "existencias", filas, cursor, siguiente });

const INICIO: CursorBodega = { desde: "-infinity", despues: null };

function clienteDe(
  respuestas: (p: PedidoBodega) => Promise<PaginaBodega<"existencias">>,
): BodegaCatalogoClient & { llamadas: PedidoBodega[] } {
  const llamadas: PedidoBodega[] = [];
  return {
    llamadas,
    cambios: (async (_tabla: TablaBodega, p: PedidoBodega) => {
      llamadas.push(p);
      return respuestas(p);
    }) as BodegaCatalogoClient["cambios"],
  };
}

describe("DefaultSincronizarBodegaService.sincronizarPagina", () => {
  it("aplica la página, guarda el cursor tal cual (microsegundos) y devuelve el siguiente", async () => {
    const cursor = { desde: "2026-10-07T15:04:05.123456Z", despues: "10234" };
    const client = clienteDe(async () => pagina([fila("A")], cursor, cursor));
    const repo = new InMemoryBodegaCatalogoRepository();
    const svc = new DefaultSincronizarBodegaService({ client, repo });

    const r = await svc.sincronizarPagina("existencias", INICIO);

    expect(r).toMatchObject({ filas: 1, aplicadas: 1, siguiente: cursor });
    expect((await repo.leerCursores()).existencias).toEqual(cursor);
    expect(repo.existencia("A")).toBeDefined();
  });

  it("pide la página desde el cursor dado, con el límite del contrato", async () => {
    const client = clienteDe(async (p) => pagina([], p.cursor, null));
    const svc = new DefaultSincronizarBodegaService({
      client,
      repo: new InMemoryBodegaCatalogoRepository(),
    });
    const cursor = { desde: "2026-10-07T15:04:05.123456Z", despues: "10234" };
    await svc.sincronizarPagina("existencias", cursor);
    expect(client.llamadas).toEqual([{ cursor, limite: 1000 }]);
  });

  it("una página vacía que no mueve el cursor no escribe nada", async () => {
    const client = clienteDe(async (p) => pagina([], p.cursor, null));
    const repo = new InMemoryBodegaCatalogoRepository();
    const espia = vi.spyOn(repo, "aplicarPagina");
    const svc = new DefaultSincronizarBodegaService({ client, repo });

    const r = await svc.sincronizarPagina("existencias", INICIO);

    expect(espia).not.toHaveBeenCalled();
    expect(r).toMatchObject({ filas: 0, aplicadas: 0, siguiente: null });
  });

  it("una página vacía que mueve el cursor lo guarda", async () => {
    const nuevo = { desde: "2026-10-07T15:09:00.000000Z", despues: null };
    const client = clienteDe(async () => pagina([], nuevo, null));
    const repo = new InMemoryBodegaCatalogoRepository();
    const svc = new DefaultSincronizarBodegaService({ client, repo });

    await svc.sincronizarPagina("existencias", INICIO);

    expect((await repo.leerCursores()).existencias).toEqual(nuevo);
  });

  it("ante 57014 reintenta con un límite menor hasta que entra", async () => {
    let intento = 0;
    const client = clienteDe(async () => {
      intento += 1;
      if (intento < 3) throw new BodegaTimeoutError("57014");
      return pagina([fila("A")], { desde: "2026-10-07T10:00:00.000001Z", despues: "A" }, null);
    });
    const svc = new DefaultSincronizarBodegaService({
      client,
      repo: new InMemoryBodegaCatalogoRepository(),
    });

    const r = await svc.sincronizarPagina("existencias", INICIO);

    expect(client.llamadas.map((l) => l.limite)).toEqual([1000, 500, 250]);
    expect(r.aplicadas).toBe(1);
  });

  it("si ni con el límite mínimo entra, deja subir el timeout (reintentable)", async () => {
    const client = clienteDe(async () => {
      throw new BodegaTimeoutError("57014");
    });
    const svc = new DefaultSincronizarBodegaService({
      client,
      repo: new InMemoryBodegaCatalogoRepository(),
    });

    await expect(svc.sincronizarPagina("existencias", INICIO)).rejects.toBeInstanceOf(
      BodegaTimeoutError,
    );
    const limites = client.llamadas.map((l) => l.limite);
    expect(limites[0]).toBe(1000);
    expect(limites[limites.length - 1]).toBe(100);
  });

  it("los demás errores no se tragan ni se reintentan acá", async () => {
    for (const error of [new PermissionDeniedError("42501"), new InfraError("503", "bodega-web")]) {
      const client = clienteDe(async () => {
        throw error;
      });
      const svc = new DefaultSincronizarBodegaService({
        client,
        repo: new InMemoryBodegaCatalogoRepository(),
      });
      await expect(svc.sincronizarPagina("existencias", INICIO)).rejects.toBe(error);
      expect(client.llamadas).toHaveLength(1);
    }
  });

  it("si la base falla al aplicar, el cursor guardado no avanza", async () => {
    const cursor = { desde: "2026-10-07T15:04:05.123456Z", despues: "10234" };
    const client = clienteDe(async () => pagina([fila("A")], cursor, cursor));
    const base = new InMemoryBodegaCatalogoRepository();
    const roto: BodegaCatalogoRepository = {
      leerCursores: () => base.leerCursores(),
      variantesDeItems: (c) => base.variantesDeItems(c),
      aplicarPagina: async () => {
        throw new InfraError("base caída", "postgrest");
      },
    };
    const svc = new DefaultSincronizarBodegaService({ client, repo: roto });

    await expect(svc.sincronizarPagina("existencias", INICIO)).rejects.toBeInstanceOf(InfraError);
    expect((await base.leerCursores()).existencias).toEqual(INICIO);
  });
});

describe("DefaultSincronizarBodegaService.leerCursores", () => {
  it("devuelve lo que guarda el repositorio", async () => {
    const repo = new InMemoryBodegaCatalogoRepository();
    const cursor = { desde: "2026-10-07T15:04:05.123456Z", despues: "7" };
    await repo.aplicarPagina("variantes", [], cursor);
    const svc = new DefaultSincronizarBodegaService({
      client: clienteDe(async (p) => pagina([], p.cursor, null)),
      repo,
    });
    const c = await svc.leerCursores();
    expect(c.variantes).toEqual(cursor);
    expect(c.marcas).toEqual(INICIO);
  });
});
