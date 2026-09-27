import type { Canal, CurrentStage, TipoMensaje } from "./domain";

/**
 * El grafo de un workflow. Vive en `workflow_versiones.grafo` como jsonb.
 *
 * Las aristas referencian **IDs de nodo**, nunca índices posicionales. Es la
 * diferencia central con el Salesbot de Kommo, cuyo `goto: { step: 3 }` apunta
 * a una posición: insertar un paso al medio corre todos los índices y cada
 * salto queda apuntando al lugar equivocado, en silencio.
 */
export interface Grafo {
  nodos: Nodo[];
  aristas: Arista[];
}

export interface Nodo {
  /** Estable y único dentro del grafo. Las aristas apuntan acá. */
  id: string;
  tipo: NodoTipo;
  /**
   * Configuración específica del tipo. W1 la trata como objeto opaco: qué
   * disparadores y qué acciones existen lo define W3, y validarla ahora sería
   * inventar un catálogo que todavía no se diseñó.
   */
  config: Record<string, unknown>;
  /** Sólo para el canvas de W5. El motor la ignora. */
  posicion: { x: number; y: number };
}

export interface Arista {
  desde: string;
  hasta: string;
  /** Cuál salida del nodo origen. Un `condicion` tiene dos; el resto, una. */
  puerto: Puerto;
}

// Tipos de nodo legacy (compatibilidad hacia atrás)
export const NODO_TIPOS_LEGACY = ["disparador", "accion", "condicion", "espera", "fin"] as const;

// Triggers (11 tipos)
export const NODO_TIPOS_TRIGGER = [
  "trigger_mensaje",
  "trigger_webhook",
  "trigger_cron",
  "trigger_manual",
  "trigger_etiqueta",
  "trigger_etiqueta_removida",
  "trigger_etapa",
  "trigger_lead_creado",
  "trigger_vendedor_asignado",
  "trigger_inactividad",
  "trigger_formulario",
  "trigger_difusion_respondida",
] as const;

// Mensajería (8 tipos)
export const NODO_TIPOS_MENSAJERIA = [
  "msg_texto",
  "msg_botones",
  "msg_lista",
  "msg_imagen",
  "msg_documento",
  "msg_ubicacion",
  "msg_plantilla",
  "msg_reaccion",
] as const;

// CRM (11 tipos)
export const NODO_TIPOS_CRM = [
  "crm_etiqueta_add",
  "crm_etiqueta_remove",
  "crm_etapa",
  "crm_vendedor",
  "crm_round_robin",
  "crm_campo",
  "crm_tarea",
  "crm_nota",
  "crm_spam",
  "crm_archivar",
  "crm_escalar_humano",
] as const;

// Lógica (11 tipos)
export const NODO_TIPOS_LOGICA = [
  "logica_condicion",
  "logica_switch",
  "logica_validacion",
  "logica_esperar",
  "logica_esperar_respuesta",
  "logica_esperar_evento",
  "logica_loop",
  "logica_grupo",
  "logica_goto",
  "logica_detener",
  "logica_error",
] as const;

// Integraciones (6 tipos)
export const NODO_TIPOS_INTEGRACION = [
  "int_http",
  "int_webhook_out",
  "int_codigo",
  "int_email",
  "int_sheets",
  "int_db",
] as const;

// IA (8 tipos)
export const NODO_TIPOS_IA = [
  "ia_clasificar",
  "ia_responder",
  "ia_extraer",
  "ia_sentimiento",
  "ia_resumir",
  "ia_traducir",
  "ia_spam",
  "ia_delegar",
] as const;

// Internos (4 tipos)
export const NODO_TIPOS_INTERNO = [
  "int_notif_vendedor",
  "int_notif_grupo",
  "int_comentario",
  "int_debug",
] as const;

// Difusión (5 tipos) — docs/prd-workflows.md §4.6
export const NODO_TIPOS_DIFUSION = [
  "dif_audiencia",
  "dif_enviar",
  "dif_excluir",
  "dif_esperar_respuesta",
  "dif_dividir",
] as const;

// Todos los tipos de nodo (63 + 5 legacy)
export const NODO_TIPOS = [
  ...NODO_TIPOS_LEGACY,
  ...NODO_TIPOS_TRIGGER,
  ...NODO_TIPOS_MENSAJERIA,
  ...NODO_TIPOS_CRM,
  ...NODO_TIPOS_LOGICA,
  ...NODO_TIPOS_INTEGRACION,
  ...NODO_TIPOS_IA,
  ...NODO_TIPOS_INTERNO,
  ...NODO_TIPOS_DIFUSION,
] as const;

