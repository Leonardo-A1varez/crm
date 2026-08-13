import type { Canal, CurrentStage, Direction, MotivoAtencion, Urgencia } from "./domain";
import type {
  Lead,
  LeadSession,
  Mensaje,
  PlantillaSaliente,
  Producto,
  SessionRecordatorio,
  Tag,
  UUID,
} from "./entities";

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
 * Qué conversaciones mirar. `activa` son las que están abiertas —las que la
 * lista del Inbox ya muestra— y `cerrada` las que terminaron. Sin filtro salen
 * las dos, que es el punto del buscador: el mensaje que uno busca suele estar
 * en una conversación que ya cerró.
 *
 * El filtro de actividad no tiene tipo propio acá: son las mismas tres ventanas
 * de `/leads` (`VentanaActividad` en `types/leads`) y las cotas las sigue
 * calculando `cotasActividad`.
 */
export const SESION_BUSCADA = ["activa", "cerrada"] as const;
export type SesionBuscada = (typeof SESION_BUSCADA)[number];

/**
 * El pedazo de mensaje donde cayó la búsqueda.
 *
 * `texto` ya viene recortado alrededor de la coincidencia (`recorteConCoincidencia`):
 * el cliente lo parte con `partirTexto` y lo dibuja como nodos. Nunca como HTML
 * — el contenido lo escribió un tercero por WhatsApp.
 */
export interface FragmentoCoincidencia {
  mensajeId: UUID;
  texto: string;
  recortadoInicio: boolean;
  recortadoFin: boolean;
  direction: Direction;
  createdAt: Date;
}

/**
 * Una conversación encontrada por el buscador del Inbox.
 *
 * Es por lead y no por sesión: el panel navega a `/inbox/[leadId]`, que es la
 * conversación del lead, y un lead con tres sesiones históricas es una sola
 * fila y no tres.
 */
export interface ResultadoBusqueda {
  leadId: UUID;
  nombre: string;
  telefono: string;
  canalOrigen: Canal;
  /** Etapa de la sesión abierta; `null` cuando la última cerró. */
  currentStage: CurrentStage | null;
  sesionActiva: boolean;
  ultimaActividad: Date;
  /** `null` cuando la coincidencia fue por nombre, perfil o teléfono. */
  fragmento: FragmentoCoincidencia | null;
  /** Cuántos mensajes de este lead coincidieron. `0` sin match de contenido. */
  mensajesCoincidentes: number;
}

/**
 * Lo que devuelve una búsqueda. `truncado` existe para que la mini-pantalla
 * pueda decir que quedaron resultados afuera: un buscador que corta en silencio
 * hace creer que el mensaje no existe.
 */
export interface BusquedaPage {
  resultados: ResultadoBusqueda[];
  truncado: boolean;
  limite: number;
  /**
   * `true` cuando el término era demasiado corto para buscar dentro de los
   * mensajes y solo se miraron los datos del lead. La mini-pantalla lo dice.
   */
  soloDatosDelLead: boolean;
}

export type ResultadoBusquedaAction =
  | { ok: true; pagina: BusquedaPage }
  | { ok: false; error: string };

/**
 * Resultado serializable de Server Actions inbox (8.4-8.5). Vive en types/
 * porque client components (components/) tipan la prop action y las actions
 * (app/) construyen el valor — boundaries no permite components→app.
 */
export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * La mitad fallida de cualquier resultado de action. Nombrada porque el mapeo
 * de errores es común a todas y sus resultados ya no son todos `ActionResult`:
 * la auditoría por turno devuelve datos en el caso feliz.
 */
export type ActionError = Extract<ActionResult, { ok: false }>;

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
  /** Tags del lead, para la sección Etiquetas del Twin. */
  tags: Tag[];
  /**
   * Catálogo completo de tags, para el selector de "+ Agregar etiquetas". Viaja
   * con la vista y no por una action aparte porque el selector filtra mientras
   * se escribe: traerlo al abrir el popover obligaría a un estado de carga
   * sobre una tabla que en producción tiene decenas de filas, no miles.
   */
  tagsDisponibles: Tag[];
  /** Sesiones anteriores del mismo lead: "4 · 3 con compra" del handoff §1.4. */
  sesionesPrevias: SesionesPrevias;
  /**
   * Lo que la IA lleva gastado en esta conversación. `null` cuando no hay
   * sesión activa: sin sesión no hay a qué atribuirle gasto, y el Twin muestra
   * su estado vacío igual.
   */
  gastoIa: GastoSesion | null;
  /**
   * El seguimiento vivo de esta conversación, si hay uno. `null` = no hay
   * ninguno y el Twin ofrece programarlo.
   */
  recordatorio: SessionRecordatorio | null;
  handoffStatus: {
    motivo: import("@/types/entities").HandoffEvent["reason_code"];
    aviso: "enviado" | "pendiente" | "no_aplica";
  } | null;
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

