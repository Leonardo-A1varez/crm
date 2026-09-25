/**
 * El contrato de la config de cada bloque de un workflow: qué claves guarda
 * `Nodo.config`, de qué tipo es cada una, cuáles son obligatorias y con qué
 * valor cuenta una que el panel muestra pero todavía no escribió.
 *
 * ## Por qué existe
 *
 * Tres lados tocan esa config: los formularios del panel
 * (`components/workflows/canvas/config/`), el validador de antes de publicar
 * (`validar-workflow.ts`) y las acciones que la ejecutan
 * (`server/services/workflows/acciones/`). Cada uno nombraba las claves por su
 * cuenta y divergieron: el panel guardaba `tagIds` y `etapaId`, el validador
 * pedía `tag_id` y `etapa`, y un bloque bien configurado no se podía publicar.
 * Las claves se nombran acá y en ningún otro lado: el panel escribe con
 * `editorDeConfig`, el validador revisa con `revisarConfig` y cada acción lee
 * con `configDeAccion`. `tests/unit/workflows/config-nodos-contrato.test.tsx`
 * aprieta el formulario real y falla si los tres dejan de coincidir.
 *
 * ## Qué dice cada schema
 *
 * - **Claves y tipos:** los que escribe el formulario del panel.
 * - **Obligatorios:** los que exige la acción que ejecuta el bloque, cuando hay
 *   una; en los tipos que el motor todavía no sabe ejecutar, los que ya exigía
 *   el validador. Nada más: un requisito inventado acá bloquearía publicar
 *   flujos que hoy pasan. Quien implemente la acción de uno de esos tipos
 *   endurece su schema acá, y el panel y el validador lo siguen solos.
 * - **Defaults:** lo que el panel muestra elegido sin escribirlo hasta que
 *   alguien toca el campo. Es el mismo valor con que lo lee la acción.
 *
 * ## Claves viejas
 *
 * `alias` lista, por clave, cómo se llamó antes. Se aceptan las que aceptaba
 * algún lector de antes —la acción o el validador—, así nada que funcionaba
 * deja de funcionar. En los tipos que lee código que no pasa por este módulo
 * (los disparadores, que lee `lib/workflows/recorrer.ts`, y las esperas, que
 * lee `ejecutor.service.ts`) no hay alias: validar una clave que ese código
 * ignora haría que el validador apruebe algo distinto de lo que corre.
 *
 * Si están la clave vieja y la nueva, gana la nueva: es la que escribe el
 * panel, o sea lo último que alguien eligió. El panel reescribe el bloque con
 * las claves nuevas la primera vez que se edita.
 *
 * ## Fuera del contrato
 *
 * La condición (`logica_condicion` y el `condicion` legacy): su config es el
 * árbol Y/O, que define otro stream. El validador conserva su chequeo propio.
 */

import { z } from "zod";
import { ValidationError } from "@/lib/errors";
import { CURRENT_STAGE, ETAPAS_EMBUDO } from "@/types/domain";
import { ACCIONES, DISPARADORES, EVENTOS_ESPERABLES, type AccionWorkflow } from "./catalogo";
import type { Nodo, NodoTipo } from "@/types/workflows";
import type { DatosInterpolacion } from "./variables";

/** No impide publicar, pero quien publica tiene que verla. */
export interface Advertencia {
  mensaje: string;
  sugerencia?: string;
}

/** Una clave vieja. `convertir` adapta el valor cuando cambió de forma, no sólo de nombre. */
type ClaveVieja = string | { clave: string; convertir: (valor: unknown) => unknown };

/**
 * Lo que el panel y las advertencias ven de una config: las claves del schema,
 * con los valores tal como están guardados, sin validar.
 */
type VistaConfig<S extends z.ZodObject> = Readonly<
  Partial<Record<keyof z.output<S> & string, unknown>>
>;

export interface EspecConfig<S extends z.ZodObject = z.ZodObject> {
  readonly schema: S;
  readonly alias?: Readonly<Partial<Record<keyof z.output<S> & string, readonly ClaveVieja[]>>>;
  readonly advertencias?: (config: VistaConfig<S>) => Advertencia[];
}

/** Arma un `EspecConfig` con las claves de `alias` y `advertencias` chequeadas contra el schema. */
function espec<S extends z.ZodObject>(
  schema: S,
  extras: Omit<EspecConfig<S>, "schema"> = {},
): EspecConfig<S> {
  return { schema, ...extras };
}

/** Texto que no puede quedar vacío ni en blanco. No se recorta: lo que sale es lo que se escribió. */
function textoObligatorio(mensaje: string) {
  return z.string({ error: mensaje }).refine((s) => s.trim() !== "", { error: mensaje });
}

// ──────────────────────────────────────────────────────────────────────────
// Lo que el panel ofrece para elegir (los valores que se guardan)
// ──────────────────────────────────────────────────────────────────────────

