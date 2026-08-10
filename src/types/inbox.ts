import type { Canal, CurrentStage, Direction, MotivoAtencion, Urgencia } from "./domain";
import type { Lead, LeadSession, Mensaje, Producto, Tag, UUID } from "./entities";

/**
 * Item de inbox: lead con sesión activa + último mensaje + canales vinculados.
 * Forma derivada — no es entity DB. Producida por `InboxService.listActiveLeads`.
 * Vive en `types/` porque UI (components/) y service (server-services/) la
 * comparten — boundaries no permite components→server-services.
 */
export interface InboxItem {
  leadId: UUID;
  sessionId: UUID;
  nombre: string;
  currentStage: CurrentStage;
  iaPausada: boolean;
  ultimaActividad: Date;
  ultimoMensaje: {
    body: string;
    direction: Direction;
    createdAt: Date;
  } | null;
  canales: Canal[];
  /** Canal de la conversación con el mensaje más reciente. `null` sin canales. */
  canalActivo: Canal | null;
  /** Mensajes del cliente posteriores a la última respuesta nuestra. */
  sinResponder: number;
  /** Desde cuándo espera el primero de esos mensajes. */
  esperandoDesde: Date | null;
  /** Urgencia inferida por el extractor; `alta` marca la fila con el rayo. */
  urgencia: Urgencia;
  /** Por qué requiere atención; `null` = la IA la está manejando sola. */
  motivo: MotivoAtencion | null;
}

/**
 * Resultado serializable de Server Actions inbox (8.4-8.5). Vive en types/
 * porque client components (components/) tipan la prop action y las actions
 * (app/) construyen el valor — boundaries no permite components→app.
 */
export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Vista completa de conversación por lead (Slice 2 8.2). Producida por
 * `InboxService.getConversation`. `session` null cuando no hay sesión activa
 * (URL stale post-cierre); en ese caso `messages` vacío.
 */
export interface ConversationView {
  lead: Lead;
  session: LeadSession | null;
  // Mensajes de la sesión activa, ASC (viejo→nuevo), cap 200.
  messages: Mensaje[];
  // Canales con conversación existente (dedup).
  canales: Canal[];
  // Canal de la conversación con actividad más reciente; fallback canal_origen.
  canalActivo: Canal;
  /**
   * Producto del catálogo que la sesión cotizó, resuelto desde
   * `producto_cotizado_id`. Es lo único del Twin que NO sale del extractor: por
   * eso lleva chip "Del catálogo" y no se puede editar a mano. `null` cuando la
   * sesión no cotizó nada del catálogo (el LLM puede haber dejado precio y
   * código sueltos sin machear una fila de `productos`).
   */
  producto: Producto | null;
  /** Tags del lead, para la sección Tags del Twin. */
  tags: Tag[];
  /** Sesiones anteriores del mismo lead: "4 · 3 con compra" del handoff §1.4. */
  sesionesPrevias: SesionesPrevias;
  /**
   * Lo que la IA lleva gastado en esta conversación. `null` cuando no hay
   * sesión activa: sin sesión no hay a qué atribuirle gasto, y el Twin muestra
   * su estado vacío igual.
   */
  gastoIa: GastoSesion | null;
}

/**
 * Cuánto costó la conversación, o por qué no se puede decir.
 *
 * Es una unión y no un número porque cero no es un solo caso. Una conversación
 * que resolvieron las reglas costó cero de verdad —esa es la buena noticia del
 * producto— y una anterior a que existiera el registro también suma cero, pero
 * ahí el cero es ignorancia. Mostrar "$0,00" en los dos lugares haría pasar lo
 * segundo por lo primero, que es justo la lectura equivocada: el vendedor
 * concluiría que el agente sale gratis.
 */
export type GastoSesion =
  /** Hay filas: `usd` es plata efectivamente gastada en `llamadas` llamadas. */
  | { estado: "medido"; usd: number; llamadas: number }
  /** Sin filas, pero la sesión es posterior al inicio del registro: gastó cero. */
  | { estado: "sin_gasto" }
  /** Sin filas y la sesión es anterior al registro: no hay dato, no hay cero. */
  | { estado: "sin_registro" };

/**
 * Historial del lead reducido a lo que el Twin muestra. No incluye la sesión
 * abierta: la línea dice qué pasó *antes* de esta conversación.
 */
export interface SesionesPrevias {
  total: number;
  /** De esas, las que cerraron con `resultado = exito`. */
  conCompra: number;
}

/**
 * De dónde salió el valor actual de un campo del Twin, ya resuelto a algo que
 * se puede leer. La entidad guarda un `mensaje_origen_id`; la línea que el
 * vendedor lee ("origen: mensaje del cliente · 09:12") necesita el mensaje
 * resuelto, y resolverlo es trabajo del server, no del componente.
 */
export interface OrigenCampo {
  /** "mensaje del cliente", "respuesta del agente", "el extractor". */
  fuente: string;
  /** Hora local del mensaje de origen, `HH:mm`. `null` si no se pudo atribuir. */
  hora: string | null;
}
