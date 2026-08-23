import { describe, expect, test, vi } from "vitest";
import { InfraError, NotFoundError } from "@/lib/errors";
import type { AppClient } from "@/server/db/client";
import { SupabaseWorkflowsRepository } from "@/server/repositories/workflows.supabase.repo";

const COLS_VERSION =
  "id, workflow_id, version, grafo, max_pasos, publicada, created_at, created_by, politica_concurrencia";

describe("SupabaseWorkflowsRepository.publicarVersion", () => {
  test("invoca la RPC transaccional y relee la version publicada", async () => {
    const versionId = crypto.randomUUID();
    const workflowId = crypto.randomUUID();
    const filaVersion = {
      id: versionId,
      workflow_id: workflowId,
      version: 2,
      grafo: { nodos: [], aristas: [] },
      max_pasos: 500,
      publicada: true,
      created_at: new Date().toISOString(),
      created_by: null,
      politica_concurrencia: "ignorar",
    };

    const rpc = vi.fn().mockResolvedValue({
      data: [{ version_id: versionId, error_code: null }],
      error: null,
    });
    const select = vi.fn().mockReturnThis();
    const eq = vi.fn().mockReturnThis();
    const single = vi.fn().mockResolvedValue({ data: filaVersion, error: null });
    const from = vi.fn().mockReturnValue({ select, eq, single });

    const fake = { rpc, from } as unknown as AppClient;
    const repo = new SupabaseWorkflowsRepository(fake);

    const resultado = await repo.publicarVersion(versionId);

    expect(rpc).toHaveBeenCalledWith("publicar_workflow_version", { p_version_id: versionId });
    expect(from).toHaveBeenCalledWith("workflow_versiones");
    expect(select).toHaveBeenCalledWith(COLS_VERSION);
    expect(eq).toHaveBeenCalledWith("id", versionId);
    expect(resultado.id).toBe(versionId);
    expect(resultado.publicada).toBe(true);
  });

  test("mapea version_not_found a NotFoundError", async () => {
    const versionId = crypto.randomUUID();
    const fake = {
      rpc: vi.fn().mockResolvedValue({
        data: [{ version_id: null, error_code: "version_not_found" }],
        error: null,
      }),
    } as unknown as AppClient;
    const repo = new SupabaseWorkflowsRepository(fake);

    await expect(repo.publicarVersion(versionId)).rejects.toBeInstanceOf(NotFoundError);
  });

  test("rechaza una respuesta vacia de la RPC como fallo de infraestructura", async () => {
    const fake = {
      rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    } as unknown as AppClient;
    const repo = new SupabaseWorkflowsRepository(fake);

    await expect(repo.publicarVersion(crypto.randomUUID())).rejects.toBeInstanceOf(InfraError);
  });
});

describe("SupabaseWorkflowsRepository.findVersion", () => {
  test("un id que no es UUID no golpea la base -- devuelve null", async () => {
    const from = vi.fn();
    const fake = { from } as unknown as AppClient;
    const repo = new SupabaseWorkflowsRepository(fake);

    await expect(repo.findVersion("no-es-un-uuid")).resolves.toBeNull();
    expect(from).not.toHaveBeenCalled();
  });

  test("consulta workflow_versiones por id", async () => {
    const id = crypto.randomUUID();
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const eq = vi.fn().mockReturnThis();
    const select = vi.fn().mockReturnThis();
    const from = vi.fn().mockReturnValue({ select, eq, maybeSingle });
    const fake = { from } as unknown as AppClient;
    const repo = new SupabaseWorkflowsRepository(fake);

    await repo.findVersion(id);

    expect(from).toHaveBeenCalledWith("workflow_versiones");
    expect(select).toHaveBeenCalledWith(COLS_VERSION);
    expect(eq).toHaveBeenCalledWith("id", id);
  });
});

describe("SupabaseWorkflowsRepository.listarPublicadasPorDisparador", () => {
  test("sin workflows activos, no consulta workflow_versiones y devuelve vacio", async () => {
    const range = vi.fn().mockResolvedValue({ data: [], error: null });
    const eq = vi.fn().mockReturnThis();
    const select = vi.fn().mockReturnThis();
    const from = vi.fn().mockReturnValue({ select, eq, range });
    const fake = { from } as unknown as AppClient;
    const repo = new SupabaseWorkflowsRepository(fake);

    const r = await repo.listarPublicadasPorDisparador("etiqueta_asignada");

    expect(r).toEqual([]);
    expect(from).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith("workflows");
  });

  test("filtra en TS por el disparador del grafo tras traer las versiones publicadas de los workflows activos", async () => {
    const workflowId = crypto.randomUUID();
    const versionQueMatchea = {
      id: crypto.randomUUID(),
      workflow_id: workflowId,
      version: 1,
      grafo: {
        nodos: [
          {
            id: "d",
            tipo: "disparador",
            config: { disparador: "etiqueta_asignada" },
            posicion: { x: 0, y: 0 },
          },
        ],
        aristas: [],
      },
      max_pasos: 500,
      publicada: true,
      created_at: new Date().toISOString(),
      created_by: null,
      politica_concurrencia: "ignorar",
    };
    const versionQueNoMatchea = {
      ...versionQueMatchea,
      id: crypto.randomUUID(),
      grafo: {
        nodos: [
          {
            id: "d",
            tipo: "disparador",
            config: { disparador: "mensaje_recibido" },
            posicion: { x: 0, y: 0 },
          },
        ],
        aristas: [],
      },
    };

    let call = 0;
    const from = vi.fn().mockImplementation((table: string) => {
      call += 1;
      if (table === "workflows") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          range: vi.fn().mockResolvedValue({ data: [{ id: workflowId }], error: null }),
        };
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        range: vi
          .fn()
          .mockResolvedValue({ data: [versionQueMatchea, versionQueNoMatchea], error: null }),
      };
    });
    const fake = { from } as unknown as AppClient;
    const repo = new SupabaseWorkflowsRepository(fake);

    const r = await repo.listarPublicadasPorDisparador("etiqueta_asignada");

    expect(call).toBe(2);
    expect(r.map((v) => v.id)).toEqual([versionQueMatchea.id]);
  });
});
