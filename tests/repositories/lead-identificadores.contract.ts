import { beforeEach, describe, expect, test } from "vitest";
import { ConflictError } from "@/lib/errors";
import type {
  LeadIdentificadorInsert,
  LeadIdentificadoresRepository,
} from "@/server/repositories/lead-identificadores.repo";
import type { UUID } from "@/types/entities";

export interface LeadIdentificadoresContractFixtures {
  /** Tres leads distintos ya persistidos: la FK `lead_id` los exige. */
  leadIds: { a: UUID; b: UUID; c: UUID };
}

const DEFAULT_FIXTURES: LeadIdentificadoresContractFixtures = {
  leadIds: { a: "lead-a", b: "lead-b", c: "lead-c" },
};

export type LeadIdentificadoresContractFixturesArg =
  | LeadIdentificadoresContractFixtures
  | (() => LeadIdentificadoresContractFixtures);

function base(
  fixtures: LeadIdentificadoresContractFixtures,
  overrides: Partial<LeadIdentificadorInsert> = {},
): LeadIdentificadorInsert {
  return {
    lead_id: fixtures.leadIds.a,
    tipo: "telefono",
    valor: "593979932363",
    valor_original: "+593 97 993 2363",
    principal: true,
    origen: "manual",
    ...overrides,
  };
}

export function runLeadIdentificadoresContract(
  makeRepo: () => LeadIdentificadoresRepository,
  fixturesArg: LeadIdentificadoresContractFixturesArg = DEFAULT_FIXTURES,
) {
  describe("LeadIdentificadoresRepository contract", () => {
    let repo: LeadIdentificadoresRepository;
    let fixtures: LeadIdentificadoresContractFixtures;

    beforeEach(() => {
      repo = makeRepo();
      fixtures = typeof fixturesArg === "function" ? fixturesArg() : fixturesArg;
    });

    test("create devuelve el identificador con id y created_at", async () => {
      const i = await repo.create(base(fixtures));

      expect(i.id).toBeTypeOf("string");
      expect(i.lead_id).toBe(fixtures.leadIds.a);
      expect(i.tipo).toBe("telefono");
      expect(i.valor).toBe("593979932363");
      expect(i.valor_original).toBe("+593 97 993 2363");
      expect(i.principal).toBe(true);
      expect(i.created_at).toBeInstanceOf(Date);
    });

    test("listByLeadId devuelve solo los de ese lead", async () => {
      await repo.create(base(fixtures, { lead_id: fixtures.leadIds.a }));
      await repo.create(base(fixtures, { lead_id: fixtures.leadIds.b, valor: "593999888777" }));

      const deA = await repo.listByLeadId(fixtures.leadIds.a);

      expect(deA).toHaveLength(1);
      expect(deA[0]?.lead_id).toBe(fixtures.leadIds.a);
    });

    test("listByLeadId de un lead sin identificadores devuelve vacío", async () => {
      expect(await repo.listByLeadId(fixtures.leadIds.c)).toEqual([]);
    });

    // Un lead puede tener dos teléfonos y un RUC. Lo que no puede es tener dos
    // veces el mismo valor del mismo tipo.
    test("un lead admite varios identificadores de distinto tipo y valor", async () => {
      await repo.create(base(fixtures, { tipo: "telefono", valor: "593979932363" }));
      await repo.create(base(fixtures, { tipo: "email", valor: "juan@taller.com" }));
      await repo.create(base(fixtures, { tipo: "ruc", valor: "1791234567001" }));

      expect(await repo.listByLeadId(fixtures.leadIds.a)).toHaveLength(3);
    });

    test("el duplicado exacto se rechaza con ConflictError", async () => {
      await repo.create(base(fixtures));

      await expect(repo.create(base(fixtures))).rejects.toThrow(ConflictError);
    });

    test("delete lo saca y es idempotente", async () => {
      const i = await repo.create(base(fixtures));

      await repo.delete(i.id);
      expect(await repo.listByLeadId(fixtures.leadIds.a)).toEqual([]);

      await expect(repo.delete(i.id)).resolves.toBeUndefined();
    });

    describe("findCoincidencias", () => {
      // Es lo que reemplazó al match por nombre: dos personas se llaman igual
      // todo el tiempo, pero no comparten teléfono ni RUC.
      test("encuentra al lead que comparte el mismo valor", async () => {
        await repo.create(base(fixtures, { lead_id: fixtures.leadIds.a, valor: "593979932363" }));
        await repo.create(base(fixtures, { lead_id: fixtures.leadIds.b, valor: "593979932363" }));

        const coincidencias = await repo.findCoincidencias(fixtures.leadIds.a);

        expect(coincidencias).toHaveLength(1);
        expect(coincidencias[0]?.leadId).toBe(fixtures.leadIds.b);
        expect(coincidencias[0]?.tipos).toContain("telefono");
      });

      test("no se devuelve a sí mismo", async () => {
        await repo.create(base(fixtures, { lead_id: fixtures.leadIds.a }));

        const coincidencias = await repo.findCoincidencias(fixtures.leadIds.a);

        expect(coincidencias.map((c) => c.leadId)).not.toContain(fixtures.leadIds.a);
      });

      test("valores distintos no coinciden", async () => {
        await repo.create(base(fixtures, { lead_id: fixtures.leadIds.a, valor: "593979932363" }));
        await repo.create(base(fixtures, { lead_id: fixtures.leadIds.b, valor: "593111222333" }));

        expect(await repo.findCoincidencias(fixtures.leadIds.a)).toEqual([]);
      });

      // La certeza del duplicado depende del tipo —un VIN vale más que un
      // teléfono— así que quien consulta necesita saber por cuál coincidieron.
      test("informa todos los tipos por los que coinciden", async () => {
        await repo.create(
          base(fixtures, { lead_id: fixtures.leadIds.a, tipo: "telefono", valor: "593979932363" }),
        );
        await repo.create(
          base(fixtures, { lead_id: fixtures.leadIds.a, tipo: "ruc", valor: "1791234567001" }),
        );
        await repo.create(
          base(fixtures, { lead_id: fixtures.leadIds.b, tipo: "telefono", valor: "593979932363" }),
        );
        await repo.create(
          base(fixtures, { lead_id: fixtures.leadIds.b, tipo: "ruc", valor: "1791234567001" }),
        );

        const coincidencias = await repo.findCoincidencias(fixtures.leadIds.a);

        expect(coincidencias).toHaveLength(1);
        expect(coincidencias[0]?.tipos.sort()).toEqual(["ruc", "telefono"]);
      });

      test("un lead sin identificadores no coincide con nadie", async () => {
        await repo.create(base(fixtures, { lead_id: fixtures.leadIds.a }));

        expect(await repo.findCoincidencias(fixtures.leadIds.c)).toEqual([]);
      });
    });
  });
}
