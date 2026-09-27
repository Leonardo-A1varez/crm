import { describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  AvisoLectura,
  DatosEmpresa,
  EscaleraSanciones,
  HorarioAtencion,
  MedidorCupo,
  PanelSalud,
  TablaNumeros,
  TablaPlantillas,
  TopesSeguridad,
  UsuariosYRoles,
} from "@/components/ajustes";
import type {
  EscalonSancion,
  EstadoCupo,
  NumeroWhatsApp,
  PlantillaMeta,
} from "@/components/ajustes";

/** Fixtures sintéticos de la UI: ningún número ni nombre es un dato real. */
const PELDANOS = [
  { destinatariosPorDia: 250, etiqueta: "250" },
  { destinatariosPorDia: 2000, etiqueta: "2.000" },
  { destinatariosPorDia: null, etiqueta: "ilimitado" },
];

function cupo(parcial: Partial<EstadoCupo> = {}): EstadoCupo {
  return {
    peldanos: PELDANOS,
    actual: 1,
    calidad: { estado: "cumplida" },
    uso: { disponible: false, motivo: "motivo de prueba del uso" },
    minimoPct: 50,
    ventanaDias: 7,
    desbloqueo: null,
    ...parcial,
  };
}

const ESCALONES: EscalonSancion[] = [
  {
    id: "a",
    nombre: "Advertencia de prueba",
    consecuencia: "consecuencia a",
    duracion: "sin bloqueo",
    apelacion: null,
  },
  {
    id: "b",
    nombre: "Bloqueo de prueba",
    consecuencia: "consecuencia b",
    duracion: "1 o 3 días",
    apelacion: null,
  },
];

function plantilla(parcial: Partial<PlantillaMeta>): PlantillaMeta {
  return {
    id: "1",
    nombre: "plantilla_de_prueba",
    idioma: "es",
    categoria: "Utility",
    estado: "aprobada",
    nota: "nota de prueba",
    requiereDespausadoManual: false,
    escalonPausado: null,
    ...parcial,
  };
}

describe("MedidorCupo", () => {
  test("con el uso sin dato, la segunda condición lo dice y no dibuja una ventana inventada", () => {
    render(<MedidorCupo estado={cupo()} />);

    expect(screen.getAllByText("motivo de prueba del uso").length).toBeGreaterThan(0);
    expect(screen.getAllByText("sin dato").length).toBeGreaterThan(0);
    expect(screen.queryByText(/del cupo usado/)).toBeNull();
  });

  test("en el primer peldaño muestra las vías de desbloqueo en vez de las dos condiciones", () => {
    render(<MedidorCupo estado={cupo({ actual: 0, desbloqueo: ["vía uno", "vía dos"] })} />);

    expect(screen.getByText("vía uno")).toBeTruthy();
    expect(screen.getByText("vía dos")).toBeTruthy();
    expect(screen.queryByText(/hacen falta las dos condiciones/)).toBeNull();
  });

  test("con la calidad en falta, nombra lo que falta", () => {
    render(
      <MedidorCupo
        estado={cupo({ calidad: { estado: "falta", pendientes: ["+1 555 0101 (media)"] } })}
      />,
    );

    expect(screen.getAllByText(/\+1 555 0101 \(media\)/).length).toBeGreaterThan(0);
  });

  test("en el peldaño más alto no hay ascenso", () => {
    render(<MedidorCupo estado={cupo({ actual: 2 })} />);

    expect(screen.getByText(/No hay ascenso pendiente/)).toBeTruthy();
  });
});

