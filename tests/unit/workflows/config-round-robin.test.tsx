import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ConfigCRM } from "@/components/workflows/canvas/config";
import { ESPEC_CONFIG_POR_TIPO, revisarConfig } from "@/lib/workflows/config-nodos";
import type { ConfigRoundRobin } from "@/server/services/asignacion/asignacion.service";

/**
 * El tope del round robin, del campo del panel al servicio de asignación: lo
 * que escribe el formulario es lo que el contrato parsea y lo que recibe
 * `asignarPorRoundRobin`. La unidad la decidió el dueño: sesiones abiertas a
 * la vez por vendedor.
 */

type Config = Record<string, unknown>;

function montar(inicial: Config = { candidatos: ["u1"] }): () => Config {
  let ultima: Config = inicial;
  function Formulario() {
    const [config, setConfig] = useState<Config>(inicial);
    return (
      <ConfigCRM
        tipo="crm_round_robin"
        config={config}
        onChange={(siguiente) => {
          ultima = siguiente;
          setConfig(siguiente);
        }}
        tags={[]}
        etapas={[]}
        vendedores={[{ id: "u1", nombre: "Ana" }]}
      />
    );
  }
  render(<Formulario />);
  return () => ultima;
}

/** Lo que recibe el servicio, armado igual que lo va a armar el handler. */
function paraElServicio(config: Config): ConfigRoundRobin {
  const c = ESPEC_CONFIG_POR_TIPO.crm_round_robin.schema.parse(config);
  return { candidatos: c.candidatos, tope: c.topeSesionesAbiertasPorVendedor };
}

afterEach(cleanup);

describe("round robin: el tope de sesiones abiertas en el panel", () => {
  it("el campo dice que cuenta sesiones abiertas a la vez, y vacío es sin tope", () => {
    montar();
    const campo = screen.getByRole("spinbutton", { name: /tope de sesiones abiertas/i });
    expect(campo).toHaveProperty("value", "");
    expect(campo.getAttribute("min")).toBe("1");
    const ayuda = document.getElementById(campo.getAttribute("aria-describedby") ?? "");
    expect(ayuda?.textContent).toMatch(/a la vez/);
    expect(ayuda?.textContent).toMatch(/vacío.*sin tope/i);
  });

  it("un número llega al servicio como tope", () => {
    const config = montar();
    const campo = screen.getByRole("spinbutton", { name: /tope de sesiones abiertas/i });
    fireEvent.change(campo, { target: { value: "3" } });
    expect(config()).toEqual({ candidatos: ["u1"], topeSesionesAbiertasPorVendedor: 3 });
    expect(paraElServicio(config())).toEqual({ candidatos: ["u1"], tope: 3 });
  });

  it("borrar el número vuelve a «sin tope»", () => {
    const config = montar({ candidatos: ["u1"], topeSesionesAbiertasPorVendedor: 2 });
    const campo = screen.getByRole("spinbutton", { name: /tope de sesiones abiertas/i });
    expect(campo).toHaveProperty("value", "2");
    fireEvent.change(campo, { target: { value: "" } });
    expect(paraElServicio(config())).toEqual({ candidatos: ["u1"], tope: null });
  });

  it("un tope menor que 1 queda en la config y el validador lo marca", () => {
    const config = montar();
    const campo = screen.getByRole("spinbutton", { name: /tope de sesiones abiertas/i });
    fireEvent.change(campo, { target: { value: "0" } });
    expect(revisarConfig({ tipo: "crm_round_robin", config: config() })?.errores).toEqual([
      "El tope de sesiones abiertas por vendedor tiene que ser un entero mayor que cero",
    ]);
  });
});
