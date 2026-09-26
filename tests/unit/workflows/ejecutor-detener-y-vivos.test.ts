import { describe, expect, it, vi } from "vitest";
import type { Grupo } from "@/lib/ui/condiciones";
import { crearRegistro } from "@/server/services/workflows/acciones/registro";
import {
  ejecutarSegmento,
  type EjecutorDeps,
  type PasoEjecutado,
} from "@/server/services/workflows/ejecutor.service";
import type { Grafo } from "@/types/workflows";

// Fixtures armados a mano para estos tests: no salen de ningún dato real.
// trigger -> condición -> (si: poner etiqueta -> cambiar etapa -> fin | no: fin)
function grafo(arbol: Grupo): Grafo {
  return {
    nodos: [
      { id: "t", tipo: "trigger_manual", config: {}, posicion: { x: 0, y: 0 } },
      { id: "c", tipo: "logica_condicion", config: { arbol }, posicion: { x: 0, y: 1 } },
      { id: "a1", tipo: "crm_etiqueta_add", config: {}, posicion: { x: 0, y: 2 } },
      { id: "a2", tipo: "crm_etapa", config: {}, posicion: { x: 0, y: 3 } },
      { id: "fin", tipo: "fin", config: {}, posicion: { x: 0, y: 4 } },
      { id: "no", tipo: "fin", config: {}, posicion: { x: 1, y: 2 } },
    ],
    aristas: [
      { desde: "t", hasta: "c", puerto: "salida" },
      { desde: "c", hasta: "a1", puerto: "verdadero" },
      { desde: "c", hasta: "no", puerto: "falso" },
      { desde: "a1", hasta: "a2", puerto: "salida" },
      { desde: "a2", hasta: "fin", puerto: "salida" },
    ],
  };
}

const MARCA_TOYOTA: Grupo = {
  id: "g",
  clase: "grupo",
  operador: "y",
  hijos: [
    {
      id: "r",
      clase: "regla",
      campoId: "vehiculo.marca",
      comparador: "es",
      valor: { tipo: "texto", valor: "Toyota" },
    },
  ],
};

const ETAPA_NUEVO: Grupo = {
  id: "g",
  clase: "grupo",
  operador: "y",
  hijos: [
    {
      id: "r",
      clase: "regla",
      campoId: "lead.etapa",
      comparador: "es",
      valor: { tipo: "opcion", valor: "nuevo" },
    },
  ],
};

function montar(extra: Partial<EjecutorDeps> = {}) {
  const ejecutadas: string[] = [];
  const pasos: PasoEjecutado[] = [];
  const handler = async (nodo: { id: string }) => {
    ejecutadas.push(nodo.id);
    return { puerto: "salida" as const };
  };
  const deps: EjecutorDeps = {
    registro: crearRegistro({ poner_etiqueta: handler, cambiar_etapa: handler }),
    ahora: () => new Date("2026-09-25T15:00:00Z"),
    onPaso: async (p) => {
      pasos.push(p);
    },
    ...extra,
  };
  return { deps, ejecutadas, pasos };
}

const BASE = {
  desdeNodo: "t",
  leadId: "lead-1",
  leadSessionId: "sesion-1",
  runId: "run-1",
  pasosPrevios: 0,
  maxPasos: 50,
};

