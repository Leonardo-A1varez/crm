import { describe, expect, test, vi } from "vitest";
import { InfraError, NotFoundError } from "@/lib/errors";
import type { AppClient } from "@/server/db/client";
import { SupabaseWorkflowsRepository } from "@/server/repositories/workflows.supabase.repo";

/**
 * Todas las columnas: `nota` llega con una migración que puede aplicarse
 * después que el código, y una lista explícita la pediría antes de que exista.
 * Ver el comentario de `COLS_VERSION` en el repo.
 */
const COLS_VERSION = "*";

function filaDeVersion(overrides: Record<string, unknown> = {}) {
  return {
    id: crypto.randomUUID(),
    workflow_id: crypto.randomUUID(),
    version: 2,
    grafo: { nodos: [], aristas: [] },
    max_pasos: 500,
    publicada: true,
    created_at: new Date().toISOString(),
    created_by: null,
    politica_concurrencia: "ignorar",
    nota: null,
    ...overrides,
  };
}

/** `rpc` + la relectura `from().select().eq().single()` que hacen publicar y clonar. */
function clienteConRpc(respuestaRpc: unknown, fila: Record<string, unknown>) {
  const rpc = vi.fn().mockResolvedValue({ data: respuestaRpc, error: null });
  const select = vi.fn().mockReturnThis();
  const eq = vi.fn().mockReturnThis();
  const single = vi.fn().mockResolvedValue({ data: fila, error: null });
  const from = vi.fn().mockReturnValue({ select, eq, single });
  return { rpc, from, select, eq, single, fake: { rpc, from } as unknown as AppClient };
}

