import { describe, expect, it } from "vitest";
import { ValidationError } from "@/lib/errors";
import type { Grupo } from "@/lib/ui/condiciones";
import { InMemoryCondicionWorkflowRepository } from "@/server/repositories/condicion-workflow.repo";
import { camposVivosDeCondicion } from "@/server/services/workflows/campos-vivos";
import { DefaultCondicionWorkflowService } from "@/server/services/workflows/condicion.service";

// Fixtures armados a mano para estos tests: no salen de ningún dato real.
const config = { get: async () => ({ horario_timezone: "America/Lima" }) };

const ETAPA: Grupo = {
  id: "g",
  clase: "grupo",
  operador: "y",
  hijos: [
    {
      id: "r",
      clase: "regla",
      campoId: "lead.etapa",
      comparador: "es",
      valor: { tipo: "opcion", valor: "cotizado" },
    },
  ],
};

function montar() {
  const repo = new InMemoryCondicionWorkflowRepository();
  repo.coincidenciasCargadas = {
    total: 3,
    leads: [
      { id: "l1", nombre: "A" },
      { id: "l2", nombre: "B" },
      { id: "l3", nombre: null },
    ],
  };
  const svc = new DefaultCondicionWorkflowService({
    repo,
    config,
    ahora: () => new Date("2026-09-25T15:00:00Z"),
  });
  return { repo, svc };
}

describe("CondicionWorkflowService.coincidencias", () => {
  it("cuenta con la zona del negocio y devuelve la muestra pedida", async () => {
    const { svc } = montar();
    expect(await svc.coincidencias(ETAPA, 2)).toEqual({
      tipo: "contado",
      total: 3,
      leads: [
        { id: "l1", nombre: "A" },
        { id: "l2", nombre: "B" },
      ],
    });
  });

  it("una condición con 'Respondió' no se cuenta: se dice por qué, sin número", async () => {
    const { svc } = montar();
    const arbol: Grupo = {
      ...ETAPA,
      hijos: [
        {
          id: "r",
          clase: "regla",
          campoId: "sesion.respondio",
          comparador: "es",
          valor: { tipo: "booleano", valor: true },
        },
      ],
    };
    expect(await svc.coincidencias(arbol, 0)).toEqual({
      tipo: "no_contable",
      campos: ["sesion.respondio"],
    });
  });

  it("una condición incompleta es un error de validación, no un número", async () => {
    const { svc } = montar();
    const incompleta: Grupo = {
      ...ETAPA,
      hijos: [
        {
          id: "r",
          clase: "regla",
          campoId: "lead.etapa",
          comparador: "es",
          valor: { tipo: "opcion", valor: null },
        },
      ],
    };
    await expect(svc.coincidencias(incompleta, 0)).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("camposVivosDeCondicion", () => {
  it("lee del repo y la zona sale de la config del agente", async () => {
    const repo = new InMemoryCondicionWorkflowRepository();
    repo.vivosPorLead.set("l1", { vehiculo: { marca: "Toyota" } });
    const vivos = camposVivosDeCondicion(repo, config);
    expect(await vivos.zona()).toBe("America/Lima");
    expect(
      await vivos.cargar({
        leadId: "l1",
        leadSessionId: null,
        campos: new Set(["vehiculo.marca"]),
      }),
    ).toEqual({ vehiculo: { marca: "Toyota" } });
  });
});
