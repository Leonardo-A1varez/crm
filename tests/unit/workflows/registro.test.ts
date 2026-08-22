import { describe, expect, it } from "vitest";
import { crearRegistro } from "@/server/services/workflows/acciones/registro";
import { ValidationError } from "@/lib/errors";

describe("crearRegistro", () => {
  it("resuelve el handler por el tipo declarado en config", async () => {
    const registro = crearRegistro({
      poner_etiqueta: async () => ({ puerto: "salida", salida: { ok: true } }),
    });
    const r = await registro.ejecutar(
      { id: "a", tipo: "accion", config: { accion: "poner_etiqueta" }, posicion: { x: 0, y: 0 } },
      { leadId: "l1", runId: "r1", orden: 1, contexto: {} },
    );
    expect(r.puerto).toBe("salida");
    expect(r.salida).toEqual({ ok: true });
  });

  it("una accion desconocida es ValidationError, no un crash", async () => {
    const registro = crearRegistro({});
    await expect(
      registro.ejecutar(
        { id: "a", tipo: "accion", config: { accion: "inventada" }, posicion: { x: 0, y: 0 } },
        { leadId: "l1", runId: "r1", orden: 1, contexto: {} },
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
