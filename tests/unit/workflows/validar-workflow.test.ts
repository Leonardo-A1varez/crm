import { describe, expect, it } from "vitest";
import { revisarConfig } from "@/lib/workflows/config-nodos";
import { puedePublicar, validarWorkflow } from "@/lib/workflows/validar-workflow";
import { esTrigger, type Grafo, type Nodo, type NodoTipo } from "@/types/workflows";

/**
 * La validación de configuración que corre antes de publicar
 * (`publicar` y `rollbackAVersion` del servicio). Lo que se prueba acá es que lee las mismas claves que
 * escribe el panel: antes pedía `tag_id`, `etapa`, `vendedor_id`,
 * `template_name`… y el panel guardaba `tagIds`, `etapaId`, `vendedorId`,
 * `templateName`, así que un bloque bien configurado no se podía publicar.
 */

function bloque(id: string, tipo: NodoTipo, config: Record<string, unknown> = {}): Nodo {
  return { id, tipo, config, posicion: { x: 0, y: 0 } };
}

/**
 * Un flujo mínimo alrededor del bloque `x`. Si el bloque es un disparador,
 * arranca él; si no, lo precede uno manual. Siempre termina en Detener.
 */
function flujoCon(tipo: NodoTipo, config: Record<string, unknown>): Grafo {
  const x = bloque("x", tipo, config);
  const fin = bloque("fin", "logica_detener");
  if (esTrigger(tipo)) {
    return { nodos: [x, fin], aristas: [{ desde: "x", hasta: "fin", puerto: "salida" }] };
  }
  return {
    nodos: [bloque("t", "trigger_manual"), x, fin],
    aristas: [
      { desde: "t", hasta: "x", puerto: "salida" },
      { desde: "x", hasta: "fin", puerto: "salida" },
    ],
  };
}

describe("validarWorkflow — config de los bloques", () => {
  it.each<[NodoTipo, Record<string, unknown>]>([
    ["crm_etiqueta_add", { tagIds: ["t1"] }],
    ["crm_etapa", { etapaId: "cotizado" }],
    ["crm_vendedor", { vendedorId: "u1" }],
    ["crm_round_robin", { candidatos: ["u1", "u2"], topeSesionesAbiertasPorVendedor: 3 }],
    ["crm_escalar_humano", { avisarAlCliente: false }],
    ["trigger_vendedor_asignado", {}],
    ["trigger_etiqueta", { tagId: "t1" }],
    ["trigger_etiqueta_removida", { tagId: "t1" }],
    ["trigger_etapa", { etapaDestino: "cotizado" }],
    // La plantilla "reactivar perdidos" (`grafos-plantillas.ts`) lo precarga así.
    ["trigger_cron", { frecuencia: "semanal", hora: "09:00", dias: [0] }],
    // Estos tres el panel los muestra con un valor (24 horas, 1 hora, 24 horas)
    // que no escribe hasta que alguien toca el campo.
    ["trigger_inactividad", {}],
    ["logica_esperar", {}],
    ["logica_esperar_respuesta", {}],
    // El legacy `espera`: el motor lee `minutos`.
    ["espera", { minutos: 30 }],
  ])("%s configurado con las claves del panel no tiene errores", (tipo, config) => {
    expect(validarWorkflow(flujoCon(tipo, config))).toEqual([]);
  });

  // Los que el motor todavía no ejecuta: el validador los rechaza por eso
  // (`disponibilidad.test.ts`), así que el contrato de claves se mira en la
  // revisión de config, que es la que va a usar el validador el día que tengan
  // handler.
  it.each<[NodoTipo, Record<string, unknown>]>([
    ["crm_etiqueta_remove", { tagIds: ["t1"] }],
    ["msg_documento", { url: "https://example.com/catalogo.pdf", nombreArchivo: "catalogo.pdf" }],
    ["int_email", { para: "compras@example.com", asunto: "Cotización", cuerpo: "Hola" }],
  ])("%s (no disponible) con las claves del panel pasa la revisión de config", (tipo, config) => {
    expect(revisarConfig({ tipo, config })?.errores).toEqual([]);
  });

  it("un bloque sin lo obligatorio da error sobre su nodo y bloquea publicar", () => {
    const errores = validarWorkflow(flujoCon("msg_texto", {}));
    expect(errores).toEqual([
      { tipo: "error", nodoId: "x", mensaje: "El mensaje no puede estar vacío" },
    ]);
    expect(puedePublicar(errores)).toBe(false);
  });

  it("mover a un desvío es error: la acción `cambiar_etapa` no lo ejecuta", () => {
    const errores = validarWorkflow(flujoCon("crm_etapa", { etapaId: "requiere_humano" }));
    expect(errores).toHaveLength(1);
    expect(errores[0]).toMatchObject({ tipo: "error", nodoId: "x" });
    expect(errores[0]?.mensaje).toContain("requiere_humano");
  });

  it("las advertencias salen sobre su nodo y no bloquean publicar", () => {
    const errores = validarWorkflow(flujoCon("crm_round_robin", { candidatos: [] }));
    expect(errores).toEqual([
      {
        tipo: "warning",
        nodoId: "x",
        mensaje: "El round robin no tiene vendedores: no va a asignar ninguna sesión",
      },
    ]);
    expect(puedePublicar(errores)).toBe(true);
  });

  it("las advertencias de config salen en la revisión y no son errores", () => {
    const revision = revisarConfig({ tipo: "crm_round_robin", config: { candidatos: [] } });
    expect(revision).toEqual({
      errores: [],
      advertencias: [
        { mensaje: "El round robin no tiene vendedores: no va a asignar ninguna sesión" },
      ],
    });
  });

  it("un nodo legacy que declara una acción que el motor no conoce es error", () => {
    const errores = validarWorkflow(flujoCon("accion", { accion: "inventada" }));
    expect(errores).toHaveLength(1);
    expect(errores[0]).toMatchObject({ tipo: "error", nodoId: "x" });
    expect(errores[0]?.mensaje).toContain("inventada");
  });
});

