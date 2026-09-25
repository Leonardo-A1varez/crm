import { describe, expect, it } from "vitest";
import { InfraError, RateLimitError, ValidationError } from "@/lib/errors";
import { reaccionAFallo } from "@/lib/difusion/reacciones";
import { errorDeGraph } from "@/lib/meta/error-graph";

describe("reaccionAFallo", () => {
  it("131050 registra una baja de Meta, venga del envío o del webhook", () => {
    expect(reaccionAFallo("131050", "envio")).toEqual({ tipo: "baja_meta" });
    expect(reaccionAFallo("131050", "webhook")).toEqual({ tipo: "baja_meta" });
  });

  it("131049 y 131047 sólo marcan la fila: la saturación sale de la fila fallida con ese código", () => {
    expect(reaccionAFallo("131049", "webhook")).toEqual({ tipo: "fallar_fila" });
    expect(reaccionAFallo("131047", "envio")).toEqual({ tipo: "fallar_fila" });
  });

  it("131056 al mandar vuelve la fila a la cola: no salió y se puede mandar a otros", () => {
    expect(reaccionAFallo("131056", "envio")).toEqual({ tipo: "reintentar_despues" });
  });

  it("131056 por webhook ya no puede volver a la cola: la fila salió de en_cola", () => {
    expect(reaccionAFallo("131056", "webhook")).toEqual({ tipo: "fallar_fila" });
  });

  it("130429 al mandar corta el lote y devuelve la fila a la cola", () => {
    expect(reaccionAFallo("130429", "envio")).toEqual({ tipo: "frenar_lote" });
  });

  it("368, 131031 y 131048 detienen la difusión entera, con motivo", () => {
    for (const codigo of ["368", "131031", "131048"]) {
      const r = reaccionAFallo(codigo, "webhook");
      expect(r.tipo).toBe("detener");
      if (r.tipo === "detener") expect(r.motivo).toContain(codigo);
    }
  });

  it("132015 pausa en voz alta y dice que la plantilla requiere intervención", () => {
    const r = reaccionAFallo("132015", "envio");
    expect(r.tipo).toBe("pausar");
    if (r.tipo === "pausar") {
      expect(r.motivo).toContain("132015");
      expect(r.motivo).toMatch(/plantilla/i);
    }
  });

  it("132016 detiene: la plantilla no vuelve nunca", () => {
    expect(reaccionAFallo("132016", "envio").tipo).toBe("detener");
  });

  it("un código que no está en la tabla sólo marca la fila", () => {
    expect(reaccionAFallo("131026", "webhook")).toEqual({ tipo: "fallar_fila" });
  });
});

describe("errorDeGraph", () => {
  it("lee el código de Meta de un 400 mapeado a ValidationError", () => {
    const e = new ValidationError("Meta invalid request", { status: 400, code: 131050 });
    expect(errorDeGraph(e)).toEqual({ codigo: "131050", status: 400, clase: "rechazo" });
  });

  it("un 429 es rechazo de ritmo aunque no traiga código", () => {
    const e = new RateLimitError("Meta rate-limited", "meta", undefined, { status: 429 });
    expect(errorDeGraph(e)).toEqual({ codigo: null, status: 429, clase: "ritmo" });
  });

  it("401/403 es credencial, no un fallo del destinatario", () => {
    const e = new ValidationError("Meta auth error", { status: 401, code: 190 });
    expect(errorDeGraph(e).clase).toBe("credencial");
  });

  it("sin respuesta de Meta el desenlace es desconocido", () => {
    const e = new InfraError("Meta sin respuesta", "meta", new TypeError("fetch failed"));
    expect(errorDeGraph(e)).toEqual({ codigo: null, status: null, clase: "desconocido" });
  });

  it("un 5xx con código de Meta conserva el código, pero el desenlace es desconocido", () => {
    const e = new InfraError("Meta HTTP 500", "meta", { status: 500, code: 131000 });
    expect(errorDeGraph(e)).toEqual({ codigo: "131000", status: 500, clase: "desconocido" });
  });
});
