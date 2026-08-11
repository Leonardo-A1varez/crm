import { z } from "zod";
import { CAMPOS_TWIN_EDITABLES, ETAPAS_EMBUDO } from "@/types/domain";
import { esClaveReservada, MAX_LARGO_CLAVE, MAX_LARGO_VALOR } from "@/lib/datos-extra";
import { SESION_BUSCADA } from "@/types/inbox";
import { VENTANA_ACTIVIDAD } from "@/types/leads";
import {
  CanalSchema,
  CurrentStageSchema,
  MotivoPerdidaSchema,
  UUIDSchema,
} from "@/lib/validation/schemas";

// Inputs de Server Actions inbox (Slice 2 8.4-8.5). Regla §0.9.3: parse línea 1.

// 4096 = límite WhatsApp text; IG/FB toleran menos pero Meta trunca, no rechaza.
export const SendMessageSchema = z.object({
  leadId: UUIDSchema,
  sessionId: UUIDSchema,
  canal: CanalSchema,
  body: z.string().trim().min(1).max(4096),
});
export type SendMessageInput = z.infer<typeof SendMessageSchema>;

/**
 * Lectura de la auditoría de un turno. Solo viaja el id del saliente: el
 * entrante, la sesión y las cuatro tablas los resuelve el service. Que el
 * cliente mandara el ancla sería dejarle elegir de qué turno lee.
 */
export const AuditoriaTurnoSchema = z.object({ mensajeId: UUIDSchema });
export type AuditoriaTurnoInput = z.infer<typeof AuditoriaTurnoSchema>;

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

/**
 * Cuánto puede vivir un recordatorio hacia adelante.
 *
 * Seis meses no es una restricción de Inngest —`sleepUntil` aguanta más— sino
 * del producto: una cita a un año sobre una sesión que la purga borra a los 29
 * días del cierre es una fila que nadie va a ver nunca. El tope convierte un
 * dedazo en la fecha ("2027" en vez de "2026") en un error visible.
 */
export const MAX_DIAS_RECORDATORIO = 180;

/** La nota entra en un chip de 322 px y en una línea de la fila del Inbox. */
export const MAX_LARGO_NOTA_RECORDATORIO = 140;

/**
 * "Volver a contactar en 2 días" sobre una conversación.
 *
 * La fecha viaja en ISO con offset y no como `Date`: el payload de una Server
 * Action se serializa, y una fecha sin zona la interpretaría el server con la
 * suya, que puede no ser la del vendedor.
 *
 * Las dos guardas de rango van acá y no en el service porque son del formulario
 * —qué fecha tiene sentido pedir— y porque el `refine` es lo que impide que un
 * POST a mano programe un recordatorio en el pasado, que se dispararía apenas
 * el workflow arranque. `nota` acepta vacío: la fecha sola ya sirve.
 */
/**
 * La fecha, sola. Vive aparte porque programar y reprogramar la validan igual:
 * si el tope o el "tiene que ser futura" existieran dos veces, cambiar uno y
 * olvidarse del otro dejaría un camino por el que se cuela lo que el otro
 * rechaza.
 *
 * **Una hora que ya pasó se rechaza, no se corre al futuro.** Con un selector
 * de día y hora, elegir hoy a las 09:00 cuando son las 15:00 pasa; mover la
 * fecha en silencio a mañana sería inventar una decisión que el vendedor no
 * tomó, sobre lo único que este objeto promete. El formulario además pone
 * `min`/`max` en el input para que el error casi nunca haga falta.
 */
const FechaRecordatorioSchema = z
  .string()
  .datetime({ offset: true })
  .refine((iso) => new Date(iso).getTime() > Date.now(), {
    message: "La fecha del recordatorio tiene que ser futura.",
  })
  .refine(
    (iso) => new Date(iso).getTime() <= Date.now() + MAX_DIAS_RECORDATORIO * 24 * 60 * 60 * 1000,
    { message: `El recordatorio no puede ir a más de ${MAX_DIAS_RECORDATORIO} días.` },
  );

export const ProgramarRecordatorioSchema = z.object({
  leadId: UUIDSchema,
  sessionId: UUIDSchema,
  recordarAt: FechaRecordatorioSchema,
  nota: z.string().trim().max(MAX_LARGO_NOTA_RECORDATORIO),
});
export type ProgramarRecordatorioInput = z.infer<typeof ProgramarRecordatorioSchema>;

/**
 * Cambiarle la fecha a un recordatorio que ya existe, sin cancelarlo.
 *
 * No viaja `sessionId`: la fila ya sabe de qué conversación es, y el service la
 * lee de ahí en vez de confiar en lo que mande el cliente. `leadId` viaja solo
 * para revalidar la ruta, igual que en cancelar. La nota tampoco viaja: mover
 * la fecha no es reescribir el motivo, y mandarla vacía por accidente borraría
 * lo único que le da sentido al aviso cuando salte.
 */
export const ReprogramarRecordatorioSchema = z.object({
  leadId: UUIDSchema,
  recordatorioId: UUIDSchema,
  recordarAt: FechaRecordatorioSchema,
});
export type ReprogramarRecordatorioInput = z.infer<typeof ReprogramarRecordatorioSchema>;

/**
 * El "Cancelar" del bloque de seguimiento del Twin. `leadId` viaja solo para
 * revalidar la ruta de la conversación: el que identifica la fila es
 * `recordatorioId`.
 */
export const CancelarRecordatorioSchema = z.object({
  leadId: UUIDSchema,
  recordatorioId: UUIDSchema,
});
export type CancelarRecordatorioInput = z.infer<typeof CancelarRecordatorioSchema>;

/**
 * Lo que viaja al buscador de conversaciones del panel de lista.
 *
 * `q` acepta hasta 80 caracteres: es un término de búsqueda, no un campo de
 * datos, y el tope existe para que nadie mande un patrón de 4 KB a un `ILIKE`.
 * El mínimo NO se valida acá y es a propósito — el service distingue "muy
 * corto para mirar los mensajes" (2 caracteres) de "muy corto para buscar
 * nada" (1), y devolver un error de validación por escribir la primera letra
 * haría parpadear un cartel rojo en cada tecleo.
 *
 * Todos los filtros son opcionales y ninguno acepta valores libres: un filtro
 * corrupto de una URL vieja o de un cliente hostil no puede llegar a la
 * consulta. `etiqueta` es lo único con forma de id, y por eso pasa por
 * `UUIDSchema`: PostgREST responde 400 a un uuid mal formado y la pantalla lo
 * leería como caída.
 */
export const BuscarConversacionesSchema = z.object({
  q: z.string().trim().max(80),
  canal: CanalSchema.optional(),
  etapa: CurrentStageSchema.optional(),
  etiquetaId: UUIDSchema.optional(),
  actividad: z.enum(VENTANA_ACTIVIDAD).optional(),
  sesion: z.enum(SESION_BUSCADA).optional(),
});
export type BuscarConversacionesInput = z.infer<typeof BuscarConversacionesSchema>;
