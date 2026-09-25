import { beforeEach, describe, expect, test, vi } from "vitest";
import { ConflictError, NotFoundError, PermissionDeniedError, ValidationError } from "@/lib/errors";
import { DifusionProgramadaSchema } from "@/lib/difusion/eventos";
import type { Grupo } from "@/lib/ui/condiciones";
import type { AppClient } from "@/server/db/client";
import {
  InMemoryDifusionEnviosRepository,
  type DifusionEnvioInsert,
} from "@/server/repositories/difusion-envios.repo";
import { InMemoryDifusionProgramacionRepository } from "@/server/repositories/difusion-programacion.repo";
import { SupabaseDifusionProgramacionRepository } from "@/server/repositories/difusion-programacion.supabase.repo";
import { InMemoryDifusionesRepository } from "@/server/repositories/difusiones.repo";

// Árbol y leads armados a mano para este archivo.
/** Una difusión que sale necesita plantilla e idioma (CHECK de la tabla). */
const CON_PLANTILLA = {
  plantilla_nombre: "promo_frenos_v3",
  plantilla_categoria: "marketing",
  plantilla_idioma: "es",
} as const;

const ARBOL: Grupo = {
  id: "raiz",
  clase: "grupo",
  operador: "y",
  hijos: [
    {
      id: "r1",
      clase: "regla",
      campoId: "canal",
      comparador: "tiene",
      valor: { tipo: "opciones", valores: ["wa"] },
    },
  ],
};
const VACIO: Grupo = { id: "raiz", clase: "grupo", operador: "y", hijos: [] };
const HOY = new Date("2026-09-14T13:00:00.000Z");
const L1 = "00000000-0000-4000-8000-000000000001";
const L2 = "00000000-0000-4000-8000-000000000002";
const L3 = "00000000-0000-4000-8000-000000000003";

function enCola(difusionId: string, leadId: string, telefono: string): DifusionEnvioInsert {
  return {
    difusion_id: difusionId,
    lead_id: leadId,
    telefono,
    estado: "en_cola",
    motivo_exclusion: null,
    ruta: "plantilla",
    tanda: 0,
    programado_para: HOY,
  };
}

function excluido(difusionId: string, leadId: string): DifusionEnvioInsert {
  return {
    difusion_id: difusionId,
    lead_id: leadId,
    telefono: "593900000009",
    estado: "excluido",
    motivo_exclusion: "baja_propia",
    ruta: null,
    tanda: null,
    programado_para: null,
  };
}

describe("InMemoryDifusionProgramacionRepository", () => {
  let difusiones: InMemoryDifusionesRepository;
  let envios: InMemoryDifusionEnviosRepository;
  let repo: InMemoryDifusionProgramacionRepository;

  beforeEach(() => {
    difusiones = new InMemoryDifusionesRepository();
    envios = new InMemoryDifusionEnviosRepository();
    repo = new InMemoryDifusionProgramacionRepository(difusiones, envios);
  });

  test("escribe el plan, pasa a programada y deja el aviso con el contrato del evento", async () => {
    const d = await difusiones.create({
      nombre: "Promo",
      audiencia: ARBOL,
      creada_por: null,
      ...CON_PLANTILLA,
    });

    const r = await repo.programar({
      difusionId: d.id,
      programadaPara: HOY,
      canaryTamano: 1,
      filas: [
        enCola(d.id, L1, "593900000001"),
        enCola(d.id, L2, "593900000002"),
        excluido(d.id, L3),
      ],
    });

    expect(r).toEqual({ audienciaInicial: 3, destinatarios: 2 });
    const leida = await difusiones.findById(d.id);
    expect(leida?.estado).toBe("programada");
    expect(leida?.programada_para?.toISOString()).toBe(HOY.toISOString());
    expect(leida?.canary_tamano).toBe(1);
    expect((await envios.contarPorDifusion(d.id)).total).toBe(3);
    expect(repo.avisos).toHaveLength(1);
    expect(DifusionProgramadaSchema.parse(repo.avisos[0])).toEqual({
      difusionId: d.id,
      programadaPara: HOY.toISOString(),
      audienciaInicial: 3,
      destinatarios: 2,
    });
  });

  test("una difusión se programa una sola vez", async () => {
    const d = await difusiones.create({
      nombre: "Promo",
      audiencia: ARBOL,
      creada_por: null,
      ...CON_PLANTILLA,
    });
    const filas = [enCola(d.id, L1, "593900000001")];
    await repo.programar({ difusionId: d.id, programadaPara: HOY, canaryTamano: null, filas });

    await expect(
      repo.programar({ difusionId: d.id, programadaPara: HOY, canaryTamano: null, filas }),
    ).rejects.toThrow(ConflictError);
    expect(repo.avisos).toHaveLength(1);
  });

  test("una que no existe es NotFoundError", async () => {
    await expect(
      repo.programar({
        difusionId: "00000000-0000-4000-8000-000000000999",
        programadaPara: HOY,
        canaryTamano: null,
        filas: [enCola("00000000-0000-4000-8000-000000000999", L1, "593900000001")],
      }),
    ).rejects.toThrow(NotFoundError);
  });

  test("un plan vacío o con filas de otra difusión se rechaza", async () => {
    const d = await difusiones.create({
      nombre: "Promo",
      audiencia: ARBOL,
      creada_por: null,
      ...CON_PLANTILLA,
    });
    await expect(
      repo.programar({ difusionId: d.id, programadaPara: HOY, canaryTamano: null, filas: [] }),
    ).rejects.toThrow(ValidationError);
    await expect(
      repo.programar({
        difusionId: d.id,
        programadaPara: HOY,
        canaryTamano: null,
        filas: [enCola("00000000-0000-4000-8000-000000000777", L1, "593900000001")],
      }),
    ).rejects.toThrow(ValidationError);
  });

  // Todo o nada, como la transacción de `programar_difusion()`.
  test("si el plan choca no queda nada escrito: ni filas, ni estado, ni aviso", async () => {
    const d = await difusiones.create({
      nombre: "Promo",
      audiencia: ARBOL,
      creada_por: null,
      ...CON_PLANTILLA,
    });

    await expect(
      repo.programar({
        difusionId: d.id,
        programadaPara: HOY,
        canaryTamano: null,
        filas: [enCola(d.id, L1, "593900000001"), enCola(d.id, L2, "593900000001")],
      }),
    ).rejects.toThrow(ConflictError);

    expect((await difusiones.findById(d.id))?.estado).toBe("borrador");
    expect((await envios.contarPorDifusion(d.id)).total).toBe(0);
    expect(repo.avisos).toHaveLength(0);
  });

  test("un árbol vacío sin elegir toda la base no se programa, y no escribe filas", async () => {
    const d = await difusiones.create({
      nombre: "Vacía",
      audiencia: VACIO,
      creada_por: null,
      ...CON_PLANTILLA,
    });

    await expect(
      repo.programar({
        difusionId: d.id,
        programadaPara: HOY,
        canaryTamano: null,
        filas: [enCola(d.id, L1, "593900000001")],
      }),
    ).rejects.toThrow(ValidationError);
    expect((await envios.contarPorDifusion(d.id)).total).toBe(0);
  });
});