const UNIDADES_DE_TIEMPO = ["minutos", "horas", "dias"] as const;

/** Por dónde manda `msg_texto`. "inferir" = por el canal de la conversación activa. */
export const CANALES_DE_ENVIO = ["inferir", "whatsapp", "instagram", "messenger"] as const;
export type CanalDeEnvio = (typeof CANALES_DE_ENVIO)[number];

const ETAPA_ORIGEN = ["cualquiera", ...CURRENT_STAGE] as const;

const CABECERA = z.object({ key: z.string(), value: z.string() });

// ──────────────────────────────────────────────────────────────────────────
// Las acciones que el motor ejecuta
// ──────────────────────────────────────────────────────────────────────────

const ENVIAR_MENSAJE = espec(
  z.object({
    canal: z
      .enum(CANALES_DE_ENVIO, {
        error: (iss) =>
          `El canal ${JSON.stringify(iss.input)} no es uno de los que ofrece el bloque`,
      })
      .default("inferir"),
    mensaje: textoObligatorio("El mensaje no puede estar vacío"),
  }),
  { alias: { mensaje: ["texto"] } },
);

const MENSAJE_SIN_ETIQUETA = "Selecciona una etiqueta";

/** Una sola etiqueta guardada como string: antes de que el panel permitiera elegir varias. */
const ETIQUETA_SUELTA: readonly ClaveVieja[] = ["tagId", "tag_id", "etiqueta_id"].map((clave) => ({
  clave,
  convertir: (valor: unknown) => (typeof valor === "string" ? [valor] : valor),
}));

const ETIQUETAS = z.object({
  tagIds: z
    .array(z.string().min(1, { error: MENSAJE_SIN_ETIQUETA }), { error: MENSAJE_SIN_ETIQUETA })
    .min(1, { error: MENSAJE_SIN_ETIQUETA }),
});

const PONER_ETIQUETA = espec(ETIQUETAS, { alias: { tagIds: ETIQUETA_SUELTA } });

/**
 * Sólo las seis etapas del embudo. `perdido` y `requiere_humano` son desvíos:
 * los decide el pipeline, y la acción `cambiar_etapa` los rechaza (ver su doc
 * comment en `acciones/internas.ts`).
 */
const CAMBIAR_ETAPA = espec(
  z.object({
    etapaId: z.enum(ETAPAS_EMBUDO, {
      error: (iss) =>
        iss.input === undefined || iss.input === ""
          ? "Selecciona a qué etapa mover"
          : `La etapa ${JSON.stringify(iss.input)} no es un paso del embudo: un flujo sólo mueve a ${ETAPAS_EMBUDO.join(", ")}`,
    }),
  }),
  { alias: { etapaId: ["etapa"] } },
);

/**
 * Delega en `HandoffService.pause`. `avisarAlCliente` es su `notifyCustomer`:
 * por defecto le avisa, que es lo que hacía el nodo legacy (que no guarda la
 * clave y por eso se lee con el default).
 */
const ESCALAR_A_HUMANO = espec(z.object({ avisarAlCliente: z.boolean().default(true) }));

/** Lo que recibe `AsignacionService.asignar(sessionId, vendedorId)`. */
const ASIGNAR_VENDEDOR = espec(
  z.object({ vendedorId: textoObligatorio("Selecciona un vendedor para asignar") }),
  { alias: { vendedorId: ["vendedor_id", "user_id"] } },
);

/** Lo mismo que rechaza `elegirVendedorRoundRobin` (`lib/round-robin.ts`): un tope que no es un entero ≥ 1. */
const MENSAJE_TOPE_ROUND_ROBIN =
  "El tope de sesiones abiertas por vendedor tiene que ser un entero mayor que cero";

/**
 * Lo recibe `AsignacionService.asignarPorRoundRobin` como `{ candidatos, tope }`
 * y reparte `elegirVendedorRoundRobin` (`lib/round-robin.ts`). No hay `modo`: el
 * reparto es uno solo, el que hace más que no recibe. El tope cuenta sesiones
 * abiertas a la vez por vendedor (confirmado por el dueño); la unidad va en el
 * nombre del campo.
 */
const REPARTIR_ROUND_ROBIN = espec(
  z.object({
    // En el orden en que los cargó el admin: desempata.
    candidatos: z.array(z.string().min(1)).default(() => []),
    topeSesionesAbiertasPorVendedor: z
      .number({ error: MENSAJE_TOPE_ROUND_ROBIN })
      .int({ error: MENSAJE_TOPE_ROUND_ROBIN })
      .min(1, { error: MENSAJE_TOPE_ROUND_ROBIN })
      .nullable()
      .default(null),
  }),
  {
    alias: { candidatos: ["vendedorIds"] },
    advertencias: (c) =>
      Array.isArray(c.candidatos) && c.candidatos.length > 0
        ? []
        : [{ mensaje: "El round robin no tiene vendedores: no va a asignar ninguna sesión" }],
  },
);