/**
 * Un flujo con una condición `x` entre el disparador y dos finales, uno por
 * salida, para que la estructura no tenga nada que decir.
 */
function flujoConCondicion(config: Record<string, unknown>): Grafo {
  return {
    nodos: [
      bloque("t", "trigger_manual"),
      bloque("x", "logica_condicion", config),
      bloque("si", "logica_detener"),
      bloque("no", "logica_detener"),
    ],
    aristas: [
      { desde: "t", hasta: "x", puerto: "salida" },
      { desde: "x", hasta: "si", puerto: "verdadero" },
      { desde: "x", hasta: "no", puerto: "falso" },
    ],
  };
}

// Árbol armado a mano para el test, con campos de la lista blanca del motor.
const ARBOL_COMPLETO = {
  id: "g",
  clase: "grupo",
  operador: "y",
  hijos: [
    {
      id: "r1",
      clase: "regla",
      campoId: "lead.etapa",
      comparador: "es",
      valor: { tipo: "opcion", valor: "cotizado" },
    },
  ],
};

describe("validarWorkflow — la condición, en los dos formatos que lee el motor", () => {
  it("una condición en árbol completa no tiene errores", () => {
    expect(validarWorkflow(flujoConCondicion({ arbol: ARBOL_COMPLETO }))).toEqual([]);
  });

  it("el trío viejo completo sigue valiendo, igual que en el evaluador", () => {
    expect(
      validarWorkflow(
        flujoConCondicion({ campo: "lead.etapa", operador: "es", valor: "cotizado" }),
      ),
    ).toEqual([]);
  });

  it("el trío viejo sin operador vale: el evaluador lo lee como `es`", () => {
    expect(validarWorkflow(flujoConCondicion({ campo: "lead.nombre", valor: "Ana" }))).toEqual([]);
  });

  it("un árbol con una fila sin campo es error sobre su nodo, con el mensaje del motor", () => {
    const incompleto = {
      ...ARBOL_COMPLETO,
      hijos: [
        { id: "r1", clase: "regla", campoId: null, comparador: null, valor: { tipo: "ninguno" } },
      ],
    };
    const errores = validarWorkflow(flujoConCondicion({ arbol: incompleto }));
    expect(errores).toEqual([{ tipo: "error", nodoId: "x", mensaje: "la fila 1 no tiene campo" }]);
    expect(puedePublicar(errores)).toBe(false);
  });

  it("un árbol sin filas es error", () => {
    const errores = validarWorkflow(flujoConCondicion({ arbol: { ...ARBOL_COMPLETO, hijos: [] } }));
    expect(errores).toEqual([
      { tipo: "error", nodoId: "x", mensaje: "la condición no tiene ninguna fila" },
    ]);
  });

  it("la condición recién soltada, sin nada elegido, es error", () => {
    const errores = validarWorkflow(flujoConCondicion({}));
    expect(errores).toEqual([
      { tipo: "error", nodoId: "x", mensaje: "Selecciona un campo para la condición" },
    ]);
  });
});
