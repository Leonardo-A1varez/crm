import { describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { WorkflowCard } from "@/components/workflows/WorkflowCard";
import type { WorkflowEstado, WorkflowResumen } from "@/types/entities";

function item(over: Partial<WorkflowResumen> & { estado: WorkflowEstado }): WorkflowResumen {
  return {
    workflow: {
      id: "w-1",
      nombre: "Bienvenida automática",
      descripcion: null,
      activo: over.estado === "activo",
      created_at: new Date(),
    },
    tieneVersionBorrador: false,
    versionPublicada: over.estado === "borrador" ? null : 1,
    resumenPasos: ["Llega un mensaje", "Clasificar", "Responder"],
    metricas: {
      totalRuns: 1234,
      runsExitosos: 1209,
      ultimoRun: { at: new Date(), exito: true, duracionMs: 500 },
    },
    ultimaEdicion: new Date(),
    ...over,
  };
}

function noop() {}

describe("WorkflowCard", () => {
  test.each<WorkflowEstado>(["activo", "borrador", "pausado", "error"])(
    "renderiza el estado '%s'",
    (estado) => {
      render(
        <ul>
          <WorkflowCard
            item={item({ estado })}
            puedeEditar={false}
            onDuplicar={noop}
            onPausar={noop}
            onReanudar={noop}
            onEliminar={noop}
          />
        </ul>,
      );

      const etiqueta = {
        activo: "Activo",
        borrador: "Borrador",
        pausado: "Pausado",
        error: "Error",
      }[estado];
      expect(screen.getByText(etiqueta)).toBeTruthy();
    },
  );

  test("muestra nombre, resumen de pasos y métricas", () => {
    render(
      <ul>
        <WorkflowCard
          item={item({ estado: "activo" })}
          puedeEditar={false}
          onDuplicar={noop}
          onPausar={noop}
          onReanudar={noop}
          onEliminar={noop}
        />
      </ul>,
    );

    expect(screen.getByText("Bienvenida automática")).toBeTruthy();
    expect(screen.getByText("Llega un mensaje → Clasificar → Responder")).toBeTruthy();
    expect(screen.getByText("1.234 runs")).toBeTruthy();
    // 1209/1234 = 97.97...% -> redondea a 98%.
    expect(screen.getByText("98% ok")).toBeTruthy();
  });

  test("el badge BORRADOR sólo aparece si tieneVersionBorrador", () => {
    const { rerender } = render(
      <ul>
        <WorkflowCard
          item={item({ estado: "activo", tieneVersionBorrador: false })}
          puedeEditar={false}
          onDuplicar={noop}
          onPausar={noop}
          onReanudar={noop}
          onEliminar={noop}
        />
      </ul>,
    );
    expect(screen.queryByText("BORRADOR")).toBeNull();

    rerender(
      <ul>
        <WorkflowCard
          item={item({ estado: "activo", tieneVersionBorrador: true })}
          puedeEditar={false}
          onDuplicar={noop}
          onPausar={noop}
          onReanudar={noop}
          onEliminar={noop}
        />
      </ul>,
    );
    expect(screen.getByText("BORRADOR")).toBeTruthy();
  });

  test("la card entera es un link al editor del workflow", () => {
    render(
      <ul>
        <WorkflowCard
          item={item({ estado: "activo" })}
          puedeEditar={false}
          onDuplicar={noop}
          onPausar={noop}
          onReanudar={noop}
          onEliminar={noop}
        />
      </ul>,
    );

    const link = screen.getByText("Bienvenida automática").closest("a");
    expect(link?.getAttribute("href")).toBe("/workflows/w-1");
  });

  test("sin puedeEditar, no hay menú de acciones", () => {
    render(
      <ul>
        <WorkflowCard
          item={item({ estado: "activo" })}
          puedeEditar={false}
          onDuplicar={noop}
          onPausar={noop}
          onReanudar={noop}
          onEliminar={noop}
        />
      </ul>,
    );

    expect(screen.queryByLabelText("Acciones del flujo")).toBeNull();
  });

  test("el menú duplica, pausa/reanuda según activo, y eliminar pide confirmar", () => {
    const onDuplicar = vi.fn();
    const onPausar = vi.fn();
    const onReanudar = vi.fn();
    const onEliminar = vi.fn();

    render(
      <ul>
        <WorkflowCard
          item={item({ estado: "activo" })}
          puedeEditar
          onDuplicar={onDuplicar}
          onPausar={onPausar}
          onReanudar={onReanudar}
          onEliminar={onEliminar}
        />
      </ul>,
    );

    fireEvent.click(screen.getByLabelText("Acciones del flujo"));
    fireEvent.click(screen.getByText("Duplicar"));
    expect(onDuplicar).toHaveBeenCalledWith("w-1");

    fireEvent.click(screen.getByLabelText("Acciones del flujo"));
    fireEvent.click(screen.getByText("Pausar"));
    expect(onPausar).toHaveBeenCalledWith("w-1");
    expect(onReanudar).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText("Acciones del flujo"));
    // Primer click en "Eliminar" pide confirmación, no dispara todavía.
    fireEvent.click(screen.getByText("Eliminar"));
    expect(onEliminar).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Confirmar borrado"));
    expect(onEliminar).toHaveBeenCalledWith("w-1");
  });

  test("con el workflow apagado, el menú ofrece 'Reanudar' en vez de 'Pausar'", () => {
    render(
      <ul>
        <WorkflowCard
          item={item({ estado: "pausado" })}
          puedeEditar
          onDuplicar={noop}
          onPausar={noop}
          onReanudar={vi.fn()}
          onEliminar={noop}
        />
      </ul>,
    );

    fireEvent.click(screen.getByLabelText("Acciones del flujo"));
    expect(screen.getByText("Reanudar")).toBeTruthy();
    expect(screen.queryByText("Pausar")).toBeNull();
  });
});