/**
 * Una plantilla aprobada de WhatsApp. `parametros` son las variables del cuerpo
 * (`{{1}}`, `{{2}}`…) en orden; cada una admite variables de texto
 * (`{{lead.nombre}}`), que se resuelven al mandar.
 */
const ENVIAR_PLANTILLA = espec(
  z.object({
    templateName: textoObligatorio("Selecciona una plantilla HSM"),
    idioma: z.enum(["es", "es_MX", "es_AR", "pt_BR", "en"]).default("es"),
    parametros: z
      .array(textoObligatorio("Una variable de la plantilla está vacía"))
      .default(() => []),
  }),
  { alias: { templateName: ["template_name", "nombre"] } },
);

/**
 * Qué config lee cada acción del motor. `satisfies` contra `AccionWorkflow`:
 * una acción nueva en el catálogo sin su schema no compila.
 */
export const ESPEC_CONFIG_POR_ACCION = {
  enviar_mensaje: ENVIAR_MENSAJE,
  poner_etiqueta: PONER_ETIQUETA,
  cambiar_etapa: CAMBIAR_ETAPA,
  escalar_a_humano: ESCALAR_A_HUMANO,
  asignar_vendedor: ASIGNAR_VENDEDOR,
  repartir_round_robin: REPARTIR_ROUND_ROBIN,
  enviar_plantilla: ENVIAR_PLANTILLA,
} as const satisfies Record<AccionWorkflow, EspecConfig>;

// ──────────────────────────────────────────────────────────────────────────
// Un schema por tipo de nodo
// ──────────────────────────────────────────────────────────────────────────

export const TIPOS_FUERA_DEL_CONTRATO = ["condicion", "logica_condicion"] as const;

/** Todo tipo salvo la condición y el legacy `accion`, cuya config depende de `config.accion`. */
export type TipoConfigurable = Exclude<
  NodoTipo,
  "accion" | (typeof TIPOS_FUERA_DEL_CONTRATO)[number]
>;

function media(mensajeSinUrl: string) {
  return z.object({
    tipoMedia: z.enum(["url", "archivo"]).default("url"),
    url: textoObligatorio(mensajeSinUrl),
  });
}

const MENSAJE_SIN_ESPERA = "Define cuánto tiempo esperar";
const MENSAJE_SIN_INACTIVIDAD = "Define el tiempo de inactividad que dispara el workflow";
const MENSAJE_SIN_BOTONES = "Debes agregar al menos un botón";
const MENSAJE_SIN_SECCIONES = "Debes agregar al menos una sección a la lista";
const MENSAJE_SIN_CRON = "Define la frecuencia de ejecución (expresión cron)";
const MENSAJE_SIN_ETIQUETA_DISPARADORA = "Selecciona qué etiqueta dispara el workflow";

/**
 * `satisfies` contra `TipoConfigurable`: un tipo de nodo nuevo sin su schema
 * no compila, y tampoco uno que no exista.
 */
