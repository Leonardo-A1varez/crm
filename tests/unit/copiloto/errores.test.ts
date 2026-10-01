import { describe, expect, test } from "vitest";
import { codigoDeErrorBorrador } from "@/lib/copiloto/errores";
import { BudgetExceededError, InfraError } from "@/lib/errors";

describe("codigoDeErrorBorrador", () => {
  test("el tope diario de gasto se distingue de un fallo del modelo", () => {
    expect(codigoDeErrorBorrador(new BudgetExceededError("tope", "llm_diario"))).toBe(
      "tope_diario",
    );
  });

  test("reconoce el tope por nombre cuando Inngest entrega el error serializado", () => {
    // Un error que cruzó el límite de un step llega como `Error` genérico pero
    // conserva `name` (DomainError lo fija a `constructor.name`).
    const serializado = new Error("tope");
    serializado.name = "BudgetExceededError";
    expect(codigoDeErrorBorrador(serializado)).toBe("tope_diario");
  });

  test("cualquier otra cosa es llm_error y nunca arrastra el texto del proveedor", () => {
    expect(codigoDeErrorBorrador(new InfraError("500 del proveedor: detalle con datos"))).toBe(
      "llm_error",
    );
    expect(codigoDeErrorBorrador("string suelto")).toBe("llm_error");
    expect(codigoDeErrorBorrador(undefined)).toBe("llm_error");
  });
});
