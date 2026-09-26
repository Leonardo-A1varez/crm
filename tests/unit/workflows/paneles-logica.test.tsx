import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { camposDeCondicion } from "@/app/(panel)/workflows/[id]/_lib/campos-condicion";
import { presentacionDe } from "@/app/(panel)/workflows/[id]/_lib/presentacion-nodos";
import { ConfigLogica } from "@/components/workflows/canvas/config";
import { CAMPOS_SWITCH } from "@/lib/workflows/condiciones";
import { revisarConfig } from "@/lib/workflows/config-nodos";
import { ID_DE_CASO, type Nodo } from "@/types/workflows";

/**
 * Los paneles de "Según el valor" e "Ir a", y cómo se dibuja un switch en el
 * lienzo. El motor y el validador tienen sus propios archivos.
 */

afterEach(cleanup);

const CATALOGOS = { intents: [{ id: "int-1", nombre: "Pide precio" }], etiquetas: [] };
const CAMPOS_SWITCH_UI = camposDeCondicion(CATALOGOS).filter((c) =>
  (CAMPOS_SWITCH as readonly string[]).includes(c.id),
);

function Panel({
  tipo,
  inicial,
  onConfig,
}: {
  tipo: string;
  inicial: Record<string, unknown>;
  onConfig: (c: Record<string, unknown>) => void;
}) {
  const [config, setConfig] = useState(inicial);
  return (
    <ConfigLogica
      tipo={tipo}
      config={config}
      onChange={(c) => {
        setConfig(c);
        onConfig(c);
      }}
      camposSwitch={CAMPOS_SWITCH_UI}
      pasos={[
        { id: "n2", nombre: "Enviar mensaje" },
        { id: "n3", nombre: "Enviar mensaje" },
        { id: "n4", nombre: "Detener" },
      ]}
    />
  );
}

describe("panel de «Según el valor»", () => {
  it("un caso nuevo nace con un id que cabe en un puerto, y lo escrito pasa la config", () => {
    let ultima: Record<string, unknown> = {};
    render(
      <Panel
        tipo="logica_switch"
        inicial={{ campo: "lead.nombre" }}
        onConfig={(c) => (ultima = c)}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Agregar caso" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Valor del caso 1" }), {
      target: { value: "Ana" },
    });
    const casos = ultima["casos"] as { id: string; valor: string }[];
    expect(casos).toHaveLength(1);
    expect(casos[0]!.id).toMatch(ID_DE_CASO);
    expect(revisarConfig({ tipo: "logica_switch", config: ultima })!.errores).toEqual([]);
  });

  it("sólo ofrece los campos que se comparan por igualdad", async () => {
    render(<Panel tipo="logica_switch" inicial={{}} onConfig={() => {}} />);
    fireEvent.mouseDown(screen.getByRole("combobox"));
    const opciones = (await screen.findAllByRole("option")).map((o) => o.textContent);
    expect(opciones).toContain("Sesión · Intent detectado");
    expect(opciones).not.toContain("Sesión · Precio cotizado");
  });

  it("quitar un caso tiene nombre accesible con su valor", () => {
    render(
      <Panel
        tipo="logica_switch"
        inicial={{ campo: "lead.nombre", casos: [{ id: "a", valor: "Ana" }] }}
        onConfig={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "Quitar el caso «Ana»" })).toBeTruthy();
  });
});

describe("panel de «Ir a»", () => {
  it("ofrece los pasos por nombre, con el id sólo cuando dos se llaman igual", async () => {
    render(<Panel tipo="logica_goto" inicial={{}} onConfig={() => {}} />);
    fireEvent.mouseDown(screen.getByRole("combobox"));
    expect((await screen.findAllByRole("option")).map((o) => o.textContent)).toEqual([
      "Enviar mensaje (n2)",
      "Enviar mensaje (n3)",
      "Detener",
    ]);
  });

  it("avisa si el paso al que saltaba ya no está", () => {
    render(<Panel tipo="logica_goto" inicial={{ nodoDestino: "borrado" }} onConfig={() => {}} />);
    expect(screen.getByRole("alert").textContent).toContain("ya no está en el flujo");
  });
});

describe("«Según el valor» en el lienzo", () => {
  const nodo: Nodo = {
    id: "s",
    tipo: "logica_switch",
    config: {
      campo: "sesion.intent",
      casos: [
        { id: "a", valor: "int-1" },
        { id: "b", valor: "otro-id" },
      ],
    },
    posicion: { x: 0, y: 0 },
  };

  it("una salida por caso, rotulada con el nombre de la opción, y «Otro» al final", () => {
    expect(presentacionDe(nodo, CATALOGOS).salidas).toEqual([
      { id: "caso:a", label: "Pide precio" },
      { id: "caso:b", label: "otro-id" },
      { id: "otro", label: "Otro" },
    ]);
  });

  it("el resumen dice qué campo mira", () => {
    expect(presentacionDe(nodo, CATALOGOS).resumen).toBe("Según intent detectado");
  });
});
