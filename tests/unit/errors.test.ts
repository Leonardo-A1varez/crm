import { describe, expect, test } from "vitest";
import {
  ConflictError,
  DomainError,
  NotFoundError,
  PermissionDeniedError,
  ValidationError,
  isDomainError,
  isNonRetriable,
} from "@/lib/errors";

describe("DomainError hierarchy", () => {
  test("NotFoundError extends DomainError + Error con resource/id", () => {
    const e = new NotFoundError("lead no encontrado: abc", "lead", "abc");
    expect(e).toBeInstanceOf(NotFoundError);
    expect(e).toBeInstanceOf(DomainError);
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe("NOT_FOUND");
    expect(e.resource).toBe("lead");
    expect(e.id).toBe("abc");
    expect(e.message).toBe("lead no encontrado: abc");
    expect(e.name).toBe("NotFoundError");
  });

  test("ConflictError extends DomainError con conflictType opcional", () => {
    const e = new ConflictError("telefono duplicado: 549110", "duplicate_telefono");
    expect(e).toBeInstanceOf(ConflictError);
    expect(e).toBeInstanceOf(DomainError);
    expect(e.code).toBe("CONFLICT");
    expect(e.conflictType).toBe("duplicate_telefono");
    expect(e.message).toBe("telefono duplicado: 549110");
  });

  test("ValidationError extends DomainError con issues opcional", () => {
    const e = new ValidationError("input invalido", { field: "codigo" });
    expect(e).toBeInstanceOf(ValidationError);
    expect(e.code).toBe("VALIDATION");
    expect(e.issues).toEqual({ field: "codigo" });
  });

  test("PermissionDeniedError extends DomainError", () => {
    const e = new PermissionDeniedError("vendedor no puede editar productos");
    expect(e).toBeInstanceOf(PermissionDeniedError);
    expect(e.code).toBe("PERMISSION_DENIED");
  });

  test("isDomainError detecta clases del módulo", () => {
    expect(isDomainError(new NotFoundError("x", "y", "z"))).toBe(true);
    expect(isDomainError(new ConflictError("x"))).toBe(true);
    expect(isDomainError(new Error("plain"))).toBe(false);
    expect(isDomainError(null)).toBe(false);
    expect(isDomainError("string")).toBe(false);
  });

  test("isNonRetriable true para NotFound/Validation/PermissionDenied", () => {
    expect(isNonRetriable(new NotFoundError("x", "y", "z"))).toBe(true);
    expect(isNonRetriable(new ValidationError("x"))).toBe(true);
    expect(isNonRetriable(new PermissionDeniedError("x"))).toBe(true);
  });

  test("isNonRetriable false para ConflictError + errores no-domain", () => {
    expect(isNonRetriable(new ConflictError("x"))).toBe(false);
    expect(isNonRetriable(new Error("plain"))).toBe(false);
  });

  test("DomainError preserva cause", () => {
    const cause = new Error("low level");
    const e = new NotFoundError("up level", "res", "1", cause);
    expect(e.cause).toBe(cause);
  });
});