describe("SupabaseWorkflowsRepository.publicarVersion", () => {
  test("invoca la RPC transaccional y relee la version publicada", async () => {
    const fila = filaDeVersion();
    const { rpc, from, select, eq, fake } = clienteConRpc(
      [{ version_id: fila.id, error_code: null }],
      fila,
    );
    const repo = new SupabaseWorkflowsRepository(fake);

    const resultado = await repo.publicarVersion(fila.id);

    // La de un argumento queda sólo para el código ya desplegado, hasta que se
    // borre: expand/contract, ver 20260913232000_workflow_versiones_nota.sql.
    expect(rpc).toHaveBeenCalledWith("publicar_workflow_version_con_nota", {
      p_version_id: fila.id,
    });
    expect(rpc).not.toHaveBeenCalledWith("publicar_workflow_version", expect.anything());
    expect(from).toHaveBeenCalledWith("workflow_versiones");
    expect(select).toHaveBeenCalledWith(COLS_VERSION);
    expect(eq).toHaveBeenCalledWith("id", fila.id);
    expect(resultado.id).toBe(fila.id);
    expect(resultado.publicada).toBe(true);
  });

  // Sin nota no se manda `p_nota`: la firma generada no acepta null en un
  // argumento con default, y omitido vale null igual.
  test("con nota manda p_nota; sin nota o en blanco, no la manda", async () => {
    const fila = filaDeVersion({ nota: "Arreglo del saludo" });
    const { rpc, fake } = clienteConRpc([{ version_id: fila.id, error_code: null }], fila);
    const repo = new SupabaseWorkflowsRepository(fake);

    const resultado = await repo.publicarVersion(fila.id, "Arreglo del saludo");
    expect(rpc).toHaveBeenLastCalledWith("publicar_workflow_version_con_nota", {
      p_version_id: fila.id,
      p_nota: "Arreglo del saludo",
    });
    expect(resultado.nota).toBe("Arreglo del saludo");

    await repo.publicarVersion(fila.id, "  ");
    expect(rpc).toHaveBeenLastCalledWith("publicar_workflow_version_con_nota", {
      p_version_id: fila.id,
    });
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

describe("SupabaseWorkflowsRepository.clonarVersion", () => {
  test("invoca la RPC transaccional con todos los argumentos y relee la versión nueva", async () => {
    const origen = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const nueva = filaDeVersion({ version: 3, nota: "Restaurada desde la versión 1" });
    const { rpc, eq, fake } = clienteConRpc([{ version_id: nueva.id, error_code: null }], nueva);
    const repo = new SupabaseWorkflowsRepository(fake);

    const resultado = await repo.clonarVersion({
      versionId: origen,
      publicar: true,
      nota: "Restaurada desde la versión 1",
      createdBy: userId,
    });

    expect(rpc).toHaveBeenCalledWith("clonar_workflow_version", {
      p_version_id: origen,
      p_publicar: true,
      p_nota: "Restaurada desde la versión 1",
      p_created_by: userId,
    });
    expect(eq).toHaveBeenCalledWith("id", nueva.id);
    expect(resultado.version).toBe(3);
    expect(resultado.nota).toBe("Restaurada desde la versión 1");
  });

  test("sin nota ni autor, no manda esos argumentos: valen su default null", async () => {
    const nueva = filaDeVersion({ publicada: false });
    const { rpc, fake } = clienteConRpc([{ version_id: nueva.id, error_code: null }], nueva);
    const repo = new SupabaseWorkflowsRepository(fake);

    await repo.clonarVersion({ versionId: "v", publicar: false, nota: null, createdBy: null });

    expect(rpc).toHaveBeenCalledWith("clonar_workflow_version", {
      p_version_id: "v",
      p_publicar: false,
    });
  });

  test("mapea version_not_found a NotFoundError", async () => {
    const fake = {
      rpc: vi.fn().mockResolvedValue({
        data: [{ version_id: null, error_code: "version_not_found" }],
        error: null,
      }),
    } as unknown as AppClient;
    const repo = new SupabaseWorkflowsRepository(fake);

    await expect(
      repo.clonarVersion({ versionId: "v", publicar: false, nota: null, createdBy: null }),
    ).rejects.toBeInstanceOf(NotFoundError);
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

  test("una fila sin la columna nota —base sin la migración— se lee con nota null", async () => {
    const { nota: _nota, ...sinNota } = filaDeVersion();
    const maybeSingle = vi.fn().mockResolvedValue({ data: sinNota, error: null });
    const from = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle,
    });
    const repo = new SupabaseWorkflowsRepository({ from } as unknown as AppClient);

    const v = await repo.findVersion(sinNota.id);

    expect(v?.nota).toBeNull();
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
      nota: null,
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

const COLS_WORKFLOW = "id, nombre, descripcion, activo, created_at";

describe("SupabaseWorkflowsRepository.setActivo", () => {
  test("hace UPDATE de activo y devuelve la fila", async () => {
    const id = crypto.randomUUID();
    const fila = {
      id,
      nombre: "W",
      descripcion: null,
      activo: true,
      created_at: new Date().toISOString(),
    };
    const maybeSingle = vi.fn().mockResolvedValue({ data: fila, error: null });
    const select = vi.fn().mockReturnThis();
    const eq = vi.fn().mockReturnThis();
    const update = vi.fn().mockReturnThis();
    const from = vi.fn().mockReturnValue({ update, eq, select, maybeSingle });
    const fake = { from } as unknown as AppClient;
    const repo = new SupabaseWorkflowsRepository(fake);

    const resultado = await repo.setActivo(id, true);

    expect(from).toHaveBeenCalledWith("workflows");
    expect(update).toHaveBeenCalledWith({ activo: true });
    expect(eq).toHaveBeenCalledWith("id", id);
    expect(select).toHaveBeenCalledWith(COLS_WORKFLOW);
    expect(resultado.activo).toBe(true);
  });

  test("sin fila devuelta, rechaza con NotFoundError", async () => {
    const id = crypto.randomUUID();
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const from = vi.fn().mockReturnValue({
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      maybeSingle,
    });
    const fake = { from } as unknown as AppClient;
    const repo = new SupabaseWorkflowsRepository(fake);

    await expect(repo.setActivo(id, false)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("SupabaseWorkflowsRepository.eliminar", () => {
  test("hace DELETE por id", async () => {
    const id = crypto.randomUUID();
    const eq = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn().mockReturnValue({ delete: vi.fn().mockReturnValue({ eq }) });
    const fake = { from } as unknown as AppClient;
    const repo = new SupabaseWorkflowsRepository(fake);

    await repo.eliminar(id);

    expect(from).toHaveBeenCalledWith("workflows");
    expect(eq).toHaveBeenCalledWith("id", id);
  });
});
