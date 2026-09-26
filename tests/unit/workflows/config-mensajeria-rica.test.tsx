import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ConfigMensajeria } from "@/components/workflows/canvas/config";
import { revisarConfig } from "@/lib/workflows/config-nodos";
import { puertosDeNodo } from "@/lib/workflows/validar-grafo";
import type { NodoTipo } from "@/types/workflows";

/**
 * Los formularios de botones, lista, imagen y ubicación: lo que escriben es lo
 * que el contrato valida (`revisarConfig`) y lo que dibuja las salidas.
 */

type Config = Record<string, unknown>;

function montar(
  tipo: NodoTipo,
  inicial: Config = {},
  onSubirImagen?: (
    f: FormData,
  ) => Promise<{ ok: true; ruta: string } | { ok: false; error: string }>,
): () => Config {
  let ultima: Config = inicial;
  function Formulario() {
    const [config, setConfig] = useState<Config>(inicial);
    return (
      <ConfigMensajeria
        tipo={tipo}
        config={config}
        onChange={(siguiente) => {
          ultima = siguiente;
          setConfig(siguiente);
        }}
        onSubirImagen={onSubirImagen}
      />
    );
  }
  render(<Formulario />);
  return () => ultima;
}

afterEach(cleanup);

describe("Mensaje con botones", () => {
  it("cada botón nuevo nace con id propio y es una salida del bloque", () => {
    const config = montar("msg_botones", { mensaje: "¿Te lo reservo?" });
    fireEvent.click(screen.getByRole("button", { name: /agregar botón/i }));
    fireEvent.click(screen.getByRole("button", { name: /agregar botón/i }));
    const campos = screen.getAllByRole("textbox", { name: /texto del botón/i });
    fireEvent.change(campos[0]!, { target: { value: "Sí" } });
    fireEvent.change(campos[1]!, { target: { value: "No" } });

    expect(config().botones).toEqual([
      { id: "op1", texto: "Sí" },
      { id: "op2", texto: "No" },
    ]);
    expect(revisarConfig({ tipo: "msg_botones", config: config() })?.errores).toEqual([]);
    expect(puertosDeNodo({ tipo: "msg_botones", config: config() })).toEqual([
      "opcion:op1",
      "opcion:op2",
      "sin_respuesta",
    ]);
  });

  it("no deja agregar un cuarto botón", () => {
    montar("msg_botones", {
      botones: [1, 2, 3].map((n) => ({ id: `op${n}`, texto: `B${n}` })),
    });
    expect(
      (screen.getByRole("button", { name: /agregar botón/i }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("el tiempo máximo se edita y cuenta en la unidad elegida", () => {
    const config = montar("msg_botones");
    const campo = screen.getByRole("spinbutton", { name: /esperar la respuesta/i });
    fireEvent.change(campo, { target: { value: "3" } });
    expect(config().timeout).toBe(3);
  });
});

describe("Mensaje de lista", () => {
  it("agregar una opción a una sección le da id y la cuenta como salida", () => {
    const config = montar("msg_lista", { body: "¿Qué buscás?" });
    fireEvent.click(screen.getByRole("button", { name: /agregar sección/i }));
    const titulo = screen.getByRole("textbox", { name: /título de la opción 1/i });
    fireEvent.change(titulo, { target: { value: "Filtro" } });
    expect(config().secciones).toEqual([
      { titulo: "", items: [{ id: "op1", titulo: "Filtro", descripcion: "" }] },
    ]);
    expect(revisarConfig({ tipo: "msg_lista", config: config() })?.errores).toEqual([]);
  });
});

describe("Enviar imagen", () => {
  it("subir un archivo guarda la ruta que devuelve el servidor", async () => {
    const subir = vi.fn(async () => ({
      ok: true as const,
      ruta: "flujos/0f8fad5b-d9cb-469f-a165-70867728950e.jpg",
    }));
    const config = montar("msg_imagen", { tipoMedia: "archivo" }, subir);
    const input = screen.getByLabelText(/elegir imagen/i);
    const archivo = new File([new Uint8Array([0xff, 0xd8, 0xff])], "pieza.jpg", {
      type: "image/jpeg",
    });
    fireEvent.change(input, { target: { files: [archivo] } });
    await waitFor(() =>
      expect(config().archivo).toBe("flujos/0f8fad5b-d9cb-469f-a165-70867728950e.jpg"),
    );
    expect(subir).toHaveBeenCalledOnce();
    expect(revisarConfig({ tipo: "msg_imagen", config: config() })?.errores).toEqual([]);
  });

  it("un rechazo del servidor se muestra y no toca la config", async () => {
    const subir = vi.fn(async () => ({
      ok: false as const,
      error: "La imagen no puede pasar de 5 MB",
    }));
    const config = montar("msg_imagen", { tipoMedia: "archivo" }, subir);
    fireEvent.change(screen.getByLabelText(/elegir imagen/i), {
      target: { files: [new File(["x"], "a.png", { type: "image/png" })] },
    });
    expect(await screen.findByText(/5 MB/)).toBeTruthy();
    expect(config().archivo).toBeUndefined();
  });
});

describe("Enviar ubicación", () => {
  it("vaciar la latitud la borra en vez de guardar 0", () => {
    const config = montar("msg_ubicacion", { lat: 1, lon: 2 });
    fireEvent.change(screen.getByRole("spinbutton", { name: /latitud/i }), {
      target: { value: "" },
    });
    expect(config().lat).toBeUndefined();
    expect(revisarConfig({ tipo: "msg_ubicacion", config: config() })?.errores.join(" ")).toMatch(
      /latitud/i,
    );
  });
});
