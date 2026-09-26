import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import {
  CorridaEnVivo,
  DiffPublicacion,
  compararGrafos,
  mismoValor,
  type CorridaEnVivoProps,
  type DiffPublicacionProps,
  type PasoCorrida,
} from "@/components/workflows/editor";
import { FormularioCondicion } from "@/app/(panel)/workflows/[id]/_components/FormularioCondicion";
// El panel de Condición pide catálogos y el conteo a Server Actions: acá se
// reemplazan por respuestas fijas (la lógica real se prueba en el servicio y,
// el SQL, contra Postgres).
const conteo = vi.hoisted(() => ({
  respuesta: { ok: true, data: { tipo: "contado", total: 47, leads: [] } } as unknown,
}));
vi.mock("@/app/(panel)/workflows/_actions/condicion.actions", () => ({
  catalogosCondicionAction: async () => ({ ok: true, data: { intents: [], etiquetas: [] } }),
  coincidenciasCondicionAction: async () => conteo.respuesta,
}));

import {
  resumenDeCondicion,
  resumenDeConfigCondicion,
} from "@/app/(panel)/workflows/[id]/_lib/campos-condicion";
import {
  nombreDeTipo,
  presentacionDe,
  problemasConNombre,
} from "@/app/(panel)/workflows/[id]/_lib/presentacion-nodos";
import { pantallaDeCorrida } from "@/app/(panel)/workflows/[id]/_lib/vista-corrida";
import { arbolDeConfig } from "@/lib/workflows/condiciones.schema";
import { grafo, nodo, arista } from "./fixtures-grafo";

import type { Grupo } from "@/lib/ui/condiciones";
import type { VistaCorrida } from "@/server/services/workflows/corridas.service";
import type { Grafo } from "@/types/workflows";

/**
 * Las tres pantallas que estaban construidas y sin usar —diff de publicación,
 * corrida en vivo y constructor de condición— cableadas a su backend. Se prueba
 * cada estado que el backend puede devolver, no sólo el camino feliz.
 */

/** React Flow y el ScrollArea miden con ResizeObserver, que jsdom no trae. */
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ARBOL: Grupo = {
  id: "raiz",
  clase: "grupo",
  operador: "y",
  hijos: [
    {
      id: "f1",
      clase: "regla",
      campoId: "lead.etapa",
      comparador: "es",
      valor: { tipo: "opcion", valor: "cotizado" },
    },
    {
      id: "g1",
      clase: "grupo",
      operador: "o",
      hijos: [
        {
          id: "f2",
          clase: "regla",
          campoId: "lead.canal",
          comparador: "es",
          valor: { tipo: "opcion", valor: "wa" },
        },
        {
          id: "f3",
          clase: "regla",
          campoId: "sesion.respondio",
          comparador: "es",
          valor: { tipo: "booleano", valor: true },
        },
      ],
    },
  ],
};

// ──────────────────────────────────────────────────────────────────────────
// Diff
// ──────────────────────────────────────────────────────────────────────────