describe("campos vivos de la condición", () => {
  it("se leen de la base al evaluar y deciden la rama", async () => {
    const cargar = vi.fn(async () => ({ vehiculo: { marca: "Toyota" } }));
    const { deps, pasos } = montar({
      camposVivos: { cargar, zona: async () => "America/Lima" },
    });
    const r = await ejecutarSegmento({ ...BASE, grafo: grafo(MARCA_TOYOTA), contexto: {} }, deps);
    expect(r).toEqual({ tipo: "fin" });
    expect(pasos.map((p) => p.nodoId)).toEqual(["t", "c", "a1", "a2", "fin"]);
    expect(cargar).toHaveBeenCalledWith({
      leadId: "lead-1",
      leadSessionId: "sesion-1",
      campos: new Set(["vehiculo.marca"]),
    });
  });

  it("no se guardan en el contexto de la corrida", async () => {
    const { deps } = montar({
      camposVivos: {
        cargar: async () => ({ vehiculo: { marca: "Toyota" } }),
        zona: async () => "UTC",
      },
    });
    const g = grafo(MARCA_TOYOTA);
    // Una espera después de la condición devuelve el contexto que se persiste.
    g.nodos.push({
      id: "e",
      tipo: "logica_esperar",
      config: { duracion: 1, unidad: "horas" },
      posicion: { x: 0, y: 5 },
    });
    g.aristas = g.aristas.map((a) => (a.desde === "a2" ? { ...a, hasta: "e" } : a));
    g.aristas.push({ desde: "e", hasta: "fin", puerto: "salida" });
    const r = await ejecutarSegmento(
      { ...BASE, grafo: g, contexto: { lead: { nombre: "A" } } },
      deps,
    );
    expect(r.tipo).toBe("espera");
    expect(r.tipo === "espera" ? r.contexto : null).toEqual({ lead: { nombre: "A" } });
  });

  it("una condición sin campos vivos no consulta la base", async () => {
    const cargar = vi.fn(async () => ({}));
    const { deps } = montar({ camposVivos: { cargar, zona: async () => "UTC" } });
    await ejecutarSegmento(
      { ...BASE, grafo: grafo(ETAPA_NUEVO), contexto: { lead: { etapa: "nuevo" } } },
      deps,
    );
    expect(cargar).not.toHaveBeenCalled();
  });

  it("sin cargador, un campo vivo queda ausente y la condición va por 'falso'", async () => {
    const { deps, pasos } = montar();
    await ejecutarSegmento({ ...BASE, grafo: grafo(MARCA_TOYOTA), contexto: {} }, deps);
    expect(pasos.map((p) => p.nodoId)).toEqual(["t", "c", "no"]);
  });
});

describe("detenerEn — 'Ejecutar hasta acá'", () => {
  it("frena al llegar al nodo elegido, sin ejecutarlo ni registrarlo", async () => {
    const { deps, ejecutadas, pasos } = montar();
    const r = await ejecutarSegmento(
      {
        ...BASE,
        grafo: grafo(ETAPA_NUEVO),
        contexto: { lead: { etapa: "nuevo" } },
        detenerEn: "a2",
      },
      deps,
    );
    expect(r).toEqual({ tipo: "detenido", nodoId: "a2", causa: "hasta_aca" });
    expect(ejecutadas).toEqual(["a1"]);
    expect(pasos.map((p) => p.nodoId)).toEqual(["t", "c", "a1"]);
  });

  it("si el recorrido no pasa por el nodo, corre hasta el final como siempre", async () => {
    const { deps, pasos } = montar();
    const r = await ejecutarSegmento(
      {
        ...BASE,
        grafo: grafo(ETAPA_NUEVO),
        contexto: { lead: { etapa: "otra" } },
        detenerEn: "a2",
      },
      deps,
    );
    expect(r).toEqual({ tipo: "fin" });
    expect(pasos.map((p) => p.nodoId)).toEqual(["t", "c", "no"]);
  });
});

describe("seguir — una corrida cancelada no ejecuta la acción siguiente", () => {
  it("se pregunta antes de cada acción y, con 'no', corta sin ejecutarla", async () => {
    let llamadas = 0;
    const seguir = vi.fn(async () => {
      llamadas += 1;
      return llamadas < 2; // la cancelan después de la primera acción
    });
    const { deps, ejecutadas, pasos } = montar({ seguir });
    const r = await ejecutarSegmento(
      { ...BASE, grafo: grafo(ETAPA_NUEVO), contexto: { lead: { etapa: "nuevo" } } },
      deps,
    );
    expect(r).toEqual({ tipo: "detenido", nodoId: "a2", causa: "cancelada" });
    expect(ejecutadas).toEqual(["a1"]);
    expect(pasos.map((p) => p.nodoId)).toEqual(["t", "c", "a1"]);
    // Sólo antes de acciones: el disparador y la condición no escriben afuera.
    expect(seguir).toHaveBeenCalledTimes(2);
  });
});
