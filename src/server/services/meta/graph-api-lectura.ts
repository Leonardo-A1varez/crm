import { z } from "zod";
import { InfraError, PermissionDeniedError, RateLimitError, ValidationError } from "@/lib/errors";
import { withSpan } from "@/lib/observability/tracing";

/**
 * Lecturas del estado de la cuenta de WhatsApp contra la Graph API de Meta.
 *
 * ============================ SOLO GET ============================
 *
 * Esta clase no tiene un solo camino que mande otra cosa que un GET, y no es
 * un descuido: despausar una plantilla, cambiar un número o mandar un mensaje
 * son acciones sobre una cuenta que vende, y ninguna se dispara desde una
 * pantalla que se abre para mirar. Los envíos viven en `GraphApiMetaClient`
 * (`graph-api-client.ts`), que es otro contrato con otro puerto.
 *
 * Por eso tampoco se agregaron estos métodos a `MetaApiClient`: esa interfaz
 * la implementan fakes de tests de otras pantallas, y ensancharla los rompía
 * a todos para sumarles cinco lecturas que ninguno usa.
 *
 * ============================ EL TOKEN ============================
 *
 * Viaja SÓLO en el header `Authorization`. Nunca en la URL: una URL termina en
 * logs de acceso, en trazas y en mensajes de error, y un `?access_token=` ahí
 * es una credencial de la cuenta de WhatsApp impresa en texto plano. Además,
 * cualquier texto que venga de Meta pasa por `sanear` antes de salir de esta
 * clase, por si alguna vez un mensaje de error lo repite.
 *
 * Los ids se validan antes de armar la ruta: vienen de env y de respuestas de
 * Meta, pero un id con `/` o `..` convertiría una lectura del número en una
 * lectura de cualquier otro nodo que el token alcance.
 */

export interface GraphApiMetaLecturaConfig {
  /** `META_GRAPH_API_VERSION`, tal cual. Esta clase no la cambia ni la negocia. */
  graphApiVersion: string;
  /** `META_WHATSAPP_ACCESS_TOKEN`. Sólo sale en el header `Authorization`. */
  accessToken: string;
  /** Override de la base (tests). Default `https://graph.facebook.com`. */
  baseUrl?: string;
  /** Inyectable para tests. Default el `fetch` global. */
  fetchImpl?: typeof fetch;
  /**
   * Tope por pedido. La pantalla espera a Meta para dibujarse, así que un
   * pedido colgado no puede colgarla a ella.
   */
  timeoutMs?: number;
}

/** Un número de teléfono tal cual lo devuelve Meta. */
export interface NumeroCrudo {
  id: string;
  display_phone_number: string | null;
  verified_name: string | null;
  /** Crudo: `GREEN`, `YELLOW`, `RED`, `NA`, `UNKNOWN`… Se interpreta más arriba. */
  quality_rating: string | null;
}

export interface ErrorDeSaludCrudo {
  error_code: number | null;
  error_description: string | null;
  possible_solution: string | null;
}

export interface EntidadDeSaludCruda {
  /** `PHONE_NUMBER`, `WABA`, `BUSINESS`, `APP`, `MESSAGE_TEMPLATE`. */
  entity_type: string;
  id: string | null;
  /** `AVAILABLE`, `LIMITED` o `BLOCKED`, crudo. */
  can_send_message: string | null;
  additional_info: string[];
  errors: ErrorDeSaludCrudo[];
}

/** El `health_status` de un nodo: el estado agregado y el de cada entidad involucrada. */
export interface SaludCruda {
  can_send_message: string | null;
  entities: EntidadDeSaludCruda[];
}

/** Una plantilla tal cual la devuelve Meta. */
export interface PlantillaCruda {
  id: string;
  name: string;
  language: string | null;
  category: string | null;
  status: string | null;
  rejected_reason: string | null;
  /** El `score` de `quality_score`. Meta lo manda anidado; acá se aplana. */
  quality_score: string | null;
}

