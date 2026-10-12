import { z } from "zod";
import { ValidationError } from "@/lib/errors";
import { UUIDSchema } from "@/lib/validation/schemas";

/**
 * Cursor `(instante de descarga, id)` de `/api/escritorio/archivos`. Opaco para el
 * cliente: la app de escritorio lo guarda y lo devuelve sin mirarlo.
 */
const CursorSchema = z.object({ at: z.string().datetime(), id: UUIDSchema });

export interface CursorArchivos {
  at: Date;
  id: string;
}

export function codificarCursor(c: CursorArchivos): string {
  return Buffer.from(JSON.stringify({ at: c.at.toISOString(), id: c.id })).toString("base64url");
}

export function decodificarCursor(crudo: string): CursorArchivos {
  try {
    const json: unknown = JSON.parse(Buffer.from(crudo, "base64url").toString("utf8"));
    const c = CursorSchema.parse(json);
    return { at: new Date(c.at), id: c.id };
  } catch {
    throw new ValidationError("cursor inválido", "cursor");
  }
}
