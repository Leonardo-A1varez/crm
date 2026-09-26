import { describe, expect, it } from "vitest";
import { ValidationError } from "@/lib/errors";
import { elegirVendedorRoundRobin } from "@/lib/round-robin";
import { ACCION_DE_TIPO, ACCIONES, type AccionWorkflow } from "@/lib/workflows/catalogo";
import {
  ESPEC_CONFIG_POR_ACCION,
  ESPEC_CONFIG_POR_TIPO,
  TIPOS_FUERA_DEL_CONTRATO,
  configDeAccion,
  editorDeConfig,
  normalizarConfig,
  revisarConfig,
} from "@/lib/workflows/config-nodos";
import { NODO_TIPOS, type Nodo, type NodoTipo } from "@/types/workflows";
import type {
  AsignacionService,
  ConfigRoundRobin,
} from "@/server/services/asignacion/asignacion.service";

function nodo(tipo: NodoTipo, config: Record<string, unknown>, id = "n1"): Nodo {
  return { id, tipo, config, posicion: { x: 0, y: 0 } };
}

describe("config-nodos — cobertura del contrato", () => {
  it("cada tipo de nodo tiene su schema, salvo la condición y el legacy `accion`", () => {
    const fuera = new Set<string>([...TIPOS_FUERA_DEL_CONTRATO, "accion"]);
    const conSchema = NODO_TIPOS.filter((t) => !fuera.has(t));
    expect(Object.keys(ESPEC_CONFIG_POR_TIPO).sort()).toEqual([...conSchema].sort());
  });

  it("la condición queda afuera: su config (el árbol Y/O) la define otro stream", () => {
    expect([...TIPOS_FUERA_DEL_CONTRATO].sort()).toEqual(["condicion", "logica_condicion"]);
    for (const tipo of TIPOS_FUERA_DEL_CONTRATO) {
      expect(revisarConfig(nodo(tipo, {}))).toBeNull();
    }
  });

  it("cada acción del motor tiene su schema", () => {
    expect(Object.keys(ESPEC_CONFIG_POR_ACCION).sort()).toEqual([...ACCIONES].sort());
  });

  it("un tipo del canvas y la acción que ejecuta comparten el MISMO schema", () => {
    // No uno equivalente: el mismo objeto. Es lo que impide que el validador
    // (que mira el tipo) y la acción (que mira su nombre) diverjan.
    for (const [tipo, accion] of Object.entries(ACCION_DE_TIPO)) {
      expect(ESPEC_CONFIG_POR_TIPO[tipo as keyof typeof ESPEC_CONFIG_POR_TIPO], tipo).toBe(
        ESPEC_CONFIG_POR_ACCION[accion as AccionWorkflow],
      );
    }
  });
});

describe("config-nodos — claves viejas", () => {
  it.each<[NodoTipo, Record<string, unknown>, Record<string, unknown>]>([
    ["msg_texto", { texto: "hola" }, { mensaje: "hola" }],
    ["crm_etiqueta_add", { tagId: "t1" }, { tagIds: ["t1"] }],
    ["crm_etiqueta_add", { tag_id: "t1" }, { tagIds: ["t1"] }],
    ["crm_etiqueta_remove", { etiqueta_id: "t1" }, { tagIds: ["t1"] }],
    ["crm_etapa", { etapa: "cotizado" }, { etapaId: "cotizado" }],
    ["crm_vendedor", { vendedor_id: "u1" }, { vendedorId: "u1" }],
    ["crm_round_robin", { vendedorIds: ["u1", "u2"] }, { candidatos: ["u1", "u2"] }],
    ["msg_plantilla", { template_name: "hello_world" }, { templateName: "hello_world" }],
    [
      "int_email",
      { to: "a@example.com", subject: "s", body: "b" },
      { para: "a@example.com", asunto: "s", cuerpo: "b" },
    ],
    [
      "accion",
      { accion: "poner_etiqueta", tagId: "t1" },
      { accion: "poner_etiqueta", tagIds: ["t1"] },
    ],
  ])("%s %j se lee como %j", (tipo, guardada, esperada) => {
    expect(normalizarConfig(tipo, guardada)).toEqual(esperada);
  });

  it("si están la clave vieja y la del panel, gana la del panel y la vieja se va", () => {
    expect(normalizarConfig("crm_etapa", { etapa: "cotizado", etapaId: "negociando" })).toEqual({
      etapaId: "negociando",
    });
  });

  it("las claves que el contrato no conoce se conservan", () => {
    expect(normalizarConfig("msg_texto", { mensaje: "hola", otra: 1 })).toEqual({
      mensaje: "hola",
      otra: 1,
    });
  });

  it("no toca la config que recibe", () => {
    const guardada = { tagId: "t1" };
    normalizarConfig("crm_etiqueta_add", guardada);
    expect(guardada).toEqual({ tagId: "t1" });
  });
});