export interface MetaLecturaClient {
  leerNumero(phoneNumberId: string): Promise<NumeroCrudo>;
  /** `null` cuando Meta no incluye el campo en la respuesta. */
  leerLimiteDeMensajeria(phoneNumberId: string): Promise<string | null>;
  leerSalud(nodoId: string): Promise<SaludCruda>;
  listarNumeros(wabaId: string): Promise<{ numeros: NumeroCrudo[]; hayMas: boolean }>;
  listarPlantillas(
    wabaId: string,
    limite: number,
  ): Promise<{ plantillas: PlantillaCruda[]; hayMas: boolean }>;
}

const DEFAULT_BASE_URL = "https://graph.facebook.com";
const DEFAULT_TIMEOUT_MS = 8_000;
const VERSION_VALIDA = /^v\d+\.\d+$/;
const ID_VALIDO = /^\d+$/;
const LARGO_MAXIMO_DETALLE = 300;

// Los campos de cada lectura, verificados contra la documentación de Meta el
// 2026-09-13: número de teléfono (manage-phone-numbers), límite de mensajería
// (messaging-limits), health_status (cloud-api/health-status) y plantillas
// (referencia de WhatsAppBusinessHSM). Un campo que la versión fijada en
// `META_GRAPH_API_VERSION` no conozca hace fallar SU pedido y no los demás:
// por eso cada lectura es un pedido aparte.
const CAMPOS_NUMERO = "id,display_phone_number,verified_name,quality_rating";
const CAMPO_LIMITE = "whatsapp_business_manager_messaging_limit";
const CAMPO_SALUD = "health_status";
const CAMPOS_PLANTILLA = "id,name,language,category,status,rejected_reason,quality_score";

const IdSchema = z.union([z.string().min(1), z.number()]).transform((v) => String(v));
const TextoOpcional = z
  .string()
  .nullish()
  .transform((v) => v ?? null);

const NumeroSchema = z.object({
  id: IdSchema,
  display_phone_number: TextoOpcional,
  verified_name: TextoOpcional,
  quality_rating: TextoOpcional,
});

const LimiteSchema = z.object({
  whatsapp_business_manager_messaging_limit: TextoOpcional,
});

/** Tolerante con el tipo: un código que llegue como string no tumba la lectura entera. */
const CodigoSchema = z
  .union([z.number(), z.string()])
  .nullish()
  .transform((v) => {
    if (v === null || v === undefined) return null;
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  });

const ErrorDeSaludSchema = z.object({
  error_code: CodigoSchema,
  error_description: TextoOpcional,
  possible_solution: TextoOpcional,
});

const EntidadSchema = z.object({
  entity_type: z.string(),
  id: IdSchema.nullish().transform((v) => v ?? null),
  can_send_message: TextoOpcional,
  additional_info: z
    .union([z.array(z.string()), z.string()])
    .nullish()
    .transform((v) => (v === null || v === undefined ? [] : Array.isArray(v) ? v : [v])),
  errors: z
    .array(ErrorDeSaludSchema)
    .nullish()
    .transform((v) => v ?? []),
});

const SaludSchema = z.object({
  health_status: z
    .object({
      can_send_message: TextoOpcional,
      entities: z
        .array(EntidadSchema)
        .nullish()
        .transform((v) => v ?? []),
    })
    .nullish(),
});

const PagingSchema = z.object({ next: z.string().nullish() }).nullish();

const ListaNumerosSchema = z.object({
  data: z.array(NumeroSchema),
  paging: PagingSchema,
});

const PlantillaSchema = z.object({
  id: IdSchema,
  name: z.string(),
  language: TextoOpcional,
  category: TextoOpcional,
  status: TextoOpcional,
  rejected_reason: TextoOpcional,
  // La forma exacta de `quality_score` no está fijada en la referencia que se
  // leyó ("WhatsAppBusinessHSMQualityScoreShape"). Se acepta cualquier cosa y
  // se extrae el `score` si está; si no, queda en null en vez de romper.
  quality_score: z.unknown().optional(),
});

