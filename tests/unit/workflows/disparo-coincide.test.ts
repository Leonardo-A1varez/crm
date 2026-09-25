import { describe, expect, it } from "vitest";
import { disparoCoincide } from "@/lib/workflows/recorrer";
import type { Grafo, Nodo, NodoTipo } from "@/types/workflows";

function nodo(id: string, tipo: NodoTipo, config: Record<string, unknown> = {}): Nodo {
  return { id, tipo, config, posicion: { x: 0, y: 0 } };
}

function grafoConTrigger(tipo: NodoTipo, config: Record<string, unknown> = {}): Grafo {
  return {
    nodos: [nodo("t", tipo, config), nodo("fin", "logica_detener")],
    aristas: [{ desde: "t", hasta: "fin", puerto: "salida" }],
  };
}

/**
 * Los filtros son la configuración que el panel del canvas escribe en el nodo
 * trigger (`ConfigTrigger.tsx`). Si el motor los ignorara, "cuando se le pone
 * la etiqueta X" arrancaría con cualquier etiqueta: el flujo mandaría mensajes
 * a leads que nadie eligió.
 */
describe("disparoCoincide — trigger_etiqueta", () => {
  const g = grafoConTrigger("trigger_etiqueta", { tagId: "t1" });

  it("arranca con la etiqueta configurada", () => {
    expect(disparoCoincide(g, "etiqueta_asignada", { tagId: "t1" })).toBe(true);
  });

  it("no arranca con otra etiqueta", () => {
    expect(disparoCoincide(g, "etiqueta_asignada", { tagId: "t2" })).toBe(false);
  });

  it("sin etiqueta configurada no arranca con ninguna (falla cerrado)", () => {
    const sinTag = grafoConTrigger("trigger_etiqueta");
    expect(disparoCoincide(sinTag, "etiqueta_asignada", { tagId: "t1" })).toBe(false);
  });

  it("un evento sin datos de etiqueta no la satisface", () => {
    expect(disparoCoincide(g, "etiqueta_asignada", {})).toBe(false);
  });
});

describe("disparoCoincide — trigger_etapa", () => {
  it("arranca cuando la etapa nueva es la de destino", () => {
    const g = grafoConTrigger("trigger_etapa", { etapaDestino: "cotizado" });
    expect(
      disparoCoincide(g, "etapa_cambiada", { etapaAnterior: "nuevo", etapaNueva: "cotizado" }),
    ).toBe(true);
    expect(
      disparoCoincide(g, "etapa_cambiada", { etapaAnterior: "nuevo", etapaNueva: "identificando" }),
    ).toBe(false);
  });

  it("la etapa de origen filtra cuando no es 'cualquiera'", () => {
    const g = grafoConTrigger("trigger_etapa", {
      etapaOrigen: "identificando",
      etapaDestino: "cotizado",
    });
    expect(
      disparoCoincide(g, "etapa_cambiada", {
        etapaAnterior: "identificando",
        etapaNueva: "cotizado",
      }),
    ).toBe(true);
    expect(
      disparoCoincide(g, "etapa_cambiada", { etapaAnterior: "nuevo", etapaNueva: "cotizado" }),
    ).toBe(false);
  });

  it("'cualquiera' y la ausencia de origen no filtran — es el default que muestra el panel", () => {
    const cualquiera = grafoConTrigger("trigger_etapa", {
      etapaOrigen: "cualquiera",
      etapaDestino: "cotizado",
    });
    const sinOrigen = grafoConTrigger("trigger_etapa", { etapaDestino: "cotizado" });
    const datos = { etapaAnterior: "negociando" as const, etapaNueva: "cotizado" as const };
    expect(disparoCoincide(cualquiera, "etapa_cambiada", datos)).toBe(true);
    expect(disparoCoincide(sinOrigen, "etapa_cambiada", datos)).toBe(true);
  });

  it("sin etapa de destino no arranca (falla cerrado)", () => {
    const g = grafoConTrigger("trigger_etapa");
    expect(disparoCoincide(g, "etapa_cambiada", { etapaNueva: "cotizado" })).toBe(false);
  });
});

