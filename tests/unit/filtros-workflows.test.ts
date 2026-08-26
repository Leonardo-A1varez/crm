import { describe, expect, it } from "vitest";
import {
  filtrarYOrdenarWorkflows,
  parseFiltrosWorkflowsParams,
  PARAM,
} from "@/lib/ui/filtros-workflows";
import type { WorkflowEstado, WorkflowResumen } from "@/types/entities";

let contador = 0;

function item(over: {
  nombre: string;
  estado: WorkflowEstado;
  totalRuns?: number;
  ultimaEdicion?: Date;
  createdAt?: Date;
}): WorkflowResumen {
  contador += 1;
  return {
    workflow: {
      id: `w-${contador}`,
      nombre: over.nombre,
      descripcion: null,
      activo: over.estado === "activo",
      created_at: over.createdAt ?? new Date(2024, 0, contador),
    },
    estado: over.estado,
    tieneVersionBorrador: false,
    versionPublicada: over.estado === "borrador" ? null : 1,
    resumenPasos: [],
    metricas: { totalRuns: over.totalRuns ?? 0, runsExitosos: 0, ultimoRun: null },
    ultimaEdicion: over.ultimaEdicion ?? over.createdAt ?? new Date(2024, 0, contador),
  };
}

describe("filtrarYOrdenarWorkflows", () => {
  it("busqueda filtra por nombre, sin distinguir mayúsculas, sin tocar el resto", () => {
    const items = [
      item({ nombre: "Bienvenida automática", estado: "activo" }),
      item({ nombre: "Seguimiento de cotización", estado: "activo" }),
    ];

    const r = filtrarYOrdenarWorkflows(items, { busqueda: "BIENVENIDA" });

    expect(r.map((i) => i.workflow.nombre)).toEqual(["Bienvenida automática"]);
  });

  it("estado filtra exacto; 'todos' no filtra nada", () => {
    const items = [
      item({ nombre: "A", estado: "activo" }),
      item({ nombre: "B", estado: "pausado" }),
    ];

    expect(
      filtrarYOrdenarWorkflows(items, { estado: "pausado" }).map((i) => i.workflow.nombre),
    ).toEqual(["B"]);
    expect(filtrarYOrdenarWorkflows(items, { estado: "todos" })).toHaveLength(2);
  });

  it("ordenar 'nombre' es alfabético", () => {
    const items = [
      item({ nombre: "Zebra", estado: "activo" }),
      item({ nombre: "Alfa", estado: "activo" }),
    ];

    expect(
      filtrarYOrdenarWorkflows(items, { ordenar: "nombre" }).map((i) => i.workflow.nombre),
    ).toEqual(["Alfa", "Zebra"]);
  });

  it("ordenar 'runs' pone primero el que más corrió", () => {
    const items = [
      item({ nombre: "Pocos runs", estado: "activo", totalRuns: 3 }),
      item({ nombre: "Muchos runs", estado: "activo", totalRuns: 100 }),
    ];

    expect(
      filtrarYOrdenarWorkflows(items, { ordenar: "runs" }).map((i) => i.workflow.nombre),
    ).toEqual(["Muchos runs", "Pocos runs"]);
  });

  it("ordenar 'reciente' usa la fecha de creación del workflow", () => {
    const items = [
      item({ nombre: "Viejo", estado: "activo", createdAt: new Date(2020, 0, 1) }),
      item({ nombre: "Nuevo", estado: "activo", createdAt: new Date(2024, 0, 1) }),
    ];

    expect(
      filtrarYOrdenarWorkflows(items, { ordenar: "reciente" }).map((i) => i.workflow.nombre),
    ).toEqual(["Nuevo", "Viejo"]);
  });

  it("default ('editado') usa ultimaEdicion, más nuevo primero", () => {
    const items = [
      item({ nombre: "Editado hace rato", estado: "activo", ultimaEdicion: new Date(2024, 0, 1) }),
      item({ nombre: "Recién tocado", estado: "activo", ultimaEdicion: new Date(2024, 5, 1) }),
    ];

    expect(filtrarYOrdenarWorkflows(items, {}).map((i) => i.workflow.nombre)).toEqual([
      "Recién tocado",
      "Editado hace rato",
    ]);
  });
});

describe("parseFiltrosWorkflowsParams", () => {
  it("sin params, todo queda undefined", () => {
    expect(parseFiltrosWorkflowsParams({})).toEqual({
      busqueda: undefined,
      estado: undefined,
      ordenar: undefined,
    });
  });

  it("lee los tres params conocidos", () => {
    const r = parseFiltrosWorkflowsParams({
      [PARAM.busqueda]: "cotizacion",
      [PARAM.estado]: "pausado",
      [PARAM.ordenar]: "nombre",
    });

    expect(r).toEqual({ busqueda: "cotizacion", estado: "pausado", ordenar: "nombre" });
  });

  it("un estado u orden que no existe se descarta en vez de romper la pantalla", () => {
    const r = parseFiltrosWorkflowsParams({
      [PARAM.estado]: "no-existe",
      [PARAM.ordenar]: "no-existe",
    });

    expect(r.estado).toBeUndefined();
    expect(r.ordenar).toBeUndefined();
  });

  it("un param repetido (array) se trata como ausente", () => {
    const r = parseFiltrosWorkflowsParams({ [PARAM.busqueda]: ["a", "b"] });
    expect(r.busqueda).toBeUndefined();
  });
});