export const ESPEC_CONFIG_POR_TIPO = {
  // ── Legacy ────────────────────────────────────────────────────────────
  disparador: espec(z.object({ disparador: z.enum(DISPARADORES).optional() })),
  // `ejecutor.service.ts` lee `minutos`; ausente, espera 60.
  espera: espec(z.object({ minutos: z.number().optional() })),
  fin: espec(z.object({})),

  // ── Disparadores ──────────────────────────────────────────────────────
  // Los tres que tienen emisor los lee `recorrer.ts` (`disparoCoincide`).
  trigger_mensaje: espec(
    z.object({
      canal: z.enum(["todos", "whatsapp", "instagram", "messenger"]).default("todos"),
      filtro: z.enum(["todos", "solo_texto", "solo_media", "contiene"]).default("todos"),
      palabra: z.string().optional(),
    }),
  ),
  // Sólo lectura en el panel: la URL y el secreto los genera el sistema.
  trigger_webhook: espec(
    z.object({
      url: z.string().optional(),
      id: z.string().optional(),
      secret: z.string().optional(),
    }),
  ),
  trigger_cron: espec(
    z
      .object({
        frecuencia: z
          .enum(["cada_hora", "diario", "semanal", "mensual", "personalizado"])
          .default("diario"),
        hora: z.string().default("09:00"),
        // Índice del selector de días del panel, que arranca en lunes.
        dias: z.array(z.number().int().min(0).max(6)).default(() => []),
        cron: z.string().default("0 9 * * *"),
        timezone: z.string().default("America/Mexico_City"),
      })
      // La expresión sólo cuenta en la frecuencia personalizada: las otras
      // cuatro se arman con `hora` y `dias`.
      .superRefine((c, ctx) => {
        if (c.frecuencia === "personalizado" && c.cron.trim() === "") {
          ctx.addIssue({ code: "custom", path: ["cron"], message: MENSAJE_SIN_CRON });
        }
      }),
    { alias: { cron: ["expresion"] } },
  ),
  trigger_manual: espec(z.object({})),
  trigger_etiqueta: espec(z.object({ tagId: textoObligatorio(MENSAJE_SIN_ETIQUETA_DISPARADORA) })),
  trigger_etiqueta_removida: espec(
    z.object({ tagId: textoObligatorio(MENSAJE_SIN_ETIQUETA_DISPARADORA) }),
    { alias: { tagId: ["tag_id", "etiqueta_id"] } },
  ),
  trigger_etapa: espec(
    z.object({
      etapaOrigen: z.enum(ETAPA_ORIGEN).default("cualquiera"),
      etapaDestino: z.enum(CURRENT_STAGE, { error: "Selecciona qué etapa dispara el workflow" }),
    }),
  ),
  trigger_lead_creado: espec(z.object({})),
  trigger_vendedor_asignado: espec(z.object({})),
  trigger_inactividad: espec(
    z.object({
      duracion: z
        .number({ error: MENSAJE_SIN_INACTIVIDAD })
        .positive({ error: MENSAJE_SIN_INACTIVIDAD })
        .default(24),
      unidad: z.enum(UNIDADES_DE_TIEMPO).default("horas"),
    }),
    { alias: { duracion: ["tiempo"] } },
  ),
  trigger_formulario: espec(z.object({})),

  // ── Mensajería ────────────────────────────────────────────────────────
  msg_texto: ENVIAR_MENSAJE,
  msg_botones: espec(
    z.object({
      mensaje: textoObligatorio("El mensaje con botones necesita un texto"),
      botones: z
        .array(
          z.object({
            texto: z.string(),
            accion: z.enum(["responder", "url", "llamar"]),
            valor: z.string(),
          }),
          { error: MENSAJE_SIN_BOTONES },
        )
        .min(1, { error: MENSAJE_SIN_BOTONES }),
    }),
    {
      advertencias: (c) =>
        Array.isArray(c.botones) && c.botones.length > 3
          ? [{ mensaje: "WhatsApp solo permite hasta 3 botones" }]
          : [],
    },
  ),
  msg_lista: espec(
    z.object({
      // El título de la lista. El validador de antes lo pedía como `titulo`,
      // que ningún formulario escribió nunca: el panel lo guarda en `header`.
      header: textoObligatorio("La lista necesita un título"),
      body: z.string().optional(),
      footer: z.string().optional(),
      botonTexto: z.string().default("Ver opciones"),
      secciones: z
        .array(
          z.object({
            titulo: z.string(),
            items: z.array(z.object({ titulo: z.string(), descripcion: z.string() })),
          }),
          { error: MENSAJE_SIN_SECCIONES },
        )
        .min(1, { error: MENSAJE_SIN_SECCIONES }),
    }),
    { alias: { header: ["titulo"] } },
  ),
  msg_imagen: espec(
    media("La imagen necesita una URL").extend({ caption: z.string().optional() }),
    {
      alias: { url: ["media_url"] },
    },
  ),
  msg_documento: espec(
    media("El documento necesita una URL").extend({ nombreArchivo: z.string().optional() }),
    { alias: { url: ["media_url"] } },
  ),
  msg_ubicacion: espec(
    z.object({
      lat: z.number().optional(),
      lon: z.number().optional(),
      nombre: z.string().optional(),
      direccion: z.string().optional(),
    }),
  ),
  msg_plantilla: ENVIAR_PLANTILLA,
  msg_reaccion: espec(z.object({ emoji: z.string().optional() })),

  // ── CRM ───────────────────────────────────────────────────────────────
  crm_etiqueta_add: PONER_ETIQUETA,
  crm_etiqueta_remove: espec(ETIQUETAS, { alias: { tagIds: ETIQUETA_SUELTA } }),
  crm_etapa: CAMBIAR_ETAPA,
  crm_vendedor: ASIGNAR_VENDEDOR,
  crm_round_robin: REPARTIR_ROUND_ROBIN,
  crm_escalar_humano: ESCALAR_A_HUMANO,
  crm_campo: espec(
    z.object({
      campo: textoObligatorio("Selecciona qué campo actualizar"),
      valor: z.string().optional(),
    }),
    {
      advertencias: (c) =>
        c.valor === undefined || c.valor === null || c.valor === ""
          ? [{ mensaje: "El valor del campo está vacío" }]
          : [],
    },
  ),
  crm_tarea: espec(
    z.object({
      titulo: z.string().optional(),
      descripcion: z.string().optional(),
      vencimiento: z.number().default(24),
      unidadVencimiento: z.enum(UNIDADES_DE_TIEMPO).default("horas"),
      // "vendedor_actual" o el id de un usuario.
      asignarA: z.string().default("vendedor_actual"),
    }),
  ),
  crm_nota: espec(z.object({ contenido: z.string().optional() })),
  crm_spam: espec(z.object({ razon: z.string().optional(), bloquear: z.boolean().default(false) })),
  crm_archivar: espec(
    z.object({
      motivo: z
        .enum(["sin_interes", "no_calificado", "duplicado", "sin_respuesta", "otro"])
        .default("sin_interes"),
    }),
  ),

  // ── Lógica ────────────────────────────────────────────────────────────
  logica_switch: espec(
    z.object({
      campo: textoObligatorio("Selecciona un campo para el switch"),
      casos: z.array(z.object({ valor: z.string(), id: z.string() })).default(() => []),
    }),
    {
      advertencias: (c) =>
        Array.isArray(c.casos) && c.casos.length > 0
          ? []
          : [{ mensaje: "El switch no tiene casos definidos" }],
    },
  ),
  logica_validacion: espec(
    z.object({
      campo: z.string().optional(),
      validacion: z
        .enum(["requerido", "email", "telefono", "numero", "regex"])
        .default("requerido"),
      regex: z.string().optional(),
      mensajeError: z.string().optional(),
    }),
  ),
  // `ejecutor.service.ts` lee `duracion` y `unidad`, con estos mismos defaults.
  logica_esperar: espec(
    z.object({
      duracion: z
        .number({ error: MENSAJE_SIN_ESPERA })
        .positive({ error: MENSAJE_SIN_ESPERA })
        .default(1),
      unidad: z
        .enum(["segundos", "minutos", "horas", "dias"], {
          error: "Elegí en qué unidad se cuenta la espera",
        })
        .default("horas"),
    }),
  ),
  logica_esperar_respuesta: espec(
    z.object({
      timeout: z.number().default(24),
      unidadTimeout: z.enum(UNIDADES_DE_TIEMPO).default("horas"),
      mensajeTimeout: z.string().optional(),
    }),
    {
      advertencias: (c) =>
        typeof c.timeout === "number" && c.timeout > 0
          ? []
          : [
              {
                mensaje: "No hay timeout definido, la espera podría ser indefinida",
                sugerencia: "Configura un tiempo máximo de espera",
              },
            ],
    },
  ),
  // El motor sólo arma la espera con un evento que alguien emite
  // (`EVENTOS_ESPERABLES`): sin evento, o con uno sin emisor, la corrida falla
  // al llegar al nodo, así que el validador lo rechaza antes de publicar.
  logica_esperar_evento: espec(
    z
      .object({
        evento: z
          .enum(["etiqueta_asignada", "etapa_cambiada", "vendedor_asignado", "comprobante_subido"])
          .optional(),
        timeoutMax: z.number().default(7),
        unidadTimeoutMax: z.enum(["horas", "dias"]).default("dias"),
      })
      .superRefine((c, ctx) => {
        if (c.evento === undefined) {
          ctx.addIssue({ code: "custom", path: ["evento"], message: "Elegí qué evento esperar" });
        } else if (!(EVENTOS_ESPERABLES as readonly string[]).includes(c.evento)) {
          ctx.addIssue({
            code: "custom",
            path: ["evento"],
            message: `Nada emite todavía «${c.evento}»: la espera vencería siempre por tiempo`,
          });
        }
      }),
  ),
  logica_loop: espec(
    z.object({
      campo: z.string().optional(),
      variableItem: z.string().default("item"),
      maxIteraciones: z.number().default(10),
    }),
  ),
  logica_grupo: espec(z.object({})),
  logica_goto: espec(z.object({ nodoDestino: z.string().optional() })),
  logica_detener: espec(
    z.object({
      resultado: z.enum(["exito", "error", "cancelado"]).default("exito"),
      mensaje: z.string().optional(),
    }),
  ),
  logica_error: espec(
    z.object({
      accion: z.enum(["continuar", "reintentar", "detener", "notificar"]).default("continuar"),
      reintentos: z.number().default(3),
    }),
  ),

  // ── Integraciones ─────────────────────────────────────────────────────
  int_http: espec(
    z.object({
      metodo: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("GET"),
      url: textoObligatorio("La petición HTTP necesita una URL"),
      headers: z.array(CABECERA).default(() => []),
      body: z.string().default("{}"),
      variableRespuesta: z.string().default("respuesta_http"),
      timeout: z.number().default(30),
    }),
    { alias: { metodo: ["method"] } },
  ),
  int_webhook_out: espec(
    z.object({
      url: textoObligatorio("El webhook necesita una URL de destino"),
      headers: z.array(CABECERA).default(() => []),
      payloadTipo: z.enum(["completo", "minimo", "custom"]).default("completo"),
      payloadCustom: z.string().default("{}"),
    }),
  ),
  int_codigo: espec(
    z.object({
      codigo: textoObligatorio("El bloque de código está vacío"),
      variableSalida: z.string().default("resultado_codigo"),
      timeout: z.number().default(5000),
    }),
    { alias: { codigo: ["code"] } },
  ),
  int_email: espec(
    z.object({
      para: textoObligatorio("El email necesita un destinatario"),
      asunto: z.string().optional(),
      cuerpo: z.string().optional(),
      cc: z.string().optional(),
    }),
    {
      alias: { para: ["to", "destinatario"], asunto: ["subject"], cuerpo: ["body"] },
      advertencias: (c) => [
        ...(c.asunto ? [] : [{ mensaje: "El email no tiene asunto" }]),
        ...(c.cuerpo ? [] : [{ mensaje: "El email no tiene contenido" }]),
      ],
    },
  ),
  int_sheets: espec(
    z.object({
      sheetId: z.string().optional(),
      pestana: z.string().optional(),
      operacion: z.enum(["append", "read", "update"]).default("append"),
      columnas: z.string().optional(),
      rango: z.string().optional(),
    }),
  ),
  int_db: espec(
    z.object({
      query: z.string().optional(),
      params: z.string().default("[]"),
      variableResultado: z.string().default("resultado_db"),
    }),
  ),

  // ── IA ────────────────────────────────────────────────────────────────
  ia_clasificar: espec(
    z.object({
      intentIds: z.array(z.string()).default(() => []),
      umbral: z.number().default(70),
      variableResultado: z.string().default("intent_detectado"),
    }),
  ),
  ia_responder: espec(
    z.object({
      instrucciones: z.string().optional(),
      modelo: z.enum(["gpt-4o-mini", "gpt-4o", "gpt-4-turbo"]).default("gpt-4o-mini"),
      temperatura: z.number().default(0.7),
      maxTokens: z.number().default(500),
      variableRespuesta: z.string().default("respuesta_ia"),
    }),
    {
      alias: { instrucciones: ["prompt"] },
      advertencias: (c) =>
        typeof c.instrucciones === "string" && c.instrucciones.trim() !== ""
          ? []
          : [
              {
                mensaje: "No hay instrucciones para la IA",
                sugerencia: "Agrega un prompt para guiar la respuesta",
              },
            ],
    },
  ),
  ia_extraer: espec(
    z.object({
      texto: z.string().optional(),
      campos: z
        .array(
          z.object({
            nombre: z.string(),
            tipo: z.enum(["texto", "numero", "fecha", "booleano"]),
            descripcion: z.string(),
          }),
        )
        .default(() => []),
      variableResultado: z.string().default("datos_extraidos"),
    }),
  ),
  ia_sentimiento: espec(
    z.object({
      texto: z.string().optional(),
      tipoAnalisis: z.enum(["basico", "detallado"]).default("basico"),
      variableResultado: z.string().default("sentimiento"),
    }),
  ),
  ia_resumir: espec(
    z.object({
      fuente: z.enum(["conversacion", "ultimos_mensajes", "texto"]).default("conversacion"),
      cantidad: z.number().default(10),
      texto: z.string().optional(),
      longitud: z.enum(["corto", "medio", "largo"]).default("corto"),
      variableResultado: z.string().default("resumen"),
    }),
  ),
  ia_traducir: espec(
    z.object({
      texto: z.string().optional(),
      idiomaOrigen: z.enum(["auto", "es", "en", "pt"]).default("auto"),
      idiomaDestino: z.enum(["es", "en", "pt"]).default("es"),
      variableResultado: z.string().default("traduccion"),
    }),
  ),
  ia_spam: espec(
    z.object({
      texto: z.string().optional(),
      umbral: z.number().default(80),
      variableResultado: z.string().default("es_spam"),
    }),
  ),

  // El motor no lo ejecuta (`disponibilidad.ts`): sin claves hasta que tenga
  // handler, para no inventar un contrato que nadie lee.
  ia_delegar: espec(z.object({})),

  // ── Internos ──────────────────────────────────────────────────────────
  int_notif_vendedor: espec(
    z.object({
      // "vendedor_asignado" o el id de un usuario.
      destinatario: z.string().default("vendedor_asignado"),
      titulo: z.string().optional(),
      mensaje: z.string().optional(),
      urgencia: z.enum(["baja", "normal", "alta", "urgente"]).default("normal"),
      enviarPush: z.boolean().default(true),
      enviarEmail: z.boolean().default(false),
    }),
  ),
  int_notif_grupo: espec(
    z.object({
      canalId: z.string().optional(),
      mensaje: z.string().optional(),
      mencionarTodos: z.boolean().default(false),
    }),
  ),
  int_comentario: espec(
    z.object({
      comentario: z.string().optional(),
      autor: z.enum(["sistema", "vendedor_asignado"]).default("sistema"),
    }),
  ),
  int_debug: espec(
    z.object({
      nivel: z.enum(["debug", "info", "warn", "error"]).default("info"),
      mensaje: z.string().optional(),
      variables: z.string().optional(),
      pausar: z.boolean().default(false),
    }),
  ),
} as const satisfies Record<TipoConfigurable, EspecConfig>;

