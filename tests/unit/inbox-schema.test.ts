import { describe, expect, test } from "vitest";
import {
  AgregarDatoLeadSchema,
  AsignarEtiquetaSchema,
  BorrarDatoExtraSchema,
  CloseSessionSchema,
  CrearEtiquetaSchema,
  MoverEtapaSchema,
  QuitarEtiquetaSchema,
  RenombrarLeadSchema,
  SendMessageSchema,
  ToggleHandoffSchema,
} from "@/lib/validation/inbox.schema";

// v4 RFC 4122 válidos: zod 4 `.uuid()` valida version+variant bits.
const LEAD_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";

describe("SendMessageSchema", () => {
  test("acepta input válido y trimea body", () => {
    const parsed = SendMessageSchema.parse({
      leadId: LEAD_ID,
      sessionId: SESSION_ID,
      canal: "wa",
      body: "  hola  ",
    });
    expect(parsed.body).toBe("hola");
    expect(parsed.canal).toBe("wa");
  });

  test("rechaza body vacío post-trim", () => {
    const result = SendMessageSchema.safeParse({
      leadId: LEAD_ID,
      sessionId: SESSION_ID,
      canal: "wa",
      body: "   ",
    });
    expect(result.success).toBe(false);
  });

  test("rechaza body > 4096 chars", () => {
    const result = SendMessageSchema.safeParse({
      leadId: LEAD_ID,
      sessionId: SESSION_ID,
      canal: "wa",
      body: "x".repeat(4097),
    });
    expect(result.success).toBe(false);
  });

  test("rechaza canal fuera de enum", () => {
    const result = SendMessageSchema.safeParse({
      leadId: LEAD_ID,
      sessionId: SESSION_ID,
      canal: "sms",
      body: "hola",
    });
    expect(result.success).toBe(false);
  });

  test("rechaza leadId no-uuid", () => {
    const result = SendMessageSchema.safeParse({
      leadId: "no-uuid",
      sessionId: SESSION_ID,
      canal: "wa",
      body: "hola",
    });
    expect(result.success).toBe(false);
  });
});

describe("ToggleHandoffSchema", () => {
  test("acepta pause y resume", () => {
    for (const action of ["pause", "resume"] as const) {
      const parsed = ToggleHandoffSchema.parse({
        leadId: LEAD_ID,
        sessionId: SESSION_ID,
        action,
      });
      expect(parsed.action).toBe(action);
    }
  });

  test("rechaza action desconocida", () => {
    const result = ToggleHandoffSchema.safeParse({
      leadId: LEAD_ID,
      sessionId: SESSION_ID,
      action: "stop",
    });
    expect(result.success).toBe(false);
  });
});

describe("CloseSessionSchema", () => {
  test("acepta exito sin motivo", () => {
    const parsed = CloseSessionSchema.parse({
      leadId: LEAD_ID,
      sessionId: SESSION_ID,
      resultado: "exito",
    });
    expect(parsed.resultado).toBe("exito");
  });

  test("acepta perdido con motivo enum", () => {
    const parsed = CloseSessionSchema.parse({
      leadId: LEAD_ID,
      sessionId: SESSION_ID,
      resultado: "perdido",
      motivoPerdida: "precio",
    });
    expect(parsed.resultado).toBe("perdido");
    if (parsed.resultado === "perdido") expect(parsed.motivoPerdida).toBe("precio");
  });

  // La regla del pedido: el motivo no es opcional cuando se perdió, y el
  // endpoint lo tiene que rechazar aunque la UI haya deshabilitado el botón.
  test("rechaza perdido sin motivo", () => {
    const result = CloseSessionSchema.safeParse({
      leadId: LEAD_ID,
      sessionId: SESSION_ID,
      resultado: "perdido",
    });
    expect(result.success).toBe(false);
  });

  test("rechaza perdido con motivo null", () => {
    const result = CloseSessionSchema.safeParse({
      leadId: LEAD_ID,
      sessionId: SESSION_ID,
      resultado: "perdido",
      motivoPerdida: null,
    });
    expect(result.success).toBe(false);
  });

  test("un cierre ganado no arrastra motivo de pérdida", () => {
    const parsed = CloseSessionSchema.parse({
      leadId: LEAD_ID,
      sessionId: SESSION_ID,
      resultado: "exito",
      motivoPerdida: "precio",
    });
    expect(parsed).not.toHaveProperty("motivoPerdida");
  });

  test("rechaza motivo fuera del enum", () => {
    const result = CloseSessionSchema.safeParse({
      leadId: LEAD_ID,
      sessionId: SESSION_ID,
      resultado: "perdido",
      motivoPerdida: "caro",
    });
    expect(result.success).toBe(false);
  });

  test("rechaza resultado fuera del enum", () => {
    const result = CloseSessionSchema.safeParse({
      leadId: LEAD_ID,
      sessionId: SESSION_ID,
      resultado: "cancelado",
    });
    expect(result.success).toBe(false);
  });
});

