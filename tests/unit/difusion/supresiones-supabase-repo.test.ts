import { describe, expect, test } from "vitest";
import { parsearClavesBajas } from "@/lib/difusion/claves-bajas";
import { ConflictError, IllegalStateError, ValidationError } from "@/lib/errors";
import type { AppClient } from "@/server/db/client";
import {
  HasherTelefonoBajas,
  hasherBajasDesde,
} from "@/server/repositories/difusion-supresiones.hash";
import { SupabaseDifusionSupresionesRepository } from "@/server/repositories/difusion-supresiones.supabase.repo";

/**
 * Lo que el contract test contra Postgres no puede ver (y que además está
 * congelado, AGENTS.md lección 10): qué viaja a la base y qué sale en los
 * errores. Un cliente falso que registra cada llamada.
 */

// Clave de prueba: 32 bytes. No es secreto de ningún entorno.
const K1 = Buffer.alloc(32, 5).toString("base64");
const HASHER = new HasherTelefonoBajas(parsearClavesBajas(`1:${K1}`, 1));
const TELEFONO = "593991234567";
const HASH = HASHER.alta(TELEFONO).telefono_hash;

interface Resultado {
  data: unknown;
  error: { code: string; message: string; details: string | null; hint: string | null } | null;
}

function filaDb(extra: Record<string, unknown> = {}) {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    telefono_hash: HASH,
    clave_version: 1,
    origen: "manual",
    detalle: null,
    lead_id: null,
    difusion_id: null,
    registrada_por: null,
    created_at: "2026-09-24T10:00:00Z",
    reactivada_at: null,
    reactivada_por: null,
    reactivacion_motivo: null,
    ...extra,
  };
}

function clienteFalso(respuestas: { rpc?: Resultado[]; insert?: Resultado; listar?: Resultado }) {
  const llamadas: { rpc: { nombre: string; args: unknown }[]; insert: unknown[] } = {
    rpc: [],
    insert: [],
  };
  const rpcs = [...(respuestas.rpc ?? [])];
  const db = {
    rpc: async (nombre: string, args: unknown) => {
      llamadas.rpc.push({ nombre, args });
      return rpcs.shift() ?? { data: [], error: null };
    },
    from: () => ({
      insert: (payload: unknown) => {
        llamadas.insert.push(payload);
        return { select: () => ({ single: async () => respuestas.insert }) };
      },
      select: () => ({
        order: () => ({ order: () => ({ range: async () => respuestas.listar }) }),
      }),
    }),
  };
  return { db: db as unknown as AppClient, llamadas };
}

describe("SupabaseDifusionSupresionesRepository", () => {
  test("registrar manda el hash y la versión, nunca el teléfono", async () => {
    const { db, llamadas } = clienteFalso({ insert: { data: filaDb(), error: null } });

    await new SupabaseDifusionSupresionesRepository(db, HASHER).registrar({
      telefono: "+593 99 123 4567",
      origen: "manual",
    });

    expect(llamadas.insert).toEqual([
      expect.objectContaining({ telefono_hash: HASH, clave_version: 1 }),
    ]);
    const todoLoQueViajo = JSON.stringify(llamadas);
    expect(todoLoQueViajo).not.toContain(TELEFONO);
    expect(todoLoQueViajo).not.toContain('telefono"');
  });

  test("activasPorTelefonos busca por RPC con los hashes y devuelve el teléfono buscado", async () => {
    const { db, llamadas } = clienteFalso({ rpc: [{ data: [filaDb()], error: null }] });

    const activas = await new SupabaseDifusionSupresionesRepository(db, HASHER).activasPorTelefonos(
      [`+${TELEFONO}`, "ig:123"],
    );

    expect(llamadas.rpc).toEqual([
      { nombre: "difusion_supresiones_activas", args: { p_hashes: [HASH] } },
    ]);
    expect(activas.map((a) => a.telefono)).toEqual([TELEFONO]);
    expect(activas[0]).not.toHaveProperty("telefono_hash");
  });

  test("una audiencia grande se consulta en lotes de a 500 hashes", async () => {
    const { db, llamadas } = clienteFalso({});
    const telefonos = Array.from({ length: 1_200 }, (_, i) => `5939${String(10_000_000 + i)}`);

    await new SupabaseDifusionSupresionesRepository(db, HASHER).activasPorTelefonos(telefonos);

    expect(llamadas.rpc.map((c) => (c.args as { p_hashes: string[] }).p_hashes.length)).toEqual([
      500, 500, 200,
    ]);
  });

  // Postgres pone la fila o la clave que falló en `details`: con el hash adentro.
  test.each([
    ["23505", ConflictError, `Key (telefono_hash)=(${HASH}) already exists.`],
    ["23514", ValidationError, `Failing row contains (x, ${HASH}, ${TELEFONO}).`],
  ])("un error %s no lleva ni el hash ni el teléfono", async (code, Clase, details) => {
    const error = { code, message: "violación", details, hint: `hint ${HASH}` };
    const { db } = clienteFalso({ insert: { data: null, error } });

    const e = await new SupabaseDifusionSupresionesRepository(db, HASHER)
      .registrar({ telefono: TELEFONO, origen: "manual" })
      .then(
        () => null,
        (x: unknown) => x,
      );

    expect(e).toBeInstanceOf(Clase);
    const serializado = JSON.stringify(e, Object.getOwnPropertyNames(e)) + String(e);
    expect(serializado).not.toContain(HASH);
    expect(serializado).not.toContain(TELEFONO);
  });

  test("sin claves configuradas, registrar y buscar fallan en voz alta y listar sigue andando", async () => {
    const { db, llamadas } = clienteFalso({ listar: { data: [filaDb()], error: null } });
    const repo = new SupabaseDifusionSupresionesRepository(db, () => hasherBajasDesde({}));

    await expect(repo.activasPorTelefonos([TELEFONO])).rejects.toThrow(IllegalStateError);
    await expect(repo.registrar({ telefono: TELEFONO, origen: "manual" })).rejects.toThrow(
      IllegalStateError,
    );
    expect(llamadas.rpc).toEqual([]);
    expect(llamadas.insert).toEqual([]);
    expect(await repo.listar({ limite: 1 })).toHaveLength(1);
  });

  test("construir el repo sin claves no falla: sólo falla usarlo", () => {
    const { db } = clienteFalso({});
    expect(
      () => new SupabaseDifusionSupresionesRepository(db, () => hasherBajasDesde({})),
    ).not.toThrow();
  });
});
