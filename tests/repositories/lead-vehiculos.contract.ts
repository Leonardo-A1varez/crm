import { beforeEach, describe, expect, test } from "vitest";
import { NotFoundError } from "@/lib/errors";
import type {
  LeadVehiculoInsert,
  LeadVehiculosRepository,
} from "@/server/repositories/lead-vehiculos.repo";
import type { UUID } from "@/types/entities";

export interface LeadVehiculosContractFixtures {
  leadIds: { a: UUID; b: UUID };
  /** Un id que no existe en `lead_vehiculos`. */
  desconocido: UUID;
}

const DEFAULT_FIXTURES: LeadVehiculosContractFixtures = {
  leadIds: { a: "lead-a", b: "lead-b" },
  desconocido: "00000000-0000-4000-8000-000000000999",
};

export type LeadVehiculosContractFixturesArg =
  | LeadVehiculosContractFixtures
  | (() => LeadVehiculosContractFixtures);

function base(
  fixtures: LeadVehiculosContractFixtures,
  overrides: Partial<LeadVehiculoInsert> = {},
): LeadVehiculoInsert {
  return {
    lead_id: fixtures.leadIds.a,
    marca: "Chevrolet",
    modelo: "Aveo",
    anio: 2012,
    motor: "1.6",
    placa: null,
    placa_original: null,
    vin: null,
    vin_original: null,
    principal: false,
    ...overrides,
  };
}

export function runLeadVehiculosContract(
  makeRepo: () => LeadVehiculosRepository,
  fixturesArg: LeadVehiculosContractFixturesArg = DEFAULT_FIXTURES,
) {
  describe("LeadVehiculosRepository contract", () => {
    let repo: LeadVehiculosRepository;
    let fixtures: LeadVehiculosContractFixtures;

    beforeEach(() => {
      repo = makeRepo();
      fixtures = typeof fixturesArg === "function" ? fixturesArg() : fixturesArg;
    });

    test("create devuelve el vehículo con id y created_at", async () => {
      const v = await repo.create(base(fixtures));

      expect(v.id).toBeTypeOf("string");
      expect(v.lead_id).toBe(fixtures.leadIds.a);
      expect(v.marca).toBe("Chevrolet");
      expect(v.modelo).toBe("Aveo");
      expect(v.anio).toBe(2012);
      expect(v.created_at).toBeInstanceOf(Date);
    });

    // El auto se separó de la persona justamente para esto: un taller tiene
    // flota y un particular puede cambiar de auto sin dejar de ser el mismo lead.
    test("un lead admite varios vehículos", async () => {
      await repo.create(base(fixtures, { modelo: "Aveo" }));
      await repo.create(base(fixtures, { modelo: "Spark" }));

      expect(await repo.listByLeadId(fixtures.leadIds.a)).toHaveLength(2);
    });

    test("listByLeadId no mezcla leads", async () => {
      await repo.create(base(fixtures, { lead_id: fixtures.leadIds.a }));
      await repo.create(base(fixtures, { lead_id: fixtures.leadIds.b }));

      const deA = await repo.listByLeadId(fixtures.leadIds.a);

      expect(deA).toHaveLength(1);
      expect(deA[0]?.lead_id).toBe(fixtures.leadIds.a);
    });

    test("listByLeadId de un lead sin autos devuelve vacío", async () => {
      expect(await repo.listByLeadId(fixtures.leadIds.b)).toEqual([]);
    });

    // La ficha muestra el principal arriba: si el orden no lo respeta, el
    // vendedor ve primero el auto equivocado.
    test("el principal viene primero", async () => {
      await repo.create(base(fixtures, { modelo: "Spark", principal: false }));
      await repo.create(base(fixtures, { modelo: "Aveo", principal: true }));

      const autos = await repo.listByLeadId(fixtures.leadIds.a);

      expect(autos[0]?.modelo).toBe("Aveo");
      expect(autos[0]?.principal).toBe(true);
    });

    test("update cambia lo editable y conserva el lead", async () => {
      const v = await repo.create(base(fixtures));

      const editado = await repo.update(v.id, { modelo: "Aveo Family", anio: 2014 });

      expect(editado.modelo).toBe("Aveo Family");
      expect(editado.anio).toBe(2014);
      expect(editado.lead_id).toBe(fixtures.leadIds.a);
    });

    test("update de uno inexistente lanza NotFoundError", async () => {
      await expect(repo.update(fixtures.desconocido, { modelo: "x" })).rejects.toThrow(
        NotFoundError,
      );
    });

    test("delete lo saca y es idempotente", async () => {
      const v = await repo.create(base(fixtures));

      await repo.delete(v.id);
      expect(await repo.listByLeadId(fixtures.leadIds.a)).toEqual([]);

      await expect(repo.delete(v.id)).resolves.toBeUndefined();
    });

    // Placa y VIN son lo que hace al auto identificable: el detector de
    // duplicados los compara y por eso guardan la forma normalizada aparte de
    // la que escribió la persona.
    test("guarda placa y VIN con su forma original al lado", async () => {
      const v = await repo.create(
        base(fixtures, {
          placa: "PBA1234",
          placa_original: "pba-1234",
          vin: "1HGBH41JXMN109186",
          vin_original: "1hgbh41jxmn109186",
        }),
      );

      expect(v.placa).toBe("PBA1234");
      expect(v.placa_original).toBe("pba-1234");
      expect(v.vin).toBe("1HGBH41JXMN109186");
      expect(v.vin_original).toBe("1hgbh41jxmn109186");
    });

    // El agente detecta el auto de a pedazos: primero la marca, después el año.
    // Un vehículo con casi todo en null tiene que poder existir igual.
    test("acepta un vehículo con casi todo sin saber", async () => {
      const v = await repo.create(
        base(fixtures, { marca: "Mazda", modelo: null, anio: null, motor: null }),
      );

      expect(v.marca).toBe("Mazda");
      expect(v.modelo).toBeNull();
      expect(v.anio).toBeNull();
    });
  });
}
