import { useState, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { opcionesDeEtapas } from "@/app/(panel)/workflows/[id]/_lib/opciones-editor";
import { ConfigCRM, ConfigMensajeria } from "@/components/workflows/canvas/config";
import { ACCION_DE_TIPO } from "@/lib/workflows/catalogo";
import { validarWorkflow } from "@/lib/workflows/validar-workflow";
import { correrPrueba, sesionSimulada } from "@/server/services/workflows/simulador.service";
import type { Lead } from "@/types/entities";
import type { Grafo, Nodo, NodoTipo } from "@/types/workflows";

/**
 * El contrato de la config de un bloque, de punta a punta: lo que escribe el
 * formulario del panel es lo que acepta el validador y lo que lee la acción.
 *
 * Existe porque los tres lados nombraban las claves cada uno por su cuenta y
 * divergieron: el panel guardaba `tagIds` y `etapaId`, el validador leía
 * `tag_id` y `etapa`. Cada lado tenía sus tests contra sí mismo y la suite
 * pasaba igual. Este test no le cree a ninguno: arma la config apretando el
 * formulario real, y la corre por el validador y por `correrPrueba`, que es el
 * camino de "Probar" con el registro de producción.
 *
 * Si alguien renombra una clave en un solo lado, algún `expect` de acá falla.
 */

type Config = Record<string, unknown>;

interface Receta {
  formulario: (config: Config, onChange: (siguiente: Config) => void) => ReactElement;
  /** Lo mínimo que haría una persona: elegir la primera opción, escribir un texto. */
  completar: () => Promise<void>;
  /** Lo que la prueba habría hecho afuera (`EfectoSimulado`), sin la hora. */
  efecto: { accion: string; detalle: Record<string, unknown> };
}

const TAGS = [{ id: "tag-vip", nombre: "VIP" }];
const VENDEDORES = [
  { id: "ven-ana", nombre: "Ana" },
  { id: "ven-beto", nombre: "Beto" },
];
const ETAPAS = opcionesDeEtapas();
const TEXTO = "Hola, ¿qué repuesto estás buscando?";

const LEAD: Lead = {
  id: "lead-1",
  nombre: "Ana",
  nombre_perfil: null,
  telefono: "+5491100000000",
  email: null,
  direccion: null,
  datos_extra: {},
  vehiculo_marca: null,
  vehiculo_modelo: null,
  vehiculo_anio: null,
  vehiculo_motor: null,
  empresa_id: null,
  canal_origen: "wa",
  meta_user_ids: {},
  created_at: new Date("2026-09-13T12:00:00Z"),
  updated_at: new Date("2026-09-13T12:00:00Z"),
};

const DESDE = new Date("2026-09-13T12:00:00Z");

/**
 * Abre el selector que muestra `placeholder` y elige su primera opción.
 *
 * Es un Select de Base UI: abre con `mousedown` (su `useClick` escucha ese
 * evento) y un ítem sólo confirma el click si está resaltado. Una tecla sobre
 * el ítem lo resalta —su `onKeyDown` fija el índice activo— sin disparar la
 * selección, así que el click de después confirma una sola vez.
 */
async function elegirPrimeraOpcion(placeholder: string): Promise<void> {
  const trigger = screen
    .getAllByRole("combobox")
    .find((el) => el.textContent?.includes(placeholder));
  if (!trigger) throw new Error(`no hay un selector que diga "${placeholder}"`);
  fireEvent.mouseDown(trigger);
  const [primera] = await screen.findAllByRole("option");
  if (!primera) throw new Error(`el selector "${placeholder}" abrió sin opciones`);
  fireEvent.keyDown(primera, { key: "Shift" });
  fireEvent.click(primera);
}

/**
 * Una receta por tipo del canvas que ejecuta una acción (`ACCION_DE_TIPO`).
 * Las opciones de los selectores son las mismas que le pasa la página real.
 */
const RECETAS: Readonly<Record<string, Receta>> = {
  msg_texto: {
    formulario: (config, onChange) => (
      <ConfigMensajeria tipo="msg_texto" config={config} onChange={onChange} />
    ),
    completar: async () => {
      fireEvent.change(
        screen.getByPlaceholderText("Hola {{lead.nombre}}, gracias por escribir..."),
        {
          target: { value: TEXTO },
        },
      );
    },
    efecto: { accion: "enviar_mensaje", detalle: { texto: TEXTO, canal: "wa" } },
  },
  crm_etiqueta_add: {
    formulario: (config, onChange) => (
      <ConfigCRM
        tipo="crm_etiqueta_add"
        config={config}
        onChange={onChange}
        tags={TAGS}
        etapas={ETAPAS}
        vendedores={[]}
        campos={[]}
      />
    ),
    completar: () => elegirPrimeraOpcion("Agregar etiqueta..."),
    efecto: { accion: "poner_etiqueta", detalle: { tag_id: "tag-vip" } },
  },
  crm_etapa: {
    formulario: (config, onChange) => (
      <ConfigCRM
        tipo="crm_etapa"
        config={config}
        onChange={onChange}
        tags={TAGS}
        etapas={ETAPAS}
        vendedores={[]}
        campos={[]}
      />
    ),
    completar: () => elegirPrimeraOpcion("Seleccionar etapa"),
    efecto: { accion: "cambiar_etapa", detalle: { current_stage: ETAPAS[0]?.id } },
  },
  crm_escalar_humano: {
    formulario: (config, onChange) => (
      <ConfigCRM
        tipo="crm_escalar_humano"
        config={config}
        onChange={onChange}
        tags={TAGS}
        etapas={ETAPAS}
        vendedores={[]}
        campos={[]}
      />
    ),
    completar: async () => {
      fireEvent.click(screen.getByRole("checkbox", { name: /avisarle al cliente/i }));
    },
    efecto: { accion: "escalar_a_humano", detalle: { motivo: "rule_handoff" } },
  },
  msg_plantilla: {
    formulario: (config, onChange) => (
      <ConfigMensajeria tipo="msg_plantilla" config={config} onChange={onChange} />
    ),
    completar: async () => {
      fireEvent.change(screen.getByPlaceholderText("hello_world"), {
        target: { value: "seguimiento" },
      });
      fireEvent.click(screen.getByRole("button", { name: /agregar/i }));
      fireEvent.change(screen.getByRole("textbox", { name: "Valor de la variable 1" }), {
        target: { value: "{{lead.nombre}}" },
      });
    },
    efecto: {
      accion: "enviar_plantilla",
      detalle: { plantilla: "seguimiento", idioma: "es", parametros: ["Ana"] },
    },
  },
  crm_vendedor: {
    formulario: (config, onChange) => (
      <ConfigCRM
        tipo="crm_vendedor"
        config={config}
        onChange={onChange}
        tags={TAGS}
        etapas={ETAPAS}
        vendedores={VENDEDORES}
        campos={[]}
      />
    ),
    completar: () => elegirPrimeraOpcion("Seleccionar vendedor"),
    efecto: { accion: "asignar_vendedor", detalle: { vendedor_id: "ven-ana" } },
  },
  crm_round_robin: {
    formulario: (config, onChange) => (
      <ConfigCRM
        tipo="crm_round_robin"
        config={config}
        onChange={onChange}
        tags={TAGS}
        etapas={ETAPAS}
        vendedores={VENDEDORES}
        campos={[]}
      />
    ),
    completar: () => elegirPrimeraOpcion("Agregar vendedor..."),
    efecto: { accion: "repartir_round_robin", detalle: { vendedor_id: "ven-ana" } },
  },
};

/** Monta el formulario con estado, como el editor: cada cambio vuelve como `config`. */
function montar(receta: Receta): () => Config {
  let ultima: Config = {};
  function Formulario() {
    const [config, setConfig] = useState<Config>({});
    return receta.formulario(config, (siguiente) => {
      ultima = siguiente;
      setConfig(siguiente);
    });
  }
  render(<Formulario />);
  return () => ultima;
}

function bloque(id: string, tipo: NodoTipo, config: Config = {}): Nodo {
  return { id, tipo, config, posicion: { x: 0, y: 0 } };
}

/** Disparador manual → el bloque → Detener. Lo mínimo que "Probar" sabe correr. */
function flujoCon(nodo: Nodo): Grafo {
  return {
    nodos: [bloque("t", "trigger_manual"), nodo, bloque("fin", "logica_detener")],
    aristas: [
      { desde: "t", hasta: nodo.id, puerto: "salida" },
      { desde: nodo.id, hasta: "fin", puerto: "salida" },
    ],
  };
}

async function probar(grafo: Grafo) {
  return correrPrueba({
    grafo,
    maxPasos: 10,
    desde: DESDE,
    contexto: {},
    lead: LEAD,
    sesion: sesionSimulada(LEAD.id, DESDE),
    runId: "contrato",
  });
}

/** El `ScrollArea` de las variables mide con ResizeObserver, que jsdom no trae. */
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

const TIPOS_CON_ACCION = Object.keys(ACCION_DE_TIPO) as NodoTipo[];

describe("contrato de config: formulario → validador → acción", () => {
  it("hay una receta por cada tipo del canvas que ejecuta una acción", () => {
    // Un tipo nuevo en `ACCION_DE_TIPO` sin receta acá es un bloque cuyo
    // formulario nadie verificó contra su acción.
    expect(Object.keys(RECETAS).sort()).toEqual([...TIPOS_CON_ACCION].sort());
  });

  it.each(TIPOS_CON_ACCION)(
    "%s: lo que escribe su formulario pasa el validador y corre en Probar",
    async (tipo) => {
      const receta = RECETAS[tipo];
      if (!receta) throw new Error(`falta la receta de ${tipo}`);

      const configActual = montar(receta);
      await receta.completar();
      const config = configActual();
      const grafo = flujoCon(bloque("x", tipo, config));

      expect(validarWorkflow(grafo)).toEqual([]);

      const r = await probar(grafo);
      expect(r.error).toBeUndefined();
      expect(r.desenlace).toBe("fin");
      expect(r.pasos.flatMap((p) => p.efectos)).toEqual([
        { ...receta.efecto, en: expect.any(String) },
      ]);
    },
  );
});

describe("cambiar etapa: sólo los pasos del embudo", () => {
  it("el selector no ofrece «perdido» ni «requiere humano»: cerrar y escalar no son de un flujo", async () => {
    const receta = RECETAS.crm_etapa;
    if (!receta) throw new Error("falta la receta de crm_etapa");
    montar(receta);
    const trigger = screen
      .getAllByRole("combobox")
      .find((el) => el.textContent?.includes("Seleccionar etapa"));
    if (!trigger) throw new Error("no hay selector de etapa");
    fireEvent.mouseDown(trigger);
    const opciones = (await screen.findAllByRole("option")).map((o) => o.textContent);
    expect(opciones).toEqual(
      ETAPAS.filter((e) => e.id !== "perdido" && e.id !== "requiere_humano").map((e) => e.nombre),
    );
  });
});

describe("contrato de config: configs guardadas con las claves de antes", () => {
  it.each<[string, NodoTipo, Config, Receta["efecto"]]>([
    [
      "nodo legacy enviar_mensaje con `texto`",
      "accion",
      { accion: "enviar_mensaje", texto: "Hola" },
      { accion: "enviar_mensaje", detalle: { texto: "Hola", canal: "wa" } },
    ],
    [
      "nodo legacy poner_etiqueta con `tagId`",
      "accion",
      { accion: "poner_etiqueta", tagId: "tag-vip" },
      { accion: "poner_etiqueta", detalle: { tag_id: "tag-vip" } },
    ],
    [
      "nodo legacy cambiar_etapa con `etapa`",
      "accion",
      { accion: "cambiar_etapa", etapa: "cotizado" },
      { accion: "cambiar_etapa", detalle: { current_stage: "cotizado" } },
    ],
    [
      "msg_texto con `texto`",
      "msg_texto",
      { texto: "Hola" },
      { accion: "enviar_mensaje", detalle: { texto: "Hola", canal: "wa" } },
    ],
    [
      "crm_etiqueta_add con `tagId`",
      "crm_etiqueta_add",
      { tagId: "tag-vip" },
      { accion: "poner_etiqueta", detalle: { tag_id: "tag-vip" } },
    ],
    [
      "crm_etiqueta_add con `tag_id`",
      "crm_etiqueta_add",
      { tag_id: "tag-vip" },
      { accion: "poner_etiqueta", detalle: { tag_id: "tag-vip" } },
    ],
    [
      "crm_etapa con `etapa`",
      "crm_etapa",
      { etapa: "cotizado" },
      { accion: "cambiar_etapa", detalle: { current_stage: "cotizado" } },
    ],
  ])("%s pasa el validador y corre en Probar", async (_caso, tipo, config, efecto) => {
    const grafo = flujoCon(bloque("x", tipo, config));

    expect(validarWorkflow(grafo)).toEqual([]);

    const r = await probar(grafo);
    expect(r.error).toBeUndefined();
    expect(r.desenlace).toBe("fin");
    expect(r.pasos.flatMap((p) => p.efectos)).toEqual([{ ...efecto, en: expect.any(String) }]);
  });
});