type EspecDeTipo<T extends TipoConfigurable> = (typeof ESPEC_CONFIG_POR_TIPO)[T];

/** La config de un tipo ya validada, con sus defaults puestos. */
export type ConfigDeTipo<T extends TipoConfigurable> = z.output<EspecDeTipo<T>["schema"]>;

/** Las claves que puede escribir el formulario de un tipo. */
export type ClaveDeConfig<T extends TipoConfigurable> = keyof ConfigDeTipo<T> & string;

/** Lo que recibe cada acción después de `configDeAccion`. */
export type ConfigDeAccion<A extends AccionWorkflow> = z.output<
  (typeof ESPEC_CONFIG_POR_ACCION)[A]["schema"]
>;

// ──────────────────────────────────────────────────────────────────────────
// Lectura
// ──────────────────────────────────────────────────────────────────────────

function esTipoConfigurable(tipo: string): tipo is TipoConfigurable {
  return Object.hasOwn(ESPEC_CONFIG_POR_TIPO, tipo);
}

function esAccion(valor: unknown): valor is AccionWorkflow {
  return typeof valor === "string" && (ACCIONES as readonly string[]).includes(valor);
}

/** Las claves viejas pasadas a su nombre de hoy. Devuelve un objeto nuevo. */
function normalizarCon(
  espec: EspecConfig,
  config: Record<string, unknown>,
): Record<string, unknown> {
  const salida = { ...config };
  for (const [nueva, viejas] of Object.entries(espec.alias ?? {})) {
    for (const vieja of viejas ?? []) {
      const { clave, convertir } =
        typeof vieja === "string" ? { clave: vieja, convertir: (v: unknown) => v } : vieja;
      if (!Object.hasOwn(salida, clave)) continue;
      const valor = salida[clave];
      delete salida[clave];
      if (salida[nueva] === undefined) salida[nueva] = convertir(valor);
    }
  }
  return salida;
}