describe("compararGrafos — la condición guardada como árbol", () => {
  function conCondicion(config: Record<string, unknown>): Grafo {
    const g = grafo(
      [nodo("d", "trigger_mensaje"), { ...nodo("c", "logica_condicion"), config }],
      [arista("d", "c")],
    );
    return g;
  }

  it("cambiar una fila del árbol es un cambio, aunque los dos se muestren como objeto", () => {
    const otro: Grupo = { ...ARBOL, operador: "o" };
    const diff = compararGrafos(conCondicion({ arbol: ARBOL }), conCondicion({ arbol: otro }));

    expect(diff.total).toBe(1);
    expect(diff.cambios[0]?.clase).toBe("cambiado");
    // El texto de antes y el de después serían iguales: se dice que se modificó.
    expect(diff.cambios[0]?.parametros[0]?.despues).toBe("(modificada)");
  });

  it("con un formateador, el cambio se lee como las dos frases", () => {
    const otro: Grupo = { ...ARBOL, operador: "o" };
    const diff = compararGrafos(conCondicion({ arbol: ARBOL }), conCondicion({ arbol: otro }), {
      formatear: (clave, valor) => {
        const a = clave === "arbol" ? arbolDeConfig({ arbol: valor }) : null;
        return a ? resumenDeCondicion(a) : undefined;
      },
    });

    expect(diff.cambios[0]?.parametros[0]?.antes).toBe(
      "Etapa es Cotizado y (Canal es WhatsApp o Respondió: sí)",
    );
    expect(diff.cambios[0]?.parametros[0]?.despues).toBe(
      "Etapa es Cotizado o (Canal es WhatsApp o Respondió: sí)",
    );
  });

  it("el mismo árbol con las claves en otro orden no es un cambio", () => {
    const reordenado = JSON.parse(JSON.stringify(ARBOL)) as Grupo;
    const diff = compararGrafos(
      conCondicion({ arbol: ARBOL }),
      conCondicion({
        arbol: { hijos: reordenado.hijos, operador: "y", clase: "grupo", id: "raiz" },
      }),
    );
    expect(diff.total).toBe(0);
  });

  it("mismoValor: vacío, null y ausente son lo mismo; 5 y '5' también", () => {
    expect(mismoValor(undefined, "")).toBe(true);
    expect(mismoValor([], null)).toBe(true);
    expect(mismoValor(5, "5")).toBe(true);
    expect(mismoValor({ a: [1, 2] }, { a: [2, 1] })).toBe(false);
  });
});

function montarDiff(over: Partial<DiffPublicacionProps> = {}) {
  const anterior = grafo([nodo("d", "trigger_mensaje")], []);
  const nuevo = grafo([nodo("d", "trigger_mensaje"), nodo("m", "msg_texto")], [arista("d", "m")]);
  const props: DiffPublicacionProps = {
    nombreFlujo: "Bienvenida",
    versionActual: 3,
    versionNueva: 4,
    diff: compararGrafos(anterior, nuevo),
    resolver: presentacionDe,
    nota: "",
    onNotaChange: vi.fn(),
    onVolver: vi.fn(),
    onPublicar: vi.fn(),
    ...over,
  };
  render(<DiffPublicacion {...props} />);
  return props;
}

