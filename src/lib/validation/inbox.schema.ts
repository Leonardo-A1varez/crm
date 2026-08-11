import { z } from "zod";
import { CAMPOS_TWIN_EDITABLES, ETAPAS_EMBUDO } from "@/types/domain";
import { esClaveReservada, MAX_LARGO_CLAVE, MAX_LARGO_VALOR } from "@/lib/datos-extra";
import { CanalSchema, MotivoPerdidaSchema, UUIDSchema } from "@/lib/validation/schemas";

// Inputs de Server Actions inbox (Slice 2 8.4-8.5). Regla §0.9.3: parse línea 1.

// 4096 = límite WhatsApp text; IG/FB toleran menos pero Meta trunca, no rechaza.
export const SendMessageSchema = z.object({
  leadId: UUIDSchema,
  sessionId: UUIDSchema,
  canal: CanalSchema,
  body: z.string().trim().min(1).max(4096),
});
export type SendMessageInput = z.infer<typeof SendMessageSchema>;

export const ToggleHandoffSchema = z.object({
  leadId: UUIDSchema,
  sessionId: UUIDSchema,
  action: z.enum(["pause", "resume"]),
});
export type ToggleHandoffInput = z.infer<typeof ToggleHandoffSchema>;

/**
 * Cierre de la sesión decidido por una persona: ganado o perdido.
 *
 * Unión discriminada por `resultado` y no un objeto con `motivoPerdida`
 * opcional: **el motivo es obligatorio cuando la venta se perdió**. Modelado
 * así, un cierre perdido sin motivo no pasa el parse, y el tipo que llega al
 * service ya no puede representarlo. Deshabilitar el botón en la UI no alcanza:
 * la Server Action es un endpoint y recibe lo que le manden.
 *
 * `exito` no acepta `motivoPerdida`: un cierre ganado con motivo de pérdida es
 * un cliente confundido, y guardarlo dejaría filas que los filtros de "perdido
 * por precio" contarían mal.
 */
export const CloseSessionSchema = z.discriminatedUnion("resultado", [
  z.object({
    resultado: z.literal("exito"),
    leadId: UUIDSchema,
    sessionId: UUIDSchema,
  }),
  z.object({
    resultado: z.literal("perdido"),
    leadId: UUIDSchema,
    sessionId: UUIDSchema,
    motivoPerdida: MotivoPerdidaSchema,
  }),
]);
export type CloseSessionInput = z.infer<typeof CloseSessionSchema>;

// El campo se valida contra la lista blanca del repo: sin esto, un cliente
// podría mandar `ia_pausada` o `resultado` y saltearse las reglas que los
// gobiernan. `valor` acepta texto, número o vacío — vacío borra el dato.
export const EditarCampoTwinSchema = z.object({
  leadId: UUIDSchema,
  sessionId: UUIDSchema,
  campo: z.enum(CAMPOS_TWIN_EDITABLES),
  valor: z.union([z.string().trim().max(2000), z.number(), z.null()]),
});
export type EditarCampoTwinInput = z.infer<typeof EditarCampoTwinSchema>;

/**
 * Movimiento de etapa desde el rail del Twin.
 *
 * `ETAPAS_EMBUDO` y no `CURRENT_STAGE`: `perdido` y `requiere_humano` son
 * desvíos que decide el pipeline —escalado, descuento excedido, cierre— y no
 * tienen segmento en el rail. Aceptarlos acá abriría un camino para marcar una
 * conversación como perdida sin pasar por el cierre de sesión, que es el que
 * pide el motivo.
 *
 * `cerrado` sí sigue acá aunque el segmento "Cerrado" del rail ya no llame a
 * esta acción —abre el popover de ganado/perdido, que va por
 * `CloseSessionSchema`—: mover la etapa a `cerrado` no escribe `resultado`, así
 * que no hay forma de cerrar una venta por este camino y sí de corregir la
 * etapa de una sesión que el extractor dejó mal.
 */
export const MoverEtapaSchema = z.object({
  leadId: UUIDSchema,
  sessionId: UUIDSchema,
  etapa: z.enum(ETAPAS_EMBUDO),
});
export type MoverEtapaInput = z.infer<typeof MoverEtapaSchema>;