describe("SupabaseDifusionProgramacionRepository", () => {
  const ID = "3f2b8c1a-9d4e-4f6a-8b7c-1e2d3c4b5a69";

  test("llama a la RPC transaccional con el plan y devuelve las cifras", async () => {
    const rpc = vi.fn(async () => ({
      data: [{ audiencia_inicial: 2, destinatarios: 1 }],
      error: null,
    }));
    const repo = new SupabaseDifusionProgramacionRepository({ rpc } as unknown as AppClient);

    const r = await repo.programar({
      difusionId: ID,
      programadaPara: HOY,
      canaryTamano: null,
      filas: [enCola(ID, L1, "593900000001"), excluido(ID, L3)],
    });

    expect(r).toEqual({ audienciaInicial: 2, destinatarios: 1 });
    expect(rpc).toHaveBeenCalledWith("programar_difusion", {
      p_difusion_id: ID,
      p_programada_para: HOY.toISOString(),
      p_envios: [
        {
          lead_id: L1,
          telefono: "593900000001",
          estado: "en_cola",
          motivo_exclusion: null,
          ruta: "plantilla",
          tanda: 0,
          programado_para: HOY.toISOString(),
        },
        {
          lead_id: L3,
          telefono: "593900000009",
          estado: "excluido",
          motivo_exclusion: "baja_propia",
          ruta: null,
          tanda: null,
          programado_para: null,
        },
      ],
    });
  });

  test("con canary lo manda; sin canary lo omite y la base usa su default", async () => {
    const rpc = vi.fn(async () => ({
      data: [{ audiencia_inicial: 1, destinatarios: 1 }],
      error: null,
    }));
    const repo = new SupabaseDifusionProgramacionRepository({ rpc } as unknown as AppClient);

    await repo.programar({
      difusionId: ID,
      programadaPara: HOY,
      canaryTamano: 50,
      filas: [enCola(ID, L1, "593900000001")],
    });

    expect(rpc).toHaveBeenCalledWith(
      "programar_difusion",
      expect.objectContaining({ p_canary_tamano: 50 }),
    );
  });

  test.each([
    ["23505", ConflictError],
    ["42501", PermissionDeniedError],
    ["P0002", NotFoundError],
    ["23514", ValidationError],
  ] as const)("mapea el error %s de la base", async (code, Clase) => {
    const rpc = vi.fn(async () => ({ data: null, error: { code, message: "x" } }));
    const repo = new SupabaseDifusionProgramacionRepository({ rpc } as unknown as AppClient);

    await expect(
      repo.programar({
        difusionId: ID,
        programadaPara: HOY,
        canaryTamano: null,
        filas: [enCola(ID, L1, "593900000001")],
      }),
    ).rejects.toBeInstanceOf(Clase);
  });
});
