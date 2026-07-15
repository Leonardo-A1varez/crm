import { afterEach, describe, expect, test, vi } from "vitest";
import { InMemoryLeadsRepository } from "@/server/repositories/leads.repo";
import { runLeadsContract } from "../repositories/leads.contract";

runLeadsContract(() => new InMemoryLeadsRepository());

describe("InMemoryLeadsRepository — tiebreak id asc con updated_at idéntico", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("empate de updated_at ordena por id asc", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T12:00:00Z"));
    const repo = new InMemoryLeadsRepository();
    const x = await repo.create({
      nombre: "Lead X",
      telefono: "+549110000001",
      email: null,
      direccion: null,
      vehiculo_marca: "Ford",
      vehiculo_modelo: "Ka",
      vehiculo_anio: 2020,
      vehiculo_motor: null,
      empresa_id: null,
      canal_origen: "wa",
      meta_user_ids: { wa: "wa_x" },
    });
    const y = await repo.create({
      nombre: "Lead Y",
      telefono: "+549110000002",
      email: null,
      direccion: null,
      vehiculo_marca: "Ford",
      vehiculo_modelo: "Ka",
      vehiculo_anio: 2020,
      vehiculo_motor: null,
      empresa_id: null,
      canal_origen: "wa",
      meta_user_ids: { wa: "wa_y" },
    });
    // ambos con updated_at idéntico (clock congelado)
    const all = await repo.list();
    const esperado = [x.id, y.id].sort();
    expect(all.map((l) => l.id)).toEqual(esperado);
  });
});