const ListaPlantillasSchema = z.object({
  data: z.array(PlantillaSchema),
  paging: PagingSchema,
});

interface GraphErrorBody {
  error?: {
    message?: string;
    code?: number;
    fbtrace_id?: string;
  };
}

function scoreDe(calidad: unknown): string | null {
  if (typeof calidad === "string" && calidad.length > 0) return calidad;
  if (typeof calidad === "object" && calidad !== null && "score" in calidad) {
    const score = (calidad as { score: unknown }).score;
    return typeof score === "string" && score.length > 0 ? score : null;
  }
  return null;
}

function idDeMeta(id: string, que: string): string {
  if (!ID_VALIDO.test(id)) {
    throw new ValidationError(`el id de ${que} no es un id numérico de Meta`);
  }
  return id;
}

export class GraphApiMetaLecturaClient implements MetaLecturaClient {
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(private readonly cfg: GraphApiMetaLecturaConfig) {
    if (!VERSION_VALIDA.test(cfg.graphApiVersion)) {
      throw new ValidationError("META_GRAPH_API_VERSION no tiene la forma v<major>.<minor>");
    }
    this.fetchImpl = cfg.fetchImpl ?? fetch;
    this.baseUrl = (cfg.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async leerNumero(phoneNumberId: string): Promise<NumeroCrudo> {
    const datos = await this.get(
      [idDeMeta(phoneNumberId, "número")],
      { fields: CAMPOS_NUMERO },
      {
        operacion: "numero",
        accion: "leer el número",
      },
    );
    return this.parsear(NumeroSchema, datos, "leer el número");
  }

  async leerLimiteDeMensajeria(phoneNumberId: string): Promise<string | null> {
    const datos = await this.get(
      [idDeMeta(phoneNumberId, "número")],
      { fields: CAMPO_LIMITE },
      {
        operacion: "limite",
        accion: "leer el límite de mensajería",
      },
    );
    return this.parsear(LimiteSchema, datos, "leer el límite de mensajería")
      .whatsapp_business_manager_messaging_limit;
  }

  async leerSalud(nodoId: string): Promise<SaludCruda> {
    const datos = await this.get(
      [idDeMeta(nodoId, "nodo")],
      { fields: CAMPO_SALUD },
      {
        operacion: "salud",
        accion: "leer health_status",
      },
    );
    const { health_status } = this.parsear(SaludSchema, datos, "leer health_status");
    if (health_status === null || health_status === undefined) {
      throw new ValidationError("Meta no incluyó health_status en la respuesta");
    }
    return health_status;
  }

  async listarNumeros(wabaId: string): Promise<{ numeros: NumeroCrudo[]; hayMas: boolean }> {
    const datos = await this.get(
      [idDeMeta(wabaId, "la cuenta (WABA)"), "phone_numbers"],
      { fields: CAMPOS_NUMERO },
      { operacion: "numeros", accion: "listar los números de la cuenta" },
    );
    const { data, paging } = this.parsear(
      ListaNumerosSchema,
      datos,
      "listar los números de la cuenta",
    );
    return { numeros: data, hayMas: Boolean(paging?.next) };
  }

  async listarPlantillas(
    wabaId: string,
    limite: number,
  ): Promise<{ plantillas: PlantillaCruda[]; hayMas: boolean }> {
    if (!Number.isInteger(limite) || limite < 1) {
      throw new ValidationError("el tope de plantillas tiene que ser un entero positivo");
    }
    const datos = await this.get(
      [idDeMeta(wabaId, "la cuenta (WABA)"), "message_templates"],
      { fields: CAMPOS_PLANTILLA, limit: String(limite) },
      { operacion: "plantillas", accion: "listar las plantillas" },
    );
    const { data, paging } = this.parsear(ListaPlantillasSchema, datos, "listar las plantillas");
    return {
      plantillas: data.map((p) => ({
        id: p.id,
        name: p.name,
        language: p.language,
        category: p.category,
        status: p.status,
        rejected_reason: p.rejected_reason,
        quality_score: scoreDe(p.quality_score),
      })),
      hayMas: Boolean(paging?.next),
    };
  }

  /**
   * El único punto de salida a la red de esta clase. `method: "GET"` va
   * escrito aunque sea el default de `fetch`: es la garantía que se lee, y el
   * test la afirma pedido por pedido.
   */
  private async get(
    segmentos: readonly string[],
    params: Record<string, string>,
    etiqueta: { operacion: string; accion: string },
  ): Promise<unknown> {
    const query = new URLSearchParams(params).toString();
    const url = `${this.baseUrl}/${this.cfg.graphApiVersion}/${segmentos.join("/")}?${query}`;

    return withSpan("meta.lectura", { operacion: etiqueta.operacion }, async () => {
      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${this.cfg.accessToken}`,
            Accept: "application/json",
          },
          cache: "no-store",
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (causa) {
        throw this.errorDeRed(causa, etiqueta.accion);
      }

      if (!res.ok) throw await this.errorDeGraph(res, etiqueta.accion);

      try {
        return (await res.json()) as unknown;
      } catch (causa) {
        throw new InfraError(
          `Meta respondió algo que no es JSON al ${etiqueta.accion}`,
          "meta",
          causa,
        );
      }
    });
  }

  private parsear<S extends z.ZodType>(schema: S, datos: unknown, accion: string): z.output<S> {
    const r = schema.safeParse(datos);
    if (!r.success) {
      throw new ValidationError(
        `Meta respondió con una forma inesperada al ${accion}`,
        r.error.issues,
      );
    }
    return r.data;
  }

  private errorDeRed(causa: unknown, accion: string): InfraError {
    const nombre = causa instanceof Error ? causa.name : "";
    if (nombre === "TimeoutError" || nombre === "AbortError") {
      const segundos = Math.round(this.timeoutMs / 1000);
      return new InfraError(`Meta tardó más de ${segundos} s al ${accion}`, "meta", causa);
    }
    const detalle = causa instanceof Error ? causa.message : String(causa);
    return new InfraError(`Meta no respondió al ${accion}: ${this.sanear(detalle)}`, "meta", causa);
  }

  private async errorDeGraph(res: Response, accion: string): Promise<Error> {
    let cuerpo: GraphErrorBody = {};
    try {
      cuerpo = (await res.json()) as GraphErrorBody;
    } catch {
      // Cuerpo no parseable: alcanza con el status.
    }
    const detalle = this.sanear(cuerpo.error?.message ?? `HTTP ${res.status}`);
    const ctx = {
      accion,
      status: res.status,
      code: cuerpo.error?.code,
      trace: cuerpo.error?.fbtrace_id,
    };

    // Mismo criterio que `GraphApiMetaClient`: se mapea por status HTTP. El
    // texto de Meta va entero en el mensaje, así que el motivo real llega a la
    // pantalla aunque la clase de error sea gruesa.
    if (res.status === 429) {
      return new RateLimitError(
        `Meta limitó los pedidos al ${accion}: ${detalle}`,
        "meta",
        undefined,
        ctx,
      );
    }
    if (res.status === 401 || res.status === 403) {
      return new PermissionDeniedError(`Meta rechazó el token al ${accion}: ${detalle}`, ctx);
    }
    if (res.status === 400) {
      return new ValidationError(`Meta rechazó la consulta al ${accion}: ${detalle}`, ctx);
    }
    return new InfraError(
      `Meta respondió HTTP ${res.status} al ${accion}: ${detalle}`,
      "meta",
      ctx,
    );
  }

  /** Saca el token de cualquier texto de Meta y lo acota a un largo legible. */
  private sanear(texto: string): string {
    const token = this.cfg.accessToken;
    const limpio = token.length >= 8 ? texto.split(token).join("[token]") : texto;
    return limpio.length > LARGO_MAXIMO_DETALLE
      ? `${limpio.slice(0, LARGO_MAXIMO_DETALLE)}…`
      : limpio;
  }
}
