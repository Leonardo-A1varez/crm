import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EmpresaErpDelUsuario } from "@/components/ajustes/EmpresaErpDelUsuario";
import { UsuariosYRoles } from "@/components/ajustes/UsuariosYRoles";
import { AvisoSincronizacionErp } from "@/components/productos/AvisoSincronizacionErp";

afterEach(cleanup);

const AHORA = "2026-10-05T12:00:00.000Z";
const haceMin = (m: number) => new Date(new Date(AHORA).getTime() - m * 60_000).toISOString();

describe("AvisoSincronizacionErp", () => {
  it("dice hace cuántos minutos se actualizó", () => {
    render(
      <AvisoSincronizacionErp
        estado={{ ultimoExito: haceMin(7), huboError: false, ahora: AHORA }}
      />,
    );
    const aviso = screen.getByRole("status");
    expect(aviso.textContent).toBe("Actualizado hace 7 min");
    expect(aviso.getAttribute("data-nivel")).toBe("ok");
  });

  it("pasados 30 minutos avisa que está atrasado", () => {
    render(
      <AvisoSincronizacionErp
        estado={{ ultimoExito: haceMin(45), huboError: false, ahora: AHORA }}
      />,
    );
    const aviso = screen.getByRole("status");
    expect(aviso.getAttribute("data-nivel")).toBe("atrasado");
    expect(aviso.textContent).toContain("atrasado");
  });

  it("si la última corrida falló lo dice, sin importar cuándo fue la buena", () => {
    render(
      <AvisoSincronizacionErp
        estado={{ ultimoExito: haceMin(2), huboError: true, ahora: AHORA }}
      />,
    );
    const aviso = screen.getByRole("status");
    expect(aviso.getAttribute("data-nivel")).toBe("error");
    expect(aviso.textContent).toContain("Falló la última sincronización");
  });

  it("sin ninguna corrida lo dice en vez de inventar una hora", () => {
    render(
      <AvisoSincronizacionErp estado={{ ultimoExito: null, huboError: false, ahora: AHORA }} />,
    );
    expect(screen.getByRole("status").textContent).toBe("Sin sincronización con el ERP todavía");
  });
});

describe("EmpresaErpDelUsuario", () => {
  it("sin acción es solo lectura y muestra el nombre de la empresa", () => {
    render(<EmpresaErpDelUsuario usuarioId="u1" nombre="Ana" empresaErp={5} asignar={null} />);
    expect(screen.getByText("Koreanos SAS")).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("sin empresa dice 'Sin empresa'", () => {
    render(<EmpresaErpDelUsuario usuarioId="u1" nombre="Ana" empresaErp={null} asignar={null} />);
    expect(screen.getByText("Sin empresa")).toBeTruthy();
  });

  it("con acción ofrece el selector con el nombre accesible del usuario", () => {
    render(
      <EmpresaErpDelUsuario
        usuarioId="u1"
        nombre="Ana"
        empresaErp={3}
        asignar={vi.fn(async () => ({ ok: true as const }))}
      />,
    );
    expect(screen.getByRole("combobox", { name: "Empresa del ERP de Ana" })).toBeTruthy();
  });
});

describe("UsuariosYRoles con empresa del ERP", () => {
  const usuarios = [
    {
      id: "u1",
      nombre: "Ana de Prueba",
      email: "ana@crm.local",
      rol: "vendedor" as const,
      activo: true,
      ultimoAcceso: { estado: "sin-dato" as const },
      empresaErp: 6,
    },
  ];

  it("un admin ve el selector; sin acción se ve el nombre", async () => {
    const { rerender } = render(
      <UsuariosYRoles
        usuarios={usuarios}
        asignarEmpresa={vi.fn(async () => ({ ok: true as const }))}
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByRole("combobox", { name: "Empresa del ERP de Ana de Prueba" }),
      ).toBeTruthy(),
    );
    rerender(<UsuariosYRoles usuarios={usuarios} asignarEmpresa={null} />);
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByText("SAS Repuestos")).toBeTruthy();
  });
});
