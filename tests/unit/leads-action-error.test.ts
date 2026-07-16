import { describe, expect, test } from "vitest";
import { toActionError } from "@/app/(panel)/leads/_actions/action-error";
import { ConflictError, NotFoundError } from "@/lib/errors";

describe("leads toActionError", () => {
  test("NotFoundError de merge_candidate usa copy de contrato de par resuelto/inexistente", () => {
    const e = new NotFoundError("merge_candidate no encontrado: x", "merge_candidate", "x");
    expect(toActionError(e, "approveMerge")).toEqual({
      ok: false,
      error: "Este par ya fue resuelto o no existe. Refrescá la página.",
    });
  });

  test("NotFoundError de otro resource (lead) usa copy genérica de lead no encontrado", () => {
    const e = new NotFoundError("lead no encontrado: x", "lead", "x");
    expect(toActionError(e, "approveMerge")).toEqual({
      ok: false,
      error: "Lead no encontrado. Refrescá la página.",
    });
  });

  test("ConflictError mantiene la misma copy de par resuelto/inexistente", () => {
    const e = new ConflictError("merge_candidate ya resuelto: x", "already_resolved");
    expect(toActionError(e, "approveMerge")).toEqual({
      ok: false,
      error: "Este par ya fue resuelto o no existe. Refrescá la página.",
    });
  });
});
