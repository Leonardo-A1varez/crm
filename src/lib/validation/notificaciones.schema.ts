import { z } from "zod";
import { UUIDSchema } from "./schemas";

export const MarcarNotificacionLeidaSchema = z.object({ id: UUIDSchema });
export type MarcarNotificacionLeidaInput = z.infer<typeof MarcarNotificacionLeidaSchema>;