/** La config con el default del schema en cada clave ausente. No valida lo que ya está. */
function conDefaults(
  schema: z.ZodObject,
  config: Record<string, unknown>,
): Record<string, unknown> {
  const salida = { ...config };
  for (const [clave, campo] of Object.entries(schema.shape)) {
    if (salida[clave] !== undefined) continue;
    const porDefecto = z.safeParse(campo, undefined);
    if (porDefecto.success && porDefecto.data !== undefined) salida[clave] = porDefecto.data;
  }
  return salida;
}

function mensajesDe(error: z.ZodError): string[] {
  return [...new Set(error.issues.map((issue) => issue.message))];
}

/**
 * La config de un nodo con las claves viejas pasadas a su nombre de hoy. El
 * legacy `accion` se normaliza con el schema de la acción que declara.
 */
export function normalizarConfig(
  tipo: NodoTipo,
  config: Record<string, unknown>,
): Record<string, unknown> {
  if (tipo === "accion") {
    const accion = config["accion"];
    return esAccion(accion)
      ? normalizarCon(ESPEC_CONFIG_POR_ACCION[accion], config)
      : { ...config };
  }
  return esTipoConfigurable(tipo)
    ? normalizarCon(ESPEC_CONFIG_POR_TIPO[tipo], config)
    : { ...config };
}

