import { afterEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import { useCerrarAlSalir } from "@/hooks/use-cerrar-al-salir";
import type { ReactNode } from "react";

/**
 * Un popover que puede contener otro. Espeja la forma real de los dos que
 * comparten pantalla en el Inbox: el buscador de conversaciones envuelve al
 * `SelectorBuscable` de etiquetas, y los dos usan el mismo hook.
 */
function Popover({
  abierto,
  cerrar,
  children,
}: {
  abierto: boolean;
  cerrar: () => void;
  children?: ReactNode;
}) {
  const contenedor = useRef<HTMLDivElement>(null);
  useCerrarAlSalir(abierto, contenedor, cerrar);
  return <div ref={contenedor}>{abierto ? <div>{children}</div> : null}</div>;
}

function escape() {
  act(() => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
}

afterEach(cleanup);

describe("useCerrarAlSalir con popovers anidados", () => {
  test("el primer Escape cierra solo el de adentro", () => {
    const cerrarFuera = vi.fn();
    const cerrarDentro = vi.fn();

    render(
      <Popover abierto cerrar={cerrarFuera}>
        <Popover abierto cerrar={cerrarDentro} />
      </Popover>,
    );

    escape();

    expect(cerrarDentro).toHaveBeenCalledTimes(1);
    expect(cerrarFuera).not.toHaveBeenCalled();
  });

  test("cerrado el de adentro, el siguiente Escape cierra el de afuera", () => {
    const cerrarFuera = vi.fn();
    const cerrarDentro = vi.fn();

    const { rerender } = render(
      <Popover abierto cerrar={cerrarFuera}>
        <Popover abierto cerrar={cerrarDentro} />
      </Popover>,
    );

    escape();
    // El componente de adentro reacciona a su `cerrar` cerrándose: es lo que
    // hace el estado real, y es lo que desengancha su listener.
    rerender(
      <Popover abierto cerrar={cerrarFuera}>
        <Popover abierto={false} cerrar={cerrarDentro} />
      </Popover>,
    );
    escape();

    expect(cerrarFuera).toHaveBeenCalledTimes(1);
    expect(cerrarDentro).toHaveBeenCalledTimes(1);
  });

  test("uno solo abierto cierra con el primer Escape, sin esperar a nadie", () => {
    const cerrar = vi.fn();
    render(<Popover abierto cerrar={cerrar} />);

    escape();

    expect(cerrar).toHaveBeenCalledTimes(1);
  });

  test("el anidado cerrado no le frena el Escape al de afuera", () => {
    const cerrarFuera = vi.fn();
    const cerrarDentro = vi.fn();

    render(
      <Popover abierto cerrar={cerrarFuera}>
        <Popover abierto={false} cerrar={cerrarDentro} />
      </Popover>,
    );

    escape();

    expect(cerrarFuera).toHaveBeenCalledTimes(1);
    expect(cerrarDentro).not.toHaveBeenCalled();
  });

  test("desmontar el anidado lo saca del registro y no deja al de afuera trabado", () => {
    const cerrarFuera = vi.fn();
    const cerrarDentro = vi.fn();

    const { rerender } = render(
      <Popover abierto cerrar={cerrarFuera}>
        <Popover abierto cerrar={cerrarDentro} />
      </Popover>,
    );
    rerender(<Popover abierto cerrar={cerrarFuera} />);

    escape();

    expect(cerrarFuera).toHaveBeenCalledTimes(1);
    expect(cerrarDentro).not.toHaveBeenCalled();
  });

  test("dos popovers sin relación de anidamiento no se estorban", () => {
    // No es una pantalla real —clickear afuera cierra el primero antes de que
    // el segundo abra— pero el registro es global y no puede volverse un
    // candado entre popovers de ramas distintas.
    const cerrarA = vi.fn();
    const cerrarB = vi.fn();

    render(
      <>
        <Popover abierto cerrar={cerrarA} />
        <Popover abierto cerrar={cerrarB} />
      </>,
    );

    escape();

    expect(cerrarA).toHaveBeenCalledTimes(1);
    expect(cerrarB).toHaveBeenCalledTimes(1);
  });

  test("el click adentro del anidado no cierra ninguno de los dos", () => {
    const cerrarFuera = vi.fn();
    const cerrarDentro = vi.fn();

    const { getByText } = render(
      <Popover abierto cerrar={cerrarFuera}>
        <Popover abierto cerrar={cerrarDentro}>
          <span>adentro del todo</span>
        </Popover>
      </Popover>,
    );

    act(() => {
      getByText("adentro del todo").dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true }),
      );
    });

    expect(cerrarFuera).not.toHaveBeenCalled();
    expect(cerrarDentro).not.toHaveBeenCalled();
  });
});
