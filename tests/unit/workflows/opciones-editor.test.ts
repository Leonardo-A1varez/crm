import { describe, expect, it } from "vitest";
import {
  opcionesDeEtapas,
  opcionesDeIntents,
  opcionesDeVendedores,
} from "@/app/(panel)/workflows/[id]/_lib/opciones-editor";
import { CURRENT_STAGE } from "@/types/domain";
import type { Intent, Usuario } from "@/types/entities";

/**
 * Las opciones de los selectores de etapa, vendedor e intent del panel del
 * editor. Salían vacías porque la página sólo cargaba etiquetas.
 *
 * Lo delicado no es listar: es no esconder. Los formularios de `canvas/config/`
 * dibujan una selección guardada sólo si su id está entre las opciones, así que
 * filtrar a los inactivos haría desaparecer del panel un vendedor o un intent
 * que el flujo sigue usando. Se listan todos y el inactivo se marca.
 */

function intent(over: Partial<Intent> & Pick<Intent, "id" | "nombre">): Intent {
  return { descripcion: "", ejemplos: [], auto_detectado: false, activo: true, ...over };
}

function usuario(over: Partial<Usuario> & Pick<Usuario, "id" | "nombre">): Usuario {
  return {
    email: `${over.id}@crm.local`,
    rol: "vendedor",
    activo: true,
    created_at: new Date("2026-08-01T00:00:00Z"),
    ...over,
  };
}

describe("opcionesDeEtapas", () => {
  it("ofrece las ocho etapas en el orden del dominio, con su nombre de pantalla", () => {
    const opciones = opcionesDeEtapas();
    expect(opciones.map((o) => o.id)).toEqual([...CURRENT_STAGE]);
    expect(opciones.find((o) => o.id === "esperando_pago")?.nombre).toBe("Esperando pago");
    // Los desvíos también: un disparador puede escuchar «pasó a requiere humano».
    // «Cambiar etapa» los filtra en su selector (ConfigCRM).
    expect(opciones.find((o) => o.id === "requiere_humano")?.nombre).toBe("Requiere humano");
  });
});

describe("opcionesDeIntents", () => {
  it("activos primero, en orden alfabético, y el inactivo marcado en vez de escondido", () => {
    const opciones = opcionesDeIntents([
      intent({ id: "i3", nombre: "pide_factura" }),
      intent({ id: "i1", nombre: "consulta_stock", activo: false }),
      intent({ id: "i2", nombre: "cotizacion" }),
    ]);

    expect(opciones).toEqual([
      { id: "i2", nombre: "cotizacion" },
      { id: "i3", nombre: "pide_factura" },
      { id: "i1", nombre: "consulta_stock (inactivo)" },
    ]);
  });

  it("sin intents, sin opciones", () => {
    expect(opcionesDeIntents([])).toEqual([]);
  });
});

describe("opcionesDeVendedores", () => {
  it("lista a todo el equipo, activos primero y con acentos ordenados como en castellano", () => {
    const opciones = opcionesDeVendedores([
      usuario({ id: "u1", nombre: "Óscar", activo: false }),
      usuario({ id: "u2", nombre: "Ana" }),
      usuario({ id: "u3", nombre: "Álvaro", rol: "admin" }),
    ]);

    expect(opciones).toEqual([
      { id: "u3", nombre: "Álvaro" },
      { id: "u2", nombre: "Ana" },
      { id: "u1", nombre: "Óscar (inactivo)" },
    ]);
  });
});