export type NodoTipo = (typeof NODO_TIPOS)[number];
export type NodoTipoTrigger = (typeof NODO_TIPOS_TRIGGER)[number];
export type NodoTipoMensajeria = (typeof NODO_TIPOS_MENSAJERIA)[number];
export type NodoTipoCRM = (typeof NODO_TIPOS_CRM)[number];
export type NodoTipoLogica = (typeof NODO_TIPOS_LOGICA)[number];
export type NodoTipoIntegracion = (typeof NODO_TIPOS_INTEGRACION)[number];
export type NodoTipoIA = (typeof NODO_TIPOS_IA)[number];
export type NodoTipoInterno = (typeof NODO_TIPOS_INTERNO)[number];
export type NodoTipoDifusion = (typeof NODO_TIPOS_DIFUSION)[number];

/** Categoría de un nodo, para asignar estilos visuales */
export type CategoriaVisual =
  | "trigger"
  | "mensajeria"
  | "crm"
  | "logica"
  | "integracion"
  | "ia"
  | "interno"
  | "difusion";

/** Devuelve la categoría visual de un tipo de nodo */
export function categoriaDeTipo(tipo: NodoTipo): CategoriaVisual | null {
  if ((NODO_TIPOS_TRIGGER as readonly string[]).includes(tipo)) return "trigger";
  if ((NODO_TIPOS_MENSAJERIA as readonly string[]).includes(tipo)) return "mensajeria";
  if ((NODO_TIPOS_CRM as readonly string[]).includes(tipo)) return "crm";
  if ((NODO_TIPOS_LOGICA as readonly string[]).includes(tipo)) return "logica";
  if ((NODO_TIPOS_INTEGRACION as readonly string[]).includes(tipo)) return "integracion";
  if ((NODO_TIPOS_IA as readonly string[]).includes(tipo)) return "ia";
  if ((NODO_TIPOS_INTERNO as readonly string[]).includes(tipo)) return "interno";
  if ((NODO_TIPOS_DIFUSION as readonly string[]).includes(tipo)) return "difusion";
  return null; // Legacy types
}

/**
 * Clasificadores de tipo compartidos entre el validador (`validar-grafo.ts`,
 * `validar-workflow.ts`) y el motor (`engine/ejecutar-workflow.ts`).
 *
 * El canvas visual persiste `Nodo.tipo` tal cual sale de la paleta —
 * "trigger_manual", "logica_condicion", etc. — nunca lo normaliza a los 5
 * tipos legacy. Comparar contra un solo literal (`tipo === "disparador"`)
 * reconoce únicamente grafos armados antes del catálogo de 57 tipos.
 */
export function esTrigger(tipo: NodoTipo): boolean {
  return tipo === "disparador" || (NODO_TIPOS_TRIGGER as readonly string[]).includes(tipo);
}

/** Únicos tipos con dos puertos de salida (`verdadero`/`falso`). */
export function esCondicion(tipo: NodoTipo): boolean {
  return tipo === "condicion" || tipo === "logica_condicion";
}

/** Cortan el segmento y programan una reanudación — cuentan como "espera" para `ciclo_sin_espera`. */
export function esEspera(tipo: NodoTipo): boolean {
  return (
    tipo === "espera" ||
    tipo === "logica_esperar" ||
    tipo === "logica_esperar_respuesta" ||
    tipo === "logica_esperar_evento"
  );
}

/** Nodos terminales: no tienen ningún puerto de salida. */
export function esFinal(tipo: NodoTipo): boolean {
  return tipo === "fin" || tipo === "logica_detener";
}

/** "Según el valor": bifurca en una salida por caso más `otro`. */
export function esSwitch(tipo: NodoTipo): boolean {
  return tipo === "logica_switch";
}

/**
 * "Ir a": no tiene puertos. Su salida es el nodo que eligió en la config
 * (`nodoDestino`), y el validador la trata como una línea más
 * (`aristasDeSalto` en `validar-grafo.ts`).
 */
export function esSalto(tipo: NodoTipo): boolean {
  return tipo === "logica_goto";
}

/**
 * Los puertos con nombre fijo. `otro` es el de "Según el valor" cuando ningún
 * caso coincide.
 */
export const PUERTOS = [
  "salida",
  "verdadero",
  "falso",
  "otro",
  "sin_respuesta",
  // "Delegar al agente" (PRD §4.5): sus cinco salidas son éstas y
  // `sin_respuesta`, la misma que vence en botones y lista.
  "resuelto",
  "humano",
  "no_pudo",
  "error",
] as const;