export interface RevisionConfig {
  /** Impiden correr el bloque. */
  errores: string[];
  advertencias: Advertencia[];
}

function revisarCon(espec: EspecConfig, config: Record<string, unknown>): RevisionConfig {
  const normalizada = normalizarCon(espec, config);
  const resultado = espec.schema.safeParse(normalizada);
  return {
    errores: resultado.success ? [] : mensajesDe(resultado.error),
    advertencias: espec.advertencias?.(conDefaults(espec.schema, normalizada)) ?? [],
  };
}

/**
 * Qué le falta a la config de un nodo para poder correr, y qué conviene
 * mirar. `null` = el tipo está fuera de este contrato (la condición, o un
 * tipo que este módulo no conoce).
 */
export function revisarConfig(nodo: Pick<Nodo, "tipo" | "config">): RevisionConfig | null {
  if (nodo.tipo === "accion") {
    const accion = nodo.config["accion"];
    if (!esAccion(accion)) {
      return {
        errores: [
          accion === undefined
            ? "El paso no dice qué acción ejecutar"
            : `La acción ${JSON.stringify(accion)} no es una que el motor sepa ejecutar`,
        ],
        advertencias: [],
      };
    }
    return revisarCon(ESPEC_CONFIG_POR_ACCION[accion], nodo.config);
  }
  if (!esTipoConfigurable(nodo.tipo)) return null;
  return revisarCon(ESPEC_CONFIG_POR_TIPO[nodo.tipo], nodo.config);
}