describe("config-nodos — configDeAccion (lo que lee cada acción)", () => {
  it("devuelve la config tipada, con los defaults que muestra el panel", () => {
    expect(configDeAccion("enviar_mensaje", nodo("msg_texto", { mensaje: "hola" }))).toEqual({
      mensaje: "hola",
      canal: "inferir",
      // Sin categoría es servicio; los campos de la plantilla de marketing
      // quedan en su default.
      categoria: "servicio",
      templateName: "",
      idioma: "es",
      parametros: [],
    });
  });

  it("lee el nodo legacy con sus claves viejas", () => {
    expect(
      configDeAccion(
        "cambiar_etapa",
        nodo("accion", { accion: "cambiar_etapa", etapa: "cotizado" }),
      ),
    ).toEqual({ etapaId: "cotizado" });
  });

  it("una config inválida es ValidationError que nombra el nodo, la acción y qué falta", () => {
    let error: unknown;
    try {
      configDeAccion("poner_etiqueta", nodo("crm_etiqueta_add", { tagIds: [] }, "n7"));
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ValidationError);
    const mensaje = (error as ValidationError).message;
    expect(mensaje).toContain('"n7"');
    expect(mensaje).toContain("poner_etiqueta");
    expect(mensaje).toContain("Selecciona una etiqueta");
  });
});

describe("config-nodos — revisarConfig (lo que mira el validador)", () => {
  it("separa errores de advertencias", () => {
    expect(revisarConfig(nodo("int_email", { para: "a@example.com" }))).toEqual({
      errores: [],
      advertencias: [
        { mensaje: "El email no tiene asunto" },
        { mensaje: "El email no tiene contenido" },
      ],
    });
  });

  it("trigger_cron sólo pide la expresión cuando la frecuencia es personalizada", () => {
    expect(
      revisarConfig(nodo("trigger_cron", { frecuencia: "diario", cron: "" }))?.errores,
    ).toEqual([]);
    expect(
      revisarConfig(nodo("trigger_cron", { frecuencia: "personalizado", cron: " " }))?.errores,
    ).toEqual(["Define la frecuencia de ejecución (expresión cron)"]);
  });

  it.each([
    ["crm_etapa", { etapaId: "perdido" }],
    ["crm_etapa", { etapaId: "requiere_humano" }],
    ["accion", { accion: "cambiar_etapa", etapa: "perdido" }],
    ["accion", { accion: "cambiar_etapa", etapa: "requiere_humano" }],
  ] as const)("%s a %o no se publica: los desvíos no son de un flujo", (tipo, config) => {
    expect(revisarConfig(nodo(tipo, { ...config }))?.errores).toHaveLength(1);
  });

  it("un texto obligatorio con sólo espacios cuenta como vacío", () => {
    expect(revisarConfig(nodo("msg_texto", { mensaje: "   " }))?.errores).toEqual([
      "El mensaje no puede estar vacío",
    ]);
  });
});

/**
 * "Asignar vendedor" y "Round Robin" todavía no tienen acción: su handler va
 * en otra tarea. El servicio que van a llamar ya existe
 * (`server/services/asignacion/asignacion.service.ts`), y estos tests fijan
 * que la config del bloque es lo que ese servicio recibe. Los tipos se chequean
 * en el typecheck de los tests: si el servicio cambia la forma, esto no compila.
 */