describe("MoverEtapaSchema", () => {
  test("acepta las seis etapas del embudo", () => {
    for (const etapa of [
      "nuevo",
      "identificando",
      "cotizado",
      "negociando",
      "esperando_pago",
      "cerrado",
    ]) {
      const result = MoverEtapaSchema.safeParse({
        leadId: LEAD_ID,
        sessionId: SESSION_ID,
        etapa,
      });
      expect(result.success).toBe(true);
    }
  });

  test("rechaza los desvíos: no son segmentos del rail", () => {
    // `perdido` y `requiere_humano` los decide el pipeline (escalado, descuento
    // excedido, cierre). Aceptarlos acá sería marcar una conversación como
    // perdida sin pasar por el cierre de sesión, que es el que pide el motivo.
    for (const etapa of ["perdido", "requiere_humano"]) {
      const result = MoverEtapaSchema.safeParse({
        leadId: LEAD_ID,
        sessionId: SESSION_ID,
        etapa,
      });
      expect(result.success).toBe(false);
    }
  });

  test("rechaza una etapa inventada", () => {
    const result = MoverEtapaSchema.safeParse({
      leadId: LEAD_ID,
      sessionId: SESSION_ID,
      etapa: "facturado",
    });
    expect(result.success).toBe(false);
  });

  test("rechaza sessionId no-uuid", () => {
    const result = MoverEtapaSchema.safeParse({
      leadId: LEAD_ID,
      sessionId: "no-uuid",
      etapa: "cotizado",
    });
    expect(result.success).toBe(false);
  });
});

const TAG_ID = "33333333-3333-4333-8333-333333333333";

describe("RenombrarLeadSchema", () => {
  test("trimea el nombre", () => {
    const parsed = RenombrarLeadSchema.parse({ leadId: LEAD_ID, nombre: "  Ramón Díaz  " });
    expect(parsed.nombre).toBe("Ramón Díaz");
  });

  test("acepta vacío: es el estado legítimo de «todavía nadie lo identificó»", () => {
    const parsed = RenombrarLeadSchema.parse({ leadId: LEAD_ID, nombre: "   " });
    expect(parsed.nombre).toBe("");
  });

  test("rechaza más de 80 chars", () => {
    const result = RenombrarLeadSchema.safeParse({ leadId: LEAD_ID, nombre: "x".repeat(81) });
    expect(result.success).toBe(false);
  });

  test("rechaza leadId no-uuid", () => {
    const result = RenombrarLeadSchema.safeParse({ leadId: "no-uuid", nombre: "Ramón" });
    expect(result.success).toBe(false);
  });
});

describe("AsignarEtiquetaSchema / QuitarEtiquetaSchema", () => {
  test("aceptan par de uuids", () => {
    expect(AsignarEtiquetaSchema.parse({ leadId: LEAD_ID, tagId: TAG_ID }).tagId).toBe(TAG_ID);
    expect(QuitarEtiquetaSchema.parse({ leadId: LEAD_ID, tagId: TAG_ID }).leadId).toBe(LEAD_ID);
  });

  test("rechazan tagId no-uuid", () => {
    expect(AsignarEtiquetaSchema.safeParse({ leadId: LEAD_ID, tagId: "1" }).success).toBe(false);
    expect(QuitarEtiquetaSchema.safeParse({ leadId: LEAD_ID, tagId: "1" }).success).toBe(false);
  });
});

describe("CrearEtiquetaSchema", () => {
  test("trimea el nombre", () => {
    const parsed = CrearEtiquetaSchema.parse({ leadId: LEAD_ID, nombre: "  flota  " });
    expect(parsed.nombre).toBe("flota");
  });

  test("rechaza nombre vacío post-trim", () => {
    const result = CrearEtiquetaSchema.safeParse({ leadId: LEAD_ID, nombre: "   " });
    expect(result.success).toBe(false);
  });

  test("rechaza más de 40 chars", () => {
    const result = CrearEtiquetaSchema.safeParse({ leadId: LEAD_ID, nombre: "x".repeat(41) });
    expect(result.success).toBe(false);
  });
});