/** Las cinco salidas de "Delegar al agente", en el orden en que se dibujan (PRD §4.5). */
export const PUERTOS_DELEGACION = [
  "resuelto",
  "humano",
  "no_pudo",
  "sin_respuesta",
  "error",
] as const satisfies readonly (typeof PUERTOS)[number][];
export type PuertoDelegacion = (typeof PUERTOS_DELEGACION)[number];

/**
 * El puerto de un caso de "Según el valor": `caso:<id del caso>`. Va por el id
 * y no por la posición —la misma razón por la que las aristas apuntan a ids de
 * nodo—: borrar el segundo caso no puede mandar al tercero por la línea del
 * segundo.
 */
export type PuertoDeCaso = `caso:${string}`;
export type Puerto = (typeof PUERTOS)[number] | PuertoDeCaso | PuertoDeOpcion;

/**
 * El puerto de una opción de "Mensaje con botones" o "Mensaje de lista":
 * `opcion:<id de la opción>`. El id es el mismo que viaja a Meta y vuelve en
 * `button_reply.id`/`list_reply.id`, así que la respuesta del lead elige la
 * línea sin traducción. Si nadie responde a tiempo, el nodo sale por
 * `sin_respuesta`.
 */
export type PuertoDeOpcion = `opcion:${string}`;

const PREFIJO_OPCION = "opcion:";

/** Por dónde sale un nodo con opciones cuando vence su tiempo máximo. */
export const PUERTO_SIN_RESPUESTA = "sin_respuesta" satisfies (typeof PUERTOS)[number];

export function puertoDeOpcion(opcionId: string): PuertoDeOpcion {
  return `${PREFIJO_OPCION}${opcionId}`;
}

/** El id de la opción de un puerto, o `null` si no es de una opción. */
export function opcionDePuerto(puerto: string): string | null {
  return puerto.startsWith(PREFIJO_OPCION) && puerto.length > PREFIJO_OPCION.length
    ? puerto.slice(PREFIJO_OPCION.length)
    : null;
}

/**
 * El id de una opción: cabe en un puerto, en un handle de React Flow y en el
 * id de botón de Meta (256) y de fila de lista (200).
 */
export const ID_DE_OPCION = /^[A-Za-z0-9_-]{1,32}$/;

const PREFIJO_CASO = "caso:";

export function puertoDeCaso(casoId: string): PuertoDeCaso {
  return `${PREFIJO_CASO}${casoId}`;
}

/** El id del caso de un puerto, o `null` si no es de un caso. */
export function casoDePuerto(puerto: string): string | null {
  return puerto.startsWith(PREFIJO_CASO) && puerto.length > PREFIJO_CASO.length
    ? puerto.slice(PREFIJO_CASO.length)
    : null;
}

/** El id de un caso: lo que cabe en un puerto y en un handle de React Flow. */
export const ID_DE_CASO = /^[A-Za-z0-9_-]{1,64}$/;

export function esPuerto(valor: unknown): valor is Puerto {
  if (typeof valor !== "string") return false;
  if ((PUERTOS as readonly string[]).includes(valor)) return true;
  const caso = casoDePuerto(valor);
  if (caso !== null) return ID_DE_CASO.test(caso);
  const opcion = opcionDePuerto(valor);
  return opcion !== null && ID_DE_OPCION.test(opcion);
}

export const REGLAS_VALIDACION = [
  "disparador_unico",
  "disparador_sin_entrantes",
  "nodo_inalcanzable",
  "salida_sin_conectar",
  "arista_a_nodo_inexistente",
  "condicion_puertos",
  "ciclo_sin_espera",
  "ir_a_destino",
] as const;
export type ReglaValidacion = (typeof REGLAS_VALIDACION)[number];

export interface ProblemaGrafo {
  regla: ReglaValidacion;
  /** Nodos involucrados, para que el canvas de W5 los pueda pintar en rojo. */
  nodos: string[];
  mensaje: string;
}

/**
 * Por qué falló un segmento. Task 10 (el step de Inngest) lo usa para decidir
 * si reintenta: comparar contra este enum en vez de contra el texto de
 * `error` es lo que sobrevive a un reword del mensaje.
 */
export const MOTIVOS_FALLO = [
  "tope_pasos",
  "grafo_invalido",
  "condicion_invalida",
  "accion_fallo",
] as const;
export type MotivoFallo = (typeof MOTIVOS_FALLO)[number];

