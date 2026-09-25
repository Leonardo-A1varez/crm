import { describe, expect, it } from "vitest";
import { IllegalStateError, InfraError } from "@/lib/errors";
import { FILAS_POR_PAGINA, leerPorKeyset } from "@/server/db/paginar";
import { MAX_ROWS_POSTGREST, uuidDe } from "../helpers/fake-postgrest";

type Fila = { id: string };

/** Servidor falso: responde `id > despuesDe` ordenado, con el tope de PostgREST. */
function servidor(filas: Fila[]) {
  let pedidos = 0;
  const pagina = async (despuesDe: string | null, tamanio: number) => {
    pedidos++;
    const out = filas
      .filter((f) => despuesDe === null || f.id > despuesDe)
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .slice(0, Math.min(tamanio, MAX_ROWS_POSTGREST));
    return { data: out, error: null };
  };
  return { pagina, pedidos: () => pedidos };
}

const filas = (n: number): Fila[] => Array.from({ length: n }, (_, i) => ({ id: uuidDe(i) }));

describe("leerPorKeyset", () => {
  it("trae todas las filas aunque pasen el tope de 1.000 de PostgREST", async () => {
    const s = servidor(filas(2501));
    const out = await leerPorKeyset({ recurso: "x", clave: (f) => f.id, pagina: s.pagina });
    expect(out).toHaveLength(2501);
    expect(new Set(out.map((f) => f.id)).size).toBe(2501);
    expect(s.pedidos()).toBe(3);
  });

  it("pide páginas del tamaño del tope, no más grandes", () => {
    expect(FILAS_POR_PAGINA).toBe(MAX_ROWS_POSTGREST);
  });

  it("con exactamente 1.000 filas pide una página más y corta en la vacía", async () => {
    const s = servidor(filas(1000));
    const out = await leerPorKeyset({ recurso: "x", clave: (f) => f.id, pagina: s.pagina });
    expect(out).toHaveLength(1000);
    expect(s.pedidos()).toBe(2);
  });

  it("sin filas hace un solo pedido", async () => {
    const s = servidor([]);
    expect(await leerPorKeyset({ recurso: "x", clave: (f) => f.id, pagina: s.pagina })).toEqual([]);
    expect(s.pedidos()).toBe(1);
  });

  it("un error de PostgREST sale como DomainError, no como filas a medias", async () => {
    await expect(
      leerPorKeyset<Fila>({
        recurso: "x",
        clave: (f) => f.id,
        pagina: async () => ({
          data: null,
          error: { code: "08006", message: "connection failure", details: "", hint: "" },
        }),
      }),
    ).rejects.toBeInstanceOf(InfraError);
  });

  it("un cursor que no avanza corta en vez de pedir la misma página para siempre", async () => {
    const llena = filas(1000);
    await expect(
      leerPorKeyset({
        recurso: "x",
        clave: (f) => f.id,
        pagina: async () => ({ data: llena, error: null }),
      }),
    ).rejects.toBeInstanceOf(IllegalStateError);
  });
});