describe("disparoCoincide — trigger_mensaje", () => {
  it("sin configuración arranca con cualquier mensaje", () => {
    const g = grafoConTrigger("trigger_mensaje");
    expect(
      disparoCoincide(g, "mensaje_recibido", { canal: "wa", tipoMensaje: "text", texto: "hola" }),
    ).toBe(true);
  });

  it("el canal del panel (whatsapp/instagram/messenger) se compara contra el del dominio", () => {
    const wa = grafoConTrigger("trigger_mensaje", { canal: "whatsapp" });
    const ig = grafoConTrigger("trigger_mensaje", { canal: "instagram" });
    const fb = grafoConTrigger("trigger_mensaje", { canal: "messenger" });
    const todos = grafoConTrigger("trigger_mensaje", { canal: "todos" });
    const datos = { canal: "wa" as const, tipoMensaje: "text" as const, texto: "hola" };
    expect(disparoCoincide(wa, "mensaje_recibido", datos)).toBe(true);
    expect(disparoCoincide(ig, "mensaje_recibido", datos)).toBe(false);
    expect(disparoCoincide(fb, "mensaje_recibido", { ...datos, canal: "fb" })).toBe(true);
    expect(disparoCoincide(todos, "mensaje_recibido", datos)).toBe(true);
  });

  it("solo_texto y solo_media miran el tipo del mensaje", () => {
    const texto = grafoConTrigger("trigger_mensaje", { filtro: "solo_texto" });
    const media = grafoConTrigger("trigger_mensaje", { filtro: "solo_media" });
    const deTexto = { canal: "wa" as const, tipoMensaje: "text" as const, texto: "hola" };
    const imagen = { canal: "wa" as const, tipoMensaje: "image" as const, texto: null };
    expect(disparoCoincide(texto, "mensaje_recibido", deTexto)).toBe(true);
    expect(disparoCoincide(texto, "mensaje_recibido", imagen)).toBe(false);
    expect(disparoCoincide(media, "mensaje_recibido", imagen)).toBe(true);
    expect(disparoCoincide(media, "mensaje_recibido", deTexto)).toBe(false);
  });

  it("contiene busca la palabra sin distinguir mayúsculas", () => {
    const g = grafoConTrigger("trigger_mensaje", { filtro: "contiene", palabra: "promo" });
    expect(
      disparoCoincide(g, "mensaje_recibido", {
        canal: "wa",
        tipoMensaje: "text",
        texto: "¿Tienen PROMO de frenos?",
      }),
    ).toBe(true);
    expect(
      disparoCoincide(g, "mensaje_recibido", {
        canal: "wa",
        tipoMensaje: "text",
        texto: "hola",
      }),
    ).toBe(false);
  });

  it("contiene con la palabra vacía no arranca con todo (falla cerrado)", () => {
    const g = grafoConTrigger("trigger_mensaje", { filtro: "contiene", palabra: "  " });
    expect(
      disparoCoincide(g, "mensaje_recibido", { canal: "wa", tipoMensaje: "text", texto: "hola" }),
    ).toBe(false);
  });

  it("un valor de filtro o canal que el motor no conoce no arranca", () => {
    const filtroRaro = grafoConTrigger("trigger_mensaje", { filtro: "regex" });
    const canalRaro = grafoConTrigger("trigger_mensaje", { canal: "telegram" });
    const datos = { canal: "wa" as const, tipoMensaje: "text" as const, texto: "hola" };
    expect(disparoCoincide(filtroRaro, "mensaje_recibido", datos)).toBe(false);
    expect(disparoCoincide(canalRaro, "mensaje_recibido", datos)).toBe(false);
  });
});

describe("disparoCoincide — trigger_etiqueta_removida", () => {
  const g = grafoConTrigger("trigger_etiqueta_removida", { tagId: "t1" });

  it("arranca sólo con la etiqueta configurada", () => {
    expect(disparoCoincide(g, "etiqueta_removida", { tagId: "t1" })).toBe(true);
    expect(disparoCoincide(g, "etiqueta_removida", { tagId: "t2" })).toBe(false);
  });

  it("acepta la clave vieja `tag_id` que el contrato normaliza", () => {
    const viejo = grafoConTrigger("trigger_etiqueta_removida", { tag_id: "t1" });
    expect(disparoCoincide(viejo, "etiqueta_removida", { tagId: "t1" })).toBe(true);
  });

  it("no la confunde con la etiqueta asignada", () => {
    expect(disparoCoincide(g, "etiqueta_asignada", { tagId: "t1" })).toBe(false);
  });
});

describe("disparoCoincide — trigger_manual", () => {
  it("coincide con el disparo manual: el flujo lo eligió quien lo disparó", () => {
    expect(disparoCoincide(grafoConTrigger("trigger_manual"), "manual", {})).toBe(true);
  });

  it("no coincide con otro evento", () => {
    expect(disparoCoincide(grafoConTrigger("trigger_manual"), "mensaje_recibido", {})).toBe(false);
  });
});

describe("disparoCoincide — reglas generales", () => {
  it("un evento de otro disparador no coincide aunque los datos sí", () => {
    const g = grafoConTrigger("trigger_etiqueta", { tagId: "t1" });
    expect(disparoCoincide(g, "mensaje_recibido", { tagId: "t1" })).toBe(false);
  });

  it("el disparador legacy matchea sólo por nombre: no tiene filtros", () => {
    const legacy: Grafo = {
      nodos: [nodo("d", "disparador", { disparador: "etiqueta_asignada" }), nodo("f", "fin")],
      aristas: [{ desde: "d", hasta: "f", puerto: "salida" }],
    };
    expect(disparoCoincide(legacy, "etiqueta_asignada", { tagId: "cualquiera" })).toBe(true);
  });

  it("un grafo sin disparador no coincide con nada", () => {
    const sinTrigger: Grafo = { nodos: [nodo("f", "fin")], aristas: [] };
    expect(disparoCoincide(sinTrigger, "mensaje_recibido", {})).toBe(false);
  });
});