/**
 * Por qué un tope de seguridad saltó un mensaje (PRD §6.6). Un salto NO es un
 * fallo: el flujo se comportó como debía. El lead sale del flujo —no avanza en
 * silencio al paso siguiente— y la corrida termina con este motivo.
 *
 * Los cinco son los que lista el PRD, y los mismos que admite el CHECK de
 * `workflow_runs.motivo_salto`. `conversacion_activa` no lo produce ninguna
 * acción todavía: el PRD lo nombra pero no define qué es una conversación
 * activa para un flujo (sí para Difusión), y no se inventa.
 */
export const MOTIVOS_SALTO = [
  "tope_frecuencia",
  "dado_de_baja",
  "sin_ventana",
  "conversacion_activa",
  "requiere_humano",
] as const;
export type MotivoSalto = (typeof MOTIVOS_SALTO)[number];

export function esMotivoSalto(v: unknown): v is MotivoSalto {
  return typeof v === "string" && (MOTIVOS_SALTO as readonly string[]).includes(v);
}

/**
 * La clave con que un paso saltado deja su motivo en `workflow_run_pasos.salida`.
 * La base la lee de ahí (columna generada `motivo_salto`), así que es contrato
 * con la migración `20260925033000_workflow_saltos`: no se renombra sola.
 */
export const CLAVE_MOTIVO_SALTO = "motivo_salto";

/** El motivo de salto de un paso, leído de su salida. `null` si el paso no saltó. */
export function motivoSaltoDeSalida(
  salida: Record<string, unknown> | null | undefined,
): MotivoSalto | null {
  const v = salida?.[CLAVE_MOTIVO_SALTO];
  return esMotivoSalto(v) ? v : null;
}

/** Un mensaje que un tope saltó: dónde y por qué. */
export interface SaltoDeTope {
  motivo: MotivoSalto;
  /** Para una persona. Sin datos del lead: se persiste y se muestra. */
  detalle: string;
}

/** Lo que el ejecutor le devuelve a quien lo llamó al terminar un segmento. */
export type ResultadoSegmento =
  | {
      tipo: "espera";
      /** El nodo donde se cortó. Para la observabilidad de W4. */
      nodoId: string;
      hasta: Date;
      /**
       * Con qué nodo arranca el segmento siguiente. NO siempre es el que sigue:
       * un nodo `espera` reanuda en el que le sigue, pero una acción diferida
       * (fuera de horario) reanuda en SÍ MISMA, porque todavía no se ejecutó.
       * Lo resuelve el ejecutor y no quien llama, así la regla vive en un solo
       * lado en vez de repetirse en el runtime y en el simulador.
       */
      reanudarEn: string;
      /**
       * El contexto de la corrida al cortar el segmento -- con los merges de
       * cada acción ya aplicados (ver `ResultadoAccion.contexto`). Task 10
       * (el wiring a Inngest) lo necesita para persistir `workflow_runs.contexto`
       * en `runs.esperar()`: sin esto, el segmento siguiente arrancaría con el
       * contexto de ANTES de esta corrida en vez del real. `fin` y `fallado`
       * no lo llevan porque `terminar()`/`fallar()` no reciben contexto -- la
       * corrida terminó, nadie va a reanudarla.
       */
      contexto: ContextoRun;
      /**
       * Sólo si cortó porque un nodo mandó opciones y espera que el lead elija
       * (`ResultadoAccion.esperarRespuesta`): a qué mensaje tiene que responder.
       */
      esperaOpcion?: { respondeA: string | null };
      /**
       * Sólo si cortó porque "Delegar al agente" espera el turno siguiente del
       * agente (`ResultadoAccion.esperarTurnoAgente`).
       */
      esperaTurnoAgente?: true;
    }
  | {
      tipo: "fin";
      /**
       * Presente cuando la corrida terminó porque un tope saltó un mensaje: el
       * lead salió del flujo en `nodoId`. Viaja dentro de `fin` y no como un
       * `tipo` aparte a propósito: para quien persiste es una corrida que
       * terminó (`runs.terminar`), no una que falló.
       */
      salto?: SaltoDeTope & { nodoId: string };
    }
  | {
      tipo: "fallado";
      nodoId: string;
      /** Legible por una persona. Se persiste para mostrarlo en la UI. */
      error: string;
      motivo: MotivoFallo;
      /**
       * Si reintentar el segmento tiene sentido. Sólo `accion_fallo` puede dar
       * `true`: se calcula con `isNonRetriable()` (`src/lib/errors.ts`) sobre
       * el error crudo ANTES de aplanarlo a `error: string`, porque una vez
       * aplanado el tipo de dominio ya no existe. Todo lo demás (tope de
       * pasos, grafo mal formado, condición mal configurada) es un bug de
       * datos, no una falla transitoria: reintentarlo repite el mismo error.
       */
      retriable: boolean;
    }
  | {
      /**
       * El segmento cortó ANTES de correr `nodoId`, sin fallar y sin terminar:
       *
       * - `cancelada`: la corrida dejó de estar viva mientras corría (alguien la
       *   canceló, o la reinició un disparo nuevo). La acción no se ejecutó y el
       *   estado ya lo escribió quien la canceló.
       * - `hasta_aca`: "Ejecutar hasta acá" en Probar (`detenerEn`).
       */
      tipo: "detenido";
      nodoId: string;
      causa: "cancelada" | "hasta_aca";
    };