describe("EscaleraSanciones", () => {
  test("sin poder leer el escalón, lo dice y no afirma que no haya sanciones", () => {
    render(
      <EscaleraSanciones
        escalones={ESCALONES}
        posicion={{ tipo: "no-disponible", motivo: "motivo de prueba" }}
        envio={{ estado: "disponible" }}
      />,
    );

    expect(screen.getByText("motivo de prueba")).toBeTruthy();
    expect(screen.queryByText("sin sanciones")).toBeNull();
    expect(screen.queryByText(/estás acá/)).toBeNull();
    expect(screen.getByText("consecuencia a")).toBeTruthy();
    expect(screen.getByText("consecuencia b")).toBeTruthy();
  });

  test("con el envío bloqueado, muestra lo que dice Meta", () => {
    render(
      <EscaleraSanciones
        escalones={ESCALONES}
        posicion={{ tipo: "no-disponible", motivo: "motivo de prueba" }}
        envio={{ estado: "bloqueado", detalle: "detalle de prueba" }}
      />,
    );

    expect(screen.getByText("Envío bloqueado")).toBeTruthy();
    expect(screen.getByText(/detalle de prueba/)).toBeTruthy();
  });

  test("en un escalón conocido, marca dónde está la cuenta", () => {
    render(
      <EscaleraSanciones
        escalones={ESCALONES}
        posicion={{ tipo: "en-escalon", indice: 0, desde: "12/08", inferido: null }}
        envio={{ estado: "disponible" }}
      />,
    );

    expect(screen.getByText(/estás acá · 12\/08/)).toBeTruthy();
  });

  test("si la consulta de ahora contradice el escalón, lo presenta como último aviso y dice por qué", () => {
    render(
      <EscaleraSanciones
        escalones={ESCALONES}
        posicion={{
          tipo: "en-escalon",
          indice: 1,
          desde: "26/09",
          inferido: null,
          contradicho: "explicación de prueba",
        }}
        envio={{ estado: "disponible" }}
      />,
    );

    expect(screen.queryByText(/estás acá/)).toBeNull();
    expect(screen.getByText(/último aviso · 26\/09/)).toBeTruthy();
    expect(screen.getByText("explicación de prueba")).toBeTruthy();
  });

  test("con el envío bloqueado no dibuja el chip verde de sin sanciones", () => {
    render(
      <EscaleraSanciones
        escalones={ESCALONES}
        posicion={{ tipo: "sin-sancion", observadoDesde: "1 sep" }}
        envio={{ estado: "bloqueado", detalle: "detalle de prueba" }}
      />,
    );

    expect(screen.queryByText("sin sanciones")).toBeNull();
  });
});

describe("TablaNumeros", () => {
  const NUMEROS: NumeroWhatsApp[] = [
    {
      id: "101",
      numero: "+1 555 0100",
      nombre: "Repuestos Uno",
      calidad: "alta",
      calidadCruda: "GREEN",
      envio: { estado: "disponible" },
      rol: "Casilla principal",
      esElConfigurado: true,
    },
    {
      id: "102",
      numero: "+1 555 0101",
      nombre: null,
      calidad: "sin-datos",
      calidadCruda: "NA",
      envio: { estado: "sin-dato", motivo: "motivo de envío de prueba" },
      rol: null,
      esElConfigurado: false,
    },
  ];

  test("marca el número del CRM y deja ver el valor crudo de Meta", () => {
    render(<TablaNumeros numeros={NUMEROS} nota="nota de prueba" guardarRol={null} />);

    expect(screen.getAllByText("este CRM")).toHaveLength(1);
    expect(screen.getByText("GREEN")).toBeTruthy();
    expect(screen.getByText("NA")).toBeTruthy();
    expect(screen.getByText("Puede enviar")).toBeTruthy();
    expect(screen.getByText("motivo de envío de prueba")).toBeTruthy();
    expect(screen.getByText("nota de prueba")).toBeTruthy();
  });

  test("muestra el rol, y sin permiso de edición no ofrece editarlo", () => {
    render(<TablaNumeros numeros={NUMEROS} nota={null} guardarRol={null} />);

    expect(screen.getByText("Casilla principal")).toBeTruthy();
    expect(screen.getByText("sin rol")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Editar el rol/ })).toBeNull();
  });

  test("un admin edita el rol en el lugar y se manda recortado al servidor", async () => {
    const guardarRol = vi.fn().mockResolvedValue({ ok: true });
    render(<TablaNumeros numeros={NUMEROS} nota={null} guardarRol={guardarRol} />);

    fireEvent.click(screen.getByRole("button", { name: "Editar el rol de +1 555 0101" }));
    const campo = screen.getByRole("textbox", { name: "Rol de +1 555 0101" });
    fireEvent.change(campo, { target: { value: "  Posventa " } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(guardarRol).toHaveBeenCalledWith({ phoneNumberId: "102", rol: "Posventa" }),
    );
  });

  test("si el servidor rechaza, el error queda a la vista y el campo sigue abierto", async () => {
    const guardarRol = vi.fn().mockResolvedValue({ ok: false, error: "error de prueba" });
    render(<TablaNumeros numeros={NUMEROS} nota={null} guardarRol={guardarRol} />);

    fireEvent.click(screen.getByRole("button", { name: "Editar el rol de +1 555 0100" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    expect((await screen.findByRole("alert")).textContent).toContain("error de prueba");
    expect(screen.getByRole("textbox", { name: "Rol de +1 555 0100" })).toBeTruthy();
  });

  test("Escape cancela sin llamar al servidor", () => {
    const guardarRol = vi.fn();
    render(<TablaNumeros numeros={NUMEROS} nota={null} guardarRol={guardarRol} />);

    fireEvent.click(screen.getByRole("button", { name: "Editar el rol de +1 555 0100" }));
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Rol de +1 555 0100" }), {
      key: "Escape",
    });

    expect(screen.queryByRole("textbox")).toBeNull();
    expect(guardarRol).not.toHaveBeenCalled();
  });
});