/**
 * El nombre con el que la casa identifica al lead. Acepta vacío porque volver a
 * dejarlo sin nombre tiene que ser posible: el pipeline crea los leads con `""`
 * y ese vacío es el estado legítimo de "todavía nadie lo identificó".
 */
export const RenombrarLeadSchema = z.object({
  leadId: UUIDSchema,
  nombre: z.string().trim().max(80),
});
export type RenombrarLeadInput = z.infer<typeof RenombrarLeadSchema>;

export const AsignarEtiquetaSchema = z.object({
  leadId: UUIDSchema,
  tagId: UUIDSchema,
});
export type AsignarEtiquetaInput = z.infer<typeof AsignarEtiquetaSchema>;

export const QuitarEtiquetaSchema = z.object({
  leadId: UUIDSchema,
  tagId: UUIDSchema,
});
export type QuitarEtiquetaInput = z.infer<typeof QuitarEtiquetaSchema>;

// 40 chars: el chip vive en un panel de 322px y un nombre más largo deja de
// leerse como etiqueta. `nombre` es UNIQUE en la tabla, así que el duplicado lo
// resuelve el repo con ConflictError y no la validación.
export const CrearEtiquetaSchema = z.object({
  leadId: UUIDSchema,
  nombre: z.string().trim().min(1).max(40),
});
export type CrearEtiquetaInput = z.infer<typeof CrearEtiquetaSchema>;

/**
 * Columnas de contacto de `leads` que el `+` del Twin puede completar.
 *
 * Lista blanca corta y explícita: `telefono` no está porque es la clave con la
 * que el pipeline encuentra al lead, y `nombre` / `nombre_perfil` tienen cada
 * uno su propio camino de escritura.
 */
export const CAMPOS_CONTACTO_LEAD = ["email", "direccion"] as const;
export type CampoContactoLead = (typeof CAMPOS_CONTACTO_LEAD)[number];

/**
 * El `+` de la ficha, en sus dos formas: completar una columna que existe o
 * inventar un campo con nombre y valor libres.
 *
 * Unión discriminada y no un objeto con todo opcional: son dos escrituras
 * distintas —una va a una columna, la otra a `datos_extra`— y mezclarlas
 * dejaría al service decidiendo con `if (clave)` cuál quiso hacer el vendedor.
 */
export const AgregarDatoLeadSchema = z.discriminatedUnion("tipo", [
  z.object({
    tipo: z.literal("campo"),
    leadId: UUIDSchema,
    campo: z.enum(CAMPOS_CONTACTO_LEAD),
    valor: z.string().trim().min(1).max(MAX_LARGO_VALOR),
  }),
  z.object({
    tipo: z.literal("libre"),
    leadId: UUIDSchema,
    clave: z
      .string()
      .trim()
      .min(1)
      .max(MAX_LARGO_CLAVE)
      // Un campo libre que se llame "Email" competiría con la columna `email`:
      // dos filas con el mismo rótulo y ninguna que mande.
      .refine((c) => !esClaveReservada(c), { message: "clave reservada" }),
    valor: z.string().trim().min(1).max(MAX_LARGO_VALOR),
  }),
]);
export type AgregarDatoLeadInput = z.infer<typeof AgregarDatoLeadSchema>;

/**
 * El `×` de un campo libre: saca el par entero de `datos_extra`.
 *
 * Solo viaja la clave, sin lista blanca, porque los nombres los inventa el
 * vendedor y no hay forma de enumerarlos. El alcance no lo cuida esta
 * validación sino el service, que escribe únicamente el jsonb: una clave que se
 * llame como una columna real puede, a lo sumo, sacar una fila libre mal puesta
 * con ese nombre, nunca vaciar `telefono`, `email` ni `direccion`.
 */
export const BorrarDatoExtraSchema = z.object({
  leadId: UUIDSchema,
  clave: z.string().trim().min(1).max(MAX_LARGO_CLAVE),
});
export type BorrarDatoExtraInput = z.infer<typeof BorrarDatoExtraSchema>;
