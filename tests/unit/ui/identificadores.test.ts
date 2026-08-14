import { describe, expect, test } from "vitest";
import {
  IDENTIFICADOR_AYUDA,
  IDENTIFICADOR_LABEL,
  agruparIdentificadores,
  origenLabel,
  valorVisible,
} from "@/lib/ui/identificadores";
import { IDENTIFICADOR_TIPO } from "@/types/domain";
import type { IdentificadorTipo } from "@/types/domain";
import type { LeadIdentificador } from "@/types/entities";

function identificador(over: Partial<LeadIdentificador> = {}): LeadIdentificador {
  return {
    id: crypto.randomUUID(),
    lead_id: "11111111-1111-4111-8111-111111111111",
    tipo: "telefono",
    valor: "5491155550002",
    valor_original: null,
    principal: false,
    origen: "manual",
    created_at: new Date("2026-08-01T00:00:00Z"),
    ...over,
  };
}

describe("rótulos", () => {
  test("hay label y ayuda para cada tipo del enum", () => {
    for (const tipo of IDENTIFICADOR_TIPO) {
      expect(IDENTIFICADOR_LABEL[tipo]).not.toBe("");
      expect(IDENTIFICADOR_AYUDA[tipo]).not.toBe("");
    }
  });

  test("`ruc` no se rotula RUC: el mercado son seis países con seis nombres", () => {
    expect(IDENTIFICADOR_LABEL.ruc).toBe("Documento fiscal");
    // Los nombres locales viven en la ayuda, que es donde sirven.
    expect(IDENTIFICADOR_AYUDA.ruc).toContain("CNPJ");
  });
});

describe("origenLabel", () => {
  test("traduce los cuatro orígenes conocidos", () => {
    expect(origenLabel("meta")).toBe("llegó por el canal");
    expect(origenLabel("manual")).toBe("cargado a mano");
    expect(origenLabel("extractor")).toBe("lo dijo el cliente");
    expect(origenLabel("merge")).toBe("vino de una fusión");
  });

  test("un origen desconocido se muestra tal cual", () => {
    // `origen` es `text` en la base: ver un valor raro es mejor que no ver nada.
    expect(origenLabel("importacion_erp")).toBe("importacion_erp");
  });
});

describe("valorVisible", () => {
  test("muestra lo que escribió la persona", () => {
    const i = identificador({ valor: "5491155550002", valor_original: "+54 9 11 5555-0002" });
    expect(valorVisible(i)).toBe("+54 9 11 5555-0002");
  });

  test("cae al normalizado cuando no hay original", () => {
    expect(valorVisible(identificador({ valor: "5491155550002", valor_original: null }))).toBe(
      "5491155550002",
    );
    expect(valorVisible(identificador({ valor: "5491155550002", valor_original: "   " }))).toBe(
      "5491155550002",
    );
  });
});

describe("agruparIdentificadores", () => {
  test("los grupos salen en el orden del enum, no en el de llegada", () => {
    const items = [
      identificador({ tipo: "vin", valor: "1HGBH41JXMN109186" }),
      identificador({ tipo: "email", valor: "a@b.com" }),
      identificador({ tipo: "telefono" }),
    ];
    expect(agruparIdentificadores(items).map((g) => g.tipo)).toEqual<IdentificadorTipo[]>([
      "telefono",
      "email",
      "vin",
    ]);
  });

  test("un tipo sin filas no aparece como grupo vacío", () => {
    const grupos = agruparIdentificadores([identificador({ tipo: "placa", valor: "AB123CD" })]);
    expect(grupos).toHaveLength(1);
    expect(grupos[0]?.label).toBe("Placa");
  });

  test("sin identificadores no hay grupos", () => {
    expect(agruparIdentificadores([])).toEqual([]);
  });

  test("dentro del grupo manda `principal`, después la antigüedad", () => {
    const viejo = identificador({ valor: "111", created_at: new Date("2026-01-01T00:00:00Z") });
    const nuevo = identificador({ valor: "222", created_at: new Date("2026-06-01T00:00:00Z") });
    const elPrincipal = identificador({
      valor: "333",
      principal: true,
      created_at: new Date("2026-12-01T00:00:00Z"),
    });

    const items = agruparIdentificadores([nuevo, elPrincipal, viejo])[0]?.items ?? [];
    expect(items.map((i) => i.valor)).toEqual(["333", "111", "222"]);
  });

  test("con la misma fecha desempata el id, así el orden no baila entre renders", () => {
    // Una fusión inserta varias filas en el mismo milisegundo.
    const fecha = new Date("2026-08-01T00:00:00Z");
    const b = identificador({
      id: "bbbbbbbb-0000-4000-8000-000000000000",
      valor: "b",
      created_at: fecha,
    });
    const a = identificador({
      id: "aaaaaaaa-0000-4000-8000-000000000000",
      valor: "a",
      created_at: fecha,
    });

    expect((agruparIdentificadores([b, a])[0]?.items ?? []).map((i) => i.valor)).toEqual([
      "a",
      "b",
    ]);
  });

  test("no muta el arreglo que recibe", () => {
    const items = [
      identificador({ valor: "111" }),
      identificador({ valor: "222", principal: true }),
    ];
    agruparIdentificadores(items);
    expect(items.map((i) => i.valor)).toEqual(["111", "222"]);
  });
});