describe("TablaPlantillas", () => {
  test("las pausadas van primero", () => {
    render(
      <TablaPlantillas
        plantillas={[
          plantilla({ id: "1", nombre: "a_aprobada" }),
          plantilla({ id: "2", nombre: "b_pausada", estado: "pausada" }),
        ]}
        nota={null}
      />,
    );

    const nombres = screen.getAllByText(/^(a_aprobada|b_pausada)$/).map((el) => el.textContent);
    expect(nombres).toEqual(["b_pausada", "a_aprobada"]);
  });

  test("un estado sin traducción se muestra como Otro", () => {
    render(<TablaPlantillas plantillas={[plantilla({ estado: "otro" })]} nota={null} />);

    expect(screen.getByText("Otro")).toBeTruthy();
  });

  test("sin plantillas lo dice", () => {
    render(<TablaPlantillas plantillas={[]} nota={null} />);

    expect(screen.getByText(/no tiene plantillas/)).toBeTruthy();
  });

  test("no ofrece acciones: la pantalla sólo lee", () => {
    render(<TablaPlantillas plantillas={[plantilla({})]} nota={null} />);

    expect(screen.queryByText("acción")).toBeNull();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});

describe("DatosEmpresa", () => {
  test("sin fila en empresas lo dice y no ofrece campos editables", () => {
    const { container } = render(
      <DatosEmpresa datos={{ registro: null, zonaHoraria: "America/Argentina/Buenos_Aires" }} />,
    );

    expect(screen.getByText(/Todavía no hay datos de la empresa cargados/)).toBeTruthy();
    expect(screen.getByText("America/Argentina/Buenos_Aires")).toBeTruthy();
    expect(container.querySelectorAll("input")).toHaveLength(0);
  });

  test("con fila, muestra nombre e identificación fiscal", () => {
    render(
      <DatosEmpresa
        datos={{
          registro: { nombre: "Repuestos de Prueba", identificacionFiscal: "0000000000001" },
          zonaHoraria: null,
        }}
      />,
    );

    expect(screen.getByText("Repuestos de Prueba")).toBeTruthy();
    expect(screen.getByText("0000000000001")).toBeTruthy();
  });
});

describe("UsuariosYRoles", () => {
  test("sin dato del último acceso no dice «nunca entró»", () => {
    render(
      <UsuariosYRoles
        usuarios={[
          {
            id: "u1",
            nombre: "Usuaria de Prueba",
            email: "prueba@crm.local",
            rol: "admin",
            activo: true,
            ultimoAcceso: { estado: "sin-dato" },
          },
        ]}
      />,
    );

    expect(screen.getAllByText("sin dato")).toHaveLength(1);
    expect(screen.queryByText("nunca entró")).toBeNull();
    expect(screen.getByText(/El último acceso todavía no se muestra/)).toBeTruthy();
  });
});

describe("HorarioAtencion", () => {
  test("muestra los dos turnos de un día partido, los días cerrados y a dónde ir a editarlo", () => {
    const { container } = render(
      <HorarioAtencion
        franjas={[
          {
            dia: "Lunes",
            abreviatura: "LU",
            rangos: [
              { desde: "09:00", hasta: "13:00" },
              { desde: "15:00", hasta: "19:00" },
            ],
          },
          { dia: "Martes", abreviatura: "MA", rangos: [] },
        ]}
        zonaHoraria="America/Argentina/Buenos_Aires"
        fueraDeHorario="texto de prueba fuera de horario"
        editarEn={{ href: "/agente?tab=limites", texto: "Editar en Agente › Límites y costo" }}
      />,
    );

    expect(screen.getByText("09:00–13:00")).toBeTruthy();
    expect(screen.getByText("15:00–19:00")).toBeTruthy();
    expect(screen.getAllByText("cerrado").length).toBeGreaterThan(0);
    expect(screen.getByText("texto de prueba fuera de horario")).toBeTruthy();
    expect(container.querySelectorAll("input")).toHaveLength(0);
    expect(
      screen.getByRole("link", { name: "Editar en Agente › Límites y costo" }).getAttribute("href"),
    ).toBe("/agente?tab=limites");
  });
});

describe("AvisoLectura", () => {
  test("un error dice que no se pudo leer y por qué", () => {
    render(
      <AvisoLectura titulo="Números" lectura={{ estado: "error", mensaje: "mensaje de prueba" }} />,
    );

    expect(screen.getByText("No se pudo leer")).toBeTruthy();
    expect(screen.getByText(/mensaje de prueba/)).toBeTruthy();
  });

  test("un dato no disponible lo dice con su motivo", () => {
    render(
      <AvisoLectura
        titulo="Plantillas"
        lectura={{ estado: "no-disponible", motivo: "motivo de prueba" }}
      />,
    );

    expect(screen.getByText("No disponible")).toBeTruthy();
    expect(screen.getByText("motivo de prueba")).toBeTruthy();
  });
});

describe("PanelSalud", () => {
  test("si el cupo no se pudo leer, lo dice en su lugar y el resto se dibuja", () => {
    render(
      <PanelSalud
        cupo={{ estado: "error", mensaje: "error de prueba del cupo" }}
        escalones={ESCALONES}
        posicion={{ tipo: "no-disponible", motivo: "motivo de prueba" }}
        envio={{ estado: "disponible" }}
        historial={[]}
        notaHistorial={null}
        notaSanciones="nota de sanciones de prueba"
        numeros={{ estado: "ok", datos: { numeros: [], nota: null } }}
        guardarRol={null}
        plantillas={{ estado: "ok", datos: { plantillas: [], nota: null } }}
        fuente="fuente de prueba"
      />,
    );

    expect(screen.getByText("Nivel del portfolio")).toBeTruthy();
    expect(screen.getByText(/error de prueba del cupo/)).toBeTruthy();
    expect(screen.getByText("nota de sanciones de prueba")).toBeTruthy();
    expect(screen.getByText("fuente de prueba")).toBeTruthy();
  });
});

describe("TopesSeguridad", () => {
  const EDITAR = { href: "/agente?tab=limites", texto: "Editar tope" };
  const SALTOS = {
    total: 5,
    filas: [
      {
        motivo: "tope_frecuencia" as const,
        label: "Tope de mensajes",
        explicacion: "x",
        cantidad: 4,
      },
      { motivo: "dado_de_baja" as const, label: "Dado de baja", explicacion: "y", cantidad: 1 },
    ],
  };

  test("muestra el tope real, los dos que no se apagan y los saltos de la semana", () => {
    render(
      <TopesSeguridad
        maximoPorLead={{ estado: "ok", datos: 3 }}
        editarEn={EDITAR}
        saltos={{ estado: "ok", datos: SALTOS }}
      />,
    );
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getAllByText("Siempre activo")).toHaveLength(2);
    expect(screen.getByText("5")).toBeTruthy();
    expect(
      screen.getByRole("list", { name: "Mensajes saltados por motivo" }).children,
    ).toHaveLength(2);
    expect(screen.getByRole("link", { name: "Editar tope" }).getAttribute("href")).toBe(
      "/agente?tab=limites",
    );
  });

  test("si los saltos no se pudieron leer, lo dice en su lugar y el resto se dibuja", () => {
    render(
      <TopesSeguridad
        maximoPorLead={{ estado: "ok", datos: 3 }}
        editarEn={EDITAR}
        saltos={{ estado: "error", mensaje: "falla de prueba" }}
      />,
    );
    expect(screen.getByText("falla de prueba")).toBeTruthy();
    expect(screen.getAllByText("Siempre activo")).toHaveLength(2);
  });
});

describe("EscaleraSanciones — historial y escalón inferido", () => {
  test("lista lo que mandó Meta, con el evento crudo al lado", () => {
    render(
      <EscaleraSanciones
        escalones={ESCALONES}
        posicion={{
          tipo: "en-escalon",
          indice: 1,
          desde: "24/09",
          inferido: "inferencia de prueba",
        }}
        envio={{ estado: "disponible" }}
        historial={[
          {
            id: "1",
            fecha: "mié 24 sep, 10:00",
            evento: "ACCOUNT_RESTRICTION",
            titulo: "Meta restringió la cuenta",
            detalle: "detalle de restricción de prueba",
          },
        ]}
      />,
    );

    expect(screen.getByText("Meta restringió la cuenta")).toBeTruthy();
    expect(screen.getByText("ACCOUNT_RESTRICTION")).toBeTruthy();
    expect(screen.getByText("detalle de restricción de prueba")).toBeTruthy();
    expect(screen.getByText(/inferencia de prueba/)).toBeTruthy();
  });

  test("sin sanción dice desde cuándo se escucha a Meta", () => {
    render(
      <EscaleraSanciones
        escalones={ESCALONES}
        posicion={{ tipo: "sin-sancion", observadoDesde: "lun 1 sep, 10:00" }}
        envio={{ estado: "disponible" }}
      />,
    );

    expect(screen.getByText("sin sanciones")).toBeTruthy();
    expect(screen.getByText(/lun 1 sep, 10:00/)).toBeTruthy();
  });
});

describe("MedidorCupo — uso de los últimos días", () => {
  const DIAS = ["sáb 19", "dom 20", "lun 21", "mar 22", "mié 23", "jue 24", "vie 25"];

  function conUso(destinatarios: number[], veredicto: "cumplida" | "falta" | "depende") {
    return cupo({
      uso: {
        disponible: true,
        dias: destinatarios.map((d, i) => ({ etiqueta: DIAS[i] ?? "", destinatarios: d })),
        totalVentana: destinatarios.reduce((a, b) => a + b, 0),
        limite: 2000,
        minimo: 1000,
        veredicto,
        noCapturado: "texto de lo no capturado",
      },
    });
  }

  test("dibuja un día por columna, con su cifra, y dice lo que el cálculo no ve", () => {
    render(<MedidorCupo estado={conUso([0, 10, 20, 30, 40, 50, 1200], "depende")} />);

    for (const dia of DIAS) expect(screen.getByText(dia)).toBeTruthy();
    expect(screen.getByText("1.200")).toBeTruthy();
    expect(screen.getByText("texto de lo no capturado")).toBeTruthy();
    expect(screen.getByRole("table", { name: /destinatarios por día/i })).toBeTruthy();
  });

  test("cuando depende de cómo mida Meta, no lo pinta ni de verde ni de ámbar", () => {
    render(<MedidorCupo estado={conUso([0, 0, 0, 0, 0, 0, 1200], "depende")} />);

    expect(screen.getAllByText("sin dato").length).toBeGreaterThan(0);
    expect(screen.getByText(/depende de cómo lo mida Meta/)).toBeTruthy();
  });

  test("si falta volumen, el veredicto lo dice", () => {
    render(<MedidorCupo estado={conUso([10, 10, 10, 10, 10, 10, 10], "falta")} />);

    expect(screen.getByText(/Falta volumen/)).toBeTruthy();
  });
});