describe("AgregarDatoLeadSchema", () => {
  test("acepta una columna de la lista blanca y trimea el valor", () => {
    const parsed = AgregarDatoLeadSchema.parse({
      tipo: "campo",
      leadId: LEAD_ID,
      campo: "email",
      valor: "  ramon@taller.com  ",
    });
    expect(parsed).toEqual({
      tipo: "campo",
      leadId: LEAD_ID,
      campo: "email",
      valor: "ramon@taller.com",
    });
  });

  test("rechaza una columna fuera de la lista blanca", () => {
    // `telefono` es la clave con la que el pipeline encuentra al lead.
    for (const campo of ["telefono", "nombre", "nombre_perfil", "id"]) {
      const r = AgregarDatoLeadSchema.safeParse({
        tipo: "campo",
        leadId: LEAD_ID,
        campo,
        valor: "x",
      });
      expect(r.success).toBe(false);
    }
  });

  test("acepta un campo libre con nombre y valor propios", () => {
    const parsed = AgregarDatoLeadSchema.parse({
      tipo: "libre",
      leadId: LEAD_ID,
      clave: " Cumpleaños ",
      valor: " 12/03 ",
    });
    expect(parsed).toEqual({
      tipo: "libre",
      leadId: LEAD_ID,
      clave: "Cumpleaños",
      valor: "12/03",
    });
  });

  test("rechaza un campo libre que se llame como una columna real", () => {
    for (const clave of ["Teléfono", "email", "Dirección", "canal", "Nombre"]) {
      const r = AgregarDatoLeadSchema.safeParse({
        tipo: "libre",
        leadId: LEAD_ID,
        clave,
        valor: "x",
      });
      expect(r.success).toBe(false);
    }
  });

  test("rechaza vacíos post-trim y largos fuera de rango", () => {
    const base = { tipo: "libre" as const, leadId: LEAD_ID };
    expect(AgregarDatoLeadSchema.safeParse({ ...base, clave: "  ", valor: "x" }).success).toBe(
      false,
    );
    expect(AgregarDatoLeadSchema.safeParse({ ...base, clave: "x", valor: "  " }).success).toBe(
      false,
    );
    expect(
      AgregarDatoLeadSchema.safeParse({ ...base, clave: "x".repeat(41), valor: "x" }).success,
    ).toBe(false);
    expect(
      AgregarDatoLeadSchema.safeParse({ ...base, clave: "x", valor: "x".repeat(201) }).success,
    ).toBe(false);
  });

  test("rechaza un tipo desconocido y leadId no-uuid", () => {
    expect(
      AgregarDatoLeadSchema.safeParse({ tipo: "otro", leadId: LEAD_ID, clave: "x", valor: "y" })
        .success,
    ).toBe(false);
    expect(
      AgregarDatoLeadSchema.safeParse({ tipo: "libre", leadId: "no-uuid", clave: "x", valor: "y" })
        .success,
    ).toBe(false);
  });
});

describe("BorrarDatoExtraSchema", () => {
  test("acepta la clave que se ve en la ficha y la trimea", () => {
    expect(BorrarDatoExtraSchema.parse({ leadId: LEAD_ID, clave: "  Cumpleaños  " })).toEqual({
      leadId: LEAD_ID,
      clave: "Cumpleaños",
    });
  });

  test("rechaza vacío post-trim, largo fuera de rango y leadId no-uuid", () => {
    expect(BorrarDatoExtraSchema.safeParse({ leadId: LEAD_ID, clave: "   " }).success).toBe(false);
    expect(
      BorrarDatoExtraSchema.safeParse({ leadId: LEAD_ID, clave: "x".repeat(41) }).success,
    ).toBe(false);
    expect(BorrarDatoExtraSchema.safeParse({ leadId: "no-uuid", clave: "x" }).success).toBe(false);
  });

  test("no acepta un campo que nombre la columna a tocar", () => {
    // El input no lleva `campo` ni nada que pueda apuntar a una columna real:
    // lo único que viaja es la clave del jsonb. Zod descarta el resto.
    const parsed = BorrarDatoExtraSchema.parse({
      leadId: LEAD_ID,
      clave: "Patente",
      campo: "telefono",
    });
    expect(parsed).toEqual({ leadId: LEAD_ID, clave: "Patente" });
  });
});
