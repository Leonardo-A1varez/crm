import { beforeAll, describe } from "vitest";
import { parsearClavesBajas } from "@/lib/difusion/claves-bajas";
import { HasherTelefonoBajas } from "@/server/repositories/difusion-supresiones.hash";
import { SupabaseDifusionSupresionesRepository } from "@/server/repositories/difusion-supresiones.supabase.repo";
import { makeTestSupabaseClient, type TestClient } from "./setup";
import type { DifusionSupresionesContractFixtures } from "../repositories/difusion-supresiones.contract";
import { runDifusionSupresionesContract } from "../repositories/difusion-supresiones.contract";

/**
 * Sin limpieza, a propósito: una baja no se borra —ni con el service-role—, que
 * es exactamente lo que esta tabla garantiza. Cada test usa números nuevos al
 * azar en lugar de vaciar la tabla entre tests.
 *
 * Corre sin persona (service-role), así que la reactivación se prueba del lado
 * del rechazo. El camino feliz exige el cliente autenticado de un admin y está
 * cubierto contra Postgres por las aserciones SQL de la migración.
 */
let client: TestClient;

// Clave de prueba: 32 bytes. No es secreto de ningún entorno; la base de tests
// no comparte filas con ninguna otra.
const HASHER_DE_PRUEBA = new HasherTelefonoBajas(
  parsearClavesBajas(`1:${Buffer.alloc(32, 42).toString("base64")}`, 1),
);

beforeAll(() => {
  client = makeTestSupabaseClient();
});

function telefonoAlAzar(): string {
  const n = Math.floor(Math.random() * 100_000_000);
  return `5939${String(n).padStart(8, "0")}`;
}

describe("SupabaseDifusionSupresionesRepository (integration)", () => {
  runDifusionSupresionesContract(
    (hasher) => new SupabaseDifusionSupresionesRepository(client, hasher ?? HASHER_DE_PRUEBA),
    { comoAdmin: false },
    (): DifusionSupresionesContractFixtures => ({
      nuevoTelefono: telefonoAlAzar,
      desconocido: crypto.randomUUID(),
    }),
  );
});