describe("DiffPublicacion — lo que devuelve la previa", () => {
  it("sin versión publicada, es la primera publicación y no se compara contra una v inexistente", () => {
    montarDiff({ versionActual: null });
    expect(screen.getByText("sin publicar → v4")).toBeTruthy();
    expect(screen.getByText(/Es la primera versión que se publica/)).toBeTruthy();
  });

  it("corridas vivas en dos versiones: se dice cuántas hay en cada una", () => {
    montarDiff({
      corridasVivas: {
        total: 38,
        porVersion: [
          { version: 3, cantidad: 33 },
          { version: 2, cantidad: 5 },
        ],
      },
    });
    expect(
      screen.getByText("Las 38 corridas en marcha siguen en la versión donde arrancaron"),
    ).toBeTruthy();
    expect(screen.getByText("v2")).toBeTruthy();
    expect(screen.getByText("5")).toBeTruthy();
  });

  it("una versión ya publicada no se vuelve a publicar: el botón se apaga y dice por qué", () => {
    montarDiff({ bloqueo: "v4 ya es la versión publicada." });
    expect(screen.getByText("v4 ya es la versión publicada.")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Publicar v4" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("un cambio sólo de tope de pasos cuenta: se puede publicar", () => {
    const g = grafo([nodo("d", "trigger_mensaje")], []);
    const props = montarDiff({
      diff: compararGrafos(g, g),
      cambiosDelFlujo: [{ etiqueta: "Tope de pasos por corrida", antes: "500", despues: "50" }],
    });
    expect(screen.getByText("Tope de pasos por corrida")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Publicar v4" }));
    expect(props.onPublicar).toHaveBeenCalledTimes(1);
  });

  it("el error de la acción se lee arriba del botón", () => {
    montarDiff({ error: "Solo un administrador puede hacer esto." });
    expect(screen.getByRole("alert").textContent).toBe("Solo un administrador puede hacer esto.");
  });

  it("un flujo con errores muestra cada uno con el nodo que lo tiene y no deja publicar", () => {
    const props = montarDiff({
      problemas: [
        { nodo: "Enviar texto", mensaje: "El mensaje no puede estar vacío" },
        { nodo: "Condición", mensaje: "la fila 1 no tiene campo" },
      ],
    });
    const lista = screen.getByRole("list", { name: "Errores que impiden publicar" });
    const items = Array.from(lista.querySelectorAll("li")).map((li) => li.textContent);
    expect(items).toEqual([
      "Enviar texto: El mensaje no puede estar vacío",
      "Condición: la fila 1 no tiene campo",
    ]);
    const boton = screen.getByRole("button", { name: "Publicar v4" }) as HTMLButtonElement;
    expect(boton.disabled).toBe(true);
    fireEvent.click(boton);
    expect(props.onPublicar).not.toHaveBeenCalled();
  });
});

describe("problemasConNombre — el nodo de cada error, como se lee en el lienzo", () => {
  it("nombra el nodo por su tipo; si hay varios del mismo tipo, los numera de arriba abajo", () => {
    const abajo = { ...nodo("m2", "msg_texto"), posicion: { x: 0, y: 200 } };
    const arriba = { ...nodo("m1", "msg_texto"), posicion: { x: 0, y: 100 } };
    const g = grafo([nodo("t", "trigger_manual"), abajo, arriba], []);
    const nombrados = problemasConNombre(g, [
      { nodoId: "m2", mensaje: "El mensaje no puede estar vacío" },
      { nodoId: "t", mensaje: "x" },
      { nodoId: null, mensaje: "El workflow necesita un trigger para iniciar" },
    ]);
    expect(nombrados).toEqual([
      { nodo: `${nombreDeTipo("msg_texto")} 2`, mensaje: "El mensaje no puede estar vacío" },
      { nodo: nombreDeTipo("trigger_manual"), mensaje: "x" },
      { nodo: "Flujo", mensaje: "El workflow necesita un trigger para iniciar" },
    ]);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Condición
// ──────────────────────────────────────────────────────────────────────────

describe("FormularioCondicion — abrir lo guardado", () => {
  it("un árbol roto no se abre: lo dice y no dibuja el constructor", () => {
    const onChange = vi.fn();
    render(
      <FormularioCondicion
        config={{ arbol: { clase: "grupo", hijos: "no es una lista" } }}
        onChange={onChange}
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain("Esta condición no se puede abrir");
    expect(screen.queryByRole("group", { name: /Grupo en el que/ })).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("el trío plano de antes se abre ya convertido, sin reescribir nada al abrir", () => {
    const onChange = vi.fn();
    render(
      <FormularioCondicion
        config={{ campo: "lead.etapa", operador: "es", valor: "cotizado" }}
        onChange={onChange}
      />,
    );
    expect(screen.getByText(/formato anterior de condición/)).toBeTruthy();
    expect(screen.getByRole("group", { name: "Condición 1" })).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("agregar una fila guarda la config entera como { arbol }", () => {
    const onChange = vi.fn();
    render(<FormularioCondicion config={{ arbol: ARBOL }} onChange={onChange} />);
    // El del grupo anidado viene antes en el DOM: el de la raíz es el último.
    fireEvent.click(screen.getAllByRole("button", { name: "Condición" }).at(-1)!);
    const escrita = onChange.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(Object.keys(escrita)).toEqual(["arbol"]);
    expect((escrita["arbol"] as Grupo).hijos).toHaveLength(3);
  });

  it("de sólo lectura: los controles quedan apagados", () => {
    render(<FormularioCondicion config={{ arbol: ARBOL }} onChange={vi.fn()} readonly />);
    const fieldset = document.querySelector("fieldset");
    expect(fieldset?.disabled).toBe(true);
  });

  it("el nodo se resume con la frase de su árbol; sin campos elegidos, no dice nada", () => {
    expect(resumenDeConfigCondicion({ arbol: ARBOL })).toBe(
      "Etapa es Cotizado y (Canal es WhatsApp o Respondió: sí)",
    );
    expect(resumenDeConfigCondicion({})).toBeNull();
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Corrida
// ──────────────────────────────────────────────────────────────────────────

const GRAFO_CORRIDA = grafo(
  [nodo("d", "trigger_mensaje"), nodo("m", "msg_texto"), nodo("e", "crm_etapa")],
  [arista("d", "m"), arista("m", "e")],
);

const PASOS_FALLADA: PasoCorrida[] = [
  {
    nodoId: "d",
    nombre: "Mensaje recibido",
    tipo: "trigger_mensaje",
    estado: "completado",
    hora: "09:14",
  },
  { nodoId: "m", nombre: "Enviar texto", tipo: "msg_texto", estado: "completado", hora: "09:14" },
  { nodoId: "e", nombre: "Cambiar etapa", tipo: "crm_etapa", estado: "fallado", hora: "09:15" },
];

function montarCorrida(over: Partial<CorridaEnVivoProps> = {}) {
  const props: CorridaEnVivoProps = {
    nombreFlujo: "Bienvenida",
    grafo: GRAFO_CORRIDA,
    pasos: PASOS_FALLADA,
    resolver: presentacionDe,
    identificacion: "#a3f2 · Juan Pérez · v3",
    onVolver: vi.fn(),
    ...over,
  };
  render(<CorridaEnVivo {...props} />);
  return props;
}

describe("CorridaEnVivo — los estados", () => {
  it("en vivo: lo dice en la barra y dice si la conexión está viva", () => {
    montarCorrida({
      enVivo: true,
      conexion: "conectada",
      pasos: PASOS_FALLADA.map((p, i) => (i === 2 ? { ...p, estado: "activo" } : p)),
    });
    expect(screen.getByText("corrida en vivo")).toBeTruthy();
    expect(screen.getByText("En vivo: cada paso aparece al terminar")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Reanudar/ })).toBeNull();
  });

  it("con la conexión caída lo dice, en vez de mostrar una foto vieja como si fuera en vivo", () => {
    montarCorrida({ enVivo: true, conexion: "caida" });
    expect(screen.getByText(/Sin conexión en vivo/)).toBeTruthy();
  });

  it("fallada y reanudable: los dos botones, y ejecutar de nuevo enumera lo que se repite", () => {
    const props = montarCorrida({
      reanudar: {
        posible: true,
        desdeNodo: "e",
        reusados: [
          { nodoId: "d", hora: "09:14" },
          { nodoId: "m", hora: "09:14" },
        ],
      },
      repetir: {
        posible: true,
        destinatario: "Juan Pérez",
        envios: [{ nodoId: "m", nombre: "Enviar texto", hora: "09:14", texto: "Hola Juan" }],
      },
      onReanudar: vi.fn(),
      onEjecutarDeNuevo: vi.fn(),
    });

    fireEvent.click(screen.getByRole("button", { name: "Reanudar desde el fallo" }));
    expect(props.onReanudar).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Ejecutar de nuevo desde el principio" }));
    expect(screen.getByText("«Hola Juan»")).toBeTruthy();
    expect(screen.getByText(/le llegan de nuevo a Juan Pérez/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sí, repetir 1 envío" }));
    expect(props.onEjecutarDeNuevo).toHaveBeenCalledTimes(1);
  });

  it("fallada y no reanudable: no hay botones, se dice por qué", () => {
    montarCorrida({
      reanudar: { posible: false, motivo: "Llegó al tope de pasos de su versión." },
      repetir: { posible: false, motivo: "Llegó al tope de pasos de su versión." },
      onReanudar: vi.fn(),
      onEjecutarDeNuevo: vi.fn(),
    });
    expect(screen.getByText("Llegó al tope de pasos de su versión.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Reanudar desde el fallo" })).toBeNull();
  });

  it("reanudar imposible pero ejecutar de nuevo posible: reanudar queda apagado, no escondido", () => {
    montarCorrida({
      reanudar: { posible: false, motivo: "Falló antes de ejecutar un paso." },
      repetir: { posible: true, envios: [] },
      onReanudar: vi.fn(),
      onEjecutarDeNuevo: vi.fn(),
    });
    const boton = screen.getByRole("button", {
      name: "Reanudar desde el fallo",
    }) as HTMLButtonElement;
    expect(boton.disabled).toBe(true);
  });
});

function vistaDe(over: Partial<VistaCorrida> = {}): VistaCorrida {
  const inicio = new Date("2026-09-20T12:14:00Z");
  const t = (s: number) => new Date(inicio.getTime() + s * 1000);
  return {
    run: {
      id: "a3f2c0de-0000-4000-8000-000000000000",
      workflow_version_id: "v",
      lead_id: "l",
      lead_session_id: null,
      estado: "fallado",
      nodo_actual: "e",
      contexto: {},
      pasos_ejecutados: 3,
      error: "falló",
      started_at: inicio,
      ended_at: t(90),
    },
    esPrueba: false,
    workflow: { id: "w", nombre: "Bienvenida" },
    version: { id: "v", numero: 3, grafo: GRAFO_CORRIDA, maxPasos: 500, publicada: true },
    lead: { id: "l", nombre: "Juan Pérez", vehiculo: null },
    mensajes: [],
    porNodo: { corridas: 0, vivas: 0, nodos: [] },
    pasos: [
      {
        id: "p1",
        run_id: "r",
        nodo_id: "d",
        orden: 0,
        entrada: null,
        salida: null,
        error: null,
        created_at: t(1),
      },
      {
        id: "p2",
        run_id: "r",
        nodo_id: "m",
        orden: 1,
        entrada: { texto: "Hola" },
        salida: { mensaje_id: "x" },
        error: null,
        created_at: t(3),
      },
      {
        id: "p3",
        run_id: "r",
        nodo_id: "e",
        orden: 2,
        entrada: null,
        salida: null,
        error: "etapa inválida",
        created_at: t(90),
      },
    ],
    nodos: [
      {
        nodoId: "d",
        tipo: "trigger_mensaje",
        estado: "completado",
        ejecuciones: 1,
        ultima: { orden: 0, at: t(1), salida: null, error: null },
      },
      {
        nodoId: "m",
        tipo: "msg_texto",
        estado: "completado",
        ejecuciones: 1,
        ultima: { orden: 1, at: t(3), salida: { mensaje_id: "x" }, error: null },
      },
      {
        nodoId: "e",
        tipo: "crm_etapa",
        estado: "fallado",
        ejecuciones: 1,
        ultima: { orden: 2, at: t(90), salida: null, error: "etapa inválida" },
      },
    ],
    reanudar: {
      posible: true,
      desdeNodo: "e",
      desdePaso: 2,
      reusados: [
        { nodoId: "d", orden: 0, at: t(1) },
        { nodoId: "m", orden: 1, at: t(3) },
      ],
      reejecuta: [{ nodoId: "e", ordenFallado: 2, error: "etapa inválida" }],
    },
    ejecutarDeNuevo: {
      posible: true,
      destinatario: { leadId: "l", nombre: "Juan Pérez" },
      envios: [{ nodoId: "m", orden: 1, enviadoAt: t(3), mensajeId: "x", texto: "Hola Juan" }],
    },
    ...over,
  };
}

describe("pantallaDeCorrida — la vista del servidor, con nombre y hora", () => {
  it("horas en la zona del negocio, duración desde el paso anterior, error en la salida", () => {
    const p = pantallaDeCorrida(vistaDe(), "America/Argentina/Buenos_Aires");

    expect(p.identificacion).toBe("#a3f2 · Juan Pérez · v3");
    expect(p.pasos.map((x) => x.hora)).toEqual(["09:14", "09:14", "09:15"]);
    expect(p.pasos[2]?.duracion).toBe("1 m 27 s");
    expect(p.pasos[2]?.salida).toEqual({ error: "etapa inválida" });
    expect(p.pasos[1]?.entrada).toEqual({ texto: "Hola" });
    expect(p.reanudar).toEqual({
      posible: true,
      desdeNodo: "e",
      reusados: [
        { nodoId: "d", hora: "09:14" },
        { nodoId: "m", hora: "09:14" },
      ],
    });
    expect(p.repetir.posible && p.repetir.envios[0]?.texto).toBe("Hola Juan");
    expect(p.enVivo).toBe(false);
  });

  it("corrida de Probar: no se ofrece reanudar ni ejecutar de nuevo, y se dice por qué", () => {
    const p = pantallaDeCorrida(
      vistaDe({
        esPrueba: true,
        reanudar: { posible: false, motivo: "corrida_de_prueba" },
        ejecutarDeNuevo: { posible: false, motivo: "corrida_de_prueba" },
      }),
      "UTC",
    );
    expect(p.esPrueba).toBe(true);
    expect(p.reanudar.posible).toBe(false);
    expect(!p.reanudar.posible && p.reanudar.motivo).toMatch(/corrida de Probar/);

    render(
      <CorridaEnVivo
        nombreFlujo="Bienvenida"
        grafo={GRAFO_CORRIDA}
        pasos={p.pasos}
        resolver={presentacionDe}
        identificacion={p.identificacion}
        esPrueba
        reanudar={p.reanudar}
        repetir={p.repetir}
        onReanudar={vi.fn()}
        onEjecutarDeNuevo={vi.fn()}
        onVolver={vi.fn()}
      />,
    );
    expect(screen.getByText("corrida de prueba")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Reanudar desde el fallo" })).toBeNull();
  });
});

describe("FormularioCondicion — el contador de leads", () => {
  it("con la condición entera muestra cuántos leads coinciden", async () => {
    conteo.respuesta = { ok: true, data: { tipo: "contado", total: 47, leads: [] } };
    render(<FormularioCondicion config={{ arbol: ARBOL }} onChange={vi.fn()} />);
    expect(await screen.findByText("47", {}, { timeout: 2000 })).toBeTruthy();
    expect(screen.getByText("leads coinciden ahora mismo")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ver la lista" })).toBeTruthy();
  });

  it("con «Respondió» no muestra número y dice por qué", async () => {
    conteo.respuesta = {
      ok: true,
      data: { tipo: "no_contable", campos: ["sesion.respondio"] },
    };
    render(<FormularioCondicion config={{ arbol: ARBOL }} onChange={vi.fn()} />);
    expect(
      await screen.findByText(/depende de lo que dispara el flujo/, {}, { timeout: 2000 }),
    ).toBeTruthy();
    expect(screen.queryByText("leads coinciden ahora mismo")).toBeNull();
  });
});

describe("pantallaDeCorrida — vehículo, mensajes y corridas por nodo", () => {
  it("la identificación suma el vehículo del lead cuando lo tiene", () => {
    const p = pantallaDeCorrida(
      vistaDe({ lead: { id: "l", nombre: "Juan Pérez", vehiculo: "Hilux 2018" } }),
      "UTC",
    );
    expect(p.identificacion).toBe("#a3f2 · Juan Pérez · Hilux 2018 · v3");
  });

  it("los mensajes salen con la hora del negocio y las corridas por nodo con su nombre", () => {
    const p = pantallaDeCorrida(
      vistaDe({
        mensajes: [
          {
            nodoId: "m",
            orden: 1,
            texto: "Hola Juan",
            estado: "entregado",
            at: new Date("2026-09-20T12:14:03Z"),
            simulado: false,
          },
        ],
        porNodo: {
          corridas: 3,
          vivas: 1,
          nodos: [{ nodoId: "m", corridas: 3, fallaron: 1, esperando: 0 }],
        },
      }),
      "America/Argentina/Buenos_Aires",
    );
    expect(p.mensajes).toEqual([
      { clave: "m-1", texto: "Hola Juan", hora: "09:14", estado: "entregado", simulado: false },
    ]);
    expect(p.porNodo.corridas).toBe(3);
    expect(p.porNodo.nodos[0]).toMatchObject({ nodoId: "m", corridas: 3, fallaron: 1 });
  });
});