/**
 * La config que ejecuta una acción, validada y con sus defaults. Una config
 * que no sirve es `ValidationError` —no se reintenta: repetiría lo mismo— con
 * los issues de Zod adjuntos.
 */
export function configDeAccion<A extends AccionWorkflow>(
  accion: A,
  nodo: Pick<Nodo, "id" | "config">,
): ConfigDeAccion<A> {
  const especAccion: EspecConfig = ESPEC_CONFIG_POR_ACCION[accion];
  const resultado = especAccion.schema.safeParse(normalizarCon(especAccion, nodo.config));
  if (!resultado.success) {
    throw new ValidationError(
      `el nodo "${nodo.id}" (${accion}) está mal configurado: ${mensajesDe(resultado.error).join("; ")}`,
      resultado.error.issues,
    );
  }
  return resultado.data as ConfigDeAccion<A>;
}

// ──────────────────────────────────────────────────────────────────────────
// Escritura (formularios del panel)
// ──────────────────────────────────────────────────────────────────────────

export interface EditorConfig<T extends TipoConfigurable> {
  /**
   * Lo que pinta el formulario: las claves viejas ya en su campo y el default
   * del schema donde no hay nada. Los valores no están validados.
   */
  readonly valores: Readonly<Partial<Record<ClaveDeConfig<T>, unknown>>>;
  /**
   * La config con `campo` en `valor`, lista para `onChange`. Escribe sólo lo
   * tocado —un default que nadie eligió no se guarda— y deja las claves viejas
   * con su nombre de hoy.
   */
  con(campo: ClaveDeConfig<T>, valor: unknown): Record<string, unknown>;
}

export function editorDeConfig<T extends TipoConfigurable>(
  tipo: T,
  config: Record<string, unknown>,
): EditorConfig<T> {
  const especTipo: EspecConfig = ESPEC_CONFIG_POR_TIPO[tipo];
  const normalizada = normalizarCon(especTipo, config);
  return {
    // Las claves son las del schema de `tipo`: `conDefaults` recorre su shape.
    // TypeScript no puede seguir eso a través de un `T` genérico.
    valores: conDefaults(especTipo.schema, normalizada) as EditorConfig<T>["valores"],
    con: (campo, valor) => ({ ...normalizada, [campo]: valor }),
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Variables de los textos
// ──────────────────────────────────────────────────────────────────────────

/**
 * Las variables que un texto de un bloque puede usar (`{{lead.nombre}}`).
 *
 * Son exactamente los campos que carga `cargarDatosInterpolacion`
 * (`server/services/workflows/acciones/datos-interpolacion.ts`) para
 * `interpolarVariables`: esa función arma su resultado contra este tipo, así
 * que agregar una acá sin cargarla no compila. El selector del panel
 * (`canvas/config/VariableSelector.tsx`) ofrece esta lista y ninguna otra: una
 * variable que el motor no carga sale como un hueco en el mensaje, sin error.
 *
 * Sólo las que tienen dato en la base. Quedan afuera a propósito:
 * - `sesion.pieza_buscada`: el Twin no tiene ese campo (lo más cercano es
 *   `consulta`, texto libre de lo que pidió);
 * - `vendedor.telefono`: `usuarios` no guarda teléfono;
 * - `contexto.*`: lo que siembra el disparador (`contextoDeDisparo`) es
 *   `lead.*`/`sesion.*` anidado y ya está acá; el texto del mensaje no se
 *   guarda en la corrida a propósito (purga de 29 días), y ningún disparo
 *   carga intent, fecha ni hora.
 */
export const VARIABLES_DE_TEXTO = {
  lead: ["nombre", "telefono", "canal", "email", "etapa"],
  sesion: ["current_stage"],
  vendedor: ["nombre", "email"],
} as const satisfies Partial<Record<keyof DatosInterpolacion, readonly string[]>>;

type NamespacesDeTexto = typeof VARIABLES_DE_TEXTO;

/** Los campos que el motor carga en un namespace. */
export type CamposDeVariable<N extends keyof NamespacesDeTexto> = NamespacesDeTexto[N][number];

export type VariableDeTexto = {
  [N in keyof NamespacesDeTexto]: `${N}.${CamposDeVariable<N>}`;
}[keyof NamespacesDeTexto];

export const LISTA_VARIABLES_DE_TEXTO: readonly VariableDeTexto[] = Object.entries(
  VARIABLES_DE_TEXTO,
).flatMap(([namespace, campos]) =>
  campos.map((campo) => `${namespace}.${campo}` as VariableDeTexto),
);