describe("config-nodos — lo que reciben los servicios de asignación", () => {
  const ROUND_ROBIN = ESPEC_CONFIG_POR_TIPO.crm_round_robin.schema;

  it("crm_vendedor da el vendedorId que recibe AsignacionService.asignar", () => {
    const cfg = ESPEC_CONFIG_POR_TIPO.crm_vendedor.schema.parse({ vendedorId: "u1" });
    const vendedorId: Parameters<AsignacionService["asignar"]>[1] = cfg.vendedorId;
    expect(vendedorId).toBe("u1");
  });

  it("crm_round_robin da los candidatos y el tope que recibe asignarPorRoundRobin", () => {
    const cfg = ROUND_ROBIN.parse({ candidatos: ["u1", "u2"], topeSesionesAbiertasPorVendedor: 2 });
    // El tope lleva la unidad en el nombre del campo (sesiones abiertas a la
    // vez); el servicio lo recibe como `tope`.
    const paraElServicio: ConfigRoundRobin = {
      candidatos: cfg.candidatos,
      tope: cfg.topeSesionesAbiertasPorVendedor,
    };
    expect(paraElServicio).toEqual({ candidatos: ["u1", "u2"], tope: 2 });
    expect(
      elegirVendedorRoundRobin(
        paraElServicio.candidatos.map((id) => ({ id, disponible: true })),
        [],
        { tope: paraElServicio.tope },
      ),
    ).toEqual({ tipo: "elegido", vendedorId: "u1" });
  });

  it("sin tope elegido, el round robin corre sin tope", () => {
    expect(ROUND_ROBIN.parse({ candidatos: ["u1"] }).topeSesionesAbiertasPorVendedor).toBeNull();
  });

  it.each([0, 1.5, -2])("un tope de %d lo rechaza el contrato igual que el round robin", (tope) => {
    expect(
      revisarConfig(
        nodo("crm_round_robin", { candidatos: ["u1"], topeSesionesAbiertasPorVendedor: tope }),
      )?.errores,
    ).toEqual(["El tope de sesiones abiertas por vendedor tiene que ser un entero mayor que cero"]);
    expect(() =>
      elegirVendedorRoundRobin([{ id: "u1", disponible: true }], [], { tope }),
    ).toThrow();
  });

  it("sin vendedores en la rotación es advertencia: el round robin no asigna a nadie", () => {
    expect(revisarConfig(nodo("crm_round_robin", {}))).toEqual({
      errores: [],
      advertencias: [
        { mensaje: "El round robin no tiene vendedores: no va a asignar ninguna sesión" },
      ],
    });
  });
});

describe("config-nodos — editorDeConfig (lo que usa el formulario)", () => {
  it("pinta las claves viejas en su campo y los defaults del schema", () => {
    const editor = editorDeConfig("msg_texto", { texto: "hola" });
    expect(editor.valores).toEqual({
      mensaje: "hola",
      canal: "inferir",
      categoria: "servicio",
      templateName: "",
      idioma: "es",
      parametros: [],
    });
  });

  it("al escribir, guarda sólo el campo tocado con la clave del panel", () => {
    // Sin el default de `canal`: el panel no escribe lo que nadie tocó, y
    // tampoco deja la clave vieja al lado de la nueva.
    const editor = editorDeConfig("msg_texto", { texto: "hola" });
    expect(editor.con("mensaje", "chau")).toEqual({ mensaje: "chau" });
  });

  it("al escribir, conserva lo que ya estaba", () => {
    const editor = editorDeConfig("crm_round_robin", {
      candidatos: ["u1"],
      topeSesionesAbiertasPorVendedor: 2,
    });
    expect(editor.con("candidatos", ["u1", "u2"])).toEqual({
      candidatos: ["u1", "u2"],
      topeSesionesAbiertasPorVendedor: 2,
    });
  });
});