/** El estado que viaja entre nodos y se persiste en `workflow_runs.contexto`. */
export type ContextoRun = Record<string, unknown>;

/**
 * La marca de una corrida de "Probar" en su contexto. Esas corridas corren con
 * los efectos interceptados (`simulador.service.ts`); reanudarlas o relanzarlas
 * con el motor de producción mandaría efectos reales a un lead que sólo se usó
 * para probar. La miran el repo y, en Postgres, `reanudar_workflow_run` y
 * `relanzar_workflow_run`. Clave con `$` para que no la alcance ninguna
 * variable de texto ni ningún campo de condición.
 */
export const MARCA_CORRIDA_DE_PRUEBA = "$prueba";

export function esContextoDePrueba(contexto: ContextoRun): boolean {
  return contexto[MARCA_CORRIDA_DE_PRUEBA] === true;
}

/**
 * Lo que trae un evento de disparo para que el trigger decida si le
 * corresponde (`disparoCoincide`, `lib/workflows/recorrer.ts`): qué etiqueta se
 * puso, a qué etapa se pasó, por qué canal y qué dijo el mensaje.
 *
 * Viaja en `workflow/disparo.recibido` y NO se persiste. Lo que queda en
 * `workflow_runs.contexto` es el `contexto` del evento, no esto: por eso el
 * texto del mensaje puede venir acá —lo necesita el filtro "contiene"— sin
 * terminar copiado en otra tabla que la purga de 29 días no alcanza.
 */
export interface DatosDisparo {
  canal?: Canal;
  tipoMensaje?: TipoMensaje;
  texto?: string | null;
  tagId?: string;
  etapaAnterior?: CurrentStage | null;
  etapaNueva?: CurrentStage;
  /** "Difusión respondida": a cuál respondió el lead. */
  difusionId?: string;
}

/** Lo que devuelve una acción: por dónde seguir y qué agregar al contexto. */
export interface ResultadoAccion {
  /** Sólo `condicion` usa `verdadero`/`falso`. El resto devuelve `salida`. */
  puerto: Puerto;
  /** Se mergea sobre el contexto de la corrida. */
  contexto?: ContextoRun;
  /** Queda en `workflow_run_pasos.salida` para la observabilidad de W4. */
  salida?: Record<string, unknown>;
  /**
   * "Todavía no, volvé a intentarme a esta hora." La acción NO se ejecutó y el
   * ejecutor corta el segmento reanudando en este mismo nodo. Lo usa
   * `enviar_mensaje` fuera del horario de atención: el mensaje sale igual, a
   * una hora razonable, en vez de descartarse en silencio.
   */
  diferirHasta?: Date;
  /**
   * Un tope de seguridad saltó la acción (PRD §6.6): NO se ejecutó, y el
   * ejecutor saca al lead del flujo en vez de seguir por `puerto`.
   */
  salto?: SaltoDeTope;
  /**
   * La acción SÍ se ejecutó —mandó botones o una lista— y ahora espera que el
   * lead elija. El ejecutor corta el segmento reanudando en este mismo nodo
   * (`puerto` no se usa): `workflow-segmento` espera la respuesta a
   * `respondeA` hasta `hasta`, y la segunda pasada del nodo sale por la opción
   * elegida o por «sin respuesta». A diferencia de `diferirHasta`, el
   * `contexto` de la acción sí se aplica: lleva la espera.
   */
  esperarRespuesta?: { hasta: Date; respondeA: string | null };
  /**
   * "Delegar al agente": el nodo le cedió la conversación al agente y espera
   * su próximo turno (`workflow/delegacion.turno`) o, a más tardar, `hasta`.
   * Como `esperarRespuesta`: corta reanudando en este mismo nodo, con el
   * `contexto` de la acción aplicado, y la pasada siguiente decide la salida.
   */
  esperarTurnoAgente?: { hasta: Date };
}
