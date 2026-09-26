import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { EditorConVariables } from "@/components/workflows/canvas/config/EditorConVariables";

/**
 * El campo de texto con variables como chips (nota 01 del diseño). Lo que
 * importa acá es el contrato con lo guardado: un mensaje viejo se abre con sus
 * variables como chips, lo editado sale en el formato del motor, y las llaves
 * dobles escritas a mano no se convierten en variable.
 */

afterEach(cleanup);

function campo(): HTMLElement {
  return screen.getByRole("textbox", { name: "Mensaje" });
}

describe("EditorConVariables", () => {
  it("un mensaje viejo con {{lead.nombre}} se abre con la variable como chip", () => {
    render(
      <EditorConVariables etiqueta="Mensaje" value="Hola {{lead.nombre}}!" onChange={() => {}} />,
    );
    const chip = campo().querySelector("[data-variable]");
    expect(chip?.getAttribute("data-variable")).toBe("lead.nombre");
    expect(chip?.textContent).toBe("nombre");
    expect(chip?.getAttribute("contenteditable")).toBe("false");
    // El texto a los costados queda como texto: ni una llave a la vista.
    expect(campo().textContent).toBe("Hola nombre!");
  });

  it("una variable que el motor no carga se ve como chip marcado, y se conserva", () => {
    const onChange = vi.fn();
    render(
      <EditorConVariables etiqueta="Mensaje" value="{{lead.vehiculo}} ok" onChange={onChange} />,
    );
    const chip = campo().querySelector("[data-variable='lead.vehiculo']");
    expect(chip?.getAttribute("aria-label")).toContain("no la carga");
    fireEvent.input(campo());
    expect(onChange).toHaveBeenLastCalledWith("{{lead.vehiculo}} ok");
  });

  it("lo que se edita sale en el formato del motor, con saltos de línea", () => {
    const onChange = vi.fn();
    render(
      <EditorConVariables etiqueta="Mensaje" value="Hola {{lead.nombre}}" onChange={onChange} />,
    );
    campo().append(document.createElement("br"), document.createTextNode("chau"));
    fireEvent.input(campo());
    expect(onChange).toHaveBeenLastCalledWith("Hola {{lead.nombre}}\nchau");
  });

  it("llaves dobles escritas a mano no se guardan como variable", () => {
    const onChange = vi.fn();
    render(<EditorConVariables etiqueta="Mensaje" value="" onChange={onChange} />);
    campo().append(document.createTextNode("Hola {{lead.nombre}}"));
    fireEvent.input(campo());
    expect(onChange).toHaveBeenLastCalledWith("Hola {lead.nombre}");
    expect(campo().querySelector("[data-variable]")).toBeNull();
  });

  it("«+ Variable» inserta la variable elegida como chip y la guarda en el formato del motor", async () => {
    const onChange = vi.fn();
    render(<EditorConVariables etiqueta="Mensaje" value="Hola " onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /Insertar una variable/ }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Nombre del lead/ }));
    expect(onChange).toHaveBeenLastCalledWith("Hola {{lead.nombre}}");
    expect(campo().querySelector("[data-variable='lead.nombre']")).not.toBeNull();
  });

  it("montar no escribe nada: sólo lo que la persona cambia sale por onChange", () => {
    const onChange = vi.fn();
    render(
      <EditorConVariables etiqueta="Mensaje" value="Hola {{lead.nombre}}" onChange={onChange} />,
    );
    expect(onChange).not.toHaveBeenCalled();
  });

  it("en sólo lectura no se puede editar ni insertar", () => {
    render(<EditorConVariables etiqueta="Mensaje" value="Hola" onChange={() => {}} readonly />);
    expect(campo().getAttribute("contenteditable")).toBe("false");
    expect(screen.queryByRole("button", { name: /Insertar una variable/ })).toBeNull();
  });

  it("con otro catálogo ofrece sólo esas variables y marca las demás como que no se cargan", async () => {
    const catalogo = {
      grupos: [
        {
          id: "lead",
          nombre: "Lead",
          variables: [
            { key: "lead.vehiculo_modelo", label: "Modelo del vehículo", corto: "modelo" },
          ],
        },
      ],
    };
    const onChange = vi.fn();
    render(
      <EditorConVariables
        etiqueta="Mensaje"
        value="Hola {{lead.email}} "
        onChange={onChange}
        catalogo={catalogo}
      />,
    );
    // `lead.email` es del motor de workflows, no de este catálogo.
    const ajena = campo().querySelector("[data-variable='lead.email']");
    expect(ajena?.getAttribute("aria-label")).toContain("no la carga");

    fireEvent.click(screen.getByRole("button", { name: /Insertar una variable/ }));
    expect(screen.queryByRole("menuitem", { name: /Nombre del lead/ })).toBeNull();
    fireEvent.click(await screen.findByRole("menuitem", { name: /Modelo del vehículo/ }));
    expect(onChange).toHaveBeenLastCalledWith("Hola {{lead.email}} {{lead.vehiculo_modelo}}");
  });
});
