import { beforeEach, describe, expect, test } from "vitest";
import { CONFIG_DE_FABRICA } from "@/lib/agente/defaults";
import type {
  AgenteConfigInsert,
  AgenteConfigRepository,
} from "@/server/repositories/agente-config.repo";

export function runAgenteConfigContract(makeRepo: () => AgenteConfigRepository) {
  let repo: AgenteConfigRepository;

  function insert(patch: Partial<AgenteConfigInsert> = {}): AgenteConfigInsert {
    return {
      ...CONFIG_DE_FABRICA,
      version: 1,
      nota: null,
      rollback_de: null,
      creada_por: null,
      ...patch,
    };
  }

  beforeEach(() => {
    repo = makeRepo();
  });

  describe("crear y leer", () => {
    test("crear devuelve la fila con id y created_at", async () => {
      const creada = await repo.crear(insert());
      expect(creada.id).toBeTruthy();
      expect(creada.created_at).toBeTruthy();
      expect(creada.version).toBe(1);
      expect(creada.modelo).toBe(CONFIG_DE_FABRICA.modelo);
    });

    test("crear no deja la fila activa por si sola", async () => {
      const creada = await repo.crear(insert());
      expect(creada.activa).toBe(false);
      expect(await repo.findActiva()).toBeNull();
    });

    test("findById devuelve la fila", async () => {
      const creada = await repo.crear(insert());
      const leida = await repo.findById(creada.id);
      expect(leida?.id).toBe(creada.id);
    });

    test("findById con id inexistente devuelve null", async () => {
      expect(await repo.findById("00000000-0000-0000-0000-000000000000")).toBeNull();
    });

    test("el horario sobrevive el round-trip a jsonb", async () => {
      const horario = { ...CONFIG_DE_FABRICA.horario, dom: [] };
      const creada = await repo.crear(insert({ horario }));
      const leida = await repo.findById(creada.id);
      expect(leida?.horario.dom).toEqual([]);
      expect(leida?.horario.lun).toEqual(CONFIG_DE_FABRICA.horario.lun);
    });
  });

  describe("activar", () => {
    test("activar marca la fila como activa", async () => {
      const creada = await repo.crear(insert());
      const activada = await repo.activar(creada.id);
      expect(activada.activa).toBe(true);
      expect((await repo.findActiva())?.id).toBe(creada.id);
    });

    test("activar una segunda desactiva la primera", async () => {
      const v1 = await repo.crear(insert({ version: 1 }));
      await repo.activar(v1.id);
      const v2 = await repo.crear(insert({ version: 2 }));
      await repo.activar(v2.id);

      expect((await repo.findActiva())?.id).toBe(v2.id);
      expect((await repo.findById(v1.id))?.activa).toBe(false);
    });

    test("nunca hay mas de una activa", async () => {
      for (let v = 1; v <= 4; v++) {
        const fila = await repo.crear(insert({ version: v }));
        await repo.activar(fila.id);
      }
      const todas = await repo.list();
      expect(todas.filter((c) => c.activa)).toHaveLength(1);
    });
  });

  describe("list y siguienteVersion", () => {
    test("list ordena por version descendente", async () => {
      for (const v of [1, 2, 3]) await repo.crear(insert({ version: v }));
      expect((await repo.list()).map((c) => c.version)).toEqual([3, 2, 1]);
    });

    test("list respeta el limite", async () => {
      for (const v of [1, 2, 3]) await repo.crear(insert({ version: v }));
      expect(await repo.list(2)).toHaveLength(2);
    });

    test("siguienteVersion arranca en 1 con la tabla vacia", async () => {
      expect(await repo.siguienteVersion()).toBe(1);
    });

    test("siguienteVersion sigue a la mayor existente", async () => {
      await repo.crear(insert({ version: 1 }));
      await repo.crear(insert({ version: 2 }));
      expect(await repo.siguienteVersion()).toBe(3);
    });
  });

  describe("procedencia", () => {
    test("rollback_de y nota se persisten", async () => {
      const v1 = await repo.crear(insert({ version: 1 }));
      const v2 = await repo.crear(
        insert({ version: 2, rollback_de: v1.id, nota: "Rollback a la version 1" }),
      );
      const leida = await repo.findById(v2.id);
      expect(leida?.rollback_de).toBe(v1.id);
      expect(leida?.nota).toBe("Rollback a la version 1");
    });
  });
}
