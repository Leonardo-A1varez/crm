import { z } from "zod";
import {
  LARGO_MAX_CRUDO,
  LARGO_MAX_IDENTIFICADOR,
  LARGO_VIN,
  esVinValido,
  normalizarIdentificador,
} from "@/lib/identificadores";
import { IDENTIFICADOR_TIPO } from "@/types/domain";
import { IDENTIFICADOR_LABEL } from "@/lib/ui/identificadores";
import { UUIDSchema } from "@/lib/validation/schemas";

// Inputs Server Actions leads (fase 10). Regla §0.9.3: parse línea 1.

export const ApproveMergeSchema = z.object({ candidateId: UUIDSchema, keepLeadId: UUIDSchema });
export type ApproveMergeFormInput = z.infer<typeof ApproveMergeSchema>;

export const RejectMergeSchema = z.object({ candidateId: UUIDSchema });
export type RejectMergeFormInput = z.infer<typeof RejectMergeSchema>;

export const CreateManualCandidateSchema = z
  .object({ leadId: UUIDSchema, otherLeadId: UUIDSchema })
  .refine((d) => d.leadId !== d.otherLeadId, {
    message: "No podés marcar un lead como duplicado de sí mismo.",
  });
export type CreateManualCandidateFormInput = z.infer<typeof CreateManualCandidateSchema>;

export const SearchLeadsSchema = z.object({ q: z.string().trim().min(1).max(100) });
export type SearchLeadsFormInput = z.infer<typeof SearchLeadsSchema>;

const nullableText = (max: number) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? null : value),
    z.string().trim().max(max).nullable(),
  );

const nullableEmail = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? null : value),
  z
    .string()
    .trim()
    .email()
    .max(254)
    .transform((value) => value.toLowerCase())
    .nullable(),
);

const nullableYear = z.preprocess(
  (value) => (value === "" || value === null ? null : Number(value)),
  z
    .number()
    .int()
    .min(1886)
    .max(new Date().getUTCFullYear() + 1)
    .nullable(),
);

export const UpdateLeadProfileSchema = z.preprocess(
  (raw) => (raw instanceof FormData ? Object.fromEntries(raw.entries()) : raw),
  z.object({
    leadId: UUIDSchema,
    nombre: z.string().trim().min(1).max(120),
    email: nullableEmail,
    direccion: nullableText(300),
    vehiculoMarca: nullableText(100),
    vehiculoModelo: nullableText(100),
    vehiculoAnio: nullableYear,
    vehiculoMotor: nullableText(100),
  }),
);
export type UpdateLeadProfileInput = z.infer<typeof UpdateLeadProfileSchema>;

/**
 * Alta de un identificador del lead.
 *
 * Valida sobre el valor **normalizado**, no sobre lo tipeado: "vacío" tiene que
 * significar "no queda nada con qué comparar" y no "el string estaba vacío". Un
 * valor de sólo guiones pasa cualquier `min(1)` sobre el crudo y llega a la
 * base como una fila que no identifica a nadie.
 *
 * Lo único que se rechaza por forma es el VIN, que tiene largo fijo en todo el
 * mundo. Placa y documento fiscal **no** se validan por formato a propósito: el
 * producto vende en seis países con seis formatos distintos —y los que cambian
 * con cada reforma—, así que un validador estricto rechazaría datos legítimos
 * de un cliente real. El tope de largo alcanza para frenar un pegado accidental.
 *
 * El duplicado exacto no se chequea acá: lo rechaza el índice único de la base
 * (`lead_identificadores_lead_tipo_valor_idx`), que es el único que puede
 * hacerlo sin una carrera entre el chequeo y el insert.
 */
export const AgregarIdentificadorSchema = z
  .object({
    leadId: UUIDSchema,
    tipo: z.enum(IDENTIFICADOR_TIPO),
    valor: z
      .string()
      .trim()
      .min(1, "Escribí el valor del identificador.")
      .max(LARGO_MAX_CRUDO, "Ese valor es demasiado largo para un identificador."),
  })
  .superRefine((datos, ctx) => {
    const normalizado = normalizarIdentificador(datos.tipo, datos.valor);
    if (normalizado === "") {
      ctx.addIssue("Ese valor no tiene ni un número ni una letra: no identifica a nadie.");
      return;
    }
    if (normalizado.length > LARGO_MAX_IDENTIFICADOR[datos.tipo]) {
      ctx.addIssue(
        `${IDENTIFICADOR_LABEL[datos.tipo]}: como máximo ` +
          `${LARGO_MAX_IDENTIFICADOR[datos.tipo]} caracteres.`,
      );
      return;
    }
    if (datos.tipo === "vin" && !esVinValido(normalizado)) {
      ctx.addIssue(`Un VIN tiene ${LARGO_VIN} caracteres entre letras y números.`);
    }
  })
  // El transform va último: lo que llega al service ya está normalizado y con
  // lo tipeado guardado aparte, así que ninguna capa de abajo puede olvidarse
  // de normalizar y romper la detección de duplicados.
  .transform((datos) => ({
    leadId: datos.leadId,
    tipo: datos.tipo,
    valor: normalizarIdentificador(datos.tipo, datos.valor),
    valorOriginal: datos.valor,
  }));

/** Lo que manda el formulario, antes de normalizar. */
export type AgregarIdentificadorFormInput = z.input<typeof AgregarIdentificadorSchema>;
/** Lo que recibe el service: `valor` normalizado + lo tipeado en `valorOriginal`. */
export type AgregarIdentificadorInput = z.output<typeof AgregarIdentificadorSchema>;

/**
 * Baja de un identificador. Viaja también `leadId` —y no sólo el id de la
 * fila— porque el service comprueba que la fila sea de ese lead antes de
 * borrarla: sin esa comprobación, un id adivinado borraría el identificador de
 * cualquier otro lead con el mismo permiso.
 */
export const QuitarIdentificadorSchema = z.object({
  leadId: UUIDSchema,
  identificadorId: UUIDSchema,
});
export type QuitarIdentificadorInput = z.infer<typeof QuitarIdentificadorSchema>;