/** Una llamada al modelo dentro de un turno, tal como quedó en `llm_usage`. */
export interface LlamadaModelo {
  /** Valor crudo de `llm_usage.workflow`; la UI lo traduce. */
  workflow: string;
  modelo: string;
  inputTokens: number;
  outputTokens: number;
  usd: number;
}

/**
 * Lo que costó el turno. Misma forma que `GastoSesion` y por la misma razón:
 * cero llamadas no es cero dólares, es ninguna medición.
 *
 * Acá la frontera no hace falta preguntarla: el clasificador de intents corre
 * en **todos** los turnos, antes de que las reglas puedan cortar el camino. Un
 * turno que el pipeline midió tiene por construcción al menos una fila; sin
 * ninguna, lo único que se sabe es que no se midió.
 */
export type GastoTurno =
  | { estado: "medido"; usd: number; llamadas: LlamadaModelo[] }
  | { estado: "sin_registro" };

/** Una llamada a herramienta del agente dentro del turno (`tool_executions`). */
export interface HerramientaDelTurno {
  nombre: string;
  /** Mensaje de error si la herramienta falló; `null` si devolvió bien. */
  error: string | null;
  duracionMs: number | null;
}

/**
 * Quién resolvió el turno. Las dos primeras variantes son las dos mitades que
 * escribe el pipeline: `rule_executions` cuando una regla IF/THEN cubrió el
 * intent, `turn_classifications` cuando no la hubo y contestó el modelo.
 */
export type DecisionTurno =
  /** `nombre` identifica la regla por su respuesta: el schema no le da nombre propio. */
  | { tipo: "regla"; nombre: string; intent: string | null }
  /** `intent` en `null` = el clasificador no reconoció ningún intent activo. */
  | { tipo: "llm"; intent: string | null; confianza: number }
  /** Ninguna de las dos tablas tiene fila para este turno. */
  | { tipo: "sin_registro" };

/**
 * Por qué el agente contestó lo que contestó, para **un** mensaje saliente.
 *
 * Se pide de a un turno y solo cuando alguien lo despliega: traer esto para los
 * 200 mensajes del hilo serían cientos de filas de cuatro tablas para responder
 * una pregunta que se hace sobre una sola burbuja.
 *
 * `sin_registro` no es un error ni un cero. Es lo mismo que hace el gasto del
 * Twin: si el turno es anterior a que la auditoría existiera, o si el saliente
 * no salió del pipeline, se dice que no se midió en vez de dibujar un turno que
 * nadie registró.
 *
 * `plantilla` es lo contrario de `sin_registro` y por eso es una variante y no
 * un motivo más: el turno no dejó filas de auditoría porque el pipeline cortó
 * antes de gastar en el clasificador y en el agente, pero quién lo resolvió se
 * sabe con certeza.
 */
export type AuditoriaTurno =
  | {
      estado: "plantilla";
      /** Cuál de las plantillas fijas contestó. Hoy hay una sola. */
      tipo: PlantillaSaliente;
    }
  | {
      estado: "sin_registro";
      /**
       * `sin_ancla`: el saliente no se puede atar a un mensaje entrante (lo
       * escribió una persona, o es anterior a la clave `out:<id>`).
       * `sin_medicion`: el turno se encontró pero ninguna de las cuatro tablas
       * tiene una fila suya.
       */
      motivo: "sin_ancla" | "sin_medicion";
    }
  | {
      estado: "medido";
      decision: DecisionTurno;
      herramientas: HerramientaDelTurno[];
      gasto: GastoTurno;
      /** Hora del mensaje entrante que abrió el turno. */
      turnoAt: Date;
    };

/**
 * Resultado de la Server Action que lee la auditoría. No usa `ActionResult`
 * porque esta acción no escribe nada: lo que devuelve es el dato pedido.
 */
export type ResultadoAuditoria =
  | { ok: true; auditoria: AuditoriaTurno }
  | { ok: false; error: string };

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
