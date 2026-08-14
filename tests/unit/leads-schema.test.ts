import { describe, expect, test } from "vitest";
import {
  AgregarIdentificadorSchema,
  ApproveMergeSchema,
  CreateManualCandidateSchema,
  QuitarIdentificadorSchema,
  RejectMergeSchema,
  SearchLeadsSchema,
} from "@/lib/validation/leads.schema";
import { LARGO_MAX_CRUDO } from "@/lib/identificadores";

const uuidA = "6f9619ff-8b86-4d01-b42d-00cf4fc964ff";
const uuidB = "7f9619ff-8b86-4d01-b42d-00cf4fc964ff";

describe("leads schemas", () => {
  test("ApproveMergeSchema exige 2 uuids", () => {
    expect(ApproveMergeSchema.safeParse({ candidateId: uuidA, keepLeadId: uuidB }).success).toBe(
      true,
    );
    expect(ApproveMergeSchema.safeParse({ candidateId: "x", keepLeadId: uuidB }).success).toBe(
      false,
    );
  });

  test("RejectMergeSchema exige uuid válido", () => {
    expect(RejectMergeSchema.safeParse({ candidateId: uuidA }).success).toBe(true);
    expect(RejectMergeSchema.safeParse({ candidateId: "x" }).success).toBe(false);
    expect(RejectMergeSchema.safeParse({}).success).toBe(false);
  });

  test("CreateManualCandidateSchema rechaza self-pair", () => {
    expect(
      CreateManualCandidateSchema.safeParse({ leadId: uuidA, otherLeadId: uuidA }).success,
    ).toBe(false);
    expect(
      CreateManualCandidateSchema.safeParse({ leadId: uuidA, otherLeadId: uuidB }).success,
    ).toBe(true);
  });

  test("SearchLeadsSchema exige 1-100 chars trim", () => {
    expect(SearchLeadsSchema.safeParse({ q: "  " }).success).toBe(false);
    expect(SearchLeadsSchema.safeParse({ q: "a".repeat(101) }).success).toBe(false);
    expect(SearchLeadsSchema.parse({ q: "  ana " }).q).toBe("ana");
  });
});

describe("AgregarIdentificadorSchema", () => {
  const base = { leadId: uuidA, tipo: "placa" as const };

  test("normaliza el valor y conserva lo tipeado aparte", () => {
    const out = AgregarIdentificadorSchema.parse({ ...base, valor: "  ab-123-cd  " });
    // `valor` es contra lo que compara el detector; `valorOriginal` es lo que
    // se muestra. Si el schema devolviera uno solo, una capa de abajo tendría
    // que volver a normalizar y podría no hacerlo.
    expect(out.valor).toBe("AB123CD");
    expect(out.valorOriginal).toBe("ab-123-cd");
  });

  test("el teléfono conserva el `+` y pierde los separadores", () => {
    const out = AgregarIdentificadorSchema.parse({
      leadId: uuidA,
      tipo: "telefono",
      valor: "+54 9 11 5555-0002",
    });
    expect(out.valor).toBe("+5491155550002");
  });

  test("rechaza lo que queda vacío después de normalizar", () => {
    // Pasa cualquier min(1) sobre lo tipeado y sin embargo no identifica a nadie.
    const r = AgregarIdentificadorSchema.safeParse({ ...base, valor: "---" });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toContain("no identifica a nadie");
  });

  test("rechaza el string vacío y el que es sólo espacios", () => {
    expect(AgregarIdentificadorSchema.safeParse({ ...base, valor: "" }).success).toBe(false);
    expect(AgregarIdentificadorSchema.safeParse({ ...base, valor: "   " }).success).toBe(false);
  });

  test("el tope de largo se mide sobre el normalizado, no sobre lo tipeado", () => {
    // 7 caracteres de placa escritos con espacios entre cada uno: 13 tipeados,
    // 7 normalizados. Tiene que pasar.
    expect(AgregarIdentificadorSchema.safeParse({ ...base, valor: "A B 1 2 3 C D" }).success).toBe(
      true,
    );
    // 13 caracteres reales de placa: supera el tope de 12.
    const r = AgregarIdentificadorSchema.safeParse({ ...base, valor: "A".repeat(13) });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toContain("Placa");
  });

  test("corta lo tipeado antes de normalizar un texto enorme", () => {
    expect(
      AgregarIdentificadorSchema.safeParse({ ...base, valor: "a".repeat(LARGO_MAX_CRUDO + 1) })
        .success,
    ).toBe(false);
  });

  test("el VIN se valida: 17 alfanuméricos, con o sin guiones al escribirlo", () => {
    expect(
      AgregarIdentificadorSchema.parse({ leadId: uuidA, tipo: "vin", valor: "1HG-BH41J-XMN109186" })
        .valor,
    ).toBe("1HGBH41JXMN109186");
    const corto = AgregarIdentificadorSchema.safeParse({
      leadId: uuidA,
      tipo: "vin",
      valor: "1HGBH41JXMN1091",
    });
    expect(corto.success).toBe(false);
    expect(corto.error?.issues[0]?.message).toContain("17");
  });

  test("NO rechaza placas ni documentos fiscales por formato", () => {
    // El producto vende en seis países y cada uno tiene su formato. Un
    // validador estricto rechazaría clientes reales.
    for (const valor of ["ABC1D23", "AB-123-CD", "AAA-111", "1234ABC"]) {
      expect(AgregarIdentificadorSchema.safeParse({ ...base, valor }).success).toBe(true);
    }
    for (const valor of ["20100123456", "12.345.678/0001-95", "30-71234567-8", "76.123.456-K"]) {
      expect(
        AgregarIdentificadorSchema.safeParse({ leadId: uuidA, tipo: "ruc", valor }).success,
      ).toBe(true);
    }
  });

  test("exige un tipo del enum y un leadId uuid", () => {
    expect(
      AgregarIdentificadorSchema.safeParse({ leadId: uuidA, tipo: "patente", valor: "AB123CD" })
        .success,
    ).toBe(false);
    expect(
      AgregarIdentificadorSchema.safeParse({ leadId: "x", tipo: "placa", valor: "AB123CD" })
        .success,
    ).toBe(false);
  });
});

describe("QuitarIdentificadorSchema", () => {
  test("exige los dos uuids", () => {
    expect(
      QuitarIdentificadorSchema.safeParse({ leadId: uuidA, identificadorId: uuidB }).success,
    ).toBe(true);
    // Sin `leadId` el service no puede comprobar que la fila sea de ese lead.
    expect(QuitarIdentificadorSchema.safeParse({ identificadorId: uuidB }).success).toBe(false);
    expect(
      QuitarIdentificadorSchema.safeParse({ leadId: uuidA, identificadorId: "x" }).success,
    ).toBe(false);
  });
});
